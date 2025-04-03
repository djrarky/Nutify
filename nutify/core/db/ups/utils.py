"""
UPS Utility Functions Module.
This module provides utility functions for UPS operations.
"""

import logging
import subprocess
import threading
import pytz
from datetime import datetime

from core.settings import TIMEZONE
from core.logger import database_logger as logger

# UPS Configuration class (singleton)
# NOTE: We use a singleton pattern here to ensure that UPS configuration remains
# consistent across all parts of the application, avoiding issues with module-level
# variables being reset between different modules or during import.
class UPSConfig:
    _instance = None
    
    def __new__(cls):
        if cls._instance is None:
            cls._instance = super(UPSConfig, cls).__new__(cls)
            cls._instance.host = None
            cls._instance.name = None
            cls._instance.command = None
            cls._instance.timeout = None
            cls._instance.initialized = False
        return cls._instance
    
    def configure(self, host, name, command, timeout):
        """Configure the UPS connection parameters"""
        self.host = host
        self.name = name
        self.command = command
        self.timeout = timeout
        self.initialized = bool(host and name and command)
        logger.debug(f"🔌 UPS configuration updated in singleton: host={self.host}, name={self.name}, command={self.command}, timeout={self.timeout}, initialized={self.initialized}")
        return self.initialized
    
    def is_initialized(self):
        """Check if UPS configuration is initialized"""
        return self.initialized and bool(self.host and self.name and self.command)
    
    def __str__(self):
        return f"UPSConfig(host={self.host}, name={self.name}, command={self.command}, timeout={self.timeout}, initialized={self.initialized})"

# Global instance
ups_config = UPSConfig()

# Locks for synchronization
ups_lock = threading.Lock()
data_lock = threading.Lock()

class DotDict:
    """
    Utility class to access dictionaries as objects
    Example: instead of dict['key'] allows dict.key
    """
    def __init__(self, dictionary):
        for key, value in dictionary.items():
            setattr(self, key, value)

# Alias DotDict as UPSData for better semantics
UPSData = DotDict

def configure_ups(host, name, command, timeout):
    """
    Configure the UPS connection parameters
    
    Args:
        host: Hostname or IP of the UPS
        name: Name of the UPS in the NUT system
        command: Command to use (e.g. 'upsc')
        timeout: Timeout in seconds for commands
    """
    # Debug logs to verify parameter values
    logger.debug(f"🔌 Setting UPS configuration: host={host}, name={name}, command={command}, timeout={timeout}")
    
    # Configure the singleton instance
    success = ups_config.configure(host, name, command, timeout)
    
    # Verify the configuration was set properly
    logger.debug(f"🔌 UPS configuration after setting: {ups_config}")
    logger.info(f"UPS configuration updated: host={host}, name={name}")
    return success

def get_configured_timezone():
    """
    Read the timezone from the centralized configuration
    
    Returns:
        timezone: Configured timezone or UTC if configuration fails
    """
    try:
        return pytz.timezone(TIMEZONE)
    except Exception as e:
        logger.error(f"Error setting timezone {TIMEZONE}: {e}. Using UTC.")
        return pytz.UTC

def get_supported_value(data, field, default='N/A'):
    """
    Get a value from the UPS data with missing value handling
    
    Args:
        data: Object containing the UPS data
        field: Name of the field to retrieve
        default: Default value if the field doesn't exist
    
    Returns:
        The value of the field or the default value
    """
    try:
        value = getattr(data, field, None)
        if value is not None and value != '':
            return value
        return default
    except AttributeError:
        return default

def calculate_realpower(data):
    """
    Calculate ups_realpower (real power) using the direct formula:
    Power = realpower_nominal * (ups.load/100)
    Use the value from the configuration if not available from the UPS
    
    Cases handled:
    1. Key doesn't exist (ups.realpower or ups_realpower) -> Calculate value
    2. Key exists but value is 0 -> Calculate value
    3. Key exists with non-zero value -> Keep existing value
    
    Args:
        data: Dictionary containing UPS data
        
    Returns:
        Updated data dictionary with calculated realpower
    """
    try:
        from core.settings import UPS_REALPOWER_NOMINAL
        
        # Check both possible key formats (with dot or underscore)
        dot_key = 'ups.realpower'
        underscore_key = 'ups_realpower'
        
        # Get current value (if exists)
        current_value = None
        if dot_key in data:
            current_value = data[dot_key]
        elif underscore_key in data:
            current_value = data[underscore_key]
        
        # Calculate only if value doesn't exist or is 0
        if current_value is None or float(current_value) == 0:
            # Get load value, checking both formats
            load_value = None
            if 'ups.load' in data:
                load_value = data['ups.load']
            elif 'ups_load' in data:
                load_value = data['ups_load']
            
            load_percent = float(load_value if load_value is not None else 0)
            
            # Get nominal power, checking all possible keys
            nominal_value = None
            if 'ups.realpower.nominal' in data:
                nominal_value = data['ups.realpower.nominal']
            elif 'ups_realpower_nominal' in data:
                nominal_value = data['ups_realpower_nominal']
            elif 'UPS_REALPOWER_NOMINAL' in data:
                nominal_value = data['UPS_REALPOWER_NOMINAL']
            
            nominal_power = float(nominal_value if nominal_value is not None else UPS_REALPOWER_NOMINAL)
            
            # Calculate real power
            if load_percent > 0 and nominal_power > 0:
                realpower = (nominal_power * load_percent) / 100
                
                # Update both key versions for compatibility
                data[dot_key] = str(round(realpower, 2))
                data[underscore_key] = str(round(realpower, 2))
                
                logger.debug(f"Calculated realpower: {realpower:.2f}W (nominal={nominal_power}W, load={load_percent}%)")
            else:
                logger.warning(f"Cannot calculate realpower: load={load_percent}%, nominal={nominal_power}W")
    except Exception as e:
        logger.error(f"Error calculating realpower: {str(e)}", exc_info=True)
    
    return data 