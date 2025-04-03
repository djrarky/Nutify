/**
 * Webhook Configuration Module
 * Handles webhook notification configuration and settings
 */

class WebhookManager {
    constructor() {
        try {
            this.initializeEventListeners();
            this.loadWebhookConfig().then(() => {
                try {
                    this.loadWebhookSettings();
                } catch (settingsError) {
                    if (window.webLogger) {
                        window.webLogger.error('Failed to load webhook settings', settingsError);
                    }
                    window.notify('Failed to load webhook settings', 'error', true);
                }
            }).catch(configError => {
                if (window.webLogger) {
                    window.webLogger.error('Failed to load webhook configuration', configError);
                }
                window.notify('Failed to load webhook configuration', 'error', true);
            });
        } catch (error) {
            if (window.webLogger) {
                window.webLogger.error('Failed to initialize webhook functionality', error);
            }
            
            // Use the global notify function instead of directly showing an error
            window.notify('Failed to initialize webhook functionality', 'error', true);
        }
    }

    /**
     * Initialize all event listeners for webhook configuration
     */
    initializeEventListeners() {
        // Add Webhook Configuration button
        const addWebhookConfigBtn = document.getElementById('addWebhookConfigBtn');
        if (addWebhookConfigBtn) {
            addWebhookConfigBtn.addEventListener('click', () => {
                this.clearWebhookFormFields();
                this.setWebhookConfiguredState(false);
            });
        }
        
        // Test Webhook button
        const testWebhookBtn = document.getElementById('testWebhookBtn');
        if (testWebhookBtn) {
            testWebhookBtn.addEventListener('click', () => this.testWebhookFromForm());
        }
        
        // Save Webhook Config button
        const saveWebhookConfigBtn = document.getElementById('saveWebhookConfigBtn');
        if (saveWebhookConfigBtn) {
            saveWebhookConfigBtn.addEventListener('click', () => this.saveWebhookConfig());
        }
        
        // Cancel Webhook Config button
        const cancelWebhookConfigBtn = document.getElementById('cancelWebhookConfigBtn');
        if (cancelWebhookConfigBtn) {
            cancelWebhookConfigBtn.addEventListener('click', () => {
                // Show header card and hide form card
                document.getElementById('addWebhookConfigContainer').style.display = 'block';
                document.getElementById('webhookConfigFormCard').style.display = 'none';
            });
        }
        
        // Reconfigure Webhook button
        const reconfigureWebhookBtn = document.getElementById('reconfigureWebhookBtn');
        if (reconfigureWebhookBtn) {
            reconfigureWebhookBtn.addEventListener('click', () => {
                this.setWebhookConfiguredState(false);
            });
        }
        
        // Auth type change
        const webhookAuthType = document.getElementById('webhook_auth_type');
        if (webhookAuthType) {
            webhookAuthType.addEventListener('change', () => {
                const basicAuthFields = document.getElementById('webhook_basic_auth_fields');
                const bearerAuthFields = document.getElementById('webhook_bearer_auth_fields');
                
                if (webhookAuthType.value === 'basic') {
                    basicAuthFields.style.display = 'block';
                    bearerAuthFields.style.display = 'none';
                } else if (webhookAuthType.value === 'bearer') {
                    basicAuthFields.style.display = 'none';
                    bearerAuthFields.style.display = 'block';
                } else {
                    // No auth
                    basicAuthFields.style.display = 'none';
                    bearerAuthFields.style.display = 'none';
                }
            });
        }
        
        // Webhook notification checkboxes
        const webhookCheckboxes = document.querySelectorAll('.options_webhook_checkbox');
        webhookCheckboxes.forEach(checkbox => {
            checkbox.addEventListener('change', () => {
                const eventType = checkbox.getAttribute('data-event-type');
                const enabled = checkbox.checked;
                const dropdown = document.querySelector(`.options_webhook_select[data-event-type="${eventType}"]`);
                const configId = dropdown ? dropdown.value : '';
                
                this.updateWebhookNotificationSetting(eventType, enabled, configId);
            });
        });
        
        // Webhook notification dropdowns
        const webhookDropdowns = document.querySelectorAll('.options_webhook_select');
        webhookDropdowns.forEach(dropdown => {
            dropdown.addEventListener('change', () => {
                const eventType = dropdown.getAttribute('data-event-type');
                const configId = dropdown.value;
                const checkbox = document.getElementById(`webhook_${eventType.toLowerCase()}`);
                const testButton = document.querySelector(`.options_webhook_test[data-event-type="${eventType}"]`);
                
                // Show/hide the checkbox and test button based on selection
                if (configId && configId !== '') {
                    // Find if the selected config has this notification enabled
                    const selectedConfig = this.webhookConfigs.find(config => config.id == configId);
                    const notificationKey = `notify_${eventType.toLowerCase()}`;
                    const isNotificationEnabled = selectedConfig && selectedConfig[notificationKey] === true;
                    
                    // Show checkbox and set its state based on the config
                    if (checkbox) {
                        checkbox.style.display = 'inline-block';
                        checkbox.checked = isNotificationEnabled;
                    }
                    
                    // Show test button
                    if (testButton) testButton.style.display = 'inline-block';
                } else {
                    // Hide the checkbox and test button if no config is selected
                    if (checkbox) {
                        checkbox.style.display = 'none';
                        checkbox.checked = false; // Uncheck if no config selected
                    }
                    if (testButton) testButton.style.display = 'none';
                }
            });
            
            // Initialize visibility on page load
            const eventType = dropdown.getAttribute('data-event-type');
            const configId = dropdown.value;
            const checkbox = document.getElementById(`webhook_${eventType.toLowerCase()}`);
            const testButton = document.querySelector(`.options_webhook_test[data-event-type="${eventType}"]`);
            
            if (!configId || configId === '') {
                if (checkbox) checkbox.style.display = 'none';
                if (testButton) testButton.style.display = 'none';
            } else {
                // Check if this config has the notification enabled
                const selectedConfig = this.webhookConfigs ? this.webhookConfigs.find(config => config.id == configId) : null;
                const notificationKey = `notify_${eventType.toLowerCase()}`;
                const isNotificationEnabled = selectedConfig && selectedConfig[notificationKey] === true;
                
                if (checkbox) {
                    checkbox.style.display = 'inline-block';
                    checkbox.checked = isNotificationEnabled;
                }
                
                if (testButton) testButton.style.display = 'inline-block';
            }
        });
        
        // Webhook test buttons
        const webhookTestButtons = document.querySelectorAll('.options_webhook_test');
        webhookTestButtons.forEach(button => {
            button.addEventListener('click', () => {
                const eventType = button.getAttribute('data-event-type');
                const dropdown = document.querySelector(`.options_webhook_select[data-event-type="${eventType}"]`);
                const configId = dropdown ? dropdown.value : '';
                
                if (!configId) {
                    this.showWebhookAlert('Please select a webhook configuration first', 'error');
                    return;
                }
                
                // Show loader
                button.querySelector('.btn-text').style.display = 'none';
                button.querySelector('.btn-loader').classList.remove('hidden');
                
                // Send test notification
                fetch(`/api/webhook/test/${configId}?event_type=${eventType}`, {
                    method: 'POST'
                })
                .then(response => response.json())
                .then(data => {
                    if (data.success) {
                        this.showWebhookAlert('Test webhook sent successfully!', 'success');
                    } else {
                        this.showWebhookAlert(`Error: ${data.message}`, 'error');
                    }
                })
                .catch(error => {
                    this.showWebhookAlert(`Error: ${error.message}`, 'error');
                })
                .finally(() => {
                    // Hide loader
                    button.querySelector('.btn-text').style.display = 'inline';
                    button.querySelector('.btn-loader').classList.add('hidden');
                });
            });
        });
    }

