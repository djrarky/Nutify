#!/usr/bin/env python3
"""
UPS Notifier Script

This script is designed to be called directly by upsmon.conf via the NOTIFYCMD directive.
It replaces the previous notifier.sh + socket communication approach with direct integration.

Usage:
  Called by upsmon with the UPS name and event type:
  /app/nutify/core/events/ups_notifier.py ups@hostname ONBATT
  - or -
  /app/nutify/core/events/ups_notifier.py "UPS ups@localhost on battery"

The script will:
1. Parse the input to determine UPS name and event type
2. Check database for enabled notifications for this event type
3. Send email notifications using the appropriate templates
4. Store the event in the database
5. Update the UI via event recording
"""

import os
import sys
import re
import logging
import datetime
import traceback
from pathlib import Path
import platform
import pytz
import sqlite3
import jinja2
from sqlalchemy import text, inspect
import json

# Add the application directory to sys.path to allow imports
APP_DIR = str(Path(__file__).resolve().parent.parent.parent)
if APP_DIR not in sys.path:
    sys.path.append(APP_DIR)

# Import the existing email system
from core import create_app
from core.mail.mail import EmailNotifier
from core.db.ups import db, UPSEvent
from core.logger import mail_logger as logger, database_logger

# Import ntfy notification system
try:
    from core.extranotifs.ntfy import NtfyNotifier
    from core.extranotifs.ntfy.db import get_ntfy_model, get_default_config
    HAS_NTFY = True
except ImportError:
    logger.warning("Ntfy notification module not available")
    HAS_NTFY = False

# Import webhook notification system
try:
    from core.extranotifs.webhook import WebhookNotifier
    from core.extranotifs.webhook.webhook import send_event_notification as send_webhook_notification
    HAS_WEBHOOK = True
except ImportError:
    logger.warning("Webhook notification module not available")
    HAS_WEBHOOK = False

from core.db.ups.models import get_ups_model, get_static_model
from core.db.orm.orm_ups_events import init_model as init_event_model
from core.db.orm.orm_ups_opt_notification import init_model as init_notification_model
from core.db.ups.utils import get_configured_timezone
from core.db.model_classes import init_model_classes, register_models_for_global_access
from core.mail import get_mail_config_model, get_notification_settings_model
from core.settings import UPS_HOST

# Initialize Flask app
app = create_app()

# Set template path for this script
app.template_folder = os.path.join(APP_DIR, 'templates')

# Initialize models in app context
with app.app_context():
    # Initialize model classes
    model_classes = init_model_classes(db, get_configured_timezone)
    db.ModelClasses = model_classes
    
    # Register models for global access
    register_models_for_global_access(model_classes, db)
    
    # Use existing models instead of initializing new ones
    # This prevents duplicate model registration warnings
    UPSEventModel = db.ModelClasses.UPSEvent
    NotificationSettingsModel = db.ModelClasses.NotificationSettings
    NtfyConfigModel = db.ModelClasses.NtfyConfig if hasattr(db.ModelClasses, 'NtfyConfig') else None
    
    # Get mail models
    MailConfigModel = model_classes.MailConfig

# Check if running on macOS for development
IS_MACOS = platform.system() == "Darwin"

# Configure logging paths based on environment
if IS_MACOS:
    # Use /tmp for logs on macOS
    LOG_FILE = "/tmp/nut-notifier.log"
    DEBUG_LOG = "/tmp/nut-debug.log"
else:
    # Use standard paths in production environment
    LOG_FILE = "/var/log/nut/notifier.log"
    DEBUG_LOG = "/var/log/nut-debug.log"

# Create log directory if it doesn't exist (for non-macOS)
if not IS_MACOS and not os.path.exists(os.path.dirname(LOG_FILE)):
    os.makedirs(os.path.dirname(LOG_FILE), exist_ok=True)

# Setup basic logging
logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)

# Setup file handlers
file_handler = logging.FileHandler(LOG_FILE)
debug_handler = logging.FileHandler(DEBUG_LOG)

# Create logger
logger = logging.getLogger("ups_notifier")
logger.addHandler(file_handler)
logger.addHandler(debug_handler)

def log_message(message, is_debug=False):
    """Log a message to both log files"""
    if is_debug:
        logger.debug(message)
    else:
        logger.info(message)
    
    # Ensure it's written to disk immediately
    for handler in logger.handlers:
        handler.flush()
    
    # Also write to a separate dedicated notifier log file for better debugging
    try:
        with open("/var/log/nut/notifier.log", "a") as f:
            timestamp = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            f.write(f"[{timestamp}] {message}\n")
            f.flush()
    except Exception as e:
        # Don't fail if we can't write to this file
        pass

# Database path
DB_PATH = os.path.join(APP_DIR, "instance", "nutify.db.sqlite")

def parse_input_args(args):
    """
    Parse the input arguments from upsmon.
    
    Args:
        args (list): Command-line arguments
        
    Returns:
        tuple: (ups_name, event_type)
    """
    log_message(f"DEBUG: Script started with args: {args}", True)
    
    if len(args) < 1:
        log_message("ERROR: No arguments provided")
        return None, None
    
    # First argument could be in format "UPS ups@localhost on battery"
    if len(args) == 1 and args[0].startswith("UPS "):
        log_message(f"DEBUG: Detected alternative format: {args[0]}", True)
        
        # Handle different message formats with regex patterns
        on_battery_match = re.search(r"^UPS\s+([^\s]+).*on\s+battery", args[0])
        if on_battery_match:
            ups_name = on_battery_match.group(1)
            event_type = "ONBATT"
            log_message(f"DEBUG: Detected on battery event for {ups_name}", True)
            return ups_name, event_type
            
        online_match = re.search(r"^UPS\s+([^\s]+).*on\s+line\s+power", args[0])
        if online_match:
            ups_name = online_match.group(1)
            event_type = "ONLINE"
            log_message(f"DEBUG: Detected online event for {ups_name}", True)
            return ups_name, event_type
            
        # Improved low battery detection pattern
        low_battery_match = re.search(r"^UPS\s+([^\s]+).*low\s+battery", args[0])
        if low_battery_match:
            ups_name = low_battery_match.group(1)
            event_type = "LOWBATT"
            log_message(f"DEBUG: Detected low battery event for {ups_name}", True)
            return ups_name, event_type
            
        comm_ok_match = re.search(r"^UPS\s+([^\s]+).*communication\s+restored", args[0])
        if comm_ok_match:
            ups_name = comm_ok_match.group(1)
            event_type = "COMMOK"
            log_message(f"DEBUG: Detected communication restored event for {ups_name}", True)
            return ups_name, event_type
            
        comm_bad_match = re.search(r"^UPS\s+([^\s]+).*communication\s+lost", args[0])
        if comm_bad_match:
            ups_name = comm_bad_match.group(1)
            event_type = "COMMBAD"
            log_message(f"DEBUG: Detected communication lost event for {ups_name}", True)
            return ups_name, event_type
            
        shutdown_match = re.search(r"^UPS\s+([^\s]+).*forced\s+shutdown", args[0])
        if shutdown_match:
            ups_name = shutdown_match.group(1)
            event_type = "FSD"
            log_message(f"DEBUG: Detected forced shutdown event for {ups_name}", True)
            return ups_name, event_type
            
        replace_battery_match = re.search(r"^UPS\s+([^\s]+).*battery\s+needs\s+replacing", args[0])
        if replace_battery_match:
            ups_name = replace_battery_match.group(1)
            event_type = "REPLBATT"
            log_message(f"DEBUG: Detected replace battery event for {ups_name}", True)
            return ups_name, event_type
            
        shutdown_progress_match = re.search(r"^UPS\s+([^\s]+).*shutdown\s+in\s+progress", args[0])
        if shutdown_progress_match:
            ups_name = shutdown_progress_match.group(1)
            event_type = "SHUTDOWN"
            log_message(f"DEBUG: Detected shutdown in progress event for {ups_name}", True)
            return ups_name, event_type
            
        # Add support for NOCOMM format
        nocomm_match = re.search(r"^UPS\s+([^\s]+).*no\s+communication", args[0])
        if nocomm_match:
            ups_name = nocomm_match.group(1)
            event_type = "NOCOMM"
            log_message(f"DEBUG: Detected no communication event for {ups_name}", True)
            return ups_name, event_type
            
        # Add support for NOPARENT format
        noparent_match = re.search(r"^UPS\s+([^\s]+).*parent\s+process", args[0])
        if noparent_match:
            ups_name = noparent_match.group(1)
            event_type = "NOPARENT"
            log_message(f"DEBUG: Detected parent process event for {ups_name}", True)
            return ups_name, event_type
            
        # If no specific pattern matched, log error
        log_message(f"ERROR: Unrecognized event format: {args[0]}")
        return None, None
    
    # Standard format: ups@hostname EVENT_TYPE
    elif len(args) >= 2:
        ups_name = args[0]
        event_type = args[1]
        log_message(f"DEBUG: Detected standard format: {ups_name} {event_type}", True)
        return ups_name, event_type
    
    # Not enough arguments
    log_message("ERROR: Invalid arguments provided")
    return None, None

