"""
Database operations for Webhook configurations.
"""

import logging
from datetime import datetime
import json
from core.extranotifs.webhook import get_webhook_model as get_webhook_model_from_init
from core.logger import webhook_logger as logger

def get_webhook_model():
    """Get WebhookConfig model from central db registry"""
    return get_webhook_model_from_init()

def get_configs_from_db():
    """
    Get all Webhook configurations from the database
    
    Returns:
        list: List of Webhook configurations
    """
    try:
        from app import db
        WebhookConfig = get_webhook_model()
        
        if not WebhookConfig:
            logger.error("WebhookConfig model not available")
            return []
        
        # Use SQLAlchemy ORM to query
        configs = WebhookConfig.query.order_by(WebhookConfig.is_default.desc(), WebhookConfig.id.asc()).all()
        
        # Convert to list of dicts
        return [config.to_dict() for config in configs]
    except Exception as e:
        logger.error(f"Error fetching Webhook configurations: {str(e)}")
        return []

def get_config_by_id(config_id):
    """
    Get a specific Webhook configuration by ID
    
    Args:
        config_id (int): Configuration ID
    
    Returns:
        dict: Webhook configuration or None if not found
    """
    try:
        from app import db
        WebhookConfig = get_webhook_model()
        
        if not WebhookConfig:
            logger.error("WebhookConfig model not available")
            return None
        
        config = WebhookConfig.query.get(config_id)
        if config:
            return config.to_dict()
        return None
    except Exception as e:
        logger.error(f"Error fetching Webhook configuration {config_id}: {str(e)}")
        return None

def get_default_config():
    """
    Get the default Webhook configuration
    
    Returns:
        dict: Default Webhook configuration or None if not found
    """
    try:
        from app import db
        WebhookConfig = get_webhook_model()
        
        if not WebhookConfig:
            logger.error("WebhookConfig model not available")
            return None
        
        config = WebhookConfig.query.filter_by(is_default=True).first()
        if config:
            return config.to_dict()
        
        # If no default, return the first one
        config = WebhookConfig.query.first()
        if config:
            return config.to_dict()
            
        return None
    except Exception as e:
        logger.error(f"Error fetching default Webhook configuration: {str(e)}")
        return None

def save_config(config_data):
    """
    Save a Webhook configuration to the database
    
    Args:
        config_data (dict): Configuration data
    
    Returns:
        dict: Response with success status and saved config
    """
    try:
        from app import db
        WebhookConfig = get_webhook_model()
        
        if not WebhookConfig:
            logger.error("WebhookConfig model not available")
            return {"success": False, "message": "WebhookConfig model not available"}
        
        # Check if this is an update or new config
        if config_data.get('id'):
            # Update existing config
            config_id = config_data['id']
            config = WebhookConfig.query.get(config_id)
            
            if not config:
                return {"success": False, "message": "Configuration not found"}
            
            # Check if auth_password or auth_token is masked (not changed)
            if config_data.get('auth_password') == '********':
                # Password not changed, keep the current one
                config_data.pop('auth_password')
                
            if config_data.get('auth_token') == '********':
                # Token not changed, keep the current one
                config_data.pop('auth_token')
            
            # Process custom headers if provided as a dict
            if 'custom_headers' in config_data and isinstance(config_data['custom_headers'], dict):
                config_data['custom_headers'] = json.dumps(config_data['custom_headers'])
            
            # Update the record
            config.name = config_data.get('name', config.name)
            config.url = config_data.get('url', config.url)
            config.auth_type = config_data.get('auth_type', config.auth_type)
            config.auth_username = config_data.get('auth_username', config.auth_username)
            if 'auth_password' in config_data:
                config.auth_password = config_data.get('auth_password')
            if 'auth_token' in config_data:
                config.auth_token = config_data.get('auth_token')
            config.content_type = config_data.get('content_type', config.content_type)
            if 'custom_headers' in config_data:
                config.custom_headers = config_data.get('custom_headers')
            config.include_ups_data = bool(config_data.get('include_ups_data', config.include_ups_data))
            # Handle verify_ssl field
            config.verify_ssl = bool(config_data.get('verify_ssl', config.verify_ssl))
            
            # Update notification settings
            for event_type in ['onbatt', 'online', 'lowbatt', 'commok', 'commbad', 
                              'shutdown', 'replbatt', 'nocomm', 'noparent', 'cal',
                              'trim', 'boost', 'off', 'overload', 'bypass', 'nobatt',
                              'dataold']:
                field_name = f'notify_{event_type}'
                if field_name in config_data:
                    setattr(config, field_name, bool(config_data.get(field_name)))
            
            # If this is marked as default, update other configs
            if config_data.get('is_default'):
                # Set all configs to not default
                WebhookConfig.query.filter(WebhookConfig.id != config_id).update({'is_default': False})
                config.is_default = True
            
            db.session.commit()
            return {"success": True, "config": get_config_by_id(config_id)}
            
        else:
            # Insert new config
            
            # Process custom headers if provided as a dict
            if 'custom_headers' in config_data and isinstance(config_data['custom_headers'], dict):
                config_data['custom_headers'] = json.dumps(config_data['custom_headers'])
                
            new_config = WebhookConfig(
                name=config_data.get('name', 'New Webhook'),
                url=config_data.get('url', ''),
                auth_type=config_data.get('auth_type', 'none'),
                auth_username=config_data.get('auth_username', ''),
                auth_password=config_data.get('auth_password', ''),
                auth_token=config_data.get('auth_token', ''),
                content_type=config_data.get('content_type', 'application/json'),
                custom_headers=config_data.get('custom_headers', ''),
                include_ups_data=bool(config_data.get('include_ups_data', True)),
                verify_ssl='verify_ssl' in config_data and bool(config_data['verify_ssl']),
                is_default=bool(config_data.get('is_default', False))
            )
            
            # Set notification settings
            for event_type in ['onbatt', 'online', 'lowbatt', 'commok', 'commbad', 
                              'shutdown', 'replbatt', 'nocomm', 'noparent', 'cal',
                              'trim', 'boost', 'off', 'overload', 'bypass', 'nobatt',
                              'dataold']:
                field_name = f'notify_{event_type}'
                if field_name in config_data:
                    setattr(new_config, field_name, bool(config_data.get(field_name, False)))
            
            db.session.add(new_config)
            db.session.flush()  # Get the ID without committing
            
            # If this is the first config, make it default
            count = WebhookConfig.query.count()
            if count == 1:
                new_config.is_default = True
            
            # If this is marked as default, update other configs
            elif config_data.get('is_default'):
                WebhookConfig.query.filter(WebhookConfig.id != new_config.id).update({'is_default': False})
            
            db.session.commit()
            return {"success": True, "config": get_config_by_id(new_config.id)}
            
    except Exception as e:
        from app import db
        db.session.rollback()
        logger.error(f"Error saving Webhook configuration: {str(e)}")
        return {"success": False, "message": str(e)}

