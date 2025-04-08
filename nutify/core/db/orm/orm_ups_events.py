"""
UPS Events ORM Model.
This module defines the SQLAlchemy ORM model for the ups_events table.
"""

from datetime import datetime
from sqlalchemy import Column, Integer, String, Boolean, DateTime, Text

# These will be set during initialization
db = None
get_configured_timezone = None

class UPSEvent:
    """Model for UPS events"""
    __tablename__ = 'ups_events'  # Changed table name from ups_events_socket
    
    id = Column(Integer, primary_key=True)
    timestamp_tz = Column(DateTime(timezone=True), nullable=False, 
                        default=lambda: datetime.now(get_configured_timezone()))
    timestamp_tz_begin = Column(DateTime(timezone=True), 
                              default=lambda: datetime.now(get_configured_timezone()))
    timestamp_tz_end = Column(DateTime(timezone=True))
    ups_name = Column(String(255))
    event_type = Column(String(50))
    event_message = Column(Text)
    source_ip = Column(String(45))
    acknowledged = Column(Boolean, default=False)
    
    def to_dict(self):
        """Convert to dictionary"""
        result = {
            'id': self.id,
            'timestamp': self.timestamp_tz.isoformat() if self.timestamp_tz else None,
            'timestamp_begin': self.timestamp_tz_begin.isoformat() if self.timestamp_tz_begin else None,
            'timestamp_end': self.timestamp_tz_end.isoformat() if self.timestamp_tz_end else None,
            'ups_name': self.ups_name,
            'event_type': self.event_type,
            'event_message': self.event_message,
            'source_ip': self.source_ip,
            'acknowledged': self.acknowledged
        }
        return result

def init_model(model_base, timezone_getter):
    """
    Initialize the UPSEvent model with the SQLAlchemy base and timezone getter.
    
    Args:
        model_base: SQLAlchemy declarative base class
        timezone_getter: Function to get the configured timezone
        
    Returns:
        The initialized UPSEvent model class
    """
    global db, get_configured_timezone
    db = model_base
    get_configured_timezone = timezone_getter
    
    class UPSEventModel(model_base, UPSEvent):
        """ORM model for UPS events"""
        __table_args__ = {'extend_existing': True}
        
        def __init__(self, *args, **kwargs):
            super().__init__(*args, **kwargs)
            
            # Set the timestamp in the configured timezone if not provided
            if 'timestamp_tz' not in kwargs and 'timestamp_tz_begin' not in kwargs:
                now = datetime.now(get_configured_timezone())
                self.timestamp_tz = now
                self.timestamp_tz_begin = now
    
    return UPSEventModel 