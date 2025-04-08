/**
 * Report Scheduler Initialization Module
 * 
 * This module handles the initialization of the report scheduler functionality:
 * - Constructor and initialization of the ReportScheduler class
 * - Email configuration loading for the scheduler
 * - Form setup and modal display 
 * - Event listeners for basic UI interactions
 * - Day selection toggling for weekly schedules
 */

// Report Scheduler Class
class ReportScheduler {
    constructor() {
        // Get modal element
        this.modal = document.getElementById('scheduleModal');
        
        // Store the current schedule being edited
        this.currentEditId = null;
        
        // Store default email
        this.defaultEmail = '';
        
        // Store schedules
        this.schedules = [];
        
        // Flag to prevent multiple submissions
        this.isSubmitting = false;
        this.lastSubmitTime = 0;
        
        // Bind methods to this instance
        this.loadSchedules = this.loadSchedules.bind(this);
        this.showAddScheduleForm = this.showAddScheduleForm.bind(this);
        this.closeModal = this.closeModal.bind(this);
        this.saveSchedule = this.saveSchedule.bind(this);
        this.testSchedule = this.testSchedule.bind(this);
        this.editSchedule = this.editSchedule.bind(this);
        this.deleteSchedule = this.deleteSchedule.bind(this);
        this.toggleDaySelection = this.toggleDaySelection.bind(this);
        
        // Initialize event listeners
        this.initializeEventListeners();
    }

    initializeEventListeners() {
        // Load schedules and email configurations
        this.loadDefaultEmail().then(() => {
            // Once emails are loaded, then load schedules
            this.loadSchedules();
            if (window.webLogger) {
                window.webLogger.console('🔄 Email configurations loaded, now loading schedules');
            }
        }).catch(err => {
            // If email loading fails, still try to load schedules
            this.loadSchedules();
            if (window.webLogger) {
                window.webLogger.console(`⚠️ Error loading email configs, but still loading schedules: ${err.message}`);
            }
        });
        
        // Test Schedule button
        const testBtn = document.getElementById('testScheduleBtn');
        if (testBtn) {
            testBtn.addEventListener('click', () => this.testSchedule());
        }

        // Add Schedule button
        const addBtn = document.getElementById('addSchedulerBtn');
        if (addBtn) {
            addBtn.addEventListener('click', () => this.showAddScheduleForm());
        }

        // Modal buttons
        const cancelBtn = document.getElementById('cancelScheduleBtn');
        if (cancelBtn) {
            cancelBtn.addEventListener('click', () => this.closeModal());
        }

        const saveBtn = document.getElementById('saveScheduleBtn');
        if (saveBtn) {
            // Remove any existing event listeners first
            saveBtn.replaceWith(saveBtn.cloneNode(true));
            // Get fresh reference after replacing
            const newSaveBtn = document.getElementById('saveScheduleBtn');
            // Add event listener with proper binding and prevent double firing
            newSaveBtn.addEventListener('click', (e) => {
                e.preventDefault();
                this.saveSchedule();
            });
        }

        // Period type handler
        const periodTypeSelect = document.getElementById('period_type');
        if (periodTypeSelect) {
            periodTypeSelect.addEventListener('change', function() {
                const dateRangeSelection = document.getElementById('dateRangeSelection');
                if (this.value === 'range') {
                    dateRangeSelection.style.display = 'block';
                } else {
                    dateRangeSelection.style.display = 'none';
                }
            });
        }
    }

