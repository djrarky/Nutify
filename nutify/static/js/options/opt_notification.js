// Notification Settings Module

// Load notification settings
async function loadNotifySettings() {
    console.log("Starting loadNotifySettings");
    
    // Reset checkboxes
    document.querySelectorAll('.options_nutify_checkbox').forEach(checkbox => {
        checkbox.checked = false;
        checkbox.style.display = 'none'; // Hide checkboxes by default
    });
    
    // Hide test buttons by default
    document.querySelectorAll('.options_nutify_test').forEach(button => {
        button.style.display = 'none';
    });
    
    try {
        // Fetch notification settings
        console.log("Fetching notification settings from /api/settings/nutify");
        const response = await fetch('/api/settings/nutify');
        if (!response.ok) {
            throw new Error('Failed to load notification settings');
        }
        
        const data = await response.json();
        if (!data.success || !data.data) {
            console.warn("No notification settings found");
            return null;
        }
        
        // Store settings for later use
        const settings = data.data;
        console.log("Notification settings loaded:", settings);
        
        // Get all email dropdowns
        const allDropdowns = document.querySelectorAll('.options_email_select');
        if (allDropdowns.length === 0) {
            console.error("No email dropdowns found in the DOM");
            return null;
        }
        
        // Check if dropdowns have options
        const firstDropdown = allDropdowns[0];
        if (firstDropdown.options.length <= 1) {
            console.log("Email dropdowns have no options, loading emails first");
            await populateEmailDropdowns();
            
            // After dropdowns are populated, try to set notification settings again
            setTimeout(() => {
                console.log("Setting notification values after populating dropdowns");
                setNotificationValues(settings);
            }, 100);
            
            return settings;
        }
        
        // Set notification values
        setNotificationValues(settings);
        
        return settings;
    } catch (error) {
        console.error('Error loading notification settings:', error);
        return null;
    }
}

// Helper function to set notification values
function setNotificationValues(settings) {
    if (!settings || !Array.isArray(settings)) {
        console.error("Invalid settings data:", settings);
        return;
    }
    
    console.log("Setting notification values for", settings.length, "settings");
    
    // First pass - set dropdown values
    settings.forEach(setting => {
        if (!setting.event_type || !setting.id_email) return;
        
        const emailSelect = document.querySelector(`.options_email_select[data-event-type="${setting.event_type}"]`);
        if (!emailSelect) return;
        
        const emailId = setting.id_email.toString();
        emailSelect.value = emailId;
        
        // Force browser to recognize the value change by triggering change event
        const changeEvent = new Event('change', { bubbles: true });
        emailSelect.dispatchEvent(changeEvent);
        
        console.log(`Set dropdown for ${setting.event_type} to email ID ${emailId}, current value: ${emailSelect.value}`);
    });
    
    // Force a redraw by temporarily hiding and showing each select element
    document.querySelectorAll('.options_email_select').forEach(select => {
        const originalDisplay = select.style.display;
        select.style.display = 'none';
        
        // Force browser to apply the style change
        void select.offsetHeight;
        
        select.style.display = originalDisplay;
    });
    
    // Second pass - set checkbox values
    setTimeout(() => {
        settings.forEach(setting => {
            if (!setting.event_type) return;
            
            const checkbox = document.querySelector(`input[data-event-type="${setting.event_type}"]`);
            const emailSelect = document.querySelector(`.options_email_select[data-event-type="${setting.event_type}"]`);
            const testButton = document.querySelector(`.options_nutify_test[data-event-type="${setting.event_type}"]`);
            
            // If dropdown was successfully set and we have an email ID
            if (emailSelect && setting.id_email && emailSelect.value == setting.id_email) {
                // Show and check/uncheck checkbox
                if (checkbox) {
                    checkbox.style.display = 'inline-block';
                    checkbox.checked = setting.enabled;
                    console.log(`Set checkbox for ${setting.event_type} to ${setting.enabled}`);
                }
                
                // Show test button
                if (testButton) {
                    testButton.style.display = 'inline-block';
                    console.log(`Showing test button for ${setting.event_type}`);
                }
            }
        });
    }, 50);
    
    // Initialize test buttons and event listeners
    initializeNotificationTests();
    setupNotificationEventListeners();
}