def get_enabled_notifications(event_type):
    """
    Check which notifications are enabled for this event type
    
    Args:
        event_type: Type of event (ONLINE, ONBATT, etc.)
        
    Returns:
        list: List of notification objects with their type and configuration
    """
    try:
        # Use ORM model to query enabled notifications
        notifications = NotificationSettingsModel.query.filter_by(
            enabled=True,
            event_type=event_type.upper()
        ).all()
        
        # Convert notifications to list of dictionaries with type and config
        result = []
        for notification in notifications:
            if notification.id_email is not None:
                result.append({
                    'type': 'email',
                    'config_id': notification.id_email
                })
        
        if not result:
            log_message(f"DEBUG: No enabled notifications found for {event_type}", True)
            return []
            
        return result
    except Exception as e:
        log_message(f"ERROR: Failed to get enabled notifications: {str(e)}")
        return []

def get_ups_info(ups_name):
    """
    Get UPS information from database
    
    Args:
        ups_name: Name of the UPS
        
    Returns:
        dict: UPS information or default values on error
    """
    try:
        log_message(f"DEBUG: Starting get_ups_info for {ups_name}", True)
        
        # Default UPS info with safe values
        ups_info = {
            'ups_model': 'Unknown UPS',
            'device_serial': 'Unknown',
            'ups_status': 'Unknown',
            'battery_charge': '0%',
            'runtime_estimate': '0 min',
            'input_voltage': '0V',
            'battery_voltage': '0V',
            'ups_host': ups_name,
            'battery_voltage_nominal': '0V',
            'battery_type': 'Unknown',
            'ups_timer_shutdown': '0',
            'comm_duration': '0 min',
            'battery_duration': '0 min',
            'battery_age': 'Unknown',
            'battery_efficiency': '0%'
        }
        
        # Get current date and time for the event
        now = datetime.datetime.now()
        local_tz = get_configured_timezone()
        if local_tz:
            now = now.astimezone(local_tz)
        
        # Format date and time for the template
        ups_info['event_date'] = now.strftime('%Y-%m-%d')
        ups_info['event_time'] = now.strftime('%H:%M:%S')
        
        # Use ORM with dynamic SQL approach for maximum flexibility
        with app.app_context():
            try:
                # Get data using dynamic SQL through ORM
                log_message("DEBUG: Querying UPS data using dynamic ORM query", True)
                
                # First check if tables exist
                tables = inspect(db.engine).get_table_names()
                log_message(f"DEBUG: Available tables in database: {tables}", True)
                
                if 'ups_static_data' in tables:
                    # Execute raw SQL through SQLAlchemy ORM for static data
                    result = db.session.execute(text("SELECT * FROM ups_static_data LIMIT 1"))
                    columns = result.keys()
                    log_message(f"DEBUG: Static data columns available: {columns}", True)
                    
                    row = result.fetchone()
                    if row:
                        # Convert row to dictionary
                        static_data = {column: value for column, value in zip(columns, row)}
                        log_message(f"DEBUG: Static data retrieved: {static_data}", True)
                        
                        # Key fields we're interested in
                        for field in ['device_model', 'device_serial', 'battery_type', 'ups_model']:
                            if field in static_data and static_data[field] is not None:
                                ups_info[field] = str(static_data[field])
                                log_message(f"DEBUG: Set static value {field} = {ups_info[field]}", True)
                
                if 'ups_dynamic_data' in tables:
                    # Execute raw SQL through SQLAlchemy ORM for dynamic data
                    result = db.session.execute(text("SELECT * FROM ups_dynamic_data ORDER BY timestamp_tz DESC LIMIT 1"))
                    columns = result.keys()
                    log_message(f"DEBUG: Dynamic data columns available: {columns}", True)
                    
                    row = result.fetchone()
                    if row:
                        # Convert row to dictionary
                        dynamic_data = {column: value for column, value in zip(columns, row)}
                        log_message(f"DEBUG: Dynamic data retrieved: {dynamic_data}", True)
                        
                        # Handle ups_status
                        if 'ups_status' in dynamic_data and dynamic_data['ups_status'] is not None:
                            ups_info['ups_status'] = str(dynamic_data['ups_status'])
                            log_message(f"DEBUG: Set dynamic value ups_status = {ups_info['ups_status']}", True)
                        
                        # Handle battery_charge
                        if 'battery_charge' in dynamic_data and dynamic_data['battery_charge'] is not None:
                            charge = str(dynamic_data['battery_charge'])
                            if not charge.endswith('%'):
                                charge = f"{charge}%"
                            ups_info['battery_charge'] = charge
                            log_message(f"DEBUG: Set dynamic value battery_charge = {ups_info['battery_charge']}", True)
                        
                        # Handle battery_runtime
                        if 'battery_runtime' in dynamic_data and dynamic_data['battery_runtime'] is not None:
                            runtime = str(dynamic_data['battery_runtime'])
                            if runtime.isdigit():
                                runtime_min = int(runtime) // 60
                                ups_info['runtime_estimate'] = f"{runtime_min} min"
                                log_message(f"DEBUG: Set dynamic value runtime_estimate = {ups_info['runtime_estimate']}", True)
                        
                        # Handle other voltage metrics with proper units
                        for field, suffix in [
                            ('input_voltage', 'V'),
                            ('battery_voltage', 'V'),
                            ('battery_voltage_nominal', 'V')
                        ]:
                            if field in dynamic_data and dynamic_data[field] is not None:
                                value = str(dynamic_data[field])
                                if not value.endswith(suffix):
                                    value = f"{value}{suffix}"
                                ups_info[field] = value
                                log_message(f"DEBUG: Set dynamic value {field} = {ups_info[field]}", True)
                        
                        # Handle ups_timer_shutdown
                        if 'ups_timer_shutdown' in dynamic_data and dynamic_data['ups_timer_shutdown'] is not None:
                            ups_info['ups_timer_shutdown'] = str(dynamic_data['ups_timer_shutdown'])
                            log_message(f"DEBUG: Set dynamic value ups_timer_shutdown = {ups_info['ups_timer_shutdown']}", True)
            except Exception as e:
                log_message(f"WARNING: Dynamic ORM query failed: {e}", True)
                log_message(f"TRACEBACK: {traceback.format_exc()}", True)
        
        log_message(f"DEBUG: Final UPS info: {ups_info}", True)
        return ups_info
    
    except Exception as e:
        log_message(f"ERROR: Failed to get UPS info: {e}")
        log_message(f"TRACEBACK: {traceback.format_exc()}", True)
        
        # Get current date and time even for default values
        now = datetime.datetime.now()
        local_tz = get_configured_timezone()
        if local_tz:
            now = now.astimezone(local_tz)
            
        return {
            'ups_model': 'Unknown UPS',
            'device_serial': 'Unknown',
            'ups_status': 'Unknown',
            'battery_charge': '0%',
            'runtime_estimate': '0 min',
            'input_voltage': '0V',
            'battery_voltage': '0V',
            'ups_host': ups_name,
            'battery_voltage_nominal': '0V',
            'battery_type': 'Unknown',
            'ups_timer_shutdown': '0',
            'comm_duration': '0 min',
            'battery_duration': '0 min',
            'battery_age': 'Unknown',
            'battery_efficiency': '0%',
            'event_date': now.strftime('%Y-%m-%d'),
            'event_time': now.strftime('%H:%M:%S')
        }

