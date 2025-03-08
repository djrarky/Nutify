#!/bin/bash

# Get ENABLE_LOG_STARTUP from environment with default to N
ENABLE_LOG_STARTUP=${ENABLE_LOG_STARTUP:-N}

# Function for startup logging
startup_log() {
    local message="$1"
    local timestamp=$(date '+%Y-%m-%d %H:%M:%S')
    
    # Create log directory if it doesn't exist
    mkdir -p /var/log/nut 2>/dev/null
    
    # Ensure debug log file exists
    touch /var/log/nut-debug.log
    
    # Log to file always
    echo "[${timestamp}] ${message}" >> /var/log/nut-debug.log
    
    # For console output, check if we should use the STARTUP prefix
    if [ "$ENABLE_LOG_STARTUP" = "Y" ]; then
        echo "[STARTUP] $message"
    fi
}

# Function to cleanup existing socat processes
cleanup_socat() {
    # Kill all existing socat processes
    pkill -9 socat 2>/dev/null || true
    # Remove existing socket
    rm -f /tmp/ups_events.sock
    if [ "$ENABLE_LOG_STARTUP" = "Y" ]; then
        startup_log "Cleaned up existing socat processes and socket"
    fi
}

# Function to generate SSL certificates if they don't exist
ensure_ssl_certificates() {
    # Check if SSL is enabled
    SSL_ENABLED=$(grep -oP 'SSL_ENABLED\s*=\s*\K.*' /app/nutify/config/settings.txt | tr -d '"' | tr -d "'" | tr '[:upper:]' '[:lower:]')
    
    if [ "$SSL_ENABLED" = "true" ]; then
        if [ "$ENABLE_LOG_STARTUP" = "Y" ]; then
            startup_log "SSL is enabled, checking for certificates..."
        fi
        
        # Define certificate paths
        CERT_PATH="/app/ssl/cert.pem"
        KEY_PATH="/app/ssl/key.pem"
        
        # Check if certificates already exist
        if [ -f "$CERT_PATH" ] && [ -f "$KEY_PATH" ]; then
            # Check if certificates are valid
            if openssl x509 -in "$CERT_PATH" -noout -checkend 0 > /dev/null 2>&1; then
                if [ "$ENABLE_LOG_STARTUP" = "Y" ]; then
                    startup_log "Valid SSL certificates found at $CERT_PATH and $KEY_PATH"
                fi
                return 0
            else
                if [ "$ENABLE_LOG_STARTUP" = "Y" ]; then
                    startup_log "SSL certificate at $CERT_PATH has expired, generating new certificates..."
                fi
            fi
        else
            if [ "$ENABLE_LOG_STARTUP" = "Y" ]; then
                startup_log "SSL certificates not found, generating new self-signed certificates..."
            fi
        fi
        
        # Ensure SSL directory exists with proper permissions
        mkdir -p /app/ssl
        chown nut:nut /app/ssl
        chmod 750 /app/ssl
        
        # Generate self-signed certificates
        if [ "$ENABLE_LOG_STARTUP" = "Y" ]; then
            startup_log "Generating self-signed SSL certificates..."
        fi
        if openssl req -x509 -newkey rsa:4096 -nodes -out "$CERT_PATH" -keyout "$KEY_PATH" -days 365 -subj "/CN=nutify.local" -addext "subjectAltName=DNS:nutify.local,DNS:localhost,IP:127.0.0.1" > /dev/null 2>&1; then
            # Set proper permissions
            chown nut:nut "$CERT_PATH" "$KEY_PATH"
            chmod 640 "$CERT_PATH" "$KEY_PATH"
            if [ "$ENABLE_LOG_STARTUP" = "Y" ]; then
                startup_log "SSL certificates generated successfully"
            fi
            return 0
        else
            if [ "$ENABLE_LOG_STARTUP" = "Y" ]; then
                startup_log "Failed to generate SSL certificates"
            fi
            return 1
        fi
    else
        if [ "$ENABLE_LOG_STARTUP" = "Y" ]; then
            startup_log "SSL is disabled, skipping certificate generation"
        fi
        return 0
    fi
}

# Function to start socat socket listener - DISABLED to let Nutify handle the socket
start_socat() {
    # This function is intentionally empty to prevent socat from interfering with Nutify
    startup_log "Socat disabled to let Nutify handle the socket"
}

# Function to check if a process is running by PID file AND verify process exists
check_pid_file() {
  local pid_file="$1"
  local process_name="$2"
  
  # Check if PID file exists
  if [ ! -f "$pid_file" ]; then
    startup_log "PID file $pid_file not found for $process_name"
    return 1
  fi
  
  # Read PID from file
  local pid=$(cat "$pid_file" 2>/dev/null)
  
  # Check if PID was read successfully
  if [ -z "$pid" ]; then
    startup_log "Empty PID file for $process_name"
    return 1
  fi
  
  # Check if process is running with that PID
  if ! ps -p $pid > /dev/null; then
    startup_log "Process $process_name with PID $pid is not running"
    return 1
  fi
  
  return 0
}

# Function to check if a process is running by name
check_process() {
  local process_name="$1"
  local output=$(ps aux | grep -v grep | grep "$process_name")
  
  if [ -z "$output" ]; then
    startup_log "Process $process_name not found"
    return 1
  fi
  
  return 0
}

# Function to check if a service is listening on a port
check_port() {
  local port="$1"
  local timeout="${2:-1}"
  
  # Use timeout to prevent hanging if the network stack is unresponsive
  timeout $timeout bash -c "netstat -tulpn | grep -q ':$port'" 2>/dev/null
  
  if [ $? -ne 0 ]; then
    startup_log "No service listening on port $port"
    return 1
  fi
  
  return 0
}

