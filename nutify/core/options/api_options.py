from flask import Blueprint, jsonify, request, current_app, send_file
import os
import re
import sys
import tempfile
import zipfile
from datetime import datetime
from .options import (
    get_database_stats,
    backup_database,
    optimize_database,
    vacuum_database,
    get_log_files,
    get_log_content,
    download_logs,
    get_system_info,
    get_filtered_logs,
    clear_logs,
    get_variable_config
)
from core.logger import options_logger as logger
from core.db.ups import db, VariableConfig
from core.settings import LOG, LOG_LEVEL, LOG_WERKZEUG
from core.mail import test_notification, get_mail_config_model
import subprocess

# Blueprint for /api/options routes
api_options = Blueprint('api_options', __name__, url_prefix='/api/options')

# Blueprint for backward compatibility routes
api_options_compat = Blueprint('api_options_compat', __name__)

@api_options.route('/database/stats', methods=['GET'])
def get_db_stats():
    """API endpoint to get database statistics"""
    stats = get_database_stats()
    if stats:
        return jsonify(stats)
    return jsonify({'error': 'Could not get database statistics'}), 500

@api_options.route('/database/backup', methods=['POST'])
def create_backup():
    """API endpoint to create database backup"""
    backup_path = backup_database()
    if backup_path:
        return jsonify({'success': True, 'backup_path': backup_path})
    return jsonify({'error': 'Failed to create backup'}), 500

@api_options.route('/database/optimize', methods=['POST'])
def optimize_db():
    """API endpoint to optimize database"""
    success = optimize_database()
    if success:
        return jsonify({'success': True, 'message': 'Database optimized successfully'})
    return jsonify({'error': 'Failed to optimize database'}), 500

@api_options.route('/database/vacuum', methods=['POST'])
def vacuum_db():
    """API endpoint to vacuum database"""
    success = vacuum_database()
    if success:
        return jsonify({'success': True, 'message': 'Database vacuumed successfully'})
    return jsonify({'error': 'Failed to vacuum database'}), 500

@api_options.route('/logs', methods=['GET'])
def api_get_logs():
    """API endpoint to get logs with filtering"""
    log_type = request.args.get('type', 'all')
    log_level = request.args.get('level', 'all')
    date_range = request.args.get('date_range', 'all')
    try:
        page = int(request.args.get('page', '1'))
    except ValueError:
        page = 1
    try:
        page_size = int(request.args.get('page_size', '1000'))
    except ValueError:
        page_size = 1000
        
    logs = get_filtered_logs(
        log_type=log_type, 
        log_level=log_level, 
        date_range=date_range,
        page=page,
        page_size=page_size
    )
    
    return jsonify(logs)

@api_options.route('/logs/download', methods=['GET'])
def api_download_logs():
    """API endpoint to download logs zip"""
    log_type = request.args.get('type', 'all')
    log_level = request.args.get('level', 'all')
    date_range = request.args.get('date_range', 'all')
    
    zip_path = download_logs(log_type, log_level, date_range)
    
    if zip_path:
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        return send_file(
            zip_path,
            as_attachment=True,
            download_name=f'logs_{timestamp}.zip',
            mimetype='application/zip'
        )
    
    return jsonify({'error': 'No logs to download'}), 404

@api_options.route('/logs/clear/<log_type>', methods=['DELETE'])
def api_clear_logs(log_type):
    """API endpoint to clear logs"""
    success, message = clear_logs(log_type)
    if success:
        return jsonify({'success': True, 'message': message})
    return jsonify({'error': message}), 500

@api_options.route('/system', methods=['GET'])
def api_system_info():
    """API endpoint to get system info"""
    info = get_system_info()
    if info:
        return jsonify(info)
    return jsonify({'error': 'Could not get system information'}), 500

@api_options.route('/variable-config', methods=['GET'])
def api_variable_config():
    """API endpoint to get variable configuration"""
    logger.info("GET request for variable configuration")
    
    # Fetch directly from the database to avoid any caching issues
    try:
        from core.db.ups import VariableConfig
        config_from_db = VariableConfig.query.first()
        if config_from_db:
            logger.info(f"Found configuration in DB: polling_interval={config_from_db.polling_interval}")
            response = jsonify({
                'currency': config_from_db.currency,
                'price_per_kwh': float(config_from_db.price_per_kwh),
                'co2_factor': float(config_from_db.co2_factor),
                'polling_interval': int(config_from_db.polling_interval)
            })
        else:
            logger.warning("No configuration found in database, using get_variable_config()")
            config = get_variable_config()
            response = jsonify(config)
            
        # Set no-cache headers
        response.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
        response.headers['Pragma'] = 'no-cache'
        response.headers['Expires'] = '0'
        return response
    except Exception as e:
        logger.error(f"Error in variable-config endpoint: {str(e)}")
        config = get_variable_config()  # This now returns default values on error
        if config:
            return jsonify(config)
        return jsonify({'error': 'Could not get variable configuration'}), 500

