class UPSInfoPage extends BasePage {
    // Icon map for field type
    fieldIcons = {
        model: 'fa-microchip',
        serial: 'fa-barcode',
        type: 'fa-info-circle',
        manufacturer: 'fa-industry',
        firmware: 'fa-code',
        version: 'fa-code-branch',
        date: 'fa-calendar-alt',
        location: 'fa-map-marker-alt',
        contact: 'fa-address-card',
        language: 'fa-language',
        protection: 'fa-shield-alt',
        packs: 'fa-battery-full',
        name: 'fa-tag',
        description: 'fa-file-alt',
        macaddr: 'fa-network-wired',
        usb: 'fa-usb',
        vendorid: 'fa-fingerprint',
        productid: 'fa-box',
        voltage: 'fa-bolt',
        current: 'fa-tachometer-alt',
        power: 'fa-plug',
        load: 'fa-weight',
        efficiency: 'fa-chart-line',
        temperature: 'fa-thermometer-half',
        humidity: 'fa-tint',
        status: 'fa-info-circle',
        alarm: 'fa-exclamation-triangle',
        runtime: 'fa-clock',
        charge: 'fa-battery-three-quarters',
        sensitivity: 'fa-sliders-h',
        frequency: 'fa-wave-square',
        beeper: 'fa-volume-up',
        watchdog: 'fa-dog',
        id: 'fa-hashtag'
    };

    constructor() {
        super();
        this.requiresTimezone = false;  // Disable timezone check
        // Force grid to 3 columns FIRST, then everything else
        const grid = document.querySelector('.stats_grid');
        if (grid) {
            grid.style.gridTemplateColumns = 'repeat(3, 1fr)';
            grid.style.gap = '1.5rem';
        }

        // Class variables
        this.cardTemplateHtml = `
            <div class="stat_card">
                <div class="stat_card-header">
                    <i class="fas %ICON%"></i>
                    <h3>%TITLE%</h3>
                </div>
                <div class="stat_card-content">
                    %CONTENT%
                </div>
            </div>
        `;

        // Initialize the dashboard
        this.init();
    }

    async init() {
        // Initialize WebSocket for cache updates
        this.initializeWebSocket();
        
        // Show loading state initially
        this.showLoading('Loading UPS data...');
    }

    initializeWebSocket() {
        // Check if CacheWebSocketManager is available
        if (typeof CacheWebSocketManager === 'undefined') {
            console.error('CacheWebSocketManager not available. UPS Info page will not display data.');
            this.showError('WebSocket connection not available');
            return;
        }
        
        // Create WebSocket manager with callbacks
        this.webSocketManager = new CacheWebSocketManager({
            onUpdate: (data) => {
                // Hide any loading indicators
                this.hideLoading();
                
                // Update the UI with the received data
                if (data && typeof data === 'object') {
                    this.updateUI(data);
                }
            },
            onConnect: () => {
                console.log('UPS Info page connected to WebSocket');
                // Request initial data with a short delay to ensure connection is ready
                setTimeout(() => {
                    if (this.webSocketManager) {
                        console.log('Requesting initial cache data for UPS Info');
                        this.webSocketManager.requestCacheData();
                    }
                }, 500);
            },
            onDisconnect: () => {
                console.log('UPS Info page disconnected from WebSocket');
                this.showError('WebSocket disconnected. Reconnecting...');
            },
            debug: true // Enable debug mode to see more detailed logs
        });
        
        // Try to request data after a short delay if not received through onConnect
        setTimeout(() => {
            if (this.webSocketManager && !document.querySelector('.stats_grid').innerHTML.trim()) {
                console.log('Retry requesting cache data for UPS Info');
                this.webSocketManager.requestCacheData();
            }
        }, 3000);
    }