def get_source_ip():
    """
    Get the IP address of the UPS from settings.
    
    Returns:
        str: UPS IP address as configured in settings
    """
    try:
        # Use UPS_HOST from settings.txt
        return UPS_HOST
    except Exception as e:
        log_message(f"ERROR: Failed to get source IP from settings: {e}", True)
        return None

def close_previous_events(ups_name, current_time):
    """
    Close any open events for the specified UPS by setting their end timestamp.
    
    Args:
        ups_name: Name of the UPS
        current_time: Current timestamp to use as end time
        
    Returns:
        int: Number of events closed
    """
    try:
        # Find open events (where timestamp_tz_end is NULL)
        open_events = UPSEventModel.query.filter_by(
            ups_name=ups_name,
            timestamp_tz_end=None
        ).all()
        
        count = 0
        for event in open_events:
            event.timestamp_tz_end = current_time
            count += 1
            
        if count > 0:
            db.session.commit()
            log_message(f"Closed {count} previous events for {ups_name}")
            
        return count
    except Exception as e:
        log_message(f"ERROR: Failed to close previous events: {e}")
        return 0

def store_event_in_database(ups_name, event_type):
    """
    Store the event in the database
    
    Args:
        ups_name: Name of the UPS
        event_type: Type of event
        
    Returns:
        bool: True if successful, False otherwise
    """
    try:
        now = datetime.datetime.now().replace(microsecond=0)
        
        # Close any previous events for this UPS
        close_previous_events(ups_name, now)
        
        # Get source IP
        source_ip = get_source_ip()
        
        # Create new event using ORM model
        event = UPSEventModel(
            timestamp_tz=now,
            timestamp_tz_begin=now,
            ups_name=ups_name,
            event_type=event_type,
            event_message=f"UPS {ups_name} event: {event_type}",
            source_ip=source_ip,
            acknowledged=False
        )
        
        db.session.add(event)
        db.session.commit()
        
        log_message(f"Stored {event_type} event for {ups_name} in database")
        return True
    
    except Exception as e:
        log_message(f"ERROR: Failed to store event in database: {e}")
        return False

def verify_email_config():
    """Verify that email configuration exists and is valid"""
    try:
        # Get the mail config model
        MailConfigModel = get_mail_config_model()
        if not MailConfigModel:
            logger.error("MailConfig model not available")
            return False
            
        # Check if we have any enabled email configurations
        config = MailConfigModel.query.filter_by(enabled=True).first()
        if not config:
            logger.info("No enabled email configuration found")
            return False
            
        logger.info(f"Email configuration verified: {config.provider} ({config.smtp_server})")
        return True
    except Exception as e:
        logger.error(f"Failed to verify email configuration: {str(e)}")
        return False

