from flask import Flask, render_template, request, jsonify, send_from_directory
from flask_socketio import SocketIO, emit
import datetime
import logging
import os
import sys
import threading
import time
from flask_talisman import Talisman
import json
import eventlet
from collections import deque
from statistics import mean
import pytz
eventlet.monkey_patch()
import warnings

from core.db.ups import (
    db, configure_ups, save_ups_data, get_ups_data, get_ups_model, 
    data_lock, socketio as db_socketio, get_event_type, handle_ups_event, 
    UPSError, UPSConnectionError, UPSCommandError, UPSDataError, UPSData, 
    UPSCommand, VariableConfig, ups_data_cache
)
from core.db.initializer import init_database
from core.routes import register_routes
from core.api import register_api_routes
from core.energy.api_energy import register_api_routes as register_energy_api_routes
from core.battery.api_battery import register_api_routes as register_battery_api_routes
from core.advanced.api_advanced import register_api_routes as register_advanced_api_routes
from core.mail import init_notification_settings
from core.mail.api_mail import register_mail_api_routes
from core.settings import (
    UPS_HOST, UPS_NAME, UPS_COMMAND, COMMAND_TIMEOUT,
    DEBUG_MODE, SERVER_PORT, SERVER_HOST,
    DB_NAME, LOG_LEVEL, LOG_FILE, LOG_FILE_ENABLED,
    LOG_FORMAT, LOG_LEVEL_DEBUG, LOG_LEVEL_INFO,
    TIMEZONE, INSTANCE_PATH, DB_URI, get_configured_timezone, LOG_WERKZEUG,
    SSL_ENABLED, SSL_CERT, SSL_KEY
)
from core.settings.api_settings import api_settings
from core.settings.routes_settings import routes_settings
from werkzeug.serving import WSGIRequestHandler
from core.logger import system_logger as logger
from core.logger import routes_logger, api_logger
from core.socket import socketio
from core.upsmon import api_upsmon, routes_upsmon
from core.scheduler import scheduler, register_scheduler_routes
from core.logger.api_logger import api_logger
from core.logger.routes_logger import routes_logger
from core.db.model_classes import register_models_for_global_access
# Import options blueprints - but don't register them here as they are registered in routes.py
from core.options.api_options import api_options
from core.options.routes_options import routes_options

# Configuring logging
log_format = LOG_FORMAT
handlers = [logging.StreamHandler()]

if LOG_FILE_ENABLED:
    handlers.append(logging.FileHandler(LOG_FILE))

# Flask initialization
app = Flask(__name__, instance_path=INSTANCE_PATH)

# Flask configuration
app.config['TEMPLATES_AUTO_RELOAD'] = True
app.config['SEND_FILE_MAX_AGE_DEFAULT'] = 0
app.config['SECRET_KEY'] = 'your_secret_key_here'
app.events_log = []

# Talisman configuration
Talisman(app, 
    force_https=SSL_ENABLED,
    content_security_policy=None
)

# Database configuration
app.config['INSTANCE_PATH'] = INSTANCE_PATH
app.config['SQLALCHEMY_DATABASE_URI'] = DB_URI
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
app.config['JSONIFY_PRETTYPRINT_REGULAR'] = True
app.config['JSON_SORT_KEYS'] = False
app.json.compact = False

# Components initialization
db.init_app(app)
socketio.init_app(app, 
    cors_allowed_origins="*",
    async_mode='eventlet'
)
register_routes(app)
register_api_routes(app, layouts_file='layouts.json')
register_energy_api_routes(app)
register_battery_api_routes(app)
register_advanced_api_routes(app)
register_scheduler_routes(app)
app.register_blueprint(api_logger)
app.register_blueprint(routes_logger)
app.register_blueprint(api_settings)
app.register_blueprint(routes_settings)
app.register_blueprint(api_upsmon)
app.register_blueprint(routes_upsmon)
# Options blueprints are registered in routes.py
# app.register_blueprint(api_options)
# app.register_blueprint(routes_options)

# Werkzeug log control
if isinstance(LOG_WERKZEUG, bool):
    use_werkzeug = LOG_WERKZEUG