    /**
     * Set the configured state of the webhook form
     * @param {boolean} isConfigured - Whether the form is in a configured state
     */
    setWebhookConfiguredState(isConfigured) {
        const addContainer = document.getElementById('addWebhookConfigContainer');
        const formCard = document.getElementById('webhookConfigFormCard');
        
        if (isConfigured) {
            // We're configured, so show the add container
            addContainer.style.display = 'block';
            formCard.style.display = 'none';
        } else {
            // We're configuring, so show the form
            addContainer.style.display = 'none';
            formCard.style.display = 'block';
        }
    }

    /**
     * Clear all form fields in the webhook configuration form
     */
    clearWebhookFormFields() {
        const webhookForm = document.getElementById('webhookConfigForm');
        if (!webhookForm) return;

        // Clear all inputs
        const inputs = webhookForm.querySelectorAll('input:not([type="submit"])');
        inputs.forEach(input => {
            if (input.type === 'checkbox') {
                // Default on for include UPS data and SSL verification
                input.checked = input.id === 'webhook_include_ups_data' || input.id === 'webhook_verify_ssl';
            } else {
                input.value = '';
            }
        });
        
        // Clear textarea
        const textarea = webhookForm.querySelector('textarea');
        if (textarea) textarea.value = '';
        
        // Reset selects
        const selects = webhookForm.querySelectorAll('select');
        selects.forEach(select => {
            if (select.id === 'webhook_auth_type') {
                select.value = 'none';
            } else if (select.id === 'webhook_content_type') {
                select.value = 'application/json';
            }
        });
        
        // Clear config ID
        const configIdField = document.getElementById('webhook_config_id');
        if (configIdField) {
            configIdField.value = '';
            configIdField.removeAttribute('value');
        }
        
        // Hide authentication fields
        const basicAuthFields = document.getElementById('webhook_basic_auth_fields');
        const bearerAuthFields = document.getElementById('webhook_bearer_auth_fields');
        if (basicAuthFields) basicAuthFields.style.display = 'none';
        if (bearerAuthFields) bearerAuthFields.style.display = 'none';
        
        // Hide save button until successful test
        const saveButton = document.getElementById('saveWebhookConfigBtn');
        if (saveButton) saveButton.style.display = 'none';
    }

