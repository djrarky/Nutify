import subprocess
from datetime import datetime
import tempfile
import os
from ..db.ups import (
    db, data_lock, get_ups_data, get_ups_model,
    UPSData as DotDict,
    create_static_model, UPSEvent
)
from cryptography.fernet import Fernet
import base64
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
import os
from flask import render_template
from ..settings import (
    MSMTP_PATH,
    TLS_CERT_PATH,
    get_configured_timezone,
    ENCRYPTION_KEY as CONFIG_ENCRYPTION_KEY
)
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.mime.image import MIMEImage
from ..logger import mail_logger as logger
from .provider import email_providers
from sqlalchemy import text, inspect
import re
import logging
import socket
import time

logger.info("📨 Initializating mail")

# Encryption key (should be in an environment variable)
ENCRYPTION_KEY = CONFIG_ENCRYPTION_KEY.encode()

# Log of the configured timezone
logger.info(f"🌍 Mail module using timezone: {get_configured_timezone().zone}")

tz = get_configured_timezone()

# Global variable to track last test notification time
_last_test_notification_time = 0
_test_notification_cooldown = 2  # seconds

# Helper functions to safely access models
def get_mail_config_model():
    """Get the MailConfig model safely"""
    if hasattr(db, 'ModelClasses') and hasattr(db.ModelClasses, 'MailConfig'):
        return db.ModelClasses.MailConfig
    logger.warning("⚠️ MailConfig model not available through db.ModelClasses")
    return None

def get_notification_settings_model():
    """Get the NotificationSettings model safely"""
    if hasattr(db, 'ModelClasses') and hasattr(db.ModelClasses, 'NotificationSettings'):
        return db.ModelClasses.NotificationSettings
    logger.warning("⚠️ NotificationSettings model not available through db.ModelClasses")
    return None

def get_encryption_key():
    """Generates an encryption key from ENCRYPTION_KEY"""
    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(),
        length=32,
        salt=b'fixed-salt',  # In production, use a secure and unique salt
        iterations=100000,
    )
    key = base64.urlsafe_b64encode(kdf.derive(ENCRYPTION_KEY))
    return Fernet(key)

def get_msmtp_config(config_data):
    """Generate msmtp configuration based on provider and settings"""
    provider = config_data.get('provider', '')
    logger.debug(f"🔧 Generating msmtp config for provider: {provider}")
    logger.debug(f"🔧 SMTP Settings: server={config_data['smtp_server']}, port={config_data['smtp_port']}")
    logger.debug(f"🔧 Username: {config_data['username']}")
    logger.debug(f"🔧 TLS: {config_data.get('tls', True)}")
    logger.debug(f"🔧 STARTTLS: {config_data.get('tls_starttls', True)}")
    
    # Verify password is present and not None
    if 'password' not in config_data or config_data['password'] is None:
        logger.error("❌ Password is missing or None in config_data")
        raise ValueError("Password is required for SMTP configuration")
    
    # Use username as from_email if not provided
    from_email = config_data.get('from_email', config_data['username'])
    
    # Base configuration
    config_content = f"""
# Configuration for msmtp
defaults
auth           on
"""

    # Add TLS configuration based on the tls setting
    use_tls = config_data.get('tls', True)
    use_starttls = config_data.get('tls_starttls', True)
    
    if use_tls:
        config_content += f"""tls            on
tls_trust_file {TLS_CERT_PATH}
"""
    else:
        config_content += "tls            off\n"

    config_content += f"""logfile        ~/.msmtp.log

account        default
host           {config_data['smtp_server']}
port           {config_data['smtp_port']}
from           {from_email}
user           {config_data['username']}
password       {config_data['password']}
"""
    logger.debug(f"📝 Base msmtp config generated with server: {config_data['smtp_server']}:{config_data['smtp_port']}")

    # Add STARTTLS configuration based on the tls_starttls setting
    if use_tls:
        if use_starttls:
            logger.debug(f"🔒 Adding STARTTLS configuration: starttls=on")
            config_content += """
tls_starttls   on
"""
        else:
            logger.debug(f"🔒 Adding STARTTLS configuration: starttls=off")
            config_content += """
tls_starttls   off
"""
    
    logger.debug("✅ msmtp configuration generated successfully")
    return config_content