if not use_werkzeug:
    logging.getLogger('werkzeug').disabled = True

@app.template_filter('isoformat')
def isoformat_filter(value):
    """Converts a datetime object to ISO string with timezone"""
    tz = get_configured_timezone()
    if isinstance(value, datetime.datetime):
        if value.tzinfo is None:
            value = tz.localize(value)
        return value.astimezone(tz).isoformat()
    return value

# Data buffer
data_buffer = deque(maxlen=60)
buffer_lock = threading.Lock()

def polling_thread():
    """Thread for UPS data polling"""
    failures = 0
    
    while True:
        try:
            with app.app_context():
                # Get the UPSDynamicData model
                UPSDynamicData = get_ups_model(db)
                success, error = save_ups_data(db, UPSDynamicData, ups_data_cache)
                
                if not success:
                    failures += 1
                else:
                    failures = 0
                
                # Get polling interval from VariableConfig (defaults to 1 second if not available)
                try:
                    if hasattr(db, 'ModelClasses') and hasattr(db.ModelClasses, 'VariableConfig'):
                        model_class = db.ModelClasses.VariableConfig
                    else:
                        from core.db.ups import VariableConfig
                        model_class = VariableConfig
                    
                    config = model_class.query.first()
                    polling_interval = config.polling_interval if config else 1
                except Exception as e:
                    logger.error(f"Error getting polling interval: {str(e)}. Using default of 1 second.")
                    polling_interval = 1
                
                # Ensure polling_interval is within 1-60 seconds
                polling_interval = max(1, min(60, polling_interval))
                time.sleep(polling_interval)
                
        except (UPSConnectionError, UPSCommandError, UPSDataError) as e:
            failures += 1
            sleep_time = min(300, 2 ** failures)
            logger.warning(f"Polling error: {str(e)}. Backing off for {sleep_time}s")
            time.sleep(sleep_time)
        except Exception as e:
            logger.error(f"Unexpected error in polling thread: {str(e)}")
            failures += 1
            time.sleep(min(300, 2 ** failures))

# Disables Werkzeug log if LOG_LEVEL is OFF
if LOG_LEVEL == 'OFF':
    log = logging.getLogger('werkzeug')
    log.setLevel(logging.ERROR)
    WSGIRequestHandler.log = lambda *args, **kwargs: None