    /**
     * Test the webhook using the values from the form
     */
    testWebhookFromForm() {
        const form = document.getElementById('webhookConfigForm');
        if (!form) return;

        const formData = new FormData(form);
        const config = {};
        
        // Process form fields
        formData.forEach((value, key) => {
            // Convert checkboxes to boolean
            if (key === 'webhook_include_ups_data' || key === 'webhook_verify_ssl') {
                config[key.replace('webhook_', '')] = value === 'on';
            } else {
                config[key.replace('webhook_', '')] = value;
            }
        });
        
        // Validate required fields
        if (!config.url) {
            this.showWebhookAlert('Please enter a webhook URL', 'error');
            return;
        }
        
        // Update button state
        const button = document.getElementById('testWebhookBtn');
        button.disabled = true;
        button.querySelector('.btn-text').style.display = 'none';
        button.querySelector('.btn-loader').classList.remove('hidden');
        
        // Create a sanitized copy for logging
        const logConfig = {...config};
        if (logConfig.auth_password) {
            logConfig.auth_password = '********';
        }
        if (logConfig.auth_token) {
            logConfig.auth_token = '********';
        }
        
        // Send the test request
        fetch('/api/webhook/test', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(config)
        })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                this.showWebhookAlert('Test webhook sent successfully', 'success');
                
