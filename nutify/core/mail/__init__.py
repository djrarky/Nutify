from ..db.ups import db
from .mail import (
    test_email_config, save_mail_config,
    init_notification_settings, get_notification_settings, test_notification,
    EmailNotifier, handle_notification, test_notification_settings,
    send_email, get_encryption_key, get_msmtp_config,
    format_runtime, get_battery_duration, get_last_known_status, get_comm_duration,
    get_battery_age, calculate_battery_efficiency, validate_emails, get_current_email_settings
)
from .mail import logger as mail_logger
from .api_mail import register_mail_api_routes
from .provider import (
    email_providers, get_provider_config, get_all_providers, 
    get_provider_list, add_provider, update_provider, remove_provider
)

# Model references that will be populated when the models are available
MailConfig = None
NotificationSettings = None

def get_mail_config_model():
    """Get the MailConfig model, checking both global and db.ModelClasses"""
    global MailConfig
    
    # If already loaded, return it
    if MailConfig is not None:
        return MailConfig
        
    # Try to get from ModelClasses
    if hasattr(db, 'ModelClasses') and hasattr(db.ModelClasses, 'MailConfig'):
        MailConfig = db.ModelClasses.MailConfig
        mail_logger.info("✅ Retrieved MailConfig from db.ModelClasses")
        return MailConfig
        
    mail_logger.warning("⚠️ MailConfig model not available yet")
    return None
    
def get_notification_settings_model():
    """Get the NotificationSettings model, checking both global and db.ModelClasses"""
    global NotificationSettings
    
    # If already loaded, return it
    if NotificationSettings is not None:
        return NotificationSettings
        
    # Try to get from ModelClasses
    if hasattr(db, 'ModelClasses') and hasattr(db.ModelClasses, 'NotificationSettings'):
        NotificationSettings = db.ModelClasses.NotificationSettings
        mail_logger.info("✅ Retrieved NotificationSettings from db.ModelClasses")
        return NotificationSettings
        
    mail_logger.warning("⚠️ NotificationSettings model not available yet")
    return None

# Try to initialize models now if they're available
get_mail_config_model()
get_notification_settings_model()

# SQL schema path for the mail module (legacy path, kept for backward compatibility)
MAIL_SCHEMA_PATH = 'core/mail/db.mail.schema.sql'

# Import the new schema path from core.db module
try:
    from core.db import MAIL_SCHEMA_PATH as DB_MAIL_SCHEMA_PATH
except ImportError:
    # Fallback to legacy path if core.db is not available
    DB_MAIL_SCHEMA_PATH = MAIL_SCHEMA_PATH

# Export all necessary functions and classes
__all__ = [
    'MailConfig', 'test_email_config', 'save_mail_config',
    'init_notification_settings', 'get_notification_settings', 'test_notification',
    'NotificationSettings', 'EmailNotifier', 'handle_notification', 'test_notification_settings',
    'register_mail_api_routes', 'send_email', 'email_providers', 'get_encryption_key', 'get_msmtp_config',
    'format_runtime', 'get_battery_duration', 'get_last_known_status', 'get_comm_duration',
    'get_battery_age', 'calculate_battery_efficiency', 'validate_emails', 'get_current_email_settings',
    'get_provider_config', 'get_all_providers', 'get_provider_list', 'add_provider', 
    'update_provider', 'remove_provider', 'MAIL_SCHEMA_PATH', 'DB_MAIL_SCHEMA_PATH',
    'get_mail_config_model', 'get_notification_settings_model'
] 