# Function to kill a process safely with increasing force
safe_kill() {
  local process_name="$1"
  local pid_file="$2"
  local max_attempts=3
  local pid
  
  # If PID file provided, try to read PID from it
  if [ -n "$pid_file" ] && [ -f "$pid_file" ]; then
    pid=$(cat "$pid_file" 2>/dev/null)
  fi
  
  # If no PID from file, try to find it by name
  if [ -z "$pid" ]; then
    pid=$(pgrep -f "$process_name" 2>/dev/null)
  fi
  
  # If we still don't have a PID, there's nothing to kill
  if [ -z "$pid" ]; then
    if [ "$ENABLE_LOG_STARTUP" = "Y" ]; then
      startup_log "No running process found for $process_name"
    fi
    return 0
  fi
  
  # Try gentle kill first (SIGTERM)
  if [ "$ENABLE_LOG_STARTUP" = "Y" ]; then
    startup_log "Stopping $process_name (PID: $pid) with SIGTERM..."
  fi
  kill $pid 2>/dev/null
  
  # Wait and check if process terminated
  for i in $(seq 1 $max_attempts); do
    sleep 1
    if ! ps -p $pid > /dev/null 2>&1; then
      if [ "$ENABLE_LOG_STARTUP" = "Y" ]; then
        startup_log "$process_name terminated successfully"
      fi
      # Clean up PID file if it exists
      [ -f "$pid_file" ] && rm -f "$pid_file"
      return 0
    fi
    if [ "$ENABLE_LOG_STARTUP" = "Y" ]; then
      startup_log "Process $process_name still running, waiting... ($i/$max_attempts)"
    fi
  done
  
  # If still running, use SIGKILL
  if [ "$ENABLE_LOG_STARTUP" = "Y" ]; then
    startup_log "Sending SIGKILL to $process_name (PID: $pid)..."
  fi
  kill -9 $pid 2>/dev/null
  
  # Wait and check if process terminated
  sleep 1
  if ! ps -p $pid > /dev/null 2>&1; then
    if [ "$ENABLE_LOG_STARTUP" = "Y" ]; then
      startup_log "$process_name terminated with SIGKILL"
    fi
    # Clean up PID file if it exists
    [ -f "$pid_file" ] && rm -f "$pid_file"
    return 0
  else
    if [ "$ENABLE_LOG_STARTUP" = "Y" ]; then
      startup_log "CRITICAL: Failed to kill $process_name process!"
    fi
    return 1
  fi
}

# Function to check configuration files
check_config_files() {
  # Check that essential files are present
  local required_files=("ups.conf" "upsd.conf" "upsd.users" "upsmon.conf" "nut.conf")
  local missing_files=0
  
  for file in "${required_files[@]}"; do
    if [ -f "/etc/nut/$file" ]; then
      if [ "$ENABLE_LOG_STARTUP" = "Y" ]; then
        startup_log "File $file found in /etc/nut"
      fi
    else
      if [ "$ENABLE_LOG_STARTUP" = "Y" ]; then
        startup_log "ERROR: File $file not found in /etc/nut!"
      fi
      missing_files=$((missing_files + 1))
    fi
  done
  
  if [ $missing_files -gt 0 ]; then
    if [ "$ENABLE_LOG_STARTUP" = "Y" ]; then
      startup_log "CRITICAL ERROR: Essential configuration files missing in /etc/nut"
      startup_log "Contents of directory /etc/nut:"
      if [ "$ENABLE_LOG_STARTUP" = "Y" ]; then
        ls -la /etc/nut
      fi
    fi
    return 1
  fi
  
  return 0
}

# Function to check UPS configuration
check_ups_config() {
  # Extract UPS name from ups.conf file
  local ups_name=$(grep -oP '^\[\K[^\]]+' /etc/nut/ups.conf | head -1)
  
  if [ -z "$ups_name" ]; then
    if [ "$ENABLE_LOG_STARTUP" = "Y" ]; then
      startup_log "No UPS configuration found in ups.conf"
    fi
    return 1
  else
    # Save UPS name for future use
    echo "$ups_name" > /tmp/ups_name
    if [ "$ENABLE_LOG_STARTUP" = "Y" ]; then
      startup_log "UPS name detected: $ups_name"
    fi
    return 0
  fi
}

# Function to ensure proper PID directory permissions
ensure_pid_dirs() {
  # Create PID directories if they don't exist
  for dir in "/var/run/nut" "/run"; do
    if [ ! -d "$dir" ]; then
      if [ "$ENABLE_LOG_STARTUP" = "Y" ]; then
        startup_log "Creating PID directory: $dir"
      fi
      mkdir -p "$dir"
    fi
    
    # Set explicit and consistent ownership and permissions
    chown -R nut:nut "$dir"
    chmod 770 "$dir"
    if [ "$ENABLE_LOG_STARTUP" = "Y" ]; then
      startup_log "Set permissions for $dir: owner=nut:nut, mode=770"
    fi
  done
  
  # Create specific PID directory for upsmon if it doesn't exist
  if [ ! -d "/run/nut" ]; then
    mkdir -p "/run/nut"
    chown -R nut:nut "/run/nut"
    chmod 770 "/run/nut"
    if [ "$ENABLE_LOG_STARTUP" = "Y" ]; then
      startup_log "Created /run/nut directory for upsmon PID files"
    fi
  fi
  
  # Ensure symbolic link exists for consistent paths
  if [ ! -L "/run/nut" ] && [ ! -d "/run/nut" ]; then
    ln -sf /var/run/nut /run/nut
    if [ "$ENABLE_LOG_STARTUP" = "Y" ]; then
      startup_log "Created symbolic link from /var/run/nut to /run/nut"
    fi
  fi
  
  # Cleanup any stale PID files
  find /var/run/nut /run -name "*.pid" -type f -delete
  if [ "$ENABLE_LOG_STARTUP" = "Y" ]; then
    startup_log "Cleaned up stale PID files"
  fi
}

