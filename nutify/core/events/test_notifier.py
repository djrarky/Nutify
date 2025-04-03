#!/usr/bin/env python3
"""
UPS Notifier Test Script

This script is designed to test the UPS notifier script without needing access to a real UPS.
It simulates different UPS events by calling the notifier script directly.

Usage:
  python3 test_notifier.py [event_type] [--create-test-db]

  - event_type: One of ONLINE, ONBATT, LOWBATT, COMMOK, COMMBAD, SHUTDOWN, REPLBATT, NOCOMM, NOPARENT, FSD
  - --create-test-db: Optional flag to create or update test database data for testing

Example:
  python3 test_notifier.py ONBATT
  python3 test_notifier.py --create-test-db
  python3 test_notifier.py all  # Test all event types
"""

import os
import sys
import sqlite3
import subprocess
import argparse
from pathlib import Path

# Get the absolute path to the project directory
PROJECT_DIR = Path(__file__).resolve().parent.parent.parent
NOTIFIER_SCRIPT = os.path.join(PROJECT_DIR, "core", "events", "ups_notifier.py")
DB_PATH = os.path.join(PROJECT_DIR, "instance", "nutify.db.sqlite")
TEST_UPS_NAME = "test_ups@localhost"

# Supported event types
EVENT_TYPES = [
    "ONLINE",
    "ONBATT",
    "LOWBATT",
    "COMMOK", 
    "COMMBAD",
    "SHUTDOWN",
    "REPLBATT",
    "NOCOMM",
    "NOPARENT",
    "FSD",
    "CAL",
    "TRIM",
    "BOOST",
    "OFF",
    "OVERLOAD",
    "BYPASS",
    "NOBATT",
    "DATAOLD"
]

# Human-readable event messages
EVENT_MESSAGES = {
    "ONLINE": f"UPS {TEST_UPS_NAME} on line power",
    "ONBATT": f"UPS {TEST_UPS_NAME} on battery",
    "LOWBATT": f"UPS {TEST_UPS_NAME} low battery power",
    "COMMOK": f"UPS {TEST_UPS_NAME} communication restored",
    "COMMBAD": f"UPS {TEST_UPS_NAME} communication lost",
    "SHUTDOWN": f"UPS {TEST_UPS_NAME} shutdown in progress",
    "REPLBATT": f"UPS {TEST_UPS_NAME} battery needs replacing",
    "NOCOMM": f"UPS {TEST_UPS_NAME} no communication",
    "NOPARENT": f"UPS {TEST_UPS_NAME} parent process lost",
    "FSD": f"UPS {TEST_UPS_NAME} forced shutdown",
    "CAL": f"UPS {TEST_UPS_NAME} calibration in progress",
    "TRIM": f"UPS {TEST_UPS_NAME} trim mode active",
    "BOOST": f"UPS {TEST_UPS_NAME} boost mode active",
    "OFF": f"UPS {TEST_UPS_NAME} off-line",
    "OVERLOAD": f"UPS {TEST_UPS_NAME} overloaded",
    "BYPASS": f"UPS {TEST_UPS_NAME} on bypass",
    "NOBATT": f"UPS {TEST_UPS_NAME} battery missing",
    "DATAOLD": f"UPS {TEST_UPS_NAME} data old"
}

def setup_database():
    """Create or update test data in the database for notification testing"""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    # Create notification options if they don't exist already
    cursor.execute("SELECT count(*) FROM ups_opt_notification")
    if cursor.fetchone()[0] == 0:
        print("Creating notification options...")
        for idx, event_type in enumerate(EVENT_TYPES, 1):
            cursor.execute(
                "INSERT OR IGNORE INTO ups_opt_notification (id, event_type, enabled, created_at, updated_at) VALUES (?, ?, ?, datetime('now'), datetime('now'))",
                (idx, event_type, 0)
            )
    
    # Create a test email configuration if none exists
    cursor.execute("SELECT count(*) FROM ups_opt_mail_config")
    if cursor.fetchone()[0] == 0:
        print("Creating test email configuration...")
        cursor.execute(
            """
            INSERT INTO ups_opt_mail_config (
                id, smtp_server, smtp_port, username, password, 
                enabled, provider, tls, tls_starttls, is_default, 
                to_email, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
            """,
            (1, "smtp.example.com", 587, "test@example.com", "test_password", 
             1, "test", 1, 1, 1, 
             "test@example.com")
        )
    
    # Create test ntfy configuration if the table exists and is empty
    try:
        cursor.execute("SELECT count(*) FROM ups_opt_ntfy")
        if cursor.fetchone()[0] == 0:
            print("Creating test ntfy configuration...")
            cursor.execute(
                """
                INSERT INTO ups_opt_ntfy (
                    id, server_type, server, topic, use_auth, username, password,
                    priority, use_tags, is_default, notify_onbatt, notify_online,
                    notify_lowbatt, notify_commok, notify_commbad, notify_shutdown,
                    notify_replbatt, notify_nocomm, notify_noparent, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
                """,
                (1, "ntfy.sh", "https://ntfy.sh", "test_topic", 0, "", "",
                 3, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1)
            )
    except sqlite3.OperationalError:
        print("Note: ups_opt_ntfy table doesn't exist, skipping ntfy configuration")
    
    # Enable notification for all event types with email config 1
    print("Enabling all notification types for testing...")
    for event_type in EVENT_TYPES:
        cursor.execute(
            "UPDATE ups_opt_notification SET enabled = 1, id_email = 1 WHERE event_type = ?",
            (event_type,)
        )
    
    # Add fake UPS data
    add_fake_ups_data(cursor)
    
    conn.commit()
    conn.close()
    print("Database setup complete!")

