"""
UPS Variable ORM Model.
This module defines the SQLAlchemy ORM model for the ups_variables_upsrw table.
"""

from datetime import datetime
from sqlalchemy import Column, Integer, String, Boolean, DateTime

# These will be set during initialization
db = None
get_configured_timezone = None

class UPSVariable:
    """Model to track changes to UPS variables"""
    __tablename__ = 'ups_variables_upsrw'
    
    id = Column(Integer, primary_key=True)
    name = Column(String(100), nullable=False)
    old_value = Column(String(255))
    new_value = Column(String(255), nullable=False)
    timestamp_tz = Column(DateTime, default=lambda: datetime.now(get_configured_timezone()))
    success = Column(Boolean, default=True)

def init_model(model_base, timezone_getter):
    """
    Initialize the UPSVariable model with the SQLAlchemy base and timezone getter.
    
    Args:
        model_base: SQLAlchemy declarative base class
        timezone_getter: Function to get the configured timezone
        
    Returns:
        The initialized UPSVariable model class
    """
    global db, get_configured_timezone
    db = model_base
    get_configured_timezone = timezone_getter
    
    class UPSVariableModel(model_base, UPSVariable):
        """ORM model for UPS variable tracking"""
        __table_args__ = {'extend_existing': True}
    
    return UPSVariableModel 