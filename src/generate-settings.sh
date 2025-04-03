#!/bin/sh
# Script to generate settings.txt and NUT configuration files from environment variables

# We don't reset ENABLE_LOG_STARTUP here, we preserve the value
# set by docker-entrypoint
# NOTE: The value has already been set in docker-entrypoint

# We don't reset SSL_ENABLED here either, we preserve the value
# set by docker-entrypoint
# NOTE: SSL_ENABLED has already been set in docker-entrypoint

# Function for startup logging
startup_log() {
  local message="$@"
  local timestamp=$(date '+%Y-%m-%d %H:%M:%S')
  
  # Create log directory if it doesn't exist
  mkdir -p /var/log/nut 2>/dev/null
  
  # Ensure debug log file exists
  touch /var/log/nut-debug.log
  
  # Log to file always
  echo "[${timestamp}] ${message}" >> /var/log/nut-debug.log
  
  # Only output to console if ENABLE_LOG_STARTUP is exactly "Y"
  if [ "$ENABLE_LOG_STARTUP" = "Y" ]; then
    echo "[CONFIG] $message"
  fi
}

# Function to show the MOTD (always displayed)
show_motd() {
  # Simple and direct method to display the MOTD
  # Avoids file descriptor issues in container environment
  
  # Read version from file
  if [ -f "/app/nutify/version.txt" ]; then
    VERSION=$(grep "VERSION =" /app/nutify/version.txt | cut -d "=" -f2 | tr -d ' ')
    LAST_UPDATE=$(grep "LAST_UPDATE =" /app/nutify/version.txt | cut -d "=" -f2 | tr -d ' ')
  else
    VERSION="Unknown"
    LAST_UPDATE="Unknown"
  fi

  # ASCII Art MOTD - Always display this regardless of log settings
  cat << EOF

  _   _ _   _ _____ ___ _______   __
 | \\ | | | | |_   _|_ _|  ___\\ \\ / /
 |  \\| | | | | | |  | || |_   \\ V / 
 | |\\  | |_| | | |  | ||  _|   | |  
 |_| \\_|\\___/  |_| |___|_|     |_|  

  Network UPS Tools Interface v${VERSION}
  Last Update: ${LAST_UPDATE}
  https://github.com/DartSteven/nutify


EOF
}

# Function to set system timezone based on TIMEZONE environment variable
set_system_timezone() {
  # Check if TIMEZONE is set and not empty
  if [ -n "$TIMEZONE" ]; then
    startup_log "🕒 Setting system timezone to: $TIMEZONE"
    
    # Check if the timezone is valid
    if [ -f "/usr/share/zoneinfo/$TIMEZONE" ]; then
      # Set timezone in /etc/timezone
      echo "$TIMEZONE" > /etc/timezone
      
      # Update /etc/localtime
      ln -sf "/usr/share/zoneinfo/$TIMEZONE" /etc/localtime
      
      # Apply timezone change
      if command -v dpkg-reconfigure > /dev/null 2>&1; then
        dpkg-reconfigure -f noninteractive tzdata > /dev/null 2>&1
      fi
      
      startup_log "System timezone set to $TIMEZONE"
    else
      startup_log "WARNING: Invalid timezone '$TIMEZONE'. Using system default."
    fi
  else
    startup_log "No timezone specified. Using system default."
  fi
}

# Always show the MOTD at startup
show_motd

# Set system timezone before any redirects
set_system_timezone

# Output file for Nutify settings
SETTINGS_FILE="/app/nutify/config/settings.txt"

# We don't redirect output to /dev/null anymore to ensure MOTD and summary are always visible
# The redirection will be handled by start-services.sh after the summary is displayed

# Ensure directories exist with proper permissions
create_dirs() {
  # Compatible way with sh to define and iterate over multiple values
  settings_dir="$(dirname "$SETTINGS_FILE")"
  
  for dir in "$settings_dir" "/etc/nut"; do
    if [ ! -d "$dir" ]; then
      startup_log "Creating directory: $dir"
      mkdir -p "$dir"
      if [ $? -ne 0 ]; then
        startup_log "ERROR: Failed to create directory $dir"
        return 1
      fi
    fi
  done
  
  # Set proper permissions for NUT directory
  chown -R nut:nut /etc/nut
  chmod 750 /etc/nut
  return 0
}

