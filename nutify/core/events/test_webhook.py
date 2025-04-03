#!/usr/bin/env python3
"""
Webhook Notifier Test Script

This script is designed to test the webhook notification functionality.
It allows testing webhook configurations without triggering actual UPS events.

Usage:
  python3 test_webhook.py [config_id] [event_type] [--list-configs]

  - config_id: The ID of the webhook configuration to test (if omitted, uses default)
  - event_type: The event type to simulate (ONLINE, ONBATT, etc.)
  - --list-configs: List all available webhook configurations

Example:
  python3 test_webhook.py --list-configs
  python3 test_webhook.py 1 ONBATT
  python3 test_webhook.py default TEST
"""

import os
import sys
import argparse
import json
from pathlib import Path

# Get the absolute path to the project directory
PROJECT_DIR = Path(__file__).resolve().parent.parent.parent
sys.path.append(str(PROJECT_DIR))

# Import the required modules
from core import create_app
from core.logger import system_logger as logger

def list_webhook_configs():
    """List all webhook configurations"""
    print("\nAvailable webhook configurations:")
    print("-" * 50)
    
    with app.app_context():
        try:
            from core.extranotifs.webhook.db import get_configs_from_db
            configs = get_configs_from_db()
            
            if not configs:
                print("No webhook configurations found.")
                return
            
            print(f"{'ID':<5} {'Name':<30} {'Default':<10} {'URL':<50}")
            print("-" * 95)
            
            for config in configs:
                is_default = "✓" if config.get('is_default') else ""
                print(f"{config.get('id'):<5} {config.get('name')[:30]:<30} {is_default:<10} {config.get('url')[:50]:<50}")
                
        except Exception as e:
            print(f"Error listing webhook configurations: {e}")

def test_webhook(config_id, event_type):
    """Test a webhook configuration with a specific event type"""
    with app.app_context():
        try:
            # Get the configuration
            from core.extranotifs.webhook.db import get_config_by_id, get_default_config
            
            config = None
            if config_id.lower() == 'default':
                config = get_default_config()
                if not config:
                    print("No default webhook configuration found.")
                    return
            else:
                try:
                    config_id = int(config_id)
                    config = get_config_by_id(config_id)
                    if not config:
                        print(f"No webhook configuration found with ID {config_id}.")
                        return
                except ValueError:
                    print(f"Invalid configuration ID: {config_id}")
                    return
            
            # Test the webhook
            print(f"\nTesting webhook configuration: {config.get('name')} (ID: {config.get('id')})")
            print(f"URL: {config.get('url')}")
            print(f"Event type: {event_type}")
            print("-" * 50)
            
            from core.extranotifs.webhook.webhook import test_notification
            result = test_notification(config, event_type)
            
            print("\nResult:")
            if result.get('success'):
                print(f"✅ Success: {result.get('message')}")
            else:
                print(f"❌ Failed: {result.get('message')}")
                
            if 'status_code' in result:
                print(f"Status code: {result.get('status_code')}")
                
            if 'response' in result:
                print(f"Response: {result.get('response')}")
                
        except Exception as e:
            print(f"Error testing webhook: {e}")
            import traceback
            traceback.print_exc()

def main():
    """Main entry point"""
    global app
    app = create_app()
    
    parser = argparse.ArgumentParser(description="Test webhook notifications")
    parser.add_argument("config_id", nargs="?", default="default", 
                      help="The ID of the webhook configuration to test or 'default' for the default configuration")
    parser.add_argument("event_type", nargs="?", default="TEST", 
                      help="The event type to simulate (e.g., ONLINE, ONBATT)")
    parser.add_argument("--list-configs", action="store_true", 
                      help="List all available webhook configurations")
    
    args = parser.parse_args()
    
    if args.list_configs:
        list_webhook_configs()
        return
    
    test_webhook(args.config_id, args.event_type)

if __name__ == "__main__":
    main() 