from flask import render_template, jsonify, request, send_file, redirect, url_for
from flask_socketio import emit
from .db.ups import (
    get_ups_data, 
    get_ups_model, 
    create_static_model,
    data_lock, 
    db
)
from .upsmon import handle_nut_event, get_event_history, get_events_table, acknowledge_event
import datetime
import json
import os
import logging
from datetime import datetime
import configparser
import pytz
from .energy.routes_energy import register_routes as register_energy_routes
from .battery.routes_battery import register_routes as register_battery_routes
from .power.routes_power import register_routes as register_power_routes
from .voltage.routes_voltage import register_routes as register_voltage_routes
from .voltage.api_voltage import register_api_routes as register_voltage_api_routes
from .upscmd.routes_upscmd import register_routes as register_upscmd_routes
from .upsrw.routes_upsrw import register_routes as register_upsrw_routes
from .advanced.routes_advanced import register_routes as register_advanced_routes
from .options import api_options, api_options_compat, routes_options
from core.options import (
    get_database_stats, get_log_files, get_system_info,
    get_filtered_logs, optimize_database, vacuum_database, backup_database, clear_logs
)
from core.logger import web_logger as logger
from core.settings import LOG, LOG_LEVEL, LOG_WERKZEUG, get_configured_timezone
import base64
from core.events import routes_events
from core.infoapi import routes_info
from core.infoups.routes_infoups import routes_infoups
logger.info("📡 Initializing routes")

def register_routes(app):
    """Registers all web routes for the application"""
    
    register_energy_routes(app)
    register_battery_routes(app)
    register_power_routes(app)
    register_voltage_routes(app)
    register_voltage_api_routes(app)
    register_upscmd_routes(app)
    register_upsrw_routes(app)
    register_advanced_routes(app)
    
    # Register options blueprints
    app.register_blueprint(api_options)
    app.register_blueprint(api_options_compat)  # Register compatibility routes
    app.register_blueprint(routes_options)
    
    # Register events blueprint
    app.register_blueprint(routes_events)
    
    # Register infoapi blueprint for API documentation
    app.register_blueprint(routes_info)
    app.register_blueprint(routes_infoups)
    
    @app.route('/')
    @app.route('/index')
    def index():
        """Render the main page"""
        data = get_ups_data()
        return render_template('dashboard/main.html', 
                             data=data,
                             timezone=get_configured_timezone())
    
    @app.route('/websocket-test')
    def websocket_test():
        """Render the WebSocket test page"""
        data = get_ups_data()  # Get UPS data for the header
        return render_template('dashboard/websocket_test.html',
                             title='WebSocket Test',
                             data=data,
                             timezone=get_configured_timezone())

    return app