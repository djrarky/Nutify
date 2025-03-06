# Nutify - UPS Monitoring System

![Project Logo](pic/logo.jpg)

## Overview

Nutify is a comprehensive monitoring system designed to track the health and performance of your Uninterruptible Power Supply (UPS) devices. It provides real-time insights into critical UPS metrics, allowing you to ensure the continuous operation and protection of your valuable equipment. Nutify collects data, generates detailed reports, and visualizes key parameters through interactive charts, all accessible via a user-friendly web interface.

<img src="pic/1.main.png" alt="Nutify Dashboard" width="700"/>

## Features

* **Real-time UPS Monitoring:** Continuously collects and displays data from your UPS devices, including voltage, power, battery status, load, and more.
* **Detailed Reports:** Generates comprehensive reports on UPS performance over selected time ranges (daily, weekly, monthly, custom). Reports include statistical summaries and visual charts.
* **Interactive Charts:** Visualizes UPS data using interactive charts for easy analysis of trends and anomalies in voltage, power, battery levels, and other metrics.
* **Customizable Dashboards:** Provides a web-based dashboard to view real-time data and access reports.
* **Data Persistence:** Stores historical UPS data in a SQLite database for trend analysis and reporting.
* **Dockerized Deployment:** Easily deployable using Docker and Docker Compose, ensuring consistent setup across different environments.
* **User-Friendly Interface:** Accessible and intuitive web interface built with modern web technologies.
* **Energy Monitoring:** Detailed analysis of energy consumption with cost calculation and efficiency metrics.
* **Battery Management:** Monitoring of battery status, remaining runtime, and performance over time.
* **Event Management:** Logging and notification of UPS events such as power outages, low battery, etc.
* **UPS Commands:** Interface to send commands to the UPS such as battery test, shutdown, etc.
* **Dark/Light Theme:** Customizable interface with both dark and light themes for optimal viewing in any environment.
* **Email Reports:** Automated email reports with detailed UPS status and alerts for critical events.

## Supported Architectures

Nutify is available for multiple hardware platforms through Docker images:

| Architecture | Docker Image Tag | Devices |
|--------------|------------------|---------|
| 🖥️ **AMD64/x86_64** | `dartsteven/nutify:amd64-0.1.0` | Standard PCs, servers, most cloud VMs |
| 🍓 **ARM64/aarch64** | `dartsteven/nutify:arm64-0.1.0` | Raspberry Pi 4, Pi 400, Compute Module 4, Apple M1/M2 Macs |
| 🍓 **ARMv7/armhf** | `dartsteven/nutify:armv7-0.1.0` | Raspberry Pi 2/3, older ARM-based devices | -> Not yet ready!

To use a specific architecture, simply modify the `image` line in your `docker-compose.yaml` file:

```yaml
services:
  nut:
    image: dartsteven/nutify:arm64-0.1.0  # For ARM64 devices like Raspberry Pi 4
```

All architectures provide identical functionality, allowing you to run Nutify on virtually any hardware from small single-board computers to powerful servers.

## Dark and Light Themes

Nutify offers both dark and light themes to suit your preferences and environment. You can easily switch between themes using the theme toggle in the user interface.

<div style="display: flex; justify-content: space-between;">
  <div style="flex: 1; margin-right: 10px;">
    <p><strong>Dark Theme</strong></p>
    <img src="pic/dark.png" alt="Dark Theme" width="100%"/>
  </div>
  <div style="flex: 1; margin-left: 10px;">
    <p><strong>Light Theme</strong></p>
    <img src="pic/light.png" alt="Light Theme" width="100%"/>
  </div>
</div>

## Email Reports and Alerts

Nutify can send automated email reports with detailed information about your UPS status. These reports include:

### Regular Status Reports
Comprehensive reports with charts and statistics about your UPS performance over time.

<img src="pic/report.png" alt="Email Status Report" width="700"/>

### Alert Notifications
Immediate notifications when critical events occur, such as power outages or low battery conditions.