# Create required directories
if ! create_dirs; then
  startup_log "CRITICAL ERROR: Failed to create required directories"
  exit 1
fi

# Set defaults for logging variables if not defined
# This ensures we never have empty values in the settings.txt file
if [ -z "${LOG}" ]; then
  LOG="false"
  startup_log "LOG not defined, defaulting to false"
fi

if [ -z "${LOG_LEVEL}" ]; then
  LOG_LEVEL="INFO"
  startup_log "LOG_LEVEL not defined, defaulting to INFO"
fi

if [ -z "${LOG_WERKZEUG}" ]; then
  LOG_WERKZEUG="false"
  startup_log "LOG_WERKZEUG not defined, defaulting to false"
fi

# Create settings.txt file
startup_log "Creating settings.txt file"
cat > $SETTINGS_FILE << EOF
# Server Name
SERVER_NAME = ${SERVER_NAME:-Nutify}

# UPS Configuration
UPS_HOST = ${UPS_HOST:-localhost}
UPS_NAME = ${UPS_NAME:-ups}
UPS_USER = ${UPS_USER:-admin}
UPS_PASSWORD = ${UPS_PASSWORD:-hunter2}
UPS_COMMAND = upsc
COMMAND_TIMEOUT = 10

# UPS Power Configuration
UPS_REALPOWER_NOMINAL = ${UPS_REALPOWER_NOMINAL:-1000}

# UPSCMD Configuration
UPSCMD_COMMAND = upscmd
UPSCMD_USER = ${UPSCMD_USER:-${UPS_USER:-admin}}
UPSCMD_PASSWORD = ${UPSCMD_PASSWORD:-${UPS_PASSWORD:-hunter2}}

# Server Configuration
DEBUG_MODE = development
SERVER_PORT = ${SERVER_PORT:-5050}
SERVER_HOST = ${SERVER_HOST:-0.0.0.0}

# Database Configuration
DB_NAME = nutify.db.sqlite
INSTANCE_PATH = instance

# Cache Configuration
CACHE_SECONDS = 60

# Your ENCRYPTION_KEY
ENCRYPTION_KEY = ${ENCRYPTION_KEY}

# Timezone Configuration
TIMEZONE = ${TIMEZONE:-UTC}

# Log level: DEBUG, INFO, WARNING, ERROR, CRITICAL
LOG_LEVEL = ${LOG_LEVEL}

# Werkzeug log control: true or false
LOG_WERKZEUG = ${LOG_WERKZEUG}

# General logging enabled: true or false
LOG = ${LOG}

# Mail Configuration
MSMTP_PATH = /usr/bin/msmtp
TLS_CERT_PATH = /etc/ssl/certs/ca-certificates.crt

# Dummy UPS Configuration
USE_DUMMY_UPS = ${USE_DUMMY_UPS:-false}
DUMMY_UPS_NAME = ${DUMMY_UPS_NAME:-dummy}
DUMMY_UPS_DRIVER = ${DUMMY_UPS_DRIVER:-dummy-ups}
DUMMY_UPS_PORT = ${DUMMY_UPS_PORT:-dummy}
DUMMY_UPS_DESC = ${DUMMY_UPS_DESC:-"Virtual UPS for testing"}

# SSL Configuration
SSL_ENABLED = ${SSL_ENABLED:-false}
SSL_CERT = /app/ssl/cert.pem
SSL_KEY = /app/ssl/key.pem
EOF

# Check if the settings file was created successfully
if [ ! -f "$SETTINGS_FILE" ]; then
  startup_log "CRITICAL ERROR: Failed to create settings file"
  exit 1
fi

startup_log "Settings file created successfully: $SETTINGS_FILE"

