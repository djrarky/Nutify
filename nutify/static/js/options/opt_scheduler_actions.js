/**
 * Report Scheduler Actions Module
 * 
 * This module extends the ReportScheduler class with action methods:
 * - Loading existing schedules from the backend
 * - Saving new schedules
 * - Editing existing schedules
 * - Deleting schedules
 * - Testing schedule functionality
 * - Schedule display and UI interactions
 */

// Add methods to ReportScheduler.prototype
if (typeof ReportScheduler !== 'undefined') {
    // Save schedule method
    ReportScheduler.prototype.saveSchedule = async function() {
        // Get reference to the save button early
        const saveButton = document.getElementById('saveScheduleBtn');
        
        // Prevent double submissions with more robust debounce
        const now = Date.now();
        if (this.isSubmitting) {
            if (window.webLogger) {
                window.webLogger.console('⚠️ Submission already in progress');
            }
            return;
        }
        
        if (now - this.lastSubmitTime < 2000) {
            if (window.webLogger) {
                window.webLogger.console('⚠️ Preventing rapid duplicate submission');
            }
            return;
        }
        
        // Set flags and timestamps immediately to prevent race conditions
        this.lastSubmitTime = now;
        this.isSubmitting = true;

        // Store original button state and display loading state
        const originalText = saveButton.innerHTML;
        saveButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';
        saveButton.disabled = true;

        try {
            const days = [];
            document.querySelectorAll('.day-btn.selected').forEach(btn => {
                days.push(parseInt(btn.dataset.day));
            });

            const reportTypes = [];
            // Select only checkboxes inside the modal
            document.querySelectorAll('#scheduleModal input[name="report_types"]:checked').forEach(cb => {
                reportTypes.push(cb.value);
            });

            // Get the time
            const time = document.getElementById('scheduleTime').value;
            
            // Get period type
            const periodType = document.getElementById('period_type').value;
            
            // Get custom date range if applicable
            const fromDate = document.getElementById('rangeFromDate').value;
            const toDate = document.getElementById('rangeToDate').value;
            
            // Get email config ID or email address
            const emailValue = document.getElementById('scheduleEmail').value.trim();
            
            // Validate the schedule
            if (!this.validateSchedule(days, time, reportTypes)) {
                // Reset flags and button on validation failure
                this.isSubmitting = false;
                saveButton.innerHTML = originalText;
                saveButton.disabled = false;
                return;
            }

            // Prepare the schedule object
            const schedule = {
                days: days, // Already converted to numbers above
                time: time,
                reports: reportTypes,
                period_type: periodType,
                enabled: true
            };
            
            // Add date range if applicable
            if (periodType === 'range') {
                schedule.from_date = fromDate;
                schedule.to_date = toDate;
            }
            
            // Handle email configuration - either mail_config_id or email
            if (emailValue) {
                if (/^\d+$/.test(emailValue)) {
                    // It's a numeric ID, set mail_config_id
                    schedule.mail_config_id = parseInt(emailValue);
                } else {
                    // Otherwise, it's an actual email address
                    schedule.email = emailValue;
                }
            }

            // Get the schedule ID from the hidden field in the form
            const editId = document.getElementById('currentEditScheduleId').value;
            
            // Decide the HTTP method and URL based on whether we're editing or creating
            let url, method;
            if (editId && editId !== '') {
                // We're updating an existing schedule
                url = `/api/settings/report/schedules/${editId}`;
                method = 'PUT';
            } else {
                // We're creating a new schedule
                url = '/api/settings/report/schedules';
                method = 'POST';
            }

            const response = await fetch(url, {
                method: method,
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(schedule)
            });

            const data = await response.json();

            if (data.success) {
                showToast('Schedule saved successfully', 'success');
                // Reset the form and close the modal
                document.getElementById('currentEditScheduleId').value = '';
                this.closeModal();
                // Reload the schedules list
                await this.loadSchedules();
            } else {
                const errorDiv = document.getElementById('scheduleModalError');
                errorDiv.textContent = data.message || 'Error saving schedule';
                errorDiv.classList.remove('hidden');
            }
        } catch (error) {
            const errorDiv = document.getElementById('scheduleModalError');
            if (errorDiv) {
                errorDiv.textContent = 'Error saving schedule: ' + error.message;
                errorDiv.classList.remove('hidden');
            }
        } finally {
            // Always reset button state and isSubmitting flag in the finally block
            // to ensure it happens regardless of success or error
            saveButton.innerHTML = originalText;
            saveButton.disabled = false;
            this.isSubmitting = false;
        }
    };

    // Validate schedule method
    ReportScheduler.prototype.validateSchedule = function(days, time, reportTypes) {
        const errorDiv = document.getElementById('scheduleModalError');
        errorDiv.classList.add('hidden');
        
        // Check if at least one day is selected
        if (days.length === 0) {
            errorDiv.textContent = 'Please select at least one day';
            errorDiv.classList.remove('hidden');
            return false;
        }
        
        // Check if time is provided
        if (!time) {
            errorDiv.textContent = 'Please select a time';
            errorDiv.classList.remove('hidden');
            return false;
        }
        
        // Check if we're editing an existing schedule
        const editId = document.getElementById('currentEditScheduleId').value;
        const isEditing = editId && editId !== '';
        
        // Require at least one report type only for new schedules, allow empty for edits
        if (reportTypes.length === 0 && !isEditing) {
            errorDiv.textContent = 'Please select at least one report type';
            errorDiv.classList.remove('hidden');
            return false;
        }
        
        // Check if period type is range and range dates are provided
        const periodType = document.getElementById('period_type').value;
        if (periodType === 'range') {
            const fromDate = document.getElementById('rangeFromDate').value;
            const toDate = document.getElementById('rangeToDate').value;
            
            if (!fromDate || !toDate) {
                errorDiv.textContent = 'Please provide both From and To dates for range period';
                errorDiv.classList.remove('hidden');
                return false;
            }
            
            // Check if From date is before To date
            const fromDateObj = new Date(fromDate);
            const toDateObj = new Date(toDate);
            
            if (fromDateObj > toDateObj) {
                errorDiv.textContent = 'From date must be before To date';
                errorDiv.classList.remove('hidden');
                return false;
            }
        }
        
        return true;
    };

    // Load schedules method
    ReportScheduler.prototype.loadSchedules = async function() {
        try {
            const response = await fetch('/api/settings/report/schedules');
            const data = await response.json();

            if (data.success) {
                this.schedules = data.data;
                
                // Check for any orphaned schedules on load
                this.checkForOrphanedSchedules();
                
                this.renderSchedules();
            }
        } catch (error) {
            console.error('Error loading schedules:', error);
        }
    };
    
    // Check for orphaned schedules
    ReportScheduler.prototype.checkForOrphanedSchedules = async function() {
        try {
            // Get all valid email configuration IDs
            const emailResponse = await fetch('/api/settings/mail/all');
            const emailData = await emailResponse.json();
            
            if (!emailData.success) {
                if (window.webLogger) {
                    window.webLogger.console('❌ Failed to fetch email configurations for orphan check');
                }
                return;
            }
            
            const validEmailIds = emailData.data.map(config => config.id);
            
            // Find any schedules that reference non-existent email IDs
            const orphanedSchedules = this.schedules.filter(schedule => 
                schedule.mail_config_id !== null && 
                schedule.mail_config_id !== undefined && 
                !validEmailIds.includes(schedule.mail_config_id)
            );
            
            if (orphanedSchedules.length > 0) {
                if (window.webLogger) {
                    window.webLogger.console(`⚠️ Found ${orphanedSchedules.length} orphaned schedules during page load`);
                }
                
                // Delete these orphaned schedules
                const deletePromises = orphanedSchedules.map(schedule => {
                    if (window.webLogger) {
                        window.webLogger.console(`🗑️ Auto-deleting orphaned schedule ID ${schedule.id} (references non-existent email ID ${schedule.mail_config_id})`);
                    }
                    return fetch(`/api/settings/report/schedules/${schedule.id}`, {
                        method: 'DELETE'
                    }).then(resp => resp.json());
                });
                
                const results = await Promise.all(deletePromises);
                if (window.webLogger) {
                    window.webLogger.console(`✅ Auto-deleted ${results.filter(r => r.success).length} orphaned schedules`);
                }
                
                // Update our local schedules array by removing the deleted ones
                const deletedIds = orphanedSchedules.map(s => s.id);
                this.schedules = this.schedules.filter(s => !deletedIds.includes(s.id));
                
                // Re-render the schedules without triggering another check
                this.renderSchedules();
                
                showAlert('scheduleStatus', 'Cleaned up orphaned schedules', 'info');
            }
        } catch (error) {
            if (window.webLogger) {
                window.webLogger.console(`❌ Error checking for orphaned schedules: ${error.message}`);
            }
        }
    };

    // Render schedules method
    ReportScheduler.prototype.renderSchedules = function() {
        const container = document.getElementById('schedulerList');
        if (!container) return;
        
        if (this.schedules.length === 0) {
            container.innerHTML = '<div class="empty-state">No scheduled reports configured</div>';
            return;
        }
        
        // Fetch the current email configurations for display
        const emailConfigs = {};
        const emailSelect = document.getElementById('scheduleEmail');
        
        if (emailSelect) {
            Array.from(emailSelect.options).forEach(option => {
                if (option.value && option.value !== '') {
                    emailConfigs[option.value] = option.textContent;
                }
            });
        }
        
        container.innerHTML = this.schedules.map(schedule => {
            // Determine which email to display in the UI
            let displayEmail = '';
            
            if (schedule.email) {
                // If direct email address exists, show it
                displayEmail = schedule.email;
            } else if (schedule.mail_config_id) {
                // If mail_config_id exists, try to find the actual email configuration name
                if (emailConfigs[schedule.mail_config_id]) {
                    displayEmail = emailConfigs[schedule.mail_config_id];
                } else {
                    // If we can't find the option, just show the ID
                    displayEmail = `Email Config #${schedule.mail_config_id}`;
                }
            } else {
                // If neither email nor mail_config_id is set, show "No email selected"
                displayEmail = "No email selected";
            }
            
            return `
            <div class="schedule-item" data-schedule-id="${schedule.id}">
                <div class="schedule-info">
                    <div class="schedule-time">
                        <i class="fas fa-clock"></i> ${schedule.time}
                    </div>
                    <div class="schedule-days">
                        <i class="fas fa-calendar"></i> ${this.formatDays(schedule.days)}
                    </div>
                    <div class="schedule-period">
                        <i class="fas fa-calendar-alt"></i> ${this.formatPeriod(schedule)}
                    </div>
                    <div class="schedule-reports">
                        <i class="fas fa-file-alt"></i> ${this.formatReports(schedule.reports)}
                    </div>
                    <div class="schedule-email">
                        <i class="fas fa-envelope"></i> ${displayEmail}
                    </div>
                </div>
                <div class="schedule-actions">
                    <button class="options_btn options_btn_secondary edit-schedule-btn">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button class="options_btn options_btn_secondary delete-schedule-btn">
                        <i class="fas fa-trash"></i>
                    </button>
                    <label class="schedule-toggle">
                        <input type="checkbox" class="enable-schedule-checkbox" data-schedule-id="${schedule.id}" ${schedule.enabled ? 'checked' : ''}>
                        Enabled
                    </label>
                </div>
            </div>
        `}).join('');

        // Add event listeners to the newly created buttons
        container.querySelectorAll('.schedule-item').forEach(item => {
            const scheduleId = parseInt(item.dataset.scheduleId);
            
            item.querySelector('.edit-schedule-btn').addEventListener('click', () => {
                this.editSchedule(scheduleId);
            });
            
            item.querySelector('.delete-schedule-btn').addEventListener('click', () => {
                this.deleteSchedule(scheduleId);
            });
            
            // Add event listener to the schedule toggle checkbox
            const checkbox = item.querySelector('.enable-schedule-checkbox');
            if (checkbox) {
                checkbox.addEventListener('change', function() {
                    const scheduleId = parseInt(this.dataset.scheduleId);
                    const newStatus = this.checked;

                    // Send a request to update the schedule's enabled flag
                    fetch(`/api/settings/report/schedules/${scheduleId}`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ enabled: newStatus })
                    })
                    .then(resp => resp.json())
                    .then(data => {
                        if (data.success) {
                            showAlert('scheduleStatus', `Schedule ${newStatus ? 'enabled' : 'disabled'} successfully`, 'success');
                        } else {
                            showAlert('scheduleStatus', 'Error updating schedule status', 'danger');
                            this.checked = !newStatus; // Revert in case of error
                        }
                    })
                    .catch(error => {
                        showAlert('scheduleStatus', 'Error updating schedule status', 'danger');
                        this.checked = !newStatus; // Revert in case of error
                    });
                });
            }
        });
    };

    // Format days method
    ReportScheduler.prototype.formatDays = function(days) {
        if (!days || days.length === 0) return 'No days selected';
        
        const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        const shortDayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        
        // Sort days
        days.sort((a, b) => a - b);
        
        // If all days are selected, return "Every day"
        if (days.length === 7) return 'Every day';
        
        // If weekdays are selected, return "Weekdays"
        if (days.length === 5 && !days.includes(0) && !days.includes(6)) return 'Weekdays';
        
        // If weekend days are selected, return "Weekends"
        if (days.length === 2 && days.includes(0) && days.includes(6)) return 'Weekends';
        
        // Otherwise, return the short names of the selected days
        return days.map(day => shortDayNames[day]).join(', ');
    };

    // Format reports method
    ReportScheduler.prototype.formatReports = function(reports) {
        if (!reports || reports.length === 0) return 'No reports selected';
        return reports.join(', ');
    };

    // Format period method
    ReportScheduler.prototype.formatPeriod = function(schedule) {
        if (!schedule.period_type || schedule.period_type === 'daily') return 'Daily';
        
        if (schedule.period_type === 'range') {
            const fromDate = schedule.from_date ? new Date(schedule.from_date).toLocaleDateString() : 'N/A';
            const toDate = schedule.to_date ? new Date(schedule.to_date).toLocaleDateString() : 'N/A';
            return `Range: ${fromDate} to ${toDate}`;
        }
        
        return schedule.period_type.charAt(0).toUpperCase() + schedule.period_type.slice(1);
    };

    // Edit schedule method
    ReportScheduler.prototype.editSchedule = async function(id) {
        try {
            const schedule = this.schedules.find(s => s.id === id);
            if (!schedule) {
                showAlert('scheduleStatus', 'Schedule not found', 'danger');
                return;
            }
            
            // Reset form
            this.resetForm();
            
            // Set current edit ID
            document.getElementById('currentEditScheduleId').value = id;
            
            // Set time
            document.getElementById('scheduleTime').value = schedule.time || '';
            
            // Set email
            if (schedule.mail_config_id) {
                document.getElementById('scheduleEmail').value = schedule.mail_config_id;
            } else if (schedule.email) {
                // If we have a custom email that's not in the dropdown, we'll need to handle it
                // For now, just set a placeholder
                document.getElementById('scheduleEmail').value = '';
            }
            
            // Set period type
            const periodType = document.getElementById('period_type');
            periodType.value = schedule.period_type || 'daily';
            
            // Set date range if applicable
            if (schedule.period_type === 'range') {
                document.getElementById('dateRangeSelection').style.display = 'block';
                document.getElementById('rangeFromDate').value = schedule.from_date || '';
                document.getElementById('rangeToDate').value = schedule.to_date || '';
            } else {
                document.getElementById('dateRangeSelection').style.display = 'none';
            }
            
            // Set selected days
            document.querySelectorAll('.day-btn').forEach(btn => {
                const day = parseInt(btn.dataset.day);
                if (schedule.days && schedule.days.includes(day)) {
                    btn.classList.add('selected');
                }
            });
            
            // Set report types
            document.querySelectorAll('input[name="report_types"]').forEach(cb => {
                if (schedule.reports && schedule.reports.includes(cb.value)) {
                    cb.checked = true;
                }
            });
            
            // Show the modal
            this.modal.style.display = 'block';
            
            // Re-add event listeners to day buttons
            document.querySelectorAll('.day-btn').forEach(btn => {
                btn.onclick = this.toggleDaySelection;
            });
        } catch (error) {
            console.error('Error editing schedule:', error);
            showAlert('scheduleStatus', 'Error editing schedule', 'danger');
        }
    };

    // Delete schedule method
    ReportScheduler.prototype.deleteSchedule = async function(id) {
        if (!confirm('Are you sure you want to delete this schedule?')) {
            return;
        }
        
        try {
            const response = await fetch(`/api/settings/report/schedules/${id}`, {
                method: 'DELETE'
            });
            
            const data = await response.json();
            
            if (data.success) {
                showAlert('scheduleStatus', 'Schedule deleted successfully', 'success');
                // Reload schedules
                await this.loadSchedules();
            } else {
                showAlert('scheduleStatus', 'Error deleting schedule: ' + (data.message || 'Unknown error'), 'danger');
            }
        } catch (error) {
            console.error('Error deleting schedule:', error);
            showAlert('scheduleStatus', 'Error deleting schedule', 'danger');
        }
    };

    // Test schedule method
    ReportScheduler.prototype.testSchedule = async function() {
        const saveButton = document.getElementById('testScheduleBtn');
        
        // Prevent rapid repeated submissions
        const now = Date.now();
        if (this.isSubmitting || (now - this.lastSubmitTime < 2000)) {
            return;
        }
        
        // Set flags and timestamps
        this.lastSubmitTime = now;
        this.isSubmitting = true;
        
        // Store original button state and display loading state
        const originalText = saveButton.innerHTML;
        saveButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Testing...';
        saveButton.disabled = true;
        
        try {
            // Get necessary data from form
            const emailValue = document.getElementById('scheduleEmail').value.trim();
            const reportTypes = [];
            
            document.querySelectorAll('#scheduleModal input[name="report_types"]:checked').forEach(cb => {
                reportTypes.push(cb.value);
            });
            
            // Validate required fields
            if (!emailValue) {
                throw new Error('Please select an email configuration');
            }
            
            if (reportTypes.length === 0) {
                throw new Error('Please select at least one report type');
            }
            
            // Get period type information
            const periodType = document.getElementById('period_type').value;
            
            // Prepare the test request
            const testData = {
                reports: reportTypes,
                period_type: periodType || 'yesterday'
            };
            
            // Add from_date and to_date if period_type is 'range'
            if (testData.period_type === 'range') {
                const fromDate = document.getElementById('rangeFromDate').value;
                const toDate = document.getElementById('rangeToDate').value;
                
                if (!fromDate || !toDate) {
                    throw new Error('Please select both From and To dates for custom range');
                }
                
                testData.from_date = fromDate;
                testData.to_date = toDate;
            }
            
            // Add email ID or address
            if (/^\d+$/.test(emailValue)) {
                testData.mail_config_id = parseInt(emailValue);
            } else {
                testData.email = emailValue;
            }
            
            console.log('Sending test schedule data:', testData);
            
            // Send the test request to the correct endpoint
            const response = await fetch('/api/settings/report/schedules/test', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(testData)
            });
            
            const data = await response.json();
            console.log('Test schedule response:', data);
            
            if (data.success) {
                showAlert('scheduleStatus', 'Test reports sent successfully', 'success');
            } else {
                showAlert('scheduleStatus', 'Error sending test reports: ' + (data.message || 'Unknown error'), 'danger');
            }
        } catch (error) {
            console.error('Error testing schedule:', error);
            
            // Show error in modal
            const errorDiv = document.getElementById('scheduleModalError');
            if (errorDiv) {
                errorDiv.textContent = error.message || 'Error testing schedule';
                errorDiv.classList.remove('hidden');
            }
        } finally {
            // Always reset button state and isSubmitting flag
            saveButton.innerHTML = originalText;
            saveButton.disabled = false;
            this.isSubmitting = false;
        }
    };
}

// Add helper function to show toast
function showToast(message, type) {
    if (typeof window.notify === 'function') {
        window.notify(message, type, 5000);
    } else {
        alert(message);
    }
}

// Export for use in the main options page
window.showToast = showToast; 