// Set up event listeners for notification controls
function setupNotificationEventListeners() {
    console.log("Setting up notification event listeners");
    
    // Add event listeners to email select dropdowns
    document.querySelectorAll('.options_email_select').forEach(dropdown => {
        dropdown.addEventListener('change', function() {
            console.log(`Email select changed for ${this.dataset.eventType}: ${this.value}`);
            
            const eventType = this.dataset.eventType;
            const emailId = this.value;
            
            // Get the corresponding checkbox and test button
            const checkbox = document.querySelector(`.options_nutify_checkbox[data-event-type="${eventType}"]`);
            const testButton = document.querySelector(`.options_nutify_test[data-event-type="${eventType}"]`);
            
            if (emailId) {
                // An email was selected, so show the checkbox and test button
                if (checkbox) {
                    checkbox.style.display = 'inline-block';
                    
                    // Create a notification
                    if (window.notify) {
                        window.notify(`Email for ${eventType} notifications set`, 'info', 5000);
                    }
                }
                
                if (testButton) {
                    testButton.style.display = 'inline-block';
                }
                
                // If the checkbox exists and is checked, send the update to the server
                if (checkbox && checkbox.checked) {
                    updateNotificationSetting(eventType, true, emailId);
                } else if (checkbox) {
                    // If checkbox exists but is unchecked, make sure it's showing
                    checkbox.style.display = 'inline-block';
                }
            } else {
                // No email selected, hide checkbox and test button
                if (checkbox) {
                    checkbox.style.display = 'none';
                    checkbox.checked = false;
                }
                
                if (testButton) {
                    testButton.style.display = 'none';
                }
                
                // Also update the database to disable this notification
                updateNotificationSetting(eventType, false, null);
            }
        });
    });
    
    // Add event listeners to notification checkboxes
    document.querySelectorAll('.options_nutify_checkbox').forEach(checkbox => {
        checkbox.addEventListener('change', function() {
            console.log(`Checkbox changed for ${this.dataset.eventType}: ${this.checked}`);
            
            const eventType = this.dataset.eventType;
            const enabled = this.checked;
            
            // Get the corresponding dropdown
            const dropdown = document.querySelector(`.options_email_select[data-event-type="${eventType}"]`);
            if (!dropdown) {
                console.error(`No dropdown found for ${eventType}`);
                return;
            }
            
            const emailId = dropdown.value;
            
            // Create a notification
            if (window.notify) {
                window.notify(`Email notifications for ${eventType} ${enabled ? 'enabled' : 'disabled'}`, enabled ? 'success' : 'info', 5000);
            }
            
            // Only update if an email is selected
            if (emailId) {
                updateNotificationSetting(eventType, enabled, emailId);
            } else {
                // No email selected, so we can't enable the notification
                if (enabled) {
                    // Reset the checkbox
                    this.checked = false;
                    
                    // Show an alert
                    if (window.notify) {
                        window.notify('Please select an email configuration first', 'error', 5000);
                    }
                    
                    showAlert('options_nutify_status', 'Please select an email configuration first', 'error', true);
                }
            }
        });
    });
}

