/**
 * Advanced NUT Configuration management functionality
 * Provides UI for reading and writing NUT configuration files
 */

class AdvancedNutConfigManager {
    constructor() {
        this.currentFile = null;
        this.originalContent = '';
        this.editor = null;
        this.fileSelectEl = null;
        this.editorContainerEl = null;
        this.docsContainerEl = null;
        this.saveButtonEl = null;
        this.restartButtonEl = null;
        this.alertContainerEl = null;
        this.collapseHeaderEl = null;
        this.collapseContentEl = null;
        this.isInitialized = false;
    }

    /**
     * Initialize the Advanced NUT Configuration manager and set up event listeners
     */
    initialize() {
        if (this.isInitialized) return;

        // Initialize elements
        this.fileSelectEl = document.getElementById('advanced_nut_file_select');
        this.editorContainerEl = document.getElementById('advanced_editor_container');
        this.docsContainerEl = document.getElementById('advanced_docs_container');
        this.saveButtonEl = document.getElementById('advanced_save_btn');
        this.restartButtonEl = document.getElementById('advanced_restart_btn');
        this.alertContainerEl = document.getElementById('advanced_alert_container');
        this.collapseHeaderEl = document.querySelector('#Advanced_tab .collapse-header');
        this.collapseContentEl = document.querySelector('#Advanced_tab .collapse-content');

        // Set up event listeners
        if (this.fileSelectEl) {
            this.fileSelectEl.addEventListener('change', (e) => this.handleFileSelect(e));
        }

        if (this.saveButtonEl) {
            this.saveButtonEl.addEventListener('click', () => this.saveConfig());
        }

        if (this.restartButtonEl) {
            this.restartButtonEl.addEventListener('click', () => this.restartServices());
        }

        // Set up collapse functionality
        if (this.collapseHeaderEl) {
            this.collapseHeaderEl.addEventListener('click', () => this.toggleCollapse());
        }

        // Load available files
        this.loadAvailableFiles();

        // Initialize CodeMirror editor if element exists
        const editorTextarea = document.getElementById('advanced_editor');
        if (editorTextarea) {
            this.editor = CodeMirror.fromTextArea(editorTextarea, {
                lineNumbers: true,
                mode: 'shell',
                theme: 'monokai',
                lineWrapping: true,
                extraKeys: {"Ctrl-Space": "autocomplete"}
            });
            
            // Resize editor to fit content
            this.editor.setSize('100%', '400px');
        }

        this.isInitialized = true;
    }

    /**
     * Load the list of available NUT configuration files
     */
    async loadAvailableFiles() {
        try {
            const response = await fetch('/api/advanced/nut/files');
            const data = await response.json();

            if (data.success && data.files && this.fileSelectEl) {
                // Clear current options
                this.fileSelectEl.innerHTML = '<option value="">Select a file</option>';

                // Add options for each file
                data.files.forEach(file => {
                    const option = document.createElement('option');
                    option.value = file.name;
                    option.textContent = `${file.name} - ${file.description}`;
                    this.fileSelectEl.appendChild(option);
                });
            } else {
                this.showAlert('Failed to load NUT configuration files', 'error');
            }
        } catch (error) {
            console.error('Error loading NUT configuration files:', error);
            this.showAlert(`Error loading NUT configuration files: ${error.message}`, 'error');
        }
    }

    /**
     * Handle file selection change
     * @param {Event} event - Change event
     */
    async handleFileSelect(event) {
        const filename = event.target.value;
        if (!filename) {
            this.clearEditor();
            return;
        }

        await this.loadConfig(filename);
    }

    /**
     * Load a configuration file into the editor
     * @param {string} filename - Name of the file to load
     */
    async loadConfig(filename) {
        try {
            const response = await fetch(`/api/advanced/nut/config/${filename}`);
            const data = await response.json();

            if (data.success && data.config) {
                this.currentFile = filename;
                this.originalContent = data.config.content;
                
                // Update editor
                if (this.editor) {
                    this.editor.setValue(data.config.content);
                }
                
                // Load documentation
                this.loadDocumentation(filename);
            } else {
                this.showAlert(`Failed to load ${filename}: ${data.message}`, 'error');
            }
        } catch (error) {
            console.error(`Error loading ${filename}:`, error);
            this.showAlert(`Error loading ${filename}: ${error.message}`, 'error');
        }
    }