def send_email_notification(ups_name, event_type, notification):
    """
    Send an email notification
    
    Args:
        ups_name: Name of the UPS
        event_type: Type of event
        notification: Notification object with type and config_id
    """
    try:
        # Get UPS information
        ups_info = get_ups_info(ups_name)
        
        # Generate email subject based on event type
        event_subjects = {
            'ONLINE': f"✅ Power Restored - {ups_name}",
            'ONBATT': f"⚡ On Battery Power - {ups_name}",
            'LOWBATT': f"⚠️ CRITICAL: Low Battery - {ups_name}",
            'COMMBAD': f"❌ Communication Lost - {ups_name}",
            'COMMOK': f"✅ Communication Restored - {ups_name}",
            'SHUTDOWN': f"⚠️ CRITICAL: System Shutdown - {ups_name}",
            'REPLBATT': f"🔋 Battery Replacement Required - {ups_name}",
            'NOCOMM': f"❌ No Communication - {ups_name}",
            'NOPARENT': f"⚙️ Process Error - {ups_name}",
            'FSD': f"⚠️ CRITICAL: Forced Shutdown - {ups_name}"
        }
        
        subject = event_subjects.get(event_type, f"UPS Event: {event_type} - {ups_name}")
        
        # Initialize the email notifier
        notifier = EmailNotifier()
        
        # Get current date and time for the event
        now = datetime.datetime.now()
        local_tz = get_configured_timezone()
        if local_tz:
            now = now.astimezone(local_tz)
        
        # Format date and time for the template
        event_date = now.strftime('%Y-%m-%d')
        event_time = now.strftime('%H:%M:%S')
        
        # Make sure battery charge has % symbol
        battery_charge = ups_info.get('battery_charge', '0')
        if not battery_charge.endswith('%'):
            battery_charge = f"{battery_charge}%"
            
        # Make sure voltage values have V suffix
        input_voltage = ups_info.get('input_voltage', '0')
        if not input_voltage.endswith('V'):
            input_voltage = f"{input_voltage}V"
            
        battery_voltage = ups_info.get('battery_voltage', '0')
        if not battery_voltage.endswith('V'):
            battery_voltage = f"{battery_voltage}V"
        
        # Make sure runtime has min suffix
        runtime_estimate = ups_info.get('runtime_estimate', '0')
        if not runtime_estimate.endswith('min'):
            runtime_estimate = f"{runtime_estimate} min"
        
        # Set battery_duration (for ONLINE notifications) - how long it was on battery
        battery_duration = ups_info.get('battery_duration', '0 min')
        if not battery_duration.endswith('min'):
            battery_duration = f"{battery_duration} min"
            
        # Set comm_duration (for COMMOK notifications) - how long it was without communication
        comm_duration = ups_info.get('comm_duration', '0 min')
        if not comm_duration.endswith('min'):
            comm_duration = f"{comm_duration} min"
            
        # Prepare event data with properly formatted values
        event_data = {
            'ups_name': ups_name,
            'event_type': event_type,
            'subject': subject,
            'id_email': notification['config_id'],
            'event_date': event_date,
            'event_time': event_time,
            'battery_charge': battery_charge,
            'input_voltage': input_voltage, 
            'battery_voltage': battery_voltage,
            'runtime_estimate': runtime_estimate,
            'ups_model': ups_info.get('ups_model') or ups_info.get('device_model') or 'UPS Device',
            'ups_status': ups_info.get('ups_status', 'Unknown'),
            'device_serial': ups_info.get('device_serial', 'Unknown'),
            'battery_duration': battery_duration,
            'comm_duration': comm_duration,
            'battery_type': ups_info.get('battery_type', 'Unknown'),
            'ups_mfr': ups_info.get('ups_mfr', ''),
            'battery_voltage_nominal': ups_info.get('battery_voltage_nominal', '0V'),
            'device_location': ups_info.get('device_location', ''),
            'ups_firmware': ups_info.get('ups_firmware', ''),
            'ups_host': ups_name
        }
        
        # Calculate additional fields if needed for specific event types
        if event_type == 'ONLINE':
            try:
                # Check if we have an open event that we can use to calculate duration
                with app.app_context():
                    # Look for open ONBATT events
                    open_event = UPSEventModel.query.filter_by(
                        ups_name=ups_name,
                        event_type='ONBATT',
                        timestamp_tz_end=None
                    ).order_by(UPSEventModel.timestamp_tz.desc()).first()
                    
                    if open_event and open_event.timestamp_tz:
                        # Calculate duration in minutes
                        duration_seconds = (now - open_event.timestamp_tz).total_seconds()
                        duration_minutes = int(duration_seconds / 60)
                        event_data['battery_duration'] = f"{duration_minutes} min"
                        log_message(f"DEBUG: Calculated battery_duration from open event: {event_data['battery_duration']}", True)
                    else:
                        # If there's no open event, find the most recent ONBATT event with an end time
                        closed_events = UPSEventModel.query.filter_by(
                            ups_name=ups_name,
                            event_type='ONBATT'
                        ).filter(UPSEventModel.timestamp_tz_end != None).order_by(UPSEventModel.timestamp_tz.desc()).limit(5).all()
                        
                        log_message(f"DEBUG: Found {len(closed_events)} closed ONBATT events", True)
                        
                        if closed_events:
                            # Find the most recent one that's likely to be related to this ONLINE event
                            for event in closed_events:
                                # Check if the event ended within the last hour
                                if event.timestamp_tz_end and (now - event.timestamp_tz_end).total_seconds() < 3600:
                                    if event.timestamp_tz:
                                        duration_seconds = (event.timestamp_tz_end - event.timestamp_tz).total_seconds()
                                        duration_minutes = int(duration_seconds / 60)
                                        event_data['battery_duration'] = f"{duration_minutes} min"
                                        log_message(f"DEBUG: Calculated battery_duration from closed event: {event_data['battery_duration']}", True)
                                        break
                        
                        # If we still don't have a duration, look at UPS statistics
                        if 'battery_duration' not in event_data or event_data['battery_duration'] == '0 min':
                            # Try to get it from known runtime stats
                            if 'device_uptime' in event_data and event_data['device_uptime'].isdigit():
                                # Use device uptime as a fallback (likely restart after power off)
                                uptime_min = int(event_data['device_uptime']) // 60
                                if uptime_min < 60:  # If uptime is less than 60 minutes, it's likely from a restart
                                    event_data['battery_duration'] = f"{uptime_min} min"
                                    log_message(f"DEBUG: Estimated battery_duration from device_uptime: {event_data['battery_duration']}", True)
            except Exception as e:
                log_message(f"WARNING: Could not calculate battery_duration: {e}", True)
                log_message(f"TRACEBACK: {traceback.format_exc()}", True)
        
        # Calculate communication outage duration for COMMOK events
        elif event_type == 'COMMOK':
            try:
                # For COMMOK events, try to estimate how long communication was lost
                # Check if we have an open event that we can use to calculate duration
                with app.app_context():
                    open_event = UPSEventModel.query.filter_by(
                        ups_name=ups_name,
                        event_type='COMMBAD',
                        timestamp_tz_end=None
                    ).order_by(UPSEventModel.timestamp_tz.desc()).first()
                    
                    if open_event and open_event.timestamp_tz:
                        # Calculate duration in minutes
                        duration_seconds = (now - open_event.timestamp_tz).total_seconds()
                        duration_minutes = int(duration_seconds / 60)
                        event_data['comm_duration'] = f"{duration_minutes} min"
                        log_message(f"DEBUG: Calculated comm_duration = {event_data['comm_duration']}", True)
            except Exception as e:
                log_message(f"WARNING: Could not calculate comm_duration: {e}", True)
                log_message(f"TRACEBACK: {traceback.format_exc()}", True)
        
        # Log the prepared event data
        log_message(f"DEBUG: Prepared event data for template: {event_data}", True)
        
        # Send notification using the existing email system
        success, message = notifier.send_notification(event_type, event_data)
        
        if success:
            log_message(f"Sent {event_type} notification for {ups_name} using email config {notification['config_id']}")
        else:
            log_message(f"ERROR: Failed to send notification: {message}")
            
    except Exception as e:
        log_message(f"ERROR: Failed to send notification: {str(e)}")
        log_message(f"TRACEBACK: {traceback.format_exc()}", True)

def get_enabled_ntfy_configs(event_type):
    """
    Check which Ntfy configurations are enabled for this event type
    
    Args:
        event_type (str): Type of event (ONLINE, ONBATT, etc.)
        
    Returns:
        list: List of Ntfy configurations
    """
    if not HAS_NTFY or not NtfyConfigModel:
        log_message("Ntfy module not available, skipping ntfy notifications", True)
        return []
        
    try:
        # Get the field name based on event type
        field_name = f"notify_{event_type.lower()}"
        
        # Query for configs that have this notification enabled
        with app.app_context():
            configs = NtfyConfigModel.query.filter(
                getattr(NtfyConfigModel, field_name) == True
            ).all()
            
            if configs:
                log_message(f"Found {len(configs)} Ntfy configs for {event_type}", True)
                return [config.to_dict() for config in configs]
            else:
                log_message(f"No enabled Ntfy configs found for {event_type}", True)
                return []
                
    except Exception as e:
        log_message(f"ERROR: Failed to get enabled Ntfy configs: {str(e)}")
        return []

