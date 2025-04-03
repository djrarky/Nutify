"""
UPS Database Module Initialization.
This module provides functions and classes for working with UPS data.
"""

import logging
from flask_socketio import SocketIO
from flask_sqlalchemy import SQLAlchemy
from core.logger import database_logger as logger

logger.info("💾 Initializing UPS database module")

# Create database instance
db = SQLAlchemy()

# Import core components from submodules
from core.db.ups.errors import (
    UPSError, UPSConnectionError, UPSCommandError, UPSDataError
)
from core.db.ups.utils import (
    UPSData, configure_ups, get_configured_timezone, get_supported_value, 
    calculate_realpower, data_lock, ups_lock
)
from core.db.ups.data import (
    get_available_variables, get_ups_data, get_historical_data,
    calculate_daily_power, get_hourly_power
)
from core.db.ups.cache import (
    UPSDataCache, save_ups_data, ups_data_cache, websocket, init_websocket
)
from core.db.ups.models import (
    is_static_field, get_available_ups_variables, create_static_model,
    create_dynamic_model, initialize_static_data, initialize_static_data_if_needed,
    insert_initial_dynamic_data, get_ups_model, get_static_model,
    STATIC_FIELDS, DYNAMIC_FIELDS
)

# Import event handling functions
from core.events.handlers import get_event_type, handle_ups_event

# Create a SocketIO instance for UPS events
socketio = SocketIO()

# Store for model instances
UPSDynamicData = None
UPSStaticData = None
UPSEvent = None
UPSCommand = None
VariableConfig = None
ReportSchedule = None
UPSVariable = None
MailConfig = None

def register_models_from_modelclasses(model_classes):
    """
    Register all models from ModelClasses in their global variables.
    This is needed if the models weren't available during db_module initialization.
    
    Args:
        model_classes: The ModelClasses namespace from db.ModelClasses
    
    Returns:
        dict: Dictionary with registered models
    """
    global UPSEvent, UPSCommand, VariableConfig, ReportSchedule, UPSVariable, MailConfig, UPSStaticData, UPSDynamicData
    
    if hasattr(model_classes, 'UPSEvent'):
        UPSEvent = model_classes.UPSEvent
        logger.info("✅ UPSEvent model registered")
    
    if hasattr(model_classes, 'UPSCommand'):
        UPSCommand = model_classes.UPSCommand
        logger.info("✅ UPSCommand model registered")
    
    if hasattr(model_classes, 'VariableConfig'):
        VariableConfig = model_classes.VariableConfig
        logger.info("✅ VariableConfig model registered")
    
    if hasattr(model_classes, 'ReportSchedule'):
        ReportSchedule = model_classes.ReportSchedule
        logger.info("✅ ReportSchedule model registered")
    
    if hasattr(model_classes, 'UPSVariable'):
        UPSVariable = model_classes.UPSVariable
        logger.info("✅ UPSVariable model registered")
    
    if hasattr(model_classes, 'MailConfig'):
        MailConfig = model_classes.MailConfig
        logger.info("✅ MailConfig model registered")
    
    if hasattr(model_classes, 'UPSStaticData'):
        UPSStaticData = model_classes.UPSStaticData
        logger.info("✅ UPSStaticData model registered")
    
    if hasattr(model_classes, 'UPSDynamicData'):
        UPSDynamicData = model_classes.UPSDynamicData
        logger.info("✅ UPSDynamicData model registered")
    
    return {
        'UPSEvent': UPSEvent,
        'UPSCommand': UPSCommand,
        'VariableConfig': VariableConfig,
        'ReportSchedule': ReportSchedule,
        'UPSVariable': UPSVariable,
        'MailConfig': MailConfig,
        'UPSStaticData': UPSStaticData,
        'UPSDynamicData': UPSDynamicData
    }

def register_report_schedule(report_schedule_model):
    """
    Register the ReportSchedule model after initialization.
    This is needed if the model wasn't available during db_module initialization.
    
    Args:
        report_schedule_model: The ReportSchedule model class from db.ModelClasses
        
    Returns:
        The registered ReportSchedule model
    """
    global ReportSchedule
    ReportSchedule = report_schedule_model
    logger.info(f"✅ ReportSchedule model registered: {ReportSchedule}")
    return ReportSchedule

def register_models_for_scheduler():
    """
    Register the ReportSchedule model with the scheduler.
    This is needed to ensure the scheduler can access the model correctly.
    """
    if ReportSchedule is not None:
        from core.scheduler import register_report_schedule_model, register_db
        register_report_schedule_model(ReportSchedule)
        register_db(db)
        logger.info("✅ ReportSchedule model registered with scheduler")
    else:
        logger.error("❌ ReportSchedule model is not available for scheduler registration")

# List of modules exported from this package
__all__ = [
    'db',
    'UPSError',
    'UPSConnectionError',
    'UPSCommandError',
    'UPSDataError',
    'UPSData',
    'configure_ups',
    'get_configured_timezone',
    'get_supported_value',
    'calculate_realpower',
    'get_available_variables',
    'get_ups_data',
    'get_historical_data',
    'calculate_daily_power',
    'get_hourly_power',
    'UPSDataCache',
    'save_ups_data',
    'ups_data_cache',
    'is_static_field',
    'get_available_ups_variables',
    'create_static_model',
    'create_dynamic_model',
    'initialize_static_data',
    'initialize_static_data_if_needed',
    'insert_initial_dynamic_data',
    'get_ups_model',
    'get_static_model',
    'STATIC_FIELDS',
    'DYNAMIC_FIELDS',
    'get_event_type',
    'handle_ups_event',
    'socketio',
    'websocket',
    'init_websocket',
    'data_lock',
    'ups_lock',
    'UPSDynamicData',
    'UPSStaticData',
    'UPSEvent',
    'UPSCommand',
    'VariableConfig',
    'ReportSchedule',
    'UPSVariable',
    'register_models_from_modelclasses',
    'register_report_schedule',
    'register_models_for_scheduler',
    'MailConfig'
] 