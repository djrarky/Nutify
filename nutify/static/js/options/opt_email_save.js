// Email Configuration Module - Save & Edit Operations
// Handles saving, editing and deleting email configurations:
// - Saving email configurations
// - Handling save button clicks
// - Deleting email configurations
// - Editing existing configurations
// - Resetting notification settings

// Function to save email configuration
function saveEmailConfig() {
    // Get all form data
    const form = document.getElementById('emailConfigForm');
    const formData = new FormData(form);
    const config = {};
    
    // Process all form fields
    formData.forEach((value, key) => {
        // Handle checkboxes
        if (key === 'use_tls' || key === 'use_starttls') {
            config[key] = value === 'on';
        } else {
            config[key] = value;
        }
    });
    
    // Manually add the provider since it's outside the form
    const provider = document.getElementById('email_provider').value;
    config.provider = provider;
    
    // Map form field names to API field names
    if (config.use_tls !== undefined) {
        config.tls = config.use_tls;
        delete config.use_tls;
    }
    
    if (config.use_starttls !== undefined) {
        config.tls_starttls = config.use_starttls;
        delete config.use_starttls;
    }
    
    // Determine if we're editing or creating a new configuration
    const isEditing = config.email_config_id && config.email_config_id !== '';
    const endpoint = isEditing ? `/api/settings/mail/${config.email_config_id}` : '/api/settings/mail';
    const method = isEditing ? 'PUT' : 'POST';
    
    // Update button state
    const saveButton = document.getElementById('saveEmailConfigBtn');
    const originalContent = saveButton.innerHTML;
    saveButton.disabled = true;
    saveButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';
    
    // Send the save request
    fetch(endpoint, {
        method: method,
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(config)
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            // Show alert in the container
            showAlert('emailStatus', 'Email configuration saved successfully', 'success', true);
            
            // Also show floating notification
            if (typeof window.notify === 'function') {
                window.notify('Email configuration saved successfully', 'success', 5000);
            } else {
                console.error("window.notify is not available");
            }
            
            loadAllEmailConfigs();
            
            // Hide the form and show the configurations list
            const emailConfigFormCard = document.getElementById('emailConfigFormCard');
            const emailConfigListCard = document.getElementById('emailConfigListCard');
            
            if (emailConfigFormCard) emailConfigFormCard.style.display = 'none';
            if (emailConfigListCard) emailConfigListCard.style.display = 'block';
            
            // Reset the form
            clearFormFields();
        } else {
            // Show alert in the container
            showAlert('emailStatus', 'Error saving email configuration: ' + (data.message || 'Unknown error'), 'danger', true);
            
            // Also show floating notification
            if (typeof window.notify === 'function') {
                window.notify('Error saving email configuration: ' + (data.message || 'Unknown error'), 'error', 5000);
            } else {
                console.error("window.notify is not available");
            }
        }
    })
    .catch(error => {
        // Show alert in the container
        showAlert('emailStatus', 'Error saving email configuration', 'danger', true);
        
        // Also show floating notification
        if (typeof window.notify === 'function') {
            window.notify('Error saving email configuration', 'error', 5000);
        } else {
            console.error("window.notify is not available");
        }
    })
    .finally(() => {
        // Restore button state
        saveButton.disabled = false;
        saveButton.innerHTML = originalContent;
    });
}

// Function to handle the save email config button click
function handleSaveEmailConfig(event) {
    event.preventDefault();
    
    // Get the form data
    const form = document.getElementById('emailConfigForm');
    const formData = new FormData(form);
    
    // Validate required fields
    const requiredFields = ['smtp_server', 'smtp_port', 'smtp_username'];
    let missingFields = false;
    
    requiredFields.forEach(field => {
        const value = formData.get(field);
        if (!value || value.trim() === '') {
            missingFields = true;
            // Highlight the field
            const input = document.getElementById(field);
            if (input) input.classList.add('error');
        }
    });
    
    if (missingFields) {
        showAlert('emailStatus', 'Please fill in all required fields', 'danger');
        return;
    }
    
    // Save the configuration
    saveEmailConfig();
}

