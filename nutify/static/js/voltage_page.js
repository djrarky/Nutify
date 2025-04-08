class VoltagePage extends BasePage {
    constructor() {
        super();
        this.availableMetrics = null;
        this.isRealTimeMode = true;
        this.realTimeInterval = null;
        this.realTimeIntervalDuration = 1000;
        this.isFirstRealTimeUpdate = true;
        this.voltageMetrics = [];
        this.supportedCharts = new Set();
        this.widgetsInitialized = false;
        this.lastWebSocketData = null; // Store last WebSocket data
        this.webSocketManager = null; // WebSocket manager
        
        // Data buffers for realtime charts
        this.voltageDataBuffer = [];
        this.transferLowBuffer = [];
        this.transferHighBuffer = [];
        this.bufferSize = 15; // Buffer size for data smoothing
        
        // Add properties for Real Time mode enforcement
        this.enforceRealtimeMode = false; // Will be set to true only if not enough historical data
        this.realtimeStartTime = Date.now();
        this.realtimeDuration = 60 * 60 * 1000; // 1 hour in milliseconds
        this.realtimeCheckInterval = null;
        
        this._timezone = this.getConfiguredTimezone();
        
        // Make Act command available to override enforced realtime mode
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
                // Initialize the widgets once
                if (!this.widgetsInitialized) {
                    const widgetsContainer = document.getElementById('voltageWidgetsContainer');
                    if (widgetsContainer) {
                        this.renderVoltageWidgets(widgetsContainer);
                        this.widgetsInitialized = true;
                    }
                }
                
                // Initialize charts before checking data
                this.initCharts();
                
                // Check if we have enough historical data (1+ hour)
                const hasOneHourData = await this.checkForOneHourData();
                
                if (hasOneHourData) {
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
                    
                    this.updateDisplayedRange(`Today (00:00 - ${currentTime})`);
                    
                    // Load the today data
                    await this.loadData('today', '00:00', currentTime);
                    webLogger.data('Starting in Today mode with historical data');
                } else {
                    // If no historical data, enforce real-time mode for data collection
                    this.enforceRealtimeMode = true;
                    this.realtimeStartTime = Date.now();
                    webLogger.data('Not enough historical data found. Enforcing Real Time mode to collect at least one hour of data');
                    
                    // Show notification about enforced real-time mode
                    window.notify('Real Time mode enforced: waiting for 1 hour of data collection. You can switch to other modes from the time range menu.', 'warning');
                    
                    // Activate real-time mode in the UI
                    document.querySelectorAll('.range-options a').forEach(option => {
                        option.classList.remove('active');
                        if (option.dataset.range === 'realtime') {
                            option.classList.add('active');
                        }
                    });
                    
                    // Start real-time mode
                    this.startRealTimeMode();
                }
            } catch (error) {
                webLogger.error('Error in initialization:', error);
                
                // On error, default to real-time mode but don't enforce it
                this.startRealTimeMode();
            }
        })();
    }

    async initPage() {
        try {
            await this.loadMetrics();
            
            // Check if we have enough historical data (1+ hour)
            const hasOneHourData = await this.checkForOneHourData();
            
            if (!hasOneHourData) {
                // If no historical data, enforce real-time mode for data collection
                this.enforceRealtimeMode = true;
                this.realtimeStartTime = Date.now();
                webLogger.data('Not enough historical data found. Enforcing Real Time mode to collect at least one hour of data');
                
                // Show notification about enforced real-time mode
                window.notify('Real Time mode enforced: waiting for 1 hour of data collection. You can switch to other modes from the time range menu.', 'warning');
            }
            
            this.initCharts();
            this.initEventListeners();
            
            // Set the Real Time mode in the menu
            document.querySelectorAll('.range-options a').forEach(option => {
                option.classList.remove('active');
                if (option.dataset.range === 'realtime') {
                    option.classList.add('active');
                }
            });
            
            this.updateDisplayedRange('Real Time');
            this.startRealTimeUpdates();
            
            // If necessary, you can continue here with any other updates (e.g. widgets)
            const widgetsContainer = document.getElementById('voltageWidgetsContainer');
            if (widgetsContainer) {
                this.renderVoltageWidgets(widgetsContainer);
            }
            this.hideLoadingState();
        } catch (error) {
            webLogger.error('Error initializing page:', error);
            this.hideLoadingState();
        }
    }

    async loadMetrics() {
        try {
            const [metricsResponse, statusResponse] = await Promise.all([
                fetch('/api/voltage/metrics'),
                fetch('/api/data/ups_status')
            ]);
            
            const metricsData = await metricsResponse.json();
            const statusData = await statusResponse.json();
            
            if (metricsData.success && metricsData.data) {
                const processedMetrics = {};
                for (const [key, value] of Object.entries(metricsData.data)) {
                    if (key === 'input_sensitivity') {
                        processedMetrics[key] = String(value);
                    } else {
                        const numValue = parseFloat(value);
                        processedMetrics[key] = isNaN(numValue) ? '0.0' : numValue;
                    }
                }
                
                if (statusData.success && statusData.data) {
                    processedMetrics['ups_status'] = statusData.data.ups_status;
                }
                
                this.availableMetrics = processedMetrics;
                // Populate voltageMetrics with the available numeric metrics
                this.voltageMetrics = Object.keys(processedMetrics).filter(key => 
                    typeof processedMetrics[key] === 'number' && 
                    key !== 'ups_status'
                );
                webLogger.data('Available voltage metrics:', this.voltageMetrics);
                
                // Determine which charts are supported
                this.determineSupportedCharts();
            }
        } catch (error) {
            webLogger.error('Error loading metrics:', error);
            this.availableMetrics = {};
            this.voltageMetrics = [];
        }
    }

    // New method to determine which charts are supported
    determineSupportedCharts() {
        webLogger.data("Available metrics:", this.availableMetrics);
        
        // Voltage Chart
        if (this.availableMetrics['input_voltage'] || this.availableMetrics['output_voltage']) {
            this.supportedCharts.add('voltage');
            webLogger.data("Voltage chart supported");
        }
        
        // Voltage Nominal Chart
        if (this.availableMetrics['input_voltage_nominal'] || this.availableMetrics['output_voltage_nominal']) {
            this.supportedCharts.add('voltageNominal');
            webLogger.data("Voltage Nominal chart supported");
        }
        
        // Transfer Chart
        if (this.availableMetrics['input_transfer_low'] || this.availableMetrics['input_transfer_high']) {
            this.supportedCharts.add('transfer');
            webLogger.data("Transfer chart supported");
        }
        
        // Current Chart
        if (this.availableMetrics['input_current'] || this.availableMetrics['output_current']) {
            this.supportedCharts.add('current');
            webLogger.data("Current chart supported");
        }
        
        // Frequency Chart
        if (this.availableMetrics['input_frequency'] || this.availableMetrics['output_frequency']) {
            this.supportedCharts.add('frequency');
            webLogger.data("Frequency chart supported");
        }
        
        webLogger.data("Supported charts:", Array.from(this.supportedCharts));
    }

    // Modify initCharts to initialize only the supported charts
    initCharts() {
        webLogger.page('Initializing voltage charts');
        
        // First make all containers visible
        this.showCharts();
        
        // Voltage Monitor Chart (main chart with all voltages)
        if (this.supportedCharts.has('voltage')) {
            const voltageChartElement = document.getElementById('voltageChart');
            if (voltageChartElement) {
                webLogger.data('Initializing voltage monitor chart');
                
                // Determine which voltage metrics are available for this UPS
                const availableVoltageMetrics = [];
                const voltageColors = [];
                const strokeWidths = [];
                const dashArrays = [];
                
                // Check for input_voltage
                if (this.availableMetrics.hasOwnProperty('input_voltage') && 
                    this.availableMetrics.input_voltage !== undefined && 
                    this.availableMetrics.input_voltage !== null) {
                    availableVoltageMetrics.push('INPUT VOLTAGE');
                    voltageColors.push('#2E93fA');
                    strokeWidths.push(2);
                    dashArrays.push(0);
                }
                
                // Check for output_voltage
                if (this.availableMetrics.hasOwnProperty('output_voltage') && 
                    this.availableMetrics.output_voltage !== undefined && 
                    this.availableMetrics.output_voltage !== null) {
                    availableVoltageMetrics.push('OUTPUT VOLTAGE');
                    voltageColors.push('#66DA26');
                    strokeWidths.push(2);
                    dashArrays.push(0);
                }
                
                // Check for input_voltage_nominal
                if (this.availableMetrics.hasOwnProperty('input_voltage_nominal') && 
                    this.availableMetrics.input_voltage_nominal !== undefined && 
                    this.availableMetrics.input_voltage_nominal !== null) {
                    availableVoltageMetrics.push('INPUT NOMINAL');
                    voltageColors.push('#546E7A');
                    strokeWidths.push(1);
                    dashArrays.push(5);
                }
                
                // Check for output_voltage_nominal
                if (this.availableMetrics.hasOwnProperty('output_voltage_nominal') && 
                    this.availableMetrics.output_voltage_nominal !== undefined && 
                    this.availableMetrics.output_voltage_nominal !== null) {
                    availableVoltageMetrics.push('OUTPUT NOMINAL');
                    voltageColors.push('#546E7A');
                    strokeWidths.push(1);
                    dashArrays.push(5);
                }
                
                webLogger.data('Available voltage metrics for chart:', availableVoltageMetrics);
                
                // Initialize empty series for each available metric
                const emptySeries = availableVoltageMetrics.map(name => ({
                    name: name,
                    data: []
                }));
                
                this.voltageChart = new ApexCharts(voltageChartElement, {
                    series: emptySeries,
                    chart: {
                        type: 'line',
                        height: 350,
                        animations: {
                            enabled: true,
                            easing: 'linear',
                            dynamicAnimation: { speed: 1000 }
                        }
                    },
                    stroke: {
                        curve: 'smooth',
                        width: strokeWidths,
                        dashArray: dashArrays
                    },
                    colors: voltageColors,
                    legend: {
                        show: true,
                        position: 'top'
                    },
                    xaxis: {
                        type: 'datetime',
                        labels: { datetimeUTC: false }
                    },
                    yaxis: {
                        labels: {
                            formatter: (val) => val.toFixed(1) + "V"
                        }
                    }
                });
                this.voltageChart.render();
            }
        }

        // Transfer Thresholds Chart (chart of limits)
        if (this.supportedCharts.has('transfer')) {
            const transferChartElement = document.getElementById('transferChart');
            if (transferChartElement) {
                webLogger.data('Initializing transfer thresholds chart');
                this.transferChart = new ApexCharts(transferChartElement, {
                    series: [],
                    chart: {
                        type: 'line',
                        height: 350,
                        animations: {
                            enabled: true,
                            easing: 'linear',
                            dynamicAnimation: { speed: 1000 }
                        }
                    },
                    stroke: {
                        curve: 'smooth',
                        width: [2, 2, 1],  // Different thicknesses for the lines
                        dashArray: [0, 0, 5]  // Dashed line for the nominal
                    },
                    colors: ['#FF4560', '#FF4560', '#546E7A'],  // Red for the limits, gray for nominal
                    legend: {
                        show: true,
                        position: 'top'
                    },
                    xaxis: {
                        type: 'datetime',
                        labels: { datetimeUTC: false }
                    },
                    yaxis: {
                        labels: {
                            formatter: (val) => val.toFixed(1) + "V"
                        }
                    }
                });
                this.transferChart.render();
            }
        }
    }

    /**
     * Initialize the chart for Input/Output Voltage
     */
    initVoltageChart() {
        const el = document.querySelector("#voltageChart");
        webLogger.data("Voltage chart container:", el);
        if (!el) return;

        const group = ['input_voltage', 'output_voltage'];
        const series = [];
        group.forEach(metric => {
            if (this.availableMetrics && this.availableMetrics[metric] !== undefined) {
                series.push({
                    name: metric.replace(/_/g, ' ').toUpperCase(),
                    data: []
                });
            }
        });
        webLogger.data("Initial voltage series:", series);

        if (series.length > 0) {
            el.classList.remove("hidden");
            el.style.removeProperty('display');
            webLogger.data("Creating voltage chart with options:", {
                series,
                height: 350,
                type: 'line'
            });
            this.voltageChart = new ApexCharts(el, {
                series: series,
                chart: {
                    type: 'line',
                    height: 350,
                    animations: { enabled: true, easing: 'linear', dynamicAnimation: { speed: 1000 } }
                },
                stroke: {
                    curve: 'smooth',
                    width: 2
                },
                xaxis: { type: 'datetime', labels: { datetimeUTC: false } },
                yaxis: { title: { text: 'Voltage (V)' }, decimalsInFloat: 1 },
                tooltip: { shared: true, x: { format: 'dd MMM yyyy HH:mm:ss' } }
            });
            this.voltageChart.render();
            webLogger.data("Voltage chart rendered");
        } else {
            el.style.display = "none";
            webLogger.data("No series available for voltage chart");
        }
    }
    
    /**
     * Initialize the chart for Input/Output Voltage_nominal
     */
    initVoltageNominalChart() {
        const el = document.querySelector("#voltageNominalChart");
        webLogger.data("Voltage Nominal chart container:", el);
        if (!el) return;

        const group = ['input_voltage_nominal', 'output_voltage_nominal'];
        const series = [];
        group.forEach(metric => {
            if (this.availableMetrics && this.availableMetrics[metric] !== undefined) {
                series.push({
                    name: metric.replace(/_/g, ' ').toUpperCase(),
                    data: []
                });
            }
        });
        webLogger.data("Initial voltage nominal series:", series);

        if (series.length > 0) {
            el.classList.remove("hidden");
            el.style.removeProperty('display');
            webLogger.data("Creating voltage nominal chart with options:", {
                series,
                height: 350,
                type: 'line'
            });
            this.voltageNominalChart = new ApexCharts(el, {
                series: series,
                chart: { type: 'line', height: 350, animations: { enabled: true, easing: 'linear', dynamicAnimation: { speed: 1000 } } },
                stroke: {
                    curve: 'smooth',
                    width: 2
                },
                xaxis: { type: 'datetime', labels: { datetimeUTC: false } },
                yaxis: { title: { text: 'Voltage Nominal (V)' }, decimalsInFloat: 1 },
                tooltip: { shared: true, x: { format: 'dd MMM yyyy HH:mm:ss' } }
            });
            this.voltageNominalChart.render();
            webLogger.data("Voltage nominal chart rendered");
        } else {
            el.style.display = "none";
            webLogger.data("No series available for voltage nominal chart");
        }
    }
    
    /**
     * Initialize the chart for Input_TRANSFER_LOW and INPUT_TRANSFER_HIGH
     */
    initTransferChart() {
        const el = document.querySelector("#transferChart");
        webLogger.data("Transfer chart container:", el);
        if (!el) return;

        const group = ['input_transfer_low', 'input_transfer_high'];
        const series = [];
        group.forEach(metric => {
            if (this.availableMetrics && this.availableMetrics[metric] !== undefined) {
                series.push({
                    name: metric.replace(/_/g, ' ').toUpperCase(),
                    data: []
                });
            }
        });
        webLogger.data("Initial transfer series:", series);

        if (series.length > 0) {
            el.classList.remove("hidden");
            el.style.removeProperty('display');
            webLogger.data("Creating transfer chart with options:", {
                series,
                height: 350,
                type: 'line'
            });
            this.transferChart = new ApexCharts(el, {
                series: series,
                chart: { type: 'line', height: 350, animations: { enabled: true, easing: 'linear', dynamicAnimation: { speed: 1000 } } },
                stroke: {
                    curve: 'smooth',
                    width: 2
                },
                xaxis: { type: 'datetime', labels: { datetimeUTC: false } },
                yaxis: { title: { text: 'Transfer (V)' }, decimalsInFloat: 1 },
                tooltip: { shared: true, x: { format: 'dd MMM yyyy HH:mm:ss' } }
            });
            this.transferChart.render();
            webLogger.data("Transfer chart rendered");
        } else {
            el.style.display = "none";
            el.style.removeProperty('display');
            webLogger.data("No series available for transfer chart");
        }
    }
    
    /**
     * Initialize the chart for Input/Output Current
     */
    initCurrentChart() {
        const el = document.querySelector("#currentChart");
        if (!el) return;
        const group = ['input_current', 'output_current'];
        const series = [];
        group.forEach(metric => {
            if (this.availableMetrics && this.availableMetrics[metric] !== undefined) {
                series.push({
                    name: metric.replace(/_/g, ' ').toUpperCase(),
                    data: []
                });
            }
        });
        if (series.length > 0) {
            this.currentChart = new ApexCharts(el, {
                series: series,
                chart: { type: 'line', height: 350, animations: { enabled: true, easing: 'linear', dynamicAnimation: { speed: 1000 } } },
                xaxis: { type: 'datetime', labels: { datetimeUTC: false } },
                yaxis: { title: { text: 'Current (A)' }, decimalsInFloat: 1 },
                tooltip: { shared: true, x: { format: 'dd MMM yyyy HH:mm:ss' } }
            });
            this.currentChart.render();
        }
    }
    
    /**
     * Initialize the chart for Input/Output Frequency
     */
    initFrequencyChart() {
        const el = document.querySelector("#frequencyChart");
        if (!el) return;

        const group = ['input_frequency', 'output_frequency'];
        const series = [];
        group.forEach(metric => {
            if (this.availableMetrics && this.availableMetrics[metric] !== undefined) {
                series.push({
                    name: metric.replace(/_/g, ' ').toUpperCase(),
                    data: []
                });
            }
        });

        if (series.length > 0) {
            // Remove the hidden class (the container will be visible)
            el.classList.remove("hidden");
            el.style.removeProperty('display');
            this.frequencyChart = new ApexCharts(el, {
                series: series,
                chart: {
                    type: 'line',
                    height: 350,
                    animations: { enabled: true, easing: 'linear', dynamicAnimation: { speed: 1000 } }
                },
                xaxis: { type: 'datetime', labels: { datetimeUTC: false } },
                yaxis: { title: { text: 'Frequency (Hz)' }, decimalsInFloat: 1 },
                tooltip: { shared: true, x: { format: 'dd MMM yyyy HH:mm:ss' } }
            });
            this.frequencyChart.render();
        } else {
            // In the absence of data, ensure the container remains hidden
            el.style.display = "none";
        }
    }

    initCombinedChart() {
        const metrics = this.availableMetrics || {};
        const series = [];
        const colors = [
            '#2E93fA', '#66DA26', '#FF9800', '#E91E63', 
            '#546E7A', '#00E396', '#FEB019', '#4B0082'
        ];
        
        // Add a series for each available metric
        let colorIndex = 0;
        for (const [key, value] of Object.entries(metrics)) {
            // Exclude non-numeric or irrelevant metrics
            if (key === 'ups_status' || key === 'input_sensitivity') continue;
            
            series.push({
                name: key.replace(/_/g, ' ').toUpperCase(),
                data: [],
                color: colors[colorIndex % colors.length],
                type: 'line'
            });
            colorIndex++;
        }

        const options = {
            series: series,
            chart: {
                type: 'line',
                height: 450,
                animations: {
                    enabled: true,
                    easing: 'linear',
                    dynamicAnimation: {
                        speed: 1000
                    }
                }
            },
            stroke: {
                curve: 'smooth',
                width: 2
            },
            xaxis: {
                type: 'datetime'
            },
            yaxis: {
                title: {
                    text: 'Value'
                },
                labels: {
                    formatter: function(val) {
                        return val.toFixed(1);
                    }
                }
            },
            tooltip: {
                shared: true,
                intersect: false,
                x: {
                    format: 'dd MMM yyyy HH:mm:ss'
                }
            },
            legend: {
                position: 'top',
                horizontalAlign: 'center'
            }
        };

        this.combinedChart = new ApexCharts(
            document.querySelector("#combinedVoltageChart"), 
            options
        );
        this.combinedChart.render();
    }

    initFrequencyChart(element) {
        const options = {
            series: [
                {
                    name: 'Input Frequency',
                    data: [],
                    color: '#2E93fA'
                },
                {
                    name: 'Output Frequency',
                    data: [],
                    color: '#66DA26'
                }
            ],
            chart: {
                type: 'line',
                height: 350,
                animations: {
                    enabled: true,
                    easing: 'linear',
                    dynamicAnimation: {
                        speed: 1000
                    }
                }
            },
            stroke: {
                curve: 'smooth',
                width: 2
            },
            xaxis: {
                type: 'datetime'
            },
            yaxis: {
                title: {
                    text: 'Frequency (Hz)'
                }
            },
            tooltip: {
                x: {
                    format: 'dd MMM yyyy HH:mm:ss'
                }
            }
        };

        this.frequencyChart = new ApexCharts(element, options);
        this.frequencyChart.render();
    }

    setupRealTimeUpdates() {
        const socket = io();
        
        socket.on('voltage_update', (data) => {
            if (this.isRealTimeMode) {
                this.updateChartsRealTime(data);
                this.updateStats(data);
            }
        });
    }

    async loadData(period = 'day', fromTime = null, toTime = null, selectedDay = null) {
        try {
            this.showLoadingState();
            webLogger.data('Loading data with params:', { period, fromTime, toTime, selectedDay });
            
            const params = new URLSearchParams();
            params.append('period', period);

            switch (period) {
                case 'today':
                    if (fromTime) params.append('from_time', fromTime);
                    if (toTime) params.append('to_time', toTime);
                    break;
                    
                case 'day':
                    if (selectedDay) {
                        params.append('selected_day', selectedDay);
                        params.append('from_time', '00:00');
                        params.append('to_time', '23:59');
                    }
                    break;
                    
                case 'range':
                    if (fromTime) params.append('from_time', fromTime);
                    if (toTime) params.append('to_time', toTime);
                    break;
            }

            webLogger.data('Request params:', Object.fromEntries(params));
            
            const response = await fetch(`/api/voltage/history?${params.toString()}`);
            const data = await response.json();
            
            webLogger.data('Historical data received:', data);

            if (!data.success || !data.data) {
                throw new Error('Failed to load voltage data');
            }

            // Update the charts with the new data
            await this.updateChartsWithHistoricalData(data.data);

            this.hideLoadingState();
        } catch (error) {
            webLogger.error('Error loading voltage data:', error);
            this.hideLoadingState();
            this.showError('Error loading voltage data');
        }
    }

    // New method to update the charts with historical data
    async updateChartsWithHistoricalData(data) {
        // Voltage Monitor Chart (main chart)
        if (this.voltageChart && this.supportedCharts.has('voltage')) {
            const voltageSeries = [];
            
            // Add series only if data exists
            if (data.input_voltage && data.input_voltage.length > 0) {
                voltageSeries.push({
                    name: 'INPUT VOLTAGE',
                    data: data.input_voltage.map(point => ({
                        x: new Date(point.timestamp).getTime(),
                        y: parseFloat(point.value)
                    }))
                });
            }

            if (data.output_voltage && data.output_voltage.length > 0) {
                voltageSeries.push({
                    name: 'OUTPUT VOLTAGE',
                    data: data.output_voltage.map(point => ({
                        x: new Date(point.timestamp).getTime(),
                        y: parseFloat(point.value)
                    }))
                });
            }

            if (data.input_voltage_nominal && data.input_voltage_nominal.length > 0) {
                voltageSeries.push({
                    name: 'INPUT NOMINAL',
                    data: data.input_voltage_nominal.map(point => ({
                        x: new Date(point.timestamp).getTime(),
                        y: parseFloat(point.value)
                    }))
                });
            }

            if (data.output_voltage_nominal && data.output_voltage_nominal.length > 0) {
                voltageSeries.push({
                    name: 'OUTPUT NOMINAL',
                    data: data.output_voltage_nominal.map(point => ({
                        x: new Date(point.timestamp).getTime(),
                        y: parseFloat(point.value)
                    }))
                });
            }

            webLogger.data('Updating voltage chart with series:', voltageSeries);
            await this.voltageChart.updateSeries(voltageSeries);
        }

        // Transfer Chart (chart of limits)
        if (this.transferChart && this.supportedCharts.has('transfer')) {
            const transferSeries = [];
            
            // INPUT TRANSFER LOW
            if (data.input_transfer_low && data.input_transfer_low.length > 0) {
                transferSeries.push({
                    name: 'INPUT TRANSFER LOW',
                    data: data.input_transfer_low.map(point => ({
                        x: new Date(point.timestamp).getTime(),
                        y: parseFloat(point.value)
                    }))
                });
            }

            // INPUT TRANSFER HIGH
            if (data.input_transfer_high && data.input_transfer_high.length > 0) {
                transferSeries.push({
                    name: 'INPUT TRANSFER HIGH',
                    data: data.input_transfer_high.map(point => ({
                        x: new Date(point.timestamp).getTime(),
                        y: parseFloat(point.value)
                    }))
                });
            }

            // VOLTAGE NOMINAL as a reference
            if (data.input_voltage_nominal && data.input_voltage_nominal.length > 0) {
                transferSeries.push({
                    name: 'NOMINAL REFERENCE',
                    data: data.input_voltage_nominal.map(point => ({
                        x: new Date(point.timestamp).getTime(),
                        y: parseFloat(point.value)
                    }))
                });
            }

            webLogger.data('Updating transfer chart with series:', transferSeries);
            await this.transferChart.updateSeries(transferSeries);
        }
    }

    async updateCharts(data) {
        webLogger.page('Updating charts with data');
        
        if (this.combinedChart) {
            const voltageData = {
                input: [],
                output: [],
                inputCurrent: [],
                outputCurrent: []
            };

            if (data.input_voltage) {
                voltageData.input = data.input_voltage.map(point => ({
                    x: new Date(point.timestamp).getTime(),
                    y: parseFloat(point.value)
                }));
            }
            if (data.output_voltage) {
                voltageData.output = data.output_voltage.map(point => ({
                    x: new Date(point.timestamp).getTime(),
                    y: parseFloat(point.value)
                }));
            }
            if (data.input_current) {
                voltageData.inputCurrent = data.input_current.map(point => ({
                    x: new Date(point.timestamp).getTime(),
                    y: parseFloat(point.value)
                }));
            }
            if (data.output_current) {
                voltageData.outputCurrent = data.output_current.map(point => ({
                    x: new Date(point.timestamp).getTime(),
                    y: parseFloat(point.value)
                }));
            }

            await this.combinedChart.updateSeries([
                { name: 'Input Voltage', data: voltageData.input },
                { name: 'Output Voltage', data: voltageData.output },
                { name: 'Input Current', data: voltageData.inputCurrent },
                { name: 'Output Current', data: voltageData.outputCurrent }
            ]);
        }

        if (this.frequencyChart && (data.input_frequency || data.output_frequency)) {
            const freqData = {
                input: data.input_frequency ? data.input_frequency.map(point => ({
                    x: new Date(point.timestamp).getTime(),
                    y: parseFloat(point.value)
                })) : [],
                output: data.output_frequency ? data.output_frequency.map(point => ({
                    x: new Date(point.timestamp).getTime(),
                    y: parseFloat(point.value)
                })) : []
            };

            await this.frequencyChart.updateSeries([
                { name: 'Input Frequency', data: freqData.input },
                { name: 'Output Frequency', data: freqData.output }
            ]);
        }

        if (this.qualityChart && data.voltage_quality) {
            const qualityData = data.voltage_quality.map(point => ({
                x: new Date(point.timestamp).getTime(),
                y: parseFloat(point.value)
            }));

            await this.qualityChart.updateSeries([
                { name: 'Voltage Quality', data: qualityData }
            ]);
        }
    }

    updateChartsRealTime(data) {
        if (this.combinedChart) {
            const newTime = new Date().getTime();
            const inputVoltage = (data.input_voltage !== undefined) ? data.input_voltage : 0;
            const outputVoltage = (data.output_voltage !== undefined) ? data.output_voltage : 0;
            const inputCurrent = (data.input_current !== undefined) ? data.input_current : 0;
            const outputCurrent = (data.output_current !== undefined) ? data.output_current : 0;
            webLogger.console('Updating combinedChart at time:', newTime);

            // Retrieve the current data of the series
            let s0 = this.combinedChart.w.config.series[0].data || [];
            let s1 = this.combinedChart.w.config.series[1].data || [];
            let s2 = this.combinedChart.w.config.series[2].data || [];
            let s3 = this.combinedChart.w.config.series[3].data || [];

            // If the series is empty, insert a small initial point in the past
            if (s0.length === 0) {
                s0 = [{ x: newTime - 1000, y: inputVoltage }, { x: newTime, y: inputVoltage }];
                s1 = [{ x: newTime - 1000, y: outputVoltage }, { x: newTime, y: outputVoltage }];
                s2 = [{ x: newTime - 1000, y: inputCurrent }, { x: newTime, y: inputCurrent }];
                s3 = [{ x: newTime - 1000, y: outputCurrent }, { x: newTime, y: outputCurrent }];
            } else {
                s0.push({ x: newTime, y: inputVoltage });
                s1.push({ x: newTime, y: outputVoltage });
                s2.push({ x: newTime, y: inputCurrent });
                s3.push({ x: newTime, y: outputCurrent });
            }

            this.combinedChart.updateSeries([
                { data: s0 },
                { data: s1 },
                { data: s2 },
                { data: s3 }
            ]);
        } else {
            console.error('Combined chart not initialized');
        }
    }

    updateStats(stats) {
        document.querySelectorAll('.stat-value').forEach(element => {
            const type = element.dataset.type;
            if (!type || stats[type] === undefined || stats[type] === null) return;
            
            try {
                let displayValue;
                if (type === 'input_sensitivity') {
                    displayValue = stats[type];
                } else {
                    const value = parseFloat(stats[type].current || stats[type].value || stats[type] || 0);
                    displayValue = isNaN(value) ? '0.0' : value.toFixed(1);
                    
                    switch(type) {
                        case 'input_voltage':
                        case 'output_voltage':
                        case 'input_voltage_nominal':
                        case 'output_voltage_nominal':
                        case 'input_transfer_low':
                        case 'input_transfer_high':
                            displayValue += 'V';
                            break;
                        case 'input_current':
                        case 'output_current':
                            displayValue += 'A';
                            break;
                        case 'input_frequency':
                        case 'output_frequency':
                            displayValue += 'Hz';
                            break;
                    }
                }
                element.textContent = displayValue;
            } catch (error) {
                logger.error(`Error updating stat ${type}`);
                element.textContent = '0.0';
            }
        });
    }

    renderVoltageWidgets(element) {
        if (!element || !this.availableMetrics) return;

        // List of metrics to show in the widgets (remove ups_status and ups_load)
        const allowedMetrics = [
            'input_voltage',
            'output_voltage',
            'input_voltage_nominal',
            'output_voltage_nominal',
            'input_transfer_low',
            'input_transfer_high',
            'input_frequency',
            'output_frequency',
            'input_sensitivity'
        ];

        const voltageVariables = [];
        
        // Filter and format only the allowed metrics
        for (const [key, value] of Object.entries(this.availableMetrics)) {
            if (!allowedMetrics.includes(key)) continue;

            let unit = '';
            let icon = 'fa-chart-line';
            
            if (key.includes('voltage')) {
                unit = 'V';
                icon = 'fa-bolt';
            } else if (key.includes('current')) {
                unit = 'A';
                icon = 'fa-wave-square';
            } else if (key.includes('frequency')) {
                unit = 'Hz';
                icon = 'fa-tachometer-alt';
            } else if (key.includes('transfer')) {
                unit = 'V';
                icon = 'fa-exchange-alt';
            } else if (key.includes('sensitivity')) {
                icon = 'fa-sliders-h';
            }

            // Format the value
            let displayValue;
            if (key === 'input_sensitivity') {
                displayValue = value;
            } else {
                displayValue = typeof value === 'number' ? 
                              value.toFixed(1) + unit : 
                              value + unit;
            }

            // Format the label
            const label = key
                .replace(/_/g, ' ')
                .split(' ')
                .map(word => word.charAt(0).toUpperCase() + word.slice(1))
                .join(' ');

            voltageVariables.push({
                name: key,
                value: displayValue,
                icon: icon,
                label: label
            });
        }

        // Generate the HTML for the normal widgets instead of mini
        const widgetsHtml = voltageVariables.map(variable => `
            <div class="stat_card">
                <div class="stat-icon">
                    <i class="fas ${variable.icon}"></i>
                </div>
                <div class="stat-content">
                    <div class="stat-header">
                        <span class="stat-label">${variable.label}</span>
                        <span class="selected-period">Now</span>
                    </div>
                    <span class="stat-value" data-type="${variable.name}">${variable.value}</span>
                </div>
                <div class="background-chart" id="${variable.name}BackgroundChart"></div>
            </div>
        `).join('');

        element.innerHTML = widgetsHtml;
    }

    async initEventListeners() {
        webLogger.page('Initializing event listeners');

        // --- Dropdown menu management ---
        const dateRangeBtn = document.getElementById('dateRangeBtn');
        const dateRangeDropdown = document.getElementById('dateRangeDropdown');
        
        if (dateRangeBtn) {
            dateRangeBtn.addEventListener('click', (e) => {
                e.preventDefault();
                dateRangeDropdown.classList.toggle('hidden');
            });
        }

        // Close the dropdown if clicked outside
        document.addEventListener('click', (e) => {
            if (!dateRangeBtn?.contains(e.target) && !dateRangeDropdown?.contains(e.target)) {
                dateRangeDropdown?.classList.add('hidden');
            }
        });

        // --- Range options management ---
        document.querySelectorAll('.range-options a').forEach(option => {
            option.addEventListener('click', (e) => {
                e.preventDefault();
                const range = e.target.dataset.range;
                
                // Show notification but don't block if real-time mode is enforced
                if (this.enforceRealtimeMode && range !== 'realtime') {
                    // Calculate hours since real-time mode was started, only if realtimeStartTime is set
                    if (this.realtimeStartTime) {
                        const currentTime = Date.now();
                        const elapsedTime = currentTime - this.realtimeStartTime;
                        // Only show if more than 1 minute has passed (to avoid showing on initial load)
                        if (elapsedTime > 60000) {
                            const hoursSinceStart = (elapsedTime / (1000 * 60 * 60)).toFixed(1);
                            // Don't show any notification here
                        }
                    }
                }
                
                // Remove active from all options
                document.querySelectorAll('.range-options a').forEach(opt => {
                    opt.classList.remove('active');
                });
                
                // Add active to the selected option
                e.target.classList.add('active');

                // Hide all panels of the menu
                document.querySelectorAll('.time-range-selector, .day-selector, .range-selector, .realtime-selector').forEach(selector => {
                    selector.classList.add('hidden');
                });

                switch (range) {
                    case 'realtime':
                        document.getElementById('realtimeSelectorPanel')?.classList.remove('hidden');
                        this.startRealTimeMode();
                        break;
                    case 'today':
                        const now = new Date();
                        const currentTime = now.toLocaleTimeString(
                            window.APP_CONFIG && window.APP_CONFIG.locale ? 
                            window.APP_CONFIG.locale : undefined, 
                            { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: this._timezone }
                        );
                        this.stopRealTimeUpdates();
                        this.updateDisplayedRange(`Today (00:00 - ${currentTime})`);
                        this.loadData('today', '00:00', currentTime);
                        break;
                    case 'day':
                        document.getElementById('daySelectorPanel')?.classList.remove('hidden');
                        break;
                    case 'range':
                        document.getElementById('rangeSelectorPanel')?.classList.remove('hidden');
                        break;
                }
            });
        });

        // --- Apply buttons management ---
        const applyRealTime = document.getElementById('applyRealTime');
        if (applyRealTime) {
            applyRealTime.addEventListener('click', () => {
                const intervalInput = document.getElementById('realtimeInterval');
                const newInterval = parseInt(intervalInput.value);
                if (!isNaN(newInterval) && newInterval > 0) {
                    this.realTimeIntervalDuration = newInterval * 1000;
                    this.startRealTimeUpdates();
                    this.updateDisplayedRange(`Real Time (every ${newInterval}s)`);
                    dateRangeDropdown?.classList.add('hidden');
                }
            });
        }

        const applyDay = document.getElementById('applyDay');
        if (applyDay) {
            applyDay.addEventListener('click', () => {
                const dayPicker = document.getElementById('dayPicker');
                if (dayPicker && dayPicker.value) {
                    this.stopRealTimeUpdates();
                    this.updateDisplayedRange(`Selected Day: ${dayPicker.value}`);
                    this.loadData('day', null, null, dayPicker.value);
                    dateRangeDropdown?.classList.add('hidden');
                }
            });
        }

        const applyRange = document.getElementById('applyRange');
        if (applyRange) {
            applyRange.addEventListener('click', async () => {
                const fromDate = document.getElementById('rangeFromDate');
                const toDate = document.getElementById('rangeToDate');
                if (fromDate && toDate && fromDate.value && toDate.value) {
                    this.stopRealTimeUpdates();
                    
                    // Reset and reinitialize the charts before loading new data
                    this.resetCharts();
                    this.initCharts();
                    
                    // Format the dates in the correct format (YYYY-MM-DD)
                    const fromDateStr = fromDate.value;
                    const toDateStr = toDate.value;
                    
                    this.updateDisplayedRange(`Range: ${fromDateStr} - ${toDateStr}`);
                    await this.loadData('range', fromDateStr, toDateStr);
                    dateRangeDropdown?.classList.add('hidden');
                    
                    // Log for debugging
                    webLogger.data('Loading date range:', {
                        from: fromDateStr,
                        to: toDateStr
                    });
                }
            });
        }
    }

    showLoadingState() {
        const container = document.querySelector('.voltage_page');
        if (container) {
            container.classList.add('loading');
            const loader = document.createElement('div');
            loader.className = 'page-loader';
            loader.innerHTML = '<div class="loader"></div>';
            container.appendChild(loader);
        }
    }

    hideLoadingState() {
        const container = document.querySelector('.voltage_page');
        if (container) {
            container.classList.remove('loading');
            const loader = container.querySelector('.page-loader');
            if (loader) {
                loader.remove();
            }
        }
    }

    updateDisplayedRange(text) {
        const rangeSpan = document.querySelector('.selected-range');
        if (rangeSpan) {
            rangeSpan.textContent = text;
        }
    }

    showError(message) {
        // Use the standardized notification system with error type
        window.notify(message, 'error');
    }

    showNotification(message, type = 'info') {
        // Use the standardized notification system
        window.notify(message, type);
    }

    startRealTimeUpdates() {
        // Now this method is just a wrapper that calls startRealTimeMode
        // to maintain compatibility with the parts of the code that call it
        this.startRealTimeMode();
    }

    stopRealTimeUpdates() {
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
        
        // Destroy Chart.js charts if they exist
        if (this.voltageChart && this.voltageChart.destroy) {
            this.voltageChart.destroy();
            this.voltageChart = null;
        }
        
        if (this.transferChart && this.transferChart.destroy) {
            this.transferChart.destroy();
            this.transferChart = null;
        }
        
        // Clear the containers
        const voltageContainer = document.querySelector('#voltageChart');
        if (voltageContainer) voltageContainer.innerHTML = '';
        
        const transferContainer = document.querySelector('#transferChart');
        if (transferContainer) transferContainer.innerHTML = '';
        
        // Reinitialize the charts with ApexCharts
        this.initCharts();
    }

    startRealTimeMode() {
        webLogger.console('Starting realtime mode with Chart.js');
        this.isRealTimeMode = true;
        this.isFirstRealTimeUpdate = true;
        
        // Record start time for the 1-hour persistence if not already set
        if (!this.realtimeStartTime) {
            this.realtimeStartTime = Date.now();
        }
        
        // Stop any previous intervals
        if (this.realTimeInterval) {
            clearInterval(this.realTimeInterval);
            this.realTimeInterval = null;
        }
        
        // Also clear any previous check interval
        if (this.realtimeCheckInterval) {
            clearInterval(this.realtimeCheckInterval);
            this.realtimeCheckInterval = null;
        }
        
        // Reset charts before initialization
        if (this.voltageChart && typeof this.voltageChart.destroy === 'function') {
            this.voltageChart.destroy();
            this.voltageChart = null;
        }
        
        if (this.transferChart && typeof this.transferChart.destroy === 'function') {
            this.transferChart.destroy();
            this.transferChart = null;
        }

        // // Show notification about simulated data
        // this.showNotification('Initializing charts with simulated data before transitioning to real-time updates', 'info');

        // First try to load Chart.js and Chart.js Streaming plugin
        const hasChartJs = typeof Chart !== 'undefined';
        
        if (!hasChartJs) {
            const chartJsScript = document.createElement('script');
            chartJsScript.src = '/static/lib/chart.js/chart.umd.js';
            chartJsScript.onload = () => {
                const streamingScript = document.createElement('script');
                streamingScript.src = '/static/lib/chart.js/chartjs-plugin-streaming.min.js';
                streamingScript.onload = () => {
                    // Now that Chart.js and streaming plugin are loaded, initialize charts with synthetic data
                    webLogger.console('Initializing Chart.js realtime charts with synthetic data first');
                    this.initializeRealtimeCharts();
                };
                document.head.appendChild(streamingScript);
            };
            chartJsScript.onerror = () => {
                webLogger.error('Failed to load Chart.js, falling back to ApexCharts');
                // Reinitialize the charts with ApexCharts
                this.initCharts();
                // Set up an interval for real-time data loading
                this.realTimeInterval = setInterval(() => {
                    // If WebSocket data is available, use it
                    if (this.lastWebSocketData) {
                        this.updateChartsRealTime(this.lastWebSocketData);
                    }
                }, 1000);
            };
            document.head.appendChild(chartJsScript);
        } else {
            // Chart.js is already loaded, initialize charts with synthetic data
            webLogger.console('Using existing Chart.js to initialize charts with synthetic data first');
            this.initializeRealtimeCharts();
        }
        
        // Update the user interface
        document.querySelectorAll('.chart-container').forEach(container => {
            container.classList.remove('hidden');
        });
        
        // Set realtime mode in the UI
        this.updateDisplayedRange('Real Time');
        
        // If enforceRealtimeMode is true, set up an interval to check for sufficient data
        if (this.enforceRealtimeMode) {
            webLogger.data('Setting up periodic check for data availability in enforced real-time mode');
            
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
                            webLogger.data('Voltage data now has sufficient data (1+ hour)');
                            // Disable enforced real-time mode
                            this.enforceRealtimeMode = false;
                            // Don't show notification that data collection is complete
                        } else {
                            webLogger.data('Voltage data still lacks sufficient data');
                            // Don't show notification about still collecting data
                        }
                    });
                }
            }, 5 * 60 * 1000); // Check every 5 minutes
        }
    }

    initializeRealtimeCharts() {
        // Initialize realtime voltage and transfer charts with Chart.js
        this.initializeRealtimeVoltageChart();
        this.initializeRealtimeTransferChart();
    }

    initializeRealtimeVoltageChart() {
        // Get the chart container
        const container = document.querySelector('#voltageChart');
        if (!container) {
            console.error('Container #voltageChart not found');
            return;
        }
        
        // If an ApexCharts chart already exists, destroy it
        if (this.voltageChart && typeof this.voltageChart.destroy === 'function') {
            this.voltageChart.destroy();
        }
        
        // Remove the ApexCharts element and create a new canvas
        container.innerHTML = '';
        const canvas = document.createElement('canvas');
        canvas.id = 'realtimeVoltageChart';
        container.appendChild(canvas);
        
        const ctx = canvas.getContext('2d');
        
        // Determine which voltage metrics are available for this UPS
        const hasInputVoltage = this.availableMetrics.hasOwnProperty('input_voltage') && 
                                this.availableMetrics.input_voltage !== undefined && 
                                this.availableMetrics.input_voltage !== null;
        
        const hasOutputVoltage = this.availableMetrics.hasOwnProperty('output_voltage') && 
                                 this.availableMetrics.output_voltage !== undefined && 
                                 this.availableMetrics.output_voltage !== null;
        
        webLogger.data('Realtime available metrics - Input voltage:', hasInputVoltage, 'Output voltage:', hasOutputVoltage);
        
        // Generate synthetic data for initial chart display
        const now = Date.now();
        const syntheticData = this.generateSyntheticVoltageData(now);

        webLogger.console('Generated synthetic voltage data:', syntheticData);
        
        // Initialize the data buffer with synthetic data
        this.voltageDataBuffer = [];
        this.bufferSize = 15; // As in main_page.js for better smoothing
        
        // Prefill the data buffer with synthetic data
        if (hasInputVoltage && syntheticData.inputVoltage.length > 0) {
            for (let i = 0; i < syntheticData.inputVoltage.length; i++) {
                this.voltageDataBuffer.push({
                    timestamp: syntheticData.inputVoltage[i].x,
                    input: syntheticData.inputVoltage[i].y,
                    output: hasOutputVoltage ? syntheticData.outputVoltage[i].y : 0
                });
            }
        }
        
        // Create datasets only for available metrics
        const datasets = [];
        
        if (hasInputVoltage) {
            // Create a gradient for filling under the input line
            const inputGradient = ctx.createLinearGradient(0, 0, 0, 300);
            inputGradient.addColorStop(0, 'rgba(46, 147, 250, 0.3)');
            inputGradient.addColorStop(1, 'rgba(46, 147, 250, 0.0)');
            
            datasets.push({
                label: 'Input Voltage',
                backgroundColor: inputGradient,
                borderColor: '#2E93fA',
                borderWidth: 2.5,
                data: syntheticData.inputVoltage,
                pointRadius: 0,
                tension: 0.4,
                fill: true,
                cubicInterpolationMode: 'monotone'
            });
        }
        
        if (hasOutputVoltage) {
            // Create a gradient for filling under the output line
            const outputGradient = ctx.createLinearGradient(0, 0, 0, 300);
            outputGradient.addColorStop(0, 'rgba(102, 218, 38, 0.2)');
            outputGradient.addColorStop(1, 'rgba(102, 218, 38, 0.0)');
            
            datasets.push({
                label: 'Output Voltage',
                backgroundColor: outputGradient,
                borderColor: '#66DA26',
                borderWidth: 2.5,
                data: syntheticData.outputVoltage,
                pointRadius: 0,
                tension: 0.4,
                fill: true,
                cubicInterpolationMode: 'monotone'
            });
        }
        
        // If no metrics are available, show a message
        if (datasets.length === 0) {
            console.warn('No voltage metrics available for realtime chart');
            const infoDiv = document.createElement('div');
            infoDiv.className = 'chart-no-data';
            infoDiv.textContent = 'No voltage data available for this UPS';
            container.appendChild(infoDiv);
            return;
        }
        
        // Chart.js chart configuration
        const chartConfig = {
            type: 'line',
            data: {
                datasets: datasets
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    streaming: {
                        duration: 60000, // Show only 60 seconds
                        refresh: 1000,
                        delay: 1000,
                        onRefresh: this.onVoltageChartRefresh.bind(this)
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
                        min: 0, // Set a fixed minimum at 0
                        max: (context) => {
                            if (context.chart.data.datasets[0].data.length > 0) {
                                const values = [];
                                context.chart.data.datasets.forEach(dataset => {
                                    values.push(...dataset.data.map(d => d.y));
                                });
                                const maxValue = Math.max(...values);
                                // Ensure a minimum of at least 120V to always display the chart
                                return Math.max(120, Math.ceil(maxValue * 1.1));
                            }
                            return 120;
                        },
                        grid: {
                            display: false
                        },
                        ticks: {
                            color: '#2E93fA'
                        },
                        title: {
                            display: true,
                            text: 'Voltage (V)',
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
        this.voltageChart = new Chart(ctx, chartConfig);
        
        // Save reference to available metrics for updating
        this.realtimeHasInputVoltage = hasInputVoltage;
        this.realtimeHasOutputVoltage = hasOutputVoltage;
        
        webLogger.console('Realtime Chart.js initialized for voltage with synthetic data');
    }

    initializeRealtimeTransferChart() {
        // Get the chart container
        const container = document.querySelector('#transferChart');
        if (!container) {
            console.error('Container #transferChart not found');
            return;
        }
        
        // If an ApexCharts chart already exists, destroy it
        if (this.transferChart && typeof this.transferChart.destroy === 'function') {
            this.transferChart.destroy();
        }
        
        // Remove the ApexCharts element and create a new canvas
        container.innerHTML = '';
        const canvas = document.createElement('canvas');
        canvas.id = 'realtimeTransferChart';
        container.appendChild(canvas);
        
        const ctx = canvas.getContext('2d');
        
        // Create gradients for filling under the lines
        const gradientLow = ctx.createLinearGradient(0, 0, 0, 300);
        gradientLow.addColorStop(0, 'rgba(255, 69, 96, 0.2)');
        gradientLow.addColorStop(1, 'rgba(255, 69, 96, 0.0)');
        
        const gradientHigh = ctx.createLinearGradient(0, 0, 0, 300);
        gradientHigh.addColorStop(0, 'rgba(255, 69, 96, 0.2)');
        gradientHigh.addColorStop(1, 'rgba(255, 69, 96, 0.0)');
        
        // Generate synthetic data for initial chart display
        const now = Date.now();
        const syntheticData = this.generateSyntheticTransferData(now);
        
        webLogger.console('Generated synthetic transfer data:', syntheticData);
        
        // Initialize the data buffers with synthetic data
        this.transferLowBuffer = [];
        this.transferHighBuffer = [];
        
        // Prefill the buffers with synthetic data
        if (syntheticData.transferLow.length > 0) {
            for (let i = 0; i < syntheticData.transferLow.length; i++) {
                this.transferLowBuffer.push({
                    time: syntheticData.transferLow[i].x,
                    value: syntheticData.transferLow[i].y
                });
                
                this.transferHighBuffer.push({
                    time: syntheticData.transferHigh[i].x,
                    value: syntheticData.transferHigh[i].y
                });
            }
        }
        
        // Chart.js chart configuration
        const chartConfig = {
            type: 'line',
            data: {
                datasets: [
                    {
                        label: 'Transfer Low',
                        backgroundColor: gradientLow,
                        borderColor: '#FF4560',
                        borderWidth: 2.5,
                        data: syntheticData.transferLow,
                        pointRadius: 0,
                        tension: 0.4,
                        fill: false,
                        cubicInterpolationMode: 'monotone'
                    },
                    {
                        label: 'Transfer High',
                        backgroundColor: gradientHigh,
                        borderColor: '#FF4560',
                        borderWidth: 2.5,
                        data: syntheticData.transferHigh,
                        pointRadius: 0,
                        tension: 0.4,
                        fill: false,
                        cubicInterpolationMode: 'monotone'
                    },
                    {
                        label: 'Nominal Reference',
                        backgroundColor: 'rgba(84, 110, 122, 0.1)',
                        borderColor: '#546E7A',
                        borderWidth: 1.5,
                        borderDash: [5, 5],
                        data: syntheticData.nominal,
                        pointRadius: 0,
                        tension: 0.4,
                        fill: false
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
                        onRefresh: this.onTransferChartRefresh.bind(this)
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
                        // Improved configuration for auto zoom
                        adaprive: true,  // Enable automatic adaptation
                        min: (context) => {
                            if (context.chart.data.datasets[0].data.length > 0 || 
                                context.chart.data.datasets[1].data.length > 0) {
                                const values = [];
                                context.chart.data.datasets.forEach(dataset => {
                                    values.push(...dataset.data.map(d => d.y));
                                });
                                const minValue = Math.min(...values);
                                
                                // Return a minimum value with 10% padding, but not less than 100V
                                return Math.max(100, Math.floor(minValue * 0.9));
                            }
                            return 100;
                        },
                        max: (context) => {
                            if (context.chart.data.datasets[0].data.length > 0 || 
                                context.chart.data.datasets[1].data.length > 0) {
                                const values = [];
                                context.chart.data.datasets.forEach(dataset => {
                                    values.push(...dataset.data.map(d => d.y));
                                });
                                const maxValue = Math.max(...values);
                                
                                // Return a maximum value with 10% padding, but not less than 300V
                                return Math.max(300, Math.ceil(maxValue * 1.1));
                            }
                            return 300;
                        },
                        grid: {
                            display: false
                        },
                        ticks: {
                            color: '#FF4560'
                        },
                        title: {
                            display: true,
                            text: 'Threshold (V)',
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
        this.transferChart = new Chart(ctx, chartConfig);
        
        webLogger.console('Realtime Chart.js initialized for transfer thresholds with synthetic data');
    }

    // Method to update the voltage chart in real time
    onVoltageChartRefresh(chart) {
        const now = Date.now();

        // If we have WebSocket data, use it
        if (this.lastWebSocketData) {
            const data = this.lastWebSocketData;
            
            // Log first time transition from synthetic to real data
            if (this.isFirstRealTimeUpdate) {
                webLogger.console('Received first WebSocket data! Transitioning from synthetic to real data on voltage chart.');
                this.isFirstRealTimeUpdate = false;
            }
            
            // Extract the voltage values only for the available metrics
            const inputVoltage = this.realtimeHasInputVoltage ? parseFloat(data.input_voltage || 0) : null;
            const outputVoltage = this.realtimeHasOutputVoltage ? parseFloat(data.output_voltage || 0) : null;
            
            // Add new points to the buffer only for the available metrics
            const bufferEntry = { time: now };
            if (inputVoltage !== null) bufferEntry.input = inputVoltage;
            if (outputVoltage !== null) bufferEntry.output = outputVoltage;
            
            this.voltageDataBuffer.push(bufferEntry);

            // Keep the buffer at the correct size
            if (this.voltageDataBuffer.length > this.bufferSize) {
                this.voltageDataBuffer.shift();
            }

            // Update the datasets based on the available metrics
            let datasetIndex = 0;
            
            // Update the input voltage dataset if available
            if (this.realtimeHasInputVoltage) {
                const smoothedInput = this.calculateSmoothedValue(this.voltageDataBuffer, 'input');
                chart.data.datasets[datasetIndex].data.push({
                    x: now,
                    y: smoothedInput
                });
                datasetIndex++;
            }
            
            // Update the output voltage dataset if available
            if (this.realtimeHasOutputVoltage) {
                const smoothedOutput = this.calculateSmoothedValue(this.voltageDataBuffer, 'output');
                chart.data.datasets[datasetIndex].data.push({
                    x: now,
                    y: smoothedOutput
                });
            }

            // Update also the statistics data
            this.updateWidgetValues(data);
            
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
        // If no real data is available, use simulated data with variations
        else if (chart.data.datasets[0].data.length > 0) {
            // Get the last data point from each dataset
            const datasets = chart.data.datasets;
            let datasetIndex = 0;
            
            // Add small variations to the last data point for input voltage
            if (this.realtimeHasInputVoltage) {
                const lastPoint = datasets[datasetIndex].data[datasets[datasetIndex].data.length - 1];
                const lastY = lastPoint.y;
                const variation = lastY * (Math.random() * 0.01 - 0.005); // ±0.5% variation
                
                datasets[datasetIndex].data.push({
                    x: now,
                    y: Math.max(lastY + variation, 1)
                });
                
                datasetIndex++;
            }
            
            // Add small variations to the last data point for output voltage
            if (this.realtimeHasOutputVoltage) {
                const lastPoint = datasets[datasetIndex].data[datasets[datasetIndex].data.length - 1];
                const lastY = lastPoint.y;
                const variation = lastY * (Math.random() * 0.01 - 0.005); // ±0.5% variation
                
                datasets[datasetIndex].data.push({
                    x: now,
                    y: Math.max(lastY + variation, 1)
                });
            }
            
            chart.update('quiet');
        }
        
        // Return a resolved promise to avoid errors
        return Promise.resolve();
    }

    // Method to update the transfer chart in real time
    onTransferChartRefresh(chart) {
        const now = Date.now();
        
        // If we have WebSocket data, use it
        if (this.lastWebSocketData) {
            const data = this.lastWebSocketData;
            
            // Extract the transfer values
            const transferLow = parseFloat(data.input_transfer_low || 0);
            const transferHigh = parseFloat(data.input_transfer_high || 0);
            const voltageNominal = parseFloat(data.input_voltage_nominal || 0);
            
            // Add new points to the buffer
            this.transferLowBuffer.push({
                time: now,
                value: transferLow
            });
            
            this.transferHighBuffer.push({
                time: now,
                value: transferHigh
            });

            // Keep the buffers at the correct size
            if (this.transferLowBuffer.length > this.bufferSize) {
                this.transferLowBuffer.shift();
            }
            
            if (this.transferHighBuffer.length > this.bufferSize) {
                this.transferHighBuffer.shift();
            }

            // Calculate the smoothed points using the buffers
            const smoothedLow = this.calculateSmoothedValueSimple(this.transferLowBuffer);
            const smoothedHigh = this.calculateSmoothedValueSimple(this.transferHighBuffer);

            // Add the smoothed points to the chart datasets
            chart.data.datasets[0].data.push({
                x: now,
                y: smoothedLow
            });
            
            chart.data.datasets[1].data.push({
                x: now,
                y: smoothedHigh
            });
            
            chart.data.datasets[2].data.push({
                x: now,
                y: voltageNominal
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
        // If no real data is available, use simulated data with variations
        else if (chart.data.datasets[0].data.length > 0) {
            // Get the last data points
            const lastLowPoint = chart.data.datasets[0].data[chart.data.datasets[0].data.length - 1];
            const lastHighPoint = chart.data.datasets[1].data[chart.data.datasets[1].data.length - 1];
            const lastNominalPoint = chart.data.datasets[2].data[chart.data.datasets[2].data.length - 1];
            
            // Add minimal variations to thresholds (they're usually fixed values)
            const lowVariation = lastLowPoint.y * (Math.random() * 0.002 - 0.001); // ±0.1% variation
            const highVariation = lastHighPoint.y * (Math.random() * 0.002 - 0.001); // ±0.1% variation
            
            // Add new points with variations
            chart.data.datasets[0].data.push({
                x: now,
                y: Math.max(lastLowPoint.y + lowVariation, 100)
            });
            
            chart.data.datasets[1].data.push({
                x: now,
                y: Math.max(lastHighPoint.y + highVariation, 200)
            });
            
            chart.data.datasets[2].data.push({
                x: now,
                y: lastNominalPoint.y  // No variation for nominal
            });
            
            chart.update('quiet');
        }
        
        // Return a resolved promise to avoid errors
        return Promise.resolve();
    }

    // Calculate a smoothed value from a data buffer
    calculateSmoothedValue(buffer, propertyName) {
        if (!buffer || buffer.length === 0) return 0;
        
        // Get the last few values (up to bufferSize)
        const recentValues = buffer.slice(-this.bufferSize).filter(entry => entry[propertyName] !== undefined);
        
        if (recentValues.length === 0) return 0;
        
        // Calculate average of recent values
        const sum = recentValues.reduce((acc, entry) => acc + entry[propertyName], 0);
        return sum / recentValues.length;
    }
    
    // Simplified version for transfer buffers
    calculateSmoothedValueSimple(buffer) {
        if (!buffer || buffer.length === 0) return 0;
        
        // Get the last few values (up to bufferSize)
        const recentValues = buffer.slice(-this.bufferSize).map(entry => entry.value);
        
        if (recentValues.length === 0) return 0;
        
        // Calculate average of recent values
        const sum = recentValues.reduce((acc, val) => acc + val, 0);
        return sum / recentValues.length;
    }

    // Method to convert a hex color to rgba
    hexToRgba(hex, alpha) {
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }

    // New function to reset the charts: destroy the instances and reinitialize them
    resetCharts() {
        if (this.voltageChart) {
            this.voltageChart.destroy();
            this.voltageChart = null;
        }
        if (this.voltageNominalChart) {
            this.voltageNominalChart.destroy();
            this.voltageNominalChart = null;
        }
        if (this.transferChart) {
            this.transferChart.destroy();
            this.transferChart = null;
        }
    }

    async checkHistoricalData() {
        try {
            // Request historical voltage data for "day" period
            const response = await fetch('/api/voltage/history?period=today');
            const data = await response.json();
            
            if (!data.success) {
                webLogger.error('API returned error:', data.error);
                return false;
            }

            if (!data.data) {
                webLogger.error('No data returned from API');
                return false;
            }

            // Set a minimum threshold, for example at least 2 points for a metric
            const threshold = 2;

            // Check that at least one of the metrics has a number of points >= threshold
            const hasEnoughData = Object.keys(data.data).some(key => {
                return Array.isArray(data.data[key]) && data.data[key].length >= threshold;
            });

            webLogger.data(`Historical data check - Has enough data: ${hasEnoughData}`);
            if (hasEnoughData) {
                Object.keys(data.data).forEach(key => {
                    webLogger.data(`Points available for ${key}: ${data.data[key]?.length || 0}`);
                });
            }

            return hasEnoughData;
        } catch (error) {
            webLogger.error('Error checking voltage historical data:', error);
            return false;
        }
    }

    updateWidgetValues(metrics) {
        document.querySelectorAll('.stat-value').forEach(element => {
            const type = element.dataset.type;
            if (!type || !metrics[type]) return;

            let value = metrics[type];
            let displayValue;

            if (type === 'input_sensitivity') {
                displayValue = value;
            } else {
                value = parseFloat(value);
                if (isNaN(value)) return;
                
                displayValue = value.toFixed(1);
                
                // Add the appropriate unit of measurement
                if (type.includes('voltage') || type.includes('transfer')) {
                    displayValue += 'V';
                } else if (type.includes('current')) {
                    displayValue += 'A';
                } else if (type.includes('frequency')) {
                    displayValue += 'Hz';
                }
            }

            element.textContent = displayValue;
        });
    }

    showCharts() {
        // Make all charts containers visible
        document.querySelectorAll('.chart-container').forEach(container => {
            container.classList.remove('hidden');
            // Remove also display:none if present
            container.style.removeProperty('display');
        });
    }

    hideCharts() {
        document.querySelectorAll('.chart-container').forEach(container => {
            container.classList.add('hidden');
        });
    }

    /**
     * Initialize WebSocket connection for real-time cache updates
     */
    initWebSocket() {
        // Check if CacheWebSocketManager is available
        if (typeof CacheWebSocketManager === 'undefined') {
            webLogger.error('CacheWebSocketManager not available for Voltage page.');
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
                }
            },
            onConnect: () => webLogger.data('Voltage page connected to WebSocket'),
            onDisconnect: () => webLogger.warning('Voltage page disconnected from WebSocket'),
            debug: false
        });
    }

    /**
     * Check if there is at least one hour of historical voltage data
     * This is used to determine if we should show today data or enforce realtime mode
     */
    async checkForOneHourData() {
        try {
            webLogger.data('Checking for one hour of historical voltage data');
            
            // Use the new API endpoint to check for hour data
            const response = await fetch('/api/voltage/has_hour_data');
            const data = await response.json();
            
            webLogger.data(`API returned has_data: ${data.has_data}`);
            
            return data.has_data;
        } catch (error) {
            webLogger.error('Error checking for one hour of voltage data:', error);
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
     * Generate synthetic data to fill the voltage chart initially
     * @param {Date} endTime - The end time for the synthetic data (typically now)
     * @returns {Object} Object containing voltage data arrays
     */
    generateSyntheticVoltageData(endTime) {
        const inputVoltageData = [];
        const outputVoltageData = [];
        
        // Use cached or default voltage values
        let baseInputVoltage = 230; // Default input voltage
        let baseOutputVoltage = 230; // Default output voltage
        
        // Try to get values from localStorage
        const cachedInputVoltage = localStorage.getItem('lastInputVoltageValue');
        const cachedOutputVoltage = localStorage.getItem('lastOutputVoltageValue');
        
        if (cachedInputVoltage) {
            baseInputVoltage = Math.max(parseFloat(cachedInputVoltage), 220);
        }
        
        if (cachedOutputVoltage) {
            baseOutputVoltage = Math.max(parseFloat(cachedOutputVoltage), 220);
        }
        
        // If we have real-time data from WebSocket, use it instead of cache
        if (this.lastWebSocketData) {
            const data = this.lastWebSocketData;
            
            if (data.input_voltage !== undefined) {
                baseInputVoltage = Math.max(parseFloat(data.input_voltage), 220);
            }
            
            if (data.output_voltage !== undefined) {
                baseOutputVoltage = Math.max(parseFloat(data.output_voltage), 220);
            }
            
            webLogger.console(`Using WebSocket data for synthetic initialization: Input=${baseInputVoltage}V, Output=${baseOutputVoltage}V`);
        } else {
            webLogger.console(`Using cached/default values for synthetic initialization: Input=${baseInputVoltage}V, Output=${baseOutputVoltage}V`);
        }
        
        // Generate 30 points over 60 seconds (1 point every 2 seconds)
        for (let i = 0; i < 30; i++) {
            // Calculate time points to fill exactly 60 seconds back from endTime
            const time = new Date(endTime - (60 * 1000) + (i * 2000)); // One point every 2 seconds
            
            // Add small random variations to create natural-looking lines
            const inputVariation = baseInputVoltage * (Math.random() * 0.01 - 0.005); // ±0.5% variation
            const outputVariation = baseOutputVoltage * (Math.random() * 0.01 - 0.005); // ±0.5% variation
            
            // Calculate the values with variation
            const inputValue = Math.max(baseInputVoltage + inputVariation, 220);
            const outputValue = Math.max(baseOutputVoltage + outputVariation, 220);
            
            // Add data points
            inputVoltageData.push({
                x: time.getTime(),
                y: inputValue
            });
            
            outputVoltageData.push({
                x: time.getTime(),
                y: outputValue
            });
        }
        
        return {
            inputVoltage: inputVoltageData,
            outputVoltage: outputVoltageData
        };
    }
    
    /**
     * Generate synthetic data for transfer thresholds chart
     * @param {Date} endTime - The end time for the synthetic data
     * @returns {Object} Object containing transfer threshold data arrays
     */
    generateSyntheticTransferData(endTime) {
        const transferLowData = [];
        const transferHighData = [];
        const nominalData = [];
        
        // Use values from availableMetrics or defaults
        let baseLowValue = 180; // Default transfer low value
        let baseHighValue = 270; // Default transfer high value
        let baseNominalValue = 230; // Default nominal value
        
        // Try to get values from availableMetrics
        if (this.availableMetrics) {
            if (this.availableMetrics.input_transfer_low !== undefined) {
                baseLowValue = Math.max(parseFloat(this.availableMetrics.input_transfer_low), 100);
            }
            
            if (this.availableMetrics.input_transfer_high !== undefined) {
                baseHighValue = Math.max(parseFloat(this.availableMetrics.input_transfer_high), 200);
            }
            
            if (this.availableMetrics.input_voltage_nominal !== undefined) {
                baseNominalValue = Math.max(parseFloat(this.availableMetrics.input_voltage_nominal), 100);
            }
        }
        
        // If we have real-time data from WebSocket, use it instead
        if (this.lastWebSocketData) {
            const data = this.lastWebSocketData;
            
            if (data.input_transfer_low !== undefined) {
                baseLowValue = Math.max(parseFloat(data.input_transfer_low), 100);
            }
            
            if (data.input_transfer_high !== undefined) {
                baseHighValue = Math.max(parseFloat(data.input_transfer_high), 200);
            }
            
            if (data.input_voltage_nominal !== undefined) {
                baseNominalValue = Math.max(parseFloat(data.input_voltage_nominal), 100);
            }
            
            webLogger.data(`Using WebSocket data for transfer synthetic initialization: Low=${baseLowValue}V, High=${baseHighValue}V, Nominal=${baseNominalValue}V`);
        } else {
            webLogger.data(`Using metrics values for transfer synthetic initialization: Low=${baseLowValue}V, High=${baseHighValue}V, Nominal=${baseNominalValue}V`);
        }
        
        // Generate points (transfer thresholds usually don't change, so less variation needed)
        for (let i = 0; i < 30; i++) {
            const time = new Date(endTime - (60 * 1000) + (i * 2000));
            
            // Almost no variation for transfer thresholds as they are steady values
            const lowVariation = baseLowValue * (Math.random() * 0.002 - 0.001); // ±0.1% variation
            const highVariation = baseHighValue * (Math.random() * 0.002 - 0.001); // ±0.1% variation
            
            // No variation for nominal
            
            transferLowData.push({
                x: time.getTime(),
                y: baseLowValue + lowVariation
            });
            
            transferHighData.push({
                x: time.getTime(),
                y: baseHighValue + highVariation
            });
            
            nominalData.push({
                x: time.getTime(),
                y: baseNominalValue
            });
        }
        
        return {
            transferLow: transferLowData,
            transferHigh: transferHighData,
            nominal: nominalData
        };
    }
}

// Initialize VoltagePage once the DOM is fully loaded
document.addEventListener('DOMContentLoaded', () => {
    new VoltagePage();
});