def init_app():
    """Initializes the application"""
    logger.info("💻 Initializing application...")
    try:
        # Configure UPS settings first
        logger.info("🔌 Configuring UPS connection settings...")
        configure_ups(host=UPS_HOST, name=UPS_NAME, 
                     command=UPS_COMMAND, timeout=COMMAND_TIMEOUT)
        
        with app.app_context():
            # ======== DATABASE INITIALIZATION PHASE ========
            logger.info("")
            logger.info("=" * 60)
            logger.info("===== DATABASE INITIALIZATION PHASE =====")
            logger.info("=" * 60)
            
            logger.info("🗃️ Initializing database...")
            db_init_success = init_database(app, db)
            
            if not db_init_success:
                logger.error("❌ Database initialization failed!")
                raise Exception("Database initialization failed")
            
            # Make sure all models are registered globally
            if hasattr(db, 'ModelClasses'):
                # Register models for global access
                register_models_for_global_access(db.ModelClasses, db)
                logger.info("✅ All models registered globally via ModelClasses")
                
            logger.info("✅ Database initialization completed successfully")
            logger.info("=" * 60)
            
            # Small delay to ensure logs are displayed in order
            time.sleep(0.5)
            
            # ======== APPLICATION SERVICES PHASE ========
            logger.info("")
            logger.info("=" * 60)
            logger.info("===== APPLICATION SERVICES PHASE =====")
            logger.info("=" * 60)
            
            logger.info("📧 Initializing notification settings...")
            init_notification_settings()
            
            # Initialize Ntfy model
            logger.info("📱 Initializing Ntfy module...")
            from core.extranotifs.ntfy import get_ntfy_model
            # Get the NtfyConfig model from db.ModelClasses
            get_ntfy_model()
            
            # Register Ntfy blueprint
            from core.extranotifs.ntfy.routes import create_blueprint
            ntfy_bp = create_blueprint()
            app.register_blueprint(ntfy_bp)
            
            # Initialize Webhook model
            logger.info("🌐 Initializing Webhook module...")
            from core.extranotifs.webhook import get_webhook_model
            # Get the WebhookConfig model from db.ModelClasses
            get_webhook_model()
            
            # Register Webhook blueprint
            try:
                from core.extranotifs.webhook.routes import create_blueprint
                webhook_bp = create_blueprint()
                app.register_blueprint(webhook_bp)
                logger.info("✅ Webhook blueprint registered successfully")
            except ImportError:
                logger.warning("⚠️ Webhook module not available")
            
            # ======== INITIALIZE CACHE WEBSOCKET ========
            logger.info("📡 Initializing Cache WebSocket...")
            from core.db.ups import init_websocket
            init_websocket(app)
            logger.info("✅ Cache WebSocket initialized successfully")
            
            logger.info("✅ Application services initialized successfully")
            logger.info("=" * 60)
            
            # Small delay to ensure logs are displayed in order
            time.sleep(0.5)
            
            # ======== SCHEDULER PHASE ========
            logger.info("")
            logger.info("=" * 60)
            logger.info("===== SCHEDULER PHASE =====")
            logger.info("=" * 60)
            
            logger.info("📋 Initializing Scheduler...")
            scheduler.init_app(app)
            
            # Verify schedulers loaded
            jobs = scheduler.get_scheduled_jobs()
            logger.info(f"📊 Loaded {len(jobs)} scheduled jobs")
            
            # Start polling thread
            logger.info("🔄 Starting UPS data polling thread...")
            thread = threading.Thread(target=polling_thread, daemon=True)
            thread.start()
            
            logger.info("✅ Scheduler initialized successfully")
            logger.info("=" * 60)
            
        logger.info("")
        logger.info("✅ APPLICATION STARTUP COMPLETE ✅")
    except Exception as e:
        logger.critical(f"❌ FATAL ERROR: Failed to initialize application: {str(e)}")
        raise


if __name__ == '__main__':
    warnings.filterwarnings("ignore", message="resource_tracker: There appear to be .* leaked semaphore objects to clean up at shutdown")
    init_app()
    
    # Configure SSL context if enabled
    ssl_context = None
    if SSL_ENABLED:
        if os.path.exists(SSL_CERT) and os.path.exists(SSL_KEY):
            logger.info(f"🔒 SSL enabled with certificate: {SSL_CERT}")
            ssl_context = (SSL_CERT, SSL_KEY)
            
            # Create a wsgi.py file for gunicorn
            wsgi_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'wsgi.py')
            with open(wsgi_path, 'w') as f:
                f.write("""
import os
import sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from app import app, socketio, init_app

# Initialize the application when running with gunicorn
init_app()

if __name__ == '__main__':
    socketio.run(app)
""")
            
            # Start with gunicorn for SSL support
            import subprocess
            cmd = [
                "gunicorn", 
                "--worker-class", "eventlet", 
                "-w", "1", 
                "--certfile", SSL_CERT, 
                "--keyfile", SSL_KEY,
                "-b", f"{SERVER_HOST}:{SERVER_PORT}", 
                "wsgi:app"
            ]
            logger.info(f"Starting gunicorn with SSL: {' '.join(cmd)}")
            subprocess.Popen(cmd, cwd=os.path.dirname(os.path.abspath(__file__)))
            
            # Keep the main process running to handle signals
            import time
            try:
                while True:
                    time.sleep(1)
            except KeyboardInterrupt:
                logger.info("Shutting down...")
                sys.exit(0)
        else:
            logger.warning(f"⚠️ SSL certificates not found at {SSL_CERT} and {SSL_KEY}. Running without SSL.")
            ssl_context = None
    
    # Only run socketio directly if not using SSL
    if not SSL_ENABLED or ssl_context is None:
        socketio.run(app, 
            debug=DEBUG_MODE, 
            host=SERVER_HOST, 
            port=SERVER_PORT,
            log_output=use_werkzeug,
            use_reloader=False
        )