def test_email_config(config_data):
    """Test email configuration by sending a test email"""
    try:
        # Create a sanitized copy of config_data for logging
        log_config = config_data.copy()
        # Mask sensitive data before any logging
        if 'password' in log_config:
            log_config['password'] = '********'
        if 'smtp_password' in log_config:
            log_config['smtp_password'] = '********'
            
        logger.debug(f"📧 Test Configuration:")
        logger.debug(f"📧 Raw config data: {log_config}")
        
        # Use username as from_email
        config_data['from_email'] = config_data.get('username', '')
        config_data['from_name'] = config_data.get('username', '').split('@')[0] if '@' in config_data.get('username', '') else ''
            
        # Ensure required fields are present
        required_fields = ['smtp_server', 'smtp_port', 'username']
        for field in required_fields:
            if field not in config_data or not config_data[field]:
                return False, f"Missing required field: {field}"
        
        # Set default values for optional fields
        if 'provider' not in config_data:
            config_data['provider'] = ''
            
        # Get to_email if provided, otherwise use username as fallback
        to_email = config_data.get('to_email')
        if not to_email or to_email.strip() == '':
            to_email = config_data['username']
        logger.debug(f"📧 To Email: {to_email}")
        
        # Validate to_email format
        if '@' not in to_email:
            logger.error(f"❌ Invalid to_email format: {to_email}")
            return False, f"Invalid email format for recipient: {to_email}"
        
        # Determine provider from SMTP server if not specified
        if not config_data['provider'] and config_data['smtp_server']:
            for provider, info in email_providers.items():
                if info['smtp_server'] in config_data['smtp_server']:
                    config_data['provider'] = provider
                    break
            logger.debug(f"📧 Provider determined from SMTP server: {config_data['provider']}")
        
        logger.debug(f"📧 Provider: {config_data['provider']}")
        logger.debug(f"📧 SMTP Server: {config_data['smtp_server']}")
        logger.debug(f"📧 SMTP Port: {config_data['smtp_port']}")
        logger.debug(f"📧 Username: {config_data['username']}")
        
        # If the password is not provided, use the saved one
        if 'password' not in config_data or not config_data['password']:
            try:
                # Get the existing configuration from the database
                existing_config = get_mail_config_model().query.first()
                if existing_config and existing_config.password:
                    logger.debug("🔑 Using existing password from configuration")
                    # Use the password property which automatically decrypts
                    decrypted_password = existing_config.password
                    if decrypted_password is None:
                        logger.error("❌ Stored password is None")
                        return False, "No password provided and no valid password stored. Please enter a password."
                    config_data['password'] = decrypted_password
                else:
                    logger.error("❌ No existing mail configuration found or password is None")
                    return False, "No password provided and no valid password stored. Please enter a password."
            except Exception as de:
                # If it fails to decrypt the saved password, return an explicit error
                logger.error(f"❌ Failed to decrypt stored password: {str(de)}")
                return False, "Stored password cannot be decrypted with the current encryption key. Please enter a new password."
        
        # Generate msmtp configuration
        config_content = get_msmtp_config(config_data)
        
        # Create temporary configuration file
        with tempfile.NamedTemporaryFile(mode='w', delete=False) as f:
            f.write(config_content)
            config_file = f.name
            logger.debug(f"📄 Created temporary config file: {config_file}")
            
            # Log sanitized config content (mask password)
            sanitized_config = config_content
            if config_data.get('password'):
                # Check if password is None or empty
                if config_data['password'] is None:
                    logger.error("❌ Password is None in config_data")
                elif config_data['password'] == '':
                    logger.error("❌ Password is empty string in config_data")
                else:
                    logger.debug(f"✅ Password is present and not empty (length: {len(config_data['password'])})")
                sanitized_config = sanitized_config.replace(str(config_data['password']), '********')
            else:
                logger.error("❌ No password key in config_data")
            logger.debug(f"📄 Config file content:\n{sanitized_config}")

        # Create a temporary file for the email content
        with tempfile.NamedTemporaryFile(mode='w', delete=False) as f:
            # Get the UPS data from the database
            UPSStaticData = create_static_model()
            ups_static = db.session.query(UPSStaticData).first()
            
            # Render the template with all necessary data
            email_body = render_template('dashboard/mail/test_template.html', 
                ups_model=ups_static.device_model if ups_static else 'Unknown',
                ups_serial=ups_static.device_serial if ups_static else 'Unknown',
                test_date=datetime.now(get_configured_timezone()).strftime('%Y-%m-%d %H:%M:%S'),
                current_year=datetime.now(get_configured_timezone()).year
            )
            
            # Get provider display name for the subject
            provider_display_name = ''
            if config_data.get('provider'):
                provider_info = email_providers.get(config_data['provider'])
                if provider_info and 'displayName' in provider_info:
                    provider_display_name = provider_info['displayName']
                else:
                    # Fallback to capitalize the provider name if displayName is not available
                    provider_display_name = config_data['provider'].capitalize()
            
            subject_prefix = f"{provider_display_name} " if provider_display_name else ""
            
            email_content = f"""Subject: {subject_prefix}Test Email from UPS Monitor
From: {config_data['from_name']} <{config_data['from_email']}>
To: {to_email}
Content-Type: text/html; charset=utf-8

{email_body}
"""
            f.write(email_content)
            email_file = f.name
            logger.debug(f"📄 Created temporary email file: {email_file}")
            logger.debug(f"📄 Email content:\n{email_content}")

        # Send the test email using msmtp
        cmd = [MSMTP_PATH, '-C', config_file, to_email]
        logger.debug(f"🚀 Running msmtp command: {' '.join(cmd)}")
        
        process = subprocess.Popen(
            cmd,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE
        )
        
        with open(email_file, 'rb') as f:
            stdout, stderr = process.communicate(f.read())
        
        # Log msmtp output
        if stdout:
            logger.debug(f"📤 msmtp stdout:\n{stdout.decode()}")
        if stderr:
            logger.debug(f"📥 msmtp stderr:\n{stderr.decode()}")
        
        # Clean up the temporary files
        os.unlink(config_file)
        os.unlink(email_file)
        logger.debug("🧹 Cleaned up temporary files")
        
        if process.returncode == 0:
            logger.info("✅ Test email sent successfully")
            # Update the test status in the database
            config_id = config_data.get('id')
            if config_id:
                existing_config = get_mail_config_model().query.get(config_id)
                if existing_config:
                    db.session.commit()
            return True, "Test email sent successfully"
        else:
            error = stderr.decode()
            logger.error(f"❌ Failed to send test email: {error}")
            return False, f"Failed to send test email: {error}"
            
    except Exception as e:
        logger.error(f"❌ Error testing email config: {str(e)}", exc_info=True)
        return False, str(e)

