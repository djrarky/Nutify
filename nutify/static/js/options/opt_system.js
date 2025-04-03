// System Settings Module

// Variables Configuration
async function loadVariablesConfig() {
    try {
        const response = await fetch('/api/settings/variables');
        if (response.ok) {
            const data = await response.json();
            
            if (data.success && data.data) {
                document.getElementById('currency').value = data.data.currency;
                document.getElementById('kwh_cost').value = parseFloat(data.data.price_per_kwh).toFixed(4);
                document.getElementById('co2_factor').value = parseFloat(data.data.co2_factor).toFixed(4);
                updateCurrencySymbol(data.data.currency || 'EUR');
            }
        }
    } catch (error) {
        console.error('Error loading variables config:', error);
    }
}

// Currency icon mapping
const currencyIcons = {
    'EUR': 'fa-euro-sign',
    'USD': 'fa-dollar-sign',
    'GBP': 'fa-pound-sign',
    'JPY': 'fa-yen-sign',
    'AUD': 'fa-dollar-sign',
    'CAD': 'fa-dollar-sign',
    'CHF': 'fa-franc-sign',
    'CNY': 'fa-yen-sign',
    'INR': 'fa-rupee-sign',
    'NZD': 'fa-dollar-sign',
    'BRL': 'fa-money-bill',
    'RUB': 'fa-ruble-sign',
    'KRW': 'fa-won-sign',
    'default': 'fa-money-bill'
};

function updateCurrencySymbol(currency) {
    const symbolMap = {
        'USD': 'USD',
        'EUR': 'EUR',
        'GBP': 'GBP',
        'JPY': 'JPY',
        'AUD': 'AUD',
        'CAD': 'CAD',
        'CHF': 'CHF',
        'CNY': 'CNY',
        'INR': 'INR',
        'NZD': 'NZD',
        'BRL': 'BRL',
        'RUB': 'RUB',
        'KRW': 'KRW',
        'PLN': 'PLN'
    };
    document.getElementById('currencySymbol').textContent = symbolMap[currency] || currency;
}

// Function to update currency symbol in energy page
function updateEnergyPageCurrencySymbol(currency) {
    const symbolMap = {
        'USD': '$', 'EUR': '€', 'GBP': '£', 'JPY': '¥',
        'AUD': 'A$', 'CAD': 'C$', 'CHF': 'Fr',
        'CNY': '¥', 'INR': '₹', 'NZD': 'NZ$',
        'BRL': 'R$', 'RUB': '₽', 'KRW': '₩',
        'PLN': 'PLN'
    };
    const energyPageSymbol = document.querySelector('.energy_stat_card .stat-icon i.fas');
    if (energyPageSymbol) {
        if (currency === 'EUR') {
            energyPageSymbol.classList.remove('fa-dollar-sign', 'fa-pound-sign', 'fa-yen-sign', 'fa-franc-sign', 'fa-rupee-sign', 'fa-ruble-sign', 'fa-won-sign');
            energyPageSymbol.classList.add('fa-euro-sign');
        } else if (currency === 'USD') {
            energyPageSymbol.classList.remove('fa-euro-sign', 'fa-pound-sign', 'fa-yen-sign', 'fa-franc-sign', 'fa-rupee-sign', 'fa-ruble-sign', 'fa-won-sign');
            energyPageSymbol.classList.add('fa-dollar-sign');
        } else if (currency === 'GBP') {
            energyPageSymbol.classList.remove('fa-euro-sign', 'fa-dollar-sign', 'fa-yen-sign', 'fa-franc-sign', 'fa-rupee-sign', 'fa-ruble-sign', 'fa-won-sign');
            energyPageSymbol.classList.add('fa-pound-sign');
        } else if (currency === 'JPY' || currency === 'CNY') {
            energyPageSymbol.classList.remove('fa-euro-sign', 'fa-dollar-sign', 'fa-pound-sign', 'fa-franc-sign', 'fa-rupee-sign', 'fa-ruble-sign', 'fa-won-sign');
            energyPageSymbol.classList.add('fa-yen-sign');
        } else if (currency === 'CHF') {
            energyPageSymbol.classList.remove('fa-euro-sign', 'fa-dollar-sign', 'fa-pound-sign', 'fa-yen-sign', 'fa-rupee-sign', 'fa-ruble-sign', 'fa-won-sign');
            energyPageSymbol.classList.add('fa-franc-sign');
        } else if (currency === 'INR') {
            energyPageSymbol.classList.remove('fa-euro-sign', 'fa-dollar-sign', 'fa-pound-sign', 'fa-yen-sign', 'fa-franc-sign', 'fa-ruble-sign', 'fa-won-sign');
            energyPageSymbol.classList.add('fa-rupee-sign');
        } else if (currency === 'RUB') {
            energyPageSymbol.classList.remove('fa-euro-sign', 'fa-dollar-sign', 'fa-pound-sign', 'fa-yen-sign', 'fa-franc-sign', 'fa-rupee-sign', 'fa-won-sign');
            energyPageSymbol.classList.add('fa-ruble-sign');
        } else if (currency === 'KRW') {
            energyPageSymbol.classList.remove('fa-euro-sign', 'fa-dollar-sign', 'fa-pound-sign', 'fa-yen-sign', 'fa-franc-sign', 'fa-rupee-sign', 'fa-ruble-sign');
            energyPageSymbol.classList.add('fa-won-sign');
        } else if (currency === 'PLN') {
            energyPageSymbol.classList.remove('fa-euro-sign', 'fa-dollar-sign', 'fa-pound-sign', 'fa-yen-sign', 'fa-franc-sign', 'fa-rupee-sign', 'fa-ruble-sign', 'fa-won-sign');
            energyPageSymbol.classList.add('fa-zloty-sign');
        } else {
            energyPageSymbol.classList.remove('fa-euro-sign', 'fa-pound-sign', 'fa-yen-sign', 'fa-franc-sign', 'fa-rupee-sign', 'fa-ruble-sign', 'fa-won-sign');
            energyPageSymbol.classList.add('fa-dollar-sign');
        }
    }
}

