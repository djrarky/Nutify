/**
 * Ntfy Configuration Module
 * Handles Ntfy push notification configuration and settings
 */

class NtfyManager {
    constructor() {
        try {
            this.initializeEventListeners();
            this.loadNtfyConfig().then(() => {
                try {
                    this.loadNtfySettings();
                } catch (settingsError) {
                    if (window.webLogger) {
                        window.webLogger.error('Failed to load Ntfy settings', settingsError);
                    }
                }
            }).catch(configError => {
                if (window.webLogger) {
                    window.webLogger.error('Failed to load Ntfy configuration', configError);
                }
            });
        } catch (error) {
            if (window.webLogger) {
                window.webLogger.error('Failed to initialize Ntfy functionality', error);
            }
            
            // Show error message
            const errorContainer = document.getElementById('options_ntfy_status');
            if (errorContainer) {
                errorContainer.textContent = "Failed to initialize Ntfy functionality";
                errorContainer.className = "options_alert error";
                errorContainer.classList.remove('hidden');
            }
        }
    }

    /**
     * Initialize all event listeners for Ntfy configuration
     */
    initializeEventListeners() {
        // Add Ntfy Configuration button
        const addNtfyConfigBtn = document.getElementById('addNtfyConfigBtn');
        if (addNtfyConfigBtn) {
            addNtfyConfigBtn.addEventListener('click', () => {
                this.clearNtfyFormFields();
                this.setNtfyConfiguredState(false);
            });
        }
        
        // Test Ntfy button
        const testNtfyBtn = document.getElementById('testNtfyBtn');
        if (testNtfyBtn) {
            testNtfyBtn.addEventListener('click', () => this.testNtfyFromForm());
        }
        
        // Save Ntfy Config button
        const saveNtfyConfigBtn = document.getElementById('saveNtfyConfigBtn');
        if (saveNtfyConfigBtn) {
            saveNtfyConfigBtn.addEventListener('click', () => this.saveNtfyConfig());
        }
        
        // Cancel Ntfy Config button
        const cancelNtfyConfigBtn = document.getElementById('cancelNtfyConfigBtn');
        if (cancelNtfyConfigBtn) {
            cancelNtfyConfigBtn.addEventListener('click', () => {
                // Show header card and hide form card
                document.getElementById('addNtfyConfigContainer').style.display = 'block';
                document.getElementById('ntfyConfigFormCard').style.display = 'none';
            });
        }
        
        // Reconfigure Ntfy button
        const reconfigureNtfyBtn = document.getElementById('reconfigureNtfyBtn');
        if (reconfigureNtfyBtn) {
            reconfigureNtfyBtn.addEventListener('click', () => {
                this.setNtfyConfiguredState(false);
            });
        }
        
        // Server type change
        const ntfyServerType = document.getElementById('ntfy_server_type');
        if (ntfyServerType) {
            ntfyServerType.addEventListener('change', () => {
                const customServerContainer = document.getElementById('custom_server_container');
                if (ntfyServerType.value === 'custom') {
                    customServerContainer.style.display = 'block';
                } else {
                    customServerContainer.style.display = 'none';
                    document.getElementById('ntfy_custom_server').value = '';
                }
            });
        }
        
        // Auth checkbox
        const ntfyUseAuth = document.getElementById('ntfy_use_auth');
        if (ntfyUseAuth) {
            ntfyUseAuth.addEventListener('change', () => {
                const authFields = document.querySelectorAll('.auth-field');
                authFields.forEach(field => {
                    field.style.display = ntfyUseAuth.checked ? 'block' : 'none';
                });
            });
        }
        
        // Ntfy notification checkboxes
        const ntfyCheckboxes = document.querySelectorAll('.options_ntfy_checkbox');
        ntfyCheckboxes.forEach(checkbox => {
            checkbox.addEventListener('change', () => {
                const eventType = checkbox.getAttribute('data-event-type');
                const enabled = checkbox.checked;
                const dropdown = document.querySelector(`.options_ntfy_select[data-event-type="${eventType}"]`);
                const configId = dropdown ? dropdown.value : '';
                
                this.updateNtfyNotificationSetting(eventType, enabled, configId);
            });
        });
        
        // Ntfy notification dropdowns
        const ntfyDropdowns = document.querySelectorAll('.options_ntfy_select');
        ntfyDropdowns.forEach(dropdown => {
            dropdown.addEventListener('change', () => {
                const eventType = dropdown.getAttribute('data-event-type');
                const configId = dropdown.value;
                const checkbox = document.getElementById(`ntfy_${eventType.toLowerCase()}`);
                const testButton = document.querySelector(`.options_ntfy_test[data-event-type="${eventType}"]`);
                
                // Show/hide the checkbox and test button based on selection
                if (configId && configId !== '') {
                    if (checkbox) checkbox.style.display = 'inline-block';
                    if (testButton) testButton.style.display = 'inline-block';
                    
                    // Update the notification setting if the checkbox is checked
                    const enabled = checkbox ? checkbox.checked : false;
                    this.updateNtfyNotificationSetting(eventType, enabled, configId);
                } else {
                    // Hide the checkbox and test button if no config is selected
                    if (checkbox) {
                        checkbox.style.display = 'none';
                        checkbox.checked = false; // Uncheck if no config selected
                    }
                    if (testButton) testButton.style.display = 'none';
                    
                    // Update the notification setting to disabled
                    this.updateNtfyNotificationSetting(eventType, false, '');
                }
            });
            
            // Initialize visibility on page load
            const eventType = dropdown.getAttribute('data-event-type');
            const configId = dropdown.value;
            const checkbox = document.getElementById(`ntfy_${eventType.toLowerCase()}`);
            const testButton = document.querySelector(`.options_ntfy_test[data-event-type="${eventType}"]`);
            
            if (!configId || configId === '') {
                if (checkbox) checkbox.style.display = 'none';
                if (testButton) testButton.style.display = 'none';
            }
        });
        
        // Ntfy test buttons
        const ntfyTestButtons = document.querySelectorAll('.options_ntfy_test');
        ntfyTestButtons.forEach(button => {
            button.addEventListener('click', async () => {
                const eventType = button.getAttribute('data-event-type');
                const dropdown = document.querySelector(`.options_ntfy_select[data-event-type="${eventType}"]`);
                const configId = dropdown ? dropdown.value : '';
                
                console.log(`Testing Ntfy notification for event ${eventType} with config ID: ${configId}`);
                
                if (!configId) {
                    this.showNtfyAlert('Please select a Ntfy configuration first', 'error');
                    return;
                }
                
                // Show loader
                button.querySelector('.btn-text').style.display = 'none';
                button.querySelector('.btn-loader').classList.remove('hidden');
                
                try {
                    // Send test notification
                    const response = await fetch(`/api/ntfy/test/${configId}?event_type=${eventType}`, {
                        method: 'POST'
                    });
                    
                    if (!response.ok) {
                        throw new Error(`Server returned ${response.status}: ${response.statusText}`);
                    }
                    
                    const data = await response.json();
                    console.log('Ntfy test response:', data);
                    
                    if (data.success) {
                        this.showNtfyAlert(`Test notification for ${eventType} sent successfully!`, 'success');
                        
                        // Add a notification within the page for better visibility
                        if (window.notify) {
                            window.notify(`Test notification for ${eventType} sent to Ntfy. Please check your Ntfy app.`, 'info', 8000);
                        }
                    } else {
                        this.showNtfyAlert(`Error: ${data.message || 'Failed to send notification'}`, 'error');
                        console.error('Ntfy test failed:', data.message);
                    }
                } catch (error) {
                    this.showNtfyAlert(`Error: ${error.message}`, 'error');
                    console.error('Ntfy test error:', error);
                } finally {
                    // Hide loader
                    button.querySelector('.btn-text').style.display = 'inline';
                    button.querySelector('.btn-loader').classList.add('hidden');
                }
            });
        });
    }