                // Show the Save Configuration button after successful test
                const saveWebhookConfigBtn = document.getElementById('saveWebhookConfigBtn');
                if (saveWebhookConfigBtn) saveWebhookConfigBtn.style.display = 'inline-block';
            } else {
                this.showWebhookAlert(`Failed to send test webhook: ${data.message || 'Unknown error'}`, 'error');
            }
        })
        .catch(error => {
            this.showWebhookAlert('Failed to send test webhook', 'error');
        })
        .finally(() => {
            // Restore button state
            button.disabled = false;
            button.querySelector('.btn-text').style.display = 'inline';
            button.querySelector('.btn-loader').classList.add('hidden');
        });
    }

    /**
     * Save the webhook configuration to the database
     */
    saveWebhookConfig() {
        // Get form data
        const form = document.getElementById('webhookConfigForm');
        if (!form) return;
        
        const formData = new FormData(form);
        const config = {};
        
        // Process form fields
        formData.forEach((value, key) => {
            // Special handling for config_id - map to 'id' for server compatibility
            if (key === 'webhook_config_id') {
                if (value) {
                    config['id'] = value;
                }
            } 
            // Convert checkboxes to boolean
            else if (key === 'webhook_include_ups_data' || key === 'webhook_verify_ssl') {
                config[key.replace('webhook_', '')] = value === 'on';
            } else {
                config[key.replace('webhook_', '')] = value;
            }
        });
        
        // Validate required fields
        if (!config.name || !config.url) {
            this.showWebhookAlert('Please fill in all required fields', 'error');
            return;
        }
        
        // Update button state
        const button = document.getElementById('saveWebhookConfigBtn');
        const originalContent = button.innerHTML;
        button.disabled = true;
        button.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';
        
        // Send the save request
        fetch('/api/webhook/config', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(config)
        })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                this.showWebhookAlert('Webhook configuration saved successfully', 'success');
                
                // Update the UI to show the configured state
                this.setWebhookConfiguredState(true);
                
                // Reload webhook configurations
                this.loadWebhookConfig();
            } else {
                this.showWebhookAlert(`Failed to save webhook configuration: ${data.message || 'Unknown error'}`, 'error');
            }
        })
        .catch(error => {
            this.showWebhookAlert('Failed to save webhook configuration', 'error');
        })
        .finally(() => {
            // Restore button state
            button.disabled = false;
            button.innerHTML = originalContent;
        });
    }

    /**
     * Load webhook configurations and populate dropdowns
     */
    async loadWebhookConfig() {
        try {
            const response = await fetch('/api/webhook/configs');
            const data = await response.json();
            
            if (data.success && data.configs) {
                // Store configs for reference
                this.webhookConfigs = data.configs;
                
                // Show/hide sections based on whether we have configs
                const webhookConfigSummary = document.getElementById('webhookConfigSummary');
                
                if (data.configs.length === 0) {
                    // Hide the configuration summary section if no configs
                    if (webhookConfigSummary) webhookConfigSummary.style.display = 'none';
                    
                    // Hide the webhook notification section
                    const notificationSections = Array.from(document.querySelectorAll('.options_card.mt-4 h2'))
                        .filter(h2 => h2.textContent.trim() === 'Webhook Notifications')
                        .map(h2 => h2.closest('.options_card.mt-4'));
                    
                    notificationSections.forEach(section => {
                        if (section) section.style.display = 'none';
                    });
                } else {
                    // Show the configuration summary section if we have configs
                    if (webhookConfigSummary) webhookConfigSummary.style.display = 'block';
                    
                    // Show the webhook notification section
                    const notificationSections = Array.from(document.querySelectorAll('.options_card.mt-4 h2'))
                        .filter(h2 => h2.textContent.trim() === 'Webhook Notifications')
                        .map(h2 => h2.closest('.options_card.mt-4'));
                    
                    notificationSections.forEach(section => {
                        if (section) section.style.display = 'block';
                    });
                }
                
                // Update the webhook config summary
                this.updateWebhookConfigSummary(data.configs);
                
                // Update webhook notification dropdowns
                const selectElements = document.querySelectorAll('.options_webhook_select');
                selectElements.forEach(select => {
                    // Clear existing options except the placeholder
                    while (select.options.length > 1) {
                        select.remove(1);
                    }
                    
                    // Add options for each config
                    data.configs.forEach(config => {
                        const option = document.createElement('option');
                        option.value = config.id;
                        option.textContent = config.name;
                        select.appendChild(option);
                    });
                    
                    // Check if the event has notifications enabled in any config
                    const eventType = select.getAttribute('data-event-type');
                    if (eventType) {
                        const eventTypeKey = `notify_${eventType.toLowerCase()}`;
                        
                        // Find a config where this event is enabled
                        const enabledConfig = data.configs.find(config => config[eventTypeKey] === true);
                        
                        if (enabledConfig) {
                            // Set the dropdown to the enabled config
                            select.value = enabledConfig.id;
                            
                            // Show and check the checkbox
                            const checkbox = document.getElementById(`webhook_${eventType.toLowerCase()}`);
                            if (checkbox) {
                                checkbox.checked = true;
                                checkbox.style.display = 'inline-block';
                            }
                            
                            // Show the test button
                            const testButton = document.querySelector(`.options_webhook_test[data-event-type="${eventType}"]`);
                            if (testButton) {
                                testButton.style.display = 'inline-block';
                            }
                        } else {
                            // Reset the dropdown to the placeholder if no config has this event enabled
                            select.value = '';
                            
                            // Hide the checkbox and test button
                            const checkbox = document.getElementById(`webhook_${eventType.toLowerCase()}`);
                            if (checkbox) {
                                checkbox.checked = false;
                                checkbox.style.display = 'none';
                            }
                            
                            const testButton = document.querySelector(`.options_webhook_test[data-event-type="${eventType}"]`);
                            if (testButton) {
                                testButton.style.display = 'none';
                            }
                        }
                    }
                });
                
                return this.webhookConfigs;
            } else {
                this.showWebhookAlert('Failed to load webhook configurations', 'error');
                return [];
            }
        } catch (error) {
            this.showWebhookAlert('Failed to load webhook configurations', 'error');
            return [];
        }
    }

    /**
     * Load webhook notification settings from the server
     */
    async loadWebhookSettings() {
        try {
            await this.loadWebhookConfig();
            if (!this.webhookConfigs || !this.webhookConfigs.length) return;
            
            // Set the default configuration for each event type based on the notify_* settings
            this.webhookConfigs.forEach(config => {
                Object.keys(config).forEach(key => {
                    if (key.startsWith('notify_') && config[key]) {
                        const eventType = key.replace('notify_', '').toUpperCase();
                        const checkbox = document.getElementById(`webhook_${eventType.toLowerCase()}`);
                        const dropdown = document.querySelector(`.options_webhook_select[data-event-type="${eventType}"]`);
                        
                        if (checkbox && dropdown) {
                            checkbox.checked = true;
                            dropdown.value = config.id;
                            
                            // Show the checkbox and test button
                            checkbox.style.display = 'inline-block';
                            const testButton = document.querySelector(`.options_webhook_test[data-event-type="${eventType}"]`);
                            if (testButton) testButton.style.display = 'inline-block';
                        }
                    }
                });
            });
        } catch (error) {
            if (window.webLogger) {
                window.webLogger.error('Error loading webhook settings', error);
            }
        }
    }

    /**
     * Update the webhook configuration summary with the provided configs
     * @param {Array} configs - Array of webhook configurations
     */
    updateWebhookConfigSummary(configs) {
        this.populateWebhookConfigList(configs);
        this.populateWebhookSelects(configs);
    }

    /**
     * Populate the webhook configuration list
     * @param {Array} configs - Array of webhook configurations
     */
    populateWebhookConfigList(configs) {
        const configList = document.getElementById('webhookConfigList');
        if (!configList) return;
        
        // Clear the current list
        configList.innerHTML = '';
        
        if (!configs || !configs.length) {
            configList.innerHTML = '<div class="empty-state">No webhook configurations found. Click "Add Webhook Configuration" to create one.</div>';
            return;
        }
        
        // Create a row for each configuration (similar to Ntfy style)
        configs.forEach(config => {
            // Create the configuration row using the email_config_row class
            const configRow = document.createElement('div');
            configRow.className = 'email_config_row';
            configRow.dataset.id = config.id;
            configRow.id = `webhook-config-${config.id}`;
            
            // Add default badge if this is the default configuration
            const defaultBadge = config.is_default ? 
                '<span class="default-badge"><i class="fas fa-check-circle"></i> Default</span>' : '';
            
            // Display different icon based on authentication type
            let authDisplay = '';
            if (config.auth_type === 'basic') {
                authDisplay = '<span class="ms-3"><i class="fas fa-user-lock"></i> Basic Auth</span>';
            } else if (config.auth_type === 'bearer') {
                authDisplay = '<span class="ms-3"><i class="fas fa-lock"></i> Bearer Token</span>';
            }
            
            // Display SSL verification status
            const sslVerifyDisplay = config.verify_ssl !== false ? 
                '<span class="ms-3"><i class="fas fa-shield-alt"></i> SSL Verified</span>' : 
                '<span class="ms-3"><i class="fas fa-shield-alt" style="color:#999;"></i> SSL Bypass</span>';
            
            configRow.innerHTML = `
                <div class="email_config_info">
                    <div class="email_provider_info">
                        <i class="fas fa-globe"></i> <span>${config.name}</span>
                        ${defaultBadge}
                    </div>
                    <div class="email_address_info">
                        <i class="fas fa-link"></i> <span>${config.url}</span>
                        ${authDisplay}
                        ${sslVerifyDisplay}
                    </div>
                </div>
                <div class="email_config_actions">
                    <button type="button" class="options_btn options_btn_secondary test-btn" data-id="${config.id}">
                        <i class="fas fa-paper-plane"></i> Test
                    </button>
                    <button type="button" class="options_btn options_btn_secondary edit-btn" data-id="${config.id}">
                        <i class="fas fa-cog"></i> Edit
                    </button>
                    <button type="button" class="options_btn options_btn_secondary delete-btn" data-id="${config.id}">
                        <i class="fas fa-trash"></i> Delete
                    </button>
                    ${!config.is_default ? `
                        <button type="button" class="options_btn options_btn_secondary default-btn" data-id="${config.id}">
                            <i class="fas fa-star"></i> Set Default
                        </button>
                    ` : `
                        <button type="button" class="options_btn options_btn_secondary default-config" disabled>
                            <i class="fas fa-star"></i> Default
                        </button>
                    `}
                </div>
            `;
            
            configList.appendChild(configRow);
            
            // Add event listeners to the buttons
            configRow.querySelector('.test-btn').addEventListener('click', () => {
                const configId = configRow.querySelector('.test-btn').getAttribute('data-id');
                this.testWebhookConfig(configId);
            });
            
            configRow.querySelector('.edit-btn').addEventListener('click', () => {
                const configId = configRow.querySelector('.edit-btn').getAttribute('data-id');
                this.editWebhookConfig(configId);
            });
            
            configRow.querySelector('.delete-btn').addEventListener('click', () => {
                const configId = configRow.querySelector('.delete-btn').getAttribute('data-id');
                this.deleteWebhookConfig(configId);
            });
            
            const defaultBtn = configRow.querySelector('.default-btn');
            if (defaultBtn) {
                defaultBtn.addEventListener('click', () => {
                    const configId = defaultBtn.getAttribute('data-id');
                    this.setDefaultWebhookConfig(configId);
                });
            }
        });
    }
    
    /**
     * Populate webhook select dropdowns
     * @param {Array} configs - Array of webhook configurations
     */
    populateWebhookSelects(configs) {
        const selects = document.querySelectorAll('.options_webhook_select');
        if (!selects.length) return;
        
        selects.forEach(select => {
            // Save the current selected value
            const currentValue = select.value;
            
            // Clear all options except the default empty option
            while (select.options.length > 1) {
                select.options.remove(1);
            }
            
            // Add option for each configuration
            configs.forEach(config => {
                const option = document.createElement('option');
                option.value = config.id;
                option.textContent = config.name;
                select.appendChild(option);
            });
            
            // Restore the previously selected value if it still exists
            if (currentValue) {
                select.value = currentValue;
                
                // If the value no longer exists, reset to empty
                if (select.value !== currentValue) {
                    select.value = '';
                    
                    // Hide the checkbox and test button
                    const eventType = select.getAttribute('data-event-type');
                    const checkbox = document.getElementById(`webhook_${eventType.toLowerCase()}`);
                    const testButton = document.querySelector(`.options_webhook_test[data-event-type="${eventType}"]`);
                    
                    if (checkbox) {
                        checkbox.style.display = 'none';
                        checkbox.checked = false;
                    }
                    
                    if (testButton) {
                        testButton.style.display = 'none';
                    }
                }
            }
        });
    }

    /**
     * Edit an existing webhook configuration
     * @param {number} configId - The ID of the configuration to edit
     */
    async editWebhookConfig(configId) {
        try {
            const response = await fetch(`/api/webhook/config/${configId}`);
            const data = await response.json();
            
            if (data.success) {
                const config = data.config;
                
                // Populate form fields
                document.getElementById('webhook_config_id').value = config.id;
                document.getElementById('webhook_name').value = config.name;
                document.getElementById('webhook_url').value = config.url;
                document.getElementById('webhook_content_type').value = config.content_type;
                document.getElementById('webhook_include_ups_data').checked = config.include_ups_data;
                document.getElementById('webhook_verify_ssl').checked = config.verify_ssl !== undefined ? config.verify_ssl : true;
                document.getElementById('webhook_auth_type').value = config.auth_type;
                
                // Update the display of auth fields based on auth type
                const basicAuthFields = document.getElementById('webhook_basic_auth_fields');
                const bearerAuthFields = document.getElementById('webhook_bearer_auth_fields');
                
                if (config.auth_type === 'basic') {
                    basicAuthFields.style.display = 'block';
                    bearerAuthFields.style.display = 'none';
                    document.getElementById('webhook_auth_username').value = config.auth_username || '';
                    // Don't set password as it comes masked
                } else if (config.auth_type === 'bearer') {
                    basicAuthFields.style.display = 'none';
                    bearerAuthFields.style.display = 'block';
                    // Don't set token as it comes masked
                } else {
                    basicAuthFields.style.display = 'none';
                    bearerAuthFields.style.display = 'none';
                }
                
                // Set custom headers
                if (config.custom_headers) {
                    document.getElementById('webhook_custom_headers').value = config.custom_headers;
                }
                
                // Show the form
                this.setWebhookConfiguredState(false);
                
                // Show save button immediately for edit
                const saveButton = document.getElementById('saveWebhookConfigBtn');
                if (saveButton) saveButton.style.display = 'inline-block';
            } else {
                this.showWebhookAlert('Failed to load webhook configuration', 'error');
            }
        } catch (error) {
            this.showWebhookAlert('Failed to load webhook configuration', 'error');
        }
    }

    /**
     * Delete a webhook configuration
     * @param {number} configId - The ID of the configuration to delete
     */
    async deleteWebhookConfig(configId) {
        if (!confirm('Are you sure you want to delete this webhook configuration?')) {
            return;
        }
        
        try {
            const response = await fetch(`/api/webhook/config/${configId}`, {
                method: 'DELETE'
            });
            const data = await response.json();
            
            if (data.success) {
                this.showWebhookAlert('Webhook configuration deleted successfully', 'success');
                this.loadWebhookConfig();
            } else {
                this.showWebhookAlert(`Failed to delete webhook configuration: ${data.message || 'Unknown error'}`, 'error');
            }
        } catch (error) {
            this.showWebhookAlert('Failed to delete webhook configuration', 'error');
        }
    }

    /**
     * Set a webhook configuration as the default
     * @param {number} configId - The ID of the configuration to set as default
     */
    async setDefaultWebhookConfig(configId) {
        try {
            const response = await fetch(`/api/webhook/config/${configId}/default`, {
                method: 'POST'
            });
            const data = await response.json();
            
            if (data.success) {
                this.showWebhookAlert('Default webhook configuration updated successfully', 'success');
                this.loadWebhookConfig();
            } else {
                this.showWebhookAlert(`Failed to update default webhook configuration: ${data.message || 'Unknown error'}`, 'error');
            }
        } catch (error) {
            this.showWebhookAlert('Failed to update default webhook configuration', 'error');
        }
    }

    /**
     * Test a webhook configuration
     * @param {number} configId - The ID of the configuration to test
     */
    async testWebhookConfig(configId) {
        try {
            const response = await fetch(`/api/webhook/test/${configId}`, {
                method: 'POST'
            });
            const data = await response.json();
            
            if (data.success) {
                this.showWebhookAlert('Test webhook sent successfully', 'success');
            } else {
                this.showWebhookAlert(`Failed to send test webhook: ${data.message || 'Unknown error'}`, 'error');
            }
        } catch (error) {
            this.showWebhookAlert('Failed to send test webhook', 'error');
        }
    }

    /**
     * Updates a webhook notification setting for a specific event type
     * @param {string} eventType - The type of event (e.g., "UPS", "Network")
     * @param {boolean} enabled - Whether to enable or disable notifications
     * @param {number} configId - The ID of the webhook configuration to use
     */
    async updateWebhookNotificationSetting(eventType, enabled, configId) {
        // Validate configId
        if (!configId) {
            this.showWebhookAlert('Please select a webhook configuration first', 'error');
            
            // Reset checkbox state since we can't update
            const checkbox = document.getElementById(`webhook_${eventType.toLowerCase()}`);
            if (checkbox) {
                checkbox.checked = false;
            }
            return;
        }

        const body = JSON.stringify({
            [`notify_${eventType.toLowerCase()}`]: enabled
        });

        try {
            const response = await fetch(`/api/webhook/config/${configId}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: body
            });

            const data = await response.json();

            if (!data.success) {
                this.showWebhookAlert(`Failed to update webhook notification setting: ${data.message}`, 'error');
                
                // Reset checkbox state on error
                const checkbox = document.getElementById(`webhook_${eventType.toLowerCase()}`);
                if (checkbox) {
                    checkbox.checked = !enabled; // Revert to previous state
                }
            } else if (enabled) {
                // Only show success message when enabling notifications
                this.showWebhookAlert(`Webhook notifications for ${eventType} events enabled`, 'success');
            }
        } catch (error) {
            this.showWebhookAlert('Failed to update webhook notification setting', 'error');
            
            // Reset checkbox state on error
            const checkbox = document.getElementById(`webhook_${eventType.toLowerCase()}`);
            if (checkbox) {
                checkbox.checked = !enabled; // Revert to previous state
            }
        }
    }

    /**
     * Show an alert message using the global notification system
     * @param {string} message - The message to display
     * @param {string} type - The type of alert (success, error)
     */
    showWebhookAlert(message, type) {
        // Use the global notify function only
        window.notify(message, type, true);
    }
}

// Initialize webhook functionality
function initializeWebhookModule() {
    window.webhookManager = new WebhookManager();
    if (window.webLogger) {
        window.webLogger.console('Webhook module initialized');
    }
}

// Export to window object so it can be called from options_page.js
window.initializeWebhookModule = initializeWebhookModule; 