// Function to delete email configuration
function deleteEmailConfig(configId) {
    if (!configId) {
        showAlert('emailStatus', 'No configuration selected for deletion', 'danger');
        return;
    }
    
    if (!confirm('Are you sure you want to delete this email configuration? This action cannot be undone.')) {
        return;
    }
    
    fetch(`/api/settings/mail/${configId}`, {
        method: 'DELETE'
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            showAlert('emailStatus', 'Email configuration deleted successfully', 'success', true);
            
            // Reset notification settings associated with this email config
            resetNotificationSettingsForEmail(configId);
            
            // Reload the email configurations
            loadAllEmailConfigs();
            
            // Also reload notification settings to update dropdowns
            if (typeof loadNotifySettings === 'function') {
                loadNotifySettings();
            }
            
            // Reload the scheduler if it exists
            if (window.scheduler && typeof window.scheduler.loadSchedules === 'function') {
                window.scheduler.loadSchedules();
            }
            
            // Force page reload after a short delay to ensure all changes are applied
            setTimeout(() => {
                location.reload();
            }, 1500);
        } else {
            showAlert('emailStatus', 'Error deleting email configuration: ' + (data.message || 'Unknown error'), 'danger', true);
        }
    })
    .catch(error => {
        showAlert('emailStatus', 'Error deleting email configuration', 'danger', true);
    });
}

