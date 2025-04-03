from flask import render_template
from core.db.ups import get_ups_data
from core.settings import get_configured_timezone
from core.logger import ups_logger as logger

def register_routes(app):
    """Register all HTML routes for the upscmd section"""
    
    @app.route('/upscmd')
    def upscmd_page():
        """Page for managing UPS commands"""
        data = get_ups_data()
        return render_template('dashboard/upscmd.html', 
                              title='UPS Commands', 
                              data=data,
                              timezone=get_configured_timezone())
        
    return app 