class BatteryPage extends BasePage {
    constructor() {
        super();
        // Remove webLogger.enable(false)
        this.availableMetrics = null;
        this.isRealTimeMode = false;
        this.realTimeInterval = null;
        this.realTimeIntervalDuration = 1000;
        this.isFirstRealTimeUpdate = true;
        this.isFirstTemperatureUpdate = true;
        this.voltageController = null; // We will initialize it after creating the chart
        this.lastWebSocketData = null; // Store last WebSocket data
        this.webSocketManager = null; // WebSocket manager
        
        // Add properties for Real Time mode
        this.enforceRealtimeMode = false; // Allow switching to other modes immediately
        this.realtimeStartTime = Date.now();
        this.realtimeDuration = 60 * 60 * 1000; // 1 hour in milliseconds
        this.realtimeCheckInterval = null;
        
        // Bind formatting functions
        this.formatChartDate = this.formatChartDate.bind(this);
        this.formatTooltipDate = this.formatTooltipDate.bind(this);
        
        this._timezone = this.getConfiguredTimezone();
        
        // Make Act command available to override enforced realtime mode (for consistency)
        window.Act = () => {
            if (this.overrideEnforcedRealtimeMode()) {
                webLogger.data('Realtime mode enforcement overridden via Act command');
                return 'You can now switch to other time ranges';
            }
            return 'Realtime mode was not being enforced or was already overridden';
        };
        
        // Initialize WebSocket for real-time updates
        this.initWebSocket();
        
        (async () => {
            try {
                await this.loadMetrics();
                this.initEventListeners();
                this.initCharts();
                
                // Check if we have enough historical data (1+ hour)
                const hasEnoughData = await this.checkForOneHourData();
                
                if (hasEnoughData) {
                    // If we have enough data, use Today mode
                    this.isRealTimeMode = false;
                    this.enforceRealtimeMode = false;
                    
                    // Get current time for the time range
                    const now = new Date();
                    const currentTime = now.toLocaleTimeString(window.APP_CONFIG && window.APP_CONFIG.locale ? 
                        window.APP_CONFIG.locale : undefined, { hour: '2-digit', minute: '2-digit' });
                    
                    // Activate the today option in the menu
                    document.querySelectorAll('.range-options a').forEach(option => {
                        option.classList.remove('active');
                        if (option.dataset.range === 'today') {
                            option.classList.add('active');
                        }
                    });
                    
                    // Update the displayed range
                    this.updateDisplayedRange(`Today (00:00 - ${currentTime})`);
                    
                    // Show Battery Health and Battery Events sections when starting in Today mode
                    const healthSection = document.querySelector('.health');
                    const eventsSection = document.querySelector('.events');
                    
                    if (healthSection) {
                        healthSection.classList.remove('hidden');
                        webLogger.data('Battery Health section shown for Today mode');
                    }
                    
                    if (eventsSection) {
                        eventsSection.classList.remove('hidden');
                        webLogger.data('Battery Events section shown for Today mode');
                    }
                    
                    // Load the today data
                    await this.loadData('today', '00:00', currentTime);
                    webLogger.data('Starting in Today mode with historical data');
                    
                    // Remove the unnecessary notification
                    // this.showNotification('Starting in Today mode with historical data. You can switch to other modes from the time range menu.', 'info');
                } else {
                    // If there is not enough data (less than 1 hour), default to RealTime mode
                    webLogger.data('Not enough historical data found. Starting in Real Time mode.');
                    this.isRealTimeMode = true;
                    
                    // Don't enforce realtime mode, allow switching
                    this.enforceRealtimeMode = false;
                    
                    // Activate the realtime option in the menu
                    document.querySelectorAll('.range-options a').forEach(option => {
                        option.classList.remove('active');
                        if (option.dataset.range === 'realtime') {
                            option.classList.add('active');
                        }
                    });
                    
                    // Hide Battery Health and Battery Events sections when starting in real-time mode
                    const healthSection = document.querySelector('.health');
                    const eventsSection = document.querySelector('.events');
                    
                    if (healthSection) {
                        healthSection.classList.add('hidden');
                        webLogger.data('Battery Health section hidden on initial real-time mode');
                    }
                    
                    if (eventsSection) {
                        eventsSection.classList.add('hidden');
                        webLogger.data('Battery Events section hidden on initial real-time mode');
                    }
                    
                    // Start in real-time mode
                    this.startRealTimeUpdates();
                    
                    // Show notification about real-time mode but mention it can be changed
                    window.notify('Real Time mode enforced: waiting for 1 hour of data collection. You can switch to other modes from the time range menu.', 'warning');
                }
            } catch (error) {
                webLogger.error('Error in initialization:', error);
                
                // On error, default to realtime mode as a fallback
                this.isRealTimeMode = true;
                this.startRealTimeUpdates();
            }
        })();
    }
    
    /**
     * Initialize WebSocket connection for real-time cache updates
     */
    initWebSocket() {
        // Check if CacheWebSocketManager is available
        if (typeof CacheWebSocketManager === 'undefined') {
            webLogger.error('CacheWebSocketManager not available for Battery page.');
            return;
        }
        
        // Create WebSocket manager with callbacks
        this.webSocketManager = new CacheWebSocketManager({
            onUpdate: (data) => {
                // Store the data for use in chart updates
                this.lastWebSocketData = data;
                
                // If in real-time mode, update widgets with the new data
                if (this.isRealTimeMode) {
                    this.updateWidgetValues(data);
                    this.updateStats(data);
                }
            },
            onConnect: () => webLogger.data('Battery page connected to WebSocket'),
            onDisconnect: () => webLogger.warning('Battery page disconnected from WebSocket'),
            debug: false
        });
    }
    
    async loadInitialCacheData() {
        // If we have WebSocket data, use it
        if (this.lastWebSocketData) {
            return {
                // Include only available fields
                battery_temperature: this.lastWebSocketData.battery_temperature
            };
        }
        // If WebSocket manager exists but no data yet, request it
        else if (this.webSocketManager) {
            this.webSocketManager.requestCacheData();
            // Wait a bit for data to arrive
            await new Promise(resolve => setTimeout(resolve, 500));
            
            // Check if we got data after waiting
            if (this.lastWebSocketData) {
                return {
                    battery_temperature: this.lastWebSocketData.battery_temperature
                };
            }
        }
        
        // Return null if no data available
        return null;
    }

    async loadData(period = 'day', fromTime = null, toTime = null) {
        try {
            const params = new URLSearchParams();
            params.append('period', period);
            
            const selectedRange = document.querySelector('.range-options a.active');
            const rangeType = selectedRange ? selectedRange.dataset.range : 'day';
            
            webLogger.data("🔍 loadData called with:", { period, fromTime, toTime, rangeType });

            // Check if this is the "Today" case - when fromTime starts with '00:00'
            const isTodayMidnight = fromTime && fromTime.startsWith('00:00');

            if (rangeType === 'day') {
                params.append('period', 'day');
                
                if (fromTime && !toTime) {
                    // SELECT DAY - pass the complete date
                    params.append('selected_date', fromTime);
                    webLogger.data('📅 Select Day mode', { date: fromTime });
                } else if (isTodayMidnight && toTime) {
                    // TODAY - special handling for the "Today" option
                    webLogger.data('📅 STRICT TODAY MODE with midnight start', { from: fromTime, to: toTime });
                    
                    // Special parameter to indicate Today mode with midnight start
                    params.append('today_mode', 'true');
                    params.append('from_time', fromTime);
                    params.append('to_time', toTime);
                } else if (fromTime && toTime) {
                    // Custom time range within a day
                    webLogger.data('📅 Custom time range within day', { from: fromTime, to: toTime });
                    params.append('from_time', fromTime);
                    params.append('to_time', toTime);
                } else {
                    // Fallback - use current day with explicit today_mode
                    const now = new Date();
                    
                    // Include timezone information in the time string for server-side parsing
                    // Format: HH:MM+TIMEZONE_OFFSET (e.g., "14:30+0200")
                    let fromTimeStr = '00:00';
                    let toTimeStr;
                    
                    // Get timezone offset in hours and minutes
                    const tzOffset = now.getTimezoneOffset();
                    const tzOffsetHours = Math.abs(Math.floor(tzOffset / 60));
                    const tzOffsetMinutes = Math.abs(tzOffset % 60);
                    const tzOffsetSign = tzOffset <= 0 ? '+' : '-';
                    const tzOffsetFormatted = `${tzOffsetSign}${tzOffsetHours.toString().padStart(2, '0')}${tzOffsetMinutes.toString().padStart(2, '0')}`;
                    
                    // Format current time with timezone offset
                    toTimeStr = now.toLocaleTimeString([], { 
                        hour: '2-digit', 
                        minute: '2-digit',
                        hour12: false,
                        timeZone: this._timezone 
                    }) + tzOffsetFormatted;
                    
                    // Always include the timezone offset for consistent handling
                    fromTimeStr = `00:00${tzOffsetFormatted}`;
                    params.append('from_time', fromTimeStr);
                    params.append('to_time', toTimeStr);
                    // Always add today_mode parameter to ensure server handles it correctly
                    params.append('today_mode', 'true');
                    webLogger.data('📅 Today mode default fallback with explicit today_mode', { from: fromTimeStr, to: toTimeStr });
                }
            } else if (rangeType === 'range') {
                params.append('period', 'range');
                params.append('from_time', fromTime);
                params.append('to_time', toTime);
                webLogger.data('📅 Range mode', { from: fromTime, to: toTime });
            } else {
                // Other cases (realtime)
                if (fromTime) params.append('from_time', fromTime);
                if (toTime) params.append('to_time', toTime);
                webLogger.data('📅 Realtime mode', { from: fromTime, to: toTime });
            }

            const [statsResponse, historyResponse] = await Promise.all([
                fetch(`/api/battery/stats?${params}`),
                fetch(`/api/battery/history?${params}`)
            ]);

            const stats = await statsResponse.json();
            const history = await historyResponse.json();

            webLogger.data("📊 Received data:", {
                stats: stats.data,
                history: history.data,
                available_metrics: Object.keys(history.data || {}),
                temperature_present: history.data?.battery_temperature ? 'YES' : 'NO',
                num_temp_points: history.data?.battery_temperature?.length || 0
            });

            if (stats.success && history.success && history.data) {
                try {
                    const formattedData = this.formatChartData(history.data);
                    
                    if (this.combinedChart) {
                        // Check if we have any data points before updating the chart
                        const hasData = ['battery_charge', 'battery_runtime', 'battery_voltage'].some(
                            metric => formattedData[metric] && formattedData[metric].length > 0
                        );
                        
                        if (hasData) {
                            this.combinedChart.updateSeries([
                                {
                                    name: 'Battery Level',
                                    data: formattedData.battery_charge || [],
                                    type: 'line',
                                    color: '#2E93fA'
                                },
                                {
                                    name: 'Runtime',
                                    data: formattedData.battery_runtime || [],
                                    type: 'line',
                                    color: '#66DA26'
                                },
                                {
                                    name: 'Voltage',
                                    data: formattedData.battery_voltage || [],
                                    type: 'line',
                                    color: '#FF9800'
                                }
                            ]);
                        } else {
                            webLogger.warning("No data points available for chart");
                        }
                    }
                    
                    await this.updateStats(stats.data);
                    webLogger.page('Page data updated successfully');
                } catch (formatError) {
                    webLogger.error("Error formatting chart data:", formatError);
                    if (typeof this.showError === 'function') {
                        this.showError('Error formatting chart data');
                    }
                }
            } else {
                webLogger.error('API Error', { stats, history });
                if (typeof this.showError === 'function') {
                    this.showError('Error loading data from server');
                }
            }
        } catch (error) {
            webLogger.error("❌ Error loading data:", error);
            console.error('Error loading data:', error);
            if (typeof this.showError === 'function') {
                this.showError('Error loading data');
            }
        }
    }

