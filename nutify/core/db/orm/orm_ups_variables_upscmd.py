"""
UPS Command History ORM Model.
This module defines the SQLAlchemy ORM model for the ups_variables_upscmd table.
"""

from datetime import datetime
from sqlalchemy import Column, Integer, String, Boolean, DateTime, Text

# These will be set during initialization
db = None
get_configured_timezone = None

class UPSCommand:
    """Model for UPS commands history"""
    __tablename__ = 'ups_variables_upscmd'
    
    id = Column(Integer, primary_key=True)
    command = Column(String(100), nullable=False)
    timestamp = Column(DateTime, nullable=False, default=lambda: datetime.now(get_configured_timezone()))
    success = Column(Boolean, nullable=False)
    output = Column(Text)
    
    def to_dict(self):
        """Converts the object to a dictionary"""
        return {
            'id': self.id,
            'command': self.command,
            'timestamp': self.timestamp.isoformat() if self.timestamp else None,
            'success': self.success,
            'output': self.output
        }

def init_model(model_base, timezone_getter):
    """
    Initialize the UPSCommand model with the SQLAlchemy base and timezone getter.
    
    Args:
        model_base: SQLAlchemy declarative base class
        timezone_getter: Function to get the configured timezone
        
    Returns:
        The initialized UPSCommand model class
    """
    global db, get_configured_timezone
    db = model_base
    get_configured_timezone = timezone_getter
    
    class UPSCommandModel(model_base, UPSCommand):
        """ORM model for UPS command history"""
        __table_args__ = {'extend_existing': True}
    
    return UPSCommandModel 