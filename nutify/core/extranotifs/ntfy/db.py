import logging
from datetime import datetime

logger = logging.getLogger(__name__)

# Nota: Questo modulo deve utilizzare il modello NtfyConfig dal sistema centralizzato DB
# Non è necessario definire o inizializzare un modello separato qui.
# Il modello è già definito in core/db/models.py e registrato in db.ModelClasses

def get_ntfy_model():
    """Get NtfyConfig model from central db registry"""
    try:
        from app import db
        if hasattr(db, 'ModelClasses') and hasattr(db.ModelClasses, 'NtfyConfig'):
            return db.ModelClasses.NtfyConfig
        logger.warning("NtfyConfig model not available in central registry")
        return None
    except Exception as e:
        logger.error(f"Error getting NtfyConfig model: {str(e)}")
        return None

def get_configs_from_db():
    """
    Get all Ntfy configurations from the database
    
    Returns:
        list: List of Ntfy configurations
    """
    try:
        from app import db
        NtfyConfig = get_ntfy_model() or db.ModelClasses.NtfyConfig
        
        # Use SQLAlchemy ORM to query
        configs = NtfyConfig.query.order_by(NtfyConfig.is_default.desc(), NtfyConfig.id.asc()).all()
        
        # Convert to list of dicts
        return [config.to_dict() for config in configs]
    except Exception as e:
        logger.error(f"Error fetching Ntfy configurations: {str(e)}")
        return []

def get_config_by_id(config_id):
    """
    Get a specific Ntfy configuration by ID
    
    Args:
        config_id (int): Configuration ID
    
    Returns:
        dict: Ntfy configuration or None if not found
    """
    try:
        from app import db
        NtfyConfig = get_ntfy_model() or db.ModelClasses.NtfyConfig
        
        config = NtfyConfig.query.get(config_id)
        if config:
            return config.to_dict()
        return None
    except Exception as e:
        logger.error(f"Error fetching Ntfy configuration {config_id}: {str(e)}")
        return None

def save_config(config_data):
    """
    Save a Ntfy configuration to the database
    
    Args:
        config_data (dict): Configuration data
    
    Returns:
        dict: Response with success status and saved config
    """
    try:
        from app import db
        NtfyConfig = get_ntfy_model() or db.ModelClasses.NtfyConfig
        
        # Check if this is an update or new config
        if config_data.get('id'):
            # Update existing config
            config_id = config_data['id']
            config = NtfyConfig.query.get(config_id)
            
            if not config:
                return {"success": False, "message": "Configuration not found"}
            
            # Check if password is changed
            if config_data.get('password') == '********':
                # Password not changed, keep the current one
                config_data.pop('password')
            
            # Update the record
            config.server_type = config_data.get('server_type', config.server_type)
            config.server = config_data.get('server', config.server)
            config.topic = config_data.get('topic', config.topic)
            config.use_auth = bool(config_data.get('use_auth', config.use_auth))
            config.username = config_data.get('username', config.username)
            if 'password' in config_data:
                config.password = config_data.get('password')
            config.priority = config_data.get('priority', config.priority)
            config.use_tags = bool(config_data.get('use_tags', config.use_tags))
            
            # Update notification settings
            config.notify_onbatt = bool(config_data.get('notify_onbatt', config.notify_onbatt))
            config.notify_online = bool(config_data.get('notify_online', config.notify_online))
            config.notify_lowbatt = bool(config_data.get('notify_lowbatt', config.notify_lowbatt))
            config.notify_commok = bool(config_data.get('notify_commok', config.notify_commok))
            config.notify_commbad = bool(config_data.get('notify_commbad', config.notify_commbad))
            config.notify_shutdown = bool(config_data.get('notify_shutdown', config.notify_shutdown))
            config.notify_replbatt = bool(config_data.get('notify_replbatt', config.notify_replbatt))
            config.notify_nocomm = bool(config_data.get('notify_nocomm', config.notify_nocomm))
            config.notify_noparent = bool(config_data.get('notify_noparent', config.notify_noparent))
            
            # If this is marked as default, update other configs
            if config_data.get('is_default'):
                # Set all configs to not default
                NtfyConfig.query.filter(NtfyConfig.id != config_id).update({'is_default': False})
                config.is_default = True
            
            db.session.commit()
            return {"success": True, "config": get_config_by_id(config_id)}
            
        else:
            # Insert new config
            new_config = NtfyConfig(
                server_type=config_data.get('server_type', 'ntfy.sh'),
                server=config_data.get('server', 'https://ntfy.sh'),
                topic=config_data.get('topic', ''),
                use_auth=bool(config_data.get('use_auth', False)),
                username=config_data.get('username', ''),
                password=config_data.get('password', ''),
                priority=config_data.get('priority', 3),
                use_tags=bool(config_data.get('use_tags', False)),
                is_default=bool(config_data.get('is_default', False)),
                notify_onbatt=bool(config_data.get('notify_onbatt', False)),
                notify_online=bool(config_data.get('notify_online', False)),
                notify_lowbatt=bool(config_data.get('notify_lowbatt', False)),
                notify_commok=bool(config_data.get('notify_commok', False)),
                notify_commbad=bool(config_data.get('notify_commbad', False)),
                notify_shutdown=bool(config_data.get('notify_shutdown', False)),
                notify_replbatt=bool(config_data.get('notify_replbatt', False)),
                notify_nocomm=bool(config_data.get('notify_nocomm', False)),
                notify_noparent=bool(config_data.get('notify_noparent', False))
            )
            
            db.session.add(new_config)
            db.session.flush()  # Get the ID without committing
            
            # If this is the first config, make it default
            count = NtfyConfig.query.count()
            if count == 1:
                new_config.is_default = True
            
            # If this is marked as default, update other configs
            elif config_data.get('is_default'):
                NtfyConfig.query.filter(NtfyConfig.id != new_config.id).update({'is_default': False})
            
            db.session.commit()
            return {"success": True, "config": get_config_by_id(new_config.id)}
            
    except Exception as e:
        from app import db
        db.session.rollback()
        logger.error(f"Error saving Ntfy configuration: {str(e)}")
        return {"success": False, "message": str(e)}

