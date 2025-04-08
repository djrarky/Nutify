from flask import jsonify, request
from datetime import datetime, timedelta
from sqlalchemy import func
import pytz

from core.db.ups import (
    get_ups_model, data_lock, VariableConfig
)
from core.logger import energy_logger as logger
from core.settings import get_configured_timezone

# Import functions from energy module
from .energy import (
    get_energy_data, get_energy_rate, calculate_cost_distribution,
    get_cost_trend_for_range, format_cost_series, calculate_energy_stats, format_realtime_data
)

def register_api_routes(app):
    """Register all API routes for the energy section"""
    
    @app.route('/api/energy/data')
    def get_energy_data_api():
        try:
            days = request.args.get('days', type=int, default=1)
            data = get_energy_data(days)
            # Ensure we're not returning a Response object
            if hasattr(data, 'get_json'):
                data = data.get_json()
            return jsonify(data)
        except Exception as e:
            logger.error(f"Error getting energy data: {str(e)}", exc_info=True)
            return jsonify({'error': str(e)}), 500

    @app.route('/api/energy/has_hour_data')
    def api_energy_has_hour_data():
        """
        API endpoint to check if there is at least 60 minutes of energy data.
        
        Returns:
            JSON response with a boolean indicating if enough data exists.
        """
        try:
            UPSDynamicData = get_ups_model()
            tz = get_configured_timezone()
            
            # Get current time in configured timezone
            now = datetime.now(tz)
            
            # Calculate time one hour ago
            one_hour_ago = now - timedelta(hours=1)
            
            # Query to find records in the last hour with valid ups_realpower
            data = UPSDynamicData.query\
                .filter(
                    UPSDynamicData.timestamp_tz >= one_hour_ago,
                    UPSDynamicData.timestamp_tz <= now,
                    UPSDynamicData.ups_realpower.isnot(None)
                ).order_by(UPSDynamicData.timestamp_tz.asc()).all()
            
            # Get the count of data points
            data_count = len(data)
            
            # Check if we have at least 30 data points (minimum threshold)
            if data_count < 30:
                logger.debug(f"Insufficient data points: {data_count} < 30")
                return jsonify({'has_data': False})
            
            # Check if we have data spanning at least 50 minutes
            if data:
                timestamps = [record.timestamp_tz for record in data]
                first_timestamp = min(timestamps)
                last_timestamp = max(timestamps)
                
                time_span_minutes = (last_timestamp - first_timestamp).total_seconds() / 60
                
                logger.debug(f"Data time span: {time_span_minutes} minutes with {data_count} points")
                
                # Require at least 50 minutes of data
                has_sufficient_data = time_span_minutes >= 50
                
                return jsonify({'has_data': has_sufficient_data})
            
            return jsonify({'has_data': False})
            
        except Exception as e:
            logger.error(f"Error checking for hour data: {str(e)}")
            return jsonify({'has_data': False, 'error': str(e)})

    @app.route('/api/energy/cost-trend')
    def get_cost_trend_data():
        """API for energy cost chart data"""
        try:
            UPSDynamicData = get_ups_model()
            period_type = request.args.get('type', 'day')
            from_time = request.args.get('from_time')
            to_time = request.args.get('to_time')
            
            logger.debug(f"Getting cost trend data - type: {period_type}, from: {from_time}, to: {to_time}")
            
            tz = get_configured_timezone()
            if period_type == 'range':
                # Expect from_time and to_time in "YYYY-MM-DD" format for range selection.
                start_dt = datetime.strptime(from_time, '%Y-%m-%d')
                end_dt = datetime.strptime(to_time, '%Y-%m-%d')
                start_time = tz.localize(start_dt)
                end_time = tz.localize(end_dt.replace(hour=23, minute=59, second=59))
                series = get_cost_trend_for_range(start_time, end_time)
                return jsonify({'success': True, 'series': series})

            elif period_type == 'realtime':
                
                end_time = datetime.now(tz)
                start_time = end_time - timedelta(minutes=5) # 5 minutes ago
                
                # Query with just basic timestamp filter - we'll check what data is available
                data = UPSDynamicData.query\
                    .filter(
                        UPSDynamicData.timestamp_tz >= start_time,
                        UPSDynamicData.timestamp_tz <= end_time
                    ).order_by(UPSDynamicData.timestamp_tz.asc()).all()
                
                # Check if we have ups_realpower data
                if data and hasattr(data[0], 'ups_realpower') and any(d.ups_realpower is not None for d in data):
                    series = format_cost_series(data, 'realtime')
                else:
                    # If no ups_realpower data, try load and nominal power
                    series = format_cost_series(data, 'calculated')

            elif period_type == 'today':
                # Hourly data for today
                now = datetime.now(tz)
                today = now.date()
                from_time_obj = datetime.strptime(from_time, '%H:%M').time()
                to_time_obj = datetime.strptime(to_time, '%H:%M').time()
                start_time = tz.localize(datetime.combine(today, from_time_obj))
                end_time = tz.localize(datetime.combine(today, to_time_obj))
                
                # First try with ups_realpower_hrs
                data = UPSDynamicData.query\
                    .filter(
                        UPSDynamicData.timestamp_tz >= start_time,
                        UPSDynamicData.timestamp_tz <= end_time
                    ).order_by(UPSDynamicData.timestamp_tz.asc()).all()
                
                # Check if we have ups_realpower_hrs data
                if data and hasattr(data[0], 'ups_realpower_hrs') and any(d.ups_realpower_hrs is not None for d in data):
                    series = format_cost_series(data, 'hrs')
                else:
                    # Fall back to calculated values based on load and nominal power
                    series = format_cost_series(data, 'calculated')

            elif period_type == 'day':
                # 24 hours for the selected day
                date = datetime.strptime(from_time, '%Y-%m-%d').replace(tzinfo=tz)
                start_time = date.replace(hour=0, minute=0, second=0)
                end_time = date.replace(hour=23, minute=59, second=59)
                
                # Get all data first without filtering on specific columns
                data = UPSDynamicData.query\
                    .filter(
                        UPSDynamicData.timestamp_tz >= start_time,
                        UPSDynamicData.timestamp_tz <= end_time
                    ).order_by(UPSDynamicData.timestamp_tz.asc()).all()
                
                # Check if we have ups_realpower_hrs data
                if data and hasattr(data[0], 'ups_realpower_hrs') and any(d.ups_realpower_hrs is not None for d in data):
                    series = format_cost_series(data, 'hrs')
                else:
                    # Fall back to calculated values based on load and nominal power
                    series = format_cost_series(data, 'calculated')

            return jsonify({
                'success': True,
                'series': series
            })
            
        except Exception as e:
            logger.error(f"Error getting cost trend data: {str(e)}")
            return jsonify({
                'success': False,
                'error': str(e)
            })

    @app.route('/api/energy/available-years')
    def get_available_years():
        """Return the years for which data is available, limited to the last 5"""
        try:
            UPSDynamicData = get_ups_model()
            with data_lock:
                years = UPSDynamicData.query\
                    .with_entities(func.extract('year', UPSDynamicData.timestamp_tz))\
                    .distinct()\
                    .order_by(func.extract('year', UPSDynamicData.timestamp_tz).desc())\
                    .limit(5)\
                    .all()
                
            return jsonify([int(year[0]) for year in years])
        except Exception as e:
            logger.error(f"Error getting available years: {str(e)}")
            return jsonify([])

    @app.route('/api/energy/detailed')
    def get_energy_detailed_data():
        try:
            from_time = request.args.get('from_time')
            to_time = request.args.get('to_time')
            detail_type = request.args.get('detail_type')  # 'day', 'hour', 'minute'
            
            logger.debug(f"Get detailed energy data - type: {detail_type}, from: {from_time}, to: {to_time}")
            
            if not from_time or not to_time or not detail_type:
                logger.error(f"Missing required parameters: from_time={from_time}, to_time={to_time}, detail_type={detail_type}")
                return jsonify({
                    'success': False,
                    'error': 'Missing required parameters'
                })
            
            tz = get_configured_timezone()
            
            try:
                # Fix timezone format for ISO parsing
                if from_time.endswith("Z"):
                    from_time = from_time.replace("Z", "+00:00")
                if to_time.endswith("Z"):
                    to_time = to_time.replace("Z", "+00:00")

                start_time = datetime.fromisoformat(from_time).astimezone(tz)
                end_time = datetime.fromisoformat(to_time).astimezone(tz)
                logger.debug(f"Parsed time range: {start_time} to {end_time}")
            except Exception as e:
                logger.error(f"Error parsing time format: {str(e)}")
                return jsonify({
                    'success': False,
                    'error': f"Invalid time format: {str(e)}"
                })
            
            UPSDynamicData = get_ups_model()
            
            if detail_type == 'day':
                # For the DateRange modal: show the 24 hours of the day
                data = UPSDynamicData.query\
                    .filter(
                        UPSDynamicData.timestamp_tz >= start_time,
                        UPSDynamicData.timestamp_tz <= end_time
                    )\
                    .order_by(UPSDynamicData.timestamp_tz.asc()).all()
                    
                logger.debug(f"Found {len(data)} records for day detail between {start_time} and {end_time}")
                    
                # Check if we have ups_realpower_hrs data
                has_hrs_data = data and len(data) > 0 and hasattr(data[0], 'ups_realpower_hrs') and any(d.ups_realpower_hrs is not None for d in data)
                
                if has_hrs_data:
                    logger.debug("Using ups_realpower_hrs for day detail")
                    series = format_cost_series(data, 'hrs')
                else:
                    logger.debug("Falling back to calculated values for day detail")
                    # Fall back to calculated values
                    series = format_cost_series(data, 'calculated')
                
            elif detail_type == 'hour':
                # For the hour modal: show the 60 minutes
                data = UPSDynamicData.query\
                    .filter(
                        UPSDynamicData.timestamp_tz >= start_time,
                        UPSDynamicData.timestamp_tz <= end_time
                    )\
                    .order_by(UPSDynamicData.timestamp_tz.asc()).all()
                    
                logger.debug(f"Found {len(data)} records for hour detail between {start_time} and {end_time}")
                    
                # Check if we have ups_realpower data
                has_realpower_data = data and len(data) > 0 and hasattr(data[0], 'ups_realpower') and any(d.ups_realpower is not None for d in data)
                
                if has_realpower_data:
                    logger.debug("Using ups_realpower for hour detail")
                    series = format_cost_series(data, 'realtime')
                else:
                    logger.debug("Falling back to calculated values for hour detail")
                    # Fall back to calculated values
                    series = format_cost_series(data, 'calculated')
            
            else:
                logger.error(f"Invalid detail type: {detail_type}")
                return jsonify({
                    'success': False,
                    'error': f"Invalid detail type: {detail_type}"
                })

            # Add additional validation
            if not series:
                logger.warning(f"No data series found for detail type: {detail_type}")
                series = []  # Ensure we at least return an empty array

            logger.debug(f"Returning series with {len(series)} data points")
            
            return jsonify({
                'success': True,
                'series': series
            })
            
        except Exception as e:
            logger.error(f"Error getting detailed energy data: {str(e)}", exc_info=True)
            return jsonify({
                'success': False,
                'error': str(e)
            })

    return app 