def delete_config(config_id):
    """
    Delete a webhook configuration
    
    Args:
        config_id (int): ID of the configuration to delete
    
    Returns:
        dict: Response with success status
    """
    try:
        from app import db
        WebhookConfig = get_webhook_model()
        
        if not WebhookConfig:
            logger.error("WebhookConfig model not available")
            return {"success": False, "message": "WebhookConfig model not available"}
        
        config = WebhookConfig.query.get(config_id)
        if not config:
            return {"success": False, "message": "Configuration not found"}
        
        # Check if this is the default config
        was_default = config.is_default
        
        # Delete the config
        db.session.delete(config)
        db.session.commit()
        
        # If this was the default config, set another one as default
        if was_default:
            remaining = WebhookConfig.query.first()
            if remaining:
                remaining.is_default = True
                db.session.commit()
        
        return {"success": True, "message": "Configuration deleted successfully"}
    except Exception as e:
        logger.error(f"Error deleting webhook configuration: {str(e)}")
        return {"success": False, "message": str(e)}

def set_default_config(config_id):
    """
    Set a webhook configuration as the default
    
    Args:
        config_id (int): ID of the configuration to set as default
    
    Returns:
        dict: Response with success status
    """
    try:
        from app import db
        WebhookConfig = get_webhook_model()
        
        if not WebhookConfig:
            logger.error("WebhookConfig model not available")
            return {"success": False, "message": "WebhookConfig model not available"}
        
        config = WebhookConfig.query.get(config_id)
        if not config:
            return {"success": False, "message": "Configuration not found"}
        
        # Set all configs to not default
        WebhookConfig.query.update({'is_default': False})
        
        # Set this config as default
        config.is_default = True
        db.session.commit()
        
        return {"success": True, "message": "Default configuration updated successfully"}
    except Exception as e:
        logger.error(f"Error setting default webhook configuration: {str(e)}")
        return {"success": False, "message": str(e)}

def get_enabled_configs_for_event(event_type):
    """
    Get all webhook configurations that are enabled for a specific event type
    
    Args:
        event_type (str): Event type (e.g., ONLINE, ONBATT)
    
    Returns:
        list: List of enabled webhook configurations for the event
    """
    try:
        from app import db
        WebhookConfig = get_webhook_model()
        
        if not WebhookConfig:
            logger.error("WebhookConfig model not available")
            return []
        
        # The field name based on event type
        field_name = f'notify_{event_type.lower()}'
        
        # Check if the field exists in the model
        if not hasattr(WebhookConfig, field_name):
            logger.warning(f"Field {field_name} not found in WebhookConfig model")
            return []
        
        # Get configs where the notification is enabled
        configs = WebhookConfig.query.filter(getattr(WebhookConfig, field_name) == True).all()
        
        return [config.to_dict() for config in configs]
    except Exception as e:
        logger.error(f"Error getting webhook configs for event {event_type}: {str(e)}")
        return [] 