# Routes moved from core/routes.py
# These routes are kept at their original paths for backward compatibility

@api_options_compat.route('/api/database/stats', methods=['GET'])
def api_database_stats():
    """Return database statistics"""
    stats = get_database_stats()
    if stats is None:
        return jsonify({'success': False, 'error': 'Could not retrieve database statistics'}), 500
    return jsonify({'success': True, 'data': stats})

@api_options_compat.route('/api/logs', methods=['GET'])
def handle_get_logs():
    """Handle log retrieval API"""
    log_type = request.args.get('type', 'all')
    log_level = request.args.get('level', 'all')
    date_range = request.args.get('range', 'all')
    
    # Pagination parameters
    try:
        page = int(request.args.get('page', '1'))
        page_size = int(request.args.get('page_size', '1000'))
        metadata_only = request.args.get('metadata_only', 'false').lower() == 'true'
    except ValueError:
        page = 1
        page_size = 1000
        metadata_only = False
    
    # Limit the page size to avoid memory issues
    page_size = min(page_size, 5000)
    
    logs = get_filtered_logs(
        log_type=log_type, 
        log_level=log_level, 
        date_range=date_range,
        page=page,
        page_size=page_size,
        return_metadata_only=metadata_only
    )
    
    return jsonify({'success': True, 'data': logs})

@api_options_compat.route('/api/logs/clear', methods=['POST'])
def handle_clear_logs():
    """Handle log clearing API"""
    log_type = request.args.get('type', 'all')
    success, message = clear_logs(log_type)
    return jsonify({'success': success, 'message': message})

@api_options_compat.route('/api/system/info', methods=['GET'])
def api_system_info_compat():
    """Return system and project information"""
    info = get_system_info()
    if info is None:
        return jsonify({'success': False, 'error': 'Could not retrieve system info'}), 500
    return jsonify({'success': True, 'data': info})

@api_options_compat.route('/api/about/image', methods=['GET'])
def get_about_image():
    """Return the base64 encoded about image"""
    try:
        image_path = os.path.join(current_app.static_folder, 'img', 'about_png')
        if not os.path.exists(image_path):
            return jsonify({'success': False, 'error': 'Image not found'}), 404

        # Read the base64 content and add MIME type prefix if needed
        with open(image_path, 'r') as f:
            content = f.read().strip()
            if not content.startswith('data:'):
                content = 'data:image/png;base64,' + content
            return jsonify({
                'success': True,
                'data': content
            })

    except Exception as e:
        logger.error(f"Error getting about image: {str(e)}")
        return jsonify({
            'success': False, 
            'error': f'Error getting about image: {str(e)}'
        }), 500

@api_options_compat.route('/api/database/optimize', methods=['POST'])
def api_optimize_database():
    """Optimize database tables"""
    success = optimize_database()
    if success:
        return jsonify(success=True, message="Database optimized successfully")
    else:
        return jsonify(success=False, message="Error optimizing database"), 500

@api_options_compat.route('/api/database/vacuum', methods=['POST'])
def api_vacuum_database():
    """Vacuum database to reclaim space"""
    success = vacuum_database()
    if success:
        return jsonify(success=True, message="Database vacuumed successfully")
    else:
        return jsonify(success=False, message="Error vacuuming database"), 500

@api_options_compat.route('/api/database/backup', methods=['GET'])
def api_backup_database():
    """Create and download a backup of the database"""
    backup_path = backup_database()
    if backup_path:
        return send_file(backup_path,
                        mimetype="application/octet-stream",
                        as_attachment=True,
                        download_name=os.path.basename(backup_path))
    else:
        return jsonify(success=False, message="Error creating database backup"), 500