def add_fake_ups_data(cursor):
    """Add fake UPS data to the database for testing"""
    # Check if ups_static_data table exists and has data
    cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='ups_static_data'")
    if not cursor.fetchone():
        print("Creating static data table...")
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS ups_static_data (
            id INTEGER PRIMARY KEY,
            device_model TEXT,
            device_serial TEXT,
            battery_type TEXT,
            ups_firmware TEXT,
            ups_id TEXT,
            ups_contact TEXT,
            ups_location TEXT,
            timestamp TEXT
        )
        """)
    
    # Insert fake static data
    cursor.execute("SELECT count(*) FROM ups_static_data")
    if cursor.fetchone()[0] == 0:
        print("Adding fake UPS static data...")
        cursor.execute("""
        INSERT INTO ups_static_data (
            device_model, device_serial, battery_type, 
            ups_firmware, ups_id, ups_contact, ups_location, timestamp
        ) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
        """, (
            "APC Smart-UPS RT 3000", "AS1234567890", "VRLA",
            "UPS 09.3", "Test_UPS_1", "admin@example.com", "Server Room", 
        ))
    
    # Check if ups_dynamic_data table exists and has data
    cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='ups_dynamic_data'")
    if not cursor.fetchone():
        print("Creating dynamic data table...")
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS ups_dynamic_data (
            id INTEGER PRIMARY KEY,
            ups_status TEXT,
            battery_charge TEXT,
            battery_runtime TEXT,
            input_voltage TEXT,
            battery_voltage TEXT,
            battery_voltage_nominal TEXT,
            ups_timer_shutdown TEXT,
            timestamp TEXT
        )
        """)
    
    # Insert fake dynamic data
    cursor.execute("SELECT count(*) FROM ups_dynamic_data")
    if cursor.fetchone()[0] == 0:
        print("Adding fake UPS dynamic data...")
        cursor.execute("""
        INSERT INTO ups_dynamic_data (
            ups_status, battery_charge, battery_runtime, 
            input_voltage, battery_voltage, battery_voltage_nominal,
            ups_timer_shutdown, timestamp
        ) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
        """, (
            "OL", "100", "7200",  # Online, 100% charged, 2 hour runtime (in seconds)
            "230", "27.2", "24.0",
            "0"
        ))

def run_notifier(event_type):
    """Run the UPS notifier with the specified event type"""
    # Use only the standard format for testing
    cmd_args = [TEST_UPS_NAME, event_type]
    print(f"\nTesting format: {' '.join(cmd_args)}")
    cmd = [sys.executable, NOTIFIER_SCRIPT] + cmd_args
    
    try:
        result = subprocess.run(cmd, capture_output=True, text=True)
        print(f"Exit code: {result.returncode}")
        
        if result.stdout:
            print("Output:")
            print(result.stdout)
            
        if result.stderr:
            print("Errors:")
            print(result.stderr)
            
    except Exception as e:
        print(f"Error running notifier: {e}")

def parse_arguments():
    """Parse command line arguments"""
    parser = argparse.ArgumentParser(description="Test the UPS notifier script")
    parser.add_argument("event_type", nargs="?", default=None, 
                      help=f"Event type to test. One of: {', '.join(EVENT_TYPES)}, or 'all' for all events")
    parser.add_argument("--create-test-db", action="store_true", 
                      help="Create or update test data in the database")
    
    return parser.parse_args()

def main():
    """Main entry point"""
    args = parse_arguments()
    
    # Check if the notifier script exists
    if not os.path.isfile(NOTIFIER_SCRIPT):
        print(f"Error: Notifier script not found at {NOTIFIER_SCRIPT}")
        sys.exit(1)
    
    # Setup database if requested
    if args.create_test_db:
        setup_database()
        if not args.event_type:
            return
    
    # Test specific event type or all event types
    if args.event_type == "all":
        for event_type in EVENT_TYPES:
            print(f"\n--- Testing event type: {event_type} ---")
            run_notifier(event_type)
    elif args.event_type in EVENT_TYPES:
        run_notifier(args.event_type)
    elif args.event_type is not None:
        print(f"Error: Unknown event type '{args.event_type}'")
        print(f"Valid event types: {', '.join(EVENT_TYPES)}")
        sys.exit(1)
    else:
        print("Please specify an event type to test or use --create-test-db to setup the database.")
        print(f"Valid event types: {', '.join(EVENT_TYPES)}")
        sys.exit(1)

if __name__ == "__main__":
    main() 