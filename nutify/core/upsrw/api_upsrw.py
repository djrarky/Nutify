from flask import jsonify, request
from core.logger import ups_logger as logger

# Import functions from upsrw module
from .upsrw import (
    get_ups_variables,
    set_ups_variable,
    get_variable_history,
    clear_variable_history
)

def register_api_routes(app):
    """Register all API routes for the upsrw section"""
    
    @app.route('/api/upsrw/list')
    def api_upsrw_list():
        """API to get the list of variables"""
        variables = get_ups_variables()
        return jsonify({
            'success': True,
            'variables': variables
        })
    
    @app.route('/api/upsrw/set', methods=['POST'])
    def api_upsrw_set():
        """API to set a variable"""
        data = request.get_json()
        name = data.get('name')
        value = data.get('value')
        
        if not name or value is None:
            return jsonify({
                'success': False,
                'error': 'Name and value are required'
            })
        
        success, message = set_ups_variable(name, value)
        return jsonify({
            'success': success,
            'message': message
        })
    
    @app.route('/api/upsrw/history')
    def api_upsrw_history():
        """API to get the variable history"""
        try:
            history = get_variable_history()
            return jsonify({
                'success': True,
                'history': history
            })
        except Exception as e:
            logger.error(f"Error getting variable history: {str(e)}")
            return jsonify({
                'success': False,
                'error': str(e)
            })
            
    @app.route('/api/upsrw/history/<variable>')
    def api_upsrw_history_variable(variable):
        """API to get the history of a specific variable"""
        try:
            history = get_variable_history(variable)
            return jsonify({
                'success': True,
                'history': history
            })
        except Exception as e:
            logger.error(f"Error getting variable history: {variable} {str(e)}")
            return jsonify({
                'success': False,
                'error': str(e)
            })
        
    @app.route('/api/upsrw/clear-history', methods=['POST'])
    def api_upsrw_clear_history():
        """API to clear the history"""
        try:
            success = clear_variable_history()
            return jsonify({
                'success': success
            })
        except Exception as e:
            logger.error(f"Error clearing history: {str(e)}")
            return jsonify({
                'success': False,
                'error': str(e)
            })
    
    return app 