    updateUI(data) {
        try {
            const mainContainer = document.querySelector('.stats_grid');
            if (!mainContainer) throw new Error('Main container not found');
            mainContainer.innerHTML = '';

            const sections = [
                {
                    title: 'Device Info',
                    icon: 'fa-microchip',
                    fields: [
                        ['Model', 'device_model'],
                        ['Manufacturer', 'device_mfr'],
                        ['Type', 'device_type'],
                        ['Serial', 'device_serial'],
                        ['Description', 'device_description'],
                        ['Part', 'device_part']
                    ]
                },
                {
                    title: 'Device Network',
                    icon: 'fa-network-wired',
                    fields: [
                        ['Location', 'device_location'],
                        ['Contact', 'device_contact'],
                        ['MAC Address', 'device_macaddr'],
                        ['USB Version', 'device_usb_version']
                    ]
                },
                {
                    title: 'UPS Model',
                    icon: 'fa-server',
                    fields: [
                        ['Model', 'ups_model'],
                        ['Manufacturer', 'ups_mfr'],
                        ['Manufacturing Date', 'ups_mfr_date'],
                        ['Serial', 'ups_serial'],
                        ['Type', 'ups_type'],
                        ['ID', 'ups_id']
                    ]
                },
                {
                    title: 'UPS Technical',
                    icon: 'fa-cogs',
                    fields: [
                        ['Vendor ID', 'ups_vendorid'],
                        ['Product ID', 'ups_productid'],
                        ['Firmware', 'ups_firmware'],
                        ['Auxiliary Firmware', 'ups_firmware_aux'],
                        ['Display Language', 'ups_display_language'],
                        ['Contacts', 'ups_contacts']
                    ]
                },
                {
                    title: 'Driver Information',
                    icon: 'fa-code',
                    fields: [
                        ['Name', 'driver_name'],
                        ['Version', 'driver_version'],
                        ['Internal Version', 'driver_version_internal'],
                        ['Data Version', 'driver_version_data'],
                        ['USB Version', 'driver_version_usb']
                    ]
                },
                {
                    title: 'Battery Status',
                    icon: 'fa-battery-three-quarters',
                    fields: [
                        ['Charge', 'battery_charge'],
                        ['Charge Low', 'battery_charge_low'],
                        ['Charge Warning', 'battery_charge_warning'],
                        ['Runtime', 'battery_runtime'],
                        ['Runtime Low', 'battery_runtime_low'],
                        ['Alarm Threshold', 'battery_alarm_threshold']
                    ]
                },
                {
                    title: 'Battery Details',
                    icon: 'fa-car-battery',
                    fields: [
                        ['Type', 'battery_type'],
                        ['Date', 'battery_date'],
                        ['Manufacturing Date', 'battery_mfr_date'],
                        ['Packs', 'battery_packs'],
                        ['External Packs', 'battery_packs_external'],
                        ['Protection', 'battery_protection']
                    ]
                },
                {
                    title: 'Battery Technical',
                    icon: 'fa-bolt',
                    fields: [
                        ['Voltage', 'battery_voltage'],
                        ['Voltage Nominal', 'battery_voltage_nominal'],
                        ['Current', 'battery_current'],
                        ['Temperature', 'battery_temperature']
                    ]
                },
                {
                    title: 'Input Power',
                    icon: 'fa-plug',
                    fields: [
                        ['Voltage', 'input_voltage'],
                        ['Voltage Maximum', 'input_voltage_maximum'],
                        ['Voltage Minimum', 'input_voltage_minimum'],
                        ['Voltage Status', 'input_voltage_status'],
                        ['Voltage Nominal', 'input_voltage_nominal'],
                        ['Voltage Extended', 'input_voltage_extended']
                    ]
                },
                {
                    title: 'Input Settings',
                    icon: 'fa-sliders-h',
                    fields: [
                        ['Transfer Low', 'input_transfer_low'],
                        ['Transfer High', 'input_transfer_high'],
                        ['Sensitivity', 'input_sensitivity']
                    ]
                },
                {
                    title: 'Input Technical',
                    icon: 'fa-tachometer-alt',
                    fields: [
                        ['Frequency', 'input_frequency'],
                        ['Frequency Nominal', 'input_frequency_nominal'],
                        ['Current', 'input_current'],
                        ['Current Nominal', 'input_current_nominal'],
                        ['Real Power', 'input_realpower'],
                        ['Real Power Nominal', 'input_realpower_nominal']
                    ]
                },
                {
                    title: 'Output Power',
                    icon: 'fa-bolt',
                    fields: [
                        ['Voltage', 'output_voltage'],
                        ['Voltage Nominal', 'output_voltage_nominal'],
                        ['Frequency', 'output_frequency'],
                        ['Frequency Nominal', 'output_frequency_nominal']
                    ]
                },
                {
                    title: 'Output Technical',
                    icon: 'fa-tachometer-alt',
                    fields: [
                        ['Current', 'output_current'],
                        ['Current Nominal', 'output_current_nominal']
                    ]
                },
                {
                    title: 'UPS Status',
                    icon: 'fa-info-circle',
                    fields: [
                        ['Status', 'ups_status'],
                        ['Alarm', 'ups_alarm'],
                        ['Time', 'ups_time'],
                        ['Date', 'ups_date'],
                        ['Temperature', 'ups_temperature']
                    ]
                },
                {
                    title: 'UPS Load',
                    icon: 'fa-weight',
                    fields: [
                        ['Load', 'ups_load'],
                        ['Load High', 'ups_load_high'],
                        ['Efficiency', 'ups_efficiency']
                    ]
                },
                {
                    title: 'UPS Power',
                    icon: 'fa-bolt',
                    fields: [
                        ['Power', 'ups_power'],
                        ['Power Nominal', 'ups_power_nominal'],
                        ['Real Power', 'ups_realpower'],
                        ['Real Power Nominal', 'ups_realpower_nominal'],
                        [data.ups_realpower_nominal > 0 || data.ups_power_nominal > 0 ? 'Nominal Power' : 'Manual Nominal Power', 'UPS_REALPOWER_NOMINAL'],
                        ['Real Power Hours', 'ups_realpower_hrs'],
                        ['Real Power Days', 'ups_realpower_days']
                    ]
                },
                {
                    title: 'UPS Control',
                    icon: 'fa-toggle-on',
                    fields: [
                        ['Beeper Status', 'ups_beeper_status'],
                        ['Watchdog Status', 'ups_watchdog_status']
                    ]
                },
                {
                    title: 'Environment',
                    icon: 'fa-thermometer-half',
                    fields: [
                        ['Temperature', 'ambient_temperature'],
                        ['Temperature High', 'ambient_temperature_high'],
                        ['Temperature Low', 'ambient_temperature_low'],
                        ['Humidity', 'ambient_humidity'],
                        ['Humidity High', 'ambient_humidity_high'],
                        ['Humidity Low', 'ambient_humidity_low']
                    ]
                }

            ];

            sections.forEach(section => {
                this.createSection(mainContainer, section.title, section.icon, section.fields, data);
            });
        } catch (error) {
            this.showError('Error updating the interface');
        }
    }

