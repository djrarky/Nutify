from flask import jsonify, request, render_template
from core.logger import voltage_logger as logger
from core.db.ups import get_ups_data
from core.settings import TIMEZONE
from .voltage import get_available_voltage_metrics, get_voltage_stats, get_voltage_history

logger.info("🔌 Initializing voltage routes")

def register_routes(app):
    """Register all routes related to voltage"""
    
    @app.route('/voltage')
    def voltage_page():
        """Render the voltage page"""
        data = get_ups_data()
        metrics = get_available_voltage_metrics()
        return render_template('dashboard/voltage.html',
                             data=data,
                             metrics=metrics,
                             timezone=TIMEZONE)

    return app 