@api_options_compat.route('/api/settings/variables', methods=['GET'])
def get_variables_settings():
    """API endpoint to get variable configuration settings"""
    try:
        logger.info("GET request for variables configuration")
        
        # First, check if database is initialized
        if not db:
            logger.error("Database not initialized")
            return jsonify({'success': False, 'error': 'Database configuration error'}), 500
            
        # Use ModelClasses.VariableConfig if available, otherwise use imported VariableConfig
        model_class = None
        if hasattr(db, 'ModelClasses') and hasattr(db.ModelClasses, 'VariableConfig'):
            model_class = db.ModelClasses.VariableConfig
            logger.info("Using VariableConfig from ModelClasses")
        elif hasattr(VariableConfig, 'query'):
            model_class = VariableConfig
            logger.info("Using directly imported VariableConfig")
        else:
            logger.error("No usable VariableConfig model found")
            return jsonify({'success': False, 'error': 'Database configuration error'}), 500
        
        try:
            # Get existing configuration
            config = model_class.query.first()
            if config:
                logger.info(f"Found configuration: currency={config.currency}, price_per_kwh={config.price_per_kwh}, co2_factor={config.co2_factor}")
                return jsonify({
                    'success': True,
                    'data': {
                        'currency': config.currency,
                        'price_per_kwh': float(config.price_per_kwh),
                        'co2_factor': float(config.co2_factor)
                    }
                })
            else:
                logger.error("No configuration found in database")
                return jsonify({'success': False, 'error': 'No configuration found in database'}), 500
        except Exception as db_error:
            logger.error(f"Database error: {str(db_error)}")
            return jsonify({'success': False, 'error': 'Database configuration error'}), 500
    except Exception as e:
        logger.error(f"Error getting variables config: {str(e)}")
        return jsonify({'success': False, 'error': 'Database configuration error'}), 500

@api_options_compat.route('/api/settings/variables', methods=['POST'])
def save_variables_config():
    """API endpoint to save variable configuration settings"""
    try:
        # First, check if database is initialized
        if not db:
            logger.error("Database not initialized")
            return jsonify({'success': False, 'error': 'Database configuration error'}), 500
            
        # Use ModelClasses.VariableConfig if available, otherwise use imported VariableConfig
        model_class = None
        if hasattr(db, 'ModelClasses') and hasattr(db.ModelClasses, 'VariableConfig'):
            model_class = db.ModelClasses.VariableConfig
            logger.info("Using VariableConfig from ModelClasses")
        elif hasattr(VariableConfig, 'query'):
            model_class = VariableConfig
            logger.info("Using directly imported VariableConfig")
        else:
            logger.error("No usable VariableConfig model found")
            return jsonify({'success': False, 'error': 'Database configuration error'}), 500
            
        data = request.get_json()
        if not data:
            logger.warning("No data provided in request")
            return jsonify({'success': False, 'error': 'No data provided'}), 400

        logger.info(f"Received data: {data}")
        
        # Validate required fields
        required_fields = ['currency', 'price_per_kwh', 'co2_factor']
        for field in required_fields:
            if field not in data:
                logger.warning(f"Missing required field: {field}")
                return jsonify({'success': False, 'error': f'Missing required field: {field}'}), 400
        
        try:
            # Get existing configuration or create a new one
            config = model_class.query.first()
            if not config:
                logger.info("No existing configuration found, creating new")
                config = model_class()
                db.session.add(config)
            
            # Update fields
            config.currency = data['currency']
            config.price_per_kwh = float(data['price_per_kwh'])
            config.co2_factor = float(data['co2_factor'])
            
            # Try to commit changes
            db.session.commit()
            logger.info(f"Configuration saved successfully: {data}")
            
            return jsonify({
                'success': True,
                'message': 'Variable configuration saved successfully'
            })
        except Exception as db_error:
            # Rollback on database error
            db.session.rollback()
            logger.error(f"Database error: {str(db_error)}")
            return jsonify({'success': False, 'error': 'Failed to save'}), 500
            
    except Exception as e:
        # Rollback if session exists
        if db and hasattr(db, 'session'):
            db.session.rollback()
        
        logger.error(f"Error saving variables config: {str(e)}")
        return jsonify({'success': False, 'error': 'Failed to save'}), 500