def send_ntfy_notification(ups_name, event_type, config):
    """
    Send a notification via Ntfy with comprehensive UPS information
    
    Args:
        ups_name (str): Name of the UPS
        event_type (str): Type of event
        config (dict): Ntfy configuration
    """
    if not HAS_NTFY:
        log_message("Ntfy not available, skipping notification", True)
        return
        
    try:
        # Get UPS information for message content - more detailed retrieval
        ups_info = get_detailed_ups_info(ups_name)
        log_message(f"DEBUG: Ntfy received UPS info: {ups_info}", True)
        
        # Get current date and time
        now = datetime.datetime.now()
        local_tz = get_configured_timezone()
        if local_tz:
            now = now.astimezone(local_tz)
        
        # Add event date and time for all notifications
        ups_info['event_date'] = now.strftime('%Y-%m-%d')
        ups_info['event_time'] = now.strftime('%H:%M:%S')
        
        # For ONLINE events, try to calculate how long the UPS was on battery
        if event_type == 'ONLINE':
            try:
                # Check if we have an open event that we can use to calculate duration
                with app.app_context():
                    # Look for open ONBATT events
                    open_event = UPSEventModel.query.filter_by(
                        ups_name=ups_name,
                        event_type='ONBATT',
                        timestamp_tz_end=None
                    ).order_by(UPSEventModel.timestamp_tz.desc()).first()
                    
                    if open_event and open_event.timestamp_tz:
                        # Calculate duration in minutes
                        duration_seconds = (now - open_event.timestamp_tz).total_seconds()
                        duration_minutes = int(duration_seconds / 60)
                        ups_info['battery_duration'] = f"{duration_minutes} min"
                        log_message(f"DEBUG: Calculated battery_duration from open event: {ups_info['battery_duration']}", True)
                    else:
                        # If there's no open event, find the most recent ONBATT event with an end time
                        closed_events = UPSEventModel.query.filter_by(
                            ups_name=ups_name,
                            event_type='ONBATT'
                        ).filter(UPSEventModel.timestamp_tz_end != None).order_by(UPSEventModel.timestamp_tz.desc()).limit(5).all()
                        
                        log_message(f"DEBUG: Found {len(closed_events)} closed ONBATT events", True)
                        
                        if closed_events:
                            # Find the most recent one that's likely to be related to this ONLINE event
                            for event in closed_events:
                                # Check if the event ended within the last hour
                                if event.timestamp_tz_end and (now - event.timestamp_tz_end).total_seconds() < 3600:
                                    if event.timestamp_tz:
                                        duration_seconds = (event.timestamp_tz_end - event.timestamp_tz).total_seconds()
                                        duration_minutes = int(duration_seconds / 60)
                                        ups_info['battery_duration'] = f"{duration_minutes} min"
                                        log_message(f"DEBUG: Calculated battery_duration from closed event: {ups_info['battery_duration']}", True)
                                        break
                        
                        # If we still don't have a duration, look at UPS statistics
                        if 'battery_duration' not in ups_info or ups_info['battery_duration'] == '0 min':
                            # Try to get it from known runtime stats
                            if 'device_uptime' in ups_info and ups_info['device_uptime'].isdigit():
                                # Use device uptime as a fallback (likely restart after power off)
                                uptime_min = int(ups_info['device_uptime']) // 60
                                if uptime_min < 60:  # If uptime is less than 60 minutes, it's likely from a restart
                                    ups_info['battery_duration'] = f"{uptime_min} min"
                                    log_message(f"DEBUG: Estimated battery_duration from device_uptime: {ups_info['battery_duration']}", True)
            except Exception as e:
                log_message(f"WARNING: Could not calculate battery_duration: {e}", True)
                log_message(f"TRACEBACK: {traceback.format_exc()}", True)
        
        # For COMMOK events, try to calculate how long communication was lost
        elif event_type == 'COMMOK':
            try:
                # Check if we have an open event that we can use to calculate duration
                with app.app_context():
                    open_event = UPSEventModel.query.filter_by(
                        ups_name=ups_name,
                        event_type='COMMBAD',
                        timestamp_tz_end=None
                    ).order_by(UPSEventModel.timestamp_tz.desc()).first()
                    
                    if open_event and open_event.timestamp_tz:
                        # Calculate duration in minutes
                        duration_seconds = (now - open_event.timestamp_tz).total_seconds()
                        duration_minutes = int(duration_seconds / 60)
                        ups_info['comm_duration'] = f"{duration_minutes} min"
                        log_message(f"DEBUG: Calculated comm_duration = {ups_info['comm_duration']}", True)
            except Exception as e:
                log_message(f"WARNING: Could not calculate comm_duration: {e}", True)
                log_message(f"TRACEBACK: {traceback.format_exc()}", True)
        
        # Ensure data is properly formatted for notification
        # Make sure battery charge has % symbol
        battery_charge = ups_info.get('battery_charge', '0')
        if not battery_charge.endswith('%'):
            battery_charge = f"{battery_charge}%"
            
        # Make sure voltage values have V suffix
        input_voltage = ups_info.get('input_voltage', '0')
        if not input_voltage.endswith('V'):
            input_voltage = f"{input_voltage}V"
            
        battery_voltage = ups_info.get('battery_voltage', '0') 
        if not battery_voltage.endswith('V'):
            battery_voltage = f"{battery_voltage}V"
        
        # Make sure runtime has min suffix and is converted from seconds if needed
        if 'battery_runtime' in ups_info and ups_info['battery_runtime'].isdigit():
            runtime_min = int(ups_info['battery_runtime']) // 60
            ups_info['runtime_estimate'] = f"{runtime_min} min"
            log_message(f"DEBUG: Calculated runtime_estimate from battery_runtime: {ups_info['runtime_estimate']}", True)
        elif 'runtime_estimate' in ups_info and not ups_info['runtime_estimate'].endswith('min'):
            ups_info['runtime_estimate'] = f"{ups_info['runtime_estimate']} min"
            
        # Make sure we always have some value for runtime_estimate
        if 'runtime_estimate' not in ups_info or ups_info['runtime_estimate'] == '0 min':
            # Try to get it from battery_runtime_low
            if 'battery_runtime_low' in ups_info and ups_info['battery_runtime_low'].isdigit():
                runtime_min = int(ups_info['battery_runtime_low']) // 60
                ups_info['runtime_estimate'] = f"{runtime_min} min"
                log_message(f"DEBUG: Used battery_runtime_low as fallback for runtime_estimate: {ups_info['runtime_estimate']}", True)
            # If still not available, try battery_charge and a simple estimation
            elif 'battery_charge' in ups_info:
                charge = ups_info['battery_charge']
                if charge.endswith('%'):
                    charge = charge[:-1]
                if charge.isdigit():
                    # Simple estimation: 1% charge = 1 minute runtime (very rough approximation)
                    charge_value = int(charge)
                    ups_info['runtime_estimate'] = f"{charge_value} min" 
                    log_message(f"DEBUG: Estimated runtime from battery charge: {ups_info['runtime_estimate']}", True)
        
        # Make sure comm_duration has min suffix
        comm_duration = ups_info.get('comm_duration', '0 min')
        if not comm_duration.endswith('min'):
            comm_duration = f"{comm_duration} min"
        
        # Update UPS info with formatted values
        ups_info['battery_charge'] = battery_charge
        ups_info['input_voltage'] = input_voltage
        ups_info['battery_voltage'] = battery_voltage
        ups_info['runtime_estimate'] = ups_info['runtime_estimate']
        ups_info['comm_duration'] = comm_duration
        ups_info['ups_model'] = ups_info.get('ups_model') or ups_info.get('device_model') or 'UPS Device'
        ups_info['ups_host'] = ups_name
        
        log_message(f"DEBUG: Ntfy formatted UPS info: {ups_info}", True)
        
        # Generate event title based on event type (ASCII only, no emoji to avoid encoding issues)
        event_titles = {
            "ONLINE": f"UPS Online - {ups_name}",
            "ONBATT": f"UPS On Battery - {ups_name}",
            "LOWBATT": f"UPS Low Battery - {ups_name}",
            "COMMOK": f"UPS Communication Restored - {ups_name}",
            "COMMBAD": f"UPS Communication Lost - {ups_name}",
            "SHUTDOWN": f"System Shutdown Imminent - {ups_name}",
            "REPLBATT": f"UPS Battery Needs Replacement - {ups_name}",
            "NOCOMM": f"UPS Not Reachable - {ups_name}",
            "NOPARENT": f"Parent Process Lost - {ups_name}",
            "FSD": f"UPS Forced Shutdown - {ups_name}"
        }
        
        title = event_titles.get(event_type, f"UPS Event: {event_type} - {ups_name}")
        
        # Create detailed, formatted message based on the event type
        details = format_ups_details(ups_info)
        
        # Create event message based on the type
        event_messages = {
            "ONLINE": f"🔌 Power has been restored! UPS {ups_name} is now running on line power.\n\n{details}",
            "ONBATT": f"⚠️ POWER FAILURE DETECTED! UPS {ups_name} is now running on battery power.\n\n{details}",
            "LOWBATT": f"🚨 CRITICAL ALERT! UPS {ups_name} has critically low battery level. Shutdown imminent!\n\n{details}",
            "COMMOK": f"✅ Communication with UPS {ups_name} has been restored.\n\n{details}",
            "COMMBAD": f"❌ WARNING! Communication with UPS {ups_name} has been lost.\n\n{details}",
            "SHUTDOWN": f"🚨 CRITICAL! System on UPS {ups_name} is shutting down due to power issues.\n\n{details}",
            "REPLBATT": f"🔋 The battery of UPS {ups_name} needs to be replaced.\n\n{details}",
            "NOCOMM": f"❌ WARNING! No communication with UPS {ups_name} for an extended period.\n\n{details}",
            "NOPARENT": f"⚠️ The parent process monitoring UPS {ups_name} has died.\n\n{details}",
            "FSD": f"🚨 EMERGENCY! UPS {ups_name} is performing a forced shutdown.\n\n{details}"
        }
        
        message = event_messages.get(event_type, f"UPS {ups_name} reports status: {event_type}\n\n{details}")
        
        # Get tag for the event type
        tag_map = {
            "ONLINE": "white_check_mark",
            "ONBATT": "battery",
            "LOWBATT": "warning,battery",
            "COMMOK": "signal_strength",
            "COMMBAD": "no_mobile_phones",
            "SHUTDOWN": "sos,warning",
            "REPLBATT": "wrench,battery",
            "NOCOMM": "no_entry,warning",
            "NOPARENT": "ghost",
            "FSD": "sos,warning"
        }
        
        tags = tag_map.get(event_type, "")
        
        # Set priority based on event type
        priority_map = {
            "LOWBATT": 5,  # Emergency
            "SHUTDOWN": 5, # Emergency
            "FSD": 5,      # Emergency
            "ONBATT": 4,   # High
            "COMMBAD": 4,  # High
            "NOCOMM": 4,   # High
            "REPLBATT": 3, # Normal
            "NOPARENT": 3, # Normal
            "ONLINE": 3,   # Normal
            "COMMOK": 2    # Low
        }
        
        priority = priority_map.get(event_type, config.get('priority', 3))
        
        # Create request for ntfy notification using the config provided
        import requests
        
        server = config.get('server', 'https://ntfy.sh')
        topic = config.get('topic', '')
        use_auth = config.get('use_auth', False)
        username = config.get('username', '')
        password = config.get('password', '')
        use_tags = config.get('use_tags', True)
        
        # Prepare headers
        headers = {
            "Title": title,
            "Priority": str(priority)
        }
        
        # Add click action to open web UI
        if '192.168.10.19' in server or 'localhost' in server or '127.0.0.1' in server:
            headers["Click"] = "http://192.168.10.19:5050/events"
        
        # Add tags if enabled
        if use_tags and tags:
            headers["Tags"] = tags
        
        # Prepare auth
        auth = None
        if use_auth and username and password:
            auth = (username, password)
        
        # Add an actions button to acknowledge the event
        if event_type in ["ONBATT", "LOWBATT", "COMMBAD", "NOCOMM", "REPLBATT"]:
            headers["Actions"] = json.dumps([
                {
                    "action": "view",
                    "label": "Open Events Page",
                    "url": "http://192.168.10.19:5050/events"
                }
            ])
        
        # Send notification
        url = f"{server}/{topic}"
        log_message(f"Sending ntfy notification to {url} with tags: {tags}", True)
        
        try:
            response = requests.post(
                url,
                data=message.encode('utf-8'),  # Encode to UTF-8 to handle special characters
                headers=headers,
                auth=auth,
                timeout=10
            )
            
            if response.status_code in [200, 201, 202]:
                log_message(f"Sent {event_type} notification for {ups_name} via Ntfy to {topic}")
                return True
            else:
                log_message(f"ERROR: Failed to send Ntfy notification: {response.status_code} - {response.text}")
                return False
        except Exception as e:
            log_message(f"ERROR: Failed to send HTTP request to Ntfy: {str(e)}")
            return False
            
    except Exception as e:
        log_message(f"ERROR: Failed to prepare Ntfy notification: {str(e)}")
        traceback.print_exc(file=open(DEBUG_LOG, 'a'))
        return False

