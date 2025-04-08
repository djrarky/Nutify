class ReportManager {
    constructor() {
        this.initializeEventListeners();
        this.isProcessing = false;
        this.lastSubmitTime = 0;  // For preventing double submissions
    }

    initializeEventListeners() {
        // Save report settings
        const saveButton = document.getElementById('saveReportSettings');
        if (saveButton) {
            saveButton.addEventListener('click', () => this.saveReportSettings());
        }

        // Send report now
        const sendButton = document.getElementById('sendReportNow');
        if (sendButton) {
            sendButton.addEventListener('click', () => this.sendReportNow());
        }

        // Initialize date inputs with default values
        this.initializeDateInputs();
    }

    initializeDateInputs() {
        const today = new Date();
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);

        const fromDateInput = document.getElementById('report_from_date');
        const toDateInput = document.getElementById('report_to_date');

        if (fromDateInput) {
            fromDateInput.value = yesterday.toISOString().split('T')[0];
        }
        if (toDateInput) {
            toDateInput.value = today.toISOString().split('T')[0];
        }
    }

    validateSettings() {
        const reportTypes = Array.from(document.querySelectorAll('input[name="report_types"]:checked'))
            .map(cb => cb.value);

        const sendButton = document.getElementById('sendReportNow');
        let originalContent = '';
        if (sendButton) {
            originalContent = sendButton.innerHTML;
        }

        if (reportTypes.length === 0) {
            if (sendButton) {
                sendButton.innerHTML = '<i class="fas fa-exclamation-circle"></i> Select Reports!';
                sendButton.classList.add('btn-error');
                
                // Restore the button after 2 seconds
                setTimeout(() => {
                    sendButton.innerHTML = originalContent;
                    sendButton.classList.remove('btn-error');
                }, 2000);
            }
            this.showError('Please select at least one report type');
            return false;
        }

        const fromDate = document.getElementById('report_from_date').value;
        const toDate = document.getElementById('report_to_date').value;

        if (!fromDate || !toDate) {
            if (sendButton) {
                sendButton.innerHTML = '<i class="fas fa-exclamation-circle"></i> Select Dates!';
                sendButton.classList.add('btn-error');
                
                // Restore the button after 2 seconds
                setTimeout(() => {
                    sendButton.innerHTML = originalContent;
                    sendButton.classList.remove('btn-error');
                }, 2000);
            }
            this.showError('Please select both start and end dates');
            return false;
        }
        
        // Get the selected email ID
        const emailSelect = document.getElementById('report_email_select');
        const idEmail = emailSelect && emailSelect.value ? parseInt(emailSelect.value) : null;
        
        if (!idEmail) {
            if (sendButton) {
                sendButton.innerHTML = '<i class="fas fa-exclamation-circle"></i> Select Email!';
                sendButton.classList.add('btn-error');
                
                // Restore the button after 2 seconds
                setTimeout(() => {
                    sendButton.innerHTML = originalContent;
                    sendButton.classList.remove('btn-error');
                }, 2000);
            }
            this.showError('Please select an email configuration');
            return false;
        }

        return true;
    }

    async saveReportSettings() {
        // Prevent double submissions within 2 seconds
        const now = Date.now();
        if (!this.validateSettings() || this.isProcessing || (now - this.lastSubmitTime < 2000)) {
            return;
        }
        this.lastSubmitTime = now;

        try {
            this.isProcessing = true;
            const saveButton = document.getElementById('saveReportSettings');
            if (saveButton) {
                saveButton.disabled = true;
            }

            const settings = this.getReportSettings();
            
            const response = await fetch('/api/settings/report', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(settings)
            });

            const result = await response.json();
            
            if (result.success) {
                this.showSuccess('Report settings saved successfully');
            } else {
                this.showError(result.error || 'Failed to save report settings');
            }
        } catch (error) {
            console.error('Error saving report settings:', error);
            this.showError('Failed to save report settings');
        } finally {
            this.isProcessing = false;
            const saveButton = document.getElementById('saveReportSettings');
            if (saveButton) {
                saveButton.disabled = false;
            }
        }
    }

    async sendReportNow() {
        if (!this.validateSettings() || this.isProcessing) return;

        try {
            this.isProcessing = true;
            const sendButton = document.getElementById('sendReportNow');
            const originalContent = sendButton ? sendButton.innerHTML : '';
            
            if (sendButton) {
                sendButton.disabled = true;
                sendButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Sending...';
            }

            const settings = this.getReportSettings();
            let success = false;
            
            try {
                // Perform the request with improved error handling
                const response = await fetch('/api/settings/report/schedules/test', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(settings)
                });
                
                // Verify if the response is OK
                if (!response.ok) {
                    console.error(`Server error: ${response.status}`);
                    throw new Error(`Server error: ${response.status}`);
                }
                
                // Get the response first as text and then try to parse it as JSON
                let result;
                try {
                    const text = await response.text();
                    console.log('Raw response text:', text.substring(0, 100)); // Log only the first 100 characters
                    
                    if (!text || text.trim() === '') {
                        console.error('Empty response');
                        result = { success: false, message: 'Empty response' };
                    } else {
                        result = JSON.parse(text);
                    }
                } catch (parseError) {
                    console.error('Invalid response format', parseError);
                    throw new Error('Invalid response format');
                }
                
                console.log('API Response:', result);
                
                if (result && result.success) {
                    success = true;
                    this.showSuccess('Report sent successfully');
                } else {
                    this.showError(result.message || result.error || 'Failed to send report');
                }
            } catch (error) {
                console.error('Error in API request:', error);
                this.showError(`Error sending report: ${error.message}`);
            }
            
            if (sendButton) {
                // Re-enable the button
                sendButton.disabled = false;
                
                if (success) {
                    // Show success message in the button
                    sendButton.innerHTML = '<i class="fas fa-check-circle"></i> Report Sent!';
                    sendButton.classList.add('btn-success');
                } else {
                    // Show error message in the button
                    sendButton.innerHTML = '<i class="fas fa-times-circle"></i> Failed to Send!';
                    sendButton.classList.add('btn-error');
                }
                
                // Restore the button after 2 seconds
                setTimeout(() => {
                    sendButton.innerHTML = originalContent;
                    sendButton.classList.remove('btn-success', 'btn-error');
                }, 2000);
            }
        } finally {
            this.isProcessing = false;
        }
    }

    getReportSettings() {
        const reportTypes = Array.from(document.querySelectorAll('input[name="report_types"]:checked'))
            .map(cb => cb.value);
            
        // Get the selected email ID
        const emailSelect = document.getElementById('report_email_select');
        const idEmail = emailSelect && emailSelect.value ? parseInt(emailSelect.value) : null;

        return {
            reports: reportTypes,
            period_type: 'range',
            from_date: document.getElementById('report_from_date')?.value,
            to_date: document.getElementById('report_to_date')?.value,
            mail_config_id: idEmail
        };
    }

    showSuccess(message) {
        if (window.notify) {
            window.notify(message, 'success');
        } else {
            console.log(message);
        }
    }

    showError(message) {
        if (window.notify) {
            window.notify(message, 'error');
        } else {
            console.error(message);
        }
    }
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    webLogger.console('Initializing ReportManager');
    window.reportManager = new ReportManager();
}); 