def save_mail_config(config_data):
    """Save or update mail configuration
    
    Args:
        config_data (dict): Configuration data containing email settings
            - id: Optional ID for the configuration (if updating existing config)
            - smtp_server: SMTP server address
            - smtp_port: SMTP server port
            - username: SMTP authentication username
            - password: SMTP authentication password (will be encrypted)
            - enabled: Whether this configuration is enabled
            - provider: Email provider identifier (e.g., "gmail", "outlook")
            - tls: Whether to use TLS encryption
            - tls_starttls: Whether to use STARTTLS
            - to_email: Email address for receiving test emails and notifications
            
    Returns:
        tuple: (success, result) where result is the config ID or error message
    """
    try:
        # Debug log for incoming data
        sanitized_data = {k: (v if k != 'password' else '********') for k, v in config_data.items()}
        logger.debug(f"📨 Received config data: {sanitized_data}")
        logger.debug(f"📨 Provider in config: {config_data.get('provider', 'NOT FOUND')}")
        
        with data_lock:
            # Get MailConfig from db.ModelClasses
            MailConfig = get_mail_config_model()
            
            # Check if an ID was provided (for updating existing config)
            config_id = config_data.get('id')
            
            # Try to get the existing configuration or create a new one
            if config_id:
                config = MailConfig.query.get(config_id)
                if config:
                    logger.debug(f"📨 Updating existing mail configuration with ID: {config_id}")
                else:
                    config = MailConfig(id=config_id)
                    db.session.add(config)
                    logger.debug(f"📨 Creating new mail configuration with ID: {config_id}")
            else:
                # Find the first available ID starting from 1
                # Get all existing IDs sorted
                existing_ids = db.session.query(MailConfig.id).order_by(MailConfig.id).all()
                existing_ids = [item[0] for item in existing_ids]
                
                # Find the first gap in IDs starting from 1
                next_id = 1
                while next_id in existing_ids:
                    next_id += 1
                
                config_id = next_id
                config = MailConfig(id=config_id)
                db.session.add(config)
                logger.debug(f"📨 Creating new mail configuration with first available ID: {config_id}")
            
            # Check if this is just an enabled flag update
            if config_data.get('update_enabled_only', False):
                logger.debug(f"📧 Updating only enabled flag: {config_data.get('enabled', False)}")
                config.enabled = config_data.get('enabled', False)
                db.session.commit()
                logger.info(f"✅ Email notifications {'enabled' if config.enabled else 'disabled'}")
                return True, config.id
            
            # If the "password" field is not provided, check that the saved one is decrypted
            if 'password' not in config_data or not config_data['password']:
                try:
                    _ = config.password  # This will try to decrypt the already-saved password.
                except Exception as de:
                    return False, "Stored password cannot be decrypted with the current encryption key. Please enter a new password."
            
            # Log the provider being saved
            if 'provider' in config_data:
                logger.debug(f"📧 Setting email provider to: {config_data['provider']}")
            
            # Update all fields from the model
            allowed_keys = [
                'smtp_server', 'smtp_port', 
                'username', 'enabled', 'password', 'provider', 
                'tls', 'tls_starttls', 'to_email'
            ]
            
            for key in allowed_keys:
                if key in config_data:
                    value = config_data[key]
                    if key == 'password':
                        if not value:  # If no new password is provided, leave the existing one.
                            continue
                        config.password = value  # Use the setter to encrypt the new password.
                    elif key == 'smtp_port':
                        try:
                            config.smtp_port = int(value)
                        except ValueError:
                            config.smtp_port = None
                    else:
                        setattr(config, key, value)
                        if key == 'provider':
                            logger.debug(f"📧 Provider saved in database: {value}")
                        elif key == 'to_email':
                            logger.debug(f"📧 To email saved in database: {value}")
            
            # Debug log before commit
            logger.debug(f"📧 Final provider value before commit: {config.provider}")
           
            db.session.commit()
            
            # Debug log after commit
            logger.debug(f"📧 Provider value after commit: {config.provider}")
            logger.info(f"✅ Mail configuration saved successfully with ID: {config.id}")
            return True, config.id
    except Exception as e:
        db.session.rollback()
        logger.error("❌ Failed to save mail config:", exc_info=True)
        return False, str(e)

def send_email(to_addr, subject, html_content, smtp_settings, attachments=None):
    """Send email with proper subject handling and attachments support"""
    try:
        # Ensure the subject is a clean string
        clean_subject = str(subject).strip()
        logger.debug(f"📧 Sending email to: {to_addr}")
        logger.debug(f"📧 Subject: {clean_subject}")
        
        # Validate to_addr
        if not to_addr:
            logger.error("❌ No recipient email address provided")
            return False, "No recipient email address provided"
            
        if isinstance(to_addr, list) and not to_addr:
            logger.error("❌ Empty recipient list provided")
            return False, "Empty recipient list provided"
            
        # Create email message
        msg = MIMEMultipart('related')
        msg['Subject'] = clean_subject
        msg['From'] = f"{smtp_settings.get('from_name', 'UPS Monitor')} <{smtp_settings['from_addr']}>"
        msg['To'] = to_addr if isinstance(to_addr, str) else ", ".join(to_addr)
        
        # Add HTML content first
        html_part = MIMEText(html_content, 'html')
        msg.attach(html_part)
        
        # Add attachments if any
        if attachments:
            for attachment in attachments:
                # Create image from binary data
                img = MIMEImage(attachment['data'])
                img.add_header('Content-ID', f"<{attachment['cid']}>")
                img.add_header('Content-Disposition', 'inline', filename=attachment['name'])
                msg.attach(img)
        
        # Generate msmtp configuration
        config_content = get_msmtp_config({
            'smtp_server': smtp_settings['host'],
            'smtp_port': smtp_settings['port'],
            'from_email': smtp_settings['from_addr'],
            'username': smtp_settings['username'],
            'password': smtp_settings['password'],
            'provider': smtp_settings.get('provider', ''),
            'tls': smtp_settings.get('use_tls', True),
            'tls_starttls': smtp_settings.get('tls_starttls', True)
        })
        
        # Create temporary configuration file
        with tempfile.NamedTemporaryFile(mode='w', delete=False) as f:
            f.write(config_content)
            config_file = f.name
            logger.debug(f"📄 Created temporary config file: {config_file}")

        # Write the complete email to a temporary file
        with tempfile.NamedTemporaryFile(mode='w', delete=False) as f:
            f.write(msg.as_string())
            email_file = f.name
            logger.debug(f"📄 Created temporary email file: {email_file}")

        # Send email using msmtp
        cmd = [MSMTP_PATH, '-C', config_file]
        if isinstance(to_addr, list):
            cmd.extend(to_addr)
        else:
            cmd.append(to_addr)
            
        logger.debug(f"🚀 Running msmtp command: {' '.join(cmd)}")

        with open(email_file, 'rb') as f:
            process = subprocess.Popen(
                cmd,
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE
            )
            stdout, stderr = process.communicate(f.read())

        # Clean up temporary files
        os.unlink(config_file)
        os.unlink(email_file)
        logger.debug("🧹 Cleaned up temporary files")

        if process.returncode == 0:
            logger.info("✅ Email sent successfully")
            return True, "Email sent successfully"
        else:
            error = stderr.decode() if stderr else "Unknown error"
            logger.error(f"❌ Failed to send email: {error}")
            return False, f"Failed to send email: {error}"
            
    except Exception as e:
        logger.error(f"❌ Error sending email: {str(e)}", exc_info=True)
        return False, f"Error sending email: {str(e)}"

