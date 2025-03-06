import os
import re
from pathlib import Path
import pytz
from datetime import datetime
import logging

# Base directory of the application
BASE_DIR = Path(__file__).resolve().parent.parent

# Directory for logs
LOG_DIR = os.path.join(BASE_DIR, 'logs')
os.makedirs(LOG_DIR, exist_ok=True)

# Main log file
LOG_FILE = os.path.join(LOG_DIR, 'system.log')

#  Remove the creation of other log files
if not os.path.exists(LOG_FILE):
    with open(LOG_FILE, 'w') as f:
        f.write(f"Log file created on {datetime.now().isoformat()}\n")

# Add the logger
logger = logging.getLogger('system')

def parse_value(value):
    """Parse string value into appropriate type"""
    value = value.strip()
    
    # Remove comments
    if '#' in value:
        value = value.split('#')[0].strip()
    
    # Handle multiline strings between triple quotes
    if value.startswith('"""'):
        # Find the closing triple quotes
        end_pos = value.find('"""', 3)
        if end_pos != -1:
            # Return the content between the quotes
            return value[3:end_pos]
        # If no closing quotes found, treat as normal string
        return value.strip('"')
        
    # Boolean
    if value.lower() in ('true', 'false'):
        return value.lower() == 'true'
        
    # Integer
    try:
        if value.isdigit():
            return int(value)
    except ValueError:
        pass
        
    # Float
    try:
        if '.' in value:
            return float(value)
    except ValueError:
        pass
        
    # String (remove quotes if present)
    return value.strip('"\'')

def load_settings():
    """Load settings from config file"""
    # Definition of default values
    default_settings = {
        'DEBUG_MODE': 'development',
        'SERVER_PORT': 5050,
        'SERVER_HOST': '0.0.0.0',
        'CACHE_SECONDS': 60,
        'LOG_LEVEL': 'DEBUG',
        'LOG_FILE_ENABLED': True,
        'LOG_FORMAT': '%(asctime)s - %(name)s - %(levelname)s - %(message)s',
        'LOG_LEVEL_DEBUG': 'DEBUG, %(asctime)s - %(name)s - %(levelname)s - %(message)s',
        'LOG_LEVEL_INFO': 'INFO, %(asctime)s - %(name)s - %(levelname)s - %(message)s',
        'COMMAND_TIMEOUT': 10
    }
    
    settings = default_settings.copy()
    config_path = Path(__file__).parent.parent / 'config' / 'settings.txt'
    base_path = Path(__file__).parent.parent
    
    if not config_path.exists():
        raise FileNotFoundError(f"Configuration file not found: {config_path}")
        
    with open(config_path) as f:
        for line in f:
            line = line.strip()
            # Skip comments and empty lines
            if not line or line.startswith('#'):
                continue
                
            if '=' in line:
                key, value = line.split('=', 1)
                key = key.strip()
                settings[key] = parse_value(value)
    
    # Validation of required variables
    required_vars = [
        'UPS_HOST', 'UPS_NAME', 'UPS_USER', 'UPS_PASSWORD', 'UPS_COMMAND',
        'UPS_REALPOWER_NOMINAL', 'UPSCMD_COMMAND', 'UPSCMD_USER', 'UPSCMD_PASSWORD',
        'DB_NAME', 'INSTANCE_PATH', 'TIMEZONE',
        'MSMTP_PATH', 'TLS_CERT_PATH'
    ]
    
    missing_vars = [var for var in required_vars if var not in settings]
    if missing_vars:
        raise ValueError(f"Missing required configuration variables: {', '.join(missing_vars)}")
    
    # Build absolute paths
    settings['INSTANCE_PATH'] = str(base_path / settings['INSTANCE_PATH'])
    settings['DB_PATH'] = str(base_path / settings['INSTANCE_PATH'] / settings['DB_NAME'])
    
    # Add DB_URI for SQLAlchemy
    settings['DB_URI'] = f"sqlite:///{settings['DB_PATH']}"
    
    # Create the instance directory if it doesn't exist
    instance_path = Path(settings['INSTANCE_PATH'])
    if not instance_path.exists():
        instance_path.mkdir(parents=True)
    
    return settings

# Load settings into module namespace
globals().update(load_settings())

def get_configured_timezone():
    """Get the configured timezone from settings"""
    global TIMEZONE
    return pytz.timezone(TIMEZONE)

# Export explicitly the variables we use in other modules
__all__ = [
    'TIMEZONE', 'DB_NAME', 'UPS_HOST', 'UPS_NAME',
    'UPS_COMMAND', 'COMMAND_TIMEOUT', 'CACHE_SECONDS',
    'LOG_FILE', 'get_configured_timezone',
    'LOG_LEVEL_DEBUG', 'LOG_LEVEL_INFO', 'SERVER_NAME'
] 