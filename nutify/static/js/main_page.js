/**
 * MainPage Class
 * Handles the main dashboard page functionality
 * Responsible for UPS data visualization, charts, and real-time updates
 */
class MainPage extends BasePage {
    /**
     * Constructor - Initializes the main dashboard page
     * - Sets up timezone
     * - Sets up charts and buffers
     * - Initializes WebSocket connection
     */
    constructor() {
        super();
        webLogger.enable(false);
        
        // Add debug method if not exists
        if (!webLogger.debug) {
            webLogger.debug = function() {
                if (webLogger.isEnabled) {
                    console.debug.apply(console, arguments);
                }
            };
        }
        
        this._timezone = this.getConfiguredTimezone();
        this.powerChart = null;
        this.dataBuffer = []; // Buffer for real-time data
        this.bufferSize = 15; // For better smoothing
        this.lastWebSocketData = null; // Store the last WebSocket data
        this.webSocketManager = null; // WebSocket manager reference
        this.init();
    }

    /**
     * Initialize the page
     * Sets up WebSocket connection and loads initial data
     */
    async init() {
        webLogger.page('Initializing main dashboard');
        
        // Initialize WebSocket connection
        this.initWebSocket();
        
        // Request cache data after a short delay
        setTimeout(() => {
            if (this.webSocketManager) this.webSocketManager.requestCacheData();
            
            // Initialize charts and load data after receiving initial cache data
            setTimeout(() => {
                this.initializePowerChart();
                this.loadInitialData();
            }, 300);
        }, 100);
        
        // Clean up resources when page is unloaded
        window.addEventListener('beforeunload', this.cleanup.bind(this));
    }

    /**
     * Initialize WebSocket connection for real-time updates
     * Sets up event handlers for WebSocket events
     */
    initWebSocket() {
        // Check if CacheWebSocketManager is available
        if (typeof CacheWebSocketManager === 'undefined') {
            console.error('CacheWebSocketManager not available');
            return;
        }
        
        // Create WebSocket manager with callbacks
        this.webSocketManager = new CacheWebSocketManager({
            onUpdate: (data) => {
                // Store the latest WebSocket data
                this.lastWebSocketData = data;
                // Update dashboard with the data
                this.updateDashboard(data);
            },
            onConnect: () => console.log('WebSocket connected'),
            onDisconnect: () => console.log('WebSocket disconnected'),
            debug: false
        });
    }

