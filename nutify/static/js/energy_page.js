class EnergyPage extends BasePage {
    constructor() {
        super();
        webLogger.page('Initializing EnergyPage');
        
        // Initialize the energy logger
        this.energyLogger = new EnergyLogger();
        
        this.costTrendChart = null;
        this.usagePatternChart = null;
        this.currency = 'EUR';
        this.pricePerKwh = 0;
        this.co2Factor = 0;
        this.efficiencyFactor = 0;
        this.realtimeInterval = null;
        this.fromDate = null;
        this.toDate = null;
        this.isRealTimeMode = true;
        // WebSocket related properties
        this.lastWebSocketData = null;
        this.webSocketManager = null;
        
        // Buffer for data smoothing - matching MainPage configuration
        this.bufferSize = 15;
        this.dataBuffer = [];
        
        // Realtime mode persistence
        this.realtimeStartTime = Date.now();
        this.realtimeDuration = 60 * 60 * 1000; // 1 hour in milliseconds
        this.enforceRealtimeMode = true; // Controls initial display mode only, not subsequent selections
        
        // Make logging functions available from the console
        window.toggleEnergyLogging = () => {
            if (this.energyLogger) {
                return this.energyLogger.toggleLogging();
            }
            return false;
        };
        
        // Make Act command available to override enforced realtime mode
        window.Act = () => {
            if (this.overrideEnforcedRealtimeMode()) {
                console.log('Realtime mode enforcement overridden via Act command');
                return 'You can now switch to other time ranges';
            }
            return 'Realtime mode was not being enforced or was already overridden';
        };
        
        webLogger.data('Setting up initial configuration');
        this.bindModalCloseEvent();

        const usagePatternChart = document.querySelector('#usagePatternChart');
        if (usagePatternChart) {
            const container = usagePatternChart.closest('.card');
            if (container) {
                container.classList.add('usage-pattern-card');
                if (this.isRealTimeMode) {
                    container.classList.add('hidden');
                }
            }
        }

        (async () => {
            try {
                // Load variables first
                await this.loadVariables();
                
                // Log our intent
                webLogger.page('Checking if we should enforce Real Time mode...');
                
                // Force Real Time mode for 1 hour when starting with a fresh database
                const hasEnoughData = await this.checkForOneHourData();
                
                // Log the result of our check 
                webLogger.page(`Data check result: ${hasEnoughData ? 'SUFFICIENT DATA' : 'INSUFFICIENT DATA'}`);
                webLogger.page(`Will ${!hasEnoughData ? 'ENFORCE' : 'NOT ENFORCE'} Real Time mode`);
                
                // If we have insufficient data, enforce RealTime mode
                if (!hasEnoughData) {
                    // Retry the check again with a direct API call to ensure we get the latest data
                    webLogger.page('Double-checking data availability with direct API call...');
                    
                    try {
                        // Get current time in a format expected by the API
                        const now = new Date();
                        const currentTime = now.toLocaleTimeString(window.APP_CONFIG && window.APP_CONFIG.locale ? 
                            window.APP_CONFIG.locale : undefined, { hour: '2-digit', minute: '2-digit' });
                        
                        // Force API cache refresh by adding a timestamp
                        const timestamp = Date.now();
                        const response = await fetch(`/api/energy/data?type=today&from_time=00:00&to_time=${encodeURIComponent(currentTime)}&_=${timestamp}`);
                        const data = await response.json();
                        
                        let hasData = false;
                        
                        // Check distribution data for timestamps
                        if (data && data.distribution && data.distribution.length > 0) {
                            if (data.distribution[0].timestamp) {
                                const sortedData = [...data.distribution].sort((a, b) => 
                                    new Date(a.timestamp) - new Date(b.timestamp));
                                
                                if (sortedData.length >= 2) {
                                    const firstTimestamp = new Date(sortedData[0].timestamp);
                                    const lastTimestamp = new Date(sortedData[sortedData.length - 1].timestamp);
                                    const timeDiff = lastTimestamp - firstTimestamp;
                                    const hourInMs = 60 * 60 * 1000;
                                    
                                    if (timeDiff >= hourInMs && sortedData.length >= 30) {
                                        hasData = true;
                                        webLogger.page(`Second check found sufficient data: ${sortedData.length} points spanning ${(timeDiff/(60*1000)).toFixed(1)} minutes`);
                                    }
                                }
                            }
                        }
                        
                        // If the direct check found data, override the initial result
                        if (hasData) {
                            webLogger.page('Direct API check found sufficient data, switching to Today view');
                            // Run the Today mode initialization code
                            this.isRealTimeMode = false;
                            this.enforceRealtimeMode = false;
                            
                            // Get current time for display
                            const now = new Date();
                            const currentTime = now.toLocaleTimeString(window.APP_CONFIG && window.APP_CONFIG.locale ? 
                                window.APP_CONFIG.locale : undefined, { hour: '2-digit', minute: '2-digit' });
                            
                            // Initialize normal charts
                            this.initCharts();
                            
                            // Set the values of the time fields
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
                            
                            // Load today data
                            await this.loadData('today', '00:00', currentTime);
                            
                            // Initialize socket listeners
                            this.initSocketListeners();
                            
                            // Exit the constructor flow
                            return;
                        }
                    } catch (error) {
                        webLogger.page('Error during direct API check, proceeding with original result');
                        console.error('Error during direct API check:', error);
                    }
                    
                    // If we're here, we didn't find data in the second check
                    // Proceed with realtime mode
                    // If there is not enough data (less than 1 hour), force RealTime mode
                    webLogger.page('Enforcing Real Time mode due to insufficient data');
                    this.isRealTimeMode = true;
                    this.enforceRealtimeMode = true;
                    
                    // Update the UI
                    this.updateDisplayedRange('Real Time');
                    document.querySelectorAll('.range-options a').forEach(option => {
                        option.classList.remove('active');
                        if (option.dataset.range === 'realtime') {
                            option.classList.add('active');
                        }
                    });

                    // Initialize charts for realtime mode
                    this.initRealtimeCostTrendChart();
                    
                    // Hide Daily Cost Distribution chart and adjust layout
                    const dailyDistributionCard = document.getElementById('dailyDistributionCard');
                    if (dailyDistributionCard) {
                        dailyDistributionCard.style.display = 'none';
                    }
                    const chartsContainer = document.getElementById('chartsContainer');
                    if (chartsContainer) {
                        chartsContainer.style.gridTemplateColumns = '1fr';
                    }

                    // Start realtime updates
                    this.startRealTimeUpdates();
                    
                    // Show notification about enforced Real Time mode
                    window.notify('Real Time mode enforced: waiting for 1 hour of data collection. You can switch to other modes from the time range menu.', 'warning');
                } else {
                    // If there is enough data (at least 1 hour), allow Today mode
                    webLogger.page('Found sufficient historical data, not enforcing Real Time mode');
                    this.isRealTimeMode = false;
                    this.enforceRealtimeMode = false;
                    
                    // Get current time for display
                    const now = new Date();
                    const currentTime = now.toLocaleTimeString(window.APP_CONFIG && window.APP_CONFIG.locale ? 
                        window.APP_CONFIG.locale : undefined, { hour: '2-digit', minute: '2-digit' });
                    
                    // Initialize normal charts
                    this.initCharts();
                    
                    // Set the values of the time fields
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
                    
                    // Load today data
                    await this.loadData('today', '00:00', currentTime);
                }

                // Initialize socket listeners
                this.initSocketListeners();
                
                // Log settings for debugging
                webLogger.console('Current settings:');
                webLogger.console('- Real Time mode:', this.isRealTimeMode);
                webLogger.console('- Enforce Real Time mode:', this.enforceRealtimeMode);

            } catch (error) {
                console.error('Error during initialization:', error);
                
                // In case of error, default to Real Time mode
                this.enforceRealtimeMode = true;
                this.isRealTimeMode = true;
                this.initRealtimeCostTrendChart();
                this.startRealTimeUpdates();
            }
        })();
    }

    async init() {
        webLogger.console('Starting EnergyPage initialization');
        try {
            // Load variables and initialize charts, listeners and socket
            await this.loadVariables();
            this.initCharts();
            this.initEventListeners();
            this.initSocketListeners();

            // Get the current time
            const now = new Date();
            const currentTime = now.toLocaleTimeString(window.APP_CONFIG && window.APP_CONFIG.locale ? window.APP_CONFIG.locale : undefined, { hour: '2-digit', minute: '2-digit' });

            // Set Today as default in the dropdown menu
            const dateRangeBtn = document.getElementById('dateRangeBtn');
            const dateRangeDropdown = document.getElementById('dateRangeDropdown');
            if (dateRangeBtn && dateRangeDropdown) {
                const todayOption = dateRangeDropdown.querySelector('a[data-range="0"]');
                if (todayOption) {
                    dateRangeDropdown.querySelectorAll('a').forEach(a => a.classList.remove('active'));
                    todayOption.classList.add('active');
                }
                const timeRange = `Today (00:00 - ${currentTime})`;
                const selectedRange = dateRangeBtn.querySelector('.selected-range');
                if (selectedRange) {
                    selectedRange.textContent = timeRange;
                }
                document.querySelectorAll('.selected-period').forEach(span => {
                    span.textContent = timeRange;
                });
            }

            // Check if the database is populated
            const hasEnoughData = await this.checkHistoricalData();
            if (hasEnoughData) {
                await this.loadData('today', '00:00', currentTime);
            } else {
                console.log('Database in phase of population - Real Time mode activated');
                document.querySelectorAll('.range-options a').forEach(option => {
                    option.classList.remove('active');
                    if (option.dataset.range === 'realtime') {
                        option.classList.add('active');
                    }
                });
                this.updateDisplayedRange('Real Time');
                this.startRealtimeUpdates();
                this.hideLoadingState();
            }

            webLogger.console('EnergyPage initialization completed');
        } catch (error) {
            console.error('Error during initialization:', error);
        }
    }

    async loadVariables() {
        try {
            const response = await fetch('/api/settings/variables');
            const data = await response.json();
            if (data.success && data.data) {
                this.currency = data.data.currency;
                this.pricePerKwh = parseFloat(data.data.price_per_kwh);
                this.co2Factor = parseFloat(data.data.co2_factor);
                this.efficiencyFactor = parseFloat(data.data.efficiency_factor);
                
                // Update the displayed value
                const rateValueElement = document.querySelector('.rate_value');
                if (rateValueElement) {
                    const currencySymbol = this.getCurrencySymbol(this.currency);
                    rateValueElement.textContent = `${this.pricePerKwh.toFixed(4)}${currencySymbol}/kWh`;
                }

                // Update cost icon in "Total Cost" widget based on the selected currency
                const costIcon = document.querySelector('.stat_card[data-type="cost"] .stat-icon i');
                if (costIcon) {
                    costIcon.classList.remove('fa-euro-sign', 'fa-dollar-sign', 'fa-pound-sign', 'fa-yen-sign', 'fa-franc-sign', 'fa-rupee-sign', 'fa-ruble-sign');
                    if (this.currency === 'EUR') {
                        costIcon.classList.add('fa-euro-sign');
                    } else if (this.currency === 'USD') {
                        costIcon.classList.add('fa-dollar-sign');
                    } else if (this.currency === 'GBP') {
                        costIcon.classList.add('fa-pound-sign');
                    } else if (this.currency === 'JPY' || this.currency === 'CNY') {
                        costIcon.classList.add('fa-yen-sign');
                    } else if (this.currency === 'CHF') {
                        costIcon.classList.add('fa-franc-sign');
                    } else if (this.currency === 'INR') {
                        costIcon.classList.add('fa-rupee-sign');
                    } else if (this.currency === 'RUB') {
                        costIcon.classList.add('fa-ruble-sign');
                    } else if (this.currency === 'KRW') {
                        costIcon.classList.add('fa-won-sign');
                    } else {
                        costIcon.classList.add('fa-dollar-sign');
                    }
                }
            }
        } catch (error) {
            console.error('Error loading variables:', error);
        }
    }

    getCurrencySymbol(currency) {
        const symbols = {
            'EUR': '€',
            'USD': '$',
            'GBP': '£',
            'JPY': '¥',
            'AUD': 'A$',
            'CAD': 'C$',
            'CHF': 'Fr',
            'CNY': '¥',
            'INR': '₹',
            'NZD': 'NZ$',
            'BRL': 'R$',
            'RUB': '₽',
            'KRW': '₩',
            'PLN': 'PLN'
        };
        return symbols[currency] || currency;
    }

    initCharts() {
        this.initCostTrendChart();
        this.initUsagePatternChart();
    }

    async loadData(period = 'day', fromTime = null, toTime = null) {
        try {
            webLogger.data('Loading energy data', { period, fromTime, toTime });
            
            // Save the date range for 'range'
            if (period === 'range') {
                this.fromDate = fromTime;
                this.toDate = toTime;
            }
            
            const params = new URLSearchParams();
            if (fromTime) params.append('from_time', fromTime);
            if (toTime) params.append('to_time', toTime);
            params.append('type', period);
            
            webLogger.data('Fetching data with params', Object.fromEntries(params));
            const response = await fetch(`/api/energy/data?${params}`);
            const data = await response.json();
            
            webLogger.data('Received energy data', data);

            if (data) {
                await this.updateStatsCards(data);
                await this.updateCostTrendChart(period, fromTime, toTime);
                await this.updateUsagePatternChart(period, { from_time: fromTime, to_time: toTime });
                webLogger.page('Energy data updated successfully');
            }
        } catch (error) {
            webLogger.error('Error loading energy data', error);
            this.showError('Failed to load energy data');
        }
    }

    async fetchData(params) {
        try {
            webLogger.console('=== START fetchData ===');
            const url = `/api/energy/data?${params.toString()}`;
            
            webLogger.console('Fetching URL:', url);
            webLogger.console('Parameters:', Object.fromEntries(params));
            
            const response = await fetch(url);
            webLogger.console('Response status:', response.status);
            
            if (!response.ok) {
                const errorText = await response.text();
                console.error('API Error Response:', errorText);
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const data = await response.json();
            webLogger.console('API Response data:', data);
            return data;
        } catch (error) {
            console.error('Fetch error:', error);
            this.showError(`Failed to fetch data: ${error.message}`);
            return null;
        }
    }

    formatTime(time) {
        if (!time) return null;
        if (/^\d{2}:\d{2}$/.test(time)) return time;
        const [hours, minutes] = time.split(':');
        return `${hours.padStart(2, '0')}:${minutes.padStart(2, '0')}`;
    }

    /**
     * Updates statistics cards based on the selected time range
     * @param {Object} data - Data from API
     * @param {string} timeRange - Current time range mode
     */
    async updateStatsCards(data) {
        webLogger.console('=== START updateStatsCards ===');
        webLogger.console('Updating stats with data:', data);
        
        if (!data || typeof data !== 'object') {
            console.error('Invalid data structure for stats cards');
            return;
        }

        // Ensure all values are positive or zero
        const stats = {
            energy: Math.max(0, data.totalEnergy || data.total_energy || 0),
            cost: Math.max(0, data.totalCost || data.total_cost || 0),
            load: Math.max(0, Math.min(100, data.avgLoad || data.avg_load || 0)),
            co2: Math.max(0, data.co2 || 0)
        };

        // Log stats values for debugging
        webLogger.console('Stats values for display:', stats);

        // Update the values in the stat cards
        Object.entries(stats).forEach(([type, value]) => {
            const valueElement = document.querySelector(`.stat-value[data-type="${type}"]`);
            if (valueElement) {
                if (type === 'cost') {
                    if (this.isRealTimeMode) {
                        valueElement.textContent = `${this.getCurrencySymbol(this.currency)}${value.toFixed(4)}`;
                    } else {
                        valueElement.textContent = `${this.getCurrencySymbol(this.currency)}${value.toFixed(2)}`;
                    }
                } else if (type === 'energy') {
                    if (this.isRealTimeMode) {
                        // Real-time data is in watts - show the exact value
                        const watts = value;
                        webLogger.console(`Displaying energy value: ${watts} watts`);
                        if (watts < 1000) {
                            valueElement.textContent = `${watts.toFixed(1)} W`;
                        } else {
                            valueElement.textContent = `${(watts/1000).toFixed(2)} kW`;
                        }
                    } else {
                        // For historical data use Wh under 1000, kWh above 1000
                        const wh = parseFloat(value);
                        if (wh < 1000) {
                            valueElement.textContent = `${wh.toFixed(1)} Wh`;
                        } else {
                            valueElement.textContent = `${(wh/1000).toFixed(2)} kWh`;
                        }
                    }
                } else if (type === 'load') {
                    const loadValue = parseFloat(value);
                    if (!isNaN(loadValue)) {
                        valueElement.textContent = `${loadValue.toFixed(1)}%`;
                    } else {
                        valueElement.textContent = '0.0%';
                    }
                } else if (type === 'co2') {
                    valueElement.textContent = `${value.toFixed(2)} kg`;
                }
            }
        });

        // Update trends if available
        if (data.trends) {
            this.updateTrends(data.trends);
        }

        webLogger.console('=== END updateStatsCards ===');
    }

    // Graph Energy cost trend //
    initCostTrendChart() {
        webLogger.chart('Initializing cost trend chart');
        const self = this;
        
        const options = {
            chart: {
                type: 'bar',
                height: 350,
                animations: {
                    enabled: true,
                    easing: 'linear',
                    dynamicAnimation: {
                        speed: 1000
                    }
                },
                events: {
                    dataPointSelection: (event, chartContext, config) => {
                        // Debug log to see the timestamp format
                        webLogger.console('Selected data point:', {
                            dataPointIndex: config.dataPointIndex,
                            seriesIndex: config.seriesIndex,
                            data: config.w.config.series[0].data[config.dataPointIndex]
                        });
                        
                        const dataPoint = config.w.config.series[0].data[config.dataPointIndex];
                        // Check if the dataPoint is an array or an object
                        const timestamp = Array.isArray(dataPoint) ? dataPoint[0] : dataPoint.x;
                        
                        // Enhanced logging for selected datapoint
                        console.log(
                            '%c === ENERGY COST TREND - SELECTED DATAPOINT ===',
                            'background: #8c4d0a; color: white; padding: 4px 8px; border-radius: 3px; font-weight: bold;'
                        );
                        
                        if (dataPoint) {
                            const pointValue = Array.isArray(dataPoint) ? dataPoint[1] : dataPoint.y;
                            const watt = this.pricePerKwh > 0 ? (pointValue * 1000 / this.pricePerKwh) : 0;
                            
                            console.log(
                                '%c SELECTED POINT DETAILS',
                                'background: #0a8c4d; color: white; padding: 2px 5px; border-radius: 3px;',
                                '\n',
                                'Timestamp:', new Date(timestamp).toLocaleString(),
                                '\n',
                                'Detailed Cost:', pointValue.toFixed(6), this.getCurrencySymbol(this.currency),
                                '\n',
                                'Detailed Watt:', watt.toFixed(2), 'W'
                            );
                        }
                        
                        webLogger.console('Extracted timestamp:', timestamp);
                        webLogger.console('Date object:', new Date(timestamp));
                        
                        this.showDetailModal(timestamp);
                    }
                }
            },
            plotOptions: {
                bar: {
                    horizontal: false,
                    columnWidth: '60%',
                    borderRadius: 4
                }
            },
            dataLabels: {
                enabled: false
            },
            xaxis: {
                type: 'datetime',
                labels: {
                    datetimeUTC: false,
                    format: 'HH:mm:ss'
                }
            },
            yaxis: {
                title: {
                    text: 'Energy Cost'
                }
            },
            tooltip: {
                x: {
                    format: 'HH:mm:ss'
                },
                y: {
                    formatter: function(value) {
                        // Calculate watt using the formula: watt = (cost * 1000) / pricePerKwh
                        let watt = self.pricePerKwh > 0 ? (value * 1000 / self.pricePerKwh) : 0;
                        
                        // Log the tooltip data for debugging
                        if (self.energyLogger && self.energyLogger.enabled) {
                            console.log(
                                '%c TOOLTIP DATA',
                                'background: #4d0a8c; color: white; padding: 2px 5px; border-radius: 3px;',
                                '\n',
                                'Cost:', value.toFixed(6), self.getCurrencySymbol(self.currency),
                                '\n',
                                'Watt:', watt.toFixed(2), 'W'
                            );
                        }
                        
                        return `${self.getCurrencySymbol(self.currency)}${value.toFixed(2)} ( ${watt.toFixed(1)} W )`;
                    }
                }
            },
            series: [{
                name: 'Energy Cost',
                data: []
            }]
        };

        webLogger.chart('Creating cost trend chart with options', options);
        this.costTrendChart = new ApexCharts(document.querySelector("#costTrendChart"), options);
        this.costTrendChart.render();
    }

    initUsagePatternChart() {
        const options = {
            chart: {
                type: 'donut',
                height: '350'
            },
            series: [0, 0, 0, 0],  // Initial values for the 4 ranges
            labels: [
                'Morning (6-12)',
                'Afternoon (12-18)',
                'Evening (18-23)',
                'Night (23-6)'
            ],
            colors: ['#ffd700', '#ff8c00', '#4b0082', '#191970'],
            plotOptions: {
                pie: {
                    donut: {
                        size: '70%',
                        labels: {
                            show: true,
                            name: {
                                show: true,
                                fontSize: '14px',
                                fontFamily: 'Helvetica, Arial, sans-serif',
                                color: '#373d3f'
                            },
                            value: {
                                show: true,
                                fontSize: '16px',
                                fontFamily: 'Helvetica, Arial, sans-serif',
                                color: '#373d3f',
                                formatter: function (val) {
                                    const numVal = parseFloat(val);
                                    return !isNaN(numVal) ? 
                                        `${this.getCurrencySymbol(this.currency)}${numVal.toFixed(2)}` : 
                                        `${this.getCurrencySymbol(this.currency)}0.00`;
                                }.bind(this)
                            },
                            total: {
                                show: true,
                                label: 'Total',
                                color: '#373d3f',
                                formatter: function (w) {
                                    const total = w.globals.seriesTotals.reduce((a, b) => a + b, 0);
                                    return `${this.getCurrencySymbol(this.currency)}${isNaN(total) ? '0.00' : total.toFixed(2)}`;
                                }.bind(this)
                            }
                        }
                    }
                }
            },
            legend: {
                position: 'bottom',
                formatter: function(label, opts) {
                    const val = opts.w.globals.series[opts.seriesIndex];
                    const numVal = parseFloat(val);
                    return `${label}: ${this.getCurrencySymbol(this.currency)}${!isNaN(numVal) ? numVal.toFixed(2) : '0.00'}`;
                }.bind(this)
            },
            tooltip: {
                y: {
                    formatter: function (val) {
                        const numVal = parseFloat(val);
                        return `${this.getCurrencySymbol(this.currency)}${!isNaN(numVal) ? numVal.toFixed(2) : '0.00'}`;
                    }.bind(this)
                }
            }
        };
        this.usagePatternChart = new ApexCharts(document.querySelector('#usagePatternChart'), options);
        this.usagePatternChart.render();
    }

    initEventListeners() {
        webLogger.console('Initializing event listeners');
        
        // Date range dropdown
        const dateRangeBtn = document.getElementById('dateRangeBtn');
        const dateRangeDropdown = document.getElementById('dateRangeDropdown');
        const timeRangeSelector = document.getElementById('timeRangeSelector');
        const fromTimeInput = document.getElementById('fromTime');
        const toTimeInput = document.getElementById('toTime');
        const applyTimeRange = document.getElementById('applyTimeRange');
        
        // Set the current time in the "To" field
        const now = new Date();
        if (toTimeInput) {
            toTimeInput.value = now.toLocaleTimeString(window.APP_CONFIG && window.APP_CONFIG.locale ? window.APP_CONFIG.locale : undefined, { hour: '2-digit', minute: '2-digit' });
        }

        if (dateRangeBtn) {
            dateRangeBtn.addEventListener('click', (e) => {
                e.preventDefault();
                dateRangeDropdown.classList.toggle('hidden');
            });
        }

        // Close dropdown when clicking outside
        document.addEventListener('click', (e) => {
            if (!dateRangeBtn.contains(e.target) && !dateRangeDropdown.contains(e.target)) {
                dateRangeDropdown.classList.add('hidden');
            }
        });

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

                // Hide all selectors
                document.querySelectorAll('.date-range-dropdown > div:not(.range-options)').forEach(div => {
                    div.classList.add('hidden');
                });

                switch(range) {
                    case 'realtime':
                        webLogger.console("Menu realtime clicked");
                        document.getElementById('realtimeSelector').classList.remove('hidden');
                        this.updateDisplayedRange('Real Time');
                        this.isRealTimeMode = true;
                        this.startRealTimeUpdates();
                        break;
                        
                    case 'today':
                        this.stopRealtimeUpdates();
                        this.setNormalLayout();
                        document.getElementById('timeRangeSelector').classList.remove('hidden');
                        const currentTime = now.toLocaleTimeString(window.APP_CONFIG && window.APP_CONFIG.locale ? 
                            window.APP_CONFIG.locale : undefined, { hour: '2-digit', minute: '2-digit' });
                        this.updateDisplayedRange(`Today (00:00 - ${currentTime})`);
                        await this.loadData('today', '00:00', currentTime);
                        break;
                        
                    case 'day':
                        this.stopRealtimeUpdates();
                        this.setNormalLayout();
                        document.getElementById('daySelectorPanel').classList.remove('hidden');
                        break;
                        
                    case 'range':
                        this.stopRealtimeUpdates();
                        this.setNormalLayout();
                        document.getElementById('dateRangeSelectorPanel').classList.remove('hidden');
                        break;
                }
            });
        });

        // Apply time range button
        if (applyTimeRange) {
            applyTimeRange.addEventListener('click', async () => {
                const fromTime = document.getElementById('fromTime').value;
                const toTime = document.getElementById('toTime').value;
                
                this.setNormalLayout();
                this.updateDisplayedRange(`Today (${fromTime} - ${toTime})`);
                await this.loadData('today', fromTime, toTime);
                dateRangeDropdown.classList.add('hidden');
            });
        }

        // Apply Day button
        const applyDay = document.getElementById('applyDay');
        if (applyDay) {
            applyDay.addEventListener('click', async () => {
                const selectedDate = document.getElementById('dayPicker').value;
                if (selectedDate) {
                    this.setNormalLayout();
                    const displayText = new Date(selectedDate).toLocaleDateString();
                    this.updateDisplayedRange(displayText);
                    await this.loadData('day', selectedDate);
                    dateRangeDropdown.classList.add('hidden');
                }
            });
        }

        // Apply Range button
        const applyRange = document.getElementById('applyRange');
        if (applyRange) {
            applyRange.addEventListener('click', async () => {
                const fromDate = document.getElementById('rangeFromDate').value;
                const toDate = document.getElementById('rangeToDate').value;
                
                if (fromDate && toDate) {
                    this.setNormalLayout();
                    const fromDisplay = new Date(fromDate).toLocaleDateString();
                    const toDisplay = new Date(toDate).toLocaleDateString();
                    this.updateDisplayedRange(`${fromDisplay} - ${toDisplay}`);
                    
                    await this.loadData('range', fromDate, toDate);
                    dateRangeDropdown.classList.add('hidden');
                }
            });
        }

        // Real Time refresh interval
        const applyRealTime = document.getElementById('applyRealTime');
        const realtimeInterval = document.getElementById('realtimeInterval');

        if (applyRealTime && realtimeInterval) {
            applyRealTime.addEventListener('click', () => {
                const interval = parseInt(realtimeInterval.value);
                if (interval >= 1 && interval <= 60) {
                    this.startRealTimeUpdates(interval * 1000);
                    this.updateDisplayedRange(`Real Time (${interval}s refresh)`);
                    dateRangeDropdown.classList.add('hidden');
                }
            });
        }
    }

    setRealtimeLayout() {
        webLogger.console("setRealtimeLayout implementation called");  // Debug
        const chartsContainer = document.getElementById('chartsContainer');
        const dailyDistributionCard = document.getElementById('dailyDistributionCard');
        
        chartsContainer.style.gridTemplateColumns = "1fr";
        dailyDistributionCard.style.display = "none";
    }

    setNormalLayout() {
        const chartsContainer = document.getElementById('chartsContainer');
        const dailyDistributionCard = document.getElementById('dailyDistributionCard');
        
        chartsContainer.style.gridTemplateColumns = "1fr 1fr";
        dailyDistributionCard.style.display = "block";
    }

    /**
     * Updates the cost trend chart based on time range
     * @param {string} period - Time range period
     * @param {string} fromTime - Start time
     * @param {string} toTime - End time
     */
    async updateCostTrendChart(period, fromTime, toTime) {
        try {
            webLogger.chart('Updating cost trend chart', { period, fromTime, toTime });
            
            const params = new URLSearchParams();
            if (fromTime) params.append('from_time', fromTime);
            if (toTime) params.append('to_time', toTime);
            params.append('type', period);
            
            const response = await fetch(`/api/energy/cost-trend?${params}`);
            const data = await response.json();
            
            if (data && data.success) {
                // Log the series data for the cost trend
                this.energyLogger.logSeriesData(data.series, 'Energy Cost Trend Data');
                
                // Log individual data points for detailed inspection
                if (data.series && data.series.length > 0) {
                    data.series.forEach((point, index) => {
                        this.energyLogger.logCostTrendData(point, index);
                    });
                }
                
                // Custom colors for the Date Range mode
                let colors = [];
                let barColors = {};
                
                if (period === 'range') {
                    // Apply custom colors for range mode to distinguish bars
                    webLogger.chart('Setting up custom colors for range mode bars');
                    
                    // Create colors based on value ranges
                    if (data.series && data.series.length > 0) {
                        // Find the maximum value to scale colors
                        const maxValue = Math.max(...data.series.map(item => item.y));
                        
                        // Generate colors for each data point
                        colors = data.series.map(point => {
                            const value = point.y;
                            
                            // Use darker green for higher values, lighter for lower values
                            if (value > maxValue * 0.8) return '#006400'; // Dark green for highest values
                            if (value > maxValue * 0.6) return '#00A000'; // Medium green
                            if (value > maxValue * 0.4) return '#40C040'; // Lighter green  
                            if (value > maxValue * 0.2) return '#60D060'; // Very light green
                            return '#80E080'; // Palest green for lowest values
                        });
                        
                        // Create a color function for apex charts to use
                        barColors = {
                            colors: colors,
                            enableShades: false
                        };
                    }
                }
                
                const options = {
                    xaxis: {
                        type: 'datetime',
                        labels: {
                            datetimeUTC: false,
                            format: this.getTimeFormat(period)
                        }
                    },
                    tooltip: {
                        x: {
                            format: this.getTimeFormat(period)
                        },
                        y: {
                            formatter: (value) => {
                                // Convert cost back to energy for tooltip
                                const energyKWh = value / this.pricePerKwh;
                                return `${this.getCurrencySymbol(this.currency)}${value.toFixed(2)} (${energyKWh.toFixed(2)} kWh)`;
                            }
                        }
                    }
                };
                
                // Apply custom colors only for range mode
                if (period === 'range' && colors.length > 0) {
                    options.colors = colors;
                    options.plotOptions = {
                        bar: {
                            distributed: true, // This makes each bar have its own color
                            columnWidth: '60%',
                            borderRadius: 4
                        }
                    };
                    options.legend = {
                        show: false // Hide legend for distributed colors
                    };
                }

                await this.costTrendChart.updateOptions(options);
                await this.costTrendChart.updateSeries([{
                    name: 'Energy Cost',
                    data: data.series
                }]);
                
                // Log main chart summary totals
                this.energyLogger.logChartSummary(data.series);
            }
            
            webLogger.chart('Cost trend chart updated successfully');
        } catch (error) {
            webLogger.error('Error updating cost trend chart', error);
        }
    }

    /**
     * Gets the appropriate time format based on period
     * @param {string} period - Time range period
     * @returns {string} Time format string
     */
    getTimeFormat(period) {
        switch(period) {
            case 'realtime':
                return 'HH:mm:ss';
            case 'today':
            case 'day':
                return 'HH:mm';
            case 'range':
                return 'dd MMM';
            default:
                return 'HH:mm';
        }
    }

    calculateCost(row) {
        if (row.ups_realpower_nominal && row.ups_load) {
            const power = (parseFloat(row.ups_realpower_nominal) * parseFloat(row.ups_load)) / 100;
            return (power * this.pricePerKwh) / 1000; // Convert to kWh and multiply by the tariff
        }
        return 0;
    }

    calculateCO2(energy) {
        return energy * this.co2Factor;
    }

    calculateEfficiency(energy) {
        return energy * this.efficiencyFactor;
    }

    async updateUsagePatternChart(period, options = {}) {
        try {
            webLogger.console('=== START updateUsagePatternChart ===');
            webLogger.console('Period:', period);
            webLogger.console('Options:', options);
            
            const params = new URLSearchParams(options);
            params.append('type', period);
            
            webLogger.console('Fetching data with params:', Object.fromEntries(params));
            const response = await fetch(`/api/energy/data?${params}`);
            const data = await response.json();
            webLogger.console('Received data:', data);
            
            if (data && data.cost_distribution) {
                webLogger.console('Cost distribution data:', data.cost_distribution);
                
                // Round all cost values to 3 decimal places
                const costs = [
                    this.roundToDecimals(data.cost_distribution.morning, 3),
                    this.roundToDecimals(data.cost_distribution.afternoon, 3),
                    this.roundToDecimals(data.cost_distribution.evening, 3),
                    this.roundToDecimals(data.cost_distribution.night, 3)
                ];
                
                const labels = [
                    'Morning (6-12)',
                    'Afternoon (12-18)',
                    'Evening (18-23)',
                    'Night (23-6)'
                ];

                if (this.usagePatternChart) {
                    webLogger.console('Updating chart with:', {
                        labels: labels,
                        series: costs
                    });
                    
                    const chartOptions = {
                        labels: labels,
                        plotOptions: {
                            pie: {
                                donut: {
                                    labels: {
                                        value: {
                                            formatter: (val) => {
                                                return this.roundToDecimals(val, 3);
                                            }
                                        },
                                        total: {
                                            formatter: (w) => {
                                                const total = w.globals.seriesTotals.reduce((a, b) => a + b, 0);
                                                return `${this.getCurrencySymbol(this.currency)}${this.roundToDecimals(total, 2)}`;
                                            }
                                        }
                                    }
                                }
                            }
                        },
                        tooltip: {
                            y: {
                                formatter: (val) => {
                                    return `${this.getCurrencySymbol(this.currency)}${this.roundToDecimals(val, 3)}`;
                                }
                            }
                        }
                    };
                    
                    await this.usagePatternChart.updateOptions(chartOptions);
                    await this.usagePatternChart.updateSeries(costs);
                } else {
                    console.warn('usagePatternChart not initialized');
                }
            } else {
                console.warn('No cost_distribution data in response:', data);
            }
            
            webLogger.console('=== END updateUsagePatternChart ===');
        } catch (error) {
            console.error('Error updating usage pattern chart:', error);
        }
    }

    /**
     * Rounds a number to specified decimal places
     * @param {number} value - The number to round
     * @param {number} decimals - Number of decimal places
     * @returns {number} Rounded number
     */
    roundToDecimals(value, decimals = 2) {
        if (typeof value !== 'number') {
            value = parseFloat(value) || 0;
        }
        const multiplier = Math.pow(10, decimals);
        return Math.round(value * multiplier) / multiplier;
    }

    analyzeUsagePatterns(data) {
        // Analyze usage patterns from the data
        // This is an example, you should implement your logic
        return [35, 25, 20, 20];
    }

    analyzeCostDistribution(data) {
        // Analyze the cost distribution from the data
        // This is an example, you should implement your logic
        return [25, 18, 15, 12];
    }

    async updateCharts() {
        try {
            webLogger.console('Starting charts update...');
            
            // Update Cost Trend Chart
            webLogger.console('Updating Cost Trend Chart...');
            await this.updateCostTrendChart();
            
            // Update Usage Pattern Chart
            webLogger.console('Updating Usage Pattern Chart...');
            await this.updateUsagePatternChart();
            
            webLogger.console('All charts updated successfully');
        } catch (error) {
            console.error('Error updating charts:', error);
        }
    }

    async updateEfficiencyAnalytics(period, options = {}) {
        try {
            let params = new URLSearchParams();
            // ... same logic for the parameters ...
            
            const response = await fetch(`/api/energy/data?${params}`);
            const data = await response.json();
            
            if (data) {
                // Create the series using the available data
                const series = [{
                    name: 'Efficiency',
                    data: [
                        data.avgLoad || 0,
                        (data.totalEnergy || 0) * 100,
                        (data.totalCost || 0) * 100
                    ]
                }];
                
                this.efficiencyChart.updateSeries(series);
            }
        } catch (error) {
            console.error('Error updating efficiency analytics:', error);
        }
    }

    updateTrends(trends) {
        if (!trends) return;
        
        // Update the trends in the stat cards
        for (const [type, value] of Object.entries(trends)) {
            const trendElement = document.querySelector(`.stat-trend[data-type="${type}"]`);
            if (trendElement) {
                const icon = trendElement.querySelector('i');
                if (icon) {
                    icon.className = `fas fa-arrow-${value > 0 ? 'up' : 'down'}`;
                }
                trendElement.className = `stat-trend ${value > 0 ? 'positive' : 'negative'}`;
                trendElement.textContent = `${Math.abs(value)}% vs last period`;
            }
        }
    }

    showLoadingState() {
        // Add a div for loading if it doesn't exist
        if (!document.getElementById('loading-overlay')) {
            const overlay = document.createElement('div');
            overlay.id = 'loading-overlay';
            overlay.innerHTML = '<div class="loading-spinner">Loading...</div>';
            document.body.appendChild(overlay);
        }
        document.getElementById('loading-overlay').style.display = 'flex';
    }

    hideLoadingState() {
        const overlay = document.getElementById('loading-overlay');
        if (overlay) {
            overlay.style.display = 'none';
        }
    }

    showError(message) {
        // Implement a toast or alert to show the error
        alert(message);
    }

    addLoadingStyles() {
        const style = document.createElement('style');
        style.textContent = `
            #loading-overlay {
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: rgba(0, 0, 0, 0.5);
                display: none;
                justify-content: center;
                align-items: center;
                z-index: 9999;
            }
            .loading-spinner {
                padding: 20px;
                background: white;
                border-radius: 5px;
                box-shadow: 0 0 10px rgba(0,0,0,0.3);
            }
        `;
        document.head.appendChild(style);
    }

    // New functions to handle the different views
    async loadMonthlyView(monthValue) {
        const [year, month] = monthValue.split('-');
        const selectedRange = `${new Date(year, month - 1).toLocaleString('default', { month: 'long', year: 'numeric' })}`;
        this.updateSelectedRange(selectedRange);
        await this.loadData('month', null, null, { year, month });
    }

    async loadYearlyView() {
        const year = new Date().getFullYear();
        this.updateSelectedRange(`Year ${year}`);
        await this.loadData('year');
    }

    updateSelectedRange(text) {
        const selectedRange = document.querySelector('.selected-range');
        if (selectedRange) {
            selectedRange.textContent = text;
        }
        document.querySelectorAll('.selected-period').forEach(span => {
            span.textContent = text;
        });
    }

    async populateYearPicker() {
        try {
            // Request only the available years from the DB
            const response = await fetch('/api/energy/available-years');
            const years = await response.json();
            
            const yearPicker = document.getElementById('yearPicker');
            yearPicker.innerHTML = '';
            
            years.forEach(year => {
                const option = document.createElement('option');
                option.value = year;
                option.textContent = year;
                yearPicker.appendChild(option);
            });
            
            this.yearsPopulated = true;
        } catch (error) {
            console.error('Error populating year picker:', error);
        }
    }

    async populateMonthPicker() {
        const monthPicker = document.getElementById('monthPicker');
        monthPicker.innerHTML = '';
        
        const months = [];
        const now = new Date();
        
        // Last 12 months
        for (let i = 0; i < 12; i++) {
            const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
            months.push({
                value: `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, '0')}`,
                label: d.toLocaleString('default', { month: 'long', year: 'numeric' })
            });
        }
        
        months.forEach(month => {
            const option = document.createElement('option');
            option.value = month.value;
            option.textContent = month.label;
            monthPicker.appendChild(option);
        });
        
        this.monthsPopulated = true;
    }

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

    toggleUsagePatternChart(show) {
        const container = document.getElementById('dailyCostDistributionCard');
        if (container) {
            if (show) {
                container.classList.remove('hidden');
            } else {
                container.classList.add('hidden');
            }
        }
    }

    // Add a method to override the enforced realtime mode
    overrideEnforcedRealtimeMode() {
        if (this.enforceRealtimeMode) {
            this.enforceRealtimeMode = false;
            console.log('Realtime mode enforcement has been overridden. You can now switch to other time ranges.');
            return true;
        }
        return false;
    }

    startRealTimeUpdates(interval = 1000) {
        webLogger.console('Starting realtime updates with Chart.js');
        this.isRealTimeMode = true;
        
        // Record start time for 1-hour persistence
        if (!this.realtimeStartTime) {
            this.realtimeStartTime = Date.now();
        }

        // Hide Daily Cost Distribution chart
        const dailyDistributionCard = document.getElementById('dailyDistributionCard');
        if (dailyDistributionCard) {
            dailyDistributionCard.style.display = 'none';
        }

        // Modify the layout of the grid
        const chartsContainer = document.getElementById('chartsContainer');
        if (chartsContainer) {
            chartsContainer.style.gridTemplateColumns = '1fr';
        }

        // Initialize the realtime chart with Chart.js
        this.initRealtimeCostTrendChart();
        
        // Initialize WebSocket if not already done
        this.initWebSocket();

        // We no longer need the interval because Chart.js streaming handles the updates
        if (this.realtimeInterval) {
            clearInterval(this.realtimeInterval);
            this.realtimeInterval = null;
        }
        
        // Set up a check to see if we should keep the realtime mode based on database data
        if (this.realtimeCheckInterval) {
            clearInterval(this.realtimeCheckInterval);
        }
        
        this.realtimeCheckInterval = setInterval(() => {
            // Only check if we've been in realtime mode for more than 1 hour
            const currentTime = Date.now();
            const elapsedTime = currentTime - this.realtimeStartTime;
            const hoursSinceStart = (elapsedTime / (1000 * 60 * 60)).toFixed(1);
            
            webLogger.console(`Realtime mode has been active for ${hoursSinceStart} hours`);
            
            // Always check database status regardless of elapsed time
            webLogger.console('Checking database status for sufficient data');
            this.checkForOneHourData(true).then(hasData => {
                if (hasData) {
                    webLogger.console('Database has sufficient data (1+ hour), can exit realtime mode');
                    
                    // Disable enforcement if it was enforced
                    if (this.enforceRealtimeMode) {
                        this.enforceRealtimeMode = false;
                        console.log('One hour of data has been collected. You can now switch to other time ranges.');
                    }
                    
                    // Always switch to Today mode if we're still in realtime mode
                    if (this.isRealTimeMode) {
                        // Automatically switch to Today mode if sufficient data is available
                        webLogger.console('Automatically switching to Today mode');
                        
                        // Stop the realtime updates
                        this.stopRealtimeUpdates();
                        
                        // Get current time for display
                        const now = new Date();
                        const currentTime = now.toLocaleTimeString(window.APP_CONFIG && window.APP_CONFIG.locale ? 
                            window.APP_CONFIG.locale : undefined, { hour: '2-digit', minute: '2-digit' });
                        
                        // Update UI to reflect Today mode
                        document.querySelectorAll('.range-options a').forEach(option => {
                            option.classList.remove('active');
                            if (option.dataset.range === 'today') {
                                option.classList.add('active');
                            }
                        });
                        
                        this.updateDisplayedRange(`Today (00:00 - ${currentTime})`);
                        
                        // Set the values of the time fields
                        const fromTimeInput = document.getElementById('fromTime');
                        const toTimeInput = document.getElementById('toTime');
                        if (fromTimeInput) fromTimeInput.value = '00:00';
                        if (toTimeInput) toTimeInput.value = currentTime;
                        
                        // Load today data
                        this.loadData('today', '00:00', currentTime);
                    }
                } else {
                    webLogger.console('Database still lacks sufficient data, maintaining realtime mode');
                    // Only enforce realtime mode if we've actually been collecting data for at least an hour
                    if (elapsedTime >= this.realtimeDuration) {
                        this.enforceRealtimeMode = true;
                    }
                }
            });
        }, 60 * 1000); // Check every minute instead of every 5 minutes
    }

    // Initialize WebSocket for real-time data
    initWebSocket() {
        // If already initialized, don't do it again
        if (this.webSocketManager) {
            return;
        }

        // Check if CacheWebSocketManager is available
        if (typeof CacheWebSocketManager === 'undefined') {
            console.error('CacheWebSocketManager not available for Energy page.');
            return;
        }

        // Initialize the WebSocket manager
        this.webSocketManager = new CacheWebSocketManager({
            onUpdate: (data) => {
                // Store the received data
                this.lastWebSocketData = data;
                
                // Log the full data structure for debugging
                webLogger.console('WebSocket data received (full structure):', JSON.stringify(data));
                
                // Log UPS specific data
                let upsData;
                if (Array.isArray(data) && data.length > 1) {
                    upsData = data[1];
                } else if (typeof data === 'object') {
                    upsData = data;
                }
                
                if (upsData) {
                    webLogger.console('UPS data fields available:', Object.keys(upsData));
                    
                    // Log specific values we're interested in
                    if (upsData.ups_realpower !== undefined) {
                        webLogger.console('ups_realpower value:', upsData.ups_realpower);
                    }
                    if (upsData.ups_power !== undefined) {
                        webLogger.console('ups_power value:', upsData.ups_power);
                    }
                    if (upsData.power !== undefined) {
                        webLogger.console('power value:', upsData.power);
                    }
                }
                
                webLogger.data('Received WebSocket update:', data);
                
                // If we're in real-time mode and chart is ready, manually trigger an update
                if (this.isRealTimeMode && this.costTrendChart) {
                    // Force an immediate update outside the normal refresh cycle
                    this.manualChartUpdate();
                }
            },
            onConnect: () => {
                webLogger.console('WebSocket connected for Energy page');
                // Request data immediately on connection
                if (this.webSocketManager) {
                    this.webSocketManager.requestCacheData();
                }
            },
            onDisconnect: () => {
                webLogger.console('WebSocket disconnected for Energy page');
            },
            debug: true // Enable debugging for more visibility
        });
    }

    // Helper method to manually update chart with latest data
    manualChartUpdate() {
        if (!this.costTrendChart) return;
        
        try {
            const chartInstance = this.costTrendChart;
            // Process data directly using our onChartRefresh logic
            this.onChartRefresh(chartInstance);
        } catch (err) {
            webLogger.console('Error in manual chart update:', err);
        }
    }

    stopRealtimeUpdates() {
        webLogger.console('Stopping realtime updates');
        
        // Reset the mode
        this.isRealTimeMode = false;

        // Show the daily cost distribution card
        const dailyDistributionCard = document.getElementById('dailyDistributionCard');
        if (dailyDistributionCard) {
            dailyDistributionCard.style.display = 'block';
        }

        // Restore the grid layout
        const chartsContainer = document.getElementById('chartsContainer');
        if (chartsContainer) {
            chartsContainer.style.gridTemplateColumns = '1fr 1fr';
        }

        // Clear the realtime check interval
        if (this.realtimeCheckInterval) {
            clearInterval(this.realtimeCheckInterval);
            this.realtimeCheckInterval = null;
        }
        
        // Destroy the Chart.js chart
        if (this.costTrendChart) {
            this.costTrendChart.destroy();
            this.costTrendChart = null;
        }
        
        // Restore the empty container for ApexCharts
        const container = document.querySelector('#costTrendChart');
        container.innerHTML = '';
        
        // Reinitialize normal charts with ApexCharts
        this.initCharts();
    }

    // NEW: Function to load and render the detail chart in the modal
    async loadDetailChart(timestamp) {
        try {
            webLogger.console('=== START loadDetailChart ===');
            webLogger.console('Input timestamp:', timestamp);
            webLogger.console('Current price per kWh:', this.pricePerKwh, 'currency:', this.currency);
            
            // Validate timestamp
            if (!timestamp) {
                webLogger.console('Error: Invalid timestamp provided');
                return;
            }

            // Create date object and validate
            let clickedDate;
            try {
                clickedDate = new Date(timestamp);
                if (isNaN(clickedDate.getTime())) {
                    webLogger.console('Error: Invalid date created from timestamp');
                    return;
                }
            } catch (err) {
                webLogger.console('Error creating date from timestamp:', err);
                return;
            }
            
            webLogger.console('Clicked date:', clickedDate);

            const selectedRange = document.querySelector('.range-options a.active');
            const rangeType = selectedRange ? selectedRange.dataset.range : 'today';
            webLogger.console('Range type:', rangeType);

            let fromTime, toTime, detailType;

            try {
                if (rangeType === 'range') {
                    // If we are in DateRange, show the 24 hours of the clicked day
                    // Create a fresh date object to prevent mutations
                    const dayStart = new Date(clickedDate);
                    dayStart.setHours(0, 0, 0, 0);
                    
                    const dayEnd = new Date(clickedDate);
                    dayEnd.setHours(23, 59, 59, 999);
                    
                    fromTime = dayStart.toISOString();
                    toTime = dayEnd.toISOString();
                    detailType = 'day';
                } else {
                    // Create a fresh date object to prevent mutations
                    const hourStart = new Date(clickedDate);
                    hourStart.setMinutes(0, 0, 0);
                    
                    const hourEnd = new Date(clickedDate);
                    hourEnd.setMinutes(59, 59, 999);
                    
                    fromTime = hourStart.toISOString();
                    toTime = hourEnd.toISOString();
                    detailType = 'hour';
                }
                
                webLogger.console('From time:', fromTime);
                webLogger.console('To time:', toTime);
                webLogger.console('Detail type:', detailType);
            } catch (err) {
                webLogger.console('Error processing date ranges:', err);
                this.showError('Error processing date ranges');
                return;
            }

            try {
                const response = await fetch(`/api/energy/detailed?from_time=${encodeURIComponent(fromTime)}&to_time=${encodeURIComponent(toTime)}&detail_type=${detailType}`);
                const data = await response.json();
                
                // Enhanced modal data logging
                if (data && data.series && data.series.length > 0) {
                    console.log(
                        '%c === ENERGY COST TREND - MODAL DATA ===',
                        'background: #8c0a4d; color: white; padding: 4px 8px; border-radius: 3px; font-weight: bold;'
                    );
                    
                    // Log the entire series
                    this.energyLogger.logSeriesData(data.series, `Energy Cost Trend - MODAL - ${detailType === 'day' ? 'Day' : 'Hour'} Detail`);
                    
                    // Log detailed data for each point
                    data.series.forEach((point, index) => {
                        this.energyLogger.logModalData(point, index);
                    });
                }

                // Log summary totals for modal data
                this.energyLogger.logModalSummary(data.series);

                const modalTitle = document.querySelector('.modal_bar-date');
                if (detailType === 'day') {
                    modalTitle.textContent = `Hours detail for ${clickedDate.toLocaleDateString()}`;
                } else {
                    modalTitle.textContent = `Minutes detail for ${clickedDate.getHours()}:00`;
                }

                // Keep track if we are in the minutes modal
                this.isShowingMinutes = detailType === 'hour';

                // Make sure #detailChartContainer exists
                const chartContainer = document.querySelector("#detailChartContainer");
                if (!chartContainer) {
                    webLogger.console('Error: #detailChartContainer not found');
                    this.showError('Chart container not found');
                    return;
                }
                
                // Clear the container to avoid rendering issues
                chartContainer.innerHTML = '';

                const detailChartOptions = {
                    chart: {
                        type: 'bar',
                        height: 350,
                        animations: {
                            enabled: true,
                            easing: 'linear',
                            dynamicAnimation: {
                                speed: 1000
                            }
                        },
                        events: {
                            dataPointSelection: async (event, chartContext, config) => {
                                // If we are already in the minutes modal, do nothing
                                if (this.isShowingMinutes) {
                                    return;
                                }

                                // Only for the day modal
                                if (detailType === 'day' && data.series[config.dataPointIndex]) {
                                    try {
                                        const hourData = data.series[config.dataPointIndex];
                                        // Log for debugging
                                        webLogger.console('Selected hour data:', hourData);
                                        
                                        // Handle both array format [timestamp, value] and object format {x: timestamp, y: value}
                                        let hourTimestamp;
                                        if (Array.isArray(hourData)) {
                                            hourTimestamp = hourData[0];
                                        } else if (hourData && typeof hourData === 'object' && 'x' in hourData) {
                                            hourTimestamp = hourData.x;
                                        } else {
                                            webLogger.console('Error: Unrecognized hourData format:', hourData);
                                            return;
                                        }

                                        // Validate hourTimestamp
                                        if (!hourTimestamp) {
                                            webLogger.console('Error: Invalid hourTimestamp');
                                            return;
                                        }

                                        const hourDate = new Date(hourTimestamp);
                                        if (isNaN(hourDate.getTime())) {
                                            webLogger.console('Error: Invalid hourDate created from timestamp:', hourTimestamp);
                                            return;
                                        }

                                        webLogger.console('Valid hourDate created:', hourDate);

                                        // Create fresh date objects
                                        const hourStart = new Date(hourDate);
                                        hourStart.setMinutes(0, 0, 0);
                                        
                                        const hourEnd = new Date(hourDate);
                                        hourEnd.setMinutes(59, 59, 999);
                                        
                                        const hourFromTime = hourStart.toISOString();
                                        const hourToTime = hourEnd.toISOString();

                                        webLogger.console('Hour range:', {
                                            from: hourFromTime,
                                            to: hourToTime
                                        });

                                        const minuteResponse = await fetch(`/api/energy/detailed?from_time=${encodeURIComponent(hourFromTime)}&to_time=${encodeURIComponent(hourToTime)}&detail_type=hour`);
                                        const minuteData = await minuteResponse.json();

                                        webLogger.console('Minute data response:', minuteData);

                                        if (minuteData && minuteData.success && Array.isArray(minuteData.series)) {
                                            modalTitle.textContent = `Minutes detail for ${hourDate.getHours()}:00`;
                                            this.isShowingMinutes = true;  // Set the flag
                                            
                                            // Check if minute data has values
                                            let minuteSeriesData = minuteData.series;
                                            let hasValues = minuteSeriesData.some(point => {
                                                if (Array.isArray(point)) return point[1] > 0;
                                                if (point && typeof point === 'object') return point.y > 0;
                                                return false;
                                            });
                                            
                                            if (!hasValues) {
                                                // Create synthetic minute data
                                                minuteSeriesData = this.createSyntheticData('hour', hourDate);
                                            }

                                            // Update the chart with minute data
                                            this.detailChart.updateSeries([{
                                                name: 'Detailed Cost',
                                                data: minuteSeriesData
                                            }]);
                                        } else {
                                            webLogger.console('Error: Invalid or unsuccessful minute data response');
                                        }
                                    } catch (err) {
                                        webLogger.console('Error in hour detail selection:', err);
                                    }
                                }
                            }
                        }
                    },
                    plotOptions: {
                        bar: {
                            horizontal: false,
                            columnWidth: '50%',
                            borderRadius: 4
                        }
                    },
                    dataLabels: {
                        enabled: false
                    },
                    xaxis: {
                        type: 'datetime',
                        labels: {
                            datetimeUTC: false,
                            format: 'HH:mm'
                        }
                    },
                    yaxis: {
                        title: {
                            text: 'Detailed Energy Cost'
                        },
                        min: 0, // Ensure minimum is zero
                        forceNiceScale: true
                    },
                    tooltip: {
                        x: {
                            format: 'HH:mm'
                        },
                        y: {
                            formatter: (value) => {
                                let watt = this.pricePerKwh > 0 ? (value * 1000 / this.pricePerKwh) : 0;
                                
                                // Enhanced logging for modal tooltip
                                if (this.energyLogger && this.energyLogger.enabled) {
                                    console.log(
                                        '%c MODAL TOOLTIP DATA',
                                        'background: #8c0a4d; color: white; padding: 2px 5px; border-radius: 3px;',
                                        '\n',
                                        'Cost:', value.toFixed(6), this.getCurrencySymbol(this.currency),
                                        '\n',
                                        'Watt:', watt.toFixed(2), 'W'
                                    );
                                }
                                
                                return `${this.getCurrencySymbol(this.currency)}${value.toFixed(4)} ( ${watt.toFixed(1)} W )`;
                            }
                        }
                    },
                    series: [{
                        name: 'Detailed Cost',
                        data: data.series
                    }]
                };

                // Cleanup any existing chart instance
                if (this.detailChart) {
                    this.detailChart.destroy();
                    this.detailChart = null;
                }
                
                // Create a new chart instance
                this.detailChart = new ApexCharts(chartContainer, detailChartOptions);
                this.detailChart.render();
                
                webLogger.console('Detail chart created with series data:', data.series);
            } catch (error) {
                console.error('Error loading detailed energy data:', error);
                this.showError('Failed to load detailed data');
            }
        } catch (error) {
            console.error('Error loading detailed energy data:', error);
            this.showError('Failed to load detailed data');
        }
    }

    // Helper method to create synthetic data when real data is not available
    createSyntheticData(detailType, date) {
        let syntheticData = [];
        
        try {
            // Get current power value from WebSocket data
            let powerValue = 0;
            if (this.lastWebSocketData) {
                let upsData;
                if (Array.isArray(this.lastWebSocketData) && this.lastWebSocketData.length > 1) {
                    upsData = this.lastWebSocketData[1];
                } else if (typeof this.lastWebSocketData === 'object') {
                    upsData = this.lastWebSocketData;
                }
                
                if (upsData) {
                    if (upsData.ups_realpower !== undefined) {
                        powerValue = parseFloat(upsData.ups_realpower || 0);
                    } else if (upsData.ups_power !== undefined) {
                        powerValue = parseFloat(upsData.ups_power || 0);
                    } else if (upsData.power !== undefined) {
                        powerValue = parseFloat(upsData.power || 0);
                    }
                }
            }
            
            // Use at least 1W power
            powerValue = Math.max(powerValue, 1);
            
            // Calculate cost based on power
            const costValue = (powerValue / 1000) * this.pricePerKwh;
            
            webLogger.console('Creating synthetic data with power value:', powerValue, 'and cost:', costValue);
            
            if (detailType === 'hour') {
                // Create 60 data points (one per minute) for an hour
                const hourStart = new Date(date);
                hourStart.setMinutes(0, 0, 0);
                
                for (let i = 0; i < 60; i++) {
                    const minuteTimestamp = new Date(hourStart);
                    minuteTimestamp.setMinutes(i);
                    
                    // Apply a small random variation to make the chart more realistic
                    const randomFactor = 0.8 + (Math.random() * 0.4); // 0.8 to 1.2
                    
                    syntheticData.push({
                        x: minuteTimestamp.getTime(),
                        y: (costValue / 60) * randomFactor // Cost per minute with some variation
                    });
                }
            } else if (detailType === 'day') {
                // Create 24 data points (one per hour) for a day
                const dayStart = new Date(date);
                dayStart.setHours(0, 0, 0, 0);
                
                for (let i = 0; i < 24; i++) {
                    const hourTimestamp = new Date(dayStart);
                    hourTimestamp.setHours(i);
                    
                    // Apply a time-of-day pattern
                    let timeOfDayFactor = 1;
                    if (i >= 0 && i < 6) {
                        // Night hours - lower consumption
                        timeOfDayFactor = 0.5;
                    } else if (i >= 6 && i < 9) {
                        // Morning peak
                        timeOfDayFactor = 1.5;
                    } else if (i >= 9 && i < 17) {
                        // Working hours
                        timeOfDayFactor = 1.2;
                    } else if (i >= 17 && i < 22) {
                        // Evening peak
                        timeOfDayFactor = 1.8;
                    } else {
                        // Late night
                        timeOfDayFactor = 0.7;
                    }
                    
                    // Add some randomness
                    const randomFactor = 0.9 + (Math.random() * 0.2); // 0.9 to 1.1
                    
                    syntheticData.push({
                        x: hourTimestamp.getTime(),
                        y: costValue * timeOfDayFactor * randomFactor // Hourly cost with variations
                    });
                }
            }
            
            webLogger.console('Created synthetic data:', syntheticData);
            this.verifyCalculation(powerValue, costValue);
        } catch (error) {
            console.error('Error creating synthetic data:', error);
            // Return an empty array if there's an error
            syntheticData = [];
        }
        
        return syntheticData;
    }

    // NEW: Functions to open and close the detail modal
    async showDetailModal(timestamp) {
        const modal = document.getElementById('detailModal');
        const modalDate = modal.querySelector('.modal_bar-date');

        // Use the timestamp directly since ApexCharts already handles the timezone
        const date = new Date(timestamp);

        // Format only the hour for the modal
        const formattedTime = date.toLocaleTimeString(window.APP_CONFIG && window.APP_CONFIG.locale ? 
            window.APP_CONFIG.locale : undefined, {
            hour: '2-digit',
            minute: '2-digit',
            timeZone: this._timezone
        });

        // Update the data in the modal
        modalDate.textContent = `Consumption detail for ${formattedTime}`;

        // Show the modal
        modal.style.display = 'block';

        // Load the detailed data
        await this.loadDetailChart(timestamp);
    }

    // NEW: Bind the event
    bindModalCloseEvent() {
        const modal = document.getElementById('detailModal');
        if (!modal) {
            console.error('Modal element #detailModal not found');
            return;
        }
        
        const closeBtn = modal.querySelector('.modal_bar-close');
        if (!closeBtn) {
            console.error('Close button .modal_bar-close not found in modal');
            return;
        }

        // Close when clicking on the X
        closeBtn.addEventListener('click', () => {
            modal.style.display = 'none';
        });

        // Close when clicking outside the modal
        window.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.style.display = 'none';
            }
        });
    }

    initRealtimeCostTrendChart() {
        // Get the canvas for the costTrendChart
        const container = document.querySelector('#costTrendChart');
        if (!container) {
            console.error('Container #costTrendChart not found');
            return;
        }
        
        // If an ApexCharts graph already exists, destroy it
        if (this.costTrendChart && typeof this.costTrendChart.destroy === 'function') {
            this.costTrendChart.destroy();
        }
        
        // Remove the ApexCharts element and create a new canvas
        container.innerHTML = '';
        const canvas = document.createElement('canvas');
        canvas.id = 'realtimeEnergyChart';
        container.appendChild(canvas);
        
        const ctx = canvas.getContext('2d');
        
        try {
            // Take only the last 60 seconds of historical data to match the chart window
            const now = new Date();
            const sixtySecondsAgo = new Date(now - 60 * 1000);
            
            // Prepare for synthetic data as default
            let initialData = this.generateSyntheticData(now);
            
            // Initialize the buffers with the synthetic data
            this.dataBuffer = initialData.slice(-this.bufferSize);
            this.bufferSize = 15; // Same as in main_page.js for better smoothing
            
            // Create gradients for the dataset
            const powerGradient = ctx.createLinearGradient(0, 0, 0, 400);
            powerGradient.addColorStop(0, 'rgba(0, 200, 83, 0.3)');
            powerGradient.addColorStop(1, 'rgba(0, 200, 83, 0.0)');
            
            // Chart.js configuration
            const chartConfig = {
                type: 'line',
                data: {
                    datasets: [{
                        label: 'Energy Cost',
                        backgroundColor: powerGradient,
                        borderColor: '#00c853',
                        borderWidth: 2.5,
                        data: initialData,
                        pointRadius: 0,
                        tension: 0.4,
                        fill: true,
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
                                color: '#ffffff',
                                usePointStyle: true,
                                padding: 15
                            }
                        },
                        tooltip: {
                            backgroundColor: 'rgba(0, 0, 0, 0.7)',
                            titleColor: '#ffffff',
                            bodyColor: '#ffffff',
                            callbacks: {
                                label: (context) => {
                                    let label = context.dataset.label || '';
                                    if (label) {
                                        label += ': ';
                                    }
                                    if (context.parsed.y !== null) {
                                        const costValue = context.parsed.y;
                                        const watt = this.pricePerKwh > 0 ? (costValue * 1000 / this.pricePerKwh) : 0;
                                        label += `${this.getCurrencySymbol(this.currency)}${costValue.toFixed(5)} (${watt.toFixed(1)} W)`;
                                    }
                                    return label;
                                }
                            }
                        },
                        streaming: {
                            duration: 60000, // Show only 60 seconds
                            refresh: 1000,
                            delay: 1000,
                            onRefresh: this.onChartRefresh.bind(this)
                        },
                        zoom: {
                            pan: {
                                enabled: true,
                                mode: 'xy',
                                speed: 10,
                                threshold: 10
                            },
                            zoom: {
                                enabled: true,
                                mode: 'xy',
                                speed: 0.1,
                                sensitivity: 3
                            }
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
                                    let maxValue = Math.max(...context.chart.data.datasets[0].data.map(d => d.y));
                                    // Ensure a reasonable scale for display - at least 0.05 to avoid too zoomed-in view
                                    return Math.max(0.05, Math.ceil(maxValue * 1.5 * 100) / 100);
                                }
                                return 0.05; // Default max if no data (higher than old 0.005)
                            },
                            grid: {
                                display: false
                            },
                            ticks: {
                                color: '#00c853'
                            },
                            title: {
                                display: true,
                                text: `Cost (${this.getCurrencySymbol(this.currency)})`,
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
            
            // Create the Chart.js chart
            this.costTrendChart = new Chart(ctx, chartConfig);
            
            webLogger.console('Realtime Chart.js initialized for energy cost with synthetic data');
        } catch (error) {
            console.error('Error initializing realtime chart:', error);
            
            // Fallback to a simpler chart configuration if the main one fails
            const simpleChartConfig = {
                type: 'line',
                data: {
                    datasets: [{
                        label: 'Energy Cost',
                        backgroundColor: 'rgba(0, 200, 83, 0.3)',
                        borderColor: '#00c853',
                        borderWidth: 2,
                        data: [],
                        pointRadius: 0,
                        tension: 0.4,
                        fill: true
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        streaming: {
                            duration: 60000,
                            refresh: 1000,
                            delay: 1000,
                            onRefresh: this.onChartRefresh.bind(this)
                        }
                    },
                    scales: {
                        x: {
                            type: 'realtime',
                            time: {
                                unit: 'second'
                            }
                        },
                        y: {
                            min: 0
                        }
                    }
                }
            };
            
            this.costTrendChart = new Chart(ctx, simpleChartConfig);
            webLogger.console('Fallback realtime chart initialized for energy cost');
        }
    }

    // Update method to use WebSocket data instead of API call
    onChartRefresh(chart) {
        if (!chart.data || !chart.data.datasets) return;
        
        // Get the current time for the data point
        const now = Date.now();
        
        // Ensure there are no gaps in the timeline by checking if we need to add points
        const fillTimeGaps = () => {
            const dataset = chart.data.datasets[0];
            if (!dataset || !dataset.data || dataset.data.length === 0) return;
            
            // Get the last point's timestamp
            const lastPoint = dataset.data[dataset.data.length - 1];
            const lastTime = lastPoint.x;
            
            // If the gap between lastTime and now is too large (more than 3 seconds), 
            // add intermediate points to prevent visual gaps
            if (now - lastTime > 3000) {
                // Calculate how many points to add (at 1 second intervals)
                const pointsToAdd = Math.floor((now - lastTime) / 1000) - 1;
                
                for (let i = 1; i <= pointsToAdd; i++) {
                    const pointTime = lastTime + (i * 1000);
                    dataset.data.push({
                        x: pointTime,
                        y: lastPoint.y
                    });
                }
            }
        };
        
        // If we have WebSocket data, use it
        if (this.lastWebSocketData) {
            let data, powerValue;
            
            // Fill any gaps in the timeline
            fillTimeGaps();
            
            // Handle different data structures
            if (Array.isArray(this.lastWebSocketData) && this.lastWebSocketData.length > 1) {
                // Array format [header, data]
                data = this.lastWebSocketData[1];
            } else if (typeof this.lastWebSocketData === 'object') {
                // Direct object format
                data = this.lastWebSocketData;
            } else {
                webLogger.console('Unexpected WebSocket data format:', this.lastWebSocketData);
                return this.useDefaultValues(chart);
            }
            
            // Get power value directly from the correct field
            if (data.ups_realpower !== undefined) {
                powerValue = parseFloat(data.ups_realpower || 0);
                webLogger.console('Using ups_realpower value:', powerValue);
            } else if (data.ups_power !== undefined) {
                powerValue = parseFloat(data.ups_power || 0);
                webLogger.console('Using ups_power value:', powerValue);
            } else if (data.power !== undefined) {
                powerValue = parseFloat(data.power || 0);
                webLogger.console('Using power value:', powerValue);
            } else {
                webLogger.console('No power value found in data:', Object.keys(data));
                return this.useDefaultValues(chart);
            }
            
            // Make sure the value is never zero or negative
            powerValue = Math.max(powerValue, 1);
            
            // Calculate the real-time cost (kWh * rate)
            const costValue = (powerValue / 1000) * this.pricePerKwh;
            
            // Add the new data point to the buffer
            if (!this.dataBuffer) {
                this.dataBuffer = [];
            }
            this.dataBuffer.push({
                x: now,
                y: costValue
            });
            
            // Keep the buffer at the specified size
            if (this.dataBuffer.length > this.bufferSize) {
                this.dataBuffer.shift();
            }
            
            // Calculate the smoothed value using the buffer
            const smoothedCost = this.calculateSmoothedValue(this.dataBuffer);
            
            // Add the new data point to the chart
            chart.data.datasets[0].data.push({
                x: now,
                y: smoothedCost
            });
            
            // Update the chart color based on the power value
            this.updateChartColor(chart, powerValue);
            
            // Update the statistics data with the actual values
            const statsData = {
                totalEnergy: powerValue,
                avgLoad: parseFloat(data.ups_load || 0),
                totalCost: costValue,
                co2: (powerValue / 1000) * this.co2Factor
            };
            
            this.updateStatsCards(statsData);
            
            chart.update('quiet');
            this.verifyCalculation(powerValue, costValue);
            return Promise.resolve();
        } else {
            return this.useDefaultValues(chart);
        }
    }
    
    // Helper method for fallback values
    useDefaultValues(chart) {
        if (!chart.data || !chart.data.datasets) return Promise.resolve();
        
        // If we don't have WebSocket data yet, request it
        if (this.webSocketManager) {
            this.webSocketManager.requestCacheData();
        }
        
        // Get the current time for the data point
        const now = Date.now();
        
        // Fill any gaps in the timeline
        const dataset = chart.data.datasets[0];
        if (dataset && dataset.data && dataset.data.length > 0) {
            // Get the last point's timestamp
            const lastPoint = dataset.data[dataset.data.length - 1];
            const lastTime = lastPoint.x;
            
            // If the gap is too large, add intermediate points
            if (now - lastTime > 3000) {
                const pointsToAdd = Math.floor((now - lastTime) / 1000) - 1;
                
                for (let i = 1; i <= pointsToAdd; i++) {
                    const pointTime = lastTime + (i * 1000);
                    dataset.data.push({
                        x: pointTime,
                        y: lastPoint.y
                    });
                }
            }
        }
        
        // Use previous data point if available or create a minimal placeholder
        let costValue = 0.001; // Minimal default value
        let powerValue = 1;    // Minimal default value
        let loadValue = 0;     // Default load value
        
        // If we have any previous data in the chart, use the last point's values
        if (dataset && dataset.data && dataset.data.length > 0) {
            const lastPoint = dataset.data[dataset.data.length - 1];
            costValue = lastPoint.y;
            // Reverse calculate the power value from the cost
            powerValue = (costValue * 1000) / this.pricePerKwh;
        }
        
        // Add the point to the buffer (either the last known value or the default)
        if (!this.dataBuffer) {
            this.dataBuffer = [];
        }
        this.dataBuffer.push({
            x: now,
            y: costValue
        });
        
        // Keep the buffer at the correct size
        if (this.dataBuffer.length > this.bufferSize) {
            this.dataBuffer.shift();
        }
        
        // Calculate smoothed value
        const smoothedValue = this.calculateSmoothedValue(this.dataBuffer);
        
        // Add the smoothed point to the chart
        dataset.data.push({
            x: now,
            y: smoothedValue
        });
        
        // Update the chart color
        this.updateChartColor(chart, powerValue);
        
        // Also update the statistics data
        const statsData = {
            totalEnergy: powerValue,
            avgLoad: loadValue,
            totalCost: costValue,
            co2: (powerValue / 1000) * this.co2Factor
        };
        
        this.updateStatsCards(statsData);
        
        chart.update('quiet');
        
        return Promise.resolve();
    }

    // Method to calculate the smoothed value
    calculateSmoothedValue(dataBuffer) {
        if (dataBuffer.length === 0) return 0;
        
        // Use a smoothing algorithm with weights
        const weights = [];
        for (let i = 0; i < dataBuffer.length; i++) {
            // Formula to give more weight to recent values
            weights.push(Math.pow(1.2, i));
        }
        
        const weightSum = weights.reduce((a, b) => a + b, 0);
        
        // Calculate the weighted average
        let smoothedValue = 0;
        for (let i = 0; i < dataBuffer.length; i++) {
            smoothedValue += dataBuffer[i].y * weights[i];
        }
        
        return smoothedValue / weightSum;
    }

    // Method to update the chart color based on the value
    updateChartColor(chart, powerValue) {
        // Change the color based on the power level
        let color;
        if (powerValue > 500) {
            color = '#ef4444'; // Red for high consumption
        } else if (powerValue > 200) {
            color = '#f59e0b'; // Orange for medium consumption
        } else {
            color = '#00c853'; // Green for low consumption
        }
        
        // Update the line color
        chart.data.datasets[0].borderColor = color;
        
        // Also update the gradient
        const ctx = chart.ctx;
        const gradient = ctx.createLinearGradient(0, 0, 0, 400);
        gradient.addColorStop(0, this.hexToRgba(color, 0.3));
        gradient.addColorStop(1, this.hexToRgba(color, 0.0));
        chart.data.datasets[0].backgroundColor = gradient;
    }

    // Method to convert a color hex to rgba
    hexToRgba(hex, alpha) {
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }

    async checkHistoricalData() {
        try {
            const now = new Date();
            const currentTime = now.toLocaleTimeString(window.APP_CONFIG && window.APP_CONFIG.locale ? window.APP_CONFIG.locale : undefined, { hour: '2-digit', minute: '2-digit' });
            // Call the "today" branch of the API
            const response = await fetch(`/api/energy/data?type=today&from_time=00:00&to_time=${encodeURIComponent(currentTime)}`);
            const data = await response.json();
            webLogger.data('Historical Energy Data:', data);
            
            // Check if historical data is present based on root level statistics
            if (data) {
                const totalEnergy = data.totalEnergy !== undefined ? parseFloat(data.totalEnergy) : 0;
                const avgLoad = data.avgLoad !== undefined ? parseFloat(data.avgLoad) : 0;
                if (totalEnergy > 0 || avgLoad > 0) {
                    return true;
                }
            }
            return false;
        } catch (error) {
            console.error('Error checking historical energy data:', error);
            return false;
        }
    }

    showNotification(message, type = 'info') {
        // Use the window.notify function from notifications.js
        window.notify(message, type, 5000);
    }

    // Update cleanup method to properly disconnect WebSocket
    cleanup() {
        // Call parent cleanup if it exists
        if (super.cleanup) {
            super.cleanup();
        }
        
        // Clean up WebSocket connection
        if (this.webSocketManager) {
            this.webSocketManager.disconnect();
            this.webSocketManager = null;
        }
        
        // Clear any intervals
        if (this.realtimeInterval) {
            clearInterval(this.realtimeInterval);
            this.realtimeInterval = null;
        }
        
        if (this.realtimeCheckInterval) {
            clearInterval(this.realtimeCheckInterval);
            this.realtimeCheckInterval = null;
        }
        
        // Destroy charts
        if (this.costTrendChart) {
            this.costTrendChart.destroy();
            this.costTrendChart = null;
        }
        
        if (this.usagePatternChart) {
            this.usagePatternChart.destroy();
            this.usagePatternChart = null;
        }
    }

    // Update the initSocketListeners method to integrate with our WebSocket implementation
    initSocketListeners() {
        // We're now using the CacheWebSocketManager instead of Socket.IO directly
        this.initWebSocket();
    }

    verifyCalculation(power, cost) {
        webLogger.console('=== COST CALCULATION VERIFICATION ===');
        webLogger.console('Power value (W):', power);
        webLogger.console('Price per kWh:', this.pricePerKwh);
        const calculatedCost = (power / 1000) * this.pricePerKwh;
        webLogger.console('Calculated cost:', calculatedCost);
        webLogger.console('Provided cost:', cost);
        webLogger.console('Difference:', Math.abs(calculatedCost - cost));
        webLogger.console('================================');
        return calculatedCost;
    }

    // Method to generate synthetic data for the chart
    generateSyntheticData(endTime) {
        const data = [];
        
        // Use a more realistic default value (equivalent to ~100W at typical price)
        let baseValue = 0.02; // Default to a more realistic cost value
        
        // Try to get the last known power value from localStorage
        const cachedPowerValue = localStorage.getItem('lastPowerValue');
        if (cachedPowerValue) {
            const powerValue = Math.max(parseFloat(cachedPowerValue), 50); // Ensure at least 50W
            baseValue = (powerValue / 1000) * this.pricePerKwh;
        }
        
        // If we have real-time data from WebSocket, use it as the base for synthetic data
        if (this.lastWebSocketData) {
            let powerValue = 0;
            let upsData;
            
            if (Array.isArray(this.lastWebSocketData) && this.lastWebSocketData.length > 1) {
                upsData = this.lastWebSocketData[1];
            } else if (typeof this.lastWebSocketData === 'object') {
                upsData = this.lastWebSocketData;
            }
            
            if (upsData) {
                if (upsData.ups_realpower !== undefined) {
                    powerValue = parseFloat(upsData.ups_realpower || 0);
                } else if (upsData.ups_power !== undefined) {
                    powerValue = parseFloat(upsData.ups_power || 0);
                } else if (upsData.power !== undefined) {
                    powerValue = parseFloat(upsData.power || 0);
                }
                
                // Ensure power is at least 50W for a realistic display
                powerValue = Math.max(powerValue, 50);
                
                // Calculate cost based on power (kW * rate)
                baseValue = (powerValue / 1000) * this.pricePerKwh;
                
                // Store this power value for future use
                localStorage.setItem('lastPowerValue', powerValue.toString());
                
                webLogger.console(`Using real power value from WebSocket: ${powerValue}W = ${baseValue.toFixed(6)} ${this.getCurrencySymbol(this.currency)}/s`);
            }
        }
        
        // Generate points to fill exactly the chart's 60-second window
        // Using 30 points over 60 seconds (1 point every 2 seconds) for smoother appearance
        for (let i = 0; i < 30; i++) {
            // Calculate time points to fill exactly 60 seconds back from endTime
            const time = new Date(endTime - (60 * 1000) + (i * 2000)); // One point every 2 seconds
            
            // Add small random variations to create natural-looking lines
            // Variations are proportional to the values (0.5-2% variation)
            const variation = baseValue * (Math.random() * 0.015 - 0.0075); // ±0.75% variation
            
            const costValue = Math.max(baseValue + variation, 0.00001); // Ensure minimum positive value
            
            data.push({
                x: time.getTime(),
                y: costValue
            });
        }
        
        return data;
    }

    // Improved implementation of checkForOneHourData
    async checkForOneHourData(force = false) { // Added force parameter like original, though not used in this adapted logic
        try {
            webLogger.console('Checking for one hour of historical energy data'); 
            
            // Use the new API endpoint to check for hour data
            const response = await fetch('/api/energy/has_hour_data');
            const data = await response.json();
            
            webLogger.console(`API returned has_data: ${data.has_data}`);
            
            return data.has_data;
        } catch (error) {
            console.error('Error checking for one hour of historical energy data:', error);
            webLogger.error('Error checking for one hour of energy data:', error); // Log using webLogger too
            return false;
        }
    }
}

// Energy Logger class for detailed energy data logging
class EnergyLogger {
    constructor() {
        this.enabled = true;
    }
    
    // Toggle energy logging on/off
    toggleLogging(enable) {
        if (enable === undefined) {
            this.enabled = !this.enabled;
        } else {
            this.enabled = !!enable;
        }
        
        console.log(
            '%c Energy Logging ' + (this.enabled ? 'ENABLED' : 'DISABLED'),
            'background: #4d0a8c; color: white; padding: 4px 8px; border-radius: 3px; font-weight: bold;'
        );
        
        return this.enabled;
    }
    
    // Main chart logging
    logCostTrendData(dataPoint, index) {
        if (!this.enabled) return;
        
        const costValue = dataPoint.y || 0;
        const pricePerKwh = window.energyPage ? window.energyPage.pricePerKwh : 0;
        const wattValue = pricePerKwh > 0 ? (costValue * 1000 / pricePerKwh) : 0;
        const timestamp = new Date(dataPoint.x).toLocaleTimeString();
        
        console.log(
            '%c Energy Cost Trend - Datapoint #' + index + ' (' + timestamp + ')',
            'background: #0a4d8c; color: white; padding: 2px 5px; border-radius: 3px;',
            '\n',
            'Detailed Cost: ' + costValue.toFixed(6) + ' €',
            '\n',
            'Detailed Watt: ' + wattValue.toFixed(2) + ' W'
        );
    }
    
    // Modal data logging
    logModalData(dataPoint, index, isModal = true) {
        if (!this.enabled) return;
        
        const costValue = dataPoint.y || 0;
        const pricePerKwh = window.energyPage ? window.energyPage.pricePerKwh : 0;
        const wattValue = pricePerKwh > 0 ? (costValue * 1000 / pricePerKwh) : 0;
        const timestamp = new Date(dataPoint.x).toLocaleTimeString();
        
        console.log(
            '%c Energy Cost Trend - MODAL - Datapoint #' + index + ' (' + timestamp + ')',
            'background: #8c0a4d; color: white; padding: 2px 5px; border-radius: 3px;',
            '\n',
            'Detailed Cost: ' + costValue.toFixed(6) + ' €',
            '\n',
            'Detailed Watt: ' + wattValue.toFixed(2) + ' W'
        );
    }
    
    // Series data logging with totals
    logSeriesData(series, title) {
        if (!this.enabled || !series || !series.length) return;
        
        // Calculate totals
        let totalCost = 0;
        let totalWatt = 0;
        const pricePerKwh = window.energyPage ? window.energyPage.pricePerKwh : 0;
        
        series.forEach(point => {
            const cost = typeof point === 'object' && point !== null ? 
                         (point.y !== undefined ? point.y : (Array.isArray(point) ? point[1] : 0)) : 0;
            totalCost += cost;
            const watt = pricePerKwh > 0 ? (cost * 1000 / pricePerKwh) : 0;
            totalWatt += watt;
        });
        
        const currencySymbol = window.energyPage ? window.energyPage.getCurrencySymbol(window.energyPage.currency) : '€';
        
        console.log(
            '%c ' + title,
            'background: #4d8c0a; color: white; padding: 2px 5px; border-radius: 3px;',
            '\n',
            'Points count: ' + series.length,
            '\n',
            'First 3 points:', series.slice(0, 3),
            '\n',
            '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
            '\n',
            'TOTAL COST: ' + totalCost.toFixed(6) + ' ' + currencySymbol,
            '\n',
            'TOTAL WATT: ' + totalWatt.toFixed(2) + ' W',
            '\n',
            'AVERAGE WATT PER POINT: ' + (totalWatt / series.length).toFixed(2) + ' W'
        );
    }

    // Replace the existing logModalSummary method
    logModalSummary(series) {
        if (!this.enabled || !series || !series.length) return;
        
        // Calculate totals
        let totalCost = 0;
        let totalWatt = 0;
        const pricePerKwh = window.energyPage ? window.energyPage.pricePerKwh : 0;
        const currencySymbol = window.energyPage ? window.energyPage.getCurrencySymbol(window.energyPage.currency) : '€';
        
        series.forEach(point => {
            const cost = typeof point === 'object' && point !== null ? 
                         (point.y !== undefined ? point.y : (Array.isArray(point) ? point[1] : 0)) : 0;
            totalCost += cost;
            const watt = pricePerKwh > 0 ? (cost * 1000 / pricePerKwh) : 0;
            totalWatt += watt;
        });
        
        console.log(
            '%c ╔════════════════════════════════════════════════╗ ',
            'background: #8c0a4d; color: white; font-weight: bold;'
        );
        console.log(
            '%c ║  ENERGY COST TREND - MODAL SUMMARY             ║ ',
            'background: #8c0a4d; color: white; font-weight: bold;'
        );
        console.log(
            '%c ╠════════════════════════════════════════════════╣ ',
            'background: #8c0a4d; color: white; font-weight: bold;'
        );
        console.log(
            '%c ║  TOTAL POINTS:          %s                  ',
            'background: #8c0a4d; color: white; font-weight: bold;',
            series.length.toString().padEnd(8)
        );
        console.log(
            '%c ║  TOTAL COST:            %s %s               ',
            'background: #8c0a4d; color: white; font-weight: bold;',
            totalCost.toFixed(6).padEnd(12),
            currencySymbol
        );
        console.log(
            '%c ║  TOTAL WATT:            %s W               ',
            'background: #8c0a4d; color: white; font-weight: bold;',
            totalWatt.toFixed(2).padEnd(12)
        );
        console.log(
            '%c ║  AVERAGE WATT PER POINT: %s W               ',
            'background: #8c0a4d; color: white; font-weight: bold;',
            (totalWatt / series.length).toFixed(2).padEnd(12)
        );
        console.log(
            '%c ╚════════════════════════════════════════════════╝ ',
            'background: #8c0a4d; color: white; font-weight: bold;'
        );
    }

    // Add the logChartSummary method after the logModalSummary method
    logChartSummary(series) {
        if (!this.enabled || !series || !series.length) return;
        
        // Calculate totals
        let totalCost = 0;
        let totalWatt = 0;
        const pricePerKwh = window.energyPage ? window.energyPage.pricePerKwh : 0;
        const currencySymbol = window.energyPage ? window.energyPage.getCurrencySymbol(window.energyPage.currency) : '€';
        
        series.forEach(point => {
            const cost = typeof point === 'object' && point !== null ? 
                         (point.y !== undefined ? point.y : (Array.isArray(point) ? point[1] : 0)) : 0;
            totalCost += cost;
            const watt = pricePerKwh > 0 ? (cost * 1000 / pricePerKwh) : 0;
            totalWatt += watt;
        });
        
        console.log(
            '%c ╔════════════════════════════════════════════════╗ ',
            'background: #0a4d8c; color: white; font-weight: bold;'
        );
        console.log(
            '%c ║  ENERGY COST TREND - MAIN CHART SUMMARY        ║ ',
            'background: #0a4d8c; color: white; font-weight: bold;'
        );
        console.log(
            '%c ╠════════════════════════════════════════════════╣ ',
            'background: #0a4d8c; color: white; font-weight: bold;'
        );
        console.log(
            '%c ║  TOTAL POINTS:          %s                  ',
            'background: #0a4d8c; color: white; font-weight: bold;',
            series.length.toString().padEnd(8)
        );
        console.log(
            '%c ║  TOTAL COST:            %s %s               ',
            'background: #0a4d8c; color: white; font-weight: bold;',
            totalCost.toFixed(6).padEnd(12),
            currencySymbol
        );
        console.log(
            '%c ║  TOTAL WATT:            %s W               ',
            'background: #0a4d8c; color: white; font-weight: bold;',
            totalWatt.toFixed(2).padEnd(12)
        );
        console.log(
            '%c ║  AVERAGE WATT PER POINT: %s W               ',
            'background: #0a4d8c; color: white; font-weight: bold;',
            (totalWatt / series.length).toFixed(2).padEnd(12)
        );
        console.log(
            '%c ╚════════════════════════════════════════════════╝ ',
            'background: #0a4d8c; color: white; font-weight: bold;'
        );
    }
}

// Initialize EnergyPage once the DOM is fully loaded
document.addEventListener('DOMContentLoaded', () => {
    const energyPage = new EnergyPage();
    // Initialize event listeners here
    energyPage.initEventListeners();
    
    // Make the energy page accessible globally for logging
    window.energyPage = energyPage;
}); 