# Function to start UPS drivers
start_ups_drivers() {
  if [ "$ENABLE_LOG_STARTUP" = "Y" ]; then
    startup_log "Starting UPS drivers..."
  else
    echo "✅ Starting UPS drivers"
  fi
  
  # Ensure PID directories are ready
  ensure_pid_dirs
  
  # Check if dummy UPS is enabled
  USE_DUMMY_UPS=${USE_DUMMY_UPS:-false}
  
  if [ "$USE_DUMMY_UPS" = "true" ]; then
    if [ "$ENABLE_LOG_STARTUP" = "Y" ]; then
      startup_log "Dummy UPS configuration is enabled, checking if dummy-ups.dev exists"
    fi
    
    # Check if dummy-ups.dev file exists
    if [ -f "/etc/nut/dummy-ups.dev" ]; then
      if [ "$ENABLE_LOG_STARTUP" = "Y" ]; then
        startup_log "Found dummy-ups.dev file, using it as fallback if regular driver fails"
      fi
    else
      # Create dummy-ups.dev file if it doesn't exist
      DUMMY_UPS_NAME=${DUMMY_UPS_NAME:-dummy}
      DUMMY_UPS_DRIVER=${DUMMY_UPS_DRIVER:-dummy-ups}
      DUMMY_UPS_PORT=${DUMMY_UPS_PORT:-dummy}
      DUMMY_UPS_DESC=${DUMMY_UPS_DESC:-"Virtual UPS for testing"}
      
      if [ "$ENABLE_LOG_STARTUP" = "Y" ]; then
        startup_log "Creating dummy-ups.dev file"
      fi
      cat > /etc/nut/dummy-ups.dev << EOF
[${DUMMY_UPS_NAME}]
driver = ${DUMMY_UPS_DRIVER}
port = ${DUMMY_UPS_PORT}
desc = "${DUMMY_UPS_DESC}"
EOF
      chown nut:nut /etc/nut/dummy-ups.dev
      chmod 640 /etc/nut/dummy-ups.dev
      if [ "$ENABLE_LOG_STARTUP" = "Y" ]; then
        startup_log "Created dummy-ups.dev file"
      fi
    fi
  fi
  
  # First try normal start
  if [ "$ENABLE_LOG_STARTUP" = "Y" ]; then
    if su nut -s /bin/sh -c "/usr/sbin/upsdrvctl start"; then
      startup_log "UPS drivers started successfully"
      sleep 2
      return 0
    fi
  else
    if su nut -s /bin/sh -c "/usr/sbin/upsdrvctl start > /dev/null 2>&1"; then
      sleep 2
      return 0
    fi
  fi
  
  # If it fails, try with debug to see more information
  if [ "$ENABLE_LOG_STARTUP" = "Y" ]; then
    startup_log "First attempt failed. Starting UPS drivers in debug mode..."
    if su nut -s /bin/sh -c "/usr/sbin/upsdrvctl -D start"; then
      startup_log "UPS drivers started successfully in debug mode"
      sleep 2
      return 0
    fi
  else
    if su nut -s /bin/sh -c "/usr/sbin/upsdrvctl -D start > /dev/null 2>&1"; then
      sleep 2
      return 0
    fi
  fi
  
  # Only use dummy driver as fallback if USE_DUMMY_UPS is true
  if [ "${USE_DUMMY_UPS:-false}" = "true" ]; then
    # Try one last solution - use dummy driver as fallback
    if [ "$ENABLE_LOG_STARTUP" = "Y" ]; then
      startup_log "Starting dummy UPS driver as fallback..."
    fi
    
    # Get dummy UPS configuration from environment variables with defaults
    DUMMY_UPS_NAME=${DUMMY_UPS_NAME:-dummy}
    DUMMY_UPS_DRIVER=${DUMMY_UPS_DRIVER:-dummy-ups}
    DUMMY_UPS_PORT=${DUMMY_UPS_PORT:-dummy}
    DUMMY_UPS_DESC=${DUMMY_UPS_DESC:-"Virtual UPS for testing"}
    
    cat > /etc/nut/ups.conf.dummy << EOF
[${UPS_NAME:-ups}]
    driver = ${DUMMY_UPS_DRIVER}
    port = ${DUMMY_UPS_PORT}
    desc = "${DUMMY_UPS_DESC}"
EOF
    mv /etc/nut/ups.conf.dummy /etc/nut/ups.conf
    chown nut:nut /etc/nut/ups.conf
    
    # Start the dummy driver
    if [ "$ENABLE_LOG_STARTUP" = "Y" ]; then
      if su nut -s /bin/sh -c "/usr/sbin/upsdrvctl start"; then
        startup_log "Dummy UPS driver started successfully"
        sleep 2
        return 0
      fi
    else
      if su nut -s /bin/sh -c "/usr/sbin/upsdrvctl start > /dev/null 2>&1"; then
        sleep 2
        return 0
      fi
    fi
  else
    if [ "$ENABLE_LOG_STARTUP" = "Y" ]; then
      startup_log "Dummy UPS fallback is disabled. Not using dummy driver."
    fi
  fi
  
  if [ "$ENABLE_LOG_STARTUP" = "Y" ]; then
    startup_log "ERROR: Failed to start UPS drivers after multiple attempts"
  else
    echo "❌ ERROR: Failed to start UPS drivers"
  fi
  return 1
}

