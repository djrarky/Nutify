"""
Report Schedule ORM Model.
This module defines the SQLAlchemy ORM model for the ups_report_schedules table.
"""

from datetime import datetime
from sqlalchemy import Column, Integer, String, Boolean, DateTime

# These will be set during initialization
get_configured_timezone = None
logger = None

class ReportSchedule:
    """Model for report schedules"""
    __tablename__ = 'ups_report_schedules'
    
    id = Column(Integer, primary_key=True)
    time = Column(String(5), nullable=False)  # Format: HH:MM
    days = Column(String(20), nullable=False)  # Format: 0,1,2,3,4,5,6 or * for all days
    reports = Column(String(200), nullable=False)  # Comma-separated list of report types
    email = Column(String(255))  # Email to send report to
    mail_config_id = Column(Integer)  # ID of the mail configuration to use
    period_type = Column(String(10), nullable=False, default='daily')  # yesterday, last_week, last_month, range
    from_date = Column(DateTime(timezone=True))  # Start date for 'range' period_type
    to_date = Column(DateTime(timezone=True))  # End date for 'range' period_type
    enabled = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), 
                      default=lambda: datetime.now(get_configured_timezone()))
    updated_at = Column(DateTime(timezone=True), 
                      default=lambda: datetime.now(get_configured_timezone()),
                      onupdate=lambda: datetime.now(get_configured_timezone()))
    
    def to_dict(self):
        """Convert model to dictionary"""
        tz = get_configured_timezone()
        
        # Split reports by comma and remove any duplicates
        reports = []
        if self.reports:
            for report in self.reports.split(','):
                if report and report not in reports:
                    reports.append(report)
        
        return {
            'id': self.id,
            'time': self.time,
            'days': [int(d) for d in self.days.split(',') if d.isdigit()],
            'reports': reports,
            'email': self.email,
            'mail_config_id': self.mail_config_id,
            'period_type': self.period_type,
            'from_date': self.from_date.astimezone(tz).isoformat() if self.from_date else None,
            'to_date': self.to_date.astimezone(tz).isoformat() if self.to_date else None,
            'enabled': self.enabled,
            'created_at': self.created_at.astimezone(tz).isoformat() if self.created_at else None,
            'updated_at': self.updated_at.astimezone(tz).isoformat() if self.updated_at else None
        }

def init_model(model_base, timezone_getter, db_logger=None):
    """
    Initialize the ReportSchedule model with the SQLAlchemy base and timezone getter.
    
    Args:
        model_base: SQLAlchemy declarative base class
        timezone_getter: Function to get the configured timezone
        db_logger: Logger for database operations
        
    Returns:
        The initialized ReportSchedule model class
    """
    global get_configured_timezone, logger
    get_configured_timezone = timezone_getter
    
    if db_logger:
        logger = db_logger
    else:
        import logging
        logger = logging.getLogger('database')
    
    class ReportScheduleModel(model_base, ReportSchedule):
        """ORM model for report schedules"""
        __table_args__ = {'extend_existing': True}
    
    return ReportScheduleModel 