class EmailNotifier:
    TEMPLATE_MAP = {
        'ONLINE': 'mail/online_notification.html',
        'ONBATT': 'mail/onbatt_notification.html',
        'LOWBATT': 'mail/lowbatt_notification.html',
        'COMMOK': 'mail/commok_notification.html',
        'COMMBAD': 'mail/commbad_notification.html',
        'SHUTDOWN': 'mail/shutdown_notification.html',
        'REPLBATT': 'mail/replbatt_notification.html',
        'NOCOMM': 'mail/nocomm_notification.html',
        'NOPARENT': 'mail/noparent_notification.html'
    }

    @staticmethod
    def should_notify(event_type):
        """Check if an event type should be notified"""
        try:
            # Use the model from db.ModelClasses
            NotificationSettings = get_notification_settings_model()
            setting = NotificationSettings.query.filter_by(event_type=event_type).first()
            return setting and setting.enabled
        except Exception as e:
            logger.error(f"Error checking notification settings: {e}")
            return False

    @staticmethod
    def get_template_data(event_type, ups_name):
        """
        Get the template data using existing APIs
        Args:
            event_type: Event type (ONBATT, ONLINE, etc)
            ups_name: UPS name
        Returns:
            dict: Formatted data for the template
        """
        try:
            ups_data = get_ups_data()
            if not ups_data:
                logger.error("Failed to get UPS data")
                return {}
            
            # Base data common to all templates
            now = datetime.now(get_configured_timezone())
            logger.info(f"📧 Preparing email with timezone {get_configured_timezone().zone}, time: {now}")
            base_data = {
                'event_date': now.strftime('%Y-%m-%d'),
                'event_time': now.strftime('%H:%M:%S'),
                'ups_model': ups_data.device_model,
                'ups_host': ups_name,
                'ups_status': ups_data.ups_status,
                'current_year': now.year,
                'is_test': False
            }
            
            # Add specific data based on the event type
            if event_type in ['ONBATT', 'ONLINE', 'LOWBATT', 'SHUTDOWN']:
                # Format battery charge
                battery_charge = f"{ups_data.battery_charge:.1f}%" if ups_data.battery_charge else "N/A"
                
                # Calculate runtime estimate with fallbacks
                runtime_estimate = "N/A"
                
                # First try: Use battery_runtime directly
                if hasattr(ups_data, 'battery_runtime') and ups_data.battery_runtime:
                    runtime_estimate = format_runtime(ups_data.battery_runtime)
                    logger.debug(f"Using battery_runtime for runtime_estimate: {runtime_estimate}")
                
                # Second try: Use battery_runtime_low if available
                elif hasattr(ups_data, 'battery_runtime_low') and ups_data.battery_runtime_low:
                    runtime_estimate = format_runtime(ups_data.battery_runtime_low)
                    logger.debug(f"Using battery_runtime_low for runtime_estimate: {runtime_estimate}")
                
                # Third try: Estimate from battery charge (1% = 1 minute, rough approximation)
                elif ups_data.battery_charge and ups_data.battery_charge > 0:
                    runtime_estimate = estimate_runtime_from_charge(ups_data.battery_charge)
                    logger.debug(f"Estimated runtime from battery charge: {runtime_estimate}")
                
                # Update the data dictionary
                base_data.update({
                    'battery_charge': battery_charge,
                    'input_voltage': f"{ups_data.input_voltage:.1f}V" if ups_data.input_voltage else "N/A",
                    'battery_voltage': f"{ups_data.battery_voltage:.1f}V" if ups_data.battery_voltage else "N/A",
                    'runtime_estimate': runtime_estimate,
                    'battery_duration': get_battery_duration()
                })
            
            if event_type == 'REPLBATT':
                base_data.update({
                    'battery_age': get_battery_age(),
                    'battery_efficiency': calculate_battery_efficiency(),
                    'battery_capacity': f"{ups_data.battery_charge:.1f}%" if ups_data.battery_charge else "N/A",
                    'battery_voltage': f"{ups_data.battery_voltage:.1f}V" if ups_data.battery_voltage else "N/A"
                })
            
            if event_type in ['NOCOMM', 'COMMBAD', 'COMMOK']:
                base_data.update({
                    'last_known_status': get_last_known_status(),
                    'comm_duration': get_comm_duration()
                })
                # Add battery data only for COMMOK
                if event_type == 'COMMOK':
                    base_data.update({
                        'battery_charge': f"{ups_data.battery_charge:.1f}%" if ups_data.battery_charge else "N/A",
                        'battery_voltage': f"{ups_data.battery_voltage:.1f}V" if ups_data.battery_voltage else "N/A"
                    })
            
            logger.debug(f"Template data prepared for {event_type}: {base_data}")
            return base_data
        
        except Exception as e:
            logger.error(f"Error preparing template data: {str(e)}")
            return {}

    @staticmethod
    def send_notification(event_type: str, event_data: dict) -> tuple[bool, str]:
        """Send email notification for UPS event"""
        try:
            logger.info(f"📅 Sending scheduled report...")
            logger.debug(f"🔍 Scheduler using timezone: {get_configured_timezone().zone}")
            logger.info(f"Sending notification for event type: {event_type}")
            
            # Check that event_data is a dictionary
            if isinstance(event_data, dict):
                data_for_template = event_data
            else:
                # If it's not a dictionary, try to convert it
                data_for_template = event_data.to_dict() if hasattr(event_data, "to_dict") else {
                    k: v for k, v in event_data.__dict__.items() 
                    if not k.startswith('_')
                } if hasattr(event_data, "__dict__") else {}

            logger.debug(f"Template data prepared for {event_type}: {data_for_template}")

            # Get notification settings
            # Use the model from db.ModelClasses
            NotificationSettings = get_notification_settings_model()
            notification_settings = NotificationSettings.query.filter_by(event_type=event_type).first()
            if not notification_settings:
                logger.warning("No notification settings found")
                return False, "No notification settings found"

            # Ignore enabled check if it's a test
            if not notification_settings.enabled and not data_for_template.get('is_test', False):
                logger.info("Notifications are disabled")
                return False, "Notifications are disabled"

            # Check if this event type should be notified
            event_enabled = getattr(notification_settings, f"notify_{event_type.lower()}", True)
            if not event_enabled and not data_for_template.get('is_test', False):
                logger.info(f"Notifications for {event_type} are disabled")
                return False, f"Notifications for {event_type} are disabled"

            # Get the email configuration based on id_email if present, otherwise use default
            mail_config = None
            
            # Check if id_email is provided in the test data
            test_id_email = data_for_template.get('id_email')
            
            if test_id_email and data_for_template.get('is_test', False):
                mail_config = get_mail_config_model().query.get(test_id_email)
                if not mail_config:
                    logger.warning(f"Email configuration with ID {test_id_email} not found, falling back to notification settings")
                else:
                    logger.info(f"Using email configuration with ID {test_id_email} for test")
                    # Check if the configuration is enabled
                    if not mail_config.enabled:
                        logger.warning(f"Email configuration with ID {test_id_email} is disabled, but will use it anyway for test")
                        # For tests, we use the configuration even if it's disabled
            
            # If no mail_config from test data, use the one from notification settings
            if not mail_config and notification_settings.id_email:
                mail_config = get_mail_config_model().query.filter_by(id=notification_settings.id_email).first()
                if not mail_config:
                    logger.warning(f"Email configuration with ID {notification_settings.id_email} not found, falling back to default")
            
            # If no specific email config found or specified, use default
            if not mail_config:
                mail_config = get_mail_config_model().query.filter_by(is_default=True).first() or get_mail_config_model().query.first()
            
            # For tests, ignore the enabled check
            if not mail_config or (not mail_config.enabled and not data_for_template.get('is_test', False)):
                logger.info("Email configuration not found or disabled")
                return False, "Email configuration not found or disabled"

            # List of providers that have issues with base64 inline images and modern CSS
            problematic_providers = ['gmail', 'yahoo', 'outlook', 'office365']
            provider = mail_config.provider.lower() if mail_config.provider else ''
            
            # Add is_problematic_provider to template data
            data_for_template['is_problematic_provider'] = provider in problematic_providers
            
            # Get email template
            template = EmailNotifier.TEMPLATE_MAP.get(event_type)
            if not template:
                logger.error(f"No template found for event type: {event_type}")
                return False, f"No template found for event type: {event_type}"

            # Adjust template path
            if not template.startswith("dashboard/"):
                template = f"dashboard/{template}"

            # Add current year to template data
            data_for_template['current_year'] = datetime.now().year
            
            # Render template
            try:
                html_content = render_template(template, **data_for_template)
            except Exception as e:
                logger.error(f"Error rendering template: {str(e)}")
                return False, f"Error rendering template: {template}"

            # Determine if we should use SMTP settings from event_data (for tests)
            # or from the mail_config (for normal notifications)
            use_event_data_settings = data_for_template.get('is_test', False) and all(
                key in data_for_template for key in ['smtp_server', 'smtp_port', 'from_email']
            )
            
            if use_event_data_settings:
                logger.debug("Using SMTP settings from event_data for test")
                smtp_settings = {
                    'host': data_for_template['smtp_server'],
                    'port': data_for_template['smtp_port'],
                    'username': data_for_template.get('username', data_for_template['from_email']),
                    'password': mail_config.password,  # Still use the password from the database
                    'use_tls': data_for_template.get('tls', True),
                    'from_addr': data_for_template['from_email'],
                    'provider': data_for_template.get('provider', ''),
                    'tls_starttls': data_for_template.get('tls_starttls', True)
                }
            else:
                logger.debug("Using SMTP settings from mail_config")
                smtp_settings = {
                    'host': mail_config.smtp_server,
                    'port': mail_config.smtp_port,
                    'username': mail_config.username,
                    'password': mail_config.password,
                    'use_tls': mail_config.tls,
                    'from_addr': mail_config.username,  # Use username as from_addr
                    'provider': mail_config.provider,
                    'tls_starttls': mail_config.tls_starttls
                }

            # Determine recipient email address
            # First check if to_email is in event_data
            to_email = data_for_template.get('to_email')
            # If not, check if mail_config has to_email
            if not to_email or to_email.strip() == '':
                to_email = mail_config.to_email
            # If still not available, use the username as fallback
            if not to_email or to_email.strip() == '':
                to_email = mail_config.username
                
            logger.debug(f"Using recipient email: {to_email}")

            # Send email
            success, message = send_email(
                to_addr=[to_email],  # Send to the specified recipient
                subject=f"UPS Event: {event_type}",
                html_content=html_content,
                smtp_settings=smtp_settings
            )

            return success, message

        except Exception as e:
            logger.error(f"Error sending notification: {str(e)}", exc_info=True)
            return False, str(e)