<img src="pic/report_alert.png" alt="Email Alert Notification" width="700"/>

To configure email reports, set the appropriate email settings in your `docker-compose.yaml` file.

## Tested UPS Models

Currently, Nutify has been tested and confirmed working with the following UPS models:

- **Eaton 3S 550**
- **APC Back-UPS RS 1600SI**

While Nutify should work with any UPS device supported by Network UPS Tools (NUT), these specific models have been verified for compatibility and optimal performance.

## How It Works

Nutify is built using a modular architecture, comprising the following key components:

1. **Data Collection:** Nutify interacts with UPS devices to collect real-time data using the Network UPS Tools (NUT) protocol. It retrieves metrics such as:
   * Input and Output Voltage
   * Battery Charge and Runtime
   * UPS Load
   * Power Consumption
   * Frequency
   * Transfer Thresholds

2. **Database:** Collected data is stored in a SQLite database. The database schema is designed to efficiently store time-series data from UPS devices.

3. **Backend (Python/Flask):** The backend is developed in Python using the Flask framework. It handles:
   * Data retrieval from UPS devices
   * Data processing and storage in the database
   * API endpoints for the frontend to access data and reports
   * Generation of reports and charts
   * Scheduling of data collection tasks
   * Event and notification management

4. **Frontend (JavaScript/HTML/CSS):** The frontend is built using JavaScript and utilizes libraries for interactive charts and Tailwind CSS for styling. It provides:
   * Real-time dashboards displaying current UPS status
   * Navigation to reports and charts
   * User interface for configuring reports and time ranges
   * Visualization of key metrics such as battery charge, power, load, etc.

5. **Specialized Modules:** The system is organized into specialized modules to handle different functionalities:
   * **energy.py:** Energy consumption management and analysis
   * **battery.py:** Battery monitoring and analysis
   * **power.py:** Power and load analysis
   * **voltage.py:** Voltage monitoring
   * **upscmd.py:** UPS command management
   * **upsrw.py:** UPS variable reading and writing
   * **mail.py:** Email notification system
   * **scheduler.py:** Report and task scheduling

## Docker-Compose Configuration

To run Nutify using Docker Compose, you need to configure the `docker-compose.yaml` file. Below is an example configuration:

```yaml
services:
  nut:
    image: dartsteven/nutify:amd64-0.1.0                # Official Nutify image for AMD64 architecture (supported architectures: amd64, arm64, armv7)
    # build: . # Or build from source                   # Uncomment to build from source instead of using pre-built image
    container_name: Nutify-Server                       # Name of the container in Docker
    privileged: true                                    # Grants extended privileges to the container for hardware access
    cap_add:                                            # Additional Linux capabilities for the container
      - SYS_ADMIN                                       # Allows administrative operations
      - SYS_RAWIO                                       # Allows direct I/O access
      - MKNOD                                           # Allows creation of special files
    devices:                                            # Device mapping from host to container
      - /dev/bus/usb:/dev/bus/usb:rwm                   # Maps USB devices for UPS detection (read-write-mknod)
    device_cgroup_rules:                                # Control group rules for device access
      - 'c 189:* rwm'                                   # USB device access rule (character device 189)
    environment:                                        # Environment variables for container configuration
      # ===== SERVER CONFIGURATION =====
      - SERVER_NAME=                                    # Name of the server (displayed in UI)
      - SERVER_PORT=5050                                # Port for web interface
      - SERVER_HOST=0.0.0.0                             # Host address to bind web server (0.0.0.0 = all interfaces)
      - TIMEZONE=                                       # Timezone for date/time display (e.g., Europe/Rome). See nutify/TimeZone.readme for available values.
      - ENCRYPTION_KEY=                                 # Secret key for data encryption for mail password (MUST be set) and should be at least 32 characters long for security
      
      # ===== UPS CONNECTION SETTINGS =====
      - UPS_HOST=                                       # IP/hostname of UPS (leave empty for local USB connection)
      - UPS_NAME=ups                                    # Name of the UPS in NUT configuration
      - UPS_DRIVER=usbhid-ups                           # NUT driver for UPS (usbhid-ups for USB connected UPS)
      - UPS_PORT=auto                                   # Port for UPS connection (auto = automatic detection)
      - UPS_REALPOWER_NOMINAL=1000                      # Nominal power of UPS in watts
      
      # ===== UPS AUTHENTICATION =====
      - UPS_USER=admin                                  # Username for UPS authentication
      - UPS_PASSWORD=hunter2                            # Password for UPS authentication
      
      # ===== UPS COMMAND SETTINGS =====
      - UPSCMD_USER=admin                               # Username for sending commands to UPS
      - UPSCMD_PASSWORD=hunter2                         # Password for sending commands to UPS
      
      # ===== LOGGING CONFIGURATION =====
      - LOG_LEVEL=DEBUG                                 # Log level (DEBUG, INFO, WARNING, ERROR, CRITICAL)
      - LOG_WERKZEUG=false                              # Enable/disable Flask's Werkzeug logs
      - ENABLE_LOG_STARTUP=N                            # Enables/disables essential startup logs (set to Y to enable)
      
    ports:                                              # Port mapping from host to container
      - 3493:3493                                       # NUT server port
      - 5050:5050                                       # Web interface port
    volumes:                                            # Volume mapping for persistent data
      - ./nut_data:/var/run/nut                         # NUT runtime data
      - ./nutify/logs:/app/nutify/logs                  # Log files
      - ./nutify/instance:/app/nutify/instance          # Application data including SQLite database
    restart: always                                     # Restart policy (always restart on failure)
    user: root                                          # Run container as root user for hardware access
```

**Configuration Notes:**

* **`environment`**: Sets environment variables for the container, organized in logical groups:
  * **Server Configuration:**
    * **`SERVER_NAME`**: Name of the server (displayed in UI)
    * **`SERVER_PORT`**: Port on which the web server will listen
    * **`SERVER_HOST`**: Host address to bind web server
    * **`TIMEZONE`**: Sets the timezone for the application. **Important: Always use TZ format (e.g., `Europe/Rome`) and avoid UTC.** See `nutify/TimeZone.readme` file for a complete list of available timezones.
    * **`ENCRYPTION_KEY`**: Secret key for data encryption
  
  * **UPS Connection Settings:**
    * **`UPS_HOST`**: Hostname or IP of the NUT server (leave empty for local USB connection)
    * **`UPS_NAME`**: Name of the UPS in the NUT system
    * **`UPS_DRIVER`**: NUT driver for UPS (usbhid-ups for USB connected UPS)
    * **`UPS_PORT`**: Port for UPS connection (auto = automatic detection)
    * **`UPS_REALPOWER_NOMINAL`**: Nominal power of the UPS in Watts
  
  * **UPS Authentication:**
    * **`UPS_USER`**: Username for UPS authentication
    * **`UPS_PASSWORD`**: Password for UPS authentication
  
  * **UPS Command Settings:**
    * **`UPSCMD_USER`**: Username for sending commands to UPS
    * **`UPSCMD_PASSWORD`**: Password for sending commands to UPS
  
  * **Logging Configuration:**
    * **`LOG_LEVEL`**: Logging level (DEBUG, INFO, WARNING, ERROR, CRITICAL)
    * **`LOG_WERKZEUG`**: Enable/disable Flask's Werkzeug logs
    * **`ENABLE_LOG_STARTUP`**: Enables/disables essential startup logs (set to Y to enable)

* **`ports`**: Maps ports between the host and the container:
  * **`3493:3493`**: Port for the NUT service
  * **`5050:5050`**: Port for the web interface

* **`volumes`**: Mounts volumes to persist data:
  * **`./nut_data:/var/run/nut`**: NUT service data
  * **`./nutify/logs:/app/nutify/logs`**: Nutify log files
  * **`./nutify/instance:/app/nutify/instance`**: Nutify instance directory, including the SQLite database