    async loadDataWithParams(params) {
        try {
            webLogger.data("🔍 loadDataWithParams called with params:", Object.fromEntries(params));

            const [statsResponse, historyResponse] = await Promise.all([
                fetch(`/api/battery/stats?${params}`),
                fetch(`/api/battery/history?${params}`)
            ]);

            const stats = await statsResponse.json();
            const history = await historyResponse.json();

            webLogger.data("📊 Received data from params:", {
                stats: stats.data,
                history: history.data,
                available_metrics: Object.keys(history.data || {}),
                temperature_present: history.data?.battery_temperature ? 'YES' : 'NO',
                num_temp_points: history.data?.battery_temperature?.length || 0
            });

            // Verify the data is correct if this is a today_mode request
            if (params.get('today_mode') === 'true' && history.data) {
                const isValid = this.verifyTodayData(history.data);
                if (!isValid) {
                    webLogger.warning('⚠️ Today data verification failed - data may be incorrect!');
                } else {
                    webLogger.data('✅ Today data verification passed - data starts correctly from midnight today');
                }
            }

            if (stats.success && history.success && history.data) {
                try {
                    const formattedData = this.formatChartData(history.data);
                    
                    if (this.combinedChart) {
                        // Check if we have any data points before updating the chart
                        const hasData = ['battery_charge', 'battery_runtime', 'battery_voltage'].some(
                            metric => formattedData[metric] && formattedData[metric].length > 0
                        );
                        
                        if (hasData) {
                            this.combinedChart.updateSeries([
                                {
                                    name: 'Battery Level',
                                    data: formattedData.battery_charge || [],
                                    type: 'line',
                                    color: '#2E93fA'
                                },
                                {
                                    name: 'Runtime',
                                    data: formattedData.battery_runtime || [],
                                    type: 'line',
                                    color: '#66DA26'
                                },
                                {
                                    name: 'Voltage',
                                    data: formattedData.battery_voltage || [],
                                    type: 'line',
                                    color: '#FF9800'
                                }
                            ]);
                            webLogger.data("📈 Chart series updated with formatted data");
                        } else {
                            webLogger.warning("No data points available for chart");
                        }
                    }
                    
                    // Ensure we have valid stats data
                    if (stats.data && Object.keys(stats.data).length > 0) {
                        // Log stats data before updating UI
                        webLogger.data("📊 Updating UI with stats data:", stats.data);
                        await this.updateStats(stats.data);
                        webLogger.page('Page data updated successfully');
                    } else {
                        webLogger.error("Empty or invalid stats data:", stats);
                    }
                    
                    // Update battery health in non-realtime mode
                    if (!this.isRealTimeMode) {
                        webLogger.data("📊 Battery Health section shown when exiting real-time mode");
                    }
                } catch (formatError) {
                    webLogger.error("Error formatting chart data:", formatError);
                    if (typeof this.showError === 'function') {
                        this.showError('Error formatting chart data');
                    }
                }
            } else {
                webLogger.error('API Error', { stats, history });
                if (typeof this.showError === 'function') {
                    this.showError('Error loading data from server');
                }
            }
        } catch (error) {
            webLogger.error("❌ Error loading data:", error);
            console.error('Error loading data:', error);
            if (typeof this.showError === 'function') {
                this.showError('Error loading data');
            }
        }
    }

    formatChartData(data) {
        const formatted = {};
        
        // Initialize the arrays for each metric to avoid undefined errors
        ['battery_charge', 'battery_runtime', 'battery_voltage'].forEach(metric => {
            formatted[metric] = [];
        });
        
        // Check if we're in Today mode
        const isTodayMode = document.querySelector('.range-options a[data-range="today"].active') !== null;
        
        // Create a midnight timestamp for today if in Today mode
        let midnightTimestamp = null;
        if (isTodayMode) {
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            midnightTimestamp = today.getTime();
        }
        
        // Format data for each metric
        ['battery_charge', 'battery_runtime', 'battery_voltage'].forEach(metric => {
            if (data[metric] && Array.isArray(data[metric])) {
                // Only log first/last for battery_charge to reduce noise
                if (metric === 'battery_charge' && data[metric].length > 0) {
                    const firstPoint = data[metric][0];
                    const lastPoint = data[metric][data[metric].length - 1];
                    const firstDate = new Date(firstPoint.timestamp);
                    const lastDate = new Date(lastPoint.timestamp);
                    
                    // Format in local timezone with date and time
                    const firstLocalStr = firstDate.toLocaleString([], {timeZone: this._timezone});
                    const lastLocalStr = lastDate.toLocaleString([], {timeZone: this._timezone});
                    
                    webLogger.data(`${metric} data range: ${firstLocalStr} to ${lastLocalStr}`);
                }
                
                // Convert server data to chart points
                const points = data[metric].map(point => {
                    const timestamp = new Date(point.timestamp);
                    return {
                        x: timestamp.getTime(),
                        y: point.value
                    };
                });
                
                // If in Today mode and we have points - add midnight point if needed
                if (isTodayMode && midnightTimestamp && points.length > 0) {
                    // Check if first point is already at midnight (within 5 min tolerance)
                    const firstPointTime = points[0].x;
                    const timeDiff = Math.abs(firstPointTime - midnightTimestamp);
                    const fiveMinutesMs = 5 * 60 * 1000;
                    
                    // If first point is not within 5 minutes of midnight, add midnight point
                    if (timeDiff > fiveMinutesMs) {
                        points.unshift({
                            x: midnightTimestamp,
                            y: points[0].y // Use first point's value for midnight
                        });
                    }
                }
                
                // Sort by timestamp to ensure order (especially after adding midnight point)
                points.sort((a, b) => a.x - b.x);
                formatted[metric] = points;
                
                // Log the range after potentially adding the midnight point
                if (metric === 'battery_charge' && points.length > 0) {
                    const firstTime = new Date(points[0].x).toLocaleString([], {timeZone: this._timezone});
                    const lastTime = new Date(points[points.length-1].x).toLocaleString([], {timeZone: this._timezone});
                    webLogger.data(`Chart data: ${points.length} points from ${firstTime} to ${lastTime}`);
                }
            }
        });
        
        return formatted;
    }

    async loadMetrics() {
        try {
            const response = await fetch('/api/battery/metrics');
            const data = await response.json();
            if (data.success && data.data) {
                this.availableMetrics = data.data;
                webLogger.data('Available metrics', this.availableMetrics);
            }
        } catch (error) {
            webLogger.error('Error loading metrics', error);
        }
    }
    // CONTROLLER
    async initCharts() {
        webLogger.page('Initializing battery charts');
        
        const combinedChartElement = document.querySelector("#combinedBatteryChart");
        if (combinedChartElement) {
            this.initCombinedChart(combinedChartElement);
            // Initialize the voltage controller after creating the chart
            this.voltageController = new BatteryVoltageController(this.combinedChart);
        }

        // Initialize the controller instead of the mini-widgets
        const widgetsContainer = document.getElementById('batteryWidgetsContainer');
        if (widgetsContainer && this.availableMetrics) {
            // Load both variables and commands
            Promise.all([
                this.loadUPSVariables(),
                this.loadUPSCommands()
            ]).then(([variables, commands]) => {
                // Filter only the battery variables
                const batteryVariables = variables.filter(variable => {
                    const name = variable.name.toLowerCase();
                    return name.startsWith('battery.') || 
                           name.includes('batt.') ||
                           name.includes('runtime') ||
                           (name.includes('charge') && !name.includes('recharge'));
                });
                this.renderAllWidgets(widgetsContainer, batteryVariables);
            });
        }

        const healthElement = document.querySelector("#batteryHealthChart");
        if (healthElement) {
            this.initBatteryHealthChart(healthElement);
        }

        if (this.combinedChart) {
            this.combinedChart.updateOptions({
                chart: {
                    animations: {
                        enabled: true,
                        easing: 'linear',
                        dynamicAnimation: {
                            speed: 1000
                        }
                    }
                },
                // Keep only the last N points for performance
                series: [{
                    data: []
                }, {
                    data: []
                }, {
                    data: []
                }]
            });
        }

        // Temperature Chart
        const temperatureEl = document.querySelector("#temperatureChart");
        const temperatureCard = temperatureEl?.closest('.combined_card');
        
        if (temperatureEl && this.availableMetrics?.battery_temperature) {
            try {
                this.temperatureChart = new ApexCharts(temperatureEl, {
                    series: [{
                        name: 'Temperature',
                        data: []
                    }],
                    chart: {
                        type: 'line',
                        height: 350,
                        animations: { enabled: true }
                    },
                    stroke: {
                        curve: 'smooth',
                        width: 2
                    },
                    xaxis: { 
                        type: 'datetime',
                        labels: {
                            datetimeUTC: false,
                            rotate: 0,
                            formatter: this.formatChartDate
                        },
                        timezone: 'local'
                    },
                    yaxis: {
                        title: { text: 'Temperature (°C)' },
                        decimalsInFloat: 1,
                        min: 15,  // Minimum 15°C
                        max: 30   // Maximum 30°C
                    },
                    tooltip: {
                        shared: true,
                        x: { format: 'dd MMM yyyy HH:mm:ss' }
                    }
                });
                this.temperatureChart.render();
                if (temperatureCard) temperatureCard.style.display = 'block';
            } catch (error) {
                webLogger.error("Error initializing temperature chart:", error);
                if (temperatureCard) temperatureCard.style.display = 'none';
            }
        } else {
            // Hide the chart container if there is no temperature data
            if (temperatureCard) temperatureCard.style.display = 'none';
            webLogger.data("Temperature data not available for this UPS");
        }
    }
    // CONTROLLER
    initCombinedChart(element) {
        const options = {
            series: [
                {
                    name: 'Battery Level',
                    data: [],
                    color: '#2E93fA',
                    type: 'line'
                },
                {
                    name: 'Runtime',
                    data: [],
                    color: '#66DA26',
                    type: 'line'
                },
                {
                    name: 'Voltage',
                    data: [],
                    color: '#FF9800',
                    type: 'line'
                }
            ],
            chart: {
                type: 'line',
                height: 450,
                animations: {
                    enabled: true,
                    easing: 'linear',
                    dynamicAnimation: {
                        speed: 1000
                    }
                },
                toolbar: {
                    show: true
                },
                noData: {
                    text: 'Loading data...',
                    align: 'center',
                    verticalAlign: 'middle',
                    style: {
                        fontSize: '16px'
                    }
                }
            },
            stroke: {
                curve: 'smooth',
                width: [2, 2, 2]
            },
            xaxis: {
                type: 'datetime',
                labels: {
                    datetimeUTC: false,
                    rotate: 0,
                    formatter: this.formatChartDate
                },
                timezone: 'local'
            },
            tooltip: {
                x: {
                    formatter: this.formatTooltipDate
                },
                y: {
                    formatter: function(value) {
                        // Format Y values with 2 decimals in tooltip
                        return parseFloat(value).toFixed(2);
                    }
                }
            },
            yaxis: [
                {
                    title: {
                        text: 'Battery Level (%)',
                        style: { color: '#2E93fA' }
                    },
                    min: 0,
                    max: 100,
                    tickAmount: 5,
                    decimalsInFloat: 0,
                    labels: {
                        formatter: function(val) {
                            return Math.round(val);
                        },
                        style: { colors: '#2E93fA' }
                    }
                },
                {
                    opposite: true,
                    title: {
                        text: 'Runtime (min)',
                        style: { color: '#66DA26' }
                    },
                    labels: {
                        formatter: function(val) {
                            return Math.round(val);
                        },
                        style: { colors: '#66DA26' }
                    }
                },
                {
                    opposite: true,
                    title: {
                        text: 'Voltage (V)',
                        style: { color: '#FF9800' }
                    },
                    min: 0,
                    tickAmount: 5,
                    labels: {
                        formatter: function(val) {
                            return Math.round(val);
                        },
                        style: { colors: '#FF9800' }
                    }
                }
            ],
            legend: {
                horizontalAlign: 'center'
            }
        };

        this.combinedChart = new ApexCharts(element, options);
        this.combinedChart.render();
    }

