from flask import jsonify, request
from datetime import datetime, timedelta
from core.logger import voltage_logger as logger
from core.db.ups import get_ups_data, get_ups_model
from core.settings import get_configured_timezone
from .voltage import get_available_voltage_metrics, get_voltage_stats, get_voltage_history

logger.info("🔌 Initializing voltage API routes")

def register_api_routes(app):
    """Register all API routes related to voltage"""
    
    @app.route('/api/voltage/metrics')
    def get_voltage_metrics():
        try:
            metrics = {}
            ups_data = get_ups_data()
            
            # Complete list of metrics to monitor
            voltage_metrics = [
                'input_voltage', 'output_voltage',
                'input_voltage_nominal', 'output_voltage_nominal',
                'input_transfer_low', 'input_transfer_high',
                'input_current', 'output_current',
                'input_frequency', 'output_frequency',
                'input_sensitivity', 'ups_status', 'ups_load',
                'input_frequency_nominal', 'output_frequency_nominal'
            ]
            
            # Map all available metrics
            for metric in voltage_metrics:
                if hasattr(ups_data, metric):
                    try:
                        value = getattr(ups_data, metric)
                        if value is not None:
                            if metric in ['ups_status', 'input_sensitivity']:
                                metrics[metric] = str(value)
                            else:
                                metrics[metric] = float(value)
                    except (ValueError, TypeError):
                        continue
            
            return jsonify({'success': True, 'data': metrics})
        except Exception as e:
            return jsonify({'success': False, 'error': str(e)})
    
    @app.route('/api/voltage/stats')
    def api_voltage_stats():
        """API for voltage statistics"""
        period = request.args.get('period', 'day')
        from_time = request.args.get('from_time')
        to_time = request.args.get('to_time')
        stats = get_voltage_stats(period, from_time, to_time)
        return jsonify({'success': True, 'data': stats})
    
    @app.route('/api/voltage/history')
    def api_voltage_history():
        """API for the data history"""
        period = request.args.get('period', 'day')
        from_time = request.args.get('from_time')
        to_time = request.args.get('to_time')
        selected_day = request.args.get('selected_day')
        
        history = get_voltage_history(period, from_time, to_time, selected_day)
        return jsonify({'success': True, 'data': history})

    @app.route('/api/voltage/has_hour_data')
    def api_voltage_has_hour_data():
        """
        API endpoint to check if there is at least 60 minutes of voltage data.
        
        Returns:
            JSON response with a boolean indicating if enough data exists.
        """
        try:
            UPSDynamicData = get_ups_model()
            tz = get_configured_timezone()
            
            # Get current time in configured timezone
            now = datetime.now(tz)
            
            # Calculate time one hour ago
            one_hour_ago = now - timedelta(hours=1)
            
            # First try with input_voltage
            data = UPSDynamicData.query\
                .filter(
                    UPSDynamicData.timestamp_tz >= one_hour_ago,
                    UPSDynamicData.timestamp_tz <= now,
                    UPSDynamicData.input_voltage.isnot(None)
                ).order_by(UPSDynamicData.timestamp_tz.asc()).all()
            
            # If no input_voltage data found, try with input_voltage_nominal
            if not data:
                logger.debug("No input_voltage data found, trying input_voltage_nominal instead")
                data = UPSDynamicData.query\
                    .filter(
                        UPSDynamicData.timestamp_tz >= one_hour_ago,
                        UPSDynamicData.timestamp_tz <= now,
                        UPSDynamicData.input_voltage_nominal.isnot(None)
                    ).order_by(UPSDynamicData.timestamp_tz.asc()).all()
            
            # Get the count of data points
            data_count = len(data)
            
            # Check if we have at least 30 data points (minimum threshold)
            if data_count < 30:
                logger.debug(f"Insufficient data points: {data_count} < 30")
                return jsonify({'has_data': False})
            
            # Check if we have data spanning at least 50 minutes
            if data:
                timestamps = [record.timestamp_tz for record in data]
                first_timestamp = min(timestamps)
                last_timestamp = max(timestamps)
                
                time_span_minutes = (last_timestamp - first_timestamp).total_seconds() / 60
                
                logger.debug(f"Data time span: {time_span_minutes} minutes with {data_count} points")
                
                # Require at least 50 minutes of data
                has_sufficient_data = time_span_minutes >= 50
                
                return jsonify({'has_data': has_sufficient_data})
            
            return jsonify({'has_data': False})
            
        except Exception as e:
            logger.error(f"Error checking for hour data: {str(e)}")
            return jsonify({'has_data': False, 'error': str(e)})

    return app 