@api_options_compat.route('/api/settings/polling-interval', methods=['POST'])
def update_polling_interval():
    """API endpoint to update polling interval and restart application"""
    try:
        # Check if database is initialized
        if not db:
            logger.error("Database not initialized")
            return jsonify({'success': False, 'error': 'Database configuration error'}), 500
            
        # Use ModelClasses.VariableConfig if available, otherwise use imported VariableConfig
        model_class = None
        if hasattr(db, 'ModelClasses') and hasattr(db.ModelClasses, 'VariableConfig'):
            model_class = db.ModelClasses.VariableConfig
            logger.info("Using VariableConfig from ModelClasses")
        elif hasattr(VariableConfig, 'query'):
            model_class = VariableConfig
            logger.info("Using directly imported VariableConfig")
        else:
            logger.error("No usable VariableConfig model found")
            return jsonify({'success': False, 'error': 'Database configuration error'}), 500
            
        data = request.get_json()
        if not data or 'polling_interval' not in data:
            logger.warning("No polling_interval provided in request")
            return jsonify({'success': False, 'error': 'No polling_interval provided'}), 400

        polling_interval = int(data['polling_interval'])
        update_both = data.get('update_both', False)
        
        # Validate polling interval (1-60 seconds)
        if polling_interval < 1 or polling_interval > 60:
            logger.warning(f"Invalid polling interval: {polling_interval}. Must be between 1 and 60 seconds.")
            return jsonify({'success': False, 'error': 'Polling interval must be between 1 and 60 seconds'}), 400
        
        try:
            # Get existing configuration or create a new one
            config = model_class.query.first()
            if not config:
                logger.info("No existing configuration found, creating new")
                config = model_class()
                db.session.add(config)
            
            # Update polling interval in database
            config.polling_interval = polling_interval
            
            # Update pollfreq in /etc/nut/ups.conf
            try:
                # Path to the UPS configuration file
                ups_conf_path = '/etc/nut/ups.conf'
                
                # Check if file exists and is accessible
                if os.path.exists(ups_conf_path):
                    # Update pollfreq
                    pollfreq_cmd = [
                        'sed', '-i', 
                        f's/pollfreq\s*=\s*[0-9]\+/pollfreq = {polling_interval}/g', 
                        ups_conf_path
                    ]
                    
                    # Execute the command with error handling
                    process = subprocess.run(pollfreq_cmd, capture_output=True, text=True)
                    
                    if process.returncode == 0:
                        logger.info(f"Updated pollfreq in {ups_conf_path} to {polling_interval}")
                    else:
                        logger.error(f"Failed to update pollfreq in UPS config file: {process.stderr}")
                    
                    # If update_both flag is set, also update pollinterval
                    if update_both:
                        pollinterval_cmd = [
                            'sed', '-i',
                            f's/pollinterval\s*=\s*[0-9]\+/pollinterval = {polling_interval}/g',
                            ups_conf_path
                        ]
                        
                        # Check if pollinterval exists, if not add it
                        check_cmd = ['grep', '-q', 'pollinterval', ups_conf_path]
                        check_process = subprocess.run(check_cmd, capture_output=True, text=True)
                        
                        if check_process.returncode == 0:
                            # pollinterval exists, update it
                            pi_process = subprocess.run(pollinterval_cmd, capture_output=True, text=True)
                            if pi_process.returncode == 0:
                                logger.info(f"Updated pollinterval in {ups_conf_path} to {polling_interval}")
                            else:
                                logger.error(f"Failed to update pollinterval in UPS config file: {pi_process.stderr}")
                        else:
                            # pollinterval doesn't exist, add it after pollfreq
                            add_cmd = [
                                'sed', '-i',
                                f'/pollfreq/a \\\tpollinterval = {polling_interval}',
                                ups_conf_path
                            ]
                            add_process = subprocess.run(add_cmd, capture_output=True, text=True)
                            if add_process.returncode == 0:
                                logger.info(f"Added pollinterval to {ups_conf_path} with value {polling_interval}")
                            else:
                                logger.error(f"Failed to add pollinterval to UPS config file: {add_process.stderr}")
                else:
                    logger.warning(f"UPS config file {ups_conf_path} not found or not accessible")
            except Exception as ups_error:
                logger.error(f"Failed to update UPS config file: {str(ups_error)}")
                # Continue with database update even if UPS config update fails
            
            # Try to commit changes to database
            db.session.commit()
            logger.info(f"Polling interval updated to {polling_interval} seconds")
            
            return jsonify({
                'success': True,
                'message': 'Polling interval updated successfully. Application restart required for changes to take effect.'
            })
        except Exception as db_error:
            # Rollback on database error
            db.session.rollback()
            logger.error(f"Database error: {str(db_error)}")
            return jsonify({'success': False, 'error': 'Failed to save polling interval'}), 500
            
    except Exception as e:
        # Rollback if session exists
        if db and hasattr(db, 'session'):
            db.session.rollback()
        
        logger.error(f"Error updating polling interval: {str(e)}")
        return jsonify({'success': False, 'error': 'Failed to update polling interval'}), 500