    initBatteryHealthChart(element) {
        // Take the health value from the data attribute
        const initialHealth = parseFloat(element.dataset.health) || 0;
        
        const options = {
            chart: {
                type: 'radialBar',
                height: 350
            },
            plotOptions: {
                radialBar: {
                    startAngle: -135,
                    endAngle: 135,
                    hollow: {
                        margin: 15,
                        size: '70%'
                    },
                    track: {
                        background: '#e7e7e7',
                        strokeWidth: '97%',
                        margin: 5
                    },
                    dataLabels: {
                        name: {
                            show: true,
                            fontSize: '16px',
                            color: '#888',
                            offsetY: -10
                        },
                        value: {
                            show: true,
                            fontSize: '30px',
                            offsetY: 5,
                            formatter: function (val) {
                                return parseFloat(val).toFixed(2) + '%';
                            }
                        }
                    }
                }
            },
            fill: {
                type: 'gradient',
                gradient: {
                    shade: 'dark',
                    type: 'horizontal',
                    shadeIntensity: 0.5,
                    gradientToColors: ['#ABE5A1'],
                    inverseColors: true,
                    opacityFrom: 1,
                    opacityTo: 1,
                    stops: [0, 100]
                }
            },
            stroke: {
                lineCap: 'round'
            },
            labels: ['Battery Health'],
            series: [initialHealth]
        };

        this.batteryHealthChart = new ApexCharts(element, options);
        this.batteryHealthChart.render();
    }

