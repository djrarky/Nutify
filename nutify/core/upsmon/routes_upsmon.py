from flask import Blueprint, render_template, request, jsonify, current_app
from .upsmon_client import logger

routes_upsmon = Blueprint('routes_upsmon', __name__)

# The '/events' route is now handled by the routes_events blueprint
# @routes_upsmon.route('/events')
# def events_page():
#     """Render the events page"""
#     logger.info("Accessing events page")
#     return render_template('dashboard/events.html')

@routes_upsmon.route('/events/view')
def events_view():
    """Render the events view page"""
    logger.info("Accessing events view page")
    return render_template('dashboard/events_view.html') 