# Function to start the NUT server
start_upsd() {
  if [ "$ENABLE_LOG_STARTUP" = "Y" ]; then
    startup_log "Starting NUT server (upsd)..."
  fi
  
  # First check if upsd is already running
  if check_process "upsd"; then
    if [ "$ENABLE_LOG_STARTUP" = "Y" ]; then
      startup_log "upsd is already running, stopping it first..."
    fi
    safe_kill "upsd" "/var/run/nut/upsd.pid"
    sleep 1
  fi
  
  # Ensure PID directory is ready
  ensure_pid_dirs
  
  # Start upsd with proper user and explicit PID file path
  if [ "$ENABLE_LOG_STARTUP" = "Y" ]; then
    if su nut -s /bin/sh -c "/usr/sbin/upsd -P /var/run/nut/upsd.pid"; then
      startup_log "upsd started, waiting for it to be ready..."
      
      # Wait for upsd to start and listen on port
      local max_attempts=30
      for i in $(seq 1 $max_attempts); do
        if check_port 3493; then
          startup_log "NUT server started successfully and listening on port 3493"
          return 0
        fi
        
        sleep 1
        startup_log "Waiting for upsd to listen on port 3493... ($i/$max_attempts)"
      done
      
      startup_log "ERROR: Timeout waiting for upsd to listen on port 3493"
      return 1
    else
      startup_log "ERROR: Failed to start upsd"
      return 1
    fi
  else
    if su nut -s /bin/sh -c "/usr/sbin/upsd -P /var/run/nut/upsd.pid > /dev/null 2>&1"; then
      # Wait for upsd to start and listen on port
      local max_attempts=30
      for i in $(seq 1 $max_attempts); do
        if check_port 3493; then
          return 0
        fi
        sleep 1
      done
      
      echo "❌ ERROR: Timeout waiting for upsd to listen on port 3493"
      return 1
    else
      echo "❌ ERROR: Failed to start upsd"
      return 1
    fi
  fi
}

# Function to start the UPS monitor
start_upsmon() {
  if [ "$ENABLE_LOG_STARTUP" = "Y" ]; then
    startup_log "Starting UPS monitor (upsmon)..."
  fi
  
  # First check if upsmon is already running
  if check_process "upsmon"; then
    if [ "$ENABLE_LOG_STARTUP" = "Y" ]; then
      startup_log "upsmon is already running, stopping it first..."
    fi
    safe_kill "upsmon" "/run/upsmon.pid"
    sleep 1
  fi
  
  # Ensure PID directory is ready
  ensure_pid_dirs
  
  # Start upsmon with proper user and explicit PID file path
  if [ "$ENABLE_LOG_STARTUP" = "Y" ]; then
    if su nut -s /bin/sh -c "/usr/sbin/upsmon -P /run/upsmon.pid"; then
      startup_log "upsmon started, checking if process is running..."
      
      # Wait a moment and then check if the process is still running
      sleep 2
      if check_process "upsmon"; then
        startup_log "UPS monitor (upsmon) started successfully"
        return 0
      else
        startup_log "ERROR: upsmon process is not running after startup"
        return 1
      fi
    else
      startup_log "ERROR: Failed to start upsmon"
      return 1
    fi
  else
    if su nut -s /bin/sh -c "/usr/sbin/upsmon -P /run/upsmon.pid > /dev/null 2>&1"; then
      # Wait a moment and then check if the process is still running
      sleep 2
      if check_process "upsmon"; then
        return 0
      else
        echo "❌ ERROR: upsmon process is not running after startup"
        return 1
      fi
    else
      echo "❌ ERROR: Failed to start upsmon"
      return 1
    fi
  fi
}

# Function to start NUT services
start_nut_services() {
  # Ensure PID directories exist with correct permissions
  ensure_pid_dirs
  
  # Show configuration file contents for debugging
  if [ "$ENABLE_LOG_STARTUP" = "Y" ]; then
    startup_log "UPS configuration file loaded: $(cat /etc/nut/ups.conf | grep '\[' | tr -d '[]')"
    cat /etc/nut/ups.conf
    cat /etc/nut/upsd.conf
    cat /etc/nut/upsmon.conf
    cat /etc/nut/nut.conf
  fi
  
  # Start UPS drivers
  if ! start_ups_drivers; then
    if [ "$ENABLE_LOG_STARTUP" = "Y" ]; then
      startup_log "CRITICAL ERROR: Failed to start UPS drivers"
    else
      echo "❌ CRITICAL ERROR: Failed to start UPS drivers"
    fi
    return 1
  fi
  
  # Start the NUT server
  if ! start_upsd; then
    if [ "$ENABLE_LOG_STARTUP" = "Y" ]; then
      startup_log "CRITICAL ERROR: Failed to start NUT server (upsd)"
    else
      echo "❌ CRITICAL ERROR: Failed to start NUT server (upsd)"
    fi
    return 1
  fi
  
  # Start the UPS monitor
  if ! start_upsmon; then
    if [ "$ENABLE_LOG_STARTUP" = "Y" ]; then
      startup_log "CRITICAL ERROR: Failed to start UPS monitor (upsmon)"
    else
      echo "❌ CRITICAL ERROR: Failed to start UPS monitor (upsmon)"
    fi
    return 1
  fi
  
  # Verify that all processes are running
  sleep 2
  local all_running=true
  
  if ! check_process "upsd"; then
    if [ "$ENABLE_LOG_STARTUP" = "Y" ]; then
      startup_log "ERROR: upsd is not running after startup"
    fi
    all_running=false
  fi
  
  if ! check_process "upsmon"; then
    if [ "$ENABLE_LOG_STARTUP" = "Y" ]; then
      startup_log "ERROR: upsmon is not running after startup"
    fi
    all_running=false
  fi
  
  if ! check_port 3493; then
    if [ "$ENABLE_LOG_STARTUP" = "Y" ]; then
      startup_log "ERROR: upsd is not listening on port 3493"
    fi
    all_running=false
  fi
  
  if [ "$all_running" = "true" ]; then
    if [ "$ENABLE_LOG_STARTUP" = "Y" ]; then
      startup_log "All NUT processes started successfully"
    else
      echo "✅ All NUT processes started successfully"
    fi
    return 0
  else
    if [ "$ENABLE_LOG_STARTUP" = "Y" ]; then
      startup_log "ERROR: Not all NUT processes are running correctly"
    else
      echo "❌ ERROR: Not all NUT processes are running correctly"
    fi
    return 1
  fi
}

