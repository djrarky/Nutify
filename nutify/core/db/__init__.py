"""
Database module initialization.
This module initializes the database and provides access to the
database models and utility functions.

IMPORTANT NOTE:
The tables ups_static_data and ups_dynamic_data are managed exclusively 
by core/db_module.py and not by this module's initialization process.
"""

from flask_sqlalchemy import SQLAlchemy
import logging
import os

from .initializer import init_database
from .integrity import check_database_integrity

logger = logging.getLogger(__name__)

# Model container
_models = {}

# Provide access to the models
def get_models():
    """
    Get the initialized model classes.
    
    Returns:
        dict: Dictionary of model classes
    """
    return _models

# Export models
__all__ = [
    'init_database', 'get_models',
    'check_database_integrity'
] 