# Function to generate a configuration file with error checking
generate_config_file() {
  local file_path="$1"
  local content="$2"
  local description="$3"
  
  startup_log "Generating $description: $file_path"
  
  echo "$content" > "$file_path"
  
  if [ $? -ne 0 ] || [ ! -f "$file_path" ]; then
    startup_log "ERROR: Failed to create $description: $file_path"
    return 1
  fi
  
  return 0
}

# Function to setup dummy UPS configuration if enabled
setup_dummy_ups() {
  # Get USE_DUMMY_UPS from environment with default to false
  USE_DUMMY_UPS=${USE_DUMMY_UPS:-false}
  
  if [ "$USE_DUMMY_UPS" = "true" ]; then
    startup_log "Dummy UPS configuration enabled"
    
    # Get dummy UPS configuration from environment variables with defaults
    DUMMY_UPS_NAME=${DUMMY_UPS_NAME:-dummy}
    DUMMY_UPS_DRIVER=${DUMMY_UPS_DRIVER:-dummy-ups}
    DUMMY_UPS_PORT=${DUMMY_UPS_PORT:-dummy}
    DUMMY_UPS_DESC=${DUMMY_UPS_DESC:-"Virtual UPS for testing"}
    
    # Create dummy-ups.dev file
    startup_log "Creating dummy UPS device file: /etc/nut/dummy-ups.dev"
    cat > /etc/nut/dummy-ups.dev << EOF
[${DUMMY_UPS_NAME}]
driver = ${DUMMY_UPS_DRIVER}
port = ${DUMMY_UPS_PORT}
desc = "${DUMMY_UPS_DESC}"
EOF
    
    # Set proper permissions
    chown nut:nut /etc/nut/dummy-ups.dev
    chmod 640 /etc/nut/dummy-ups.dev
    
    startup_log "Dummy UPS device file created successfully"
    return 0
  else
    startup_log "Dummy UPS configuration disabled"
    return 0
  fi
}

# Check operational mode and remote UPS configuration
USE_REMOTE_UPS=false
IS_REMOTE_HOST=false
NUT_TYPE=${NUT_TYPE:-SERVER}

# Log the operational mode
startup_log "NUT operational mode: ${NUT_TYPE}"

# Handle CLIENT mode or remote UPS detection
if [ "${NUT_TYPE}" = "CLIENT" ]; then
  # Client mode explicitly requested
  if [ -z "${UPS_HOST}" ] || [ "${UPS_HOST}" = "localhost" ] || [ "${UPS_HOST}" = "127.0.0.1" ]; then
    startup_log "WARNING: NUT_TYPE=CLIENT but UPS_HOST is not set to a remote server. Using localhost."
    IS_REMOTE_HOST=false
  else
    startup_log "Operating in CLIENT mode, connecting to remote NUT server: ${UPS_HOST}"
    IS_REMOTE_HOST=true
    USE_REMOTE_UPS=true
    
    # Create a flag file to indicate we're using a remote UPS
    touch /var/run/nut/USE_REMOTE_UPS
    chown nut:nut /var/run/nut/USE_REMOTE_UPS
    startup_log "Created flag file to indicate CLIENT mode"
  fi
elif [ "${NUT_TYPE}" = "SERVER" ]; then
  # Server mode (default)
  startup_log "Operating in SERVER mode with local UPS drivers"
  
  # For SNMP driver pointing to remote UPS, we still run in SERVER mode
  if [ -n "${UPS_HOST}" ] && [ "${UPS_HOST}" != "localhost" ] && [ "${UPS_HOST}" != "127.0.0.1" ] && [ "${UPS_DRIVER}" = "snmp-ups" ]; then
    startup_log "SNMP driver will connect to remote UPS device at: ${UPS_HOST}"
    # Set default SNMP port if not specified
    if [ -z "${UPS_PORT}" ]; then
      UPS_PORT="161"
      startup_log "SNMP driver configuration: using default SNMP port: ${UPS_PORT}"
    fi
    startup_log "SNMP driver configuration: host=${UPS_HOST}, port=${UPS_PORT}"
    IS_REMOTE_HOST=true
    USE_REMOTE_UPS=false
  fi