    /**
     * Clear all form fields in the Ntfy configuration form
     */
    clearNtfyFormFields() {
        document.getElementById('ntfy_config_id').value = '';
        document.getElementById('ntfy_server_type').value = 'ntfy.sh';
        document.getElementById('ntfy_custom_server').value = '';
        document.getElementById('ntfy_topic').value = '';
        document.getElementById('ntfy_use_auth').checked = false;
        document.getElementById('ntfy_username').value = '';
        document.getElementById('ntfy_password').value = '';
        document.getElementById('ntfy_priority').value = '3';
        document.getElementById('ntfy_use_tags').checked = true;
        
        // Hide auth fields
        document.querySelectorAll('.auth-field').forEach(field => {
            field.style.display = 'none';
        });
        
        // Hide custom server field
        document.getElementById('custom_server_container').style.display = 'none';
        
        // Hide the Save Configuration button until a successful test
        const saveNtfyConfigBtn = document.getElementById('saveNtfyConfigBtn');
        if (saveNtfyConfigBtn) {
            saveNtfyConfigBtn.style.display = 'none';
        }
    }

    /**
     * Test Ntfy notification using form data
     */
    testNtfyFromForm() {
        const serverType = document.getElementById('ntfy_server_type').value;
        const customServer = document.getElementById('ntfy_custom_server').value;
        const topic = document.getElementById('ntfy_topic').value;
        const useAuth = document.getElementById('ntfy_use_auth').checked;
        const username = document.getElementById('ntfy_username').value;
        const password = document.getElementById('ntfy_password').value;
        const priority = document.getElementById('ntfy_priority').value;
        const useTags = document.getElementById('ntfy_use_tags').checked;
        
        const server = serverType === 'ntfy.sh' ? 'https://ntfy.sh' : customServer;
        
        if (!topic) {
            this.showAlert('ntfyStatus', 'Please enter a topic name', 'error');
            return;
        }
        
        if (serverType === 'custom' && !customServer) {
            this.showAlert('ntfyStatus', 'Please enter a server URL', 'error');
            return;
        }
        
        // Show loader
        const testBtn = document.getElementById('testNtfyBtn');
        testBtn.querySelector('.btn-text').style.display = 'none';
        testBtn.querySelector('.btn-loader').classList.remove('hidden');
        
        // Prepare test data
        const testData = {
            server: server,
            topic: topic,
            use_auth: useAuth,
            username: username,
            password: password,
            priority: priority,
            use_tags: useTags,
            test: true
        };
        
        // Send test notification
        fetch('/api/ntfy/test', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(testData)
        })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                this.showAlert('ntfyStatus', 'Test notification sent successfully!', 'success');
                