    async initEventListeners() {
        webLogger.page('Setting up event listeners');
        // Date range dropdown
        const dateRangeBtn = document.getElementById('dateRangeBtn');
        const dateRangeDropdown = document.getElementById('dateRangeDropdown');
        const timeRangeSelector = document.getElementById('timeRangeSelector');
        const fromTimeInput = document.getElementById('fromTime');
        const toTimeInput = document.getElementById('toTime');
        const applyTimeRange = document.getElementById('applyTimeRange');

        // Set the current time in the "To" field with proper timezone consideration
        const now = new Date();
        if (toTimeInput) {
            toTimeInput.value = now.toLocaleTimeString([], { 
                hour: '2-digit', 
                minute: '2-digit', 
                hour12: false, 
                timeZone: this._timezone 
            });
        }

        // Toggle the dropdown
        if (dateRangeBtn && dateRangeDropdown) {
            dateRangeBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                dateRangeDropdown.classList.toggle('hidden');
            });
        }

        // Apply time range button
        if (applyTimeRange) {
            applyTimeRange.addEventListener('click', async () => {
                const fromTime = fromTimeInput.value;
                const toTime = toTimeInput.value;
                
                // Get timezone offset for consistent client-server communication
                const tzOffset = now.getTimezoneOffset();
                const tzOffsetHours = Math.abs(Math.floor(tzOffset / 60));
                const tzOffsetMinutes = Math.abs(tzOffset % 60);
                const tzOffsetSign = tzOffset <= 0 ? '+' : '-';
                const tzOffsetFormatted = `${tzOffsetSign}${tzOffsetHours.toString().padStart(2, '0')}${tzOffsetMinutes.toString().padStart(2, '0')}`;
                
                // Add timezone offset to time strings for server-side parsing
                const fromTimeWithTz = `${fromTime}${tzOffsetFormatted}`;
                const toTimeWithTz = `${toTime}${tzOffsetFormatted}`;
                
                // Reset ONLY when clicking Apply
                this.resetAllData();
                
                const displayText = `Today (${fromTime} - ${toTime})`;
                this.updateDisplayedRange(displayText);
                
                await this.loadData('today', fromTimeWithTz, toTimeWithTz);
                dateRangeDropdown.classList.add('hidden');
            });
        }

        // Range options
        document.querySelectorAll('.range-options a').forEach(option => {
            option.addEventListener('click', async (e) => {
                e.preventDefault();
                const range = option.dataset.range;
                
                // Remove active from all options
                document.querySelectorAll('.range-options a').forEach(opt => {
                    opt.classList.remove('active');
                });
                option.classList.add('active');

                // Hide all panels
                document.querySelectorAll('.time-selector, .day-selector, .range-selector, .realtime-selector').forEach(panel => {
                    panel.classList.add('hidden');
                });

                switch(range) {
                    case 'realtime':
                        document.getElementById('realtimeSelector').classList.remove('hidden');
                        this.stopRealtimeUpdates(); // Stop previous updates
                        this.resetCharts(); // Reset charts
                        this.startRealTimeUpdates();
                        break;
                    case 'today':
                        const now = new Date();
                        const today = new Date(now);
                        today.setHours(0, 0, 0, 0);
                        
                        // Get timezone offset for consistent client-server communication
                        const tzOffset = now.getTimezoneOffset();
                        const tzOffsetHours = Math.abs(Math.floor(tzOffset / 60));
                        const tzOffsetMinutes = Math.abs(tzOffset % 60);
                        const tzOffsetSign = tzOffset <= 0 ? '+' : '-';
                        const tzOffsetFormatted = `${tzOffsetSign}${tzOffsetHours.toString().padStart(2, '0')}${tzOffsetMinutes.toString().padStart(2, '0')}`;
                        
                        // Format time with the timezone
                        const currentTime = now.toLocaleTimeString([], { 
                            hour: '2-digit', 
                            minute: '2-digit',
                            hour12: false,
                            timeZone: this._timezone 
                        });
                        
                        // Always use strict 00:00 time for today option with timezone
                        const fromTimeWithTz = `00:00${tzOffsetFormatted}`;
                        const toTimeWithTz = `${currentTime}${tzOffsetFormatted}`;
                        
                        webLogger.data('🔍 TODAY MODE - using strict midnight start:', {
                            date: today.toISOString(),
                            fromTime: fromTimeWithTz,
                            toTime: toTimeWithTz,
                            tzOffset: tzOffsetFormatted
                        });
                        
                        // First stop realtime updates and reset any existing charts
                        this.stopRealtimeUpdates();
                        this.resetCharts();
                        this.resetAllData();
                        
                        this.updateDisplayedRange(`Today (00:00 - ${currentTime})`);
                        
                        // Create params with explicit today_mode flag to force server to use midnight
                        const params = new URLSearchParams();
                        params.append('period', 'day');
                        params.append('from_time', fromTimeWithTz);
                        params.append('to_time', toTimeWithTz);
                        params.append('today_mode', 'true');
                        
                        // Use loadDataWithParams instead of loadData to ensure today_mode is passed
                        await this.loadDataWithParams(params);
                        break;
                    case 'day':
                        this.stopRealtimeUpdates();
                        document.getElementById('daySelectorPanel').classList.remove('hidden');
                        break;
                    case 'range':
                        this.stopRealtimeUpdates();
                        document.getElementById('dateRangeSelectorPanel').classList.remove('hidden');
                        break;
                }
            });
        });

        // Single day selection
        const applyDay = document.getElementById('applyDay');
        if (applyDay) {
            applyDay.addEventListener('click', async () => {
                const selectedDate = document.getElementById('dayPicker').value;
                if (selectedDate) {
                    // Include timezone information for consistent display
                    const now = new Date();
                    const tzOffset = now.getTimezoneOffset();
                    const tzOffsetHours = Math.abs(Math.floor(tzOffset / 60));
                    const tzOffsetMinutes = Math.abs(tzOffset % 60);
                    const tzOffsetSign = tzOffset <= 0 ? '+' : '-';
                    const tzOffsetFormatted = `${tzOffsetSign}${tzOffsetHours.toString().padStart(2, '0')}${tzOffsetMinutes.toString().padStart(2, '0')}`;

                    // Format the display text with the timezone-aware date
                    const displayDate = new Date(selectedDate);
                    const displayText = displayDate.toLocaleDateString([], { timeZone: this._timezone });
                    
                    this.updateDisplayedRange(displayText);
                    await this.loadData('day', selectedDate);
                    dateRangeDropdown.classList.add('hidden');
                }
            });
        }

        // Correct the IDs for the date range
        const rangeSelectorPanel = document.getElementById('dateRangeSelectorPanel'); // was 'rangeSelectorPanel'
        if (rangeSelectorPanel) {
            const applyRange = rangeSelectorPanel.querySelector('#applyRange');
            const fromDate = rangeSelectorPanel.querySelector('#rangeFromDate');
            const toDate = rangeSelectorPanel.querySelector('#rangeToDate');
            
            if (applyRange) {
                applyRange.addEventListener('click', async () => {
                    if (fromDate.value && toDate.value) {
                        this.resetAllData();
                        
                        // Include timezone information for consistent display
                        const now = new Date();
                        const tzOffset = now.getTimezoneOffset();
                        const tzOffsetHours = Math.abs(Math.floor(tzOffset / 60));
                        const tzOffsetMinutes = Math.abs(tzOffset % 60);
                        const tzOffsetSign = tzOffset <= 0 ? '+' : '-';
                        const tzOffsetFormatted = `${tzOffsetSign}${tzOffsetHours.toString().padStart(2, '0')}${tzOffsetMinutes.toString().padStart(2, '0')}`;

                        // Use formatted dates for display
                        const fromDateObj = new Date(fromDate.value);
                        const toDateObj = new Date(toDate.value);
                        const fromFormatted = fromDateObj.toLocaleDateString([], { timeZone: this._timezone });
                        const toFormatted = toDateObj.toLocaleDateString([], { timeZone: this._timezone });
                        
                        const displayText = `${fromFormatted} to ${toFormatted}`;
                        this.updateDisplayedRange(displayText);
                        
                        await this.loadData('range', fromDate.value, toDate.value);
                        document.getElementById('dateRangeDropdown').classList.add('hidden');
                    }
                });
            }
        }

        // Click outside to close the dropdown
        document.addEventListener('click', (e) => {
            if (!dateRangeBtn.contains(e.target) && !dateRangeDropdown.contains(e.target)) {
                dateRangeDropdown.classList.add('hidden');
            }
        });

        // Set the limits of the date picker based on the available data
        const dayPicker = document.getElementById('dayPicker');
        const rangeFromDate = document.getElementById('rangeFromDate');
        const rangeToDate = document.getElementById('rangeToDate');

        if (this.availableMetrics) {
            const firstDate = this.availableMetrics.first_date;
            const lastDate = this.availableMetrics.last_date;

            if (dayPicker) {
                dayPicker.min = firstDate;
                dayPicker.max = lastDate;
            }
            if (rangeFromDate) {
                rangeFromDate.min = firstDate;
                rangeFromDate.max = lastDate;
            }
            if (rangeToDate) {
                rangeToDate.min = firstDate;
                rangeToDate.max = lastDate;
            }
        }

        // Add listener for the real-time Apply button
        const realtimeSelector = document.getElementById('realtimeSelector');
        if (realtimeSelector) {
            const applyRealTime = realtimeSelector.querySelector('#applyRealTime');
            const intervalInput = realtimeSelector.querySelector('#realtimeInterval');
            
            if (applyRealTime) {
                applyRealTime.addEventListener('click', () => {
                    const newInterval = parseInt(intervalInput.value);
                    if (!isNaN(newInterval) && newInterval > 0) {
                        this.realTimeIntervalDuration = newInterval * 1000;
                        this.startRealTimeUpdates();
                        // Close the dropdown
                        document.getElementById('dateRangeDropdown').classList.add('hidden');
                    }
                });
            }
        }
    }

    calculateTimeRange(events) {
        try {
            // If there are no events, use the default range
            if (!events || events.length === 0) {
                const now = new Date();
                const start = new Date(now);
                start.setHours(0, 0, 0, 0);
                return {
                    start: start.toISOString(),
                    end: now.toISOString()
                };
            }

            // Otherwise, use the events range
            const timestamps = events.flatMap(event => [
                new Date(event.start_time).getTime(),
                new Date(event.end_time).getTime()
            ]);

            // Add validity checks
            const validTimestamps = timestamps.filter(ts => !isNaN(ts));
            
            if (validTimestamps.length === 0) {
                // If there are no valid timestamps, use the default range
                const now = new Date();
                const start = new Date(now);
                start.setHours(0, 0, 0, 0);
                return {
                    start: start.toISOString(),
                    end: now.toISOString()
                };
            }

            return {
                start: new Date(Math.min(...validTimestamps)).toISOString(),
                end: new Date(Math.max(...validTimestamps)).toISOString()
            };
        } catch (error) {
            webLogger.error('Error in calculateTimeRange:', error);
            // Return a default range in case of error
            const now = new Date();
            const start = new Date(now);
            start.setHours(0, 0, 0, 0);
            return {
                start: start.toISOString(),
                end: now.toISOString()
            };
        }
    }

    getDateFormat() {
        const selectedRange = document.querySelector('.range-options a.active');
        if (!selectedRange) return 'HH:mm';

        switch (selectedRange.dataset.range) {
            case 'realtime':
                return 'HH:mm:ss';
            case 'today':
                return 'HH:mm';
            case 'day':
                return 'HH:mm';
            case 'range':
                return 'dd MMM HH:mm';
            default:
                return 'HH:mm';
        }
    }

    async updateStats(stats) {
        webLogger.data('updateStats called with data:', stats);
        
        // Update the event counters if not in real-time mode
        if (!this.isRealTimeMode && stats.events && stats.events.available) {
            webLogger.data('Updating event counters:', stats.events);
            
            const totalEvents = document.querySelector('.event-value[data-type="total"]');
            const totalDuration = document.querySelector('.event-value[data-type="duration"]');
            const longestEvent = document.querySelector('.event-value[data-type="longest"]');
            
            webLogger.data('DOM elements found:', {
                totalEvents: !!totalEvents,
                totalDuration: !!totalDuration,
                longestEvent: !!longestEvent
            });
            
            if (totalEvents) {
                totalEvents.textContent = stats.events.count;
                webLogger.data('Total Events updated:', stats.events.count);
            }
            
            if (totalDuration) {
                const minutes = (stats.events.total_duration / 60).toFixed(1);
                totalDuration.textContent = `${minutes} min`;
                webLogger.data('Total Duration updated:', minutes);
            }
            
            if (longestEvent) {
                const minutes = (stats.events.longest_duration / 60).toFixed(1);
                longestEvent.textContent = `${minutes} min`;
                webLogger.data('Longest Event updated:', minutes);
            }
        }
        
        // Debug: Log all stats values before updating
        webLogger.data('All available stats:', stats);
        
        // Update the statistical values on the page
        document.querySelectorAll('.stat-value').forEach(element => {
            const type = element.dataset.type;
            if (!type) return; // Skip elements without type
            
            webLogger.data(`Processing stat element with type: ${type}`);
            
            try {
                // Map UI element types to stats data property names
                let statKey = type;
                if (!statKey.startsWith('battery_')) {
                    statKey = `battery_${type}`;
                }
                
                webLogger.data(`Looking for stats data with key: ${statKey}`);
                
                if (stats[statKey]) {
                    const statData = stats[statKey];
                    webLogger.data(`Found stat data for ${statKey}:`, statData);
                    
                    // Default to current value, then try avg, then try just the value
                    let value;
                    
                    if (typeof statData === 'object') {
                        if (statKey === 'battery_runtime' || statKey === 'battery_runtime') {
                            // For runtime, always use the avg value
                            value = parseFloat(statData.avg ?? statData.current ?? 0);
                        } else {
                            // For other metrics, prefer current value, then avg, then just value
                            value = parseFloat(statData.current ?? statData.avg ?? statData.value ?? 0);
                        }
                    } else {
                        value = parseFloat(statData);
                    }
                    
                    webLogger.data(`Final value for ${type}: ${value}`);
                    
                    // Format the value based on the type
                    switch(type) {
                        case 'charge':
                        case 'battery_charge':
                            element.textContent = `${value.toFixed(1)}%`;
                            break;
                        case 'runtime':
                        case 'battery_runtime':
                            // Convert seconds to minutes
                            value = Math.round((value / 60) * 10) / 10;
                            element.textContent = `${value} min`;
                            break;
                        case 'voltage':
                        case 'battery_voltage':
                            element.textContent = `${value.toFixed(1)}V`;
                            break;
                        case 'temperature':
                        case 'battery_temperature':
                            element.textContent = `${value.toFixed(1)}°C`;
                            break;
                        default:
                            element.textContent = value.toFixed(1);
                    }
                    
                    // Also update the trend information
                    const trendElement = element.parentElement.querySelector('.stat-trend');
                    if (trendElement && statData.min !== undefined && statData.max !== undefined) {
                        let minFormatted = statData.min.toFixed(1);
                        let maxFormatted = statData.max.toFixed(1);
                        let unit = '';
                        
                        // Add appropriate unit based on the metric type
                        if (type === 'charge' || type === 'battery_charge') {
                            unit = '%';
                        } else if (type === 'runtime' || type === 'battery_runtime') {
                            // Convert seconds to minutes for min/max
                            minFormatted = (statData.min / 60).toFixed(1);
                            maxFormatted = (statData.max / 60).toFixed(1);
                            unit = 'min';
                        } else if (type === 'voltage' || type === 'battery_voltage') {
                            unit = 'V';
                        } else if (type === 'temperature' || type === 'battery_temperature') {
                            unit = '°C';
                        }
                        
                        trendElement.innerHTML = `<i class="fas fa-info-circle"></i> Min: ${minFormatted}${unit} | Max: ${maxFormatted}${unit}`;
                    }
                } else {
                    webLogger.warning(`No data found for ${statKey} in stats object`);
                }
            } catch (error) {
                webLogger.error(`Error updating ${type} stat:`, error);
            }
        });

        // Update battery health section only if not in real-time mode
        if (!this.isRealTimeMode) {
            this.updateBatteryHealthSection(stats);
        }
    }

    // Method to update Battery Health UI (mini widgets and radial chart)
    updateBatteryHealthSection(stats) {
        webLogger.data('Updating battery health section with stats:', stats);
        
        // Retrieve aggregated stats if available
        // First try to get the avg value, then fall back to current value
        const getStatValue = (statKey) => {
            if (!stats[statKey]) return null;
            const stat = stats[statKey];
            // Try avg first, then current, then direct value
            if (typeof stat === 'object') {
                return stat.avg !== null && stat.avg !== undefined ? parseFloat(stat.avg) :
                       stat.current !== null && stat.current !== undefined ? parseFloat(stat.current) : null;
            } else {
                return parseFloat(stat);
            }
        };
        
        const charge = getStatValue('battery_charge');
        const voltage = getStatValue('battery_voltage');
        // Use availableMetrics for nominal voltage (assumed not to change with time range)
        const voltageNominal = (this.availableMetrics && this.availableMetrics.battery_voltage_nominal) ? 
            parseFloat(this.availableMetrics.battery_voltage_nominal) : null;
        const runtime = getStatValue('battery_runtime');
        // Use availableMetrics for battery_runtime_low
        const runtimeLow = (this.availableMetrics && this.availableMetrics.battery_runtime_low) ? 
            parseFloat(this.availableMetrics.battery_runtime_low) : null;

        webLogger.data('Processed health values:', { 
            charge, voltage, voltageNominal, runtime, runtimeLow 
        });

        // Update mini widget values if elements are present
        const chargeEl = document.getElementById('healthChargeValue');
        if (chargeEl && charge !== null) {
            chargeEl.textContent = charge.toFixed(1) + '%';
            webLogger.data('Updated health charge value to', charge.toFixed(1) + '%');
        } else {
            webLogger.warning('Cannot update health charge value:', { 
                elementExists: !!chargeEl, valueExists: charge !== null, value: charge 
            });
        }
        
        const runtimeEl = document.getElementById('healthRuntimeValue');
        if (runtimeEl && runtime !== null) {
            // Convert from seconds to minutes and round to 1 decimal place
            const runtimeMin = Math.floor((runtime / 60) * 10 + 0.5) / 10;
            runtimeEl.textContent = runtimeMin + ' min';
            webLogger.data('Updated health runtime value to', runtimeMin + ' min');
        } else {
            webLogger.warning('Cannot update health runtime value:', { 
                elementExists: !!runtimeEl, valueExists: runtime !== null, value: runtime 
            });
        }
        
        const voltageEl = document.getElementById('healthVoltageValue');
        if (voltageEl && voltage !== null) {
            if (voltageNominal !== null) {
                voltageEl.textContent = voltage.toFixed(1) + 'V / ' + voltageNominal.toFixed(1) + 'V';
            } else {
                voltageEl.textContent = voltage.toFixed(1) + 'V';
            }
            webLogger.data('Updated health voltage value to', voltageEl.textContent);
        } else {
            webLogger.warning('Cannot update health voltage value:', { 
                elementExists: !!voltageEl, valueExists: voltage !== null, value: voltage,
                nominalExists: voltageNominal !== null, nominalValue: voltageNominal
            });
        }

        // Compute weighted battery health similar to backend logic
        const components = [];
        if (voltage !== null && voltageNominal !== null) {
            const voltageHealth = Math.min(100, (voltage / voltageNominal) * 100);
            components.push({ value: voltageHealth, weight: 0.4 });
        }
        if (runtime !== null && runtimeLow !== null && runtimeLow > 0) {
            const runtimeHealth = Math.min(100, (runtime / runtimeLow) * 50);
            components.push({ value: runtimeHealth, weight: 0.4 });
        }
        if (charge !== null) {
            const chargeHealth = charge;
            components.push({ value: chargeHealth, weight: 0.2 });
        }
        
        webLogger.data('Health components:', components);
        
        if (components.length === 0) {
            webLogger.warning('No health components calculated, cannot update health chart');
            return;
        }
        
        const totalWeight = components.reduce((sum, comp) => sum + comp.weight, 0);
        const weightedSum = components.reduce((sum, comp) => sum + comp.value * comp.weight, 0);
        const finalHealth = weightedSum / totalWeight;
        
        webLogger.data('Calculated final health:', finalHealth.toFixed(1) + '%');

        // Update the Battery Health chart
        if (this.batteryHealthChart) {
            this.batteryHealthChart.updateSeries([finalHealth]);
            webLogger.data('Updated battery health chart with value:', finalHealth);
        } else {
            webLogger.warning('Battery health chart not initialized');
        }
    }

    // Add this new helper method
    updateDisplayedRange(text) {
        // Update the text in the range button
        const dateRangeBtn = document.querySelector('.date-range-btn .selected-range');
        if (dateRangeBtn) {
            dateRangeBtn.textContent = text;
        }

        // Update all displayed periods
        document.querySelectorAll('.selected-period').forEach(span => {
            span.textContent = text;
        });
    }

    // New method to load UPS variables
    async loadUPSVariables() {
        try {
            const response = await fetch('/api/upsrw/list');
            const data = await response.json();
            return data.success ? data.variables : [];
        } catch (error) {
            webLogger.error('Error loading UPS variables:', error);
            return [];
        }
    }

    // New method to load UPS commands
    async loadUPSCommands() {
        try {
            const response = await fetch('/api/upscmd/list');
            const data = await response.json();
            return data.success ? data.commands : [];
        } catch (error) {
            webLogger.error('Error loading UPS commands:', error);
            return [];
        }
    }

    // New method to render all widgets
    renderAllWidgets(container, data) {
        if (!container || !data) {
            webLogger.warning('Missing container or data for battery widgets');
            return;
        }
        
        // Clean the container before adding widgets
        container.innerHTML = '';
        
        // Show the temperature widget only if the data is available
        if (data.battery_temperature) {
            const widgets = {
                'battery-temp': {
                    icon: 'temperature-half',
                    label: 'Temperature',
                    value: `${data.battery_temperature}°C`
                }
            };
    
            // Rendering the widgets
            Object.entries(widgets).forEach(([id, config]) => {
                try {
                    this.renderWidget(container, id, config);
                } catch (error) {
                    webLogger.error(`Error rendering widget ${id}:`, error);
                }
            });
        } else {
            webLogger.data('Temperature data not available for this UPS');
        }
    }

    // Add these new methods for real-time
    startRealTimeUpdates() {
        // Set flags for detecting first real-time data points
        this.isFirstRealTimeUpdate = true;
        this.isFirstTemperatureUpdate = true;
        
        // Set flag to indicate we're in realtime mode
        this.isRealTimeMode = true;
        
        // Record start time for the 1-hour persistence if not already set
        if (!this.realtimeStartTime) {
            this.realtimeStartTime = Date.now();
        }
        
        // Clear any existing intervals
        if (this.realTimeInterval) {
            clearInterval(this.realTimeInterval);
            this.realTimeInterval = null;
        }
        
        if (this.realtimeCheckInterval) {
            clearInterval(this.realtimeCheckInterval);
            this.realtimeCheckInterval = null;
        }

        // Hide Battery Health and Battery Events sections in real-time mode
        const healthSection = document.querySelector('.health');
        const eventsSection = document.querySelector('.events');
        
        if (healthSection) {
            healthSection.classList.add('hidden');
            webLogger.data('Battery Health section hidden in real-time mode');
        }
        
        if (eventsSection) {
            eventsSection.classList.add('hidden');
            webLogger.data('Battery Events section hidden in real-time mode');
        }

        // Initialize charts with Chart.js for realtime
        this.initializeRealtimeBatteryChart();
        
        // Set the interval to update data using WebSocket
        this.realTimeInterval = setInterval(() => {
            if (this.isRealTimeMode && this.lastWebSocketData) {
                // Use the WebSocket data that's already stored
                this.updateWidgetValues(this.lastWebSocketData);
                this.updateStats(this.lastWebSocketData);
            }
        }, this.realTimeIntervalDuration);
        
        // Set up a check to see if we have sufficient data
        this.realtimeCheckInterval = setInterval(() => {
            // Only check if we've been in realtime mode for more than 1 hour
            const currentTime = Date.now();
            const elapsedTime = currentTime - this.realtimeStartTime;
            const hoursSinceStart = (elapsedTime / (1000 * 60 * 60)).toFixed(1);
            
            webLogger.data(`Realtime mode has been active for ${hoursSinceStart} hours`);
            
            if (elapsedTime >= this.realtimeDuration) {
                webLogger.data('Realtime mode 1-hour duration reached, checking data availability');
                this.checkForOneHourData().then(hasData => {
                    if (hasData) {
                        webLogger.data('Battery data now has sufficient data (1+ hour)');
                        // Don't show notification that data collection is complete
                    } else {
                        webLogger.data('Battery data still lacks sufficient data');
                        // Don't show notification about still collecting data
                    }
                });
            }
        }, 5 * 60 * 1000); // Check every 5 minutes

        // Update UI
        this.updateDisplayedRange('Real Time');
    }

    stopRealtimeUpdates() {
        if (this.realTimeInterval) {
            clearInterval(this.realTimeInterval);
            this.realTimeInterval = null;
        }
        
        // Also clear the realtime check interval
        if (this.realtimeCheckInterval) {
            clearInterval(this.realtimeCheckInterval);
            this.realtimeCheckInterval = null;
        }
        
        // Reset the mode and update flags
        this.isRealTimeMode = false;
        this.isFirstRealTimeUpdate = true;
        this.isFirstTemperatureUpdate = true;
        
        // Show Battery Health and Battery Events sections when exiting real-time mode
        const healthSection = document.querySelector('.health');
        const eventsSection = document.querySelector('.events');
        
        if (healthSection) {
            healthSection.classList.remove('hidden');
            webLogger.data('Battery Health section shown when exiting real-time mode');
        }
        
        if (eventsSection) {
            eventsSection.classList.remove('hidden');
            webLogger.data('Battery Events section shown when exiting real-time mode');
        }
        
        // Destroy the Chart.js charts if they exist
        if (this.combinedChart && this.combinedChart.destroy) {
            this.combinedChart.destroy();
            this.combinedChart = null;
        }
        
        if (this.temperatureChart && this.temperatureChart.destroy) {
            this.temperatureChart.destroy();
            this.temperatureChart = null;
        }
        
        // Clean the containers
        const combinedChartContainer = document.querySelector('#combinedBatteryChart');
        if (combinedChartContainer) combinedChartContainer.innerHTML = '';
        
        const temperatureChartContainer = document.querySelector('#temperatureChart');
        if (temperatureChartContainer) temperatureChartContainer.innerHTML = '';
        
        // Reinitialize the charts with ApexCharts
        this.initCharts();
    }

    initializeRealtimeBatteryChart() {
        // Get the container for the chart
        const container = document.querySelector('#combinedBatteryChart');
        if (!container) {
            console.error('Container #combinedBatteryChart not found');
            return;
        }
        
        // If an ApexCharts graph already exists, destroy it
        if (this.combinedChart && typeof this.combinedChart.destroy === 'function') {
            this.combinedChart.destroy();
        }
        
        // Remove the ApexCharts element and create a new canvas
        container.innerHTML = '';
        const canvas = document.createElement('canvas');
        canvas.id = 'realtimeBatteryChart';
        
        // Explicitly set the canvas height to match the ApexCharts height
        canvas.style.height = '450px'; // Same height defined in ApexCharts
        canvas.style.width = '100%';   // Width at 100% of container
        
        container.appendChild(canvas);
        
        const ctx = canvas.getContext('2d');
        
        // Determine which battery metrics are available
        const hasCharge = this.availableMetrics && this.availableMetrics.hasOwnProperty('battery_charge');
        const hasRuntime = this.availableMetrics && this.availableMetrics.hasOwnProperty('battery_runtime');
        const hasVoltage = this.availableMetrics && this.availableMetrics.hasOwnProperty('battery_voltage');
        
        // Generate synthetic data to initialize the chart
        webLogger.console('Initializing battery chart with synthetic data before real-time data');
        const syntheticData = this.generateSyntheticBatteryData(Date.now());
        
        // Initialize data buffers with synthetic data
        this.chargeDataBuffer = syntheticData.charge.map(point => ({ time: point.x, value: point.y }));
        this.runtimeDataBuffer = syntheticData.runtime.map(point => ({ time: point.x, value: point.y }));
        this.voltageDataBuffer = syntheticData.voltage.map(point => ({ time: point.x, value: point.y }));
        this.bufferSize = 15; // For better smoothing
        
        // Create gradients for filling under the lines
        const chargeGradient = ctx.createLinearGradient(0, 0, 0, 300);
        chargeGradient.addColorStop(0, 'rgba(46, 147, 250, 0.3)');
        chargeGradient.addColorStop(1, 'rgba(46, 147, 250, 0.0)');
        
        const runtimeGradient = ctx.createLinearGradient(0, 0, 0, 300);
        runtimeGradient.addColorStop(0, 'rgba(102, 218, 38, 0.2)');
        runtimeGradient.addColorStop(1, 'rgba(102, 218, 38, 0.0)');
        
        const voltageGradient = ctx.createLinearGradient(0, 0, 0, 300);
        voltageGradient.addColorStop(0, 'rgba(255, 152, 0, 0.2)');
        voltageGradient.addColorStop(1, 'rgba(255, 152, 0, 0.0)');
        
        // Chart.js configuration
        const chartConfig = {
            type: 'line',
            data: {
                datasets: [
                    {
                        label: 'Battery Level',
                        backgroundColor: chargeGradient,
                        borderColor: '#2E93fA',
                        borderWidth: 2.5,
                        data: syntheticData.charge,
                        pointRadius: 0,
                        tension: 0.4,
                        fill: true,
                        cubicInterpolationMode: 'monotone',
                        yAxisID: 'y'
                    },
                    {
                        label: 'Runtime',
                        backgroundColor: runtimeGradient,
                        borderColor: '#66DA26',
                        borderWidth: 2.5,
                        data: syntheticData.runtime,
                        pointRadius: 0,
                        tension: 0.4,
                        fill: true,
                        cubicInterpolationMode: 'monotone',
                        yAxisID: 'y1'
                    },
                    {
                        label: 'Voltage',
                        backgroundColor: voltageGradient,
                        borderColor: '#FF9800',
                        borderWidth: 2.5,
                        data: syntheticData.voltage,
                        pointRadius: 0,
                        tension: 0.4,
                        fill: true,
                        cubicInterpolationMode: 'monotone',
                        yAxisID: 'y2'
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    streaming: {
                        duration: 60000, // Show only 60 seconds
                        refresh: 1000,
                        delay: 1000,
                        onRefresh: this.onBatteryChartRefresh.bind(this)
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
                        max: 100,
                        position: 'left',
                        display: false,  // Completely hide Y axis
                        grid: {
                            display: false
                        }
                    },
                    y1: {
                        position: 'right',
                        display: false,  // Completely hide Y1 axis
                        grid: {
                            display: false
                        }
                    },
                    y2: {
                        position: 'right',
                        display: false,  // Completely hide Y2 axis
                        grid: {
                            display: false
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
                },
                layout: {
                    padding: {
                        left: 10,
                        right: 10,
                        top: 20,
                        bottom: 20
                    }
                }
            }
        };
        
        // Create the Chart.js chart
        this.combinedChart = new Chart(ctx, chartConfig);
        
        // Also initialize a new chart for temperature if available
        if (this.availableMetrics && this.availableMetrics.battery_temperature) {
            this.initializeRealtimeTemperatureChart();
        }
        
        webLogger.console('Realtime Chart.js initialized for battery analysis');
    }

    initializeRealtimeTemperatureChart() {
        const container = document.querySelector('#temperatureChart');
        if (!container) {
            console.error('Container #temperatureChart not found');
            return;
        }
        
        // If an ApexCharts graph already exists, destroy it
        if (this.temperatureChart && typeof this.temperatureChart.destroy === 'function') {
            this.temperatureChart.destroy();
        }
        
        // Remove the ApexCharts element and create a new canvas
        container.innerHTML = '';
        const canvas = document.createElement('canvas');
        canvas.id = 'realtimeTemperatureChart';
        
        // Explicitly set the canvas height to match the ApexCharts height
        canvas.style.height = '350px'; // Same height defined in ApexCharts for the temperature chart
        canvas.style.width = '100%';   // Width at 100% of container
        
        container.appendChild(canvas);
        
        const ctx = canvas.getContext('2d');
        
        // Generate synthetic data for initial display
        webLogger.console('Initializing temperature chart with synthetic data before real-time data');
        const syntheticTempData = this.generateSyntheticTemperatureData(Date.now());
        
        // Initialize the data buffer with synthetic data
        this.temperatureDataBuffer = syntheticTempData.map(point => ({ time: point.x, value: point.y }));
        
        // Create a gradient for filling under the line
        const tempGradient = ctx.createLinearGradient(0, 0, 0, 300);
        tempGradient.addColorStop(0, 'rgba(255, 99, 132, 0.3)');
        tempGradient.addColorStop(1, 'rgba(255, 99, 132, 0.0)');
        
        // Chart.js configuration
        const chartConfig = {
            type: 'line',
            data: {
                datasets: [
                    {
                        label: 'Temperature',
                        backgroundColor: tempGradient,
                        borderColor: '#FF6384',
                        borderWidth: 2.5,
                        data: syntheticTempData,
                        pointRadius: 0,
                        tension: 0.4,
                        fill: true,
                        cubicInterpolationMode: 'monotone'
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    streaming: {
                        duration: 60000, // Show only 60 seconds
                        refresh: 1000,
                        delay: 1000,
                        onRefresh: this.onTemperatureChartRefresh.bind(this)
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
                        min: 15,
                        max: 40,
                        display: false,  // Completely hide Y axis
                        grid: {
                            display: false
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
        
        // Create the Chart.js chart
        this.temperatureChart = new Chart(ctx, chartConfig);
        
        webLogger.console('Realtime Chart.js initialized for temperature');
    }

    onBatteryChartRefresh(chart) {
        // If we have WebSocket data, use it
        if (this.lastWebSocketData) {
            // Add debug logging for first real data
            if (this.isFirstRealTimeUpdate) {
                webLogger.console('Received first WebSocket data! Transitioning from synthetic to real data on battery chart.');
                this.isFirstRealTimeUpdate = false;
            }
            
            const data = this.lastWebSocketData;
            const now = Date.now();
            
            // Extract battery values
            const charge = parseFloat(data.battery_charge || 0);
            const runtime = parseFloat(data.battery_runtime || 0) / 60; // Convert to minutes
            const voltage = parseFloat(data.battery_voltage || 0);
            
            // Add new points to buffers
            this.chargeDataBuffer.push({
                time: now,
                value: charge
            });
            
            this.runtimeDataBuffer.push({
                time: now,
                value: runtime
            });
            
            this.voltageDataBuffer.push({
                time: now,
                value: voltage
            });
            
            // Keep buffers at the correct size
            if (this.chargeDataBuffer.length > this.bufferSize) {
                this.chargeDataBuffer.shift();
            }
            
            if (this.runtimeDataBuffer.length > this.bufferSize) {
                this.runtimeDataBuffer.shift();
            }
            
            if (this.voltageDataBuffer.length > this.bufferSize) {
                this.voltageDataBuffer.shift();
            }
            
            // Calculate smoothed values
            const smoothedCharge = this.calculateSmoothedValueSimple(this.chargeDataBuffer);
            const smoothedRuntime = this.calculateSmoothedValueSimple(this.runtimeDataBuffer);
            const smoothedVoltage = this.calculateSmoothedValueSimple(this.voltageDataBuffer);
            
            // Update datasets
            chart.data.datasets[0].data.push({
                x: now,
                y: smoothedCharge
            });
            
            chart.data.datasets[1].data.push({
                x: now,
                y: smoothedRuntime
            });
            
            chart.data.datasets[2].data.push({
                x: now,
                y: smoothedVoltage
            });
            
            chart.update('quiet');
            
            // Return a resolved promise
            return Promise.resolve();
        } 
        // If WebSocket manager exists but no data yet, request it
        else if (this.webSocketManager) {
            this.webSocketManager.requestCacheData();
            // Return a resolved promise
            return Promise.resolve();
        }
        // Return a resolved promise to avoid errors
        return Promise.resolve();
    }

    onTemperatureChartRefresh(chart) {
        // If we have WebSocket data, use it
        if (this.lastWebSocketData) {
            const data = this.lastWebSocketData;
            
            // If there is no temperature data, exit
            if (!data.battery_temperature) return Promise.resolve();
            
            // Add debug logging for first temperature data
            if (this.isFirstTemperatureUpdate) {
                webLogger.data("Transitioning from synthetic to real temperature data");
                this.isFirstTemperatureUpdate = false;
            }
            
            const now = Date.now();
            const temperature = parseFloat(data.battery_temperature || 0);
            
            // Add the new point to the buffer
            this.temperatureDataBuffer.push({
                time: now,
                value: temperature
            });
            
            // Keep the buffer at the correct size
            if (this.temperatureDataBuffer.length > this.bufferSize) {
                this.temperatureDataBuffer.shift();
            }
            
            // Calculate the smoothed value
            const smoothedTemp = this.calculateSmoothedValueSimple(this.temperatureDataBuffer);
            
            // Add the smoothed value to the dataset
            chart.data.datasets[0].data.push({
                x: now,
                y: smoothedTemp
            });
            
            chart.update('quiet');
            
            // Return a resolved promise
            return Promise.resolve();
        } 
        // If WebSocket manager exists but no data yet, request it
        else if (this.webSocketManager) {
            this.webSocketManager.requestCacheData();
            // Return a resolved promise
            return Promise.resolve();
        }
        // Return a resolved promise to avoid errors
        return Promise.resolve();
    }

    // Method to calculate the smoothed value
    calculateSmoothedValueSimple(buffer) {
        if (buffer.length === 0) return 0;
        
        // Use a smoothing algorithm with weights
        const weights = [];
        for (let i = 0; i < buffer.length; i++) {
            // Formula for giving more weight to recent values
            weights.push(Math.pow(1.2, i));
        }
        
        const weightSum = weights.reduce((a, b) => a + b, 0);
        
        // Calculate the weighted average
        let smoothedValue = 0;
        for (let i = 0; i < buffer.length; i++) {
            smoothedValue += buffer[i].value * weights[i];
        }
        
        return smoothedValue / weightSum;
    }

    // Method to update widget values from cache in real time
    updateWidgetValues(data) {
        document.querySelectorAll('.stat-value').forEach(element => {
            const type = element.dataset.type;
            if (!type || !data[type]) return;

            let value = data[type];
            let displayValue;

            // Format the value based on the type
            switch(type) {
                case 'battery_charge':
                case 'charge':
                    displayValue = parseFloat(value).toFixed(1) + '%';
                    break;
                case 'battery_runtime':
                case 'runtime':
                    value = Math.round((value / 60) * 10) / 10;
                    displayValue = value + ' min';
                    break;
                case 'battery_voltage':
                case 'voltage':
                    displayValue = parseFloat(value).toFixed(1) + 'V';
                    break;
                case 'battery_temperature':
                case 'temperature':
                    displayValue = parseFloat(value).toFixed(1) + '°C';
                    break;
                default:
                    displayValue = value.toString();
            }

            element.textContent = displayValue;
        });

        // Update also the info-value values
        document.querySelectorAll('.info-value').forEach(element => {
            const type = element.dataset.type;
            if (!type || !data[type]) return;
            
            let value = data[type];
            
            if (type === 'status') {
                element.textContent = this.formatUPSStatus(value);
            } else if (type === 'type') {
                element.textContent = this.formatBatteryType(value);
            } else if (type === 'temperature') {
                element.textContent = parseFloat(value).toFixed(1) + '°C';
            } else if (type === 'health') {
                element.textContent = parseFloat(value).toFixed(0) + '%';
            }
        });
    }

    // Add this new helper method
    updateEventsList(eventsList) {
        // Skip updating events list if in real-time mode
        if (this.isRealTimeMode) {
            webLogger.data('Skipping events list update in real-time mode');
            return;
        }
        
        const eventsContainer = document.getElementById('batteryEventsChart');
        if (!eventsContainer) return;

        // Clear the container content
        eventsContainer.innerHTML = '';

        if (!eventsList || !eventsList.length) {
            eventsContainer.innerHTML = '<p>No events available</p>';
            return;
        }

        // Create a list element to display events similar to events_page.js
        const ul = document.createElement('ul');
        ul.className = 'events-list';

        eventsList.forEach(event => {
            // DEBUG: print the event object to check the content
            webLogger.console("DEBUG: Received event:", event);

            // Use the start_time field for the start date
            const startTimeStr = event.start_time;
            let formattedStart = "Invalid Date";
            if (startTimeStr) {
                const dtStart = new Date(startTimeStr);
                if (!isNaN(dtStart.getTime())) {
                    formattedStart = dtStart.toLocaleString([], {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                        timeZone: this._timezone
                    });
                }
            }
            webLogger.console("DEBUG: Formatted start =", formattedStart);

            // If available, format also end_time
            let formattedEnd = "";
            if (event.end_time) {
                const dtEnd = new Date(event.end_time);
                if (!isNaN(dtEnd.getTime())) {
                    formattedEnd = dtEnd.toLocaleString([], {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                        timeZone: this._timezone
                    });
                }
            }
            webLogger.console("DEBUG: Formatted end =", formattedEnd);

            // Map the 'type' field to a readable description
            let description = "";
            switch (event.type) {
                case "ONBATT":
                    description = formattedEnd ? "⚡ Switch to battery" : "⚡ On battery";
                    break;
                case "ONLINE":
                    description = "🔌 Back to Network";
                    break;
                case "LOWBATT":
                    description = "🪫 Battery Discharge";
                    break;
                default:
                    description = event.type || "Event";
            }
            webLogger.console("DEBUG: Description =", description);

            // Build the time display: if end_time exists show "start - end", otherwise only start
            const timeDisplay = formattedEnd ? `${formattedStart} - ${formattedEnd}` : formattedStart;

            const li = document.createElement('li');
            li.className = 'event-item';
            li.innerHTML = `<strong>${timeDisplay}</strong> - ${description}`;
            ul.appendChild(li);
        });

        eventsContainer.appendChild(ul);
        webLogger.console("DEBUG: Events list updated");
    }

    // New method to reset all data
    resetAllData() {
        // Reset the charts
        this.resetCharts();
        
        // Reset the widgets
        const widgetsContainer = document.getElementById('batteryWidgetsContainer');
        if (widgetsContainer) {
            widgetsContainer.innerHTML = '';
        }
        
        // Reset the statistics
        const statValues = document.querySelectorAll('.stat-value');
        statValues.forEach(stat => {
            stat.textContent = '0';
        });
        
        // Reset the health section
        if (this.batteryHealthChart) {
            this.batteryHealthChart.updateSeries([0]);
        }
    }

    renderWidget(container, id, config) {
        const widgetHtml = `
            <div class="stat_card" id="${id}">
                <div class="stat-icon">
                    <i class="fas fa-${config.icon}"></i>
                </div>
                <div class="stat-content">
                    <div class="stat-header">
                        <div class="stat-title-row">
                            <span class="stat-label">${config.label}</span>
                        </div>
                    </div>
                    <span class="stat-value">${config.value}</span>
                    ${config.warning ? `
                        <span class="stat-warning">
                            <i class="fas fa-triangle-exclamation"></i>
                            Warning: ${config.warning}
                        </span>
                    ` : ''}
                </div>
            </div>
        `;

        // Add the widget to the container
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = widgetHtml.trim();
        const widgetElement = tempDiv.firstChild;
        container.appendChild(widgetElement);
    }

    formatChartDate(timestamp) {
        // The timestamp is already in milliseconds and local timezone is handled by the chart
        // Just format it with the configured timezone
        return new Date(timestamp).toLocaleString([], {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            timeZone: this._timezone,
            hour12: false
        });
    }

    formatTooltipDate(val) {
        // Format with timezone from configured settings
        return new Date(val).toLocaleString([], {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            timeZone: this._timezone,
            hour12: false
        });
    }

    async checkHistoricalData() {
        try {
            // Use proper parameters to check data specifically for today with midnight start
            const now = new Date();
            
            // Get timezone offset for consistent client-server communication
            const tzOffset = now.getTimezoneOffset();
            const tzOffsetHours = Math.abs(Math.floor(tzOffset / 60));
            const tzOffsetMinutes = Math.abs(tzOffset % 60);
            const tzOffsetSign = tzOffset <= 0 ? '+' : '-';
            const tzOffsetFormatted = `${tzOffsetSign}${tzOffsetHours.toString().padStart(2, '0')}${tzOffsetMinutes.toString().padStart(2, '0')}`;
            
            // Create parameters with explicit today_mode flag
            const params = new URLSearchParams();
            params.append('period', 'day');
            params.append('today_mode', 'true');
            
            // Use fromTime with timezone offset to force midnight
            params.append('from_time', `00:00${tzOffsetFormatted}`);
            
            webLogger.data('🔍 Checking historical data with today_mode=true');
            
            // Check data using explicit today_mode
            const response = await fetch(`/api/battery/history?${params}`);
            const data = await response.json();
            
            if (!data.success || !data.data) return false;
            
            // More strict requirement: require at least 30 data points (matching checkForOneHourData)
            const minRequiredPoints = 30;
            
            // Check if the main data has enough points
            const requiredMetrics = ['battery_charge', 'battery_runtime'];
            const hasEnoughData = requiredMetrics.every(metric => {
                const metricData = data.data[metric];
                return Array.isArray(metricData) && metricData.length >= minRequiredPoints;
            });

            webLogger.data(`Historical data check - Has enough data: ${hasEnoughData}`);
            webLogger.data(`Points available - Charge: ${data.data.battery_charge?.length || 0}, Runtime: ${data.data.battery_runtime?.length || 0}`);
            
            // Debug: log first and last points to verify time range
            if (data.data.battery_charge && data.data.battery_charge.length > 0) {
                const first = data.data.battery_charge[0];
                const last = data.data.battery_charge[data.data.battery_charge.length - 1];
                webLogger.data('First data point timestamp:', first.timestamp);
                webLogger.data('Last data point timestamp:', last.timestamp);
            }
            
            return hasEnoughData;
        } catch (error) {
            webLogger.error('Error checking historical data:', error);
            return false;
        }
    }

    showError(message) {
        webLogger.error(`Error: ${message}`);
        // Display error to user via notification
        this.showNotification(message, 'error');
    }

    showNotification(message, type = 'info') {
        // Use the window.notify function from notifications.js
        window.notify(message, type, 5000);
    }

    renderBatteryWidgets(container) {
        const batteryVariables = [];
    
        for (const [key, value] of Object.entries(this.availableMetrics)) {
            // Skip the temperature widget if there is no data
            if (key === 'battery_temperature' && !value) continue;
            
            let unit = '';
            if (key.includes('voltage')) {
                unit = 'V';
            } else if (key.includes('charge')) {
                unit = '%';
            } else if (key.includes('runtime')) {
                unit = 'min';
            } else if (key.includes('temperature')) {
                unit = '°C';
            }

            let icon = 'fa-battery-half';
            if (key.includes('voltage')) icon = 'fa-bolt';
            if (key.includes('runtime')) icon = 'fa-clock';
            if (key.includes('temperature')) icon = 'fa-thermometer-half';

            // Create widget configuration
            const widgetConfig = {
                id: `battery-${key}`,
                icon: icon,
                label: this.formatMetricName(key),
                value: `${value}${unit}`,
                warning: this.getMetricWarning(key, value)
            };

            // Add to battery variables array
            batteryVariables.push(widgetConfig);

            // Render the widget
            this.renderWidget(container, widgetConfig.id, widgetConfig);
        }

        return batteryVariables;
    }

    // Helper method to format metric names
    formatMetricName(key) {
        return key
            .replace('battery_', '')
            .split('_')
            .map(word => word.charAt(0).toUpperCase() + word.slice(1))
            .join(' ');
    }

    // Helper method to get metric warnings
    getMetricWarning(key, value) {
        const warnings = {
            battery_charge: (val) => val < 20 ? 'Low battery level' : null,
            battery_voltage: (val) => val < 11 ? 'Critical voltage' : null,
            battery_temperature: (val) => val > 40 ? 'High temperature' : null,
            battery_runtime: (val) => val < 18000 ? 'Low runtime' : null  // 18000 seconds = 300 minutes = 5 hours
        };

        return warnings[key] ? warnings[key](value) : null;
    }

    updateChartsRealTime(data) {
        if (!data) return;
        
        const timestamp = new Date().getTime();
        
        if (this.combinedChart) {
            const newData = [
                {
                    name: 'Battery Level',
                    data: data.battery_charge ? [[timestamp, parseFloat(data.battery_charge)]] : []
                },
                {
                    name: 'Runtime',
                    data: data.battery_runtime ? [[timestamp, parseFloat(data.battery_runtime) / 60]] : []
                },
                {
                    name: 'Voltage',
                    data: data.battery_voltage ? [[timestamp, parseFloat(data.battery_voltage)]] : []
                }
            ];
            
            try {
                this.combinedChart.appendData(newData);
            } catch (error) {
                webLogger.error('Error updating charts:', error);
                // In case of error, try to reset and reinitialize
                this.resetCharts();
                this.initCharts();
            }
        }
        
        if (this.temperatureChart && data.battery_temperature !== undefined) {
            try {
                this.temperatureChart.appendData([{
                    name: 'Temperature',
                    data: [[timestamp, parseFloat(data.battery_temperature)]]
                }]);
            } catch (error) {
                webLogger.error('Error updating temperature chart:', error);
            }
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

    resetCharts() {
        // Reset the combined chart
        if (this.combinedChart) {
            this.combinedChart.updateSeries([{
                name: 'Battery Charge',
                data: []
            }, {
                name: 'Runtime',
                data: []
            }, {
                name: 'Voltage',
                data: []
            }]);
        }
        
        // Reset the temperature chart
        if (this.temperatureChart) {
            this.temperatureChart.updateSeries([{
                name: 'Temperature',
                data: []
            }]);
        }
        
        // Reset the battery events chart
        if (this.batteryEventsChart) {
            this.batteryEventsChart.updateSeries([{
                name: 'Events',
                data: []
            }]);
        }
        
        // Reset the battery health chart
        if (this.batteryHealthChart) {
            this.batteryHealthChart.updateSeries([{
                name: 'Health',
                data: [0]
            }]);
        }
    }

    // Add a helper method to verify today data
    verifyTodayData(data) {
        if (!data) {
            webLogger.warning('No data to verify');
            return false;
        }
        
        // Check the battery_charge data as it's most likely to be present
        if (!data.battery_charge || !Array.isArray(data.battery_charge) || data.battery_charge.length === 0) {
            webLogger.warning('No battery_charge data available');
            return false;
        }
        
        // Get the first timestamp
        const firstPoint = data.battery_charge[0];
        const firstTimestamp = firstPoint.timestamp;
        
        // Parse the timestamp
        const date = new Date(firstTimestamp);
        const today = new Date();
        
        // Check if the first timestamp is from today
        const isSameDay = date.getDate() === today.getDate() && 
                          date.getMonth() === today.getMonth() &&
                          date.getFullYear() === today.getFullYear();
        
        return isSameDay;
    }

    /**
     * Check if there is at least one hour of historical battery data
     * This is used to determine if we should show today data or enforce realtime mode
     */
    async checkForOneHourData() {
        try {
            webLogger.data('Checking for one hour of historical battery data');
            
            // Use the new API endpoint to check for hour data
            const response = await fetch('/api/battery/has_hour_data');
            const data = await response.json();
            
            webLogger.data(`API returned has_data: ${data.has_data}`);
            
            return data.has_data;
        } catch (error) {
            webLogger.error('Error checking for one hour of battery data:', error);
            return false;
        }
    }
    
    /**
     * Override the enforced real-time mode
     * @returns {boolean} True if the mode was overridden, false if it was not enforced
     */
    overrideEnforcedRealtimeMode() {
        if (this.enforceRealtimeMode) {
            this.enforceRealtimeMode = false;
            // Don't show notification about override
            return true;
        }
        return false;
    }

    /**
     * Generate synthetic data to fill the battery chart initially
     * @param {Date} endTime - The end time for the synthetic data (typically now)
     * @returns {Object} Object containing battery charge, runtime, and voltage synthetic data arrays
     */
    generateSyntheticBatteryData(endTime) {
        const chargeData = [];
        const runtimeData = [];
        const voltageData = [];
        
        // Use the most recent real data from WebSocket if available, or metrics values
        let baseChargeValue = 50; // Default charge value in percentage
        let baseRuntimeValue = 60; // Default runtime value in minutes
        let baseVoltageValue = 24; // Default voltage value
        
        // Try to get values from availableMetrics
        if (this.availableMetrics) {
            if (this.availableMetrics.battery_charge !== undefined) {
                baseChargeValue = Math.max(parseFloat(this.availableMetrics.battery_charge), 20);
            }
            
            if (this.availableMetrics.battery_runtime !== undefined) {
                // Convert from seconds to minutes
                baseRuntimeValue = Math.max(parseFloat(this.availableMetrics.battery_runtime) / 60, 10);
            }
            
            if (this.availableMetrics.battery_voltage !== undefined) {
                baseVoltageValue = Math.max(parseFloat(this.availableMetrics.battery_voltage), 12);
            }
        }
        
        // If we have real-time data from WebSocket, use it instead
        if (this.lastWebSocketData) {
            const data = this.lastWebSocketData;
            
            if (data.battery_charge !== undefined) {
                baseChargeValue = Math.max(parseFloat(data.battery_charge), 20);
            }
            
            if (data.battery_runtime !== undefined) {
                // Convert from seconds to minutes
                baseRuntimeValue = Math.max(parseFloat(data.battery_runtime) / 60, 10);
            }
            
            if (data.battery_voltage !== undefined) {
                baseVoltageValue = Math.max(parseFloat(data.battery_voltage), 12);
            }
            
            webLogger.data(`Using WebSocket data for synthetic initialization: Charge=${baseChargeValue}%, Runtime=${baseRuntimeValue}min, Voltage=${baseVoltageValue}V`);
        } else {
            webLogger.data(`Using metrics values for synthetic initialization: Charge=${baseChargeValue}%, Runtime=${baseRuntimeValue}min, Voltage=${baseVoltageValue}V`);
        }
        
        // Generate 30 points over 60 seconds (1 point every 2 seconds) for smooth appearance
        for (let i = 0; i < 30; i++) {
            // Calculate time points to fill exactly 60 seconds back from endTime
            const time = new Date(endTime - (60 * 1000) + (i * 2000)); // One point every 2 seconds
            
            // Add small random variations to create natural-looking lines
            const chargeVariation = baseChargeValue * (Math.random() * 0.02 - 0.01); // ±1% variation
            const runtimeVariation = baseRuntimeValue * (Math.random() * 0.04 - 0.02); // ±2% variation
            const voltageVariation = baseVoltageValue * (Math.random() * 0.01 - 0.005); // ±0.5% variation
            
            // Calculate the values with variation
            const chargeValue = Math.min(Math.max(baseChargeValue + chargeVariation, 0), 100); // Keep between 0-100%
            const runtimeValue = Math.max(baseRuntimeValue + runtimeVariation, 1);
            const voltageValue = Math.max(baseVoltageValue + voltageVariation, 1);
            
            // Add data points
            chargeData.push({
                x: time.getTime(),
                y: chargeValue
            });
            
            runtimeData.push({
                x: time.getTime(),
                y: runtimeValue
            });
            
            voltageData.push({
                x: time.getTime(),
                y: voltageValue
            });
        }
        
        return {
            charge: chargeData,
            runtime: runtimeData,
            voltage: voltageData
        };
    }

    /**
     * Generate synthetic temperature data to fill the temperature chart initially
     * @param {Date} endTime - The end time for the synthetic data (typically now)
     * @returns {Array} Array of temperature data points
     */
    generateSyntheticTemperatureData(endTime) {
        const temperatureData = [];
        
        // Use the most recent real data from WebSocket if available, or metrics values
        let baseTemperatureValue = 25; // Default temperature value in Celsius
        
        // Try to get values from availableMetrics
        if (this.availableMetrics && this.availableMetrics.battery_temperature !== undefined) {
            baseTemperatureValue = Math.max(parseFloat(this.availableMetrics.battery_temperature), 20);
            webLogger.data(`Using metrics temperature for synthetic initialization: ${baseTemperatureValue}°C`);
        }
        
        // If we have real-time data from WebSocket, use it instead
        if (this.lastWebSocketData && this.lastWebSocketData.battery_temperature !== undefined) {
            baseTemperatureValue = Math.max(parseFloat(this.lastWebSocketData.battery_temperature), 20);
            webLogger.data(`Using WebSocket temperature for synthetic initialization: ${baseTemperatureValue}°C`);
        }
        
        // Generate 30 points over 60 seconds (1 point every 2 seconds) for smooth appearance
        for (let i = 0; i < 30; i++) {
            // Calculate time points to fill exactly 60 seconds back from endTime
            const time = new Date(endTime - (60 * 1000) + (i * 2000)); // One point every 2 seconds
            
            // Add small random variations to create natural-looking lines
            const tempVariation = (Math.random() * 0.6 - 0.3); // ±0.3°C variation
            
            // Calculate the values with variation
            const tempValue = Math.max(baseTemperatureValue + tempVariation, 15);
            
            // Add data points
            temperatureData.push({
                x: time.getTime(),
                y: tempValue
            });
        }
        
        return temperatureData;
    }
}

// Add the voltage controller
class BatteryVoltageController {
    constructor(chart) {
        this.hasVoltage = false;
        this.hasNominalVoltage = false;
        this.voltage = 0;
        this.nominalVoltage = 0;
        this.widget = document.querySelector('[data-type="voltage"]')?.closest('.stat_card');
        this.chart = chart;
    }

    init(data) {
        this.checkAvailability(data);
        this.updateWidget();
        this.updateChart();
    }

    update(data) {
        this.checkAvailability(data);
        this.updateWidget();
        this.updateChart();
    }

    checkAvailability(data) {
        // Check if the values are available
        this.hasVoltage = data.hasOwnProperty('battery_voltage') && data.battery_voltage !== null;
        this.hasNominalVoltage = data.hasOwnProperty('battery_voltage_nominal') && data.battery_voltage_nominal !== null;
        
        // Update the values if available
        if (this.hasVoltage) {
            this.voltage = parseFloat(data.battery_voltage);
        }
        if (this.hasNominalVoltage) {
            this.nominalVoltage = parseFloat(data.battery_voltage_nominal);
        }
    }

    updateWidget() {
        if (!this.widget) return;

        if (this.hasVoltage) {
            this.widget.style.display = 'flex';
            const valueEl = this.widget.querySelector('.stat-value');
            if (valueEl) {
                valueEl.textContent = `${this.voltage.toFixed(1)}V`;
            }

            const trendEl = this.widget.querySelector('.stat-trend');
            if (trendEl && this.hasNominalVoltage) {
                trendEl.innerHTML = `
                    <i class="fas fa-info-circle"></i>
                    Nominal: ${this.nominalVoltage.toFixed(1)}V
                `;
            }
        } else {
            this.widget.style.display = 'none';
        }
    }

    updateChart() {
        if (!this.chart) return;

        const timestamp = new Date().getTime();
        const voltageData = this.hasVoltage ? [{
            x: timestamp,
            y: this.voltage
        }] : [];

        // Update only the voltage series while keeping the others
        const currentSeries = this.chart.w.config.series;
        this.chart.updateSeries([
            currentSeries[0], // battery level
            currentSeries[1], // runtime
            { 
                name: 'Voltage',
                data: voltageData,
                type: 'line',
                color: '#FF9800'
            }
        ], true);
    }
}

class BatteryMetricsController {
    constructor(chart) {
        this.chart = chart;
        this.metrics = {
            battery_charge: {
                available: false,
                value: 0,
                widget: document.querySelector('[data-type="charge"]')?.closest('.stat_card'),
                color: '#2E93fA',
                unit: '%',
                label: 'Charge'
            },
            battery_runtime: {
                available: false,
                value: 0,
                widget: document.querySelector('[data-type="runtime"]')?.closest('.stat_card'),
                color: '#66DA26',
                unit: 'min',
                label: 'Runtime'
            },
            battery_temperature: {
                available: false,
                value: 0,
                widget: document.querySelector('[data-type="temperature"]')?.closest('.stat_card'),
                color: '#FF5252',
                unit: '°C',
                label: 'Temperature'
            }
        };
    }

    init(data) {
        this.checkAvailability(data);
        this.updateWidgets();
        this.updateChart();
    }

    update(data) {
        this.checkAvailability(data);
        this.updateWidgets();
        this.updateChart();
    }

    checkAvailability(data) {
        Object.keys(this.metrics).forEach(metric => {
            const available = data.hasOwnProperty(metric) && data[metric] !== null;
            this.metrics[metric].available = available;
            if (available) {
                let value = parseFloat(data[metric]);
                this.metrics[metric].value = value;
            }
        });
    }

    updateWidgets() {
        Object.entries(this.metrics).forEach(([key, metric]) => {
            if (!metric.widget) return;

            if (metric.available) {
                metric.widget.style.display = 'flex';
                const valueEl = metric.widget.querySelector('.stat-value');
                if (valueEl) {
                    valueEl.textContent = `${metric.value.toFixed(1)}${metric.unit}`;
                }
            } else {
                metric.widget.style.display = 'none';
            }
        });
    }

    updateChart() {
        if (!this.chart) return;

        const timestamp = new Date().getTime();
        const series = Object.entries(this.metrics)
            .filter(([_, metric]) => metric.available)
            .map(([key, metric]) => ({
                name: metric.label,
                data: [{
                    x: timestamp,
                    y: metric.value
                }],
                type: 'line',
                color: metric.color
            }));

        this.chart.updateSeries(series, true);
    }
}

// Initialize the page when the DOM is fully loaded
document.addEventListener('DOMContentLoaded', () => {
    new BatteryPage();
}); 