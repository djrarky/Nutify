"""
Mail Configuration ORM Model.
This module defines the SQLAlchemy ORM model for the ups_opt_mail_config table.
"""

from datetime import datetime
from sqlalchemy import Column, Integer, String, Boolean, DateTime, LargeBinary
from cryptography.fernet import Fernet
import base64
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

# These will be set during initialization
db = None
get_configured_timezone = None
ENCRYPTION_KEY = None
logger = None

def get_encryption_key():
    """Generates an encryption key from ENCRYPTION_KEY"""
    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(),
        length=32,
        salt=b'fixed-salt',  # In production, use a secure and unique salt
        iterations=100000,
    )
    key = base64.urlsafe_b64encode(kdf.derive(ENCRYPTION_KEY))
    return Fernet(key)

class MailConfig:
    """Model for email configuration"""
    __tablename__ = 'ups_opt_mail_config'
    
    id = Column(Integer, primary_key=True)
    smtp_server = Column(String(255), nullable=False)
    smtp_port = Column(Integer, nullable=False)
    username = Column(String(255))
    _password = Column('password', LargeBinary)
    enabled = Column(Boolean, default=False)
    provider = Column(String(50))  # Email provider
    tls = Column(Boolean, default=True)
    tls_starttls = Column(Boolean, default=True)
    is_default = Column(Boolean, default=False)  # Whether this is the default configuration
    to_email = Column(String(255))  # Email address for receiving test emails and notifications
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(get_configured_timezone()))
    updated_at = Column(DateTime(timezone=True), 
                      default=lambda: datetime.now(get_configured_timezone()),
                      onupdate=lambda: datetime.now(get_configured_timezone()))

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        logger.debug(f"📅 Creating MailConfig with timezone: {get_configured_timezone().zone}")
        logger.debug(f"📅 Created at will use: {datetime.now(get_configured_timezone())}")

    @property
    def password(self):
        """Decrypts the password"""
        if self._password is None:
            return None
        f = get_encryption_key()
        return f.decrypt(self._password).decode()

    @password.setter
    def password(self, value):
        """Encrypts the password"""
        if value is None:
            self._password = None
        else:
            f = get_encryption_key()
            self._password = f.encrypt(value.encode())
            
    @property
    def from_email(self):
        """Returns the username as the from_email"""
        return self.username
        
    @property
    def from_name(self):
        """Returns the username's local part as the from_name"""
        if self.username and '@' in self.username:
            return self.username.split('@')[0]
        return self.username
        
    @classmethod
    def get_default(cls):
        """Get the default mail configuration"""
        return cls.query.filter_by(is_default=True).first() or cls.query.first()

def init_model(model_base, timezone_getter, encryption_key=None, db_logger=None):
    """
    Initialize the MailConfig model with the SQLAlchemy base and timezone getter.
    
    Args:
        model_base: SQLAlchemy declarative base class
        timezone_getter: Function to get the configured timezone
        encryption_key: Key for encrypting passwords
        db_logger: Logger for database operations
        
    Returns:
        The initialized MailConfig model class
    """
    global db, get_configured_timezone, ENCRYPTION_KEY, logger
    db = model_base
    get_configured_timezone = timezone_getter
    
    # Set encryption key and logger if provided
    if encryption_key:
        ENCRYPTION_KEY = encryption_key
    
    if db_logger:
        logger = db_logger
    else:
        import logging
        logger = logging.getLogger('database')
    
    class MailConfigModel(model_base, MailConfig):
        """ORM model for mail configuration"""
        __table_args__ = {'extend_existing': True}
    
    return MailConfigModel 