@api_options_compat.route('/api/restart', methods=['POST'])
def restart_application():
    """
    Restart the application.
    Note: This endpoint works only in development mode.
    """
    try:
        logger.info("Restarting application...")
        # The following will replace the current process with a new one.
        os.execv(sys.executable, [sys.executable] + sys.argv)
    except Exception as e:
        return jsonify(success=False, message=str(e)), 500

@api_options_compat.route('/api/settings/log', methods=['GET', 'POST'])
def update_log_setting():
    """Update and retrieve log settings"""
    if request.method == 'GET':
        # Add log for debug
        logger.debug(f"Reading settings - RAW values: LOG={LOG!r}, LOG_LEVEL={LOG_LEVEL!r}, LOG_WERKZEUG={LOG_WERKZEUG!r}")
        log_enabled = str(LOG).strip().lower() == 'true'
        werkzeug_enabled = str(LOG_WERKZEUG).strip().lower() == 'true'
        logger.debug(f"Processed values: log_enabled={log_enabled}, level={LOG_LEVEL}, werkzeug={werkzeug_enabled}")
        
        return jsonify({
            'success': True,
            'data': {
                'log': log_enabled,
                'level': LOG_LEVEL,
                'werkzeug': werkzeug_enabled
            }
        })

    data = request.get_json()
    # If the data is empty or does not contain 'log', return the current state instead of an error
    if not data or len(data) == 0 or 'log' not in data:
        # Return the same response format as the GET method
        log_enabled = str(LOG).strip().lower() == 'true'
        werkzeug_enabled = str(LOG_WERKZEUG).strip().lower() == 'true'
        logger.debug(f"POST with empty data - Returning current settings: log={log_enabled}, level={LOG_LEVEL}, werkzeug={werkzeug_enabled}")
        
        return jsonify({
            'success': True,
            'data': {
                'log': log_enabled,
                'level': LOG_LEVEL,
                'werkzeug': werkzeug_enabled
            }
        })
    
    # Normalize 'log'
    new_value = str(data['log']).lower()
    if new_value not in ['true', 'false']:
        return jsonify(success=False, message="Invalid value for 'log' (must be true or false)"), 400
    
    # Normalize 'werkzeug'
    new_werkzeug = None
    if 'werkzeug' in data:
        new_werkzeug = str(data['werkzeug']).lower()
        if new_werkzeug not in ['true', 'false']:
            return jsonify(success=False, message="Invalid value for 'werkzeug' (must be true or false)"), 400
    
    new_level = None
    if 'level' in data:
        new_level = str(data['level']).upper()
        if new_level not in ['DEBUG', 'INFO', 'WARNING', 'ERROR', 'CRITICAL']:
            return jsonify(success=False, message="Invalid log level (must be DEBUG, INFO, WARNING, ERROR, or CRITICAL)"), 400

    try:
        settings_path = os.path.join(current_app.root_path, 'config', 'settings.txt')
        with open(settings_path, 'r') as f:
            lines = f.readlines()
        new_lines = []
        pattern_log = r"^LOG\s*="
        pattern_level = r"^LOG_LEVEL\s*="
        pattern_werkzeug = r"^LOG_WERKZEUG\s*="
        updated_log = False
        updated_level = False
        updated_werkzeug = False
        for line in lines:
            if re.match(pattern_log, line):
                new_lines.append(f"LOG = {new_value}\n")
                updated_log = True
            elif new_level and re.match(pattern_level, line):
                new_lines.append(f"LOG_LEVEL = {new_level}\n")
                updated_level = True
            elif new_werkzeug and re.match(pattern_werkzeug, line):
                new_lines.append(f"LOG_WERKZEUG = {new_werkzeug}\n")
                updated_werkzeug = True
            else:
                new_lines.append(line)
        if not updated_log:
            new_lines.append(f"LOG = {new_value}\n")
        if new_level and (not updated_level):
            new_lines.append(f"LOG_LEVEL = {new_level}\n")
        if new_werkzeug and (not updated_werkzeug):
            new_lines.append(f"LOG_WERKZEUG = {new_werkzeug}\n")
        with open(settings_path, 'w') as f:
            f.writelines(new_lines)
        return jsonify(success=True, message="Log setting updated. Please restart the application for changes to take effect."), 200
    except Exception as e:
        return jsonify(success=False, message=str(e)), 500