def handle_notification(event_data):
    """
    Handles the email notification for an UPS event
    Args:
        event_data: Dict containing event data (ups, event)
    """
    try:
        event_type = event_data.get('event')
        ups = event_data.get('ups')
        
        logger.info(f"Processing notification for event {event_type} from UPS {ups}")
        
        # Use the model from db.ModelClasses
        NotificationSettings = get_notification_settings_model()
        
        # Check if notifications are enabled for this event
        notify_setting = NotificationSettings.query.filter_by(event_type=event_type).first()
        if not notify_setting or not notify_setting.enabled:
            logger.info(f"Notifications disabled for event type: {event_type}")
            return
        
        # Get the email configuration based on the notification settings
        mail_config = None
        if notify_setting.id_email:
            mail_config = get_mail_config_model().query.get(notify_setting.id_email)
            logger.info(f"Using email configuration with ID {notify_setting.id_email} for event {event_type}")
        
        # If no specific email config found, use default
        if not mail_config:
            mail_config = get_mail_config_model().query.filter_by(is_default=True).first() or get_mail_config_model().query.first()
            logger.info(f"Using default email configuration for event {event_type}")
            
        if not mail_config or not mail_config.enabled:
            logger.info("Email configuration not found or disabled")
            return
            
        # Get the template data using existing APIs
        notification_data = EmailNotifier.get_template_data(event_type, ups)
        if not notification_data:
            logger.error("Failed to get template data")
            return
            
        # Add to_email to notification data if available
        if mail_config.to_email and mail_config.to_email.strip() != '':
            notification_data['to_email'] = mail_config.to_email
        
        # Add id_email to notification data
        notification_data['id_email'] = mail_config.id
            
        # Send the notification using the correct template
        success, message = EmailNotifier.send_notification(
            event_type,
            notification_data
        )
        
        if not success:
            logger.error(f"Failed to send notification: {message}")
            return
            
        logger.info("Notification sent successfully")
        
    except Exception as e:
        logger.error(f"Error handling notification: {str(e)}", exc_info=True)

