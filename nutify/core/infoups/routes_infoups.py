#!/usr/bin/env python3
"""
UPS Information Routes

This module provides routes for displaying detailed UPS information.
"""

from flask import render_template
from . import routes_infoups
from core.db.ups import get_ups_data

def register_routes():
    """
    Register routes for the UPS information module
    """
    # No additional initialization required
    pass

@routes_infoups.route('/ups_info')
def ups_info_page():
    """Render the UPS static information page"""
    data = get_ups_data()
    return render_template('dashboard/ups_info.html', data=data) 