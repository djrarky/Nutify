"""
Webhook module for UPS notifications.
This package provides functionality for:
- Sending webhook notifications for UPS events
- Managing webhook configurations
- Testing webhook endpoints
"""

from .webhook import WebhookNotifier, test_notification, send_event_notification
from .routes import create_blueprint
import os
from core.logger import webhook_logger as logger

# Global model variable (will be set in app.py when db.ModelClasses is available)
WebhookConfig = None

# Try to get the WebhookConfig model from db.ModelClasses
def get_webhook_model():
    """Get the WebhookConfig model from db.ModelClasses"""
    try:
        from app import db
        global WebhookConfig
        if hasattr(db, 'ModelClasses') and hasattr(db.ModelClasses, 'WebhookConfig'):
            WebhookConfig = db.ModelClasses.WebhookConfig
            logger.info("✅ Webhook model loaded from central DB registry")
            return WebhookConfig
        else:
            logger.warning("⚠️ WebhookConfig model not available in db.ModelClasses")
            return None
    except Exception as e:
        logger.error(f"Error loading WebhookConfig model: {str(e)}")
        return None

# Export all necessary functions and classes
__all__ = [
    'WebhookNotifier', 'test_notification', 'send_event_notification',
    'create_blueprint', 'WebhookConfig', 'get_webhook_model'
] 