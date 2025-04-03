// Email Configuration Module - Provider Management
// Handles provider-related operations including:
// - Loading email providers from API
// - Updating form fields based on selected provider
// - Setting configuration state
// - Provider field updates

// Load existing email configuration
function loadEmailConfig() {
    // Hide the email configuration form card initially
    const emailConfigFormCard = document.getElementById('emailConfigFormCard');
    if (emailConfigFormCard) emailConfigFormCard.style.display = 'none';
    
    // Show the add configuration container
    const addEmailConfigContainer = document.getElementById('addEmailConfigContainer');
    if (addEmailConfigContainer) addEmailConfigContainer.style.display = 'block';
    
    // First load the providers, then load all configurations
    loadEmailProviders().then(() => {
        loadAllEmailConfigs();
    }).catch(error => {
        // Still try to load the configurations even if providers fail
        loadAllEmailConfigs();
    });
}

// Function to load email providers from the API
function loadEmailProviders() {
    return new Promise((resolve, reject) => {
        fetch('/api/settings/mail/providers')
            .then(response => {
                if (!response.ok) {
                    throw new Error('Failed to load email providers');
                }
                return response.json();
            })
            .then(data => {
                if (data.success && data.providers) {
                    // Store the providers in a global variable for use in other functions
                    window.emailProviders = data.providers;
                    
                    // Print providers to the console for debugging
                    console.log("Email providers loaded:", data.providers);
                    
                    // Populate the provider dropdown
                    const emailProviderSelect = document.getElementById('email_provider');
                    if (emailProviderSelect) {
                        // Save the current selection
                        const currentSelection = emailProviderSelect.value;
                        
                        // Clear existing options except the first one (Custom Configuration)
                        while (emailProviderSelect.options.length > 1) {
                            emailProviderSelect.remove(1);
                        }
                        
                        // Add provider options
                        Object.keys(data.providers).forEach(provider => {
                            const option = document.createElement('option');
                            option.value = provider;
                            
                            // Use the displayName from the provider configuration
                            const providerConfig = data.providers[provider];
                            let displayName = providerConfig.displayName || provider.charAt(0).toUpperCase() + provider.slice(1);
                            
                            option.textContent = displayName;
                            emailProviderSelect.appendChild(option);
                        });
                        
                        // Restore the previous selection if it exists
                        if (currentSelection) {
                            emailProviderSelect.value = currentSelection;
                            
                            // Update fields if a provider is selected
                            if (emailProviderSelect.value) {
                                updateProviderFields(emailProviderSelect.value);
                                
                                // Trigger change event manually to ensure handlers are called
                                const event = new Event('change');
                                emailProviderSelect.dispatchEvent(event);
                            }
                        }
                        
                        // Aggiungi anche un listener diretto qui
                        emailProviderSelect.addEventListener('change', function() {
                            console.log("Provider changed (from loadEmailProviders) to:", this.value);
                            updateProviderFields(this.value);
                        });
                    } else {
                        console.error("Email provider select element not found");
                    }
                    
                    resolve(data.providers);
                } else {
                    console.error("No providers found in API response or data format incorrect");
                    reject(new Error('No providers found in response'));
                }
            })
            .catch(error => {
                console.error("Error loading email providers:", error);
                // Hide provider notes in case of error
                const providerNotes = document.getElementById('provider_notes');
                if (providerNotes) {
                    providerNotes.style.display = 'none';
                }
                reject(error);
            });
    });
}

function setConfiguredState(isConfigured, config = {}) {
    const configButtons = document.getElementById('configurationButtons');
    const configStatus = document.getElementById('configurationStatus');
    const formInputs = document.querySelectorAll('.options_mail_form_group input, .options_mail_form_group select');
    const providerInfo = document.querySelector('.provider-info');
    const emailConfigForm = document.getElementById('emailConfigForm');
    const addEmailConfigContainer = document.getElementById('addEmailConfigContainer');
    const emailConfigFormCard = document.getElementById('emailConfigFormCard');
    const emailConfigSummary = document.getElementById('emailConfigSummary');
    
    // Check if elements exist before manipulating them
    if (isConfigured && config && config.email && config.smtp_server && config.smtp_port) {
        // We have a valid configuration, hide the add button container and form, show the summary card
        if (addEmailConfigContainer) addEmailConfigContainer.style.display = 'none';
        if (emailConfigFormCard) emailConfigFormCard.style.display = 'none';
        if (emailConfigSummary) emailConfigSummary.style.display = 'block';
        
        // Set form state for when it's shown
        if (configButtons) configButtons.classList.add('hidden');
        if (configStatus) configStatus.classList.remove('hidden');
        formInputs.forEach(input => input.disabled = true);
        
        // Show provider info if configured
        if (config.provider && providerInfo) {
            const providerSelect = document.getElementById('email_provider');
            if (providerSelect) {
                const selectedOption = providerSelect.querySelector(`option[value="${config.provider}"]`);
                if (selectedOption) {
                    providerInfo.textContent = `Provider: ${selectedOption.textContent}`;
                }
            }
        }
    } else {
        // No valid configuration, show add button container, hide form and summary card
        if (addEmailConfigContainer) addEmailConfigContainer.style.display = 'block';
        if (emailConfigFormCard) emailConfigFormCard.style.display = 'none';
        if (emailConfigSummary) emailConfigSummary.style.display = 'none';
        
        // Reset form state
        if (configButtons) configButtons.classList.remove('hidden');
        if (configStatus) configStatus.classList.add('hidden');
        formInputs.forEach(input => input.disabled = false);
    }
}

// Update provider fields when a provider is selected
function updateProviderFields(provider) {
    console.log("updateProviderFields called with provider:", provider);
    
    // Get the provider data
    const providers = window.emailProviders || {};
    const providerData = providers[provider];
    
    if (!providerData) {
        console.log("Provider data not found for:", provider);
        // If provider data is not found, clear fields
        document.getElementById('smtp_server').value = '';
        document.getElementById('smtp_port').value = '';
        document.getElementById('use_tls').checked = false;
        document.getElementById('use_starttls').checked = false;
        
        // Hide provider notes
        const providerNotes = document.getElementById('provider_notes');
        if (providerNotes) providerNotes.style.display = 'none';
        return;
    }
    
    console.log("Updating fields with provider data:", providerData);
    
    // Set SMTP server and port
    document.getElementById('smtp_server').value = providerData.smtp_server || '';
    document.getElementById('smtp_port').value = providerData.smtp_port || '';
    
    // Set TLS and STARTTLS checkboxes
    document.getElementById('use_tls').checked = !!providerData.tls;
    document.getElementById('use_starttls').checked = !!providerData.tls_starttls;
    
    // Show provider notes if available
    const providerNotes = document.getElementById('provider_notes');
    if (providerNotes) {
        if (providerData.notes) {
            providerNotes.innerHTML = `<div class="provider-note"><i class="fas fa-info-circle"></i> ${providerData.notes}</div>`;
            providerNotes.style.display = 'block';
        } else if (providerData.note) {
            providerNotes.innerHTML = `<div class="provider-note"><i class="fas fa-info-circle"></i> ${providerData.note}</div>`;
            providerNotes.style.display = 'block';
        } else {
            providerNotes.style.display = 'none';
        }
    }
}

// Export functions for use in the main options page
window.loadEmailConfig = loadEmailConfig;
window.loadEmailProviders = loadEmailProviders;
window.setConfiguredState = setConfiguredState;
window.updateProviderFields = updateProviderFields;
// Provide an alias for backward compatibility
window.updateFormFieldsForProvider = updateProviderFields; 