def delete_config(config_id):
    """
    Delete a Ntfy configuration
    
    Args:
        config_id (int): Configuration ID
    
    Returns:
        dict: Response with success status
    """
    try:
        from app import db
        NtfyConfig = get_ntfy_model() or db.ModelClasses.NtfyConfig
        
        config = NtfyConfig.query.get(config_id)
        if not config:
            return {"success": False, "message": "Configuration not found"}
        
        db.session.delete(config)
        db.session.commit()
        return {"success": True}
    except Exception as e:
        from app import db
        db.session.rollback()
        logger.error(f"Error deleting Ntfy configuration {config_id}: {str(e)}")
        return {"success": False, "message": str(e)}

def set_default_config(config_id):
    """
    Set a configuration as the default
    
    Args:
        config_id (int): Configuration ID
    
    Returns:
        dict: Response with success status
    """
    try:
        from app import db
        NtfyConfig = get_ntfy_model() or db.ModelClasses.NtfyConfig
        
        # Check if config exists
        config = NtfyConfig.query.get(config_id)
        if not config:
            return {"success": False, "message": "Configuration not found"}
        
        # Update all configs to not be default
        NtfyConfig.query.update({'is_default': False})
        
        # Set this config as default
        config.is_default = True
        
        db.session.commit()
        return {"success": True}
        
    except Exception as e:
        from app import db
        db.session.rollback()
        logger.error(f"Error setting default Ntfy configuration {config_id}: {str(e)}")
        return {"success": False, "message": str(e)}

def get_default_config():
    """
    Get the default Ntfy configuration
    
    Returns:
        dict: Default configuration or None if not found
    """
    try:
        from app import db
        NtfyConfig = get_ntfy_model() or db.ModelClasses.NtfyConfig
        
        config = NtfyConfig.query.filter_by(is_default=True).first()
        if not config:
            # If no default, get the first config
            config = NtfyConfig.query.first()
        
        if config:
            return config.to_dict()
        return None
    except Exception as e:
        logger.error(f"Error getting default Ntfy configuration: {str(e)}")
        return None

def is_event_notification_enabled(event_type):
    """
    Check if notification for event type is enabled
    
    Args:
        event_type (str): Event type
    
    Returns:
        bool: True if enabled, False otherwise
    """
    try:
        from app import db
        NtfyConfig = get_ntfy_model() or db.ModelClasses.NtfyConfig
        
        # Get default config
        config = NtfyConfig.query.filter_by(is_default=True).first()
        if not config:
            return False
        
        return config.is_event_enabled(event_type)
    except Exception as e:
        logger.error(f"Error checking if event notification is enabled: {str(e)}")
        return False