    async loadDefaultEmail() {
        try {
            // Fetch all email configurations
            const response = await fetch('/api/settings/mail/all');
            if (!response.ok) {
                throw new Error(`Failed to fetch email configurations: ${response.status}`);
            }
            
            const data = await response.json();
            if (!data.success) {
                throw new Error('Failed to fetch email configurations');
            }
            
            const configs = data.data || [];
            
            // Populate the schedule email dropdown
            const scheduleEmailDropdown = document.getElementById('scheduleEmail');
            if (scheduleEmailDropdown) {
                // Clear the dropdown
                scheduleEmailDropdown.innerHTML = '<option value="">Select email</option>';
                
                // Add all available email configurations
                configs.forEach(config => {
                    // Get provider display name
                    let providerName = 'Custom';
                    if (config.provider && window.emailProviders && window.emailProviders[config.provider]) {
                        providerName = window.emailProviders[config.provider].displayName || config.provider;
                    }
                    
                    const destinationEmail = config.to_email || config.username || 'No recipient';
                    
                    const option = document.createElement('option');
                    option.value = config.id;
                    option.textContent = `${providerName} - ${destinationEmail}`;
                    scheduleEmailDropdown.appendChild(option);
                });
                
                // Log loaded configurations for debugging
                if (window.webLogger) {
                    window.webLogger.console(`📩 Loaded ${configs.length} email configurations for scheduler dropdown`);
                }
                
                // Return the data for chaining
                return {
                    success: true,
                    configs: configs
                };
            } else {
                if (window.webLogger) {
                    window.webLogger.console('⚠️ Could not find schedule email dropdown element');
                }
                return {
                    success: false,
                    error: 'Could not find schedule email dropdown element'
                };
            }
        } catch (error) {
            if (window.webLogger) {
                window.webLogger.console(`❌ Error loading email configurations: ${error.message}`);
            }
            // Rethrow to allow proper error handling in the caller
            throw error;
        }
    }

    async showAddScheduleForm() {
        if (window.webLogger) {
            window.webLogger.console('📋 Opening new schedule form');
        }
        
        // Make sure email configurations are loaded first
        try {
            await this.loadDefaultEmail();
            if (window.webLogger) {
                window.webLogger.console('📧 Email configurations loaded for new schedule form');
            }
        } catch (error) {
            if (window.webLogger) {
                window.webLogger.console(`⚠️ Error loading email configurations: ${error.message}`);
            }
            // Continue even if there's an error, as we can still create a schedule
        }
        
        // Reset form to default state
        this.resetForm();
        
        // Explicitly reset currentEditId since we're adding a new schedule
        document.getElementById('currentEditScheduleId').value = '';
        
        // Show the modal
        this.modal.style.display = 'block';
        
        // Add event listeners to day buttons
        const dayButtons = document.querySelectorAll('.day-btn');
        dayButtons.forEach(btn => {
            btn.onclick = this.toggleDaySelection;
        });
    }
    
    // Function to handle day selection toggle
    toggleDaySelection(event) {
        // Toggle the selected class on the clicked day button
        if (event && event.target) {
            event.target.classList.toggle('selected');
        } else {
            // If called directly with this as a DOM element
            this.classList.toggle('selected');
        }
    }

    closeModal() {
        if (window.webLogger) {
            window.webLogger.console('🔒 Closing schedule modal');
        }
        this.modal.style.display = 'none';
    }

    resetForm() {
        if (window.webLogger) {
            window.webLogger.console('🔄 Resetting schedule form fields');
        }
        
        // Reset form fields
        document.getElementById('scheduleTime').value = '';
        document.getElementById('scheduleEmail').value = '';
        document.getElementById('period_type').value = 'daily';
        document.getElementById('dateRangeSelection').style.display = 'none';
        document.getElementById('rangeFromDate').value = '';
        document.getElementById('rangeToDate').value = '';
        
        // Unselect day buttons
        document.querySelectorAll('.day-btn').forEach(btn => {
            btn.classList.remove('selected');
        });
        
        // Uncheck report type checkboxes
        document.querySelectorAll('input[name="report_types"]').forEach(cb => {
            cb.checked = false;
        });
        
        // Clear error message
        const errorDiv = document.getElementById('scheduleModalError');
        if (errorDiv) {
            errorDiv.textContent = '';
            errorDiv.classList.add('hidden');
        }
    }

    // Make the scheduler instance available globally
    static initialize() {
        window.reportScheduler = new ReportScheduler();
        return window.reportScheduler;
    }
}

// Export for use in the main options page
window.ReportScheduler = ReportScheduler; 