def get_detailed_ups_info(ups_name):
    """
    Get comprehensive UPS information from database using ORM
    
    Args:
        ups_name: Name of the UPS
        
    Returns:
        dict: Detailed UPS information
    """
    try:
        # Add detailed logging
        log_message(f"DEBUG: Starting get_detailed_ups_info for {ups_name}", True)
        
        # Default UPS info with safe values
        ups_info = {
            'ups_model': 'Unknown',
            'device_serial': 'Unknown',
            'ups_status': 'Unknown',
            'battery_charge': '0',
            'runtime_estimate': '0',
            'input_voltage': '0',
            'battery_voltage': '0',
            'ups_host': ups_name,
            'battery_voltage_nominal': '0',
            'battery_type': 'Unknown',
            'ups_timer_shutdown': '0',
            'ups_firmware': 'Unknown',
            'ups_mfr': 'Unknown',
            'device_location': 'Unknown',
            'last_update': datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        }
        
        # Get current date and time for the event
        now = datetime.datetime.now()
        local_tz = get_configured_timezone()
        if local_tz:
            now = now.astimezone(local_tz)
        
        # Format date and time for the template
        ups_info['event_date'] = now.strftime('%Y-%m-%d')
        ups_info['event_time'] = now.strftime('%H:%M:%S')
        
        # Use ORM but with dynamic/flexible approach
        with app.app_context():
            try:
                # Get static data using dynamic SQL through ORM
                log_message("DEBUG: Querying static data using dynamic ORM query", True)
                
                # First check if tables exist
                tables = inspect(db.engine).get_table_names()
                log_message(f"DEBUG: Available tables in database: {tables}", True)
                
                if 'ups_static_data' in tables:
                    # Execute raw SQL through SQLAlchemy ORM
                    result = db.session.execute(text("SELECT * FROM ups_static_data LIMIT 1"))
                    columns = result.keys()
                    log_message(f"DEBUG: Static data columns available: {columns}", True)
                    
                    row = result.fetchone()
                    if row:
                        # Convert row to dictionary
                        static_data = {column: value for column, value in zip(columns, row)}
                        log_message(f"DEBUG: Static data retrieved: {static_data}", True)
                        
                        # Update ups_info with all available static data
                        for key, value in static_data.items():
                            if key != 'id' and value is not None:
                                ups_info[key] = str(value)
                                log_message(f"DEBUG: Set static value {key} = {value}", True)
                
                if 'ups_dynamic_data' in tables:
                    # Execute raw SQL through SQLAlchemy ORM
                    result = db.session.execute(text("SELECT * FROM ups_dynamic_data ORDER BY timestamp_tz DESC LIMIT 1"))
                    columns = result.keys()
                    log_message(f"DEBUG: Dynamic data columns available: {columns}", True)
                    
                    row = result.fetchone()
                    if row:
                        # Convert row to dictionary
                        dynamic_data = {column: value for column, value in zip(columns, row)}
                        log_message(f"DEBUG: Dynamic data retrieved: {dynamic_data}", True)
                        
                        # Update ups_info with all available dynamic data
                        for key, value in dynamic_data.items():
                            if key not in ['id', 'timestamp_tz'] and value is not None:
                                ups_info[key] = str(value)
                                log_message(f"DEBUG: Set dynamic value {key} = {value}", True)
                        
                        # Store the timestamp
                        if 'timestamp_tz' in dynamic_data and dynamic_data['timestamp_tz'] is not None:
                            ups_info['last_update'] = str(dynamic_data['timestamp_tz'])
                            log_message(f"DEBUG: Set last_update = {ups_info['last_update']}", True)
            except Exception as e:
                log_message(f"WARNING: Dynamic ORM query failed: {e}", True)
                log_message(f"TRACEBACK: {traceback.format_exc()}", True)
        
        # Ensure proper formatting of all values
        # Make sure battery charge has % symbol
        if 'battery_charge' in ups_info and not ups_info['battery_charge'].endswith('%'):
            ups_info['battery_charge'] = f"{ups_info['battery_charge']}%"
            
        # Make sure voltage values have V suffix
        for key in list(ups_info.keys()):
            if 'voltage' in key and not ups_info[key].endswith('V'):
                ups_info[key] = f"{ups_info[key]}V"
        
        # Make sure runtime has min suffix and is converted from seconds if needed
        if 'battery_runtime' in ups_info and ups_info['battery_runtime'].isdigit():
            runtime_min = int(ups_info['battery_runtime']) // 60
            ups_info['runtime_estimate'] = f"{runtime_min} min"
            log_message(f"DEBUG: Calculated runtime_estimate from battery_runtime: {ups_info['runtime_estimate']}", True)
        elif 'runtime_estimate' in ups_info and not ups_info['runtime_estimate'].endswith('min'):
            ups_info['runtime_estimate'] = f"{ups_info['runtime_estimate']} min"
            
        # Make sure we always have some value for runtime_estimate
        if 'runtime_estimate' not in ups_info or ups_info['runtime_estimate'] == '0 min':
            # Try to get it from battery_runtime_low
            if 'battery_runtime_low' in ups_info and ups_info['battery_runtime_low'].isdigit():
                runtime_min = int(ups_info['battery_runtime_low']) // 60
                ups_info['runtime_estimate'] = f"{runtime_min} min"
                log_message(f"DEBUG: Used battery_runtime_low as fallback for runtime_estimate: {ups_info['runtime_estimate']}", True)
            # If still not available, try battery_charge and a simple estimation
            elif 'battery_charge' in ups_info:
                charge = ups_info['battery_charge']
                if charge.endswith('%'):
                    charge = charge[:-1]
                if charge.isdigit():
                    # Simple estimation: 1% charge = 1 minute runtime (very rough approximation)
                    charge_value = int(charge)
                    ups_info['runtime_estimate'] = f"{charge_value} min" 
                    log_message(f"DEBUG: Estimated runtime from battery charge: {ups_info['runtime_estimate']}", True)
        
        # Improve battery duration if it's 0 min
        if 'battery_duration' in ups_info and ups_info['battery_duration'] == '0 min':
            if 'device_uptime' in ups_info and ups_info['device_uptime'].isdigit():
                # Use device uptime as a fallback (likely restart after power off)
                uptime_min = int(ups_info['device_uptime']) // 60
                if uptime_min > 0 and uptime_min < 60:  # If uptime is less than 60 minutes, it's likely from a restart
                    ups_info['battery_duration'] = f"{uptime_min} min"
                    log_message(f"DEBUG: Estimated battery_duration from device_uptime in get_detailed_ups_info: {ups_info['battery_duration']}", True)
        
        # Log final UPS info
        log_message(f"DEBUG: Final UPS info: {ups_info}", True)
        
        return ups_info
        
    except Exception as e:
        log_message(f"ERROR: Failed to get detailed UPS info: {e}")
        log_message(f"TRACEBACK: {traceback.format_exc()}", True)
        return {
            'ups_model': 'Unknown',
            'device_serial': 'Unknown',
            'ups_status': 'Unknown',
            'battery_charge': '0',
            'runtime_estimate': '0 min',
            'input_voltage': '0V',
            'battery_voltage': '0V',
            'ups_host': ups_name,
            'last_update': datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
            'event_date': datetime.datetime.now().strftime('%Y-%m-%d'),
            'event_time': datetime.datetime.now().strftime('%H:%M:%S')
        }