// Function to reset notification settings for an email
function resetNotificationSettingsForEmail(configId) {
    // First approach: Use the API endpoint to reset all settings for this email
    fetch(`/api/settings/nutify/reset/${configId}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        }
    })
    .then(response => response.json())
    .then(data => {
        console.log('Reset notification settings API response:', data);
    })
    .catch(error => {
        console.error('Error calling reset notification settings API:', error);
    });
    
    // Second approach: Update UI and make individual API calls for each event type
    // Get all email select dropdowns
    const emailDropdowns = document.querySelectorAll('.options_email_select');
    
    console.log('Checking all email dropdowns for configId:', configId);
    
    // Check each dropdown for the deleted email ID
    emailDropdowns.forEach(async (dropdown) => {
        if (dropdown.value == configId) {
            console.log(`Found dropdown using deleted email ID ${configId} for event type ${dropdown.dataset.eventType}`);
            
            // Reset the dropdown to default (empty)
            dropdown.value = '';
            
            // Get the event type
            const eventType = dropdown.dataset.eventType;
            
            // Get the corresponding checkbox
            const checkbox = document.querySelector(`.options_nutify_checkbox[data-event-type="${eventType}"]`);
            
            // Always uncheck the checkbox, regardless of its previous state
            if (checkbox) {
                checkbox.checked = false;
                checkbox.style.display = 'none'; // Also hide the checkbox
            }
            
            // Hide the test button
            const testButton = document.querySelector(`.options_nutify_test[data-event-type="${eventType}"]`);
            if (testButton) {
                testButton.style.display = 'none';
            }
            
            // Always update the setting in the database to disabled (false)
            try {
                // Prepare data for updating - explicitly set enabled to FALSE
                const setting = {
                    event_type: eventType,
                    enabled: false, // Always set to false when email is deleted
                    id_email: null // Reset the email ID
                };
                
                console.log(`Updating notification setting for ${eventType}:`, setting);
                
                // Update the setting in the database
                const response = await fetch('/api/settings/nutify/single', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(setting)
                });
                
                if (!response.ok) {
                    console.error(`Failed to update notification setting for ${eventType}`);
                } else {
                    console.log(`Successfully updated notification setting for ${eventType}`);
                }
            } catch (error) {
                console.error(`Error updating notification setting for ${eventType}:`, error);
            }
        }
    });
    
    // Third approach: Also check for any notification settings in the database that use this email ID
    fetch('/api/settings/nutify/by-email/' + configId)
        .then(response => response.json())
        .then(async data => {
            if (data.success && data.settings && data.settings.length > 0) {
                console.log(`Found ${data.settings.length} notification settings using email ID ${configId}:`, data.settings);
                
                // Process each setting to disable it
                for (const setting of data.settings) {
                    console.log(`Disabling notification setting for ${setting.event_type}`);
                    
                    try {
                        // Disable this notification setting
                        const response = await fetch('/api/settings/nutify/single', {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json'
                            },
                            body: JSON.stringify({
                                event_type: setting.event_type,
                                enabled: false,
                                id_email: null
                            })
                        });
                        
                        if (!response.ok) {
                            console.error(`Failed to disable notification setting for ${setting.event_type}`);
                        } else {
                            console.log(`Successfully disabled notification setting for ${setting.event_type}`);
                        }
                    } catch (error) {
                        console.error(`Error disabling notification setting for ${setting.event_type}:`, error);
                    }
                }
                
                // Refresh the notification settings UI
                if (typeof loadNotifySettings === 'function') {
                    loadNotifySettings();
                }
            }
        })
        .catch(error => {
            console.error('Error fetching notification settings by email ID:', error);
        });
}

// Function to edit email configuration
function editEmailConfig(configId) {
    console.log(`Editing email configuration with ID: ${configId}`);
    
    // If configId is undefined or null, we're creating a new configuration
    if (!configId) {
        // Clear the form and show it for a new configuration
        clearFormFields();
        
        // Show the form and hide other containers
        const emailConfigFormCard = document.getElementById('emailConfigFormCard');
        const emailConfigSummary = document.getElementById('emailConfigSummary');
        
        if (emailConfigFormCard) emailConfigFormCard.style.display = 'block';
        if (emailConfigSummary) emailConfigSummary.style.display = 'none';
        
        // Hide the Save Configuration button until a successful test
        const saveEmailConfigBtn = document.getElementById('saveEmailConfigBtn');
        if (saveEmailConfigBtn) saveEmailConfigBtn.style.display = 'none';
        
        return;
    }
    
    // Convert configId to number for comparison if it's a string
    const configIdNum = parseInt(configId, 10);
    console.log(`Looking for config ID: ${configIdNum} (numeric)`);
    
    // Fetch all configurations
    fetch('/api/settings/mail/all')
    .then(response => {
        if (!response.ok) {
            throw new Error('Failed to load email configurations');
        }
        return response.json();
    })
    .then(data => {
        if (!data.success || !data.data) {
            throw new Error('No email configurations found');
        }
        
        console.log(`Found ${data.data.length} email configurations`);
        
        // Find the configuration with the matching ID (convert both to numbers)
        const config = data.data.find(c => parseInt(c.id, 10) === configIdNum);
        if (!config) {
            console.error(`Configuration with ID ${configId} not found among options:`, data.data.map(c => c.id));
            throw new Error(`Configuration with ID ${configId} not found`);
        }
        
        console.log(`Found configuration:`, config);
        
        // Clear the form first
        clearFormFields();
        
        // Set the configuration ID
        const emailConfigIdEl = document.getElementById('email_config_id');
        if (emailConfigIdEl) emailConfigIdEl.value = configId;
        
        // Set the provider
        const providerSelect = document.getElementById('email_provider');
        if (providerSelect) {
            providerSelect.value = config.provider || '';
            // Trigger the change event to update provider-specific fields
            const event = new Event('change');
            providerSelect.dispatchEvent(event);
        }
        
        // Set form fields
        const smtpServerEl = document.getElementById('smtp_server');
        const smtpPortEl = document.getElementById('smtp_port');
        const smtpUsernameEl = document.getElementById('smtp_username');
        const fromNameEl = document.getElementById('from_name');
        const fromEmailEl = document.getElementById('from_email');
        const toEmailEl = document.getElementById('to_email');
        const useTlsEl = document.getElementById('use_tls');
        const useStartTlsEl = document.getElementById('use_starttls');
        
        if (smtpServerEl) smtpServerEl.value = config.smtp_server || '';
        if (smtpPortEl) smtpPortEl.value = config.smtp_port || '';
        
        // Handle username field - API returns 'username' but form uses 'smtp_username'
        if (smtpUsernameEl) {
            // Try both config.smtp_username and config.username
            smtpUsernameEl.value = config.smtp_username || config.username || '';
            console.log(`Set username field to: ${smtpUsernameEl.value}`);
        }
        
        if (fromNameEl) fromNameEl.value = config.from_name || '';
        if (fromEmailEl) fromEmailEl.value = config.from_email || '';
        if (toEmailEl) toEmailEl.value = config.to_email || '';
        
        // Set checkboxes
        if (useTlsEl) useTlsEl.checked = config.tls === true;
        if (useStartTlsEl) useStartTlsEl.checked = config.tls_starttls === true;
        
        // Show the form and hide other containers
        const emailConfigFormCard = document.getElementById('emailConfigFormCard');
        const emailConfigSummary = document.getElementById('emailConfigSummary');
        const addEmailConfigContainer = document.getElementById('addEmailConfigContainer');
        
        if (emailConfigFormCard) emailConfigFormCard.style.display = 'block';
        if (emailConfigSummary) emailConfigSummary.style.display = 'none';
        if (addEmailConfigContainer) addEmailConfigContainer.style.display = 'none';
        
        // Hide the Save Configuration button until a successful test
        const saveEmailConfigBtn = document.getElementById('saveEmailConfigBtn');
        if (saveEmailConfigBtn) saveEmailConfigBtn.style.display = 'none';
        
        console.log("Email configuration loaded for editing");
    })
    .catch(error => {
        console.error('Error loading email configuration:', error);
        showAlert('emailStatus', 'Error loading email configuration', 'danger', true);
    });
}

// Export functions for use in the main options page
window.saveEmailConfig = saveEmailConfig;
window.handleSaveEmailConfig = handleSaveEmailConfig;
window.deleteEmailConfig = deleteEmailConfig;
window.resetNotificationSettingsForEmail = resetNotificationSettingsForEmail;
window.editEmailConfig = editEmailConfig; 