def save_notification_setting(setting_data):
    """
    Save a notification setting
    
    Args:
        setting_data (dict): Setting data with event_type, enabled, and config_id
    
    Returns:
        dict: Response with success status
    """
    try:
        from app import db
        NtfyConfig = get_ntfy_model() or db.ModelClasses.NtfyConfig
        
        event_type = setting_data.get('event_type')
        enabled = setting_data.get('enabled', False)
        config_id = setting_data.get('config_id', '')
        
        # Debug log
        logger.debug(f"Saving notification setting: {event_type}, enabled: {enabled}, config_id: {config_id}")
        
        # If enabled is True but no config_id is provided, we need a config
        if enabled and not config_id:
            # Try to get the default config
            default_config = NtfyConfig.query.filter_by(is_default=True).first()
            if default_config:
                config_id = default_config.id
                logger.debug(f"Using default config ID: {config_id}")
            else:
                # Get the first config
                first_config = NtfyConfig.query.first()
                if first_config:
                    config_id = first_config.id
                    logger.debug(f"Using first available config ID: {config_id}")
                else:
                    # No configs available
                    return {"success": False, "message": "No Ntfy configurations found. Please create one first."}
        
        # If enabled is False, we can update all configs to disable this notification
        if not enabled:
            # Update all configs to disable this notification
            field_name = f"notify_{event_type.lower()}"
            
            # Use SQLAlchemy ORM to update all configs
            configs = NtfyConfig.query.all()
            for config in configs:
                setattr(config, field_name, False)
            
            db.session.commit()
            return {"success": True, "message": f"Notification for {event_type} disabled for all configurations"}
        
        # If we have a config_id, update that specific config
        if config_id:
            # Get the config
            config = NtfyConfig.query.get(config_id)
            
            if config:
                # Update the config with the notification setting
                field_name = f"notify_{event_type.lower()}"
                
                # Use SQLAlchemy ORM to update the field
                setattr(config, field_name, enabled)
                
                db.session.commit()
                return {"success": True, "message": f"Notification setting for {event_type} updated successfully"}
            else:
                return {"success": False, "message": "Configuration not found"}
        else:
            # This should not happen, but just in case
            return {"success": False, "message": "No configuration selected and no default configuration found"}
            
    except Exception as e:
        from app import db
        db.session.rollback()
        logger.error(f"Error saving notification setting: {str(e)}")
        return {"success": False, "message": str(e)}

def get_notification_settings():
    """
    Get all notification settings for all event types
    
    Returns:
        dict: Dictionary with event types as keys and settings as values
    """
    try:
        from app import db
        NtfyConfig = get_ntfy_model() or db.ModelClasses.NtfyConfig
        
        # Get all configs
        configs = NtfyConfig.query.all()
        
        # Define event types
        event_types = ['ONLINE', 'ONBATT', 'LOWBATT', 'COMMOK', 'COMMBAD', 'SHUTDOWN', 'REPLBATT', 'NOCOMM', 'NOPARENT']
        
        # Initialize settings dictionary
        settings = {}
        
        # For each event type, find a config that has it enabled
        for event_type in event_types:
            field_name = f"notify_{event_type.lower()}"
            
            # Check all configs to see if any have this notification enabled
            enabled_config = None
            for config in configs:
                is_enabled = getattr(config, field_name, False)
                
                if is_enabled:
                    enabled_config = config
                    settings[event_type] = {
                        'enabled': True,
                        'config_id': str(config.id),
                        'event_type': event_type
                    }
                    logger.debug(f"Found enabled config for {event_type}: {config.id}")
                    break
            
            # If no config has this notification enabled, add an entry with empty config_id
            if event_type not in settings:
                settings[event_type] = {
                    'enabled': False,
                    'config_id': '',  # Empty config_id for default dropdown selection
                    'event_type': event_type
                }
                logger.debug(f"No enabled config for {event_type}, setting empty config_id")
        
        logger.debug(f"Returning notification settings: {settings}")
        return settings
        
    except Exception as e:
        logger.error(f"Error getting notification settings: {str(e)}")
        return {} 