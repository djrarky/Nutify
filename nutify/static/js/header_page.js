class HeaderManager {
    constructor() {
        this.clockElement = document.getElementById('currentTime');
        this.statusElement = document.querySelector('#upsStatus');
        this.batteryElement = document.querySelector('.header_top-battery');
        this.loadElement = document.querySelector('.header_top-load');
        this.powerElement = document.querySelector('.header_top-power');
        this.runtimeElement = document.createElement('div'); // New element for runtime
        this.runtimeElement.className = 'header_top-runtime';
        this._timezone = this.getConfiguredTimezone();
        this.themeToggle = document.getElementById('themeToggle');
        
        // Insert the runtime element after the battery element
        if (this.batteryElement) {
            this.batteryElement.parentNode.insertBefore(this.runtimeElement, this.batteryElement.nextSibling);
        }
        
        this.init();
    }

    init() {
        // Start clock update
        this.updateClock();
        setInterval(() => this.updateClock(), 1000);

        // Initialize WebSocket for cache updates
        this.initCacheWebSocket();
        
        // Theme handling
        this.themeToggle.addEventListener('click', () => {
            const currentTheme = document.documentElement.getAttribute('data-theme');
            const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
            document.documentElement.setAttribute('data-theme', newTheme);
            localStorage.setItem('theme', newTheme);
        });
    }

    initCacheWebSocket() {
        // Check if CacheWebSocketManager is available
        if (typeof CacheWebSocketManager === 'undefined') {
            console.error('CacheWebSocketManager not available. Header will not display UPS data.');
            return;
        }
        
        // Create WebSocket manager with callbacks
        this.cacheWebSocket = new CacheWebSocketManager({
            onUpdate: (data) => this.updateHeaderDisplay(data),
            onConnect: () => console.log('Header connected to WebSocket'),
            onDisconnect: () => console.log('Header disconnected from WebSocket'),
            debug: false
        });
    }

    getConfiguredTimezone() {
        const metaTag = document.querySelector('meta[name="timezone"]');
        if (metaTag && metaTag.content) {
            return metaTag.content;
        }
        if (window.APP_CONFIG && window.APP_CONFIG.timezone) {
            return window.APP_CONFIG.timezone;
        }
        return Intl.DateTimeFormat().resolvedOptions().timeZone;
    }

    updateClock() {
        if (!this.clockElement) return;
        
        const now = new Date();
        this.clockElement.textContent = now.toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            timeZone: this._timezone
        });
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

    isUpsOnline(status) {
        return status && status.includes('OL') && !status.includes('OB');
    }

    formatRuntime(seconds) {
        if (!seconds || isNaN(seconds) || seconds <= 0) return "N/A";
        
        const minutes = Math.floor(seconds / 60);
        const remainingSeconds = Math.round(seconds % 60);
        
        if (minutes >= 60) {
            const hours = Math.floor(minutes / 60);
            const remainingMinutes = minutes % 60;
            return `${hours}h ${remainingMinutes}m`;
        } else {
            return `${minutes}m ${remainingSeconds}s`;
        }
    }

    // Update UI elements based on data
    updateHeaderDisplay(data) {
        if (!data) return;
        
        // Update status
        if (this.statusElement && data.ups_status) {
            const formattedStatus = this.formatUPSStatus(data.ups_status);
            this.statusElement.textContent = formattedStatus;
            
            // Check if UPS is on battery and discharging to apply critical status style
            const isOnBattery = data.ups_status.includes('OB');
            const isDischarging = data.ups_status.includes('DISCHRG');
            
            // Apply or remove the critical pulsing red effect based on status
            if (isOnBattery && isDischarging) {
                this.statusElement.classList.add('ups-status-critical');
            } else {
                this.statusElement.classList.remove('ups-status-critical');
            }
            
            // Determine if the UPS is online
            const isOnline = this.isUpsOnline(data.ups_status);
            
            // Handle display differences between online and other states
            if (isOnline) {
                // Online mode - show load and power, hide runtime
                if (this.loadElement) this.loadElement.style.display = 'flex';
                if (this.powerElement) this.powerElement.style.display = 'flex';
                if (this.runtimeElement) this.runtimeElement.style.display = 'none';
                
                // Update battery with charging animation if charging
                if (this.batteryElement && data.battery_charge) {
                    const isCharging = data.ups_status.includes('CHRG');
                    
                    // Create battery element with charging animation if needed
                    this.batteryElement.innerHTML = `
                        <i class="fas fa-battery-three-quarters"></i>
                        <span class="${isCharging ? 'battery-charging' : ''}">${parseFloat(data.battery_charge).toFixed(1)}%</span>
                    `;
                }
                
                // Update load
                if (this.loadElement && data.ups_load) {
                    this.loadElement.innerHTML = `
                        <i class="fas fa-tachometer-alt"></i>${parseFloat(data.ups_load).toFixed(1)}%
                    `;
                }
                
                // Update power
                if (this.powerElement && data.ups_realpower) {
                    this.powerElement.innerHTML = `
                        <i class="fas fa-bolt"></i>${parseFloat(data.ups_realpower).toFixed(1)}W
                    `;
                }
            } else {
                // Non-online mode - hide load and power, show runtime
                if (this.loadElement) this.loadElement.style.display = 'none';
                if (this.powerElement) this.powerElement.style.display = 'none';
                if (this.runtimeElement) this.runtimeElement.style.display = 'flex';
                
                // Update battery
                if (this.batteryElement && data.battery_charge) {
                    // Change the battery icon based on the state
                    let batteryIcon = 'fa-battery-three-quarters';
                    const charge = parseFloat(data.battery_charge);
                    
                    if (charge <= 10) batteryIcon = 'fa-battery-empty';
                    else if (charge <= 25) batteryIcon = 'fa-battery-quarter';
                    else if (charge <= 50) batteryIcon = 'fa-battery-half';
                    else if (charge <= 75) batteryIcon = 'fa-battery-three-quarters';
                    else batteryIcon = 'fa-battery-full';
                    
                    this.batteryElement.innerHTML = `
                        <i class="fas ${batteryIcon}"></i>${charge.toFixed(1)}%
                    `;
                }
                
                // Update runtime
                if (this.runtimeElement && data.battery_runtime) {
                    const runtime = parseFloat(data.battery_runtime);
                    const formattedRuntime = this.formatRuntime(runtime);
                    
                    this.runtimeElement.innerHTML = `
                        <i class="fas fa-hourglass-half"></i>${formattedRuntime} left
                    `;
                }
            }
        }
    }

    async updateUPSData() {
        // This method is deprecated and will be removed
        console.warn('updateUPSData via HTTP API is deprecated and will be removed');
    }
}

// Initialize when the DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.headerManager = new HeaderManager();
}); 