def init_notification_settings():
    """Initialize notification settings"""
    try:
        # Ensure all tables exist
        db.create_all()
        
        # Initialize notifications
        # Use the model from db.ModelClasses
        NotificationSettings = get_notification_settings_model()
        settings = NotificationSettings.query.all()
        if not settings:
            for event_type in EmailNotifier.TEMPLATE_MAP.keys():
                setting = NotificationSettings(event_type=event_type, enabled=False)
                db.session.add(setting)
            db.session.commit()
            logger.info("Notification settings initialized")
            
    except Exception as e:
        logger.error(f"Error initializing notification settings: {str(e)}")
        db.session.rollback()

def get_notification_settings():
    """Get all notification settings"""
    try:
        # Use the model from db.ModelClasses
        NotificationSettings = get_notification_settings_model()
        # Try to get all notification settings
        return NotificationSettings.query.all()
    except Exception as e:
        logger.error(f"Error retrieving notification settings: {str(e)}")
        return []

def test_notification(event_type, test_data=None):
    """
    Function to test email notifications with simulated data
    Args:
        event_type: Event type to test
        test_data: Optional dictionary with test parameters
    Returns:
        tuple: (success, message)
    """
    global _last_test_notification_time
    
    # Debounce protection - prevent multiple rapid calls
    current_time = time.time()
    if current_time - _last_test_notification_time < _test_notification_cooldown:
        logger.warning(f"Test notification called too soon after previous call ({current_time - _last_test_notification_time:.2f}s < {_test_notification_cooldown}s)")
        return False, "Please wait a few seconds before sending another test notification"
    
    _last_test_notification_time = current_time
    
    try:
        # Get real UPS data first
        ups_data = get_ups_data() or {}
        
        # Base data common to all events
        base_data = {
            'device_model': getattr(ups_data, 'device_model', 'Back-UPS RS 1600SI'),
            'device_serial': getattr(ups_data, 'device_serial', 'Unknown'),
            'ups_status': getattr(ups_data, 'ups_status', 'OL'),
            'battery_charge': getattr(ups_data, 'battery_charge', '100'),
            'battery_voltage': getattr(ups_data, 'battery_voltage', '13.2'),
            'battery_runtime': getattr(ups_data, 'battery_runtime', '2400'),
            'input_voltage': getattr(ups_data, 'input_voltage', '230.0'),
            'ups_load': getattr(ups_data, 'ups_load', '35'),
            'ups_realpower': getattr(ups_data, 'ups_realpower', '180'),
            'ups_temperature': getattr(ups_data, 'ups_temperature', '32.5'),
            # Add a flag to indicate that it's a test
            'is_test': True,
            'event_date': datetime.now(get_configured_timezone()).strftime('%Y-%m-%d'),
            'event_time': datetime.now(get_configured_timezone()).strftime('%H:%M:%S'),
            'battery_duration': get_battery_duration()
        }

        # Specific data for event type
        event_specific_data = {
            'ONLINE': {
                'ups_status': 'OL',
                'battery_runtime': '300',
                'input_voltage': '230.0',
                'input_transfer_reason': 'Utility power restored'
            },
            'ONBATT': {
                'ups_status': 'OB',
                'input_voltage': '0.0',
                'battery_runtime': '1800',
                'input_transfer_reason': 'Line power fail'
            },
            'LOWBATT': {
                'ups_status': 'OB LB',
                'battery_charge': '10',
                'battery_runtime': '180',
                'battery_runtime': '1200',
                'input_voltage': '0.0'
            },
            'COMMOK': {
                'ups_status': 'OL',
                'input_transfer_reason': 'Communication restored'
            },
            'COMMBAD': {
                'ups_status': 'OL COMMOK',
                'input_transfer_reason': 'Communication failure'
            },
            'SHUTDOWN': {
                'ups_status': 'OB LB',
                'battery_charge': '5',
                'battery_runtime': '60',
                'battery_runtime': '1500',
                'ups_timer_shutdown': '30',
                'input_voltage': '0.0'
            },
            'REPLBATT': {
                'ups_status': 'OL RB',
                'battery_date': '2020-01-01',
                'battery_mfr_date': '2020-01-01',
                'battery_type': 'Li-ion',
                'battery_voltage_nominal': '12.0'
            },
            'NOCOMM': {
                'ups_status': 'OL COMMOK',
                'input_transfer_reason': 'Communication lost'
            },
            'NOPARENT': {
                'ups_status': 'OL',
                'input_transfer_reason': 'Process terminated'
            }
        }

        # Combine base data with specific event data
        event_data = base_data.copy()
        if event_type in event_specific_data:
            event_data.update(event_specific_data[event_type])
        
        # If test_data is provided, update with those values
        if test_data:
            # Add id_email to the test data if provided
            if 'id_email' in test_data:
                event_data['id_email'] = test_data['id_email']
                # Verify that the email configuration exists
                mail_config = get_mail_config_model().query.get(test_data['id_email'])
                if not mail_config:
                    return False, f"Email configuration with ID {test_data['id_email']} not found"
            
            # Add to_email if provided
            if 'to_email' in test_data:
                event_data['to_email'] = test_data['to_email']
            
            # Mark as test
            event_data['is_test'] = True

        # Create a DotDict object with test data
        test_data_obj = DotDict(event_data)
            
        # Use the existing handle_notification function to send the test email
        success, message = EmailNotifier.send_notification(event_type, test_data_obj)
        
        return success, message

    except Exception as e:
        logger.error(f"Error testing notification: {str(e)}")
        return False, str(e)