# Function to check communication with the UPS
check_ups_communication() {
  if [ ! -f "/tmp/ups_name" ]; then
    if [ "$ENABLE_LOG_STARTUP" = "Y" ]; then
      startup_log "ERROR: UPS name file not found"
    fi
    return 1
  fi
  
  local ups_name=$(cat /tmp/ups_name)
  if [ "$ENABLE_LOG_STARTUP" = "Y" ]; then
    startup_log "Checking communication with UPS: $ups_name@localhost"
  fi
  
  # Try to communicate with the UPS
  if [ "$ENABLE_LOG_STARTUP" = "Y" ]; then
    local ups_status=$(upsc $ups_name@localhost 2>&1)
    if [ $? -ne 0 ]; then
      startup_log "ERROR: Failed to communicate with UPS $ups_name@localhost"
      return 1
    else
      startup_log "Successfully communicated with UPS $ups_name@localhost"
      upsc $ups_name@localhost
      return 0
    fi
  else
    if upsc $ups_name@localhost > /dev/null 2>&1; then
      return 0
    else
      return 1
    fi
  fi
}

# Function to start the web application
start_web_app() {
  # Check if there are environment variables for the web app
  if [ "$ENABLE_LOG_STARTUP" = "Y" ]; then
    if [ -n "$SERVER_PORT" ]; then
      startup_log "Server port configured: $SERVER_PORT"
    fi
    
    if [ -n "$SERVER_HOST" ]; then
      startup_log "Server host configured: $SERVER_HOST"
    fi
    
    if [ -n "$DEBUG_MODE" ]; then
      startup_log "Debug mode: $DEBUG_MODE"
    fi
  fi
  
  # Ensure SSL certificates are available if SSL is enabled
  ensure_ssl_certificates
  
  # Check if the application is already running
  if check_process "python3 /app/nutify/app.py"; then
    if [ "$ENABLE_LOG_STARTUP" = "Y" ]; then
      startup_log "Web application is already running"
    fi
    return 0
  fi
  
  # First check if we already have a web app running
  if [ -n "$APP_PID" ] && kill -0 $APP_PID 2>/dev/null; then
    if [ "$ENABLE_LOG_STARTUP" = "Y" ]; then
      startup_log "Web application is already running (PID: $APP_PID), stopping it first..."
    fi
    kill $APP_PID 2>/dev/null
    sleep 2
  fi
  
  if [ "$ENABLE_LOG_STARTUP" = "Y" ]; then
    startup_log "Starting web application..."
    cd /app/nutify && python app.py &
  else
    echo "✅ Starting web application..."
    cd /app/nutify && python app.py > /dev/null 2>&1 &
  fi
  
  APP_PID=$!
  
  # Store the PID for future reference
  echo $APP_PID > /tmp/nutify_app.pid
  
  # Wait for the web app to start
  local max_attempts=30
  for i in $(seq 1 $max_attempts); do
    if check_port 5050; then
      if [ "$ENABLE_LOG_STARTUP" = "Y" ]; then
        startup_log "Web application started successfully (PID: $APP_PID)"
      fi
      return 0
    fi
    
    # Check if process is still running
    if ! kill -0 $APP_PID 2>/dev/null; then
      if [ "$ENABLE_LOG_STARTUP" = "Y" ]; then
        startup_log "ERROR: Web application process died during startup"
      fi
      return 1
    fi
    
    sleep 1
    if [ "$ENABLE_LOG_STARTUP" = "Y" ]; then
      startup_log "Waiting for web application to be ready... ($i/$max_attempts)"
    fi
    
    if [ $i -eq $max_attempts ]; then
      if [ "$ENABLE_LOG_STARTUP" = "Y" ]; then
        startup_log "WARNING: Timeout waiting for web application to listen on port 5050"
      fi
      # Don't return failure here, as it might still start later
    fi
  done
  
  # Even if we timed out, return success since the process is still running
  return 0
}

# Function to show system information
show_system_info() {
  startup_log "System information:"
  startup_log "- Uptime: $(uptime)"
  startup_log "- Memory: $(free -h | grep Mem)"
  startup_log "- Disk space: $(df -h / | grep /)"
  
  startup_log "Network information:"
  startup_log "- Network interfaces:"
  if [ "$ENABLE_LOG_STARTUP" = "Y" ]; then
    ip -br addr
  fi
  startup_log "- Listening ports:"
  if [ "$ENABLE_LOG_STARTUP" = "Y" ]; then
    netstat -tulpn | grep -E '3493|5050'
  fi
  
  startup_log "NUT information:"
  startup_log "- NUT processes:"
  if [ "$ENABLE_LOG_STARTUP" = "Y" ]; then
    ps aux | grep -E 'upsd|upsmon|upsdrvctl' | grep -v grep
  fi
  
  startup_log "Configured environment variables:"
  startup_log "- SERVER_NAME: $SERVER_NAME"
  startup_log "- UPS_HOST: $UPS_HOST"
  startup_log "- UPS_NAME: $UPS_NAME"
  startup_log "- UPS_DRIVER: $UPS_DRIVER"
  startup_log "- UPS_PORT: $UPS_PORT"
  startup_log "- LISTEN_ADDRESS: $LISTEN_ADDRESS"
  startup_log "- LISTEN_PORT: $LISTEN_PORT"
  startup_log "- NUT_MODE: $NUT_MODE"
  startup_log "- UPSMON_USER: $UPSMON_USER"
  startup_log "- SERVER_PORT: $SERVER_PORT"
  startup_log "- SERVER_HOST: $SERVER_HOST"
}