// System Information
async function loadSystemInfo() {
    try {
        const response = await fetch('/api/system/info');
        const data = await response.json();
        
        if (data.success) {
            document.getElementById('projectVersion').textContent = data.data.version;
            document.getElementById('lastUpdate').textContent = data.data.last_update;
            document.getElementById('projectStatus').textContent = data.data.status;
            document.getElementById('changelogText').textContent = data.data.changelog;
            
            // Update the class for the project status
            const statusElement = document.getElementById('projectStatus');
            
            // Remove all previous status classes and set only version-value
            statusElement.className = 'version-value';
            
            // Add a CSS class based directly on the status value
            // Remove spaces and convert to lowercase to create a valid CSS class
            if (data.data.status) {
                const statusClass = 'version-' + data.data.status.toLowerCase().replace(/\s+/g, '-');
                statusElement.classList.add(statusClass);
            }
        }
    } catch (error) {
        console.error('Error loading system info:', error);
    }
}

// Update the log configuration by sending both the checkbox state and the selected level.
function updateLogSettings() {
    const enabled = document.getElementById('systemLogEnabled').checked;
    const selectedLevel = document.getElementById('logLevelSelect').value;
    const werkzeugEnabled = document.getElementById('werkzeugLogEnabled').checked;
    const javascriptEnabled = document.getElementById('javascriptLogEnabled').checked;
    
    // Update JavaScript logger state properly for cross-page persistence
    if (window.webLogger) {
        // This will update both localStorage and sessionStorage
        window.webLogger.enable(javascriptEnabled);
    }
    
    fetch('/api/settings/log', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ 
            log: enabled, 
            level: selectedLevel, 
            werkzeug: werkzeugEnabled,
            javascript: javascriptEnabled
        })
    })
    .then(response => response.json())
    .then(data => {
        if(data.success){
            showAlert('logStatus', 'Log configuration updated. Restart the application to apply the changes.', 'success');
            // After a brief delay, send the request to restart the application
            setTimeout(() => {
                fetch('/api/restart', { method: 'POST' })
                .then(resp => {
                    // If the fetch returns an error, it may be due to the restart; wait for the reload.
                    return resp.json();
                })
                .then(restartData => {
                    if (restartData.success) {
                        showAlert('logStatus', 'The application is restarting...', 'success');
                    } else {
                        showAlert('logStatus', 'The application is restarting...', 'success');
                    }
                    setTimeout(() => location.reload(), 3000);
                })
                .catch(error => {
                    showAlert('logStatus', 'The application is restarting...', 'success');
                    setTimeout(() => location.reload(), 3000);
                });
            }, 1000);
        } else {
            showAlert('logStatus', 'Error updating: ' + data.message, 'danger');
        }
    })
    .catch(error => {
        showAlert('logStatus', 'Error updating log configuration', 'danger');
    });
}