def format_ups_details(ups_info):
    """
    Format UPS information into a readable string
    
    Args:
        ups_info: Dictionary of UPS information
        
    Returns:
        str: Formatted UPS details
    """
    log_message(f"DEBUG: Formatting UPS details from: {ups_info}", True)
    
    # Format the battery runtime from seconds to minutes if available
    runtime_min = '0'
    if 'battery_runtime' in ups_info:
        runtime_str = ups_info['battery_runtime']
        if isinstance(runtime_str, str) and runtime_str.isdigit():
            runtime_min = str(int(runtime_str) // 60)
        elif 'runtime_estimate' in ups_info:
            runtime_str = ups_info['runtime_estimate']
            if runtime_str.endswith(' min'):
                runtime_min = runtime_str.replace(' min', '')
    
    # Ensure battery charge has % symbol
    battery_charge = ups_info.get('battery_charge', '0')
    if not battery_charge.endswith('%'):
        battery_charge = f"{battery_charge}%"
    
    # Ensure voltage values have V suffix
    input_voltage = ups_info.get('input_voltage', '0')
    if not input_voltage.endswith('V'):
        input_voltage = f"{input_voltage}V"
    
    battery_voltage = ups_info.get('battery_voltage', '0')
    if not battery_voltage.endswith('V'):
        battery_voltage = f"{battery_voltage}V"
        
    output_voltage = ups_info.get('output_voltage', '0')
    if not output_voltage.endswith('V') and output_voltage != '0':
        output_voltage = f"{output_voltage}V"
        
    battery_voltage_nominal = ups_info.get('battery_voltage_nominal', '0')
    if not battery_voltage_nominal.endswith('V') and battery_voltage_nominal != '0':
        battery_voltage_nominal = f"{battery_voltage_nominal}V"
    
    # Format UPS load if available
    ups_load = ups_info.get('ups_load', '')
    if ups_load and not ups_load.endswith('%'):
        ups_load = f"{ups_load}%"
        
    # Format battery durations and make sure they're never 0 min if we can help it
    battery_duration = ups_info.get('battery_duration', '0 min')
    if not battery_duration.endswith('min'):
        battery_duration = f"{battery_duration} min"
    
    # Improve runtime estimate if it's 0 min
    runtime_estimate = ups_info.get('runtime_estimate', '0 min')
    if runtime_estimate == '0 min' and battery_charge != '0%':
        # Try to calculate from battery charge
        charge = battery_charge
        if charge.endswith('%'):
            charge = charge[:-1]
        if charge.isdigit():
            charge_value = int(charge)
            if charge_value > 0:
                # Simple estimation: 1% charge = 1 minute runtime (very rough approximation)
                runtime_estimate = f"{charge_value} min"
                log_message(f"DEBUG: Estimated runtime from battery charge in format_ups_details: {runtime_estimate}", True)
    
    # Improve battery duration if it's 0 min
    if battery_duration == '0 min' and 'device_uptime' in ups_info and ups_info['device_uptime'].isdigit():
        # Use device uptime as a fallback (likely restart after power off)
        uptime_min = int(ups_info['device_uptime']) // 60
        if uptime_min > 0 and uptime_min < 60:  # If uptime is less than 60 minutes, it's likely from a restart
            battery_duration = f"{uptime_min} min"
            log_message(f"DEBUG: Estimated battery_duration from device_uptime in format_ups_details: {battery_duration}", True)
    
    # Create a detailed status report
    details = []
    
    # Device information section
    device_model = ups_info.get('device_model') or ups_info.get('ups_model') or 'Unknown'
    device_serial = ups_info.get('device_serial') or ups_info.get('ups_serial') or 'Unknown'
    device_location = ups_info.get('device_location', '')
    
    device_section = [
        f"📱 DEVICE INFO:",
        f"  Model: {device_model}",
        f"  Serial: {device_serial}"
    ]
    
    if device_location:
        device_section.append(f"  Location: {device_location}")
    if ups_info.get('ups_firmware'):
        device_section.append(f"  Firmware: {ups_info.get('ups_firmware')}")
    if ups_info.get('ups_mfr'):
        device_section.append(f"  Manufacturer: {ups_info.get('ups_mfr')}")
        
    details.append("\n".join(device_section))
    
    # Power information section
    power_section = [
        f"⚡ POWER INFO:",
        f"  Status: {ups_info.get('ups_status', 'Unknown')}"
    ]
    
    if input_voltage != '0V':
        power_section.append(f"  Input Voltage: {input_voltage}")
    
    if output_voltage != '0V':
        power_section.append(f"  Output Voltage: {output_voltage}")
    
    if ups_load:
        power_section.append(f"  UPS Load: {ups_load}")
    
    # Battery information section
    battery_section = [
        f"🔋 BATTERY INFO:",
        f"  Charge: {battery_charge}"
    ]
    
    if runtime_estimate and runtime_estimate != '0 min':
        battery_section.append(f"  Est. Runtime: {runtime_estimate}")
    
    if battery_voltage != '0V':
        battery_section.append(f"  Battery Voltage: {battery_voltage}")
    
    if battery_voltage_nominal != '0V':
        battery_section.append(f"  Nominal Voltage: {battery_voltage_nominal}")
    
    if 'battery_temperature' in ups_info and ups_info['battery_temperature'] != '0':
        temp = ups_info['battery_temperature']
        if not temp.endswith('°C'):
            temp = f"{temp}°C"
        battery_section.append(f"  Temperature: {temp}")
        
    if battery_duration != '0 min':
        battery_section.append(f"  Battery Duration: {battery_duration}")
    
    details.append("\n".join(battery_section))
    
    # Event information section if we have date and time
    if ups_info.get('event_date') and ups_info.get('event_time'):
        event_section = [
            f"📅 EVENT INFO:",
            f"  Date: {ups_info.get('event_date')}",
            f"  Time: {ups_info.get('event_time')}"
        ]
        details.append("\n".join(event_section))
    
    # Last update timestamp
    details.append(f"\n⏰ Last update: {ups_info.get('last_update')}")
    
    formatted_details = "\n\n".join(details)
    log_message(f"DEBUG: Formatted UPS details: {formatted_details}", True)
    
    return formatted_details

def process_ups_event(ups_name, event_type):
    """Process a UPS event and send notifications"""
    try:
        # Store event in database first
        if not store_event_in_database(ups_name, event_type):
            logger.error("Failed to store event in database")
            return False
            
        # Get enabled email notifications
        notifications = get_enabled_notifications(event_type)
        
        # Get enabled ntfy configurations
        ntfy_configs = get_enabled_ntfy_configs(event_type)
            
        # Check if we have any notifications to send
        if not notifications and not ntfy_configs and not HAS_WEBHOOK:
            logger.info(f"No enabled notifications found for {event_type}")
            return True
            
        # Send email notifications if there are any enabled
        if notifications:
            # Verify email configuration before sending notifications
            if not verify_email_config():
                logger.info("Email notifications disabled - no valid email configuration")
            else:
                # Send notifications
                for notification in notifications:
                    if notification.get('type') == 'email':
                        send_email_notification(ups_name, event_type, notification)
        
        # Send ntfy notifications if there are any enabled
        if ntfy_configs and HAS_NTFY:
            for config in ntfy_configs:
                send_ntfy_notification(ups_name, event_type, config)
                
        # Send webhook notifications if available
        if HAS_WEBHOOK:
            try:
                logger.info(f"Sending webhook notifications for {event_type}")
                result = send_webhook_notification(event_type, ups_name)
                if result.get('success'):
                    logger.info(f"Webhook notifications sent: {result.get('message')}")
                else:
                    logger.warning(f"Webhook notifications failed or none configured: {result.get('message')}")
            except Exception as e:
                logger.error(f"Error sending webhook notifications: {str(e)}")
                
        return True
    except Exception as e:
        logger.error(f"Failed to process event: {str(e)}")
        return False

def main():
    """Main entry point for the script"""
    try:
        # Log that we're running in direct mode (no sockets)
        log_message("📝 Running UPS notifier in direct mode (no socket communication)")
        
        # Log all environment variables to help with debugging
        log_message("🔍 Environment: PYTHONPATH=" + os.environ.get("PYTHONPATH", "Not set"))
        log_message("🔍 Script running as user: " + os.environ.get("USER", "Unknown") + " (UID: " + str(os.getuid()) + ")")
        log_message("🔍 Python executable: " + sys.executable)
        log_message("🔍 Python version: " + sys.version)
        log_message("🔍 Python path: " + str(sys.path))
        
        # Remove the script name from arguments
        args = sys.argv[1:]
        
        log_message(f"📝 Called with arguments: {args}")
        
        # Parse input arguments
        ups_name, event_type = parse_input_args(args)
        
        if not ups_name or not event_type:
            log_message("ERROR: Failed to parse UPS name or event type")
            sys.exit(1)
            
        log_message(f"Parsed UPS_NAME={ups_name}, EVENT_TYPE={event_type}")
        
        # Log the event based on its type
        event_messages = {
            "ONLINE": f"UPS '{ups_name}' is ONLINE - Power has been restored",
            "ONBATT": f"UPS '{ups_name}' is ON BATTERY - Power failure detected",
            "LOWBATT": f"WARNING: UPS '{ups_name}' has LOW BATTERY - Critical power level",
            "FSD": f"CRITICAL: UPS '{ups_name}' - Forced shutdown in progress",
            "COMMOK": f"UPS '{ups_name}' - Communication restored",
            "COMMBAD": f"WARNING: UPS '{ups_name}' - Communication lost",
            "SHUTDOWN": f"CRITICAL: UPS '{ups_name}' - System shutdown in progress",
            "REPLBATT": f"WARNING: UPS '{ups_name}' - Battery needs replacing",
            "NOCOMM": f"WARNING: UPS '{ups_name}' - No communication for extended period",
            "NOPARENT": f"WARNING: UPS '{ups_name}' - Parent process died",
            "CAL": f"UPS '{ups_name}' - Calibration in progress",
            "TRIM": f"UPS '{ups_name}' - Trimming incoming voltage",
            "BOOST": f"UPS '{ups_name}' - Boosting incoming voltage",
            "OFF": f"UPS '{ups_name}' - UPS is switched off",
            "OVERLOAD": f"WARNING: UPS '{ups_name}' - UPS is overloaded",
            "BYPASS": f"UPS '{ups_name}' - UPS is in bypass mode",
            "NOBATT": f"WARNING: UPS '{ups_name}' - UPS has no battery",
            "DATAOLD": f"WARNING: UPS '{ups_name}' - UPS data is too old"
        }
        
        log_message(event_messages.get(event_type, f"UPS '{ups_name}' status: {event_type}"))
        
        # Process the event within app context
        with app.app_context():
            if process_ups_event(ups_name, event_type):
                log_message("Notification processing complete")
                sys.exit(0)
            else:
                log_message("ERROR: Failed to process notification")
                sys.exit(1)
            
    except Exception as e:
        log_message(f"CRITICAL ERROR: {str(e)}")
        traceback.print_exc(file=open(DEBUG_LOG, 'a'))
        sys.exit(1)

if __name__ == "__main__":
    main() 