# Function to restart a NUT service with proper verification
restart_nut_service() {
  local service_name="$1"
  if [ "$ENABLE_LOG_STARTUP" = "Y" ]; then
    startup_log "Restarting service: $service_name"
  fi
  
  case "$service_name" in
    "drivers")
      safe_kill "upsdrvctl" "/var/run/nut/*.pid"
      sleep 2
      start_ups_drivers
      return $?
      ;;
    
    "upsd")
      safe_kill "upsd" "/var/run/nut/upsd.pid"
      sleep 2
      start_upsd
      return $?
      ;;
    
    "upsmon")
      safe_kill "upsmon" "/run/upsmon.pid"
      sleep 2
      start_upsmon
      return $?
      ;;
    
    "webapp")
      if [ -n "$APP_PID" ]; then
        kill $APP_PID 2>/dev/null
        sleep 2
      fi
      start_web_app
      return $?
      ;;
    
    "all")
      if [ "$ENABLE_LOG_STARTUP" = "Y" ]; then
        startup_log "Performing full service restart..."
      fi
      
      # Stop in reverse order
      if [ -n "$APP_PID" ]; then
        kill $APP_PID 2>/dev/null
      fi
      safe_kill "upsmon" "/run/upsmon.pid"
      safe_kill "upsd" "/var/run/nut/upsd.pid"
      safe_kill "upsdrvctl" "/var/run/nut/*.pid"
      
      sleep 3
      
      # Start services in correct order
      local success=true
      
      if ! start_ups_drivers; then
        if [ "$ENABLE_LOG_STARTUP" = "Y" ]; then
          startup_log "ERROR: Failed to start UPS drivers during full restart"
        fi
        success=false
      fi
      
      if ! start_upsd; then
        if [ "$ENABLE_LOG_STARTUP" = "Y" ]; then
          startup_log "ERROR: Failed to start upsd during full restart"
        fi
        success=false
      fi
      
      if ! start_upsmon; then
        if [ "$ENABLE_LOG_STARTUP" = "Y" ]; then
          startup_log "ERROR: Failed to start upsmon during full restart"
        fi
        success=false
      fi
      
      if ! start_web_app; then
        if [ "$ENABLE_LOG_STARTUP" = "Y" ]; then
          startup_log "WARNING: Failed to start web app during full restart"
        fi
        # Don't mark as failure
      fi
      
      if [ "$success" = "true" ]; then
        if [ "$ENABLE_LOG_STARTUP" = "Y" ]; then
          startup_log "Full service restart completed successfully"
        fi
        return 0
      else
        if [ "$ENABLE_LOG_STARTUP" = "Y" ]; then
          startup_log "Full service restart encountered errors"
        fi
        return 1
      fi
      ;;
    
    *)
      if [ "$ENABLE_LOG_STARTUP" = "Y" ]; then
        startup_log "ERROR: Unknown service name: $service_name"
      fi
      return 1
      ;;
  esac
}

# Function to monitor services and handle restarts
monitor_services() {
  # Socat is disabled to let Nutify handle the socket
  # if ! check_process "socat"; then
  #   start_socat
  # fi

  local last_full_check=$(date +%s)
  local check_interval=60
  local full_check_interval=300

  if [ "$ENABLE_LOG_STARTUP" = "Y" ]; then
    startup_log "Starting service monitoring loop..."
  fi
  
  while true; do
    local current_time=$(date +%s)
    local services_ok=true

    # Socat check disabled
    # if ! kill -0 $SOCAT_PID 2>/dev/null; then
    #   startup_log "Notification socket handler is not running, restarting..."
    #   start_socat
    # fi

    # Always check critical services
    if ! check_process "upsd"; then
      if [ "$ENABLE_LOG_STARTUP" = "Y" ]; then
        startup_log "upsd is not running, attempting to restart..."
      fi
      if start_upsd; then
        if [ "$ENABLE_LOG_STARTUP" = "Y" ]; then
          startup_log "upsd restarted successfully"
        fi
      else
        if [ "$ENABLE_LOG_STARTUP" = "Y" ]; then
          startup_log "ERROR: Failed to restart upsd"
        fi
        services_ok=false
      fi
    fi
    
    if ! check_process "upsmon"; then
      if [ "$ENABLE_LOG_STARTUP" = "Y" ]; then
        startup_log "upsmon is not running, attempting to restart..."
      fi
      if start_upsmon; then
        if [ "$ENABLE_LOG_STARTUP" = "Y" ]; then
          startup_log "upsmon restarted successfully"
        fi
      else
        if [ "$ENABLE_LOG_STARTUP" = "Y" ]; then
          startup_log "ERROR: Failed to restart upsmon"
        fi
        services_ok=false
      fi
    fi
    
    # Check web app
    if [ -n "$APP_PID" ] && ! kill -0 $APP_PID 2>/dev/null; then
      if [ "$ENABLE_LOG_STARTUP" = "Y" ]; then
        startup_log "Web application is not running, attempting to restart..."
      fi
      if start_web_app; then
        if [ "$ENABLE_LOG_STARTUP" = "Y" ]; then
          startup_log "Web application restarted successfully"
        fi
      else
        if [ "$ENABLE_LOG_STARTUP" = "Y" ]; then
          startup_log "WARNING: Failed to restart web application"
        fi
        # Don't mark as failure
      fi
    fi
    
    # Perform deeper checks periodically
    if [ $((current_time - last_full_check)) -ge $full_check_interval ]; then
      if [ "$ENABLE_LOG_STARTUP" = "Y" ]; then
        startup_log "Performing full service health check..."
      fi
      
      # Check if upsd is responding on its port
      if ! check_port 3493 2; then
        if [ "$ENABLE_LOG_STARTUP" = "Y" ]; then
          startup_log "upsd is not responding on port 3493, restarting service..."
        fi
        restart_nut_service "upsd"
      fi
      
      # Check UPS communication
      if [ -f "/tmp/ups_name" ]; then
        local ups_name=$(cat /tmp/ups_name)
        if ! timeout 5 upsc $ups_name@localhost >/dev/null 2>&1; then
          if [ "$ENABLE_LOG_STARTUP" = "Y" ]; then
            startup_log "Cannot communicate with UPS, performing full service restart..."
          fi
          restart_nut_service "all"
        fi
      fi
      
      last_full_check=$current_time
    fi
    
    # Wait before next check
    sleep $check_interval
  done
}