def test_notification_settings():
    """Test the email settings by sending a test email"""
    try:
        logger.info("📊 Testing Report Settings...")
        
        # Get the mail configuration from the database
        mail_config = get_mail_config_model().query.first()
        if not mail_config:
            logger.error("❌ No mail configuration found in database")
            return False, "No mail configuration found in database"
            
        # Check if required fields are present
        if not mail_config.smtp_server or not mail_config.smtp_port or not mail_config.from_email:
            logger.error("❌ Missing required mail configuration fields")
            missing_fields = []
            if not mail_config.smtp_server:
                missing_fields.append("smtp_server")
            if not mail_config.smtp_port:
                missing_fields.append("smtp_port")
            if not mail_config.from_email:
                missing_fields.append("from_email")
            return False, f"Missing required fields: {', '.join(missing_fields)}"
            
        # Get UPS data for the test email
        ups_data = get_ups_data() or {}
        
        # Prepare test data
        test_data = {
            'ups_model': get_ups_model(),
            'ups_serial': ups_data.device_serial if ups_data else 'Unknown',
            'test_date': datetime.now(get_configured_timezone()).strftime('%Y-%m-%d %H:%M:%S'),
            'current_year': datetime.now(get_configured_timezone()).year,
            'is_test': True,  # Mark this as a test
            'smtp_server': mail_config.smtp_server,
            'smtp_port': mail_config.smtp_port,
            'username': mail_config.username,
            'provider': mail_config.provider,
            'tls': mail_config.tls,
            'tls_starttls': mail_config.tls_starttls
        }
        
        logger.debug(f"🔍 Report will use timezone: {get_configured_timezone().zone}")
        logger.debug(f"📧 Test data: {test_data}")
        
        # Create a test event type for the general test
        test_event_type = "TEST"
        
        # Make sure we have a template mapping for TEST
        if "TEST" not in EmailNotifier.TEMPLATE_MAP:
            EmailNotifier.TEMPLATE_MAP["TEST"] = 'mail/test_template.html'
        
        # Make sure we have notification settings for TEST
        with data_lock:
            test_setting = get_notification_settings_model().query.filter_by(event_type=test_event_type).first()
            if not test_setting:
                test_setting = get_notification_settings_model()(event_type=test_event_type, enabled=True)
                db.session.add(test_setting)
                db.session.commit()
        
        # Send the test email using the correct parameters
        success, message = EmailNotifier.send_notification(test_event_type, test_data)
        
        if success:
            # Update the test status
            with data_lock:
                if mail_config:
                    db.session.commit()
        
        return success, message

    except Exception as e:
        logger.error(f"Error testing notification: {str(e)}", exc_info=True)
        return False, str(e)

def format_runtime(seconds):
    """Format the runtime in a readable format"""
    try:
        # Handle empty, null, or non-numeric values
        if seconds is None or seconds == "":
            return "N/A"
            
        # Convert to float and validate
        try:
            seconds = float(seconds)
        except (ValueError, TypeError):
            logger.warning(f"Invalid runtime value: {seconds}, cannot convert to float")
            return "N/A"
            
        # Ensure seconds is positive
        if seconds <= 0:
            logger.debug(f"Non-positive runtime value: {seconds}, returning N/A")
            return "N/A"
            
        # Format based on duration
        if seconds < 60:
            return f"{int(seconds)} sec"
            
        minutes = int(seconds / 60)
        if minutes < 60:
            return f"{minutes} min"
            
        hours = minutes // 60
        mins = minutes % 60
        return f"{hours}h {mins}m"
    except Exception as e:
        logger.error(f"Error formatting runtime: {str(e)}")
        return "N/A"

def get_battery_duration():
    """Calculate the time passed since the last battery event"""
    try:
        # For ONLINE, find the last complete ONBATT->ONLINE cycle
        last_online = UPSEvent.query.filter(
            UPSEvent.event_type == 'ONLINE'
        ).order_by(UPSEvent.timestamp_tz.desc()).first()
        
        if last_online:
            # Find the ONBATT that precedes this ONLINE
            last_onbatt = UPSEvent.query.filter(
                UPSEvent.event_type == 'ONBATT',
                UPSEvent.timestamp_tz < last_online.timestamp_tz
            ).order_by(UPSEvent.timestamp_tz.desc()).first()
            
            if last_onbatt:
                duration = last_online.timestamp_tz - last_onbatt.timestamp_tz
                seconds = duration.total_seconds()
                if seconds < 60:
                    return f"{int(seconds)} sec"
                minutes = int(seconds / 60)
                return f"{minutes} min"
        
        return "N/A"
    except Exception as e:
        logger.error(f"Error calculating battery duration: {str(e)}")
        return "N/A"

