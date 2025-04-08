"""
Events API endpoints for managing UPS events and alerts.
"""

from flask import jsonify, request
from ..logger import web_logger as logger
from ..upsmon import handle_nut_event, get_events_table, acknowledge_event, get_event_history
from ..db.ups import data_lock, db

def register_api_routes(app):
    """Register events API routes with the Flask application."""
    
    # Import UPSEvent inside function to avoid circular imports
    from ..db.ups import UPSEvent
    from ..db.model_classes import ModelClasses
    
    # Helper function to ensure UPSEvent is initialized
    def _ensure_event_model():
        nonlocal UPSEvent
        if UPSEvent is None and hasattr(db, 'ModelClasses'):
            UPSEvent = db.ModelClasses.UPSEvent
            logger.debug("UPSEvent model initialized from ModelClasses")
        return UPSEvent is not None

    @app.route('/api/nut_event', methods=['POST'])
    def nut_event():
        """Handles NUT events"""
        try:
            if not request.is_json:
                logger.error("No JSON data received")
                return jsonify({"status": "error", "message": "No JSON data received"}), 400
            
            data = request.get_json()
            return handle_nut_event(app, data)
            
        except Exception as e:
            logger.error(f"Error: {str(e)}", exc_info=True)
            return jsonify({"status": "error", "message": str(e)}), 500

    @app.route('/api/nut_history')
    def nut_history():
        """Returns the NUT event history"""
        try:
            return get_event_history(app)
        except Exception as e:
            logger.error(f"Error getting NUT history: {str(e)}")
            return jsonify([]), 200  # Returns an empty list in case of error

    @app.route('/api/table/events', methods=['GET', 'POST'])
    def get_events_table_route():
        """API to get and manage events"""
        if request.method == 'GET':
            try:
                rows = request.args.get('rows', 'all')
                table_data = get_events_table(rows)
                return jsonify(table_data)
            except Exception as e:
                logger.error(f"Error getting events: {str(e)}", exc_info=True)
                return jsonify({'error': str(e)}), 500

        elif request.method == 'POST':
            try:
                event_id = request.json.get('event_id')
                success, message = acknowledge_event(event_id)
                if success:
                    return jsonify({"status": "ok"})
                return jsonify({"status": "error", "message": message}), 404
            except Exception as e:
                logger.error(f"Error acknowledging event: {str(e)}", exc_info=True)
                return jsonify({'status': 'error', 'message': str(e)}), 500

    @app.route('/api/events/acknowledge/<int:event_id>', methods=['POST'])
    def acknowledge_event_route(event_id):
        """Acknowledges an event"""
        try:
            if not _ensure_event_model():
                return jsonify({'success': False, 'message': 'UPSEvent model not initialized'}), 500
                
            with data_lock:
                event = UPSEvent.query.get(event_id)
                if event:
                    event.acknowledged = True
                    db.session.commit()
                    return jsonify({'success': True, 'message': 'Event acknowledged successfully'})
                return jsonify({'success': False, 'message': 'Event not found'}), 404
        except Exception as e:
            logger.error(f"Error acknowledging event: {str(e)}")
            return jsonify({'success': False, 'message': str(e)}), 500

    @app.route('/api/events/delete/<int:event_id>', methods=['DELETE'])
    def delete_event_route(event_id):
        """Deletes an event from the database"""
        try:
            if not _ensure_event_model():
                return jsonify({'success': False, 'message': 'UPSEvent model not initialized'}), 500
                
            with data_lock:
                event = UPSEvent.query.get(event_id)
                if event:
                    db.session.delete(event)
                    db.session.commit()
                    return jsonify({'success': True, 'message': 'Event deleted successfully'})
                return jsonify({'success': False, 'message': 'Event not found'}), 404
        except Exception as e:
            logger.error(f"Error deleting event: {str(e)}")
            return jsonify({'success': False, 'message': str(e)}), 500

    @app.route('/api/events/acknowledge/bulk', methods=['POST'])
    def acknowledge_events_bulk():
        """Acknowledges multiple events"""
        try:
            if not _ensure_event_model():
                return jsonify({'success': False, 'message': 'UPSEvent model not initialized'}), 500
                
            data = request.get_json()
            event_ids = data.get('event_ids', [])
            
            if not event_ids:
                return jsonify({'success': False, 'message': 'No events specified'}), 400
                
            with data_lock:
                events = UPSEvent.query.filter(UPSEvent.id.in_(event_ids)).all()
                for event in events:
                    event.acknowledged = True
                db.session.commit()
                return jsonify({'success': True, 'message': f'{len(events)} events acknowledged successfully'})
        except Exception as e:
            logger.error(f"Error acknowledging events in bulk: {str(e)}")
            return jsonify({'success': False, 'message': str(e)}), 500

    @app.route('/api/events/delete/bulk', methods=['DELETE'])
    def delete_events_bulk():
        """Deletes multiple events from the database"""
        try:
            if not _ensure_event_model():
                return jsonify({'success': False, 'message': 'UPSEvent model not initialized'}), 500
                
            data = request.get_json()
            event_ids = data.get('event_ids', [])
            
            if not event_ids:
                return jsonify({'success': False, 'message': 'No events specified'}), 400
                
            with data_lock:
                events = UPSEvent.query.filter(UPSEvent.id.in_(event_ids)).all()
                for event in events:
                    db.session.delete(event)
                db.session.commit()
                return jsonify({'success': True, 'message': f'{len(events)} events deleted successfully'})
        except Exception as e:
            logger.error(f"Error deleting events in bulk: {str(e)}")
            return jsonify({'success': False, 'message': str(e)}), 500

    @app.route('/api/events/delete/all', methods=['DELETE'])
    def delete_all_events():
        """Deletes all events from the database"""
        try:
            if not _ensure_event_model():
                return jsonify({'success': False, 'message': 'UPSEvent model not initialized'}), 500
                
            with data_lock:
                # First count how many events we're deleting
                count = UPSEvent.query.count()
                
                # Delete all events
                UPSEvent.query.delete()
                db.session.commit()
                
                return jsonify({'success': True, 'message': f'All {count} events deleted successfully'})
        except Exception as e:
            logger.error(f"Error deleting all events: {str(e)}")
            return jsonify({'success': False, 'message': str(e)}), 500

    return app 