                // Show the Save Configuration button only after successful test
                const saveNtfyConfigBtn = document.getElementById('saveNtfyConfigBtn');
                if (saveNtfyConfigBtn) {
                    saveNtfyConfigBtn.style.display = 'flex';
                }
            } else {
                this.showAlert('ntfyStatus', `Error: ${data.message}`, 'error');
                
                // Hide the Save Configuration button if the test fails
                const saveNtfyConfigBtn = document.getElementById('saveNtfyConfigBtn');
                if (saveNtfyConfigBtn) {
                    saveNtfyConfigBtn.style.display = 'none';
                }
            }
        })
        .catch(error => {
            this.showAlert('ntfyStatus', `Error: ${error.message}`, 'error');
            
            // Hide the Save Configuration button if there's an error
            const saveNtfyConfigBtn = document.getElementById('saveNtfyConfigBtn');
            if (saveNtfyConfigBtn) {
                saveNtfyConfigBtn.style.display = 'none';
            }
        })
        .finally(() => {
            // Hide loader
            testBtn.querySelector('.btn-text').style.display = 'inline';
            testBtn.querySelector('.btn-loader').classList.add('hidden');
        });
    }

    /**
     * Save Ntfy configuration
     */
    saveNtfyConfig() {
        const configId = document.getElementById('ntfy_config_id').value;
        const serverType = document.getElementById('ntfy_server_type').value;
        const customServer = document.getElementById('ntfy_custom_server').value;
        const topic = document.getElementById('ntfy_topic').value;
        const useAuth = document.getElementById('ntfy_use_auth').checked;
        const username = document.getElementById('ntfy_username').value;
        const password = document.getElementById('ntfy_password').value;
        const priority = document.getElementById('ntfy_priority').value;
        const useTags = document.getElementById('ntfy_use_tags').checked;
        
        const server = serverType === 'ntfy.sh' ? 'https://ntfy.sh' : customServer;
        
        if (!topic) {
            this.showAlert('ntfyStatus', 'Please enter a topic name', 'error');
            return;
        }
        
        if (serverType === 'custom' && !customServer) {
            this.showAlert('ntfyStatus', 'Please enter a server URL', 'error');
            return;
        }
        
        if (useAuth && (!username || !password)) {
            this.showAlert('ntfyStatus', 'Please enter both username and password for authentication', 'error');
            return;
        }
        
        // Prepare config data
        const configData = {
            id: configId || null,
            server_type: serverType,
            server: server,
            topic: topic,
            use_auth: useAuth,
            username: username,
            password: password,
            priority: priority,
            use_tags: useTags
        };
        
        // Save configuration
        fetch('/api/ntfy/config', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(configData)
        })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                this.showAlert('ntfyStatus', 'Configuration saved successfully!', 'success');
                this.loadNtfyConfig();
                this.setNtfyConfiguredState(true, data.config);
                
                // Update dropdowns
                this.populateNtfyDropdowns();
            } else {
                this.showAlert('ntfyStatus', `Error: ${data.message}`, 'error');
            }
        })
        .catch(error => {
            this.showAlert('ntfyStatus', `Error: ${error.message}`, 'error');
        });
    }

    /**
     * Update Ntfy configuration summary
     * @param {Object} config - Ntfy configuration object
     */
    updateNtfySummary(config) {
        const configList = document.getElementById('ntfyConfigList');
        
        // Create or update the config summary
        let configElement = document.getElementById(`ntfy-config-${config.id}`);
        
        if (!configElement) {
            configElement = document.createElement('div');
            configElement.id = `ntfy-config-${config.id}`;
            configElement.className = 'email_config_item';
            configList.appendChild(configElement);
        }
        
        const serverDisplay = config.server_type === 'ntfy.sh' ? 'ntfy.sh (Official)' : config.server;
        
        configElement.innerHTML = `
            <div class="email_config_info">
                <div class="email_config_name">
                    <i class="fas fa-bell"></i>
                    <span>${serverDisplay}</span>
                </div>
                <div class="email_config_details">
                    <span>Topic: ${config.topic}</span>
                    ${config.use_auth ? '<span><i class="fas fa-lock"></i> Authentication enabled</span>' : ''}
                </div>
            </div>
            <div class="email_config_actions">
                <button type="button" class="email_config_action" onclick="ntfyManager.testNtfyConfig(${config.id})">
                    <i class="fas fa-paper-plane"></i>
                    Test
                </button>
                <button type="button" class="email_config_action" onclick="ntfyManager.editNtfyConfig(${config.id})">
                    <i class="fas fa-edit"></i>
                    Edit
                </button>
                <button type="button" class="email_config_action" onclick="ntfyManager.deleteNtfyConfig(${config.id})">
                    <i class="fas fa-trash"></i>
                    Delete
                </button>
                <button type="button" class="email_config_action ${config.is_default ? 'default-config' : ''}" 
                        onclick="ntfyManager.setDefaultNtfyConfig(${config.id})" id="ntfy-default-${config.id}">
                    <i class="fas fa-star"></i>
                    ${config.is_default ? 'Default' : 'Set Default'}
                </button>
            </div>
        `;
    }

    /**
     * Render all Ntfy configurations
     * @param {Array} configs - Array of Ntfy configurations
     */
    renderNtfyConfigs(configs) {
        const configList = document.getElementById('ntfyConfigList');
        configList.innerHTML = '';
        
        if (configs && configs.length > 0) {
            configs.forEach(config => {
                // Create the configuration row using the email_config_row class
                const configRow = document.createElement('div');
                configRow.className = 'email_config_row';
                configRow.dataset.id = config.id;
                configRow.id = `ntfy-config-${config.id}`;
                
                // Add default badge if this is the default configuration
                const defaultBadge = config.is_default ? 
                    '<span class="default-badge"><i class="fas fa-check-circle"></i> Default</span>' : '';
                
                const serverDisplay = config.server_type === 'custom' ? config.server : 'ntfy.sh';
                
                configRow.innerHTML = `
                    <div class="email_config_info">
                        <div class="email_provider_info">
                            <i class="fas fa-bell"></i> <span>${serverDisplay}</span>
                            ${defaultBadge}
                        </div>
                        <div class="email_address_info">
                            <i class="fas fa-tag"></i> <span>Topic: ${config.topic}</span>
                            ${config.use_auth ? '<span class="ms-3"><i class="fas fa-lock"></i> Authentication enabled</span>' : ''}
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
            });
            
            // Add event listeners to the buttons
            document.querySelectorAll('.test-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    const configId = btn.getAttribute('data-id');
                    this.testNtfyConfig(configId);
                });
            });
            
            document.querySelectorAll('.edit-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    const configId = btn.getAttribute('data-id');
                    this.editNtfyConfig(configId);
                });
            });
            
            document.querySelectorAll('.delete-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    const configId = btn.getAttribute('data-id');
                    this.deleteNtfyConfig(configId);
                });
            });
            
            document.querySelectorAll('.default-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    const configId = btn.getAttribute('data-id');
                    this.setDefaultNtfyConfig(configId);
                });
            });
        } else {
            configList.innerHTML = '<div class="no-config-message"><i class="fas fa-info-circle"></i> No Ntfy configurations found. Add one to get started.</div>';
        }
    }

    /**
     * Load all Ntfy configurations from the server
     */
    async loadNtfyConfig() {
        try {
            const response = await fetch('/api/ntfy/configs');
            const data = await response.json();
            
            if (data.success) {
                const configs = data.configs || [];
                
                
                // Show/hide sections based on whether we have configs
                const ntfyConfigSummary = document.getElementById('ntfyConfigSummary');
                // Target ONLY the Ntfy notification section by finding the h2 with text "Ntfy Notifications"
                const ntfyNotificationSections = Array.from(document.querySelectorAll('.options_card.mt-4 h2'))
                    .filter(h2 => h2.textContent.trim() === 'Ntfy Notifications')
                    .map(h2 => h2.closest('.options_card.mt-4'));
                
                
                
                if (configs.length === 0) {
                    // Hide the sections if no configs
                    if (ntfyConfigSummary) ntfyConfigSummary.style.display = 'none';
                    // Hide only the Ntfy notification section
                    ntfyNotificationSections.forEach(section => {
                        if (section) section.style.display = 'none';
                    });
                    
                    return;
                } else {
                    // Show the sections if we have configs
                    if (ntfyConfigSummary) ntfyConfigSummary.style.display = 'block';
                    // Show only the Ntfy notification section
                    ntfyNotificationSections.forEach(section => {
                        if (section) section.style.display = 'block';
                    });
                    
                }
                
                // Use the existing renderNtfyConfigs function to display the configs
                this.renderNtfyConfigs(configs);
                
                // First populate the dropdowns with available configurations
                await this.populateNtfyDropdowns();
                
                // Then load the settings to update the checkboxes and dropdown selections
                await this.loadNtfySettings();
                
                
            }
        } catch (error) {
            
        }
    }

    /**
     * Set the configured state of the Ntfy form
     * @param {boolean} isConfigured - Whether a configuration is active
     * @param {Object} config - The active configuration
     */
    setNtfyConfiguredState(isConfigured, config = {}) {
        const headerCard = document.getElementById('addNtfyConfigContainer');
        const formCard = document.getElementById('ntfyConfigFormCard');
        const configStatus = document.getElementById('ntfyConfigurationStatus');
        
        if (isConfigured) {
            headerCard.style.display = 'block';
            formCard.style.display = 'none';
            configStatus.classList.remove('hidden');
            
            // Update status text with config details
            const serverDisplay = config.server_type === 'ntfy.sh' ? 'ntfy.sh (Official)' : config.server;
            configStatus.querySelector('p').textContent = `Ntfy configured successfully: ${serverDisplay} - Topic: ${config.topic}`;
        } else {
            headerCard.style.display = 'none';
            formCard.style.display = 'block';
            configStatus.classList.add('hidden');
            
            // Hide the Save Configuration button until a successful test
            const saveNtfyConfigBtn = document.getElementById('saveNtfyConfigBtn');
            if (saveNtfyConfigBtn) {
                saveNtfyConfigBtn.style.display = 'none';
            }
        }
    }

    /**
     * Edit a Ntfy configuration
     * @param {number} configId - Configuration ID to edit
     */
    editNtfyConfig(configId) {
        fetch(`/api/ntfy/config/${configId}`)
            .then(response => response.json())
            .then(data => {
                if (data.success) {
                    const config = data.config;
                    
                    // Fill form with config data
                    document.getElementById('ntfy_config_id').value = config.id;
                    document.getElementById('ntfy_server_type').value = config.server_type;
                    document.getElementById('ntfy_topic').value = config.topic;
                    document.getElementById('ntfy_use_auth').checked = config.use_auth;
                    document.getElementById('ntfy_priority').value = config.priority;
                    document.getElementById('ntfy_use_tags').checked = config.use_tags;
                    
                    // Handle custom server
                    if (config.server_type === 'custom') {
                        document.getElementById('custom_server_container').style.display = 'block';
                        document.getElementById('ntfy_custom_server').value = config.server;
                    } else {
                        document.getElementById('custom_server_container').style.display = 'none';
                        document.getElementById('ntfy_custom_server').value = '';
                    }
                    
                    // Handle auth fields
                    if (config.use_auth) {
                        document.querySelectorAll('.auth-field').forEach(field => {
                            field.style.display = 'block';
                        });
                        document.getElementById('ntfy_username').value = config.username;
                        // Password is not returned for security reasons
                        document.getElementById('ntfy_password').value = '';
                        document.getElementById('ntfy_password').placeholder = '********';
                    } else {
                        document.querySelectorAll('.auth-field').forEach(field => {
                            field.style.display = 'none';
                        });
                        document.getElementById('ntfy_username').value = '';
                        document.getElementById('ntfy_password').value = '';
                    }
                    
                    // Hide the Save Configuration button until a successful test
                    const saveNtfyConfigBtn = document.getElementById('saveNtfyConfigBtn');
                    if (saveNtfyConfigBtn) {
                        saveNtfyConfigBtn.style.display = 'none';
                    }
                    
                    // Show form
                    this.setNtfyConfiguredState(false);
                }
            })
            .catch(error => {
                
                this.showAlert('ntfyStatus', `Error: ${error.message}`, 'error');
            });
    }

    /**
     * Delete a Ntfy configuration
     * @param {number} configId - Configuration ID to delete
     */
    deleteNtfyConfig(configId) {
        if (confirm('Are you sure you want to delete this Ntfy configuration?')) {
            fetch(`/api/ntfy/config/${configId}`, {
                method: 'DELETE'
            })
            .then(response => response.json())
            .then(data => {
                if (data.success) {
                    this.showAlert('ntfyStatus', 'Configuration deleted successfully!', 'success');
                    this.loadNtfyConfig();
                    
                    // Reset notification settings for this config
                    this.resetNotificationSettingsForNtfy(configId);
                } else {
                    this.showAlert('ntfyStatus', `Error: ${data.message}`, 'error');
                }
            })
            .catch(error => {
                this.showAlert('ntfyStatus', `Error: ${error.message}`, 'error');
            });
        }
    }

    /**
     * Reset notification settings for a deleted configuration
     * @param {number} configId - Configuration ID
     */
    resetNotificationSettingsForNtfy(configId) {
        // Reset all notification settings that use this config
        const dropdowns = document.querySelectorAll('.options_ntfy_select');
        
        dropdowns.forEach(dropdown => {
            if (dropdown.value === configId.toString()) {
                dropdown.value = '';
                
                // Get event type and update settings
                const eventType = dropdown.getAttribute('data-event-type');
                const checkbox = document.getElementById(`ntfy_${eventType.toLowerCase()}`);
                
                if (checkbox) {
                    checkbox.checked = false;
                    
                    // Save the updated setting
                    this.updateNtfyNotificationSetting(eventType, false, '');
                }
            }
        });
    }

    /**
     * Update a notification setting
     * @param {string} eventType - Event type
     * @param {boolean} enabled - Whether the notification is enabled
     * @param {string} configId - Configuration ID
     */
    updateNtfyNotificationSetting(eventType, enabled, configId) {
        // If enabling but no config is selected, show an error and revert the checkbox
        if (enabled && (!configId || configId === '')) {
            this.showToastOrAlert(`Please select a configuration for ${eventType} notifications`, 'error');
            
            // Reset the checkbox
            const checkbox = document.getElementById(`ntfy_${eventType.toLowerCase()}`);
            if (checkbox) {
                checkbox.checked = false;
            }
            return;
        }
        
        const settingData = {
            event_type: eventType,
            enabled: enabled,
            config_id: configId
        };
        
        fetch('/api/ntfy/setting', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(settingData)
        })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                
                this.showToastOrAlert(`${eventType} notification ${enabled ? 'enabled' : 'disabled'}`, 'success');
            } else {
                
                this.showToastOrAlert(`Error updating notification setting: ${data.message}`, 'error');
                
                // Reset the checkbox if there was an error
                const checkbox = document.getElementById(`ntfy_${eventType.toLowerCase()}`);
                if (checkbox) {
                    checkbox.checked = !enabled; // Revert to previous state
                }
            }
        })
        .catch(error => {
            
            this.showToastOrAlert(`Error updating notification setting: ${error.message}`, 'error');
            
            // Reset the checkbox if there was an error
            const checkbox = document.getElementById(`ntfy_${eventType.toLowerCase()}`);
            if (checkbox) {
                checkbox.checked = !enabled; // Revert to previous state
            }
        });
    }

    /**
     * Show toast or fallback to an alert
     * @param {string} message - Message to display
     * @param {string} type - Message type (success, error, warning)
     */
    showToastOrAlert(message, type) {
        if (typeof showToast === 'function') {
            showToast(message, type);
        } else {
            // Fallback to our own alert
            this.showAlert('options_ntfy_status', message, type);
        }
    }

    /**
     * Test a Ntfy configuration
     * @param {number} configId - Configuration ID to test
     */
    testNtfyConfig(configId) {
        // Find the row with this config ID
        const configRow = document.querySelector(`.email_config_row[data-id="${configId}"]`);
        if (!configRow) return;
        
        // Get the test button
        const testBtn = configRow.querySelector('.test-btn');
        if (!testBtn) return;
        
        // Save original button content
        const originalText = testBtn.innerHTML;
        
        // Show loading state
        testBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Testing...';
        testBtn.disabled = true;
        
        // Send the test notification
        fetch(`/api/ntfy/test/${configId}`, {
            method: 'POST'
        })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                this.showToastOrAlert('Test notification sent successfully!', 'success');
            } else {
                this.showToastOrAlert(`Error: ${data.message}`, 'error');
            }
        })
        .catch(error => {
            this.showToastOrAlert(`Error: ${error.message}`, 'error');
        })
        .finally(() => {
            // Restore original button content
            testBtn.innerHTML = originalText;
            testBtn.disabled = false;
        });
    }

    /**
     * Set a configuration as the default
     * @param {number} configId - Configuration ID
     */
    setDefaultNtfyConfig(configId) {
        fetch(`/api/ntfy/config/${configId}/default`, {
            method: 'POST'
        })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                this.showToastOrAlert('Default configuration updated', 'success');
                this.loadNtfyConfig();
            } else {
                this.showToastOrAlert(`Error: ${data.message}`, 'error');
            }
        })
        .catch(error => {
            this.showToastOrAlert(`Error: ${error.message}`, 'error');
        });
    }

    /**
     * Load notification settings from the server
     */
    async loadNtfySettings() {
        try {
            console.log("Loading Ntfy notification settings...");
            
            // Ensure we have configs loaded first
            await this.populateNtfyDropdowns();
            
            const response = await fetch('/api/ntfy/settings');
            
            // Check if response is ok before parsing JSON
            if (!response.ok) {
                console.error(`Failed to load Ntfy settings: ${response.status} ${response.statusText}`);
                
                // Continue with empty settings rather than failing completely
                return;
            }
            
            // Try to parse the JSON response
            let data;
            try {
                data = await response.json();
                console.log("Loaded Ntfy settings:", data);
            } catch (parseError) {
                console.error("Failed to parse Ntfy settings response:", parseError);
                return;
            }
            
            if (data.success) {
                const settings = data.settings || {};
                console.log("Processing Ntfy settings:", settings);
                
                // Update checkboxes and dropdowns for each event type
                const eventTypes = ['ONLINE', 'ONBATT', 'LOWBATT', 'COMMOK', 'COMMBAD', 'SHUTDOWN', 'REPLBATT', 'NOCOMM', 'NOPARENT'];
                
                eventTypes.forEach(eventType => {
                    const checkbox = document.getElementById(`ntfy_${eventType.toLowerCase()}`);
                    const dropdown = document.querySelector(`.options_ntfy_select[data-event-type="${eventType}"]`);
                    const testButton = document.querySelector(`.options_ntfy_test[data-event-type="${eventType}"]`);
                    
                    if (checkbox && dropdown) {
                        // Log the state of each element
                        console.log(`Processing ${eventType} - Checkbox exists: ${!!checkbox}, Dropdown exists: ${!!dropdown}, Initial dropdown value: ${dropdown.value}`);
                        
                        const setting = settings[eventType];
                        console.log(`${eventType} setting:`, setting);
                        
                        if (setting) {
                            console.log(`Setting ${eventType} - Enabled: ${setting.enabled}, Config ID: ${setting.config_id}`);
                            
                            // Update dropdown based on database setting
                            if (setting.config_id && setting.config_id !== '') {
                                console.log(`Setting dropdown for ${eventType} to config_id: ${setting.config_id}`);
                                
                                // Verify the option exists before setting it
                                const optionExists = Array.from(dropdown.options).some(opt => opt.value === setting.config_id.toString());
                                if (optionExists) {
                                    dropdown.value = setting.config_id.toString();
                                    console.log(`Option exists, dropdown value set to: ${dropdown.value}`);
                                } else {
                                    console.warn(`Option for config_id ${setting.config_id} does not exist in dropdown for ${eventType}`);
                                    // Force a reload of dropdown options
                                    this.populateNtfyDropdowns().then(() => {
                                        // Try setting again after reload
                                        if (Array.from(dropdown.options).some(opt => opt.value === setting.config_id.toString())) {
                                            dropdown.value = setting.config_id.toString();
                                            console.log(`After reload, dropdown value set to: ${dropdown.value}`);
                                        }
                                    });
                                }
                                
                                // Show checkbox and test button if we have a config
                                checkbox.style.display = 'inline-block';
                                if (testButton) testButton.style.display = 'inline-block';
                                
                                // Update checkbox based on database setting
                                checkbox.checked = setting.enabled;
                                console.log(`Checkbox for ${eventType} set to: ${checkbox.checked}`);
                            } else {
                                console.log(`No config_id for ${eventType}, hiding controls`);
                                checkbox.style.display = 'none';
                                if (testButton) testButton.style.display = 'none';
                            }
                        } else {
                            console.log(`No setting found for ${eventType}`);
                            checkbox.style.display = 'none';
                            if (testButton) testButton.style.display = 'none';
                        }
                    } else {
                        console.warn(`Missing UI elements for ${eventType}`);
                    }
                });
                
                return true;
            } else {
                console.error("Failed to load Ntfy settings: Server reported failure");
                return false;
            }
        } catch (error) {
            console.error("Exception in loadNtfySettings:", error);
            // Don't show an error alert to the user, just log it
            return false;
        }
    }

    /**
     * Populate Ntfy dropdowns with available configurations
     */
    async populateNtfyDropdowns() {
        try {
            const response = await fetch('/api/ntfy/configs');
            const data = await response.json();
            
            if (data.success) {
                const configs = data.configs;
                const dropdowns = document.querySelectorAll('.options_ntfy_select');
                
                dropdowns.forEach(dropdown => {
                    // Save the current selection
                    const currentSelection = dropdown.value;
                    
                    
                    // Clear existing options except the first one
                    while (dropdown.options.length > 1) {
                        dropdown.remove(1);
                    }
                    
                    // Add options for each config
                    configs.forEach(config => {
                        const option = document.createElement('option');
                        option.value = config.id;
                        
                        const serverDisplay = config.server_type === 'ntfy.sh' ? 'ntfy.sh' : config.server;
                        option.textContent = `${serverDisplay} - ${config.topic}`;
                        
                        if (config.is_default) {
                            option.textContent += ' (Default)';
                        }
                        
                        dropdown.appendChild(option);
                    });
                    
                    // Restore the previous selection if it exists in the new options
                    if (currentSelection && currentSelection !== '') {
                        const optionExists = Array.from(dropdown.options).some(option => option.value === currentSelection);
                        if (optionExists) {
                            dropdown.value = currentSelection;
                            
                        } else {
                            dropdown.value = '';
                            
                        }
                    } else {
                        dropdown.value = '';
                    }
                    
                    // Update visibility of checkbox and test button based on selection
                    const eventType = dropdown.getAttribute('data-event-type');
                    const checkbox = document.getElementById(`ntfy_${eventType.toLowerCase()}`);
                    const testButton = document.querySelector(`.options_ntfy_test[data-event-type="${eventType}"]`);
                    
                    if (dropdown.value && dropdown.value !== '') {
                        if (checkbox) checkbox.style.display = 'inline-block';
                        if (testButton) testButton.style.display = 'inline-block';
                    } else {
                        if (checkbox) checkbox.style.display = 'none';
                        if (testButton) testButton.style.display = 'none';
                    }
                });
                
                
                return true;
            }
            return false;
        } catch (error) {
            
            return false;
        }
    }

    /**
     * Show an alert in the Ntfy tab
     * @param {string} message - Alert message
     * @param {string} type - Alert type (success, error, warning)
     */
    showNtfyAlert(message, type = 'success') {
        this.showAlert('options_ntfy_status', message, type);
    }

    /**
     * Show an alert in a specific container
     * @param {string} containerId - Container ID
     * @param {string} message - Alert message
     * @param {string} type - Alert type (success, error, warning)
     */
    showAlert(containerId, message, type) {
        const container = document.getElementById(containerId);
        if (!container) {
            
            // Fallback to toast if container not found
            if (typeof showToast === 'function') {
                showToast(message, type);
            } else {
                
            }
            return;
        }
        
        container.textContent = message;
        container.className = `options_alert ${type}`;
        container.classList.remove('hidden');
        
        // Hide after 5 seconds for success messages
        if (type === 'success') {
            setTimeout(() => {
                container.classList.add('hidden');
            }, 5000);
        }
    }
}

// Initialize Ntfy functionality for the Extranotifs tab
function initializeNtfyModule() {
    console.log('Initializing Ntfy module...');
    
    // Check if already initialized
    if (window.ntfyManager) {
        console.log('Ntfy module already initialized, refreshing settings...');
        // Force refresh if already initialized
        window.ntfyManager.populateNtfyDropdowns().then(() => {
            window.ntfyManager.loadNtfySettings().then(() => {
                console.log('Ntfy settings refreshed successfully');
            }).catch(err => {
                console.error('Failed to refresh Ntfy settings:', err);
            });
        }).catch(err => {
            console.error('Failed to refresh Ntfy dropdowns:', err);
        });
        return window.ntfyManager;
    }
    
    try {
        window.ntfyManager = new NtfyManager();
        console.log('Ntfy module initialized successfully');
        return window.ntfyManager;
    } catch (error) {
        console.error('Failed to initialize Ntfy module:', error);
        // Show error in UI
        const errorContainer = document.getElementById('options_ntfy_status');
        if (errorContainer) {
            errorContainer.textContent = 'Failed to initialize Ntfy module: ' + error.message;
            errorContainer.className = 'options_alert error';
            errorContainer.classList.remove('hidden');
        }
        return null;
    }
}

// Auto-initialize when script is loaded
document.addEventListener('DOMContentLoaded', () => {
    // Don't auto-initialize on load, wait for tab click
    console.log('Ntfy module ready to initialize on tab click');
});

// Make functions available globally
window.initializeNtfyModule = initializeNtfyModule; 