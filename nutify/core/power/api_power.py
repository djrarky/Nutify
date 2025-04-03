from flask import jsonify, request, render_template
from datetime import datetime, timedelta
from core.logger import power_logger as logger
from core.settings import get_configured_timezone, TIMEZONE
from core.db.ups import get_ups_data, get_ups_model
from .power import (
    get_available_power_metrics,
    get_power_stats,
    get_power_history,
    format_ups_status
)

logger.info("💪 Initializing power API routes")

def register_api_routes(app):
    """
    Register all API routes related to power data.
    
    Args:
        app: The Flask application instance.
        
    Returns:
        app: Modified Flask application with power routes registered.
    """
    @app.route('/power')
    def power_page():
        """
        Render the Power Management page.
        Obtains UPS data, available power metrics, statistics and history data,
        then renders the 'dashboard/power.html' template.
        """
        data = get_ups_data()
        metrics = get_available_power_metrics()
        stats = get_power_stats()
        history = get_power_history()
        
        # Import UPS_REALPOWER_NOMINAL from settings
        from core.settings import UPS_REALPOWER_NOMINAL
        
        # Format UPS status if available
        formatted_status = None
        if hasattr(data, 'ups_status') and data.ups_status:
            formatted_status = format_ups_status(data.ups_status)
        
        return render_template('dashboard/power.html',
                               data=data,
                               metrics=metrics,
                               stats=stats,
                               history=history,
                               timezone=TIMEZONE,
                               ups_nominal_power=UPS_REALPOWER_NOMINAL,
                               formatted_status=formatted_status)

    @app.route('/api/power/metrics')
    def api_power_metrics():
        """
        API endpoint to retrieve available power metrics.
        
        Returns:
            JSON response with a dictionary of available power metrics.
        """
        metrics = get_available_power_metrics()
        return jsonify({'success': True, 'data': metrics})

    @app.route('/api/power/stats')
    def api_power_stats():
        """
        API endpoint to retrieve power statistics.
        
        Query parameters:
          - period: The time period type ('day', 'range', etc.)
          - from_time, to_time: Time range (if applicable)
          - selected_date: Specific date (if applicable)
          
        Returns:
            JSON response with a dictionary of power statistics.
        """
        period = request.args.get('period', 'day')
        from_time = request.args.get('from_time')
        to_time = request.args.get('to_time')
        
        # Log the request for debugging
        logger.debug(f"Power stats API request: period={period}, from_time={from_time}, to_time={to_time}")
        
        # For 'today' period, explicitly call get_power_stats with today's date
        if period == 'today':
            tz = get_configured_timezone()
            today = datetime.now(tz)
            logger.debug(f"Using explicit TODAY period for power stats, date: {today.date()}")
            stats = get_power_stats(period='today')
        elif period == 'day':
            selected_date = request.args.get('selected_date')
            tz = get_configured_timezone()
            if selected_date:
                try:
                    selected_date_dt = datetime.strptime(selected_date, '%Y-%m-%d')
                    if selected_date_dt.tzinfo is None:
                        selected_date_dt = tz.localize(selected_date_dt)
                except ValueError:
                    logger.error(f"Invalid selected_date format: {selected_date}")
                    selected_date_dt = datetime.now(tz)
            else:
                selected_date_dt = datetime.now(tz)
            stats = get_power_stats(period, from_time, to_time, selected_date_dt)
        else:
            stats = get_power_stats(period, from_time, to_time)
        return jsonify({'success': True, 'data': stats})

    @app.route('/api/power/history')
    def api_power_history():
        """API for historical data"""
        period = request.args.get('period', 'day')
        from_time = request.args.get('from_time')
        to_time = request.args.get('to_time')
        selected_day = request.args.get('selected_day')
        
        # Log the incoming request for debugging
        logger.debug(f"Power history API request: period={period}, from_time={from_time}, to_time={to_time}, selected_day={selected_day}")
        
        # For 'today' period, pass it directly to get_power_history
        if period == 'today':
            history = get_power_history(period='today')
            logger.debug("Using explicit TODAY period for power history")
        else:
            history = get_power_history(period, from_time, to_time, selected_day)
            
        return jsonify({'success': True, 'data': history})

    @app.route('/api/power/has_hour_data')
    def api_power_has_hour_data():
        """
        API endpoint to check if there is at least 60 minutes of power data.
        
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
            
            # Query to find records in the last hour with valid power data
            # Looking for ups_realpower (direct measure) or ups_load (indirect measure)
            data = UPSDynamicData.query\
                .filter(
                    UPSDynamicData.timestamp_tz >= one_hour_ago,
                    UPSDynamicData.timestamp_tz <= now,
                    (UPSDynamicData.ups_realpower.isnot(None) | 
                     UPSDynamicData.ups_load.isnot(None))
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