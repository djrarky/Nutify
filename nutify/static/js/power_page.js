class PowerPage extends BasePage {
    constructor() {
        super();
        this.availableMetrics = null;
        this.isRealTimeMode = false;
        this.realTimeInterval = null;
        this.realTimeIntervalDuration = 1000;
        this.isFirstRealTimeUpdate = true;
        this.lastWebSocketData = null; // Store last WebSocket data
        this.webSocketManager = null; // WebSocket manager
        
        // Add properties for Real Time mode enforcement
        this.enforceRealtimeMode = false; // Changed to false so users can switch modes immediately
        this.realtimeStartTime = Date.now();
        this.realtimeDuration = 60 * 60 * 1000; // 1 hour in milliseconds
        this.realtimeCheckInterval = null;
        
        this._timezone = this.getConfiguredTimezone();
        
        // Make Act command available to override enforced realtime mode
        window.Act = () => {
            if (this.overrideEnforcedRealtimeMode()) {
                console.log('Realtime mode enforcement overridden via Act command');
                return 'You can now switch to other time ranges';
            }
            return 'Realtime mode was not being enforced or was already overridden';
        };
        
        // CALL METHODS TO INITIALIZE UI
        this.initEventListeners();
        
        // Initialize WebSocket for real-time updates
        this.initWebSocket();
        
        (async () => {
            try {
                await this.loadMetrics();
                this.initCharts();
                
                // Check if there is data in the database
                const now = new Date();
                const currentTime = now.toLocaleTimeString(window.APP_CONFIG && window.APP_CONFIG.locale ? 
                    window.APP_CONFIG.locale : undefined, { hour: '2-digit', minute: '2-digit' });

                // Verify if we have sufficient historical data (1+ hour)
                const hasEnoughData = await this.checkForOneHourData();
                
                if (hasEnoughData) {
                    // If we have enough data, use Today mode
                    this.isRealTimeMode = false;
                    this.enforceRealtimeMode = false;
                    
                    // Load the today data by default
                    const fromTimeInput = document.getElementById('fromTime');
                    const toTimeInput = document.getElementById('toTime');
                    if (fromTimeInput) fromTimeInput.value = '00:00';
                    if (toTimeInput) toTimeInput.value = currentTime;

                    // Activate the today option in the menu
                    document.querySelectorAll('.range-options a').forEach(option => {
                        option.classList.remove('active');
                        if (option.dataset.range === 'today') {
                            option.classList.add('active');
                        }
                    });

                    this.updateDisplayedRange(`Today (00:00 - ${currentTime})`);
                    
                    // Load the today data with explicit 'today' period
                    await this.loadData('today');
                } else {
                    // If there is not enough data (less than 1 hour), default to RealTime mode but don't enforce it
                    console.log('Starting in Real Time mode due to insufficient data (but not enforcing it)');
                    this.isRealTimeMode = true;
                    this.enforceRealtimeMode = false; // Allow switching to other modes immediately
                    
                    // Activate the realtime option in the menu
                    document.querySelectorAll('.range-options a').forEach(option => {
                        option.classList.remove('active');
                        if (option.dataset.range === 'realtime') {
                            option.classList.add('active');
                        }
                    });
                    
                    this.updateDisplayedRange('Real Time');
                    
                    // Start realtime updates
                    this.startRealTimeUpdates();
                    
                    // Show notification about real-time mode but mention it can be changed
                    window.notify('Real Time mode enforced: waiting for 1 hour of data collection. You can switch to other modes from the time range menu.', 'warning');
                }
                
            } catch (error) {
                console.error('Error in PowerPage initialization:', error);
                this.showError('Error initializing power page');
                
                // On error, default to realtime mode as a fallback but don't enforce it
                this.isRealTimeMode = true;
                this.enforceRealtimeMode = false;
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
            console.error('CacheWebSocketManager not available for Power page.');
            return;
        }
        
        // Create WebSocket manager with callbacks
        this.webSocketManager = new CacheWebSocketManager({
            onUpdate: (data) => {
                // Store the data for use in chart updates
                this.lastWebSocketData = data;
                
                // If in real-time mode, update the UI with the new data
                if (this.isRealTimeMode) {
                    this.processWebSocketData(data);
                }
            },
            onConnect: () => console.log('Power page connected to WebSocket'),
            onDisconnect: () => console.log('Power page disconnected from WebSocket'),
            debug: false
        });
    }

    /**
     * Process WebSocket data and update the UI accordingly
     */
    processWebSocketData(data) {
        if (!data) return;
        
        // Format the data for the stats cards - same structure as before
        const statsData = {
            ups_realpower: {
                current: parseFloat(data.ups_realpower || 0),
                min: parseFloat(data.ups_realpower || 0),
                max: parseFloat(data.ups_realpower || 0),
                avg: parseFloat(data.ups_realpower || 0)
            },
            input_voltage: {
                current: parseFloat(data.input_voltage || 0),
                min: parseFloat(data.input_voltage || 0),
                max: parseFloat(data.input_voltage || 0),
                avg: parseFloat(data.input_voltage || 0)
            },
            ups_load: {
                current: parseFloat(data.ups_load || 0),
                min: parseFloat(data.ups_load || 0),
                max: parseFloat(data.ups_load || 0),
                avg: parseFloat(data.ups_load || 0)
            },
            ups_realpower_nominal: {
                current: parseFloat(data.ups_realpower_nominal || 0),
                min: parseFloat(data.ups_realpower_nominal || 0),
                max: parseFloat(data.ups_realpower_nominal || 0),
                avg: parseFloat(data.ups_realpower_nominal || 0)
            }
        };

        // Update the statistics
        this.updateStats(statsData);

        // Update the chart if it exists and we're in real-time mode
        if (this.combinedChart && this.isRealTimeMode) {
            const timestamp = new Date().getTime();
            
            if (this.isFirstRealTimeUpdate) {
                this.combinedChart.updateSeries([
                    { name: 'Real Power', data: [] },
                    { name: 'Input Voltage', data: [] }
                ]);
                this.isFirstRealTimeUpdate = false;
            }

            const currentSeries = this.combinedChart.w.config.series;
            const newSeries = [
                {
                    name: 'Real Power',
                    data: [...(currentSeries[0]?.data || []), {
                        x: timestamp,
                        y: parseFloat(data.ups_realpower || 0)
                    }].slice(-30)
                },
                {
                    name: 'Input Voltage',
                    data: [...(currentSeries[1]?.data || []), {
                        x: timestamp,
                        y: parseFloat(data.input_voltage || 0)
                    }].slice(-30)
                }
            ];
            
            this.combinedChart.updateSeries(newSeries);
        }
    }

    /**
     * loadData:
     * Fetches power statistics and history data from the API based on the time range.
     */
    async loadData(period = 'day', fromTime = null, toTime = null) {
        try {
            this.showLoadingState();
            
            const params = new URLSearchParams();
            params.append('period', period);
            
            const selectedRange = document.querySelector('.range-options a.active');
            const rangeType = selectedRange ? selectedRange.dataset.range : 'day';
            
            if (rangeType === 'realtime' || this.isRealTimeMode) {
                if (this.combinedChart) {
                    this.combinedChart.destroy();
                    this.combinedChart = null;
                }
                this.startRealTimeUpdates();
                this.hideLoadingState();
                return;
            }

            // For Select Day
            if (period === 'day' && rangeType === 'day') {
                // Format the date properly (only YYYY-MM-DD)
                const formattedDate = fromTime.includes('T') ? fromTime.split('T')[0] : fromTime;
                
                // Set parameters - use only the date without time
                params.set('period', 'range');
                params.set('from_time', formattedDate);
                params.set('to_time', formattedDate);
                
                console.log(`Select Day - using date: ${formattedDate}`);
            }
            // For Date Range
            else if (period === 'range' || rangeType === 'range') {
                params.set('period', 'range');
                params.set('from_time', fromTime);
                params.set('to_time', toTime);
            }
            // For Today view
            else if (period === 'today' || rangeType === 'today') {
                // Use explicit 'today' period for today view
                params.set('period', 'today');
                // For today view, don't include time parameters - 
                // let the backend use 00:00 to now
                console.log(`Using explicit today mode without time parameters`);
            }

            // Add debug logging before API calls
            const apiUrl = `/api/power/history?${params.toString()}`;
            console.log(`Power page - loadData API calls:`, {
                period,
                rangeType,
                fromTime,
                toTime,
                apiUrl,
                statsUrl: `/api/power/stats?${params.toString()}`
            });

            const [statsResponse, historyResponse] = await Promise.all([
                fetch(`/api/power/stats?${params.toString()}`),
                fetch(apiUrl)
            ]);

            const stats = await statsResponse.json();
            const history = await historyResponse.json();

            if (stats.success && history.success) {
                // Important: First update the statistics
                await this.updateStats(stats.data);
                
                // Then ensure animations are enabled before updating the chart
                if (this.combinedChart) {
                    await this.combinedChart.updateOptions({
                        chart: {
                            animations: {
                                enabled: true,
                                easing: 'linear',
                                dynamicAnimation: {
                                    speed: 1000
                                }
                            }
                        }
                    }, false, false);
                }
                
                // Finally update the charts with animation
                await this.updateCharts(history.data);
            } else {
                // Show more detailed error message
                const errorMessage = !stats.success 
                    ? `Stats error: ${stats.message || 'Unknown error'}`
                    : `History error: ${history.message || 'Unknown error'}`;
                console.error('API error:', errorMessage);
                // Don't show notification for API errors
            }

            this.hideLoadingState();
        } catch (error) {
            console.error('Error in loadData:', error);
            this.showError('Error loading data');
            this.hideLoadingState();
        }
    }

    /**
     * loadMetrics:
     * Retrieves available power metrics from the API.
     */
    async loadMetrics() {
        try {
            const response = await fetch('/api/power/metrics');
            const data = await response.json();
            if (data.success && data.data) {
                this.availableMetrics = data.data;
            }
        } catch (error) {
            console.error('Error loading power metrics', error);
        }
    }

    /**
     * initCharts:
     * Initializes the combined chart for power metrics.
     */
    initCharts() {
        if (this.availableMetrics?.ups_power ||
            this.availableMetrics?.ups_realpower ||
            this.availableMetrics?.input_voltage
        ) {
            // Initialize ApexCharts - this is our default
            this.initCombinedChart(document.querySelector("#combinedPowerChart"));
            
            // Important: Initialize with empty series first to enable animation on first data load
            if (this.combinedChart) {
                this.combinedChart.updateOptions({
                    chart: {
                        animations: {
                            enabled: true,
                            easing: 'linear',
                            dynamicAnimation: {
                                speed: 1000
                            }
                        },
                    },
                    series: [{
                        name: 'Real Power',
                        data: []
                    }, {
                        name: 'Input Voltage',
                        data: []
                    }]
                });
            }
        }
    }

    /**
     * initCombinedChart:
     * Initializes the ApexCharts combined chart with predefined options.
     * @param {HTMLElement} element - The DOM element in which to render the chart.
     */
    initCombinedChart(element) {
        const options = {
            series: [
                {
                    name: 'Real Power',
                    data: [],
                    color: '#66DA26',
                    type: 'line'
                },
                {
                    name: 'Input Voltage',
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
                }
            },
            stroke: {
                curve: 'smooth',
                width: [2, 2]
            },
            xaxis: {
                type: 'datetime',
                labels: {
                    datetimeUTC: false,
                    formatter: function(value, timestamp, opts) {
                        return new Date(timestamp).toLocaleString(window.APP_CONFIG && window.APP_CONFIG.locale ? window.APP_CONFIG.locale : undefined, {
                            year: 'numeric',
                            month: 'short',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit'
                        });
                    }
                }
            },
            tooltip: {
                x: {
                    formatter: function(val, { series, seriesIndex, dataPointIndex, w }) {
                        return new Date(val).toLocaleString(window.APP_CONFIG && window.APP_CONFIG.locale ? window.APP_CONFIG.locale : undefined, {
                            year: 'numeric',
                            month: 'short',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                            second: '2-digit'
                        });
                    }
                },
                y: {
                    formatter: function(value) {
                        return parseFloat(value).toFixed(1);
                    }
                }
            },
            yaxis: [
                {
                    title: {
                        text: 'Real Power (W)',
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
                        text: 'Input Voltage (V)',
                        style: { color: '#FF9800' }
                    },
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

    /**
     * updateCharts:
     * Updates the combined chart with historical power data.
     * Uses fallback empty arrays if certain metrics are missing.
     * @param {object} data - The historical data for power metrics.
     */
    async updateCharts(data) {
        if (!data || !this.combinedChart) {
            return;
        }

        const { ups_power, ups_realpower, input_voltage } = data;
        
        // Log received data details
        console.log('Data points received:', {
            ups_power: ups_power?.length || 0,
            ups_realpower: ups_realpower?.length || 0,
            input_voltage: input_voltage?.length || 0
        });

        // Map data for each metric; if data array is empty, use an empty array
        const upsRealPowerData = ups_realpower && ups_realpower.length > 0 ? ups_realpower.map(point => {
            const timestamp = new Date(point.timestamp).getTime();
            const value = parseFloat(point.value);
            if (isNaN(value)) {
                console.warn(`Invalid real power value at ${point.timestamp}: ${point.value}`);
                return null;
            }
            return { x: timestamp, y: value };
        }).filter(point => point !== null) : [];

        const inputVoltageData = input_voltage && input_voltage.length > 0 ? input_voltage.map(point => {
            const timestamp = new Date(point.timestamp).getTime();
            const value = parseFloat(point.value);
            if (isNaN(value)) {
                console.warn(`Invalid voltage value at ${point.timestamp}: ${point.value}`);
                return null;
            }
            return { x: timestamp, y: value };
        }).filter(point => point !== null) : [];

        console.log('Processed data points:', {
            realPower: upsRealPowerData.length,
            inputVoltage: inputVoltageData.length
        });

        const series = [
            {
                name: 'Real Power',
                data: upsRealPowerData
            },
            {
                name: 'Input Voltage',
                data: inputVoltageData
            }
        ];

        // Determine xaxis options based on selected time range
        const selectedRange = document.querySelector('.range-options a.active');
        const rangeType = selectedRange ? selectedRange.dataset.range : 'day';
        
        console.log('Chart range type:', rangeType);
        
        let xaxisOptions = { 
            type: 'datetime', 
            labels: { 
                datetimeUTC: false,
                formatter: function(value, timestamp) {
                    const date = new Date(timestamp);
                    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                }
            }
        };

        // Find the actual data range from all available data points
        const allDataPoints = [...upsRealPowerData, ...inputVoltageData];
        
        if (allDataPoints.length > 0) {
            // Find the earliest and latest timestamps in the data
            const actualDataMin = Math.min(...allDataPoints.map(p => p.x));
            const actualDataMax = Math.max(...allDataPoints.map(p => p.x));
            
            console.log('Actual data range:', {
                min: new Date(actualDataMin).toLocaleTimeString(),
                max: new Date(actualDataMax).toLocaleTimeString()
            });
            
            // Set the chart to only show the range where data exists
            xaxisOptions.min = actualDataMin;
            xaxisOptions.max = actualDataMax;
        }

        // Important: Make sure animations are enabled before updating series
        await this.combinedChart.updateOptions({
            chart: {
                animations: {
                    enabled: true,
                    easing: 'linear',
                    dynamicAnimation: {
                        speed: 1000
                    }
                }
            },
            xaxis: xaxisOptions
        }, false, false);
        
        // Then update the series to trigger animation
        await this.combinedChart.updateSeries(series, true);
    }

    /**
     * updateStats:
     * Updates the widget values (mini widgets) based on power statistics data.
     * @param {object} stats - The power statistics returned from the API.
     */
    async updateStats(stats) {
        console.log('UpdateStats - Raw stats:', stats);
        
        document.querySelectorAll('.stat-value').forEach(element => {
            const type = element.dataset.type;
            if (!type) return;
            
            const metricMap = {
                'realpower': 'ups_realpower',
                'voltage': 'input_voltage',
                'output_voltage': 'output_voltage',
                'load': 'ups_load',
                'nominal': 'ups_realpower_nominal'
            };

            const metricName = metricMap[type];
            if (!metricName || !stats[metricName]) return;

            const selectedRange = document.querySelector('.range-options a.active');
            const rangeType = selectedRange?.dataset.range;
            const metricData = stats[metricName];
            let value;

            // For non realtime modes, use the average instead of the current value
            if (type === 'realpower') {
                let displayValue;
                let unit = 'W';
                
                // Get the base value based on mode
                if (rangeType === 'realtime') {
                    // For realtime mode only, use current value
                    displayValue = metricData.current;
                } else {
                    // For today and historical data, show total energy in Watts
                    displayValue = metricData.total_energy;
                }

                // Format the value
                if (displayValue >= 1000) {
                    displayValue = displayValue / 1000;
                    unit = 'kW';
                }

                // Set the main value display based on mode
                if (rangeType === 'realtime') {
                    // For Real Time mode: always 1 decimal place
                    element.textContent = `${displayValue.toFixed(1)} ${unit}`;
                } else {
                    // For Today, Select Day, Date Range: always 2 decimal places
                    element.textContent = `${displayValue.toFixed(2)} ${unit}`;
                }

                // Add min/max info if available
                const trendElement = element.parentElement.querySelector('.stat-trend');
                if (trendElement && metricData.min !== undefined && metricData.max !== undefined) {
                    const minValue = metricData.min;
                    const maxValue = metricData.max;
                    // Use same decimal format as main value for consistency
                    const decimalPlaces = rangeType === 'realtime' ? 1 : 2;
                    trendElement.innerHTML = `<i class="fas fa-info-circle"></i> Min: ${minValue.toFixed(decimalPlaces)} W | Max: ${maxValue.toFixed(decimalPlaces)} W`;
                }
            } else {
                // For other metric types
                value = rangeType === 'realtime' ? metricData.current : metricData.avg;
                element.textContent = `${value.toFixed(1)} ${type === 'load' ? '%' : 'V'}`;
            }
        });

        // Update the selected period in all cards
        const selectedRange = document.querySelector('.date-range-btn .selected-range');
        if (selectedRange) {
            document.querySelectorAll('.selected-period').forEach(span => {
                span.textContent = selectedRange.textContent;
            });
        }
    }

    /**
     * updateDisplayedRange:
     * Updates the displayed time range text in the dropdown button.
     * @param {string} text - The text to display.
     */
    updateDisplayedRange(text) {
        // Update the text in the button
        const selectedRange = document.querySelector('.date-range-btn .selected-range');
        if (selectedRange) {
            selectedRange.textContent = text;
        }

        // Update the text in all cards
        document.querySelectorAll('.selected-period').forEach(span => {
            span.textContent = text;
        });
    }

    /**
     * loadRealTimeData:
     * Now uses the WebSocket data instead of fetching from API
     */
    async loadRealTimeData() {
        // If we have WebSocket data, use it
        if (this.lastWebSocketData) {
            this.processWebSocketData(this.lastWebSocketData);
        } 
        // If WebSocket manager exists but no data yet, request it
        else if (this.webSocketManager) {
            this.webSocketManager.requestCacheData();
        }
    }

    /**
     * initEventListeners:
     * Sets up event listeners for UI elements such as the date range button.
     */
    async initEventListeners() {
        // Date range dropdown
        const dateRangeBtn = document.getElementById('dateRangeBtn');
        const dateRangeDropdown = document.getElementById('dateRangeDropdown');
        
        // Toggle dropdown
        if (dateRangeBtn) {
            dateRangeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                dateRangeDropdown.classList.toggle('hidden');
            });
        }

        // Range options
        document.querySelectorAll('.range-options a').forEach(option => {
            option.addEventListener('click', async (e) => {
                e.preventDefault();
                const range = e.target.dataset.range;
                
                // Skip if already in this mode
                const currentActive = document.querySelector('.range-options a.active');
                if (currentActive && currentActive.dataset.range === range) {
                    console.log(`Already in ${range} mode`);
                    return;
                }
                
                console.log(`Switching to ${range} mode`);
                
                // Remove active from all options
                document.querySelectorAll('.range-options a').forEach(opt => {
                    opt.classList.remove('active');
                });
                e.target.classList.add('active');

                // Hide all panels
                document.querySelectorAll('.time-range-selector, .day-selector, .range-selector, .realtime-selector').forEach(selector => {
                    selector.classList.add('hidden');
                });

                // Clean up first - important for consistent transitions
                if (this.isRealTimeMode && range !== 'realtime') {
                    this.stopRealTimeUpdates();
                }

                switch(range) {
                    case 'realtime':
                        // Switch to realtime mode
                        document.getElementById('realtimeSelector').classList.remove('hidden');
                        // Initialize realtime mode with forced update
                        this.startRealTimeUpdates();
                        break;
                    case 'today':
                        // Switch to historical mode with ApexCharts
                        document.getElementById('timeRangeSelector').classList.remove('hidden');
                        this.isRealTimeMode = false;
                        this.stopRealTimeUpdates();
                        
                        // Set default time values for Today mode
                        const fromTimeInput = document.getElementById('fromTime');
                        const toTimeInput = document.getElementById('toTime');
                        
                        if (fromTimeInput && toTimeInput) {
                            // Default to 00:00 for from time if not already set
                            if (!fromTimeInput.value) {
                                fromTimeInput.value = "00:00";
                            }
                            
                            // Default to current time for to time if not already set
                            if (!toTimeInput.value) {
                                const now = new Date();
                                toTimeInput.value = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
                                console.log(`Set current time for toTime: ${toTimeInput.value}`);
                            }
                            
                            // Auto-load the data with current values (like in original OLDpower.js)
                            const displayText = `Today (${fromTimeInput.value} - ${toTimeInput.value})`;
                            this.updateDisplayedRange(displayText);
                            this.resetCharts();
                            this.loadData('today', fromTimeInput.value, toTimeInput.value);
                        }
                        break;
                    case 'day':
                        // Switch to historical mode with ApexCharts
                        document.getElementById('daySelectorPanel').classList.remove('hidden');
                        this.isRealTimeMode = false;
                        this.stopRealTimeUpdates();
                        
                        // Set default date to today if not already set
                        const dayPicker = document.getElementById('dayPicker');
                        if (dayPicker && !dayPicker.value) {
                            const today = new Date();
                            const formattedDate = today.toISOString().split('T')[0]; // YYYY-MM-DD format
                            dayPicker.value = formattedDate;
                            console.log(`Set default date for dayPicker: ${formattedDate}`);
                        }
                        break;
                    case 'range':
                        // Switch to historical mode with ApexCharts
                        document.getElementById('dateRangeSelectorPanel').classList.remove('hidden');
                        this.isRealTimeMode = false;
                        this.stopRealTimeUpdates();
                        break;
                }
            });
        });

        // Apply time range button
        const applyTimeRange = document.getElementById('applyTimeRange');
        if (applyTimeRange) {
            applyTimeRange.addEventListener('click', async () => {
                const fromTime = document.getElementById('fromTime').value;
                const toTime = document.getElementById('toTime').value;
                
                this.resetCharts();
                this.updateDisplayedRange(`Today (${fromTime} - ${toTime})`);
                
                await this.loadData('today');
                dateRangeDropdown.classList.add('hidden');
            });
        }

        // Apply per Select Day
        const applyDay = document.getElementById('applyDay');
        if (applyDay) {
            applyDay.addEventListener('click', async () => {
                const selectedDate = document.getElementById('dayPicker').value;
                if (selectedDate) {
                    this.resetCharts();
                    this.isRealTimeMode = false;
                    this.stopRealTimeUpdates();
                    
                    // Format the date for display
                    const displayDate = new Date(selectedDate);
                    console.log(`Selected day: ${selectedDate}, Display date: ${displayDate.toLocaleDateString()}`);
                    
                    const displayText = displayDate.toLocaleDateString();
                    this.updateDisplayedRange(displayText);
                    
                    // Important: Use 'day' as the period, not 'today'
                    await this.loadData('day', selectedDate);
                    dateRangeDropdown.classList.add('hidden');
                }
            });
        }

        // Apply range button
        const applyRange = document.getElementById('applyRange');
        if (applyRange) {
            applyRange.addEventListener('click', async () => {
                const fromDate = document.getElementById('rangeFromDate').value;
                const toDate = document.getElementById('rangeToDate').value;
                if (fromDate && toDate) {
                    this.resetCharts();
                    const displayText = `${fromDate} to ${toDate}`;
                    this.updateDisplayedRange(displayText);
                    await this.loadData('range', fromDate, toDate);
                    dateRangeDropdown.classList.add('hidden');
                }
            });
        }

        // Apply realtime button
        const applyRealTime = document.getElementById('applyRealTime');
        if (applyRealTime) {
            applyRealTime.addEventListener('click', () => {
                const intervalInput = document.getElementById('realtimeInterval');
                const newInterval = parseInt(intervalInput.value);
                if (!isNaN(newInterval) && newInterval > 0) {
                    this.realTimeIntervalDuration = newInterval * 1000;
                    this.startRealTimeUpdates();
                    this.updateDisplayedRange(`Real Time (every ${newInterval}s)`);
                    dateRangeDropdown.classList.add('hidden');
                }
            });
        }

        // Click outside to close dropdown
        document.addEventListener('click', (e) => {
            if (dateRangeBtn && dateRangeDropdown && 
                !dateRangeBtn.contains(e.target) && 
                !dateRangeDropdown.contains(e.target)) {
                dateRangeDropdown.classList.add('hidden');
            }
        });
    }

    /**
     * showLoadingState:
     * Displays a loading overlay.
     * Uses the CSS defined in html.css.
     */
    showLoadingState() {
        // Minimal implementation: create and show a loading overlay if not already present.
        let overlay = document.getElementById('loading-overlay');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'loading-overlay';
            overlay.innerHTML = '<div class="loading-spinner"></div>';
            document.body.appendChild(overlay);
        }
        overlay.style.display = 'flex';
    }

    /**
     * hideLoadingState:
     * Hides the loading overlay.
     */
    hideLoadingState() {
        const overlay = document.getElementById('loading-overlay');
        if (overlay) {
            overlay.style.display = 'none';
        }
    }

    /**
     * addLoadingStyles:
     * This method is intentionally minimal and does not add extra CSS.
     * It relies on the CSS provided in static/css/html.css.
     */
    addLoadingStyles() {
        // Removed custom CSS in favor of CSS from html.css.
    }

    /**
     * startRealTimeUpdates:
     * Sets up real-time data updates and initializes the Chart.js chart for real-time mode.
     */
    startRealTimeUpdates() {
        console.log("Starting real-time updates");
        this.isFirstRealTimeUpdate = true;
        this.isRealTimeMode = true;
        
        // Record start time for 1-hour persistence if not already set
        if (!this.realtimeStartTime) {
            this.realtimeStartTime = Date.now();
        }
        
        // Clear existing intervals if any
        if (this.realTimeInterval) {
            clearInterval(this.realTimeInterval);
            this.realTimeInterval = null;
        }
        
        // Clean up ApexCharts if it exists
        if (this.combinedChart) {
            this.combinedChart.destroy();
            this.combinedChart = null;
        }
        
        // Clean up Chart.js if it exists (important to avoid duplicate charts)
        if (this.powerChartJS) {
            try {
                this.powerChartJS.destroy();
            } catch (e) {
                console.warn("Error destroying Chart.js chart:", e);
            }
            this.powerChartJS = null;
        }
        
        // Make sure to update display range immediately
        this.updateDisplayedRange('Real Time');
        
        const combinedChartElement = document.querySelector("#combinedPowerChart");
        if (!combinedChartElement) {
            console.error("Chart container not found");
            return;
        }
        
        // Clear the chart container
        combinedChartElement.innerHTML = '';
        
        // Ensure we have the WebSocket data or request it
        if (this.webSocketManager) {
            this.webSocketManager.requestCacheData();
        }
        
        // Load Chart.js libraries dynamically and initialize the chart
        this.loadChartJSLibraries()
            .then(() => {
                // Generate synthetic data first for a full chart
                console.log("Initializing chart with synthetic data before switching to real-time");
                this.initRealtimeChartJS(combinedChartElement);
            })
            .catch(error => {
                console.error('Error loading Chart.js libraries:', error);
                // Fallback to using ApexCharts for realtime too if Chart.js fails
                this.initCombinedChart(combinedChartElement);
                this.loadRealTimeData();
                this.realTimeInterval = setInterval(() => {
                    this.loadRealTimeData();
                }, this.realTimeIntervalDuration || 1000);
            });
        
        // Set up a check to see if we should keep the realtime mode enforced
        if (this.realtimeCheckInterval) {
            clearInterval(this.realtimeCheckInterval);
        }
        
        this.realtimeCheckInterval = setInterval(() => {
            // Only check if we've been in realtime mode for more than 1 hour
            const currentTime = Date.now();
            const elapsedTime = currentTime - this.realtimeStartTime;
            const hoursSinceStart = (elapsedTime / (1000 * 60 * 60)).toFixed(1);
            
            console.log(`Realtime mode has been active for ${hoursSinceStart} hours`);
            
            if (elapsedTime >= this.realtimeDuration) {
                console.log('Realtime mode 1-hour duration reached, checking data availability');
                this.checkForOneHourData().then(hasData => {
                    if (hasData) {
                        console.log('Power data now has sufficient data (1+ hour)');
                        // If we are enforcing realtime mode, disable the enforcement
                        if (this.enforceRealtimeMode) {
                            this.enforceRealtimeMode = false;
                        }
                    } else {
                        console.log('Power data still lacks sufficient data');
                    }
                });
            }
        }, 5 * 60 * 1000); // Check every 5 minutes
    }

    /**
     * stopRealTimeUpdates:
     * Stops real-time data updates and cleans up related resources.
     */
    stopRealTimeUpdates() {
        console.log("Stopping real-time updates");
        
        // Clear all intervals
        if (this.realTimeInterval) {
            clearInterval(this.realTimeInterval);
            this.realTimeInterval = null;
        }
        
        // Also clear the realtime check interval
        if (this.realtimeCheckInterval) {
            clearInterval(this.realtimeCheckInterval);
            this.realtimeCheckInterval = null;
        }
        
        this.isRealTimeMode = false;
        
        // Clean up Chart.js if it exists
        if (this.powerChartJS) {
            try {
                this.powerChartJS.destroy();
            } catch (e) {
                console.warn("Error destroying Chart.js chart:", e);
            }
            this.powerChartJS = null;
        }
        
        // Clean up chart element
        const combinedChartElement = document.querySelector("#combinedPowerChart");
        if (combinedChartElement) {
            combinedChartElement.innerHTML = '';
            
            // Only reinitialize ApexCharts if we're not switching to realtime mode
            const currentMode = document.querySelector('.range-options a.active')?.dataset.range;
            if (currentMode !== 'realtime') {
                this.initCombinedChart(combinedChartElement);
            }
        }
    }

    resetCharts() {
        if (this.combinedChart) {
            this.combinedChart.updateOptions({
                chart: {
                    animations: {
                        enabled: false
                    }
                }
            }, false, false);

            this.combinedChart.updateSeries([
                { name: 'Real Power', data: [] },
                { name: 'Input Voltage', data: [] }
            ], false);

            // Re-enable animations after reset
            this.combinedChart.updateOptions({
                chart: {
                    animations: {
                        enabled: true,
                        easing: 'linear',
                        dynamicAnimation: {
                            speed: 1000
                        }
                    }
                }
            }, false, false);
        }
    }

    formatChartDate(timestamp) {
        return new Date(timestamp).toLocaleString(window.APP_CONFIG && window.APP_CONFIG.locale ? window.APP_CONFIG.locale : undefined, {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    }

    formatTooltipDate(val) {
        return new Date(val).toLocaleString(window.APP_CONFIG && window.APP_CONFIG.locale ? window.APP_CONFIG.locale : undefined, {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });
    }

    showError(message) {
        console.error(message);
    }

    async checkHistoricalData() {
        try {
            const now = new Date();
            const currentTime = now.toLocaleTimeString(window.APP_CONFIG && window.APP_CONFIG.locale ? 
                window.APP_CONFIG.locale : undefined, { hour: '2-digit', minute: '2-digit' });
            
            const params = new URLSearchParams({
                period: 'today',
                from_time: '00:00',
                to_time: currentTime
            });

            const [historyResponse, statsResponse] = await Promise.all([
                fetch(`/api/power/history?${params}`),
                fetch(`/api/power/stats?${params}`)
            ]);

            const historyData = await historyResponse.json();
            const statsData = await statsResponse.json();

            if (historyData.success && historyData.data) {
                const powerData = historyData.data.ups_realpower || [];
                const voltageData = historyData.data.input_voltage || [];

                // Check if there is at least 2 different data points to consider them historical
                const hasHistoricalPowerData = powerData.length >= 2 && 
                    powerData.slice(0, -1).some(p => parseFloat(p.value) > 0); // Exclude the last point (it might be live)

                const hasHistoricalVoltageData = voltageData.length >= 2 && 
                    voltageData.slice(0, -1).some(v => parseFloat(v.value) > 0); // Exclude the last point (it might be live)

                // Check if there is valid historical stats
                const hasHistoricalStats = statsData.success && 
                                         statsData.data && 
                                         statsData.data.ups_realpower && 
                                         (
                                             statsData.data.ups_realpower.total_energy > 0 ||
                                             (
                                                 statsData.data.ups_realpower.min !== statsData.data.ups_realpower.max &&
                                                 statsData.data.ups_realpower.min > 0
                                             )
                                         );

                const hasHistoricalData = hasHistoricalPowerData || hasHistoricalVoltageData || hasHistoricalStats;

                return hasHistoricalData;
            }

            return false;
        } catch (error) {
            console.error('Error checking historical power data:', error);
            return false;
        }
    }

    showNotification(message, type = 'info') {
        // Use the window.notify function from notifications.js
        window.notify(message, type, 5000);
    }

    startRealTimeMode() {
        this.isRealTimeMode = true;
        this.initialLoadTime = new Date();
        
        // Reset the chart before starting
        if (this.combinedChart) {
            this.resetCharts();
        }
        
        // Start the timer for the mode check
        this.modeCheckInterval = setInterval(() => {
            this.checkInitialMode();
        }, 30000); // Check every 30 seconds
    }

    stopRealTimeMode() {
        if (this.modeCheckInterval) {
            clearInterval(this.modeCheckInterval);
        }
        this.isRealTimeMode = false;
    }

    async checkInitialMode() {
        const now = new Date();
        const timeElapsed = now - this.initialLoadTime;

        if (this.isRealTimeMode && timeElapsed >= this.REALTIME_DURATION) {
            console.log('Switching to Today mode after 5 minutes');
            this.isRealTimeMode = false;
            
            // Switch to Today
            const currentTime = now.toLocaleTimeString(window.APP_CONFIG && window.APP_CONFIG.locale ? 
                window.APP_CONFIG.locale : undefined, { hour: '2-digit', minute: '2-digit' });

            // Update UI
            document.querySelectorAll('.range-options a').forEach(option => {
                option.classList.remove('active');
                if (option.dataset.range === 'today') {
                    option.classList.add('active');
                }
            });

            this.updateDisplayedRange(`Today (00:00 - ${currentTime})`);
            this.stopRealTimeUpdates();
            await this.loadData('today');
            
            // Don't show notification about Today mode
        }
        return this.isRealTimeMode;
    }

    // Dynamic library loading to avoid conflicts
    loadChartJSLibraries() {
        return new Promise((resolve, reject) => {
            // Check if Chart.js is already loaded
            if (window.Chart) {
                resolve();
                return;
            }

            // Load Chart.js and its streaming plugin dynamically
            const chartJS = document.createElement('script');
            chartJS.src = '/static/js/lib/chartjs/chart.min.js';
            
            chartJS.onload = () => {
                // After Chart.js is loaded, load the streaming plugin
                const streamingPlugin = document.createElement('script');
                streamingPlugin.src = '/static/js/lib/chartjs/chartjs-plugin-streaming.min.js';
                
                streamingPlugin.onload = () => {
                    // Both libraries loaded successfully
                    resolve();
                };
                
                streamingPlugin.onerror = () => {
                    reject(new Error('Failed to load chartjs-plugin-streaming'));
                };
                
                document.head.appendChild(streamingPlugin);
            };
            
            chartJS.onerror = () => {
                reject(new Error('Failed to load Chart.js'));
            };
            
            document.head.appendChild(chartJS);
        });
    }

    /**
     * Generate synthetic data to fill the chart initially
     * @param {Date} endTime - The end time for the synthetic data (typically now)
     * @returns {Object} Object containing power and voltage synthetic data arrays
     */
    generateSyntheticData(endTime) {
        const powerData = [];
        const voltageData = [];
        
        // Use the most recent real data from WebSocket if available, or cached values
        let basePowerValue = 150; // Default power value in watts
        let baseVoltageValue = 230; // Default voltage value
        
        // Try to get values from localStorage
        const cachedPower = localStorage.getItem('lastPowerValue');
        const cachedVoltage = localStorage.getItem('lastVoltageValue');
        
        if (cachedPower) {
            basePowerValue = Math.max(parseFloat(cachedPower), 100);
        }
        
        if (cachedVoltage) {
            baseVoltageValue = Math.max(parseFloat(cachedVoltage), 220);
        }
        
        // If we have real-time data from WebSocket, use it instead of cache
        if (this.lastWebSocketData) {
            const data = this.lastWebSocketData;
            
            if (data.ups_realpower !== undefined) {
                basePowerValue = Math.max(parseFloat(data.ups_realpower), 100);
            }
            
            if (data.input_voltage !== undefined) {
                baseVoltageValue = Math.max(parseFloat(data.input_voltage), 220);
            }
            
            console.log(`Using WebSocket data for synthetic initialization: Power=${basePowerValue}W, Voltage=${baseVoltageValue}V`);
        } else {
            console.log(`Using cached/default values for synthetic initialization: Power=${basePowerValue}W, Voltage=${baseVoltageValue}V`);
        }
        
        // Generate 30 points over 60 seconds (1 point every 2 seconds) for smooth appearance
        for (let i = 0; i < 30; i++) {
            // Calculate time points to fill exactly 60 seconds back from endTime
            const time = new Date(endTime - (60 * 1000) + (i * 2000)); // One point every 2 seconds
            
            // Add small random variations to create natural-looking lines
            const powerVariation = basePowerValue * (Math.random() * 0.04 - 0.02); // ±2% variation
            const voltageVariation = baseVoltageValue * (Math.random() * 0.01 - 0.005); // ±0.5% variation
            
            // Calculate the values with variation
            const powerValue = Math.max(basePowerValue + powerVariation, 50);
            const voltageValue = Math.max(baseVoltageValue + voltageVariation, 220);
            
            // Add data points
            powerData.push({
                x: time.getTime(),
                y: powerValue
            });
            
            voltageData.push({
                x: time.getTime(),
                y: voltageValue
            });
        }
        
        return {
            power: powerData,
            voltage: voltageData
        };
    }

    // Method to initialize Chart.js for realtime mode only
    initRealtimeChartJS(container) {
        console.log('Initializing Chart.js for realtime power monitoring');
        
        // Clear the container
        container.innerHTML = '';
        
        // Create a canvas for Chart.js
        const canvas = document.createElement('canvas');
        canvas.id = 'realtimePowerChart';
        container.appendChild(canvas);
        
        const ctx = canvas.getContext('2d');
        
        // Create gradients for series
        const powerGradient = ctx.createLinearGradient(0, 0, 0, 300);
        powerGradient.addColorStop(0, 'rgba(102, 218, 38, 0.3)');
        powerGradient.addColorStop(1, 'rgba(102, 218, 38, 0.0)');
        
        const voltageGradient = ctx.createLinearGradient(0, 0, 0, 300);
        voltageGradient.addColorStop(0, 'rgba(255, 152, 0, 0.3)');
        voltageGradient.addColorStop(1, 'rgba(255, 152, 0, 0.0)');
        
        // Generate synthetic data for initial display
        const now = new Date();
        const syntheticData = this.generateSyntheticData(now);
        
        // Initialize buffers with synthetic data
        this.dataBuffer = {
            power: syntheticData.power.slice(-this.bufferSize),
            voltage: syntheticData.voltage.slice(-this.bufferSize)
        };
        this.bufferSize = 15; // Buffer size for data smoothing
        
        // Chart.js configuration for power monitoring
        const chartConfig = {
            type: 'line',
            data: {
                datasets: [
                    {
                        label: 'Real Power',
                        backgroundColor: powerGradient,
                        borderColor: '#66DA26',
                        borderWidth: 2.5,
                        data: syntheticData.power, // Use synthetic data for initial display
                        pointRadius: 0,
                        tension: 0.4,
                        fill: true,
                        cubicInterpolationMode: 'monotone',
                        yAxisID: 'y-power'
                    },
                    {
                        label: 'Input Voltage',
                        backgroundColor: voltageGradient,
                        borderColor: '#FF9800',
                        borderWidth: 2.5,
                        data: syntheticData.voltage, // Use synthetic data for initial display
                        pointRadius: 0,
                        tension: 0.4,
                        fill: true,
                        cubicInterpolationMode: 'monotone',
                        yAxisID: 'y-voltage'
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    streaming: {
                        duration: 60000, // Show 60 seconds of data
                        refresh: 1000,   // Refresh every second
                        delay: 1000,     // 1 second delay
                        onRefresh: this.onChartRefresh.bind(this)
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
                    'y-power': {
                        position: 'left',
                        min: 0,
                        max: (context) => {
                            if (context.chart.data.datasets[0].data.length > 0) {
                                let maxValue = Math.max(...context.chart.data.datasets[0].data.map(d => d.y));
                                return Math.max(200, Math.ceil(maxValue * 1.5)); // Higher baseline and more headroom
                            }
                            return 200; // Higher default maximum
                        },
                        grid: { display: false },
                        ticks: {
                            color: '#66DA26'
                        },
                        title: {
                            display: true,
                            text: 'Real Power (W)',
                            color: '#66DA26'
                        }
                    },
                    'y-voltage': {
                        position: 'right',
                        min: (context) => {
                            if (context.chart.data.datasets[1].data.length > 0) {
                                let minValue = Math.min(...context.chart.data.datasets[1].data.map(d => d.y));
                                return Math.max(100, Math.floor(minValue * 0.95)); // Higher minimum baseline
                            }
                            return 100; // Start at 100V minimum
                        },
                        max: (context) => {
                            if (context.chart.data.datasets[1].data.length > 0) {
                                let maxValue = Math.max(...context.chart.data.datasets[1].data.map(d => d.y));
                                return Math.max(250, Math.ceil(maxValue * 1.1)); // Ensure at least 250V max
                            }
                            return 250;
                        },
                        grid: { display: false },
                        ticks: {
                            color: '#FF9800'
                        },
                        title: {
                            display: true,
                            text: 'Input Voltage (V)',
                            color: '#FF9800'
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
        this.powerChartJS = new Chart(ctx, chartConfig);
    }

    // Method to handle realtime chart refreshes
    onChartRefresh(chart) {
        const now = Date.now();
        
        // If we have WebSocket data, use it
        if (this.lastWebSocketData) {
            // Add debug logging for first real data
            if (this.isFirstRealTimeUpdate) {
                console.log("Transitioning from synthetic to real WebSocket data");
                this.isFirstRealTimeUpdate = false;
            }
            
            const data = this.lastWebSocketData;
            let powerValue = parseFloat(data.ups_realpower || 0);
            let voltageValue = parseFloat(data.input_voltage || 0);
            
            // Ensure values are never too small
            powerValue = Math.max(powerValue, 50); // Increased minimum from 1W to 50W
            voltageValue = Math.max(voltageValue, 100); // Increased minimum from 1V to 100V
            
            // Store the values for future use
            localStorage.setItem('lastPowerValue', powerValue.toString());
            localStorage.setItem('lastVoltageValue', voltageValue.toString());
            
            // Add new points to the buffers
            this.dataBuffer.power.push({
                x: now,
                y: powerValue
            });
            this.dataBuffer.voltage.push({
                x: now,
                y: voltageValue
            });

            // Maintain buffer size
            if (this.dataBuffer.power.length > this.bufferSize) {
                this.dataBuffer.power.shift();
            }
            if (this.dataBuffer.voltage.length > this.bufferSize) {
                this.dataBuffer.voltage.shift();
            }

            // Calculate smoothed values using the buffers
            const smoothedPower = this.calculateSmoothedValue(this.dataBuffer.power);
            const smoothedVoltage = this.calculateSmoothedValue(this.dataBuffer.voltage);
            
            // Add smoothed points to the chart
            chart.data.datasets[0].data.push({
                x: now,
                y: smoothedPower
            });
            chart.data.datasets[1].data.push({
                x: now,
                y: smoothedVoltage
            });
            
            // Create stats data structure for the updateRealtimeStats method
            const statsData = {
                ups_realpower: {
                    current: powerValue,
                    min: powerValue,
                    max: powerValue,
                    avg: powerValue,
                    value: powerValue
                },
                input_voltage: {
                    current: voltageValue,
                    min: voltageValue,
                    max: voltageValue,
                    avg: voltageValue,
                    value: voltageValue
                },
                ups_load: {
                    current: parseFloat(data.ups_load || 0),
                    min: parseFloat(data.ups_load || 0),
                    max: parseFloat(data.ups_load || 0),
                    avg: parseFloat(data.ups_load || 0),
                    value: parseFloat(data.ups_load || 0)
                },
                ups_realpower_nominal: {
                    current: parseFloat(data.ups_realpower_nominal || 0),
                    min: parseFloat(data.ups_realpower_nominal || 0),
                    max: parseFloat(data.ups_realpower_nominal || 0),
                    avg: parseFloat(data.ups_realpower_nominal || 0),
                    value: parseFloat(data.ups_realpower_nominal || 0)
                },
                status: {
                    value: data.ups_status || 'Unknown'
                }
            };
            
            // Update the stats with current values using a special method
            this.updateRealtimeStats(statsData);
            
            chart.update('quiet');
            
            // Return a resolved promise
            return Promise.resolve();
        } 
        // If WebSocket manager exists but no data yet, request it and use cached values
        else {
            // Use cached values if available
            let powerValue = 100; // Default to 100W
            let voltageValue = 230; // Default to 230V
            
            // Try to get values from localStorage
            const cachedPower = localStorage.getItem('lastPowerValue');
            const cachedVoltage = localStorage.getItem('lastVoltageValue');
            
            if (cachedPower) {
                powerValue = Math.max(parseFloat(cachedPower), 50);
            }
            
            if (cachedVoltage) {
                voltageValue = Math.max(parseFloat(cachedVoltage), 100);
            }
            
            // Add some random variation (±2%)
            const powerVariation = powerValue * (Math.random() * 0.04 - 0.02);
            const voltageVariation = voltageValue * (Math.random() * 0.02 - 0.01);
            
            const adjustedPowerValue = powerValue + powerVariation;
            const adjustedVoltageValue = voltageValue + voltageVariation;
            
            // Add new points to the buffers
            this.dataBuffer.power.push({
                x: now,
                y: adjustedPowerValue
            });
            this.dataBuffer.voltage.push({
                x: now,
                y: adjustedVoltageValue
            });
            
            // Maintain buffer size
            if (this.dataBuffer.power.length > this.bufferSize) {
                this.dataBuffer.power.shift();
            }
            if (this.dataBuffer.voltage.length > this.bufferSize) {
                this.dataBuffer.voltage.shift();
            }
            
            // Calculate smoothed values
            const smoothedPower = this.calculateSmoothedValue(this.dataBuffer.power);
            const smoothedVoltage = this.calculateSmoothedValue(this.dataBuffer.voltage);
            
            // Add smoothed points to chart
            chart.data.datasets[0].data.push({
                x: now,
                y: smoothedPower
            });
            chart.data.datasets[1].data.push({
                x: now,
                y: smoothedVoltage
            });
            
            // Update the stats with simulated values
            const statsData = {
                ups_realpower: {
                    current: adjustedPowerValue,
                    min: adjustedPowerValue,
                    max: adjustedPowerValue,
                    avg: adjustedPowerValue,
                    value: adjustedPowerValue
                },
                input_voltage: {
                    current: adjustedVoltageValue,
                    min: adjustedVoltageValue,
                    max: adjustedVoltageValue,
                    avg: adjustedVoltageValue,
                    value: adjustedVoltageValue
                },
                ups_load: {
                    current: 20, // Default load value
                    min: 20,
                    max: 20,
                    avg: 20,
                    value: 20
                },
                ups_realpower_nominal: {
                    current: 500, // Default nominal value
                    min: 500,
                    max: 500,
                    avg: 500,
                    value: 500
                },
                status: {
                    value: 'OL'
                }
            };
            
            // Update the stats with simulated values
            this.updateRealtimeStats(statsData);
            
            chart.update('quiet');
            
            // Request cached data for next update
            if (this.webSocketManager) {
                this.webSocketManager.requestCacheData();
            }
            
            return Promise.resolve();
        }
    }

    // New method specifically for realtime stats updates to avoid conflicts
    updateRealtimeStats(stats) {
        console.log('Updating realtime stats:', stats);
        
        // Update stat values
        document.querySelectorAll('.stat-value').forEach(element => {
            const type = element.dataset.type;
            if (!type) return;
            
            const metricMap = {
                'realpower': 'ups_realpower',
                'voltage': 'input_voltage',
                'output_voltage': 'output_voltage',
                'load': 'ups_load',
                'nominal': 'ups_realpower_nominal'
            };

            const metricName = metricMap[type];
            if (!metricName || !stats[metricName]) return;

            const metricData = stats[metricName];
            
            // For realtime mode, display the current value
            if (type === 'realpower') {
                const powerValue = metricData.value || metricData.current;
                // Always use exactly 1 decimal place for Real Time mode
                element.textContent = `${powerValue.toFixed(1)} W`;
                
                // Update min/max info
                const trendElement = element.parentElement.querySelector('.stat-trend');
                if (trendElement) {
                    // Always use exactly 1 decimal place for min/max in Real Time mode
                    trendElement.innerHTML = `<i class="fas fa-info-circle"></i> Min: ${powerValue.toFixed(1)} W | Max: ${powerValue.toFixed(1)} W`;
                }
            } else if (type === 'voltage' || type === 'output_voltage') {
                const voltageValue = metricData.value || metricData.current;
                element.textContent = `${voltageValue.toFixed(1)} V`;
            } else if (type === 'load') {
                const loadValue = metricData.value || metricData.current;
                element.textContent = `${loadValue.toFixed(1)} %`;
            } else if (type === 'nominal') {
                // Check in order: ups_realpower_nominal, ups_power_nominal, then keep existing value
                if (stats.ups_realpower_nominal && stats.ups_realpower_nominal.value > 0) {
                    const value = stats.ups_realpower_nominal.value || stats.ups_realpower_nominal.current;
                    element.textContent = `${value.toFixed(1)} W`;
                    // Update the label to "Nominal Power"
                    const labelElement = element.parentElement.querySelector('.info-label');
                    if (labelElement) labelElement.textContent = 'Nominal Power:';
                } else if (stats.ups_power_nominal && stats.ups_power_nominal.value > 0) {
                    const value = stats.ups_power_nominal.value || stats.ups_power_nominal.current;
                    element.textContent = `${value.toFixed(1)} W`;
                    // Update the label to "Nominal Power"
                    const labelElement = element.parentElement.querySelector('.info-label');
                    if (labelElement) labelElement.textContent = 'Nominal Power:';
                }
                // If neither is available, keep the existing value and label (Manual Nominal Power)
            } else if (type === 'status' && stats.status) {
                const value = stats.status.value || stats.status.current;
                element.textContent = this.formatUPSStatus(value);
            }
        });

        // Update the status information if available
        document.querySelectorAll('.info-value').forEach(element => {
            const type = element.dataset.type;
            if (!type) return;
            
            if (type === 'load' && stats.ups_load) {
                const value = stats.ups_load.value || stats.ups_load.current;
                element.textContent = `${value.toFixed(1)} %`;
            } else if (type === 'nominal') {
                // Check in order: ups_realpower_nominal, ups_power_nominal, then keep existing value
                if (stats.ups_realpower_nominal && stats.ups_realpower_nominal.value > 0) {
                    const value = stats.ups_realpower_nominal.value || stats.ups_realpower_nominal.current;
                    element.textContent = `${value.toFixed(1)} W`;
                    // Update the label to "Nominal Power"
                    const labelElement = element.parentElement.querySelector('.info-label');
                    if (labelElement) labelElement.textContent = 'Nominal Power:';
                } else if (stats.ups_power_nominal && stats.ups_power_nominal.value > 0) {
                    const value = stats.ups_power_nominal.value || stats.ups_power_nominal.current;
                    element.textContent = `${value.toFixed(1)} W`;
                    // Update the label to "Nominal Power"
                    const labelElement = element.parentElement.querySelector('.info-label');
                    if (labelElement) labelElement.textContent = 'Nominal Power:';
                }
                // If neither is available, keep the existing value and label (Manual Nominal Power)
            } else if (type === 'status' && stats.status) {
                const value = stats.status.value || stats.status.current;
                element.textContent = this.formatUPSStatus(value);
            }
        });
    }

    // New method to calculate smoothed values
    calculateSmoothedValue(buffer) {
        if (buffer.length === 0) return 0;
        
        // Use a weighted smoothing algorithm
        const weights = [];
        for (let i = 0; i < buffer.length; i++) {
            // Formula to give more weight to recent values
            weights.push(Math.pow(1.2, i));
        }
        
        const weightSum = weights.reduce((a, b) => a + b, 0);
        
        // Calculate weighted average
        let smoothedValue = 0;
        for (let i = 0; i < buffer.length; i++) {
            smoothedValue += buffer[i].y * weights[i];
        }
        
        return smoothedValue / weightSum;
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

    /**
     * Check if there is at least one hour of historical power data
     * This is used to determine if we should show today data or enforce realtime mode
     */
    async checkForOneHourData() {
        try {
            webLogger.data('Checking for one hour of historical power data');
            
            // Use the new API endpoint to check for hour data
            const response = await fetch('/api/power/has_hour_data');
            const data = await response.json();
            
            webLogger.data(`API returned has_data: ${data.has_data}`);
            
            return data.has_data;
        } catch (error) {
            webLogger.error('Error checking for one hour of power data:', error);
            return false;
        }
    }
    
    /**
     * Override the enforced realtime mode
     * This method is kept for backward compatibility with the Act command
     */
    overrideEnforcedRealtimeMode() {
        if (this.enforceRealtimeMode) {
            this.enforceRealtimeMode = false;
            // Don't show notification about override
            return true;
        } else {
            // Don't show notification about not being enforced
            return false;
        }
    }
}

// Initialize PowerPage once the DOM is fully loaded.
document.addEventListener('DOMContentLoaded', () => {
    new PowerPage();
}); 