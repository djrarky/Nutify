from datetime import datetime, timedelta
import pytz
from flask import Blueprint, request, jsonify
from core.logger import report_logger as logger
from core.settings import get_configured_timezone
from core.report.report import report_manager
from core.db.ups import db, data_lock

api_report = Blueprint('api_report', __name__)

@api_report.route('/api/report/generate', methods=['POST'])
def generate_report():
    """Generate a report for the specified time period"""
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({'status': 'error', 'message': 'No data provided'}), 400
        
        # Get time period from request
        from_date_str = data.get('from_date')
        to_date_str = data.get('to_date')
        report_type = data.get('report_type', 'custom')
        
        if not from_date_str or not to_date_str:
            return jsonify({'status': 'error', 'message': 'From date and to date are required'}), 400
        
        # Parse dates
        try:
            from_date = datetime.fromisoformat(from_date_str.replace('Z', '+00:00'))
            to_date = datetime.fromisoformat(to_date_str.replace('Z', '+00:00'))
        except ValueError as e:
            return jsonify({'status': 'error', 'message': f'Invalid date format: {str(e)}'}), 400
        
        # Generate the report
        result = report_manager.generate_report(from_date, to_date, report_type)
        
        if result.get('status') == 'success':
            return jsonify({
                'status': 'success',
                'html': result.get('html'),
                'data': result.get('data')
            })
        else:
            return jsonify({
                'status': 'error',
                'message': result.get('message', 'Failed to generate report')
            }), 500
            
    except Exception as e:
        logger.error(f"Error in generate_report API: {str(e)}", exc_info=True)
        return jsonify({'status': 'error', 'message': str(e)}), 500

@api_report.route('/api/report/send', methods=['POST'])
def send_report():
    """Generate and send a report via email"""
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({'status': 'error', 'message': 'No data provided'}), 400
        
        # Get time period and recipients from request
        from_date_str = data.get('from_date')
        to_date_str = data.get('to_date')
        recipients = data.get('recipients', [])
        report_type = data.get('report_type', 'custom')
        
        if not from_date_str or not to_date_str:
            return jsonify({'status': 'error', 'message': 'From date and to date are required'}), 400
        
        if not recipients or not isinstance(recipients, list) or len(recipients) == 0:
            return jsonify({'status': 'error', 'message': 'At least one recipient email is required'}), 400
        
        # Parse dates
        try:
            from_date = datetime.fromisoformat(from_date_str.replace('Z', '+00:00'))
            to_date = datetime.fromisoformat(to_date_str.replace('Z', '+00:00'))
        except ValueError as e:
            return jsonify({'status': 'error', 'message': f'Invalid date format: {str(e)}'}), 400
        
        # Send the report
        result = report_manager.send_report_email(from_date, to_date, recipients, report_type)
        
        if result.get('status') == 'success':
            return jsonify({
                'status': 'success',
                'message': result.get('message', 'Report sent successfully')
            })
        else:
            return jsonify({
                'status': 'error',
                'message': result.get('message', 'Failed to send report')
            }), 500
            
    except Exception as e:
        logger.error(f"Error in send_report API: {str(e)}", exc_info=True)
        return jsonify({'status': 'error', 'message': str(e)}), 500

@api_report.route('/api/report/schedule', methods=['GET'])
def get_report_schedules():
    """Get all report schedules"""
    try:
        schedules = report_manager.get_schedules()
        return jsonify({'status': 'success', 'schedules': schedules})
    except Exception as e:
        logger.error(f"Error in get_report_schedules API: {str(e)}", exc_info=True)
        return jsonify({'status': 'error', 'message': str(e)}), 500

@api_report.route('/api/report/schedule', methods=['POST'])
def save_report_schedule():
    """Save a report schedule configuration"""
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({'status': 'error', 'message': 'No data provided'}), 400
        
        # Save the schedule
        result = report_manager.save_schedule(data)
        
        if result.get('success'):
            return jsonify({
                'status': 'success',
                'id': result.get('id')
            })
        else:
            return jsonify({
                'status': 'error',
                'message': result.get('error', 'Failed to save schedule')
            }), 400
            
    except Exception as e:
        logger.error(f"Error in save_report_schedule API: {str(e)}", exc_info=True)
        return jsonify({'status': 'error', 'message': str(e)}), 500

@api_report.route('/api/report/schedule/<int:schedule_id>', methods=['DELETE'])
def delete_report_schedule(schedule_id):
    """Delete a report schedule"""
    try:
        result = report_manager.delete_schedule(schedule_id)
        
        if result.get('success'):
            return jsonify({'status': 'success'})
        else:
            return jsonify({
                'status': 'error',
                'message': result.get('error', 'Failed to delete schedule')
            }), 400
            
    except Exception as e:
        logger.error(f"Error in delete_report_schedule API: {str(e)}", exc_info=True)
        return jsonify({'status': 'error', 'message': str(e)}), 500 