    async initializePowerChart() {
        const ctx = document.getElementById('performanceChart').getContext('2d');
        
        try {
            // Generate initial synthetic data
            const now = new Date();
            const syntheticData = this.generateSyntheticData(now);
            
            // Initialize data buffer with synthetic power data
            this.dataBuffer = syntheticData.power.slice(-this.bufferSize);

            // Create a gradient for the fill under the line
            const gradient = ctx.createLinearGradient(0, 0, 0, 300);
            gradient.addColorStop(0, 'rgba(0, 200, 83, 0.3)');
            gradient.addColorStop(1, 'rgba(0, 200, 83, 0.0)');

            // Chart configuration
            const chartConfig = {
                type: 'line',
                data: {
                    datasets: [{
                        label: 'Real Power',
                        backgroundColor: gradient,
                        borderColor: '#00c853',
                        borderWidth: 2.5,
                        data: syntheticData.power,
                        pointRadius: 0,
                        tension: 0.4,
                        fill: true,
                        cubicInterpolationMode: 'monotone'
                    },
                    {
                        label: 'System Load',
                        backgroundColor: 'rgba(255, 105, 180, 0.2)',
                        borderColor: '#FF69B4',
                        borderWidth: 2,
                        data: syntheticData.load,
                        pointRadius: 0,
                        tension: 0.4,
                        fill: false,
                        cubicInterpolationMode: 'monotone'
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: {
                            position: 'top',
                            labels: {
                                color: function() {
                                    return document.documentElement.getAttribute('data-theme') === 'light' ? '#2c3e50' : '#ffffff';
                                },
                                padding: 15
                            }
                        },
                        tooltip: {
                            backgroundColor: 'rgba(0, 0, 0, 0.7)',
                            titleColor: '#ffffff',
                            bodyColor: '#ffffff',
                            callbacks: {
                                label: function(context) {
                                    let label = context.dataset.label || '';
                                    if (label) label += ': ';
                                    if (context.parsed.y !== null) {
                                        if (context.dataset.label === 'Real Power') {
                                            label += context.parsed.y.toFixed(1) + ' W';
                                        } else if (context.dataset.label === 'System Load') {
                                            label += context.parsed.y.toFixed(1) + ' %';
                                        } else {
                                            label += context.parsed.y.toFixed(1);
                                        }
                                    }
                                    return label;
                                }
                            }
                        },
                        streaming: {
                            duration: 60000, // Show only 60 seconds
                            refresh: 1000,
                            delay: 1000,
                            onRefresh: this.onRefresh.bind(this)
                        }
                    },
                    scales: {
                        x: {
                            type: 'realtime',
                            time: {
                                unit: 'second',
                                displayFormats: {
                                    second: 'HH:mm:ss'
                                }
                            },
                            grid: { display: false },
                            ticks: { maxRotation: 0, autoSkip: true, autoSkipPadding: 20 }
                        },
                        y: {
                            min: 0,
                            max: (context) => {
                                if (context.chart.data.datasets[0].data.length > 0) {
                                    let maxValue = Math.max(...context.chart.data.datasets[0].data.map(d => d.y));
                                    return Math.max(100, Math.ceil(maxValue * 1.2));
                                }
                                return 100;
                            },
                            grid: {
                                display: false
                            },
                            ticks: {
                                stepSize: 20,
                                color: '#00c853'
                            },
                            title: {
                                display: true,
                                text: 'Power (W)',
                                color: '#ffffff'
                            }
                        }
                    },
                    interaction: {
                        intersect: false,
                        mode: 'nearest'
                    },
                    animation: {
                        duration: 1000,
                        easing: 'easeOutQuart'
                    }
                }
            };

            this.powerChart = new Chart(ctx, chartConfig);
            webLogger.console('Chart initialized with data');

        } catch (error) {
            console.error('Error initializing power chart:', error);
            this.initializeEmptyChart(ctx);
        }
    }

    // Generate synthetic data for initial display
    generateSyntheticData(endTime) {
        const powerData = [];
        const loadData = [];
        const lastKnownValue = this.getLastKnownPowerValue() || 100;
        
        // Use actual WebSocket data if available
        let basePower = lastKnownValue;
        let baseLoad = 25; // Default load value
        
        if (this.lastWebSocketData) {
            if (this.lastWebSocketData.ups_realpower !== undefined) {
                basePower = parseFloat(this.lastWebSocketData.ups_realpower);
            }
            if (this.lastWebSocketData.ups_load !== undefined) {
                baseLoad = parseFloat(this.lastWebSocketData.ups_load);
            }
        }
        
        // Generate 30 points with small variations
        for (let i = 0; i < 30; i++) {
            const time = new Date(endTime - (30 - i) * 10000);
            
            // Add small random variations
            const powerVariation = Math.random() * 20 - 10; // ±10W variation
            const loadVariation = Math.random() * 10 - 5;   // ±5% variation
            
            // Ensure values are in valid ranges
            const powerValue = Math.max(basePower + powerVariation, 10);
            const loadValue = Math.min(Math.max(baseLoad + loadVariation, 0), 100);
            
            powerData.push({
                x: time.getTime(),
                y: powerValue
            });
            
            loadData.push({
                x: time.getTime(),
                y: loadValue
            });
        }
        
        return { power: powerData, load: loadData };
    }

    // Get the last known power value from localStorage
    getLastKnownPowerValue() {
        const cachedValue = localStorage.getItem('lastPowerValue');
        if (cachedValue) {
            return parseFloat(cachedValue);
        }
        return 100;
    }

    // Initialize empty chart as fallback
    initializeEmptyChart(ctx) {
        const gradient = ctx.createLinearGradient(0, 0, 0, 400);
        gradient.addColorStop(0, 'rgba(0, 200, 83, 0.3)');
        gradient.addColorStop(1, 'rgba(0, 200, 83, 0.0)');
        
        const emptyData = { power: [], load: [] };
        
        this.powerChart = new Chart(ctx, {
            type: 'line',
            data: {
                datasets: [{
                    label: 'Real Power',
                    backgroundColor: gradient,
                    borderColor: '#00c853',
                    borderWidth: 2.5,
                    data: emptyData.power,
                    pointRadius: 0,
                    tension: 0.4,
                    fill: true,
                    cubicInterpolationMode: 'monotone'
                },
                {
                    label: 'System Load',
                    backgroundColor: 'rgba(255, 105, 180, 0.2)',
                    borderColor: '#FF69B4',
                    borderWidth: 2,
                    data: emptyData.load,
                    pointRadius: 0,
                    tension: 0.4,
                    fill: false,
                    cubicInterpolationMode: 'monotone'
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'top',
                        labels: {
                            color: function() {
                                return document.documentElement.getAttribute('data-theme') === 'light' ? '#2c3e50' : '#ffffff';
                            },
                            padding: 15
                        }
                    },
                    tooltip: {
                        backgroundColor: 'rgba(0, 0, 0, 0.7)',
                        titleColor: '#ffffff',
                        bodyColor: '#ffffff',
                        callbacks: {
                            label: function(context) {
                                let label = context.dataset.label || '';
                                if (label) label += ': ';
                                if (context.parsed.y !== null) {
                                    if (context.dataset.label === 'Real Power') {
                                        label += context.parsed.y.toFixed(1) + ' W';
                                    } else if (context.dataset.label === 'System Load') {
                                        label += context.parsed.y.toFixed(1) + ' %';
                                    } else {
                                        label += context.parsed.y.toFixed(1);
                                    }
                                }
                                return label;
                            }
                        }
                    },
                    streaming: {
                        duration: 60000,
                        refresh: 1000,
                        delay: 1000,
                        onRefresh: this.onRefresh.bind(this)
                    }
                },
                scales: {
                    x: {
                        type: 'realtime',
                        grid: { display: false },
                        ticks: { maxRotation: 0, autoSkip: true, autoSkipPadding: 20 }
                    },
                    y: {
                        min: 0,
                        max: 100,
                        grid: {
                            display: false
                        },
                        ticks: {
                            stepSize: 20,
                            color: '#00c853'
                        },
                        title: {
                            display: true,
                            text: 'Power (W)',
                            color: '#ffffff'
                        }
                    }
                },
                interaction: {
                    intersect: false,
                    mode: 'nearest'
                },
                animation: {
                    duration: 1000,
                    easing: 'easeOutQuart'
                }
            }
        });
        webLogger.console('Empty chart initialized as fallback');
    }

    async loadInitialData() {
        webLogger.data('🔄 Loading initial data');
        
        try {
            const [eventsData, emailNotifySettings, ntfySettings, webhookSettings, scheduleResponse] = await Promise.all([
                fetch('/api/table/events?limit=5').then(r => r.json()),
                fetch('/api/settings/nutify').then(r => r.json()),
                fetch('/api/ntfy/settings').then(r => r.json()).catch(err => ({success: true, data: []})),
                fetch('/api/webhook/configs').then(r => r.json()).catch(err => ({success: true, data: []})),
                fetch('/api/settings/report/schedules').then(r => r.json())
            ]);
            
            if (eventsData?.rows) this.updateRecentEvents(eventsData.rows);
            
            // Combine all notification settings
            const allNotifications = [];
            
            // Add email notifications
            if (emailNotifySettings.success && emailNotifySettings.data) {
                webLogger.debug('Email notifications found:', emailNotifySettings.data.length);
                allNotifications.push(...emailNotifySettings.data.map(n => ({...n, channel: 'email'})));
            }
            
            // Add Ntfy notifications if they exist 
            if (ntfySettings.success && ntfySettings.settings) {
                webLogger.debug('Ntfy settings found:', Object.keys(ntfySettings.settings).length);
                // Ntfy API returns an object with keys as event_types 
                Object.entries(ntfySettings.settings).forEach(([eventType, setting]) => {
                    if (setting.enabled) {
                        allNotifications.push({
                            event_type: eventType,
                            enabled: true,
                            channel: 'ntfy'
                        });
                    }
                });
            }
            
            // Add Webhook notifications if they exist
            if (webhookSettings.success && webhookSettings.configs) {
                webLogger.debug('Webhook configs found:', webhookSettings.configs.length);
                // Webhook configs have notify_[eventType] properties
                webhookSettings.configs.forEach(config => {
                    for (const [key, value] of Object.entries(config)) {
                        // Check if it's a notification setting (starts with notify_)
                        if (key.startsWith('notify_') && value === true) {
                            // Convert notify_onbatt to ONBATT
                            const eventType = key.replace('notify_', '').toUpperCase();
                            allNotifications.push({
                                event_type: eventType,
                                enabled: true,
                                channel: 'webhook'
                            });
                        }
                    }
                });
            }
            
            webLogger.debug('Combined notifications:', allNotifications.length);
            const schedules = scheduleResponse.success ? scheduleResponse.data : [];
            this.updateActiveAlertsAndSchedules(allNotifications, schedules);
        } catch (error) {
            webLogger.error('Error loading initial data:', error);
        }
    }

    updateDashboard(data) {
        webLogger.data('🔄 Updating dashboard with data:', data);
        try {
            this.updateMetrics(data);
        } catch (error) {
            webLogger.error('❌ Error in updateDashboard:', error);
        }
    }

    updateMetrics(data) {
        webLogger.data('📊 Updating metrics with data:', data);
        const metrics = {
            battery: data.battery_charge,
            runtime: data.battery_runtime ? data.battery_runtime / 60 : undefined,
            power: data.ups_realpower,
            load: data.ups_load
        };
        Object.entries(metrics).forEach(([type, value]) => this.updateMetricValue(type, value));
    }

    updateMetricValue(type, value) {
        const element = document.querySelector(`.stat-value[data-type="${type}"]`);
        if (!element) return;
        element.textContent = value !== undefined && value !== null ?
            (type === 'battery' || type === 'load') ? `${parseFloat(value).toFixed(1)} %` :
            type === 'runtime' ? `${Math.round(parseFloat(value))} min` :
            type === 'power' ? (parseFloat(value) >= 1000 ? `${(parseFloat(value) / 1000).toFixed(2)} kW` : `${parseFloat(value).toFixed(1)} W`) : '--' : '--';
    }

    cleanup() {
        if (this.powerChart) {
            this.powerChart.destroy();
            this.powerChart = null;
        }
        if (this.webSocketManager) {
            this.webSocketManager.disconnect();
            this.webSocketManager = null;
        }
    }

    updateRecentEvents(events) {
        const container = document.getElementById('recentEvents');
        if (!container) return;
        container.innerHTML = !Array.isArray(events) || !events.length ? '<div class="no-events">No recent events</div>' :
            events.map(event => `
                <div class="event-item ${event.event_type?.toLowerCase() || 'unknown'}">
                    <div class="event-icon"><i class="${this.getEventIcon(event.event_type)}"></i></div>
                    <div class="event-content">
                        <div class="event-header">
                            <span class="event-type">${this.formatEventType(event.event_type)}</span>
                            <span class="event-time">${this.formatEventTime(event.timestamp_tz_begin)}</span>
                        </div>
                        <div class="event-status ${event.acknowledged ? 'seen' : 'new'}">${event.acknowledged ? 'Seen' : 'New'}</div>
                    </div>
                </div>
            `).join('');
    }

    updateActiveAlertsAndSchedules(notifications, schedules) {
        const container = document.getElementById('activeAlerts');
        if (!container) return;
        
        // Filter enabled notifications regardless of channel
        const activeNotifications = notifications.filter(n => n.enabled);
        webLogger.debug('Active notifications count:', activeNotifications.length);
        const activeSchedules = schedules?.filter(s => s.enabled) || [];
        
        // Group notifications by event_type
        const groupedNotifications = {};
        activeNotifications.forEach(notification => {
            const eventType = notification.event_type;
            if (!groupedNotifications[eventType]) {
                groupedNotifications[eventType] = {
                    eventType,
                    channels: new Set()
                };
            }
            if (notification.channel) {
                groupedNotifications[eventType].channels.add(notification.channel);
            }
        });
        
        webLogger.debug('Grouped notifications:', Object.keys(groupedNotifications).length);
        
        container.innerHTML = `
            <div class="alerts-section">
                ${Object.keys(groupedNotifications).length === 0 ? '<div class="no-alerts">No active alerts</div>' :
                    '<div class="alerts-grid">' + Object.values(groupedNotifications).map(notification => {
                        const eventType = notification.eventType;
                        
                        // Generate icons for each channel instead of text
                        const channelIcons = Array.from(notification.channels).map(channel => {
                            let icon = '';
                            switch(channel) {
                                case 'email':
                                    icon = '<i class="fas fa-paper-plane" title="Email"></i>';
                                    break;
                                case 'ntfy':
                                    icon = '<i class="fas fa-bell" title="Ntfy"></i>';
                                    break;
                                case 'webhook':
                                    icon = '<i class="fas fa-code" title="Webhook"></i>';
                                    break;
                                default:
                                    icon = `<i class="fas fa-bell" title="${channel}"></i>`;
                            }
                            return icon;
                        }).join(' ');
                        
                        return `
                            <div class="alert-item ${this.getAlertSeverity(eventType)}">
                                <div class="alert-icon"><i class="${this.getAlertIcon(eventType)}"></i></div>
                                <div class="alert-content">
                                    <div class="alert-title">${this.formatEventType(eventType)}</div>
                                    <div class="alert-channels">${channelIcons}</div>
                                </div>
                                <div class="alert-status"><i class="fas fa-circle"></i></div>
                            </div>
                        `;
                    }).join('') + '</div>'}
            </div>
            <div class="schedules-section">
                <div class="section-header"><i class="fas fa-calendar"></i> Active Schedules</div>
                <div class="schedules-grid">
                    ${activeSchedules.length ? activeSchedules.map(schedule => `
                        <div class="schedule-item">
                            <div class="schedule-icon"><i class="fas fa-clock"></i></div>
                            <div class="schedule-content">
                                <div class="schedule-title">${schedule.time}</div>
                                <div class="schedule-days">${this.formatScheduleDays(schedule.days)}</div>
                                <div class="schedule-reports">${schedule.reports.join(', ')}</div>
                            </div>
                        </div>
                    `).join('') : '<div class="no-schedules">No active schedules</div>'}
                </div>
            </div>
        `;
        
        // Aggiungiamo un po' di stile per migliorare l'aspetto delle icone
        const style = document.createElement('style');
        style.textContent = `
            .alert-channels {
                display: flex;
                gap: 8px;
                margin-top: 4px;
            }
            .alert-channels i {
                font-size: 14px;
                color: white;
                background: #2c75b8;
                padding: 5px;
                border-radius: 5px;
                min-width: 24px;
                text-align: center;
                transition: all 0.2s ease;
                box-shadow: 0 1px 3px rgba(0,0,0,0.15);
            }
            .alert-channels i:hover {
                background: #3498db;
                transform: translateY(-2px);
                box-shadow: 0 2px 5px rgba(0,0,0,0.2);
            }
        `;
        document.head.appendChild(style);
    }

    formatScheduleDays(days) {
        const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        return days.map(d => dayNames[d]).join(', ');
    }

    formatEventTime(timestamp) {
        return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: this._timezone });
    }

    formatEventType(type) {
        const types = { 'ONBATT': 'On Battery', 'ONLINE': 'Online', 'LOWBATT': 'Low Battery', 'COMMOK': 'Communication OK', 'COMMBAD': 'Communication Lost', 'SHUTDOWN': 'Shutdown', 'REPLBATT': 'Replace Battery' };
        return types[type] || type || 'Unknown';
    }

    getAlertIcon(severity) {
        const icons = { 'critical': 'fas fa-exclamation-circle', 'warning': 'fas fa-exclamation-triangle', 'info': 'fas fa-info-circle' };
        return icons[severity?.toLowerCase()] || 'fas fa-bell';
    }

    getEventIcon(type) {
        const icons = { 'ONBATT': 'fas fa-battery-quarter', 'ONLINE': 'fas fa-plug', 'LOWBATT': 'fas fa-battery-empty', 'COMMOK': 'fas fa-check-circle', 'COMMBAD': 'fas fa-times-circle', 'NOCOMM': 'fas fa-wifi-slash', 'SHUTDOWN': 'fas fa-power-off', 'REPLBATT': 'fas fa-exclamation-triangle' };
        return icons[type] || 'fas fa-info-circle';
    }

    getAlertSeverity(eventType) {
        const severityMap = { 'LOWBATT': 'critical', 'ONBATT': 'warning', 'COMMBAD': 'critical', 'NOCOMM': 'critical', 'SHUTDOWN': 'critical', 'REPLBATT': 'warning', 'NOPARENT': 'warning' };
        return severityMap[eventType] || 'info';
    }

    /**
     * Handle chart refresh events
     * Uses WebSocket data to update the chart
     * @param {Object} chart - Chart.js instance
     */
    onRefresh(chart) {
        if (!chart?.data?.datasets) return;
        const now = Date.now();
        
        if (this.lastWebSocketData) {
            // Update Power data (dataset 0)
            if (this.lastWebSocketData.ups_realpower !== undefined) {
                // Get the power value from WebSocket data
                let powerValue = parseFloat(this.lastWebSocketData.ups_realpower || 0);
                
                // Ensure the value is never zero or negative
                powerValue = Math.max(powerValue, 1);

                // Add the new point to the buffer
                this.dataBuffer.push({
                    x: now,
                    y: powerValue
                });

                // Maintain the buffer at the correct size
                if (this.dataBuffer.length > this.bufferSize) {
                    this.dataBuffer.shift();
                }

                // Calculate the smoothed point using the buffer
                const smoothedValue = this.calculateSmoothedValue();
                
                // Save the last value for future use
                localStorage.setItem('lastPowerValue', powerValue.toString());

                // Add the smoothed point to the chart
                chart.data.datasets[0].data.push({
                    x: now,
                    y: smoothedValue
                });
            }
            
            // Update Load data (dataset 1)
            if (this.lastWebSocketData.ups_load !== undefined) {
                let loadValue = parseFloat(this.lastWebSocketData.ups_load || 0);
                
                // Ensure the value is never negative
                loadValue = Math.max(loadValue, 0);
                
                // Add to chart
                chart.data.datasets[1].data.push({
                    x: now,
                    y: loadValue
                });
            }
        } else {
            // If no WebSocket data, use the last known values with small random variation
            const lastPowerValue = this.getLastKnownPowerValue();
            const powerValue = Math.max(lastPowerValue + (Math.random() * 10 - 5), 10);
            
            chart.data.datasets[0].data.push({
                x: now,
                y: powerValue
            });
            
            // For load, use a placeholder value
            chart.data.datasets[1].data.push({
                x: now,
                y: 25 + (Math.random() * 10 - 5)
            });
        }
        
        // Limit the number of points to improve performance
        chart.data.datasets.forEach(dataset => {
            if (dataset.data.length > 100) {
                dataset.data.shift();
            }
        });
        
        chart.update('quiet');
    }

    // Calculate smoothed value from buffer
    calculateSmoothedValue() {
        if (this.dataBuffer.length === 0) return 0;
        
        // Use weights for advanced smoothing
        const weights = [];
        for (let i = 0; i < this.dataBuffer.length; i++) {
            // Formula to give more weight to more recent values
            weights.push(Math.pow(1.2, i));
        }
        
        const weightSum = weights.reduce((a, b) => a + b, 0);
        
        // Calculate the weighted average
        let smoothedValue = 0;
        for (let i = 0; i < this.dataBuffer.length; i++) {
            smoothedValue += this.dataBuffer[i].y * weights[i];
        }
        
        return smoothedValue / weightSum;
    }
}

/**
 * Initialize the main page when the DOM is ready
 */
document.addEventListener('DOMContentLoaded', () => {
    new MainPage();
    const chartCard = document.querySelector('.chart_card');
    if (chartCard) {
        chartCard.style.height = '320px';
        chartCard.style.paddingBottom = '20px';
    }
});