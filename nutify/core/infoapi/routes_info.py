"""
API Information routes module.

This module provides web routes for the API documentation page.
"""
from flask import render_template, Blueprint
from core.db.ups import get_ups_data, create_static_model, get_ups_model
from core.settings import get_configured_timezone
from datetime import datetime
from core.logger import web_logger as logger

# Create a Flask Blueprint
routes_info = Blueprint('routes_info', __name__)

@routes_info.route('/api')
def api_page():
    """Render the API documentation page"""
    try:
        data = get_ups_data()
        UPSStaticData = create_static_model()
        UPSDynamicData = get_ups_model()
        
        static_count = UPSStaticData.query.count()
        dynamic_count = UPSDynamicData.query.count()
        
        static_data = UPSStaticData.query.first()
        dynamic_data = UPSDynamicData.query.order_by(UPSDynamicData.timestamp_tz.desc()).first()
        
        schema = {
            'static': {
                'name': UPSStaticData.__tablename__,
                'record_count': static_count,
                'columns': []
            },
            'dynamic': {
                'name': UPSDynamicData.__tablename__,
                'record_count': dynamic_count,
                'columns': []
            }
        }
        
        if static_data:
            for column in UPSStaticData.__table__.columns:
                value = getattr(static_data, column.name)
                if isinstance(value, datetime):
                    value = value.isoformat()
                schema['static']['columns'].append({
                    'name': column.name,
                    'type': str(column.type),
                    'current_value': value
                })
        
        if dynamic_data:
            for column in UPSDynamicData.__table__.columns:
                value = getattr(dynamic_data, column.name)
                if isinstance(value, datetime):
                    value = value.isoformat()
                schema['dynamic']['columns'].append({
                    'name': column.name,
                    'type': str(column.type),
                    'current_value': value
                })
        
        return render_template('dashboard/api.html', 
                             schema=schema,
                             data=data,
                             timezone=get_configured_timezone())
    except Exception as e:
        logger.error(f"Error rendering API page: {str(e)}", exc_info=True)
        return render_template('dashboard/api.html', 
                             schema={},
                             data={'device_model': 'UPS Monitor'},
                             timezone=get_configured_timezone()) 