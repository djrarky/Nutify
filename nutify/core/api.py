from flask import jsonify, request, current_app, send_file
from marshmallow import Schema, fields, ValidationError, post_load
import datetime
import json
from dateutil import parser
import re
from .settings import (  
    LOG, LOG_LEVEL, LOG_WERKZEUG,
    get_configured_timezone, TIMEZONE
)
from .db.ups import (
    db, data_lock, get_ups_data, get_supported_value, get_ups_model,
    UPSConnectionError, UPSCommandError, UPSDataError, create_static_model,
    VariableConfig, UPSEvent, UPSCommand, ReportSchedule, ups_data_cache
)
from .mail import (
    init_notification_settings, get_notification_settings, test_notification,
    register_mail_api_routes
)
from .upsmon import handle_nut_event, get_event_history, get_events_table, acknowledge_event
from .events.api_events import register_api_routes as register_events_api_routes
import os
from datetime import datetime, timedelta
from .voltage.voltage import get_available_voltage_metrics, get_voltage_stats, get_voltage_history
import configparser
import pytz
from core.logger import web_logger as logger
import tempfile, zipfile
from core.options import get_filtered_logs, clear_logs
from .report import report_manager
from .upscmd.api_upscmd import register_api_routes as register_upscmd_api_routes
from .upsrw.api_upsrw import register_api_routes as register_upsrw_api_routes
from .infoapi import register_api_routes as register_infoapi_routes
logger.info("🐝 Initializing api")

class CustomJSONEncoder(json.JSONEncoder):
    def default(self, obj):
        try:
            if isinstance(obj, datetime):
                return obj.isoformat()
            if hasattr(obj, 'isoformat'):
                return obj.isoformat()
            return super().default(obj)
        except Exception:
            return str(obj)

def jsonify_pretty(*args, **kwargs):
    """ Formats the JSON in a readable way"""
    response = jsonify(*args, **kwargs)
    response.set_data(json.dumps(response.get_json(), indent=2))
    return response


def get_historical_data(start_time, end_time):
    try:
        UPSData = get_ups_model()
        logger.debug(f"Querying data from {start_time} to {end_time}")
        data = UPSData.query.filter(
            UPSData.timestamp_tz.between(start_time, end_time)
        ).order_by(UPSData.timestamp_tz.asc()).all()
        logger.debug(f"Found {len(data)} records")
        result = []
        for entry in data:
            try:
                nominal_power = entry.ups_realpower_nominal if entry.ups_realpower_nominal is not None else 960
                load = entry.ups_load if entry.ups_load is not None else 0
                calculated_power = (nominal_power * load) / 100
                item = {
                    'timestamp': entry.timestamp_tz.isoformat(),
                    'input_voltage': float(entry.input_voltage if entry.input_voltage is not None else 0),
                    'power': float(calculated_power),
                    'energy': float(calculated_power),
                    'battery_charge': float(entry.battery_charge if entry.battery_charge is not None else 0)
                }
                result.append(item)
            except (ValueError, TypeError, AttributeError) as e:
                logger.error(f"Error processing record {entry.id}: {e}")
                continue
        logger.debug(f"Processed {len(result)} valid records")
        return result
    except Exception as e:
        logger.error(f"Error retrieving historical data: {e}")
        return []

def validate_datetime(date_text):
    try:
        return bool(parser.parse(date_text))
    except ValueError:
        return False

def sanitize_input(value):
    if isinstance(value, str):
        return re.sub(r'[^a-zA-Z0-9\s\-_\.]', '', value)
    return value

def build_ups_data_response(data):
    device_fields = {
        'model': get_supported_value(data, 'device_model'),
        'manufacturer': get_supported_value(data, 'device_mfr'),
        'serial': get_supported_value(data, 'device_serial'),
        'type': get_supported_value(data, 'device_type'),
        'location': get_supported_value(data, 'device_location')
    }
    try:
        load = float(get_supported_value(data, 'ups_load', '0'))
        nominal_power = float(get_supported_value(data, 'ups_realpower_nominal', '960'))
        calculated_power = (load * nominal_power) / 100
        power_value = str(round(calculated_power, 2))
    except (ValueError, TypeError):
        power_value = '0'
    return {
        'device': device_fields,
        'ups': {
            'status': get_supported_value(data, 'ups_status'),
            'load': get_supported_value(data, 'ups_load', '0'),
            'temperature': get_supported_value(data, 'ups_temperature', '0'),
            'power': power_value,
            'realpower': power_value,
            'realpower_nominal': get_supported_value(data, 'ups_realpower_nominal', '960')
        },
        'input': {
            'voltage': get_supported_value(data, 'input_voltage', '0'),
            'frequency': get_supported_value(data, 'input_frequency', '0'),
            'voltage_nominal': get_supported_value(data, 'input_voltage_nominal', '0'),
            'current': get_supported_value(data, 'input_current', '0')
        },
        'output': {
            'voltage': get_supported_value(data, 'output_voltage', '0'),
            'frequency': get_supported_value(data, 'output_frequency', '0'),
            'current': get_supported_value(data, 'output_current', '0')
        },
        'battery': {
            'charge': get_supported_value(data, 'battery_charge', '0'),
            'runtime': get_supported_value(data, 'battery_runtime', '0'),
            'voltage': get_supported_value(data, 'battery_voltage', '0'),
            'temperature': get_supported_value(data, 'battery_temperature', 'N/A'),
            'type': get_supported_value(data, 'battery_type', 'N/A')
        },
        'ambient': {
            'temperature': get_supported_value(data, 'ambient_temperature', 'N/A'),
            'humidity': get_supported_value(data, 'ambient_humidity', 'N/A')
        }
    }