    /**
     * Load documentation for a configuration file
     * @param {string} filename - Name of the file to load documentation for
     */
    async loadDocumentation(filename) {
        try {
            const response = await fetch(`/api/advanced/nut/docs/${filename}`);
            const data = await response.json();

            if (data.success && this.docsContainerEl) {
                // Clear current documentation
                this.docsContainerEl.innerHTML = '';

                // Add file description header
                const fileHeader = document.createElement('div');
                fileHeader.className = 'file-description';
                const fileDescriptionResponse = await fetch(`/api/advanced/nut/config/${filename}`);
                const fileData = await fileDescriptionResponse.json();
                
                if (fileData.success && fileData.config && fileData.config.description) {
                    fileHeader.innerHTML = `
                        <h3>${filename}</h3>
                        <p class="file-desc">${fileData.config.description || "Network UPS Tools configuration file"}</p>
                        <p class="file-path"><strong>Path:</strong> ${fileData.config.path}</p>
                        <p class="file-modified"><strong>Last Modified:</strong> ${this.formatDate(fileData.config.modified)}</p>
                    `;
                } else {
                    fileHeader.innerHTML = `<h3>${filename}</h3>`;
                }
                
                this.docsContainerEl.appendChild(fileHeader);
                
                if (Object.keys(data.documentation).length === 0) {
                    const noDocs = document.createElement('p');
                    noDocs.className = 'no-docs-message';
                    noDocs.textContent = 'No documentation available for this file.';
                    this.docsContainerEl.appendChild(noDocs);
                    return;
                }

                // Add documentation header
                const docsHeader = document.createElement('h4');
                docsHeader.textContent = 'Parameter Reference';
                docsHeader.className = 'params-header';
                this.docsContainerEl.appendChild(docsHeader);

                // Create documentation table
                const table = document.createElement('table');
                table.className = 'doc-table';
                
                // Add table header
                const thead = document.createElement('thead');
                const headerRow = document.createElement('tr');
                const paramHeader = document.createElement('th');
                paramHeader.textContent = 'Parameter';
                paramHeader.width = '30%';
                const descHeader = document.createElement('th');
                descHeader.textContent = 'Description';
                descHeader.width = '70%';
                headerRow.appendChild(paramHeader);
                headerRow.appendChild(descHeader);
                thead.appendChild(headerRow);
                table.appendChild(thead);
                
                // Add table body
                const tbody = document.createElement('tbody');
                Object.entries(data.documentation).forEach(([param, desc]) => {
                    const row = document.createElement('tr');
                    
                    const paramCell = document.createElement('td');
                    const paramCode = document.createElement('code');
                    paramCode.textContent = param;
                    paramCell.appendChild(paramCode);
                    
                    const descCell = document.createElement('td');
                    
                    // Parse description for possible values and format them
                    if (desc.includes('Values:')) {
                        const parts = desc.split('Values:');
                        const basicDesc = document.createElement('div');
                        basicDesc.textContent = parts[0].trim();
                        descCell.appendChild(basicDesc);
                        
                        const valuesList = document.createElement('div');
                        valuesList.className = 'param-values';
                        valuesList.innerHTML = '<strong>Possible Values:</strong> ';
                        
                        const values = parts[1].trim().split(',').map(v => v.trim());
                        values.forEach((value, index) => {
                            const valueSpan = document.createElement('span');
                            valueSpan.className = 'param-value';
                            valueSpan.textContent = value;
                            valuesList.appendChild(valueSpan);
                            
                            if (index < values.length - 1) {
                                valuesList.appendChild(document.createTextNode(', '));
                            }
                        });
                        
                        descCell.appendChild(valuesList);
                    } 
                    // Parse for examples
                    else if (desc.includes('Example:')) {
                        const parts = desc.split('Example:');
                        const basicDesc = document.createElement('div');
                        basicDesc.textContent = parts[0].trim();
                        descCell.appendChild(basicDesc);
                        
                        const exampleDiv = document.createElement('div');
                        exampleDiv.className = 'param-example';
                        exampleDiv.innerHTML = '<strong>Example:</strong> ';
                        
                        const exampleCode = document.createElement('code');
                        exampleCode.textContent = parts[1].trim();
                        exampleDiv.appendChild(exampleCode);
                        
                        descCell.appendChild(exampleDiv);
                    }
                    // Parse for formats
                    else if (desc.includes('Format:')) {
                        const parts = desc.split('Format:');
                        const basicDesc = document.createElement('div');
                        basicDesc.textContent = parts[0].trim();
                        descCell.appendChild(basicDesc);
                        
                        const formatDiv = document.createElement('div');
                        formatDiv.className = 'param-format';
                        formatDiv.innerHTML = '<strong>Format:</strong> ';
                        
                        const formatCode = document.createElement('code');
                        formatCode.textContent = parts[1].trim();
                        formatDiv.appendChild(formatCode);
                        
                        descCell.appendChild(formatDiv);
                    }
                    else {
                        descCell.textContent = desc;
                    }
                    
                    row.appendChild(paramCell);
                    row.appendChild(descCell);
                    tbody.appendChild(row);
                });
                
                table.appendChild(tbody);
                
                // Add documentation tips
                const tipsContainer = document.createElement('div');
                tipsContainer.className = 'doc-tips';
                tipsContainer.innerHTML = `
                    <h4>Usage Tips</h4>
                    <ul>
                        <li>Comments in configuration files start with <code>#</code></li>
                        <li>Empty lines are ignored</li>
                        <li>Parameter names are case-sensitive</li>
                        <li>Create backups before making significant changes</li>
                    </ul>
                `;
                
                this.docsContainerEl.appendChild(table);
                this.docsContainerEl.appendChild(tipsContainer);
            } else {
                console.error('Failed to load documentation:', data.message);
            }
        } catch (error) {
            console.error(`Error loading documentation for ${filename}:`, error);
        }
    }