    createSection(container, title, iconClass, fields, data) {
        try {
            const validFields = fields
                .map(([label, key]) => {
                    const value = data[key];
                    return [label, key, value];
                })
                .filter(([_, __, value]) => value !== undefined && value !== null && value !== 'N/A');

            if (validFields.length === 0) {
                return;
            }

            const section = document.createElement('div');
            section.className = 'stat_card';

            // Create the table
            section.innerHTML = `
                <table class="w-full">
                    <tr class="border-b border-gray-200 dark:border-gray-700">
                        <td class="p-4 w-12">
                            <div class="stat-icon text-primary">
                                <i class="fas ${iconClass} fa-lg"></i>
                            </div>
                        </td>
                        <td class="p-4">
                            <span class="stat-label text-lg font-bold">${title}</span>
                        </td>
                    </tr>
                    <tr>
                        <td colspan="2" class="p-4">
                            <table class="w-full">
                                ${validFields.map(([label, key, value]) => {
                                    // Find the appropriate icon for this field
                                    let icon = 'fa-circle';
                                    for (const [type, iconClass] of Object.entries(this.fieldIcons)) {
                                        if (key.toLowerCase().includes(type)) {
                                            icon = iconClass;
                                            break;
                                        }
                                    }

                                    // Format the value
                                    let formattedValue = value;
                                    if (key === 'ups_status') {
                                        formattedValue = this.formatUPSStatus(value);
                                    } else if (key === 'battery_type') {
                                        formattedValue = this.formatBatteryType(value);
                                    } else if (key === 'battery_runtime' || key === 'battery_runtime_low') {
                                        formattedValue = this.formatRuntime(value);
                                    } else if (key === 'UPS_REALPOWER_NOMINAL') {
                                        formattedValue = `${value}W`;
                                    } else if (!isNaN(value)) {
                                        // Add appropriate units of measurement based on the field type
                                        if (key.includes('voltage')) {
                                            formattedValue = `${parseFloat(value).toLocaleString('en-US', {
                                                minimumFractionDigits: 0,
                                                maximumFractionDigits: 2
                                            })}V`;
                                        } else if (key.includes('current')) {
                                            formattedValue = `${parseFloat(value).toLocaleString('en-US', {
                                                minimumFractionDigits: 0,
                                                maximumFractionDigits: 2
                                            })}A`;
                                        } else if (key.includes('power')) {
                                            formattedValue = `${parseFloat(value).toLocaleString('en-US', {
                                                minimumFractionDigits: 0,
                                                maximumFractionDigits: 2
                                            })}W`;
                                        } else if (key.includes('temperature')) {
                                            formattedValue = `${parseFloat(value).toLocaleString('en-US', {
                                                minimumFractionDigits: 0,
                                                maximumFractionDigits: 1
                                            })}°C`;
                                        } else if (key.includes('charge') || key.includes('load') || key.includes('efficiency')) {
                                            formattedValue = `${parseFloat(value).toLocaleString('en-US', {
                                                minimumFractionDigits: 0,
                                                maximumFractionDigits: 1
                                            })}%`;
                                        } else {
                                            formattedValue = parseFloat(value).toLocaleString('en-US', {
                                                minimumFractionDigits: 0,
                                                maximumFractionDigits: 2
                                            });
                                        }
                                    }

                                    // In the createSection function, add a special logic for the "Manual Nominal Power" field
                                    if (label === 'Manual Nominal Power') {
                                        // Check priority: ups_realpower_nominal, ups_power_nominal, UPS_REALPOWER_NOMINAL
                                        if (data.ups_realpower_nominal && parseFloat(data.ups_realpower_nominal) > 0) {
                                            formattedValue = `${parseFloat(data.ups_realpower_nominal).toLocaleString('en-US', {
                                                minimumFractionDigits: 0,
                                                maximumFractionDigits: 2
                                            })}W`;
                                        } else if (data.ups_power_nominal && parseFloat(data.ups_power_nominal) > 0) {
                                            formattedValue = `${parseFloat(data.ups_power_nominal).toLocaleString('en-US', {
                                                minimumFractionDigits: 0,
                                                maximumFractionDigits: 2
                                            })}W`;
                                        } else if (data.UPS_REALPOWER_NOMINAL) {
                                            formattedValue = `${data.UPS_REALPOWER_NOMINAL}W`;
                                        }
                                    }

                                    return `
                                        <tr class="hover:bg-gray-100 dark:hover:bg-gray-800">
                                            <td class="py-2 pl-2 w-8">
                                                <i class="fas ${icon} fa-fw text-primary"></i>
                                            </td>
                                            <td class="py-2">
                                                <span class="font-medium text-gray-700 dark:text-gray-300">${label}</span>
                                            </td>
                                            <td class="py-2 pr-2 text-right">
                                                <span class="text-primary font-semibold">${formattedValue}</span>
                                            </td>
                                        </tr>
                                    `;
                                }).join('')}
                            </table>
                        </td>
                    </tr>
                </table>
            `;

            container.appendChild(section);
        } catch (error) {
            throw error;
        }
    }