## Technologies Used

* **Backend:** Python, Flask, SQLAlchemy
* **Frontend:** JavaScript, HTML, CSS, Tailwind CSS
* **Database:** SQLite
* **Charting:** Chart.js
* **Containerization:** Docker, Docker Compose
* **UPS Communication:** Network UPS Tools (NUT)

## Installation and Usage

1. **Prerequisites:**
   * Docker and Docker Compose installed on your system
   * A UPS compatible with NUT (Network UPS Tools)

2. **Clone the Repository:**
   ```bash
   git clone [repository URL]
   cd [repository directory]
   ```

3. **Configure `docker-compose.yaml`:**
   Edit the `docker-compose.yaml` file as described in the "Docker-Compose Configuration" section, ensuring you set the correct UPS connection parameters.

4. **Start Nutify:**
   ```bash
   docker-compose up -d
   ```

5. **Access Nutify:**
   Open your web browser and navigate to `http://localhost:5050` (or the configured port).

## Main Features

### Main Dashboard
Displays the current status of the UPS, including battery charge, remaining runtime, power, and load.

<img src="pic/1.main.png" alt="Main Dashboard" width="700"/>

### Energy Monitoring
Analyzes energy consumption over time, with cost calculation and efficiency metrics.

<img src="pic/2.Energy-1.png" alt="Energy Monitoring" width="700"/>

#### Real-Time Energy Monitoring
<img src="pic/2.Energy-RealTime.png" alt="Real-Time Energy Monitoring" width="700"/>

#### Date Range Selection
<div style="display: flex; justify-content: space-between;">
  <img src="pic/2.Energy-DateRange-Modal1.png" alt="Date Range Selection 1" width="340"/>
  <img src="pic/2.Energy-DateRange-Modal2.png" alt="Date Range Selection 2" width="340"/>
</div>

### Power Monitoring
Tracks power consumption, load percentage, and other power-related metrics.

<img src="pic/3.Power.png" alt="Power Monitoring" width="700"/>

#### Real-Time Power Monitoring
<img src="pic/3.Power-RealTime.png" alt="Real-Time Power Monitoring" width="700"/>

### Voltage Monitoring
Displays input and output voltage over time.

<img src="pic/4.Voltage.png" alt="Voltage Monitoring" width="700"/>

#### Real-Time Voltage Monitoring
<img src="pic/4.Voltage-RealTime.png" alt="Real-Time Voltage Monitoring" width="700"/>

### Battery Monitoring
Tracks battery status, remaining runtime, and performance over time.

<img src="pic/5.Battery.png" alt="Battery Monitoring" width="700"/>

#### Real-Time Battery Monitoring
<img src="pic/5.Battery-RealTime.png" alt="Real-Time Battery Monitoring" width="700"/>

### UPS Information
Provides detailed information about your UPS device.

<img src="pic/6.UpsInfo.png" alt="UPS Information" width="700"/>

### UPS Commands
Sends commands to the UPS such as battery test, shutdown, etc.

<img src="pic/7.Upscmd.png" alt="UPS Commands" width="700"/>

### UPS Variables
Allows reading and writing UPS variables for advanced configuration.

<img src="pic/8.Upsrw.png" alt="UPS Variables" width="700"/>

### Event Management
Logs and notifies UPS events such as power outages, low battery, etc.

<img src="pic/9.Events.png" alt="Event Management" width="700"/>

### API Access
Direct access to system APIs for integration with other tools.

<img src="pic/10.Api.png" alt="API Access" width="700"/>

### Scheduler Configuration
Configure scheduled tasks such as reports generation and data collection.

<img src="pic/11.Option-Scheduler.png" alt="Scheduler Configuration" width="700"/>

### Database Management
Tools for database maintenance and optimization.

<img src="pic/12.Option-Database.png" alt="Database Management" width="700"/>

---

![Project Logo](pic/logo.jpg)