// Populate email dropdowns in notification settings
async function populateEmailDropdowns() {
    console.log("Starting populateEmailDropdowns");
    
    try {
        // Fetch email configurations
        console.log("Fetching email configurations from API");
        const response = await fetch('/api/settings/mail/all');
        if (!response.ok) {
            throw new Error(`Failed to fetch email configurations: ${response.status}`);
        }
        
        const data = await response.json();
        if (!data.success) {
            throw new Error('Failed to fetch email configurations');
        }
        
        const configs = data.data;
        console.log(`Loaded ${configs.length} email configurations`);
        
        if (configs.length === 0) {
            console.warn("No email configurations found");
            return [];
        }
        
        // Get all email dropdowns
        const dropdowns = document.querySelectorAll('.options_email_select');
        console.log(`Found ${dropdowns.length} email dropdowns to populate`);
        
        if (dropdowns.length === 0) {
            console.warn("No email dropdowns found in DOM");
            return configs;
        }
        
        // Create options
        const options = configs.map(config => {
            // Get provider display name
            let providerName = 'Custom';
            if (config.provider && window.emailProviders && window.emailProviders[config.provider]) {
                providerName = window.emailProviders[config.provider].displayName || config.provider;
            }
            
            const destinationEmail = config.to_email || 'No recipient';
            return {
                value: config.id.toString(),
                text: `${config.id} - ${providerName} - ${destinationEmail}`
            };
        });
        
        // Repopulate each dropdown with the options
        dropdowns.forEach(dropdown => {
            const eventType = dropdown.dataset.eventType;
            
            // Clear dropdown
            dropdown.innerHTML = '';
            
            // Add default "Select email" option
            const defaultOption = document.createElement('option');
            defaultOption.value = '';
            defaultOption.textContent = 'Select email';
            dropdown.appendChild(defaultOption);
            
            // Add each email option
            options.forEach(option => {
                const optElement = document.createElement('option');
                optElement.value = option.value;
                optElement.textContent = option.text;
                dropdown.appendChild(optElement);
            });
            
            console.log(`Populated dropdown for ${eventType} with ${options.length} options`);
        });
        
        // Also populate the report email dropdown
        const reportEmailDropdown = document.getElementById('report_email_select');
        if (reportEmailDropdown) {
            reportEmailDropdown.innerHTML = '';
            
            // Add default option
            const defaultOption = document.createElement('option');
            defaultOption.value = '';
            defaultOption.textContent = 'Select email';
            reportEmailDropdown.appendChild(defaultOption);
            
            // Add each email option
            options.forEach(option => {
                const optElement = document.createElement('option');
                optElement.value = option.value;
                optElement.textContent = option.text;
                reportEmailDropdown.appendChild(optElement);
            });
            
            // Load saved selection if available
            const savedReportEmailId = localStorage.getItem('report_email_id');
            if (savedReportEmailId && reportEmailDropdown.querySelector(`option[value="${savedReportEmailId}"]`)) {
                reportEmailDropdown.value = savedReportEmailId;
            }
            
            // Add event listener to save selection
            reportEmailDropdown.addEventListener('change', function() {
                localStorage.setItem('report_email_id', this.value);
            });
        }
        
        console.log("Email dropdowns populated successfully");
        
        // After dropdowns are ready, fetch notification settings
        try {
            const notifyResponse = await fetch('/api/settings/nutify');
            if (!notifyResponse.ok) {
                throw new Error('Failed to fetch notification settings');
            }
            
            const notifyData = await notifyResponse.json();
            if (notifyData.success && notifyData.data) {
                console.log(`Loaded ${notifyData.data.length} notification settings directly`);
                
                // Set the values in the DOM
                setNotificationValuesDirectly(notifyData.data);
            }
        } catch (error) {
            console.error('Error fetching notification settings:', error);
        }
        
        return configs;
    } catch (error) {
        console.error('Error populating email dropdowns:', error);
        return [];
    }
}

// Sets notification values with direct DOM manipulation
function setNotificationValuesDirectly(settings) {
    if (!settings || !Array.isArray(settings)) {
        console.error("Invalid settings data for direct update");
        return;
    }
    
    console.log(`Directly setting values for ${settings.length} notification settings`);
    
    // For each notification setting that has an email ID
    settings.forEach(setting => {
        if (!setting.event_type || !setting.id_email) return;
        
        // Get the dropdown for this event type
        const dropdown = document.querySelector(`.options_email_select[data-event-type="${setting.event_type}"]`);
        if (!dropdown) {
            console.warn(`No dropdown found for ${setting.event_type}`);
            return;
        }
        
        // Set the value directly
        const emailId = setting.id_email.toString();
        dropdown.value = emailId;
        
        console.log(`Direct set: ${setting.event_type} dropdown to ${emailId}, value is now ${dropdown.value}`);
        
        // Get checkbox and test button
        const checkbox = document.querySelector(`input[data-event-type="${setting.event_type}"]`);
        const testButton = document.querySelector(`.options_nutify_test[data-event-type="${setting.event_type}"]`);
        
        // Show and set checkbox if enabled
        if (checkbox) {
            checkbox.style.display = 'inline-block';
            checkbox.checked = setting.enabled;
            console.log(`Direct set: ${setting.event_type} checkbox to ${setting.enabled}`);
        }
        
        // Show test button
        if (testButton) {
            testButton.style.display = 'inline-block';
        }
    });
}

