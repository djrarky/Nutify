class OptionsPage extends BasePage {
    constructor() {
        super();
        this.initializeNotificationControls();
        this.checkEmailConfiguration();
        this.initializeTabs();
        this.initSendReportNow();
    }

    initializeNotificationControls() {
        // No longer directly handle notification controls, 
        // just make sure the notification module functions are called
        console.log("Initializing notification controls from OptionsPage");
        
        // Initialize from notification module if available
        if (typeof populateEmailDropdowns === 'function') {
            populateEmailDropdowns().then(() => {
                if (typeof loadNotifySettings === 'function') {
                    loadNotifySettings();
                }
                
                if (typeof initializeNotificationTests === 'function') {
                    initializeNotificationTests();
                }
            });
        } else {
            console.warn("Notification module functions not found");
        }
    }

    async checkEmailConfiguration() {
        try {
            const response = await fetch('/api/settings/mail');
            const data = await response.json();
            
            if (data.success && data.data) {
                // Email is configured
                const configuredEmail = document.getElementById('configuredEmail');
                if (configuredEmail) {
                    configuredEmail.textContent = data.data.username || data.data.smtp_username;
                }
            }
        } catch (error) {
            console.error('Error checking email configuration:', error);
        }
    }

    initializeTabs() {
        // Select all tab buttons
        const tabButtons = document.querySelectorAll('.options_tab_button');
        // Select all tab contents
        const tabContents = document.querySelectorAll('.options_tab_content');

        // Function to activate a tab
        const activateTab = (tabId) => {
            // Remove active from all buttons and contents
            tabButtons.forEach(btn => btn.classList.remove('active'));
            tabContents.forEach(content => content.classList.remove('active'));

            // Activate the selected tab
            const selectedButton = document.querySelector(`[data-tab="${tabId}"]`);
            const selectedContent = document.getElementById(`${tabId}_tab`);

            if (selectedButton && selectedContent) {
                selectedButton.classList.add('active');
                selectedContent.classList.add('active');
                
                // Load data specific to the selected tab
                if (tabId === 'variables') {
                    if (typeof loadVariablesConfig === 'function') {
                        loadVariablesConfig();
                    }
                } else if (tabId === 'Database') {
                    if (typeof loadDatabaseStats === 'function') {
                        loadDatabaseStats();
                    }
                }
            }
        };

        // Add event listener for each button
        tabButtons.forEach(button => {
            button.addEventListener('click', () => {
                const tabId = button.getAttribute('data-tab');
                activateTab(tabId);
            });
        });
    }

    initSendReportNow() {
        const sendReportNowButton = document.getElementById('sendReportNowBtn');
        const reportTypeSelect = document.getElementById('report_type_select');
        const reportEmailSelect = document.getElementById('report_email_select');
        
        if (sendReportNowButton && reportTypeSelect && reportEmailSelect) {
            sendReportNowButton.addEventListener('click', async () => {
                const reportType = reportTypeSelect.value;
                const emailId = reportEmailSelect.value;
                
                if (!reportType) {
                    window.notify('Please select a report type', 'error', 5000);
                    return;
                }
                
                if (!emailId) {
                    window.notify('Please select an email configuration', 'error', 5000);
                    return;
                }
                
                // Update button state
                const originalText = sendReportNowButton.innerHTML;
                sendReportNowButton.disabled = true;
                sendReportNowButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Sending...';
                
                try {
                    const response = await fetch('/api/report/send-now', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                            report_type: reportType,
                            mail_config_id: emailId
                        })
                    });
                    
                    const data = await response.json();
                    
                    if (data.success) {
                        window.notify('Report sent successfully', 'success', 5000);
                    } else {
                        window.notify(`Error sending report: ${data.message || 'Unknown error'}`, 'error', 5000);
                    }
                } catch (error) {
                    window.notify(`Error sending report: ${error.message}`, 'error', 5000);
                } finally {
                    // Restore button state
                    sendReportNowButton.disabled = false;
                    sendReportNowButton.innerHTML = originalText;
                }
            });
        }
    }
}

// Function to show alerts
function showAlert(containerId, message, type, skipNotify = false) {
    // Use the global notify function instead with bottom right position
    if (!skipNotify) {
        window.notify(message, type === 'success' ? 'success' : (type === 'danger' ? 'error' : type), 5000);
    }
    
    // Also update the container if it exists (for backward compatibility)
    const container = document.getElementById(containerId);
    if (container) {
        container.textContent = message;
        container.className = 'options_alert ' + (type === 'success' ? 'options_alert_success' : 'options_alert_danger');
        container.classList.remove('hidden');
        setTimeout(() => {
            container.classList.add('hidden');
        }, 3000);
    }
}

// Helper function to show toast or fallback to alert
function showToastOrAlert(message, type) {
    // Use the notify function with bottom right position
    notify(message, type === 'danger' ? 'error' : type, true);
}

// Specific function for notification alerts
function showNotifyAlert(message, type = 'success', skipNotify = false) {
    // Use the notify function with bottom right position
    if (!skipNotify) {
        window.notify(message, type === 'danger' ? 'error' : type, 5000);
    }
    
    // Also update the container if it exists (for backward compatibility)
    const container = document.getElementById('options_nutify_status');
    if (container) {
        container.textContent = message;
        container.className = `options_alert options_alert_${type}`;
        container.classList.remove('hidden');
        
        setTimeout(() => {
            container.classList.add('hidden');
        }, 3000);
    }
}

// Export the functions and class for use in the main options page
window.OptionsPage = OptionsPage;
window.showAlert = showAlert;
window.showToastOrAlert = showToastOrAlert;
window.showNotifyAlert = showNotifyAlert; 