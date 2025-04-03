// Log Management Module

// Global variables for log pagination
let currentLogPage = 1;
let hasMoreLogs = false;
let isLoadingLogs = false;
let logsLoaded = false; // Flag to track if logs have been loaded
let currentLogFilters = {
    type: 'all',
    level: 'all',
    range: 'all'
};

// Show log alert using window.notify without duplicates
function showLogAlert(message, type) {
    if (typeof window.notify === 'function') {
        window.notify(message, type === 'danger' ? 'error' : type, 5000);
    } else {
        console.log(`Log alert: ${message} (${type})`);
    }
}

// Load logs with pagination support
async function loadLogs(resetPage = true) {
    if (isLoadingLogs) return;
    
    const button = document.getElementById('refreshLogsBtn');
    if (!button) return; // Exit if button doesn't exist (tab not visible)
    
    const originalContent = button.innerHTML;
    const preview = document.getElementById('logPreview');
    if (!preview) return; // Exit if preview doesn't exist
    
    try {
        isLoadingLogs = true;
        button.disabled = true;
        button.innerHTML = `<span class="button-loader"><i class="fas fa-spinner fa-spin"></i> Loading logs...</span>`;
        
        // Get the values of the filters
        const logType = document.getElementById('logType')?.value || 'all';
        const logLevel = document.getElementById('logLevel')?.value || 'all';
        const dateRange = document.getElementById('dateRange')?.value || 'all';
        
        // Update the current filters
        currentLogFilters = {
            type: logType,
            level: logLevel,
            range: dateRange
        };
        
        // Reset the page if requested (e.g. when filters change)
        if (resetPage) {
            currentLogPage = 1;
            preview.innerHTML = ''; // Clear the previous content
        }
        
        // Call the API endpoint to get the logs, encoding the parameters
        const response = await fetch(
            `/api/logs?type=${encodeURIComponent(logType)}&level=${encodeURIComponent(logLevel)}&range=${encodeURIComponent(dateRange)}&page=${currentLogPage}&page_size=1000`
        );
        const data = await response.json();
        
        if (data.success && data.data) {
            // Set the flag indicating logs have been loaded
            logsLoaded = true;
            
            const logData = data.data;
            
            // Update the pagination state
            hasMoreLogs = logData.has_more;
            
            // If it's the first page, show the file information
            if (currentLogPage === 1) {
                const logCount = document.getElementById('logCount');
                if (logCount) {
                    logCount.textContent = `Found ${logData.total_files} log files (${formatBytes(logData.total_size)})`;
                }
            }
            
            // Add the new lines to the existing content
            if (Array.isArray(logData.lines) && logData.lines.length > 0) {
                const newContent = logData.lines.map(formatLogEntry).join('');
                
                if (resetPage) {
                    preview.innerHTML = newContent;
                } else {
                    preview.innerHTML += newContent;
                }
                
                // Apply only essential styles directly to the container
                Object.assign(preview.style, {
                    maxHeight: '600px',
                    overflowY: 'auto',
                    borderRadius: '4px',
                    padding: '8px',
                    fontSize: '0.85rem',
                    lineHeight: '1.1',
                    fontFamily: "'Consolas', 'Monaco', 'Courier New', monospace"
                });
                
                // Add an "Load more" indicator if there are other pages
                if (hasMoreLogs) {
                    preview.innerHTML += `
                    <div id="loadMoreLogs" class="load-more-logs">
                        <button type="button">
                            <i class="fas fa-arrow-down"></i> Load More Logs
                        </button>
                    </div>`;
                    
                    // Add event listener to the "Load more" button
                    document.getElementById('loadMoreLogs')?.addEventListener('click', () => {
                        // Remove the "Load more" button
                        document.getElementById('loadMoreLogs')?.remove();
                        // Load the next page
                        currentLogPage++;
                        loadLogs(false);
                    });
                }
            } else if (currentLogPage === 1) {
                preview.textContent = 'No logs found for selected filters';
            }
            
            // Add event listener for infinite scrolling
            if (hasMoreLogs) {
                const handleScroll = () => {
                    const scrollPosition = preview.scrollTop + preview.clientHeight;
                    const scrollHeight = preview.scrollHeight;
                    
                    // If we are near the bottom and not already loading, load more logs
                    if (scrollHeight - scrollPosition < 200 && hasMoreLogs && !isLoadingLogs) {
                        // Remove the "Load more" button if it exists
                        const loadMoreBtn = document.getElementById('loadMoreLogs');
                        if (loadMoreBtn) {
                            loadMoreBtn.remove();
                        }
                        
                        // Load the next page
                        currentLogPage++;
                        loadLogs(false);
                    }
                };
                
                // Remove the previous event listener if it exists
                preview.removeEventListener('scroll', handleScroll);
                // Add the new event listener
                preview.addEventListener('scroll', handleScroll);
            }
        } else {
            if (currentLogPage === 1) {
                preview.textContent = 'No logs found for selected filters';
                
                // Update the log count
                const logCount = document.getElementById('logCount');
                if (logCount) {
                    logCount.textContent = 'Found 0 log files';
                }
            }
        }
    } catch (error) {
        console.error('Error loading logs:', error);
        showLogAlert('Error loading logs', 'danger');
        
        if (currentLogPage === 1) {
            preview.textContent = 'Error loading logs. Please try again.';
        }
    } finally {
        isLoadingLogs = false;
        button.disabled = false;
        button.innerHTML = originalContent;
    }
}

