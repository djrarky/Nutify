# UPS Notifier System

The UPS notifier system is responsible for handling UPS events from Network UPS Tools (NUT) and sending notifications via email.

## Components

- **ups_notifier.py**: Main notifier script called by NUT when UPS events occur
- **test_notifier.py**: Test script for simulating UPS events in development environments
- **api_events.py**: API endpoints for UPS events
- **handlers.py**: Event handling logic
- **routes_events.py**: Web routes for events

## Testing in Development

### Setting up for testing

1. Make sure the script is using `/tmp` for logs on macOS (already configured)
2. Run the test setup to prepare the database:

```bash
cd /path/to/nutify
python3 core/events/test_notifier.py --create-test-db
```

This will:
- Create required database tables if missing
- Configure test email settings
- Enable notifications for all event types
- Add fake UPS data for testing

### Testing individual events

You can test specific event types:

```bash
# Test a battery event
python3 core/events/test_notifier.py ONBATT

# Test an online power event
python3 core/events/test_notifier.py ONLINE

# Test low battery event
python3 core/events/test_notifier.py LOWBATT
```

### Testing all events

To test all supported event types:

```bash
python3 core/events/test_notifier.py all
```

### Supported Event Types

The following event types are supported:

- `ONLINE`: UPS is operating on utility power
- `ONBATT`: UPS is operating on battery power
- `LOWBATT`: UPS battery is low
- `COMMOK`: Communication with UPS restored
- `COMMBAD`: Communication with UPS lost
- `SHUTDOWN`: System shutdown in progress
- `REPLBATT`: Battery needs replacement
- `NOCOMM`: No communication with UPS
- `NOPARENT`: Parent process died
- `FSD`: Forced shutdown in progress

## Deployment

In production:
- The script will be called directly by NUT
- It will use `/var/log/nut` for logging
- Email templates from `templates/dashboard/mail` will be used 