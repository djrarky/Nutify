"""
Webhook Configuration ORM Model.
This module defines the SQLAlchemy ORM model for the ups_opt_webhook table.
"""

from datetime import datetime
from sqlalchemy import Column, Integer, String, Boolean, DateTime, Text, JSON

# These will be set during initialization
get_configured_timezone = None
logger = None

class WebhookConfig:
    """Model for Webhook configuration"""
    __tablename__ = 'ups_opt_webhook'
    
    id = Column(Integer, primary_key=True)
    name = Column(String(255), nullable=False)
    url = Column(String(255), nullable=False)
    auth_type = Column(String(50), default='none')  # none, basic, bearer
    auth_username = Column(String(255))
    auth_password = Column(String(255))
    auth_token = Column(String(255))
    content_type = Column(String(100), default='application/json')
    custom_headers = Column(Text)  # JSON string of custom headers
    include_ups_data = Column(Boolean, default=True)
    is_default = Column(Boolean, default=False)
    verify_ssl = Column(Boolean, default=True)  # Add SSL verification option
    
    # Event notification settings
    notify_onbatt = Column(Boolean, default=False)
    notify_online = Column(Boolean, default=False)
    notify_lowbatt = Column(Boolean, default=False)
    notify_commok = Column(Boolean, default=False)
    notify_commbad = Column(Boolean, default=False)
    notify_shutdown = Column(Boolean, default=False)
    notify_replbatt = Column(Boolean, default=False)
    notify_nocomm = Column(Boolean, default=False)
    notify_noparent = Column(Boolean, default=False)
    notify_cal = Column(Boolean, default=False)
    notify_trim = Column(Boolean, default=False)
    notify_boost = Column(Boolean, default=False)
    notify_off = Column(Boolean, default=False)
    notify_overload = Column(Boolean, default=False)
    notify_bypass = Column(Boolean, default=False)
    notify_nobatt = Column(Boolean, default=False)
    notify_dataold = Column(Boolean, default=False)
    
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(get_configured_timezone()))
    updated_at = Column(DateTime(timezone=True), 
                       default=lambda: datetime.now(get_configured_timezone()),
                       onupdate=lambda: datetime.now(get_configured_timezone()))
    
    def to_dict(self):
        """Convert model to dictionary"""
        return {
            'id': self.id,
            'name': self.name,
            'url': self.url,
            'auth_type': self.auth_type,
            'auth_username': self.auth_username,
            'auth_password': '********' if self.auth_password else '',
            'auth_token': '********' if self.auth_token else '',
            'content_type': self.content_type,
            'custom_headers': self.custom_headers,
            'include_ups_data': self.include_ups_data,
            'is_default': self.is_default,
            'verify_ssl': self.verify_ssl,
            'notify_onbatt': self.notify_onbatt,
            'notify_online': self.notify_online,
            'notify_lowbatt': self.notify_lowbatt,
            'notify_commok': self.notify_commok,
            'notify_commbad': self.notify_commbad,
            'notify_shutdown': self.notify_shutdown,
            'notify_replbatt': self.notify_replbatt,
            'notify_nocomm': self.notify_nocomm,
            'notify_noparent': self.notify_noparent,
            'notify_cal': self.notify_cal,
            'notify_trim': self.notify_trim,
            'notify_boost': self.notify_boost,
            'notify_off': self.notify_off,
            'notify_overload': self.notify_overload,
            'notify_bypass': self.notify_bypass,
            'notify_nobatt': self.notify_nobatt,
            'notify_dataold': self.notify_dataold,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None
        }
    
    def is_event_enabled(self, event_type):
        """Check if notification for event type is enabled"""
        event_map = {
            'ONBATT': self.notify_onbatt,
            'ONLINE': self.notify_online,
            'LOWBATT': self.notify_lowbatt,
            'COMMOK': self.notify_commok,
            'COMMBAD': self.notify_commbad,
            'SHUTDOWN': self.notify_shutdown,
            'REPLBATT': self.notify_replbatt,
            'NOCOMM': self.notify_nocomm,
            'NOPARENT': self.notify_noparent,
            'CAL': self.notify_cal,
            'TRIM': self.notify_trim,
            'BOOST': self.notify_boost,
            'OFF': self.notify_off,
            'OVERLOAD': self.notify_overload,
            'BYPASS': self.notify_bypass,
            'NOBATT': self.notify_nobatt,
            'DATAOLD': self.notify_dataold
        }
        return event_map.get(event_type, False)

def init_model(model_base, timezone_getter, db_logger=None):
    """
    Initialize the WebhookConfig model with the SQLAlchemy base and timezone getter.
    
    Args:
        model_base: SQLAlchemy declarative base class
        timezone_getter: Function to get the configured timezone
        db_logger: Logger for database operations
        
    Returns:
        The initialized WebhookConfig model class
    """
    global get_configured_timezone, logger
    get_configured_timezone = timezone_getter
    
    if db_logger:
        logger = db_logger
    else:
        import logging
        logger = logging.getLogger('database')
    
    class WebhookConfigModel(model_base, WebhookConfig):
        """ORM model for Webhook configuration"""
        __table_args__ = {'extend_existing': True}
    
    return WebhookConfigModel 