// Improve the log formatting
function formatLogEntry(log) {
    // Get the CSS class based on the log level
    let levelClass = '';
    
    // Search for the log level in the content
    const levelMatch = log.content.match(/\[(DEBUG|INFO|WARNING|ERROR)\]/i);
    if (levelMatch) {
        levelClass = `log-${levelMatch[1].toLowerCase()}`;
    } else if (log.level) {
        levelClass = `log-${log.level.toLowerCase()}`;
    }
    
    // Extract the timestamp from the log content, if present
    let timestamp = '';
    let content = log.content;
    
    // Search for a timestamp in the ISO format or similar at the beginning of the line
    const timestampMatch = log.content.match(/^(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:[Z+-]\d{2}:?\d{2})?)/);
    if (timestampMatch) {
        timestamp = timestampMatch[1];
        content = log.content.substring(timestamp.length).trim();
    }
    
    // Format the log line with the appropriate CSS class
    return `<div class="log-line ${levelClass}">
        <span class="log-file">${log.file}</span>
        <span class="log-number">#${log.line_number}</span>
        ${timestamp ? `<span class="log-timestamp">${timestamp}</span>` : ''}
        <span class="log-content">${content}</span>
    </div>`;
}

function getLevelClass(level) {
    const levels = {
        'DEBUG': 'debug',
        'INFO': 'info',
        'WARNING': 'warning',
        'ERROR': 'error'
    };
    return levels[level] || 'info';
}

// Handler for download logs button
async function handleDownloadLogs() {
    const button = document.getElementById('downloadLogsBtn');
    const originalContent = button.innerHTML;
    
    try {
        button.disabled = true;
        button.innerHTML = `<span class="button-loader"><i class="fas fa-spinner fa-spin"></i> Downloading...</span>`;
        
        const logType = document.getElementById('logType').value;
        const logLevel = document.getElementById('logLevel').value;
        const dateRange = document.getElementById('dateRange').value;
        
        const response = await fetch(`/api/logs/download?type=${logType}&level=${logLevel}&range=${dateRange}`);
        
        if (response.ok) {
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `logs_${new Date().toISOString()}.zip`;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            
            showLogAlert('Logs downloaded successfully', 'success');
        } else {
            showLogAlert('Error downloading logs', 'danger');
        }
    } catch (error) {
        console.error('Error downloading logs:', error);
        showLogAlert('Error downloading logs', 'danger');
    } finally {
        button.disabled = false;
        button.innerHTML = originalContent;
    }
}

// Handler for clear logs button
async function handleClearLogs() {
    const button = document.getElementById('clearLogsBtn');
    const originalContent = button.innerHTML;
    
    try {
        button.disabled = true;
        button.innerHTML = `<span class="button-loader"><i class="fas fa-spinner fa-spin"></i> Clearing...</span>`;
        
        // Get the selected log type from the filter
        const logType = document.getElementById('logType').value;
        
        // Request the server to clear the logs
        const response = await fetch(`/api/logs/clear?type=${logType}`, { 
            method: 'POST',
            headers: { "Content-Type": "application/json" },
            body: "{}"
        });
        
        const data = await response.json();
        if (data.success) {
            showLogAlert(data.message, 'success');
            // Reload the logs after the deletion
            loadLogs();
        } else {
            showLogAlert('Error clearing logs: ' + data.message, 'danger');
        }
    } catch (error) {
        console.error('Error clearing logs:', error);
        showLogAlert('Error clearing logs', 'danger');
    } finally {
        button.disabled = false;
        button.innerHTML = originalContent;
    }
}

// Initialize logs module
function initializeLogsModule() {
    console.log('Initializing logs module');
    
    // Add a listener to the Refresh button that invokes the loadLogs function
    const refreshLogsBtn = document.getElementById('refreshLogsBtn');
    if (refreshLogsBtn) {
        refreshLogsBtn.addEventListener('click', () => loadLogs());
    }

    // Log Filter Events
    const logTypeSelect = document.getElementById('logType');
    if (logTypeSelect) {
        logTypeSelect.addEventListener('change', () => loadLogs());
    }
    
    const logLevelSelect = document.getElementById('logLevel');
    if (logLevelSelect) {
        logLevelSelect.addEventListener('change', () => loadLogs());
    }
    
    const dateRangeSelect = document.getElementById('dateRange');
    if (dateRangeSelect) {
        dateRangeSelect.addEventListener('change', () => loadLogs());
    }

    // Download logs button - prevent duplicate event listeners
    const downloadLogsBtn = document.getElementById('downloadLogsBtn');
    if (downloadLogsBtn) {
        // Remove all existing event listeners by cloning the node
        const newDownloadBtn = downloadLogsBtn.cloneNode(true);
        downloadLogsBtn.parentNode.replaceChild(newDownloadBtn, downloadLogsBtn);
        
        // Add our event listener to the new button
        newDownloadBtn.addEventListener('click', handleDownloadLogs);
    }

    // Clear logs button - prevent duplicate event listeners
    const clearLogsBtn = document.getElementById('clearLogsBtn');
    if (clearLogsBtn) {
        // Remove all existing event listeners by cloning the node
        const newClearBtn = clearLogsBtn.cloneNode(true);
        clearLogsBtn.parentNode.replaceChild(newClearBtn, clearLogsBtn);
        
        // Add our event listener to the new button
        newClearBtn.addEventListener('click', handleClearLogs);
    }
    
    // Load logs automatically when the module is initialized
    // Use setTimeout to ensure this runs after all the DOM elements are fully loaded
    setTimeout(() => {
        // Only load logs if we're on the Log tab and logs haven't been loaded yet
        const logTab = document.getElementById('Log_tab');
        if (logTab && !logTab.classList.contains('hidden') && !logsLoaded) {
            console.log('Automatically loading logs on initialization');
            loadLogs();
        }
    }, 100);
}

// Export functions for use in the main options page
window.loadLogs = loadLogs;
window.formatLogEntry = formatLogEntry;
window.getLevelClass = getLevelClass;
window.initializeLogsModule = initializeLogsModule; 