    /**
     * Format a date string to a more readable format
     * @param {string} dateString - ISO date string
     * @returns {string} Formatted date string
     */
    formatDate(dateString) {
        try {
            const date = new Date(dateString);
            return date.toLocaleString();
        } catch (e) {
            return dateString;
        }
    }

    /**
     * Save the current configuration file
     */
    async saveConfig() {
        if (!this.currentFile || !this.editor) {
            this.showAlert('No file is currently selected', 'error');
            return;
        }

        const content = this.editor.getValue();
        
        // Check if content has changed
        if (content === this.originalContent) {
            this.showAlert('No changes to save', 'info');
            return;
        }

        try {
            // Disable save button during save
            if (this.saveButtonEl) {
                this.saveButtonEl.disabled = true;
                this.saveButtonEl.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';
            }

            const response = await fetch(`/api/advanced/nut/config/${this.currentFile}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ content })
            });

            const data = await response.json();

            if (data.success) {
                this.showAlert(`${this.currentFile} saved successfully`, 'success');
                this.originalContent = content;
            } else {
                this.showAlert(`Failed to save ${this.currentFile}: ${data.message}`, 'error');
            }
        } catch (error) {
            console.error(`Error saving ${this.currentFile}:`, error);
            this.showAlert(`Error saving ${this.currentFile}: ${error.message}`, 'error');
        } finally {
            // Re-enable save button
            if (this.saveButtonEl) {
                this.saveButtonEl.disabled = false;
                this.saveButtonEl.innerHTML = '<i class="fas fa-save"></i> Save Configuration';
            }
        }
    }

    /**
     * Restart NUT services
     */
    async restartServices() {
        if (!confirm('Are you sure you want to restart NUT services? This may cause temporary interruption to monitoring.')) {
            return;
        }

        try {
            // Disable restart button
            if (this.restartButtonEl) {
                this.restartButtonEl.disabled = true;
                this.restartButtonEl.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Restarting...';
            }

            const response = await fetch('/api/advanced/nut/restart', {
                method: 'POST'
            });

            const data = await response.json();

            if (data.success) {
                this.showAlert('NUT services restarted successfully', 'success');
            } else {
                this.showAlert(`Failed to restart NUT services: ${data.message}`, 'error');
            }
        } catch (error) {
            console.error('Error restarting NUT services:', error);
            this.showAlert(`Error restarting NUT services: ${error.message}`, 'error');
        } finally {
            // Re-enable restart button
            if (this.restartButtonEl) {
                this.restartButtonEl.disabled = false;
                this.restartButtonEl.innerHTML = '<i class="fas fa-sync"></i> Save & Restart Services';
            }
        }
    }

    /**
     * Show an alert message
     * @param {string} message - Message to display
     * @param {string} type - Alert type (success, error, info, warning)
     */
    showAlert(message, type = 'info') {
        if (!this.alertContainerEl) return;

        // Create alert element
        const alertEl = document.createElement('div');
        alertEl.className = `alert alert-${type}`;
        alertEl.innerHTML = `
            <span class="alert-icon">
                <i class="fas fa-${type === 'success' ? 'check-circle' : type === 'error' ? 'exclamation-circle' : 'info-circle'}"></i>
            </span>
            <span class="alert-message">${message}</span>
            <button type="button" class="close-btn">
                <i class="fas fa-times"></i>
            </button>
        `;

        // Add close button functionality
        const closeBtn = alertEl.querySelector('.close-btn');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => {
                alertEl.remove();
            });
        }

        // Add alert to container
        this.alertContainerEl.appendChild(alertEl);

        // Auto-remove after 5 seconds
        setTimeout(() => {
            if (alertEl.parentNode === this.alertContainerEl) {
                alertEl.remove();
            }
        }, 5000);
    }

    /**
     * Clear the editor and reset state
     */
    clearEditor() {
        this.currentFile = null;
        this.originalContent = '';
        
        if (this.editor) {
            this.editor.setValue('');
        }
        
        if (this.docsContainerEl) {
            this.docsContainerEl.innerHTML = '';
        }
    }

    /**
     * Toggle collapse state of the configuration card
     */
    toggleCollapse() {
        const card = this.collapseHeaderEl.closest('.collapse-card');
        const content = this.collapseContentEl;
        
        if (content.classList.contains('collapsed')) {
            // Expand
            content.classList.remove('collapsed');
            card.classList.add('expanded');
        } else {
            // Collapse
            content.classList.add('collapsed');
            card.classList.remove('expanded');
        }
    }
}

// Initialize Advanced NUT Configuration Manager for the Advanced tab
function initializeAdvancedModule() {
    window.advancedConfigManager = new AdvancedNutConfigManager();
    window.advancedConfigManager.initialize();
    
    // Also initialize the polling thread module for the polling interval configuration
    if (typeof initializePollingThreadModule === 'function') {
        initializePollingThreadModule();
        if (window.webLogger) {
            window.webLogger.console('Polling thread module initialized from Advanced tab');
        }
    } else {
        if (window.webLogger) {
            window.webLogger.console('Warning: initializePollingThreadModule function not available');
        }
        
        // Try to load the polling module dynamically if not available
        const pollingScript = document.createElement('script');
        pollingScript.src = '/static/js/options/opt_polling.js';
        pollingScript.onload = function() {
            if (typeof initializePollingThreadModule === 'function') {
                initializePollingThreadModule();
                if (window.webLogger) {
                    window.webLogger.console('Polling thread module loaded and initialized dynamically');
                }
            }
        };
        document.head.appendChild(pollingScript);
    }
    
    if (window.webLogger) {
        window.webLogger.console('Advanced options module initialized');
    }
}

// Export to window object so it can be called from options_page.js
window.initializeAdvancedModule = initializeAdvancedModule; 