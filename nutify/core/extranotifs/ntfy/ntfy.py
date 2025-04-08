import requests
import json
import logging
from flask import current_app

logger = logging.getLogger(__name__)

class NtfyNotifier:
    def __init__(self, config):
        self.config = config
        self.server = config.get('server', 'https://ntfy.sh')
        self.topic = config.get('topic', '')
        self.use_auth = config.get('use_auth', False)
        self.username = config.get('username', '')
        self.password = config.get('password', '')
        self.priority = config.get('priority', 3)
        self.use_tags = config.get('use_tags', True)
    
    def send_notification(self, title, message, event_type=None, priority=None):
        """
        Send a notification to Ntfy
        
        Args:
            title (str): Notification title
            message (str): Notification message
            event_type (str, optional): Event type for tagging. Defaults to None.
            priority (int, optional): Override default priority. Defaults to None.
        
        Returns:
            dict: Response with success status and message
        """
        try:
            # Prepare headers
            headers = {
                "Title": title,
                "Priority": str(priority if priority is not None else self.priority)
            }
            
            # Add tags based on event type if enabled
            if self.use_tags and event_type:
                tag = self._get_tag_for_event(event_type)
                if tag:
                    headers["Tags"] = tag
            
            # Prepare auth
            auth = None
            if self.use_auth and self.username and self.password:
                auth = (self.username, self.password)
            
            # Send notification
            url = f"{self.server}/{self.topic}"
            response = requests.post(
                url,
                data=message,
                headers=headers,
                auth=auth,
                timeout=10
            )
            
            if response.status_code in [200, 201, 202]:
                logger.info(f"Ntfy notification sent successfully to {self.topic}")
                return {"success": True, "message": "Notification sent successfully"}
            else:
                logger.error(f"Failed to send Ntfy notification: {response.text}")
                return {"success": False, "message": f"Error {response.status_code}: {response.text}"}
                
        except Exception as e:
            logger.error(f"Error sending Ntfy notification: {str(e)}")
            return {"success": False, "message": str(e)}
    
    def _get_tag_for_event(self, event_type):
        """Map event types to appropriate Ntfy tags"""
        event_tags = {
            "ONLINE": "white_check_mark",
            "ONBATT": "battery",
            "LOWBATT": "warning,battery",
            "COMMOK": "signal_strength",
            "COMMBAD": "no_mobile_phones",
            "SHUTDOWN": "sos,warning",
            "REPLBATT": "wrench,battery",
            "NOCOMM": "no_entry,warning",
            "NOPARENT": "ghost"
        }
        return event_tags.get(event_type, "")

def test_notification(config, event_type=None):
    """
    Send a test notification using the provided configuration
    
    Args:
        config (dict): Ntfy configuration
        event_type (str, optional): Event type for test. Defaults to None.
    
    Returns:
        dict: Response with success status and message
    """
    notifier = NtfyNotifier(config)
    
    event_messages = {
        "ONLINE": "Your UPS is now running on line power",
        "ONBATT": "Your UPS has switched to battery power",
        "LOWBATT": "Warning: UPS battery is running low",
        "COMMOK": "Communication with UPS has been restored",
        "COMMBAD": "Communication with UPS has been lost",
        "SHUTDOWN": "System shutdown is imminent due to low battery",
        "REPLBATT": "UPS battery needs replacement",
        "NOCOMM": "Cannot communicate with the UPS",
        "NOPARENT": "Parent process has been lost"
    }
    
    title = "Test Notification"
    if event_type:
        message = event_messages.get(event_type, f"Test notification for {event_type} event")
        title = f"Test: {event_type}"
    else:
        message = "This is a test notification from Nutify"
    
    return notifier.send_notification(title, message, event_type)

def send_event_notification(event_type, message):
    """
    Send a notification for a specific event type
    
    Args:
        event_type (str): Event type
        message (str): Notification message
    
    Returns:
        dict: Response with success status
    """
    try:
        from app import db
        from core.extranotifs.ntfy.db import init_models, get_default_config
        
        # Get default config
        config = get_default_config()
        
        if not config:
            logger.error("No default Ntfy configuration found")
            return {"success": False, "message": "No default configuration found"}
        
        # Check if notification for this event type is enabled
        event_field = f"notify_{event_type.lower()}"
        if not config.get(event_field, False):
            logger.debug(f"Ntfy notification for {event_type} is disabled")
            return {"success": False, "message": "Notification is disabled for this event type"}
        
        # Send notification
        notifier = NtfyNotifier(config)
        
        event_titles = {
            "ONLINE": "UPS Online",
            "ONBATT": "UPS On Battery",
            "LOWBATT": "UPS Low Battery",
            "COMMOK": "UPS Communication Restored",
            "COMMBAD": "UPS Communication Lost",
            "SHUTDOWN": "System Shutdown Imminent",
            "REPLBATT": "UPS Battery Replacement Needed",
            "NOCOMM": "UPS Not Reachable",
            "NOPARENT": "Parent Process Lost"
        }
        
        title = event_titles.get(event_type, f"UPS Event: {event_type}")
        
        return notifier.send_notification(title, message, event_type)
        
    except Exception as e:
        logger.error(f"Error sending Ntfy event notification: {str(e)}")
        return {"success": False, "message": str(e)} 