// Utility Functions
function formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Initialize system module
function initializeSystemModule() {
    // Initialize currency selector
    const currencySelector = document.getElementById('currency');
    if (currencySelector) {
        currencySelector.addEventListener('change', function() {
            const currencyIcon = document.getElementById('currencyIcon');
            const selectedCurrency = this.value;
            
            // Remove all existing fa-* classes
            currencyIcon.className = 'fas';
            
            // Add the new icon class
            const iconClass = currencyIcons[selectedCurrency] || currencyIcons.default;
            currencyIcon.classList.add(iconClass);
            
            // Update the currency symbol in the cost input
            updateCurrencySymbol(selectedCurrency);
        });
    }
    
    // Initialize variables form
    const variablesForm = document.getElementById('variablesConfigForm');
    if (variablesForm) {
        variablesForm.addEventListener('submit', async function(e) {
            e.preventDefault();
            const formData = new FormData(this);
            const config = {
                currency: formData.get('currency'),
                price_per_kwh: parseFloat(formData.get('kwh_cost')),
                co2_factor: parseFloat(formData.get('co2_factor'))
            };

            try {
                const response = await fetch('/api/settings/variables', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(config)
                });

                const result = await response.json();
                if (result.success) {
                    window.notify('Variables saved successfully', 'success', 5000);
                } else {
                    window.notify('Error saving variables: ' + (result.message || 'Failed to save'), 'error', 5000);
                }
            } catch (error) {
                window.notify('Error saving variables', 'error', 5000);
            }
        });
    }
    
    // Initialize log settings
    const saveAndRestartBtn = document.getElementById('saveAndRestartBtn');
    if (saveAndRestartBtn) {
        saveAndRestartBtn.addEventListener('click', updateLogSettings);
    }
    
    // Initialize JavaScript logs checkbox based on stored settings
    const javascriptLogEnabled = document.getElementById('javascriptLogEnabled');
    if (javascriptLogEnabled) {
        // Check sessionStorage first (session-wide setting)
        const sessionValue = sessionStorage.getItem('GLOBAL_JS_LOGGING_ENABLED');
        let isJsLogsEnabled;
        
        if (sessionValue !== null) {
            // Use session value if available (priority)
            isJsLogsEnabled = sessionValue === 'true';
        } else {
            // Fall back to localStorage if no session value
            isJsLogsEnabled = localStorage.getItem('webLogger.enabled') === 'true';
            
            // Synchronize sessionStorage with localStorage
            sessionStorage.setItem('GLOBAL_JS_LOGGING_ENABLED', isJsLogsEnabled);
        }
        
        // Set the checkbox state
        javascriptLogEnabled.checked = isJsLogsEnabled;
        
        // Update the global flag for consistency
        window.GLOBAL_JS_LOGGING_ENABLED = isJsLogsEnabled;
        
        // Add direct event listener for immediate effect
        javascriptLogEnabled.addEventListener('change', function() {
            if (window.webLogger) {
                // When checkbox is checked, enable logs (true)
                // When checkbox is unchecked, disable logs (false)
                const newState = this.checked;
                
                // This single method call now handles all persistence
                window.webLogger.enable(newState);
                
                showAlert('logStatus', 'JavaScript logs ' + (newState ? 'enabled' : 'disabled'), 'success');
            }
        });
    }
}

// Export functions for use in the main options page
window.loadVariablesConfig = loadVariablesConfig;
window.updateCurrencySymbol = updateCurrencySymbol;
window.updateEnergyPageCurrencySymbol = updateEnergyPageCurrencySymbol;
window.loadSystemInfo = loadSystemInfo;
window.updateLogSettings = updateLogSettings;
window.formatBytes = formatBytes;
window.initializeSystemModule = initializeSystemModule; 