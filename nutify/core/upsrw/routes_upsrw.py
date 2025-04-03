from flask import render_template
from core.db.ups import get_ups_data
from core.settings import get_configured_timezone
from core.logger import ups_logger as logger

def register_routes(app):
    """Register all HTML routes for the upsrw section"""
    
    @app.route('/upsrw')
    def upsrw_page():
        """Page for managing UPS variables"""
        try:
            # Get UPS data as per other pages
            data = get_ups_data()
            return render_template('dashboard/upsrw.html', 
                                 data=data,
                                 timezone=get_configured_timezone())
        except Exception as e:
            logger.error(f"Error rendering UPSrw page: {str(e)}", exc_info=True)
            # In case of error, pass at least the device_model
            return render_template('dashboard/upsrw.html', 
                                 data={'device_model': 'UPS Monitor'}, 
                                 timezone=get_configured_timezone())
        
    return app 