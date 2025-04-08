"""
ORM Models Package.
This package contains individual ORM model definitions for each database table.
"""

from core.db.orm.orm_ups_events import UPSEvent, init_model as init_ups_event_model
from core.db.orm.orm_ups_opt_variable_config import VariableConfig, init_model as init_variable_config_model
from core.db.orm.orm_ups_variables_upscmd import UPSCommand, init_model as init_ups_command_model
from core.db.orm.orm_ups_variables_upsrw import UPSVariable, init_model as init_ups_variable_model
from core.db.orm.orm_ups_opt_mail_config import MailConfig, init_model as init_mail_config_model
from core.db.orm.orm_ups_opt_ntfy import NtfyConfig, init_model as init_ntfy_config_model
from core.db.orm.orm_ups_opt_webhook import WebhookConfig, init_model as init_webhook_config_model
from core.db.orm.orm_ups_opt_notification import NotificationSettings, init_model as init_notification_settings_model
from core.db.orm.orm_ups_report_schedules import ReportSchedule, init_model as init_report_schedule_model
# Removed imports for UPSStaticData and UPSDynamicData as they are now handled by db_module.py

# Dictionary to store initialized models
_models = {}

def init_models(db_instance, timezone_getter):
    """
    Initialize all ORM models in this package.
    
    Args:
        db_instance: SQLAlchemy database instance
        timezone_getter: Function to get the configured timezone
        
    Returns:
        dict: Dictionary of initialized model classes
    """
    global _models
    
    # Create the base class for all models
    class Base(db_instance.Model):
        """Base model with shared methods"""
        __abstract__ = True
        __table_args__ = {'extend_existing': True}
    
    # Import encryption key for MailConfig
    from core.settings import ENCRYPTION_KEY as CONFIG_ENCRYPTION_KEY
    from core.logger import database_logger
    
    # Initialize UPSEvent model
    _models['UPSEvent'] = init_ups_event_model(Base, timezone_getter)
    
    # Initialize VariableConfig model
    _models['VariableConfig'] = init_variable_config_model(Base, timezone_getter)
    
    # Initialize UPSCommand model
    _models['UPSCommand'] = init_ups_command_model(Base, timezone_getter)
    
    # Initialize UPSVariable model
    _models['UPSVariable'] = init_ups_variable_model(Base, timezone_getter)
    
    # Initialize MailConfig model with encryption key
    _models['MailConfig'] = init_mail_config_model(
        Base, 
        timezone_getter, 
        CONFIG_ENCRYPTION_KEY.encode(), 
        database_logger
    )
    
    # Initialize NtfyConfig model
    _models['NtfyConfig'] = init_ntfy_config_model(
        Base,
        timezone_getter,
        database_logger
    )
    
    # Initialize WebhookConfig model
    _models['WebhookConfig'] = init_webhook_config_model(
        Base,
        timezone_getter,
        database_logger
    )
    
    # Initialize NotificationSettings model
    _models['NotificationSettings'] = init_notification_settings_model(
        Base,
        timezone_getter,
        db_instance,
        database_logger
    )
    
    # Initialize ReportSchedule model
    _models['ReportSchedule'] = init_report_schedule_model(
        Base,
        timezone_getter,
        database_logger
    )
    
    # UPSStaticData and UPSDynamicData models are created dynamically by db_module.py
    # and not part of the standard ORM package
    
    # Return a dictionary of all initialized models
    return _models

# Export public symbols
__all__ = [
    'init_models',
    'UPSEvent',
    'VariableConfig',
    'UPSCommand',
    'UPSVariable',
    'MailConfig',
    'NtfyConfig',
    'WebhookConfig',
    'NotificationSettings',
    'ReportSchedule'
    # Removed UPSStaticData and UPSDynamicData from exports
]