else
  # Invalid mode
  startup_log "WARNING: Invalid NUT_TYPE '${NUT_TYPE}'. Must be SERVER or CLIENT. Defaulting to SERVER."
  NUT_TYPE="SERVER"
fi

# ---- GENERATING NUT CONFIGURATION FILES ----

# 1. Generate ups.conf
UPS_CONF_CONTENT=$(cat << EOF
[${UPS_NAME:-ups}]
    driver = ${UPS_DRIVER:-usbhid-ups}
    port = ${UPS_PORT:-auto}
    pollinterval = 1
    pollfreq = 1
    desc = "UPS ${SERVER_NAME:-Nutify}"
    # Additional permissions options for USB drivers
    user = nut
    group = nut
    # Debug options for USB issues
    # Uncomment the next line for more verbose debugging
    # debug_min = 1
EOF
)

# Modify ups.conf content for SNMP driver
if [ "${UPS_DRIVER}" = "snmp-ups" ]; then
  UPS_CONF_CONTENT=$(cat << EOF
[${UPS_NAME:-ups}]
    driver = ${UPS_DRIVER}
    port = ${UPS_PORT:-161}
    desc = "UPS ${SERVER_NAME:-Nutify}"
    snmp_host = ${UPS_HOST:-localhost}
    snmp_version = v1
    # Additional permissions options for SNMP driver
    user = nut
    group = nut
    # Debug options for SNMP issues
    # Uncomment the next line for more verbose debugging
    # debug_min = 1
EOF
)
  startup_log "Generated SNMP-specific UPS configuration: host=${UPS_HOST:-localhost}, port=${UPS_PORT:-161}"
fi

# Add dummy UPS configuration if enabled
if [ "${USE_DUMMY_UPS:-false}" = "true" ]; then
  DUMMY_UPS_NAME=${DUMMY_UPS_NAME:-dummy}
  DUMMY_UPS_DRIVER=${DUMMY_UPS_DRIVER:-dummy-ups}
  DUMMY_UPS_PORT=${DUMMY_UPS_PORT:-dummy}
  DUMMY_UPS_DESC=${DUMMY_UPS_DESC:-"Virtual UPS for testing"}
  
  UPS_CONF_CONTENT="${UPS_CONF_CONTENT}

[${DUMMY_UPS_NAME}]
    driver = ${DUMMY_UPS_DRIVER}
    port = ${DUMMY_UPS_PORT}
    desc = \"${DUMMY_UPS_DESC}\"
"
  startup_log "Added dummy UPS configuration to ups.conf"
fi

if ! generate_config_file "/etc/nut/ups.conf" "$UPS_CONF_CONTENT" "UPS configuration file"; then
  startup_log "CRITICAL ERROR: Failed to create UPS configuration file"
  exit 1
fi

startup_log "UPS configuration: driver=${UPS_DRIVER:-usbhid-ups}, port=${UPS_PORT:-auto}"

# Setup dummy UPS device file if enabled
setup_dummy_ups

# 2. Generate upsd.conf
UPSD_CONF_CONTENT=$(cat << EOF
LISTEN 0.0.0.0 3493
MAXAGE 15
EOF
)

if ! generate_config_file "/etc/nut/upsd.conf" "$UPSD_CONF_CONTENT" "UPSD configuration file"; then
  startup_log "CRITICAL ERROR: Failed to create UPSD configuration file"
  exit 1
fi

# 3. Generate upsd.users
UPSD_USERS_CONTENT=$(cat << EOF
[${UPS_USER:-admin}]
    password = ${UPS_PASSWORD:-hunter2}
    actions = SET
    instcmds = ALL
    upsmon master

[upsmon_local]
    password = ${UPS_PASSWORD:-hunter2}
    upsmon master

[upsmon_remote]
    password = ${UPS_PASSWORD:-hunter2}
    upsmon slave

[monuser]
    password = secret
    upsmon slave
EOF
)

