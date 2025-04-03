/**
 * Polling Thread Configuration
 * This module handles the modification of the UPS data polling interval
 */

// Logger for the Polling Thread page
const pollingLogger = {
    data: (...args) => window.webLogger ? window.webLogger.data('[Polling Thread]', ...args) : console.log('[Polling Thread]', ...args),
    error: (...args) => window.webLogger ? window.webLogger.error('[Polling Thread]', ...args) : console.error('[Polling Thread]', ...args),
    event: (...args) => window.webLogger ? window.webLogger.event('[Polling Thread]', ...args) : console.log('[Polling Thread]', ...args),
    page: (...args) => window.webLogger ? window.webLogger.page('[Polling Thread]', ...args) : console.log('[Polling Thread]', ...args)
};

// Initialize the polling thread configuration
function initializePollingThreadModule() {
    pollingLogger.page('Initializing polling thread configuration');
    
    // Get DOM elements
    const pollingIntervalInput = document.getElementById('polling_interval');
    const savePollingBtn = document.getElementById('savePollingBtn');
    const resetPollingBtn = document.getElementById('resetPollingBtn');
    const pollingThreadStatus = document.getElementById('polling_thread_status');
    
    // Initialize collapse functionality for the polling thread card
    const pollingThreadCard = document.querySelector('.options_card.collapse-card:nth-of-type(2)');
    if (pollingThreadCard) {
        const headerElement = pollingThreadCard.querySelector('.collapse-header');
        const content = pollingThreadCard.querySelector('.collapse-content');
        
        if (headerElement && content) {
            headerElement.addEventListener('click', function() {
                if (content.classList.contains('collapsed')) {
                    // Expand
                    content.classList.remove('collapsed');
                    pollingThreadCard.classList.add('expanded');
                } else {
                    // Collapse
                    content.classList.add('collapsed');
                    pollingThreadCard.classList.remove('expanded');
                }
            });
        }
    }
    
    // Load current polling interval
    loadPollingInterval();
    
    // Add event listeners
    if (savePollingBtn) {
        savePollingBtn.addEventListener('click', savePollingInterval);
    }
    
    if (resetPollingBtn) {
        resetPollingBtn.addEventListener('click', resetPollingInterval);
    }
    
    /**
     * Load the current polling interval from the server
     */
    function loadPollingInterval() {
        pollingLogger.data('Loading polling interval');
        
        fetch('/api/options/variable-config')
            .then(response => response.json())
            .then(data => {
                if (data && data.polling_interval) {
                    pollingIntervalInput.value = data.polling_interval;
                    pollingLogger.data(`Loaded polling interval: ${data.polling_interval} seconds`);
                } else {
                    pollingIntervalInput.value = 1;
                    pollingLogger.warning('No polling interval found, using default of 1 second');
                }
            })
            .catch(error => {
                pollingLogger.error(`Error loading polling interval: ${error}`);
                pollingIntervalInput.value = 1;
                showStatus('error', 'Error loading polling interval. Using default of 1 second');
            });
    }
    
    /**
     * Save the polling interval to the server
     */
    function savePollingInterval() {
        const interval = parseInt(pollingIntervalInput.value);
        
        if (isNaN(interval) || interval < 1 || interval > 60) {
            showStatus('error', 'Invalid interval. Please select a value between 1 and 60 seconds.');
            return;
        }
        
        pollingLogger.data(`Saving polling interval: ${interval} seconds`);
        showStatus('info', 'Saving polling interval...');
        
        fetch('/api/settings/polling-interval', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ 
                polling_interval: interval,
                update_both: true  // Flag to update both pollfreq and pollinterval
            })
        })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                pollingLogger.data('Polling interval saved successfully');
                showStatus('success', 'Polling interval saved. Restarting application...');
                
                // Restart the application
                setTimeout(() => {
                    restartApplication();
                }, 1500);
            } else {
                pollingLogger.error(`Error saving polling interval: ${data.error}`);
                showStatus('error', `Error saving polling interval: ${data.error}`);
            }
        })
        .catch(error => {
            pollingLogger.error(`Error saving polling interval: ${error}`);
            showStatus('error', 'Failed to save polling interval. Please try again.');
        });
    }
    
    /**
     * Reset the polling interval to default (1 second)
     */
    function resetPollingInterval() {
        pollingIntervalInput.value = 1;
        showStatus('info', 'Reset to default value (1 second) for both pollfreq and pollinterval. Click "Save & Reboot" to apply.');
    }
    
    /**
     * Restart the application
     */
    function restartApplication() {
        pollingLogger.page('Restarting application');
        
        fetch('/api/restart', {
            method: 'POST'
        })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                showStatus('success', 'Application restarting. Please wait...');
                
                // Reload the page after a short delay
                setTimeout(() => {
                    window.location.reload();
                }, 5000);
            } else {
                pollingLogger.error(`Error restarting application: ${data.message}`);
                showStatus('error', `Error restarting application: ${data.message}`);
            }
        })
        .catch(error => {
            pollingLogger.error(`Error restarting application: ${error}`);
            showStatus('success', 'The application is restarting...');
            
            // Still reload the page after a delay even if there was an error,
            // as the error is likely because the server is restarting
            setTimeout(() => {
                window.location.reload();
            }, 5000);
        });
    }
    
    /**
     * Show a status message using the global notification system
     * @param {string} type - The type of status (success, error, info)
     * @param {string} message - The message to display
     */
    function showStatus(type, message) {
        // Use the global notify function only
        window.notify(message, type, true);
    }
}

// Export to window object so it can be called from options_page.js
window.initializePollingThreadModule = initializePollingThreadModule; 