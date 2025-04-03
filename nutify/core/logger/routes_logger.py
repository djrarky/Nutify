from flask import Blueprint, render_template, request, jsonify, current_app
from .logger import get_logger
from core.settings import LOG, LOG_LEVEL, LOG_WERKZEUG
import os
import re

logger = get_logger('web')
routes_logger = Blueprint('routes_logger', __name__)

@routes_logger.route('/logs')
def logs():
    """Render the logs management page"""
    return render_template('logs.html')

@routes_logger.route('/logs/view')
def logs_view():
    """
    View logs for the specified log type.
    Query parameters:
      - type: log type (default system)
      - level: log level (default all)
      - range: date range (default all)
    """
    from core.options.options import get_filtered_logs
    
    log_type = request.args.get('type', 'system')
    log_level = request.args.get('level', 'all')
    date_range = request.args.get('range', 'all')
    
    # Get the logs
    logs_data = get_filtered_logs(
        log_type=log_type,
        log_level=log_level,
        date_range=date_range
    )
    
    return render_template(
        'logs_view.html', 
        logs=logs_data,
        selected_type=log_type,
        selected_level=log_level,
        selected_range=date_range
    ) 