if ! generate_config_file "/etc/nut/upsd.users" "$UPSD_USERS_CONTENT" "UPSD users file"; then
  startup_log "CRITICAL ERROR: Failed to create UPSD users file"
  exit 1
fi

# 4. Generate upsmon.conf
UPSMON_CONF_CONTENT=$(cat << EOF
MONITOR ${UPS_NAME:-ups}@${UPS_HOST:-localhost} 1 ${UPS_USER:-admin} ${UPS_PASSWORD:-hunter2} master
MINSUPPLIES 1
SHUTDOWNCMD "/sbin/shutdown -h now"
NOTIFYCMD /app/nutify/core/events/ups_notifier.py
POLLFREQ 5
POLLFREQALERT 5
HOSTSYNC 15
DEADTIME 15
POWERDOWNFLAG /etc/killpower

# Enhanced logging for better visibility
RBWARNTIME 43200
NOCOMMWARNTIME 300
FINALDELAY 5

# Enable all notification flags with EXEC to ensure script execution
NOTIFYFLAG ONLINE SYSLOG+WALL+EXEC
NOTIFYFLAG ONBATT SYSLOG+WALL+EXEC
NOTIFYFLAG LOWBATT SYSLOG+WALL+EXEC
NOTIFYFLAG FSD SYSLOG+WALL+EXEC
NOTIFYFLAG COMMOK SYSLOG+WALL+EXEC
NOTIFYFLAG COMMBAD SYSLOG+WALL+EXEC
NOTIFYFLAG SHUTDOWN SYSLOG+WALL+EXEC
NOTIFYFLAG REPLBATT SYSLOG+WALL+EXEC
NOTIFYFLAG NOCOMM SYSLOG+WALL+EXEC
NOTIFYFLAG NOPARENT SYSLOG+WALL+EXEC

# Add debug flags for more verbose logging
DEBUG_MIN 2
RUN_AS_USER nut
EOF
)

if ! generate_config_file "/etc/nut/upsmon.conf" "$UPSMON_CONF_CONTENT" "UPSMON configuration file"; then
  startup_log "CRITICAL ERROR: Failed to create UPSMON configuration file"
  exit 1
fi

# 5. Generate nut.conf
if [ "${NUT_TYPE}" = "CLIENT" ]; then
  # For client mode, use netclient mode to avoid conflicts
  NUT_CONF_CONTENT=$(cat << EOF
# Operating in CLIENT mode
MODE=netclient
EOF
  )
else
  # For server mode, use netserver
  NUT_CONF_CONTENT=$(cat << EOF
# Operating in SERVER mode
MODE=netserver
EOF
  )
fi

if ! generate_config_file "/etc/nut/nut.conf" "$NUT_CONF_CONTENT" "NUT mode configuration file"; then
  startup_log "CRITICAL ERROR: Failed to create NUT mode configuration file"
  exit 1
fi

# Set correct permissions for all NUT files
startup_log "Setting file permissions..."
chmod 640 /etc/nut/*.conf /etc/nut/upsd.users
chown -R nut:nut /etc/nut
startup_log "File permissions set correctly"

# Verify that essential configuration files exist
startup_log "Verifying configuration files..."
# Compatible way with sh to define and iterate over multiple values
essential_file1="ups.conf"
essential_file2="upsd.conf" 
essential_file3="upsd.users"
essential_file4="upsmon.conf"
essential_file5="nut.conf"
missing=0

# Check each file individually
for file in $essential_file1 $essential_file2 $essential_file3 $essential_file4 $essential_file5; do
  if [ -f "/etc/nut/$file" ]; then
    startup_log "File $file found in /etc/nut"
  else
    startup_log "ERROR: File $file not found in /etc/nut!"
    missing=$((missing + 1))
  fi
done

if [ $missing -gt 0 ]; then
  startup_log "CRITICAL ERROR: $missing essential configuration files are missing"
  exit 1
fi

startup_log "Configuration completed successfully"

# Export ENABLE_LOG_STARTUP to ensure it's passed to child processes
export ENABLE_LOG_STARTUP

# Continue with the original command
exec "$@"
