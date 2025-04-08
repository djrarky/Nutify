"""
Notification Settings ORM Model.
This module defines the SQLAlchemy ORM model for the ups_opt_notification table.
"""

from datetime import datetime
from sqlalchemy import Column, Integer, String, Float, Boolean, DateTime, ForeignKey
from sqlalchemy.orm import relationship
import json
from core.db.ups import db as app_db

# These will be set during initialization
get_configured_timezone = None
db = None
logger = None

class NotificationSettings:
    """Model for notification settings"""
    __tablename__ = 'ups_opt_notification'
    
    id = Column(Integer, primary_key=True)
    event_type = Column(String(50), unique=True, nullable=False)
    enabled = Column(Boolean, default=True)
    id_email = Column(Integer, nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(get_configured_timezone()))
    updated_at = Column(DateTime(timezone=True), 
                       default=lambda: datetime.now(get_configured_timezone()),
                       onupdate=lambda: datetime.now(get_configured_timezone()))
    
    def to_dict(self):
        """Convert to dictionary"""
        return {
            'id': self.id,
            'event_type': self.event_type,
            'enabled': self.enabled,
            'id_email': self.id_email,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None
        }
    
    @classmethod
    def init_notification_settings(cls):
        """Initialize notification settings with default values if not exists"""
        try:
            # Get available event types
            from core.mail.mail import EmailNotifier
            
            # Import the SQLAlchemy db instance from the core app
            from core.db.ups import db as app_db
            
            logger.info("Starting NotificationSettings initialization")
            
            # Check if settings already exist
            settings = app_db.session.query(cls).all()
            if settings:
                logger.info(f"Notification settings already exist: {len(settings)} found")
                return False
                
            logger.info("No notification settings found, creating defaults")
            
            # Create default settings
            added_count = 0
            for event_type in EmailNotifier.TEMPLATE_MAP.keys():
                setting = cls(event_type=event_type, enabled=False)
                app_db.session.add(setting)
                added_count += 1
                
            logger.info(f"Added {added_count} notification settings")
            
            # Commit the transaction
            try:
                app_db.session.commit()
                logger.info("Default notification settings created and committed")
                return True
            except Exception as e:
                # If error occurs during commit due to transaction issues, try a different approach
                if "transaction is already begun" in str(e):
                    logger.debug("Transaction already begun, trying to flush instead")
                    app_db.session.flush()
                    logger.info("Default notification settings flushed to session")
                    return True
                else:
                    # Another type of error, propagate it
                    app_db.session.rollback()
                    logger.error(f"Error during commit: {str(e)}")
                    raise
            
        except Exception as e:
            # Ensure we rollback any open transaction
            try:
                app_db.session.rollback()
            except:
                pass
                
            logger.error(f"Error initializing notification settings: {str(e)}")
            return False

def init_model(model_base, timezone_getter, db_instance, db_logger=None):
    """
    Initialize the NotificationSettings model with the SQLAlchemy base and timezone getter.
    
    Args:
        model_base: SQLAlchemy declarative base class
        timezone_getter: Function to get the configured timezone
        db_instance: SQLAlchemy database instance
        db_logger: Logger for database operations
        
    Returns:
        The initialized NotificationSettings model class
    """
    global get_configured_timezone, db, logger
    get_configured_timezone = timezone_getter
    db = db_instance
    
    if db_logger:
        logger = db_logger
    else:
        import logging
        logger = logging.getLogger('database')
    
    class NotificationSettingsModel(model_base, NotificationSettings):
        """ORM model for notification settings"""
        __table_args__ = {'extend_existing': True}
    
    return NotificationSettingsModel 