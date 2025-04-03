// Main Options Page File
// This file imports and initializes all modular components

// Initialize modules when the DOM is loaded
document.addEventListener('DOMContentLoaded', function() {
    if (window.webLogger) {
        window.webLogger.console('Initializing options page with modular structure');
    }
    
    // Initialize email module
    console.log("Starting email initialization - loading providers first");
    loadEmailProviders().then(() => {
        console.log("Email providers loaded successfully, now loading email configuration");
        loadEmailConfig();
        
        // Load all email configurations explicitly
        if (typeof loadAllEmailConfigs === 'function') {
            console.log("Loading all email configurations");
            loadAllEmailConfigs();
        } else {
            console.error("loadAllEmailConfigs function not available");
        }
    }).catch(error => {
        console.error("Failed to load email providers:", error);
        // Still try to load the configuration even if providers fail
        console.log("Attempting to load email configuration without providers");
        loadEmailConfig();
        
        // Load all email configurations explicitly
        if (typeof loadAllEmailConfigs === 'function') {
            console.log("Loading all email configurations (after provider failure)");
            loadAllEmailConfigs();
        } else {
            console.error("loadAllEmailConfigs function not available");
        }
    });
    
    // Add event listener for the Test Email button in the form
    const testEmailBtn = document.getElementById('testEmailBtn');
    if (testEmailBtn) {
        testEmailBtn.addEventListener('click', function() {
            if (typeof testEmailFromForm === 'function') {
                testEmailFromForm();
            }
        });
    }
    
    // Hide the Save Configuration button initially
    const saveEmailConfigBtn = document.getElementById('saveEmailConfigBtn');
    if (saveEmailConfigBtn) {
        saveEmailConfigBtn.style.display = 'none';
        
        // Add click event listener for the Save Configuration button
        console.log("Adding event listener to saveEmailConfigBtn");
        saveEmailConfigBtn.addEventListener('click', function(e) {
            console.log("Save Configuration button clicked");
            e.preventDefault();
            if (typeof handleSaveEmailConfig === 'function') {
                console.log("Calling handleSaveEmailConfig function");
                handleSaveEmailConfig(e);
            } else {
                console.error("handleSaveEmailConfig function not available");
                // Try loading it from the module if not already loaded
                const emailModule3 = document.querySelector('script[src*="opt_email_save.js"]');
                if (!emailModule3) {
                    console.log("Loading opt_email_save.js module dynamically");
                    const script = document.createElement('script');
                    script.src = '/static/js/options/opt_email_save.js';
                    document.head.appendChild(script);
                    
                    script.onload = function() {
                        if (typeof handleSaveEmailConfig === 'function') {
                            handleSaveEmailConfig(e);
                        } else {
                            console.error("Failed to load handleSaveEmailConfig function");
                        }
                    };
                }
            }
        });
    }
    
    // Setup reconfigure button
    const reconfigureBtn = document.getElementById('reconfigureBtn');
    if (reconfigureBtn) {
        reconfigureBtn.addEventListener('click', function() {
            if (typeof setConfiguredState === 'function') {
                setConfiguredState(false);
            }
        });
    }
    
    // Initialize email configuration form
    const emailConfigForm = document.getElementById('emailConfigForm');
    if (emailConfigForm) {
        emailConfigForm.addEventListener('submit', function(e) {
            e.preventDefault();
            
            if (typeof handleSaveEmailConfig === 'function') {
                handleSaveEmailConfig(this);
            } else {
                const formData = new FormData(this);
                const config = {};
                
                // Manually add the provider since it's outside the form
                const provider = document.getElementById('email_provider').value;
                config.provider = provider;
                
                formData.forEach((value, key) => {
                    if (key === 'password' && !value) {
                        // Skip empty password
                    } else if (key !== 'enabled') { // Ignore enabled field
                        config[key] = value;
                    }
                });
                
                fetch('/api/settings/mail', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(config)
                })
                .then(response => response.json())
                .then(data => {
                    if (data.success) {
                        showAlert('emailStatus', 'Configuration saved successfully', 'success', true);
                        loadEmailConfig();  // Immediately reload email configuration
                        if (typeof loadNotifySettings === 'function') {
                            loadNotifySettings();  // Reload notification settings
                        }
                        
                        // Initialize scheduler if it exists
                        if (typeof ReportScheduler !== 'undefined' && ReportScheduler.initialize) {
                            ReportScheduler.initialize(); // Use static initialize method if available
                        } else if (typeof ReportScheduler !== 'undefined') {
                            const scheduler = new ReportScheduler();  // Reinitialize scheduler
                            if (scheduler && typeof scheduler.loadSchedules === 'function') {
                                scheduler.loadSchedules();  // Reload schedules
                            }
                            window.reportScheduler = scheduler;
                        }
                        
                        // Force complete page reload after showing success message
                        setTimeout(() => {
                            location.href = location.href;
                        }, 1500);
                    } else {
                        showAlert('emailStatus', 'Error saving configuration: ' + data.message, 'danger');
                    }
                })
                .catch(error => {
                    console.error('Error saving configuration:', error);
                    showAlert('emailStatus', 'Error saving configuration', 'danger');
                });
            }
        });
    }
    
    // When any field of the form is modified, hide the Save Configuration button
    document.querySelectorAll('.options_mail_form_group input').forEach(input => {
        input.addEventListener('input', function() {
            const saveConfigBtn = document.getElementById('saveConfigBtn');
            if (saveConfigBtn) {
                saveConfigBtn.classList.add('hidden');
            }
        });
    });
    
    // Initialize the notification module if it exists
    if (typeof populateEmailDropdowns === 'function') {
        // Make sure to populate dropdowns first, which will then call loadNotifySettings
        populateEmailDropdowns();
    } else if (typeof loadNotifySettings === 'function') {
        // Fallback if populateEmailDropdowns doesn't exist
        loadNotifySettings();
    }
    
    // Initialize system module if function exists
    if (typeof initializeSystemModule === 'function') {
        initializeSystemModule();
    }
    
    // Initialize database module if function exists
    if (typeof initializeDatabaseModule === 'function') {
        initializeDatabaseModule();
    }
    
    // Initialize logs module if function exists
    if (typeof initializeLogsModule === 'function') {
        initializeLogsModule();
    }
    
    // Initialize scheduler if it exists
    if (typeof ReportScheduler !== 'undefined') {
        let scheduler;
        if (ReportScheduler.initialize) {
            scheduler = ReportScheduler.initialize();
        } else {
            scheduler = new ReportScheduler();
        }
        window.scheduler = scheduler;  // Make it available globally
    }
    
    // Initialize the options page class
    if (typeof OptionsPage !== 'undefined') {
        // Remove existing instance if any
        if (window.optionsPage) {
            console.log("Removing existing OptionsPage instance");
            delete window.optionsPage;
        }
        
        console.log("Creating new OptionsPage instance");
        const optionsPage = new OptionsPage();
        window.optionsPage = optionsPage;
    }
    
    // Ensure that the log CSS file is loaded
    const logStylesheet = document.createElement('link');
    logStylesheet.rel = 'stylesheet';
    logStylesheet.id = 'log-styles';
    
    // Remove any previous stylesheets with the same ID
    const existingStylesheet = document.getElementById('log-styles');
    if (existingStylesheet) {
        existingStylesheet.remove();
    }
    
    document.head.appendChild(logStylesheet);
    
    // Force the application of the styles to the log container
    const logPreview = document.getElementById('logPreview');
    if (logPreview) {
        // Apply directly the styles to ensure they are respected
        Object.assign(logPreview.style, {
            maxHeight: '600px',
            overflowY: 'auto',
            border: '1px solid #30363d',
            borderRadius: '4px',
            backgroundColor: '#0d1117',
            padding: '8px',
            fontSize: '0.85rem',
            lineHeight: '1.1',
            fontFamily: "'Consolas', 'Monaco', 'Courier New', monospace",
            color: '#e6e6e6'
        });
    }
    
    // Email configuration buttons
    const addEmailConfigBtn = document.getElementById('addEmailConfigBtn');
    if (addEmailConfigBtn) {
        addEmailConfigBtn.addEventListener('click', function() {
            if (typeof handleAddEmailConfig === 'function') {
                handleAddEmailConfig();
            } else {
                // Hide form containers but keep the add button visible
                const emailConfigForm = document.getElementById('emailConfigForm');
                const providerSelectorContainer = document.getElementById('providerSelectorContainer');
                const emailConfigListCard = document.getElementById('emailConfigListCard');
                const emailConfigsContainer = document.getElementById('emailConfigsContainer');
                const addEmailConfigContainer = document.getElementById('addEmailConfigContainer');
                const emailConfigFormCard = document.getElementById('emailConfigFormCard');
                const configButtons = document.getElementById('configurationButtons');
                const configStatus = document.getElementById('configurationStatus');
                
                // Update display properties
                if (emailConfigForm) emailConfigForm.style.display = 'block';
                if (providerSelectorContainer) providerSelectorContainer.style.display = 'none';
                if (emailConfigListCard) emailConfigListCard.style.display = 'none';
                if (emailConfigsContainer) emailConfigsContainer.style.display = 'none';
                // Keep the add button container visible
                if (emailConfigFormCard) emailConfigFormCard.style.display = 'block';
                
                // Show configuration buttons
                if (configButtons) configButtons.classList.remove('hidden');
                if (configStatus) configStatus.classList.add('hidden');
                
                // Enable form inputs
                document.querySelectorAll('.options_mail_form_group input, .options_mail_form_group select').forEach(input => {
                    input.disabled = false;
                });
                
                // Reset form fields
                if (typeof clearFormFields === 'function') {
                    clearFormFields();
                }
                
                // Explicitly clear the email_config_id field to ensure we're adding a new configuration
                const emailConfigIdEl = document.getElementById('email_config_id');
                if (emailConfigIdEl) {
                    emailConfigIdEl.value = '';
                    // Also remove the attribute completely to ensure it's not sent
                    emailConfigIdEl.removeAttribute('value');
                }
            }
        });
    }
    
    // Setup email provider dropdown to update fields based on the selected provider
    const emailProviderSelect = document.getElementById('email_provider');
    if (emailProviderSelect) {
        console.log("Adding change event listener to email provider dropdown");
        
        // Per assicurarsi che funzioni davvero, aggiungiamo l'evento sia come change che come input
        ['change', 'input'].forEach(eventType => {
            emailProviderSelect.addEventListener(eventType, function() {
                console.log(`Provider ${eventType} event triggered with value:`, this.value);
                
                // Call the updateProviderFields function directly if available
                if (typeof updateProviderFields === 'function') {
                    console.log("Calling updateProviderFields with", this.value);
                    updateProviderFields(this.value);
                } else if (typeof updateFormFieldsForProvider === 'function') {
                    console.log("Calling updateFormFieldsForProvider with", this.value);
                    updateFormFieldsForProvider(this.value);
                } else {
                    console.error("No provider field update function available!");
                }
            });
        });
        
        // Imposta anche un handler di click, a volte necessario per triggare eventi su alcuni browser
        emailProviderSelect.addEventListener('click', function() {
            console.log("Provider dropdown clicked");
        });
    }
    
    // Initialize tabs functionality
    const tabButtons = document.querySelectorAll('.options_tab_button');
    const tabContents = document.querySelectorAll('.options_tab_content');
    
    if (window.webLogger) {
        window.webLogger.console('Found ' + tabButtons.length + ' tab buttons and ' + tabContents.length + ' tab contents');
        // Debug tab contents
        tabContents.forEach(content => {
            window.webLogger.console('Tab content: ' + content.id + ', classes: ' + content.className);
        });
    } else {
        console.log('Found ' + tabButtons.length + ' tab buttons and ' + tabContents.length + ' tab contents');
        // Debug tab contents
        tabContents.forEach(content => {
            console.log('Tab content: ' + content.id + ', classes: ' + content.className);
        });
    }
    
    // Manually initialize tabs - remove hidden class from tabs but keep them inactive
    tabContents.forEach(content => {
        // Keep the email tab active at start
        if (content.id !== 'email_tab') {
            content.classList.add('hidden');
        }
    });
    
    tabButtons.forEach(button => {
        button.addEventListener('click', function() {
            const tabName = this.getAttribute('data-tab');
            const tabId = tabName + '_tab';
            
            if (window.webLogger) {
                window.webLogger.console('Tab clicked: ' + tabName + ', looking for tab content with id: ' + tabId);
            } else {
                console.log('Tab clicked: ' + tabName + ', looking for tab content with id: ' + tabId);
            }
            
            // Remove active class from all buttons
            tabButtons.forEach(btn => btn.classList.remove('active'));
            
            // Hide all tab contents
            tabContents.forEach(content => {
                content.classList.remove('active');
                content.classList.add('hidden');
                content.style.display = 'none';
            });
            
            // Add active class to current button
            this.classList.add('active');
            
            // Show corresponding tab content
            const tabContent = document.getElementById(tabId);
            if (tabContent) {
                tabContent.classList.add('active');
                tabContent.classList.remove('hidden');
                tabContent.style.display = 'block';
                
                if (window.webLogger) {
                    window.webLogger.console('Activated tab: ' + tabId);
                } else {
                    console.log('Activated tab: ' + tabId);
                }
                
                // Initialize specific modules for this tab if needed
                if (tabName === 'Extranotifs' && typeof initializeNtfyModule === 'function') {
                    if (window.webLogger) {
                        window.webLogger.console('Initializing Ntfy module');
                    }
                    initializeNtfyModule();
                } else if (tabName === 'Webhook' && typeof initializeWebhookModule === 'function') {
                    if (window.webLogger) {
                        window.webLogger.console('Initializing Webhook module');
                    }
                    initializeWebhookModule();
                } else if (tabName === 'variables' && typeof initializePollingThreadModule === 'function') {
                    if (window.webLogger) {
                        window.webLogger.console('Initializing PowerFlow module');
                    }
                    initializePollingThreadModule();
                } else if (tabName === 'Database' && typeof initializeDatabaseModule === 'function') {
                    if (window.webLogger) {
                        window.webLogger.console('Refreshing Database module data');
                    }
                    // Just refresh the database stats when clicking the tab
                    if (typeof loadDatabaseStats === 'function') {
                        loadDatabaseStats();
                    }
                } else if (tabName === 'Log' && typeof initializeLogsModule === 'function') {
                    if (window.webLogger) {
                        window.webLogger.console('Initializing Logs module');
                    }
                    initializeLogsModule();
                    
                    // Ensure logs are loaded when clicking the tab
                    if (typeof loadLogs === 'function') {
                        if (window.webLogger) {
                            window.webLogger.console('Loading logs on tab click');
                        }
                        loadLogs();
                    }
                } else if (tabName === 'Advanced' && typeof initializeAdvancedModule === 'function') {
                    if (window.webLogger) {
                        window.webLogger.console('Initializing Advanced module');
                    }
                    initializeAdvancedModule();
                } else if (tabName === 'About' && typeof loadSystemInfo === 'function') {
                    if (window.webLogger) {
                        window.webLogger.console('Loading system information for About tab');
                    }
                    loadSystemInfo();
                } else if (tabName === 'Email') {
                    if (window.webLogger) {
                        window.webLogger.console('Initializing Email tab');
                    }
                    
                    // Force a full refresh of the Email tab
                    document.querySelectorAll('.options_email_select').forEach(select => {
                        // Reset to ensure we get a fresh start
                        select.innerHTML = '<option value="">Select email</option>';
                    });
                    
                    // Use populateEmailDropdowns directly
                    if (typeof populateEmailDropdowns === 'function') {
                        populateEmailDropdowns();
                    }
                }
            } else {
                if (window.webLogger) {
                    window.webLogger.console('ERROR: Tab content not found with id: ' + tabId);
                } else {
                    console.error('ERROR: Tab content not found with id: ' + tabId);
                }
            }
        });
    });
    
    if (window.webLogger) {
        window.webLogger.console('Options page initialization complete - modules will be initialized on tab click');
    }
});

// Helper function to show alerts in the UI
function showAlert(containerId, message, type = 'info', autoHide = false) {
    console.log(`Showing alert in ${containerId}: ${message} (${type})`);
    const container = document.getElementById(containerId);
    if (!container) {
        console.error(`Alert container ${containerId} not found`);
        return;
    }
    
    // Set the alert content and class
    container.textContent = message;
    container.className = `options_alert options_alert_${type}`;
    container.classList.remove('hidden');
    
    // Auto-hide the alert after 3 seconds if requested
    if (autoHide) {
        setTimeout(() => {
            container.classList.add('hidden');
        }, 3000);
    }
}

// Make the function available globally
window.showAlert = showAlert; 