// Update notification settings
async function updateNotificationSetting(eventType, enabled, idEmail) {
    try {
        console.log(`Updating notification setting: ${eventType}, enabled=${enabled}, idEmail=${idEmail}`);
        
        const response = await fetch('/api/settings/nutify/single', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                event_type: eventType,
                enabled: enabled,
                id_email: idEmail
            })
        });
        
        const result = await response.json();
        if (result.success) {
            console.log(`Notification setting for ${eventType} updated successfully`);
            // Display notification - removed to avoid duplicate notifications
            // The notification is already shown by the checkbox change event listener
            // if (typeof window.notify === 'function') {
            //     window.notify(`Email notification for ${eventType} ${enabled ? 'enabled' : 'disabled'}`, 'success', 5000);
            // } else {
            //     console.error("window.notify is not available");
            // }
        } else {
            console.error(`Error updating notification setting: ${result.error || 'Unknown error'}`);
            showAlert('options_nutify_status', `Error updating notification setting: ${result.error || 'Unknown error'}`, 'error', true);
            // Display error notification
            if (typeof window.notify === 'function') {
                window.notify(`Error updating notification: ${result.error || 'Unknown error'}`, 'error', 5000);
            } else {
                console.error("window.notify is not available");
            }
        }
        
        return result.success;
    } catch (error) {
        console.error(`Error updating notification setting: ${error.message}`);
        // Display error notification
        if (typeof window.notify === 'function') {
            window.notify(`Error updating notification: ${error.message}`, 'error', 5000);
        } else {
            console.error("window.notify is not available");
        }
        return false;
    }
}

// Initialize notification test buttons
function initializeNotificationTests() {
    // Add event listeners to test buttons with debounce protection
    let notifyTestIsProcessing = false;
    let lastNotifyTestTime = 0;

    document.querySelectorAll('.options_nutify_test').forEach(button => {
        button.addEventListener('click', function() {
            // Prevent double submissions
            const now = Date.now();
            if (notifyTestIsProcessing || (now - lastNotifyTestTime < 2000)) {
                return;
            }
            
            lastNotifyTestTime = now;
            notifyTestIsProcessing = true;
        
            const eventType = this.dataset.eventType;
            const dropdown = document.querySelector(`.options_email_select[data-event-type="${eventType}"]`);
            const emailId = dropdown ? dropdown.value : '';
            
            if (!emailId) {
                showAlert('options_nutify_status', 'Please select an email configuration first', 'error', true);
                notifyTestIsProcessing = false;
                return;
            }
            
            // Show loader
            this.querySelector('.btn-text').style.display = 'none';
            this.querySelector('.btn-loader').classList.remove('hidden');
            
            // Send test notification
            fetch(`/api/settings/test-notification?event_type=${eventType}&id_email=${emailId}`, {
                method: 'POST'
            })
            .then(response => response.json())
            .then(data => {
                if (data.success) {
                    window.notify('Test notification sent successfully!', 'success', 5000);
                } else {
                    window.notify(`Error: ${data.message || 'Failed to send test notification'}`, 'error', 5000);
                }
            })
            .catch(error => {
                showAlert('options_nutify_status', `Error: ${error.message}`, 'error', true);
            })
            .finally(() => {
                // Hide loader
                this.querySelector('.btn-text').style.display = 'inline';
                this.querySelector('.btn-loader').classList.add('hidden');
                notifyTestIsProcessing = false;
            });
        });
    });
}

// Initialize module when the page loads
let moduleInitialized = false;

document.addEventListener('DOMContentLoaded', function() {
    if (moduleInitialized) {
        console.log("Module already initialized, skipping");
        return;
    }
    
    moduleInitialized = true;
    console.log("Initializing notification module from DOMContentLoaded");
    
    // Initialize with a small delay to ensure DOM is fully loaded
    setTimeout(() => {
        populateEmailDropdowns();
    }, 100);
});

// Function to reinitialize when needed (e.g., when tab is clicked)
function reinitializeModule() {
    console.log("Manually reinitializing notification module");
    populateEmailDropdowns();
}

// Export functions for use in the main options page
window.loadNotifySettings = loadNotifySettings;
window.populateEmailDropdowns = populateEmailDropdowns;
window.updateNotificationSetting = updateNotificationSetting;
window.initializeNotificationTests = initializeNotificationTests;
window.reinitializeModule = reinitializeModule; 