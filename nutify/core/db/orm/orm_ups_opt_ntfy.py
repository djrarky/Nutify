"""
Ntfy Configuration ORM Model.
This module defines the SQLAlchemy ORM model for the ups_opt_ntfy table.
"""

from datetime import datetime
from sqlalchemy import Column, Integer, String, Boolean, DateTime

# These will be set during initialization
get_configured_timezone = None
logger = None

class NtfyConfig:
    """Model for Ntfy configuration"""
    __tablename__ = 'ups_opt_ntfy'
    
    id = Column(Integer, primary_key=True)
    server_type = Column(String(50), nullable=False, default='ntfy.sh')
    server = Column(String(255), nullable=False, default='https://ntfy.sh')
    topic = Column(String(255), nullable=False)
    use_auth = Column(Boolean, default=False)
    username = Column(String(255))
    password = Column(String(255))
    priority = Column(Integer, default=3)
    use_tags = Column(Boolean, default=False)
    is_default = Column(Boolean, default=False)
    
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
    
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(get_configured_timezone()))
    updated_at = Column(DateTime(timezone=True), 
                       default=lambda: datetime.now(get_configured_timezone()),
                       onupdate=lambda: datetime.now(get_configured_timezone()))
    
    def to_dict(self):
        """Convert model to dictionary"""
        return {
            'id': self.id,
            'server_type': self.server_type,
            'server': self.server,
            'topic': self.topic,
            'use_auth': self.use_auth,
            'username': self.username,
            'password': '********' if self.password else '',
            'priority': self.priority,
            'use_tags': self.use_tags,
            'is_default': self.is_default,
            'notify_onbatt': self.notify_onbatt,
            'notify_online': self.notify_online,
            'notify_lowbatt': self.notify_lowbatt,
            'notify_commok': self.notify_commok,
            'notify_commbad': self.notify_commbad,
            'notify_shutdown': self.notify_shutdown,
            'notify_replbatt': self.notify_replbatt,
            'notify_nocomm': self.notify_nocomm,
            'notify_noparent': self.notify_noparent,
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
            'NOPARENT': self.notify_noparent
        }
        return event_map.get(event_type, False)

def init_model(model_base, timezone_getter, db_logger=None):
    """
    Initialize the NtfyConfig model with the SQLAlchemy base and timezone getter.
    
    Args:
        model_base: SQLAlchemy declarative base class
        timezone_getter: Function to get the configured timezone
        db_logger: Logger for database operations
        
    Returns:
        The initialized NtfyConfig model class
    """
    global get_configured_timezone, logger
    get_configured_timezone = timezone_getter
    
    if db_logger:
        logger = db_logger
    else:
        import logging
        logger = logging.getLogger('database')
    
    class NtfyConfigModel(model_base, NtfyConfig):
        """ORM model for Ntfy configuration"""
        __table_args__ = {'extend_existing': True}
    
    return NtfyConfigModel 