def format_chart_data(data, field):
    formatted_data = []
    for entry in data:
        try:
            if field in entry and entry[field] is not None:
                formatted_data.append({
                    'x': entry['timestamp'],
                    'y': float(entry[field]) if isinstance(entry[field], (int, float, str)) else 0
                })
        except (KeyError, ValueError, TypeError) as e:
            logger.debug(f"Skipping data point for {field}: {e}")
            continue
    return formatted_data

# Add SETTINGS_DIR
SETTINGS_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'instance', 'settings')

def register_api_routes(app, layouts_file='layouts.json'):
    """Registers all API routes for the application"""
    # Register mail API routes
    register_mail_api_routes(app)
    
    # Register upscmd API routes
    register_upscmd_api_routes(app)
    
    # Register upsrw API routes
    register_upsrw_api_routes(app)
    
    # Register events API routes
    register_events_api_routes(app)
    
    # Register infoapi routes
    register_infoapi_routes(app)

    def jsonify_pretty(*args, **kwargs):
        """ Formats the JSON in a readable way"""
        response = jsonify(*args, **kwargs)
        response.set_data(json.dumps(response.get_json(), indent=2))
        return response

    @app.route('/api/data/<column>')
    def get_column_data(column):
        """Returns the value of a specific column"""
        try:
            logger.debug(f"Requesting column: {column}")
            
            # Get the configured timezone
            tz = get_configured_timezone()
            current_time = datetime.now(tz)

            # Special handling for ups_realpower_days
            if column == 'ups_realpower_days':
                UPSDynamicData = get_ups_model()
                # Query to find the last non-null and non-zero value
                last_value = UPSDynamicData.query\
                    .filter(UPSDynamicData.ups_realpower_days.isnot(None))\
                    .filter(UPSDynamicData.ups_realpower_days != 0)\
                    .order_by(UPSDynamicData.timestamp_tz.desc())\
                    .first()
                
                if last_value:
                    value = getattr(last_value, column)
                    timestamp = format_datetime_tz(last_value.timestamp_tz).isoformat()
                    return jsonify({
                        'success': True,
                        'data': {
                            column: float(value),
                            'timestamp': timestamp
                        }
                    })

            # If the requested column is timestamp, return the current timestamp
            if column == 'timestamp':
                return jsonify({
                    'success': True,
                    'data': {
                        'timestamp': current_time.isoformat(),
                        column: current_time.isoformat()
                    }
                })

            # First check in dynamic data
            UPSDynamicData = get_ups_model()
            dynamic_data = UPSDynamicData.query.order_by(UPSDynamicData.timestamp_tz.desc()).first()
            
            if dynamic_data and hasattr(dynamic_data, column):
                value = getattr(dynamic_data, column)
                if value is not None:
                    # Format the value based on type
                    if isinstance(value, datetime):
                        value = format_datetime_tz(value).isoformat()
                    elif isinstance(value, (float, int)):
                        value = float(value) if isinstance(value, float) else int(value)
                    else:
                        value = str(value)

                    # Ensure the timestamp is in the correct timezone
                    timestamp = format_datetime_tz(dynamic_data.timestamp_tz).isoformat()
                    
                    return jsonify({
                        'success': True,
                        'data': {
                            column: value,
                            'timestamp': timestamp
                        }
                    })

            # If not found in dynamic data, check in static data
            UPSStaticData = create_static_model()
            static_data = UPSStaticData.query.first()
            
            if static_data and hasattr(static_data, column):
                value = getattr(static_data, column)
                if value is not None:
                    # Format the value based on type
                    if isinstance(value, datetime):
                        value = format_datetime_tz(value).isoformat()
                    elif isinstance(value, (float, int)):
                        value = float(value) if isinstance(value, float) else int(value)
                    else:
                        value = str(value)

                    # Use the timestamp of the static data if available, otherwise use the current timestamp
                    timestamp = (format_datetime_tz(static_data.timestamp_tz) if hasattr(static_data, 'timestamp_tz') 
                               else current_time).isoformat()
                    
                    return jsonify({
                        'success': True,
                        'data': {
                            column: value,
                            'timestamp': timestamp
                        }
                    })
            
            # Special handling for ups_realpower_hrs
            if column == 'ups_realpower_hrs' and dynamic_data:
                value = get_realpower_hrs(dynamic_data)
                timestamp = format_datetime_tz(dynamic_data.timestamp_tz).isoformat()
                return jsonify({
                    'success': True,
                    'data': {
                        column: value,
                        'timestamp': timestamp
                    }
                })
            
            # If the column is not found, return 404
            logger.warning(f"Column {column} not found in either dynamic or static data")
            return jsonify({
                'success': False,
                'error': f'Column {column} not found or has no value',
                'data': {
                    column: None,
                    'timestamp': current_time.isoformat()
                }
            }), 404
            
        except Exception as e:
            logger.error(f"Error getting column {column}: {str(e)}", exc_info=True)
            return jsonify({
                'success': False,
                'error': str(e),
                'data': {
                    column: None,
                    'timestamp': datetime.now(get_configured_timezone()).isoformat()
                }
            }), 500

    @app.route('/health')
    def health_check():
        """ Checks the system status"""
        try:
            UPSDynamicData = get_ups_model()
            tz = get_configured_timezone()
            current_time = datetime.now(tz)
            
            last_record = UPSDynamicData.query.order_by(UPSDynamicData.timestamp_tz.desc()).first()
            
            status = {
                'success': True,
                'timestamp': current_time.isoformat(),
                'database': {
                    'status': True if last_record else False,
                    'last_update': last_record.timestamp_tz.isoformat() if last_record else None,
                    'record_count': UPSDynamicData.query.count()
                }
            }
            
            # Check NUT service
            try:
                data = get_ups_data()
                status['nut_service'] = {
                    'status': True if data else False,
                    'ups_status': getattr(data, 'ups_status', 'unknown') if data else 'unknown',
                    'model': getattr(data, 'device_model', 'unknown') if data else 'unknown'
                }
            except Exception as e:
                status['nut_service'] = {
                    'status': False,
                    'error': str(e)
                }
            
            return jsonify(status)
            
        except Exception as e:
            logger.error(f"Health check failed: {str(e)}", exc_info=True)
            return jsonify({
                'success': False,
                'error': str(e)
            }), 500

    @app.route('/api/settings/<filename>', methods=['POST'])
    def save_settings(filename):
        """Saves the settings in a JSON file"""
        if not filename.endswith('.json'):
            return jsonify({'error': 'Invalid file type. Only JSON files are allowed'}), 400

        try:
            file_path = os.path.join(SETTINGS_DIR, filename)
            if not os.path.realpath(file_path).startswith(os.path.realpath(SETTINGS_DIR)):
                return jsonify({'error': 'Invalid file path'}), 400

            try:
                with open(file_path, 'r') as f:
                    existing_data = json.load(f)
            except FileNotFoundError:
                existing_data = {}

            new_data = request.get_json()
            if new_data is None:
                return jsonify({'error': 'No JSON data provided'}), 400

            existing_data.update(new_data)
            os.makedirs(SETTINGS_DIR, exist_ok=True)
            
            with open(file_path, 'w') as f:
                json.dump(existing_data, f, indent=4)
            
            return jsonify({'status': 'success'})
        except Exception as e:
            return jsonify({'status': 'error', 'message': str(e)}), 500

    return app 

