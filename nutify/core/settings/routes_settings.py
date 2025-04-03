from flask import Blueprint, render_template, request, jsonify, redirect, url_for
import os
from datetime import datetime

from .settings import get_logger
from core.db.ups import get_ups_data
from core.mail import get_notification_settings, MailConfig
from core.settings import LOG, LOG_LEVEL, LOG_WERKZEUG, get_configured_timezone

logger = get_logger('options')

routes_settings = Blueprint('routes_settings', __name__)

@routes_settings.route('/settings')
@routes_settings.route('/options')
def settings_page():
    """Render the settings page"""
    logger.info("Accessing settings page")
    
    data = get_ups_data()
    
    try:
        notify_settings = get_notification_settings()
    except Exception as e:
        logger.error(f"Error loading notification settings in options page: {str(e)}")
        notify_settings = []
    
    try:
        mail_config = MailConfig.query.first()
    except Exception as e:
        logger.error(f"Error loading mail configuration in options page: {str(e)}")
        mail_config = None
    
    # Read values from settings.txt; if LOG is not bool, normalize the comparison:
    log_enabled = str(LOG).strip().lower() == 'true'
    werkzeug_log_enabled = str(LOG_WERKZEUG).strip().lower() == 'true'
    
    # Debug logs for log settings
    logger.debug(f"DEBUG OPTIONS: LOG = {LOG!r}, log_enabled = {log_enabled}")
    logger.debug(f"DEBUG OPTIONS: LOG_WERKZEUG = {LOG_WERKZEUG!r}, werkzeug_log_enabled = {werkzeug_log_enabled}")
    
    return render_template('dashboard/options.html',
                         data=data,
                         notify_settings=notify_settings,
                         mail_config=mail_config,
                         log_enabled=log_enabled,
                         log_level=LOG_LEVEL,
                         werkzeug_log_enabled=werkzeug_log_enabled,
                         timezone=get_configured_timezone())

@routes_settings.route('/settings/system')
def system_settings():
    """Render the system settings page"""
    logger.info("Accessing system settings page")
    return render_template('system_settings.html')

@routes_settings.route('/settings/advanced')
def advanced_settings():
    """Render the advanced settings page"""
    logger.info("Accessing advanced settings page")
    return render_template('advanced_settings.html')

@routes_settings.route('/settings/backup')
def backup_settings():
    """Render the backup/restore settings page"""
    logger.info("Accessing backup settings page")
    return render_template('backup_settings.html') 