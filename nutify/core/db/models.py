"""
Database Models Entry Point.
This module serves as the main entry point for initializing SQLAlchemy ORM models.
All model definitions have been moved to the core.db.orm package.
"""

from datetime import datetime

# Import models from the orm package
from core.db.orm import (
    UPSEvent, VariableConfig, UPSCommand, UPSVariable, 
    MailConfig, NtfyConfig, NotificationSettings, ReportSchedule
    # UPSStaticData and UPSDynamicData are dynamically created by db_module.py
)

# Import the centralized ModelClasses
from core.db.model_classes import ModelClasses, init_model_classes

# Will be set in init_models
db = None
get_configured_timezone = None

def init_models(db_instance, timezone_getter=None):
    """
    Initialize the SQLAlchemy models
    
    Args:
        db_instance: SQLAlchemy database instance
        timezone_getter: Function to get the configured timezone
        
    Returns:
        dict: Dictionary of initialized model classes
    """
    global db, get_configured_timezone
    db = db_instance
    get_configured_timezone = timezone_getter or (lambda: datetime.now().astimezone().tzinfo)
    
    # Check if we already have a ModelClasses namespace stored on db
    if hasattr(db, 'ModelClasses'):
        from core.logger import database_logger as logger
        logger.debug("📚 ORM models already initialized, returning existing models")
        # Return a dictionary of the existing models
        models_dict = {name: getattr(db.ModelClasses, name) for name in dir(db.ModelClasses) 
                      if not name.startswith('__')}
        return models_dict
    
    # Log key information
    from core.logger import database_logger as logger
    logger.info("📚 Initializing ORM models")
    
    # Initialize ModelClasses
    models = init_model_classes(db, get_configured_timezone)
    
    # Create a dictionary of models for backwards compatibility
    models_dict = {
        'UPSEvent': models.UPSEvent,
        'VariableConfig': models.VariableConfig,
        'UPSCommand': models.UPSCommand,
        'UPSVariable': models.UPSVariable,
        'MailConfig': models.MailConfig,
        'NtfyConfig': models.NtfyConfig,
        'NotificationSettings': models.NotificationSettings,
        'ReportSchedule': models.ReportSchedule
    }
    
    # UPSStaticData and UPSDynamicData models are dynamically created and managed 
    # exclusively by db_module.py
    
    # Log summary
    logger.info(f"✅ Created {len(models_dict)} ORM models successfully")
    
    # Make models available via ModelClasses attached to db
    db.ModelClasses = models
    
    # Tables will be created automatically by Flask-SQLAlchemy
    # or by the database integrity system during application startup
    # EXCEPT for ups_static_data and ups_dynamic_data tables which are managed by db_module.py
    
    return models_dict 