def get_last_known_status():
    """Get the last known UPS status"""
    try:
        ups_data = get_ups_data()
        if ups_data and ups_data.ups_status:
            return ups_data.ups_status
            
        # Fallback on events if get_ups_data doesn't have the status
        last_event = UPSEvent.query.order_by(UPSEvent.timestamp_tz.desc()).first()
        if last_event and last_event.ups_status:
            return last_event.ups_status
            
        return "Unknown"
    except Exception as e:
        logger.error(f"Error getting last known status: {str(e)}")
        return "Unknown"

def get_comm_duration():
    """Calculate the duration of the communication interruption"""
    try:
        # Find the last COMMBAD/NOCOMM event
        last_comm_fail = UPSEvent.query.filter(
            UPSEvent.event_type.in_(['COMMBAD', 'NOCOMM'])
        ).order_by(UPSEvent.timestamp_tz.desc()).first()
        
        if last_comm_fail:
            # Calculate the duration until the current event
            now = datetime.now(get_configured_timezone())
            duration = now - last_comm_fail.timestamp_tz
            seconds = duration.total_seconds()
            
            if seconds < 60:
                return f"{int(seconds)} sec"
            minutes = int(seconds / 60)
            return f"{minutes} min"
        
        return "N/A"
    except Exception as e:
        logger.error(f"Error calculating comm duration: {str(e)}")
        return "N/A"

def get_battery_age():
    """Calculate the battery age"""
    try:
        ups_data = get_ups_data()
        if ups_data and ups_data.battery_mfr_date:  # Use battery_mfr_date instead of battery_date
            try:
                install_date = datetime.strptime(ups_data.battery_mfr_date, '%Y/%m/%d')
                age = datetime.now(get_configured_timezone()) - install_date
                return f"{age.days // 365} years and {(age.days % 365) // 30} months"
            except ValueError as e:
                logger.error(f"Error parsing battery date: {str(e)}")
                return "N/A"
    except Exception as e:
        logger.error(f"Error calculating battery age: {str(e)}")
    return "N/A"

def calculate_battery_efficiency():
    """Calculate the battery efficiency based on runtime"""
    try:
        ups_data = get_ups_data()
        if ups_data:
            # Calculate the efficiency based on runtime and current charge
            runtime = float(ups_data.battery_runtime or 0)
            charge = float(ups_data.battery_charge or 0)
            
            # A new UPS should have about 30-45 minutes of runtime at 100% charge
            nominal_runtime = 2700  # 45 minutes in seconds
            
            if charge > 0:
                # Normalize the runtime to 100% charge
                normalized_runtime = (runtime / charge) * 100
                efficiency = (normalized_runtime / nominal_runtime) * 100
                return f"{min(100, efficiency):.1f}%"
    except Exception as e:
        logger.error(f"Error calculating battery efficiency: {str(e)}")
    return "N/A"

def estimate_runtime_from_charge(charge_percent):
    """
    Estimate runtime based on battery charge percentage
    This is a fallback method when direct runtime data is not available
    
    Args:
        charge_percent: Battery charge percentage
        
    Returns:
        str: Estimated runtime in a readable format
    """
    try:
        if charge_percent is None or charge_percent == "":
            return "N/A"
            
        # Convert to float and validate
        try:
            charge = float(charge_percent)
            if isinstance(charge_percent, str) and charge_percent.endswith('%'):
                charge = float(charge_percent[:-1])  # Remove % if present
        except (ValueError, TypeError):
            logger.warning(f"Invalid charge value: {charge_percent}")
            return "N/A"
            
        # Ensure charge is within valid range
        if charge <= 0 or charge > 100:
            logger.warning(f"Charge out of range: {charge}")
            return "N/A"
            
        # Simple linear model: 1% charge = 1 minute runtime (very rough approximation)
        # For a more sophisticated model, we could use UPS specs or historical data
        minutes = int(charge)
        
        # Format based on duration
        if minutes < 60:
            return f"{minutes} min"
            
        hours = minutes // 60
        mins = minutes % 60
        return f"{hours}h {mins}m"
    except Exception as e:
        logger.error(f"Error estimating runtime from charge: {str(e)}")
        return "N/A"

def validate_emails(emails):
    """
    Validate email addresses
    Args:
        emails: List of email addresses or single email address
    Returns:
        List of valid email addresses
    """
    from email_validator import validate_email, EmailNotValidError
    
    if isinstance(emails, str):
        emails = [emails]
        
    valid_emails = []
    for email in emails:
        try:
            valid = validate_email(email.strip())
            valid_emails.append(valid.email)
        except EmailNotValidError as e:
            logger.warning(f"Invalid email: {email} - {str(e)}")
    return valid_emails

def get_current_email_settings():
    """
    Get configured email from mail settings
    
    Returns:
        str or None: The configured email address if available, or None if not configured
    """
    try:
        MailConfig = get_mail_config_model()
        if not MailConfig:
            logger.warning("MailConfig model not available")
            return None
            
        mail_config = MailConfig.get_default()
        if mail_config and getattr(mail_config, 'enabled', False):
            # Return the username as email address
            logger.debug(f"Using mail config: username={mail_config.username}, enabled={mail_config.enabled}")
            return mail_config.username
        elif mail_config:
            logger.debug(f"Mail config found but disabled: username={mail_config.username}, enabled={getattr(mail_config, 'enabled', False)}")
        else:
            logger.debug("No mail configuration found")
        return None
    except Exception as e:
        logger.error(f"Error getting email settings: {str(e)}", exc_info=True)
        return None 