    formatUPSStatus(status) {
        if (!status) return 'Unknown';
        
        const states = {
            'OL': 'Online',
            'OB': 'On Battery',
            'LB': 'Low Battery',
            'HB': 'High Battery',
            'RB': 'Replace Battery',
            'CHRG': 'Charging',
            'DISCHRG': 'Discharging',
            'BYPASS': 'Bypass Mode',
            'CAL': 'Calibration',
            'OFF': 'Offline',
            'OVER': 'Overloaded',
            'TRIM': 'Trimming Voltage',
            'BOOST': 'Boosting Voltage'
        };

        return status.split(' ')
            .map(s => states[s] || s)
            .join(' + ');
    }

    formatBatteryType(type) {
        if (!type) return 'Unknown';
        
        const types = {
            'PbAc': 'Lead Acid',
            'Li': 'Lithium Ion',
            'LiP': 'Lithium Polymer',
            'NiCd': 'Nickel Cadmium',
            'NiMH': 'Nickel Metal Hydride',
            'SLA': 'Sealed Lead Acid',
            'VRLA': 'Valve Regulated Lead Acid',
            'AGM': 'Absorbed Glass Mat',
            'Gel': 'Gel Cell',
            'Flooded': 'Flooded Lead Acid'
        };
        
        return types[type] || type;
    }

    formatRuntime(seconds) {
        if (!seconds || isNaN(seconds)) return 'Unknown';
        
        // Convert to numbers
        seconds = parseInt(seconds);
        
        // Calculate hours and minutes
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        
        // Format the result
        if (hours > 0) {
            return `${hours} h ${minutes} min`;
        } else {
            return `${minutes} min`;
        }
    }

    showError(message) {
        const toast = document.createElement('div');
        toast.className = 'error-toast';
        toast.textContent = message;
        document.body.appendChild(toast);
        
        setTimeout(() => {
            toast.remove();
        }, 3000);
    }

    // Show loading indicator
    showLoading(message = 'Loading...') {
        // Create loading overlay if it doesn't exist
        let loadingOverlay = document.querySelector('.loading-overlay');
        if (!loadingOverlay) {
            loadingOverlay = document.createElement('div');
            loadingOverlay.className = 'loading-overlay';
            loadingOverlay.innerHTML = `
                <div class="loading-spinner"></div>
                <div class="loading-message">${message}</div>
            `;
            document.body.appendChild(loadingOverlay);
        } else {
            loadingOverlay.querySelector('.loading-message').textContent = message;
            loadingOverlay.style.display = 'flex';
        }
    }

    // Hide loading indicator
    hideLoading() {
        const loadingOverlay = document.querySelector('.loading-overlay');
        if (loadingOverlay) {
            loadingOverlay.style.display = 'none';
        }
    }
}

// Initialize the page when the DOM is fully loaded
document.addEventListener('DOMContentLoaded', () => {
    new UPSInfoPage();
}); 