@api_options_compat.route('/api/logs/download', methods=['GET'])
def download_logs():
    """
    Download filtered log files as a zip archive.
    Query parameters:
      - type: log type (default 'all')
      - level: log level (default 'all')
      - range: date range (default 'all')
    """
    log_type = request.args.get('type', 'all')
    log_level = request.args.get('level', 'all')
    date_range = request.args.get('range', 'all')
    
    # Get the log file metadata (without content)
    logs_data = get_filtered_logs(
        log_type=log_type, 
        log_level=log_level, 
        date_range=date_range,
        return_metadata_only=True
    )
    
    if not logs_data or not logs_data['files']:
        return jsonify(success=False, message="No logs found"), 404
    
    tmp_zip = tempfile.NamedTemporaryFile(delete=False, suffix='.zip')
    try:
        with zipfile.ZipFile(tmp_zip, 'w') as zf:
            for log_file in logs_data['files']:
                file_path = log_file['path']
                try:
                    # Read the file content and filter by level if necessary
                    with open(file_path, 'r') as f:
                        content = f.read()
                        
                    # Filter by log level if specified
                    if log_level != 'all':
                        filtered_lines = []
                        for line in content.splitlines():
                            if re.search(f"\\b{log_level.upper()}\\b", line, re.I):
                                filtered_lines.append(line)
                        content = '\n'.join(filtered_lines)
                    
                    zf.writestr(log_file['name'], content)
                except Exception as e:
                    logger.error(f"Error adding log file {file_path} to zip: {str(e)}")
                    continue
        
        # Generate a file name with timestamp
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        download_name = f'logs_{timestamp}.zip'
        
        return send_file(tmp_zip.name,
                         mimetype='application/zip',
                         as_attachment=True,
                         download_name=download_name)
    except Exception as e:
        logger.error(f"Error creating log zip file: {str(e)}")
        return jsonify(success=False, message=f"Error creating zip file: {str(e)}"), 500

@api_options_compat.route('/api/settings/test-notification', methods=['POST'])
def test_email_notification():
    """
    API endpoint to test email notifications for a specific event type
    Expects query parameters:
        - event_type: Type of event to test (e.g., 'ONLINE', 'ONBATT', etc.)
        - id_email: ID of the email configuration to use
    Returns:
        - JSON response with success status and message
    """
    try:
        # Get parameters from query string
        event_type = request.args.get('event_type')
        id_email = request.args.get('id_email')
        
        # Validate parameters
        if not event_type:
            logger.error("Missing required parameter: event_type")
            return jsonify({
                'success': False,
                'message': 'Missing required parameter: event_type'
            }), 400
            
        if not id_email:
            logger.error("Missing required parameter: id_email")
            return jsonify({
                'success': False,
                'message': 'Missing required parameter: id_email'
            }), 400
        
        # Try to convert id_email to integer
        try:
            id_email = int(id_email)
        except ValueError:
            logger.error(f"Invalid id_email: {id_email}, must be an integer")
            return jsonify({
                'success': False,
                'message': 'Invalid id_email: must be an integer'
            }), 400
        
        # Verify that the email configuration exists
        MailConfig = get_mail_config_model()
        if not MailConfig:
            logger.error("MailConfig model not available")
            return jsonify({
                'success': False,
                'message': 'Email configuration system not available'
            }), 500
            
        mail_config = MailConfig.query.get(id_email)
        if not mail_config:
            logger.error(f"Email configuration with ID {id_email} not found")
            return jsonify({
                'success': False,
                'message': f'Email configuration with ID {id_email} not found'
            }), 404
        
        # Prepare test data
        test_data = {
            'id_email': id_email,
            'is_test': True,
            'to_email': mail_config.to_email or mail_config.username
        }
        
        # Call test_notification function
        logger.info(f"Testing notification for event type {event_type} with email config {id_email}")
        success, message = test_notification(event_type, test_data)
        
        return jsonify({
            'success': success,
            'message': message
        })
        
    except Exception as e:
        logger.error(f"Error testing notification: {str(e)}", exc_info=True)
        return jsonify({
            'success': False,
            'message': f'Error testing notification: {str(e)}'
        }), 500 