def format_datetime(dt):
    """
    Format the datetime object using the timezone configured in config.txt.
    If dt is naive, assume it is in UTC and then convert it.
    """
    tz_str = get_configured_timezone()
    timezone = pytz.timezone(tz_str)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=pytz.utc)
    dt = dt.astimezone(timezone)
    return dt.isoformat() 

def ensure_timezone(dt):
    """Ensure datetime has the configured timezone"""
    if dt is None:
        return None
    tz = get_configured_timezone()
    if dt.tzinfo is None:
        return tz.localize(dt)
    return dt.astimezone(tz) 

def debug_value(value):
    """Helper function to debug values"""
    if value is None:
        return "None"
    return f"{type(value).__name__}: {str(value)}"

def log_query_result(data, source):
    """Helper function to log the results of queries"""
    if data is None:
        logger.debug(f"{source} query returned None")
        return
    
    logger.debug(f"{source} query returned data with columns: {[c.name for c in data.__table__.columns]}")
    for column in data.__table__.columns:
        value = getattr(data, column.name, None)
        logger.debug(f"Column {column.name}: {debug_value(value)}") 

def format_datetime_tz(dt):
    """Format datetime with timezone"""
    if dt is None:
        return None
    tz = get_configured_timezone()
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=tz)
    return dt

def get_realpower_hrs(dynamic_data):
    """Helper function to calculate ups_realpower_hrs if not present"""
    try:
        # First try to get the value directly
        if hasattr(dynamic_data, 'ups_realpower_hrs'):
            value = getattr(dynamic_data, 'ups_realpower_hrs')
            if value is not None:
                return float(value)
        
        # If not available, calculate from realpower and load
        realpower = getattr(dynamic_data, 'ups_realpower_nominal', None)
        load = getattr(dynamic_data, 'ups_load', None)
        
        if realpower is not None and load is not None:
            try:
                realpower = float(realpower)
                load = float(load)
                return (realpower * load) / 100.0
            except (ValueError, TypeError):
                logger.error("Error converting realpower or load to float")
                return 0.0
                
        logger.warning("Missing required attributes for ups_realpower_hrs calculation")
        return 0.0
        
    except Exception as e:
        logger.error(f"Error in get_realpower_hrs: {str(e)}")
        return 0.0 