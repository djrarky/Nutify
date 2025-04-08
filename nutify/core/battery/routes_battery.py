from flask import render_template
from core.logger import battery_logger as logger
from core.settings import TIMEZONE
from core.db.ups import get_ups_data
from .battery import (
    get_available_battery_metrics, 
    get_battery_stats, 
    calculate_battery_health,
    format_ups_status,
    format_battery_type
)

# Import functions from battery module
logger.info("🔋 Initializing battery routes")

def register_routes(app):
    """Register all routes related to the battery"""
    
    @app.route('/battery')
    def battery_page():
        """Render the battery page"""
        data = get_ups_data()
        metrics = get_available_battery_metrics()
        stats = get_battery_stats()
        battery_health = calculate_battery_health(metrics) if metrics else None
        
        # Format UPS status and battery type
        formatted_status = None
        formatted_battery_type = None
        
        if hasattr(data, 'ups_status') and data.ups_status:
            formatted_status = format_ups_status(data.ups_status)
        
        if hasattr(data, 'battery_type') and data.battery_type:
            formatted_battery_type = format_battery_type(data.battery_type)
        
        return render_template('dashboard/battery.html', 
                             data=data,
                             metrics=metrics,
                             stats=stats,
                             battery_health=battery_health,
                             timezone=TIMEZONE,
                             formatted_status=formatted_status,
                             formatted_battery_type=formatted_battery_type)
    
    return app 