# Function to ensure database permissions
ensure_database_permissions() {
  if [ "$ENABLE_LOG_STARTUP" = "Y" ]; then
    startup_log "Checking database permissions..."
  fi
  
  # Get the database path from the settings file
  DB_PATH=$(grep -oP 'DB_PATH\s*=\s*\K.*' /app/nutify/config/settings.txt | tr -d '"' | tr -d "'")
  
  if [ -z "$DB_PATH" ]; then
    # Try to find it from the DB_NAME and INSTANCE_PATH
    DB_NAME=$(grep -oP 'DB_NAME\s*=\s*\K.*' /app/nutify/config/settings.txt | tr -d '"' | tr -d "'")
    INSTANCE_PATH=$(grep -oP 'INSTANCE_PATH\s*=\s*\K.*' /app/nutify/config/settings.txt | tr -d '"' | tr -d "'")
    
    if [ -n "$DB_NAME" ] && [ -n "$INSTANCE_PATH" ]; then
      DB_PATH="/app/nutify/$INSTANCE_PATH/$DB_NAME"
    else
      # Default path if not found
      DB_PATH="/app/nutify/instance/nutify.db"
    fi
  fi
  
  if [ "$ENABLE_LOG_STARTUP" = "Y" ]; then
    startup_log "Database path: $DB_PATH"
  fi
  
  # Check if database file exists
  if [ -f "$DB_PATH" ]; then
    # Check permissions
    PERMS=$(stat -c "%a" "$DB_PATH")
    OWNER=$(stat -c "%U:%G" "$DB_PATH")
    
    if [ "$ENABLE_LOG_STARTUP" = "Y" ]; then
      startup_log "Current database permissions: $PERMS, owner: $OWNER"
    fi
    
    # Ensure the database file is writable
    chmod 664 "$DB_PATH"
    chown nut:nut "$DB_PATH"
    
    # Ensure the directory is writable
    DB_DIR=$(dirname "$DB_PATH")
    chmod 775 "$DB_DIR"
    chown nut:nut "$DB_DIR"
    
    # Check for journal and WAL files
    for ext in "-journal" "-wal" "-shm"; do
      if [ -f "${DB_PATH}${ext}" ]; then
        chmod 664 "${DB_PATH}${ext}"
        chown nut:nut "${DB_PATH}${ext}"
        if [ "$ENABLE_LOG_STARTUP" = "Y" ]; then
          startup_log "Fixed permissions for ${DB_PATH}${ext}"
        fi
      fi
    done
    
    if [ "$ENABLE_LOG_STARTUP" = "Y" ]; then
      startup_log "Database permissions updated to 664, owner: nut:nut"
    fi
  else
    if [ "$ENABLE_LOG_STARTUP" = "Y" ]; then
      startup_log "Database file not found at $DB_PATH, will be created on first run"
    fi
    
    # Ensure the directory exists and has correct permissions
    DB_DIR=$(dirname "$DB_PATH")
    mkdir -p "$DB_DIR"
    chmod 775 "$DB_DIR"
    chown nut:nut "$DB_DIR"
    
    if [ "$ENABLE_LOG_STARTUP" = "Y" ]; then
      startup_log "Created database directory with permissions 775, owner: nut:nut"
    fi
  fi
}

# Function to show a summary of the service status (always displayed)
show_summary() {
  # Simple and direct method to display the summary
  # Avoids file descriptor issues in container environment

  # Get the current IP address - but we'll use localhost in the output
  local ip_address="localhost"
  
  # Get the server port from settings
  local server_port=$(grep -oP 'SERVER_PORT\s*=\s*\K.*' /app/nutify/config/settings.txt | tr -d '"' | tr -d "'" | tr -d ' ')
  if [ -z "$server_port" ]; then
    server_port="5050"
  fi
  
  # Get SSL status
  local ssl_enabled=$(grep -oP 'SSL_ENABLED\s*=\s*\K.*' /app/nutify/config/settings.txt | tr -d '"' | tr -d "'" | tr '[:upper:]' '[:lower:]')
  local protocol="http"
  if [ "$ssl_enabled" = "true" ]; then
    protocol="https"
  fi
  
  # Check UPS status
  local ups_status="ERROR"
  if check_process "upsd" && check_port 3493; then
    ups_status="UP"
  fi
  
  # Check web app status
  local web_status="ERROR"
  if check_port "$server_port"; then
    web_status="UP"
  fi
  
  # Get UPS name
  local ups_name="unknown"
  if [ -f "/tmp/ups_name" ]; then
    ups_name=$(cat /tmp/ups_name)
  fi
  
  # Print summary - using heredoc to avoid file descriptor issues
  cat << EOF

======== NUTIFY SERVICE SUMMARY ========
✅ Configuration: Settings generated successfully
✅ UPS Service: ${ups_status} (Name: ${ups_name})
✅ Web Interface: ${web_status} (Port: ${server_port})

🔗 Access the web interface at: ${protocol}://${ip_address}:${server_port}
========================================

EOF
  
  # Redirect output again if needed - but only for the rest of the script
  if [ "$ENABLE_LOG_STARTUP" != "Y" ]; then
    exec > /dev/null 2>&1
  fi
}

# Main function
main() {
  # Do not redirect output at the beginning of the script
  # This ensures that both MOTD and summary are always visible
  
  if [ "$ENABLE_LOG_STARTUP" = "Y" ]; then
    startup_log "Starting NUT container"
  else
    echo "🔌 NUTIFY environment preparation..."
  fi

  # Make sure we're the only instance running
  if [ -f "/tmp/nutify_running.pid" ]; then
    local pid=$(cat "/tmp/nutify_running.pid" 2>/dev/null)
    if [ -n "$pid" ] && kill -0 $pid 2>/dev/null; then
      if [ "$ENABLE_LOG_STARTUP" = "Y" ]; then
        startup_log "WARNING: Another instance of this script is already running (PID: $pid)"
      fi
    else
      if [ "$ENABLE_LOG_STARTUP" = "Y" ]; then
        startup_log "Found stale PID file, removing it"
      fi
      rm -f "/tmp/nutify_running.pid"
    fi
  fi
  
  # Record our PID
  echo $$ > "/tmp/nutify_running.pid"

  if [ "$ENABLE_LOG_STARTUP" = "Y" ]; then
    startup_log "Detecting USB devices..."
    lsusb || startup_log "WARNING: lsusb command not available"
    
    # Critical fix for permissions
    startup_log "Fixing permissions for NUT and USB devices..."
  else
    echo "✅ Update USB device permissions"
  fi
  
  # Fix permissions for PID directory and ensure it exists
  ensure_pid_dirs
  
  # Fix permissions for USB devices
  if [ -d "/dev/bus/usb" ]; then
    chown -R root:root /dev/bus/usb
    chmod -R 777 /dev/bus/usb
    if [ "$ENABLE_LOG_STARTUP" = "Y" ]; then
      startup_log "USB permissions updated"
    fi
  else
    if [ "$ENABLE_LOG_STARTUP" = "Y" ]; then
      startup_log "WARNING: Directory /dev/bus/usb not found!"
    fi
  fi
  
  # If there are specific devices, set those too
  for usbdev in /dev/usb/hiddev*; do
    if [ -e "$usbdev" ]; then
      chown root:nut "$usbdev"
      chmod 666 "$usbdev"
      if [ "$ENABLE_LOG_STARTUP" = "Y" ]; then
        startup_log "Permissions updated for $usbdev"
      fi
    fi
  done
  
  # Verify that NUT commands can be executed as root
  chmod 4755 /usr/sbin/upsdrvctl
  chmod 4755 /usr/sbin/upsd
  if [ "$ENABLE_LOG_STARTUP" = "Y" ]; then
    startup_log "Set suid permissions for NUT commands"
    
    # Show available environment variables
    startup_log "Available environment variables:"
    env | grep -E 'UPS_|NUT_|SERVER_|LISTEN_|ADMIN_|UPSMON_|MONUSER_' || startup_log "No specific environment variables found"
  fi
  
  # Check configuration files
  if ! check_config_files; then
    if [ "$ENABLE_LOG_STARTUP" = "Y" ]; then
      startup_log "CRITICAL ERROR: Unable to verify configuration files!"
    else
      echo "❌ CRITICAL ERROR: Unable to verify configuration files!"
    fi
    exit 1
  fi
  
  # Check UPS configuration
  if ! check_ups_config; then
    if [ "$ENABLE_LOG_STARTUP" = "Y" ]; then
      startup_log "CRITICAL ERROR: Problems with UPS configuration. Check the ups.conf file."
    else
      echo "❌ CRITICAL ERROR: Problems with UPS configuration. Check the ups.conf file."
    fi
    exit 1
  fi
  
  # Cleanup any stale processes
  cleanup_socat

  # Start NUT services
  if ! start_nut_services; then
    if [ "$ENABLE_LOG_STARTUP" = "Y" ]; then
      startup_log "Failed to start NUT services"
    else
      echo "❌ Failed to start NUT services"
    fi
    exit 1
  fi
  
  # Check communication with the UPS
  if ! check_ups_communication; then
    if [ "$ENABLE_LOG_STARTUP" = "Y" ]; then
      startup_log "WARNING: Problems communicating with the UPS. The service may not work correctly."
    else
      echo "⚠️ WARNING: Problems communicating with the UPS. The service may not work correctly."
    fi
    # Don't exit, it might be a temporary problem
  fi
  
  # Start the web application
  if ! start_web_app; then
    if [ "$ENABLE_LOG_STARTUP" = "Y" ]; then
      startup_log "WARNING: Problems starting the web application."
    else
      echo "⚠️ WARNING: Problems starting the web application."
    fi
    # Don't exit, the NUT service might still work
  fi
  
  # Show system information
  if [ "$ENABLE_LOG_STARTUP" = "Y" ]; then
    show_system_info
  fi
  
  # Call the function to ensure database permissions
  ensure_database_permissions
  
  if [ "$ENABLE_LOG_STARTUP" = "Y" ]; then
    startup_log "NUT services successfully started"
  fi
  
  # Show summary (always displayed regardless of log settings)
  show_summary
  
  # Only redirect output after the summary has been displayed
  if [ "$ENABLE_LOG_STARTUP" != "Y" ]; then
    exec > /dev/null 2>&1
  fi
  
  if [ "$ENABLE_LOG_STARTUP" = "Y" ]; then
    startup_log "Starting service monitoring..."
  fi
  
  # Start service monitoring (this will run indefinitely)
  monitor_services
  
  # We should never get here
  if [ "$ENABLE_LOG_STARTUP" = "Y" ]; then
    startup_log "WARNING: Script unexpectedly terminated"
  fi
  rm -f "/tmp/nutify_running.pid"
  exit 1
}

# Setup trap to clean up on exit
trap 'rm -f "/tmp/nutify_running.pid"; startup_log "Exiting NUT services due to signal"; exit' INT TERM

# Start the script
main
