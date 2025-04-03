// Database Management Module

// Load database statistics
async function loadDatabaseStats() {
    try {
        const response = await fetch('/api/database/stats');
        const data = await response.json();
        
        if (data.success) {
            // Update general statistics
            document.getElementById('dbSize').textContent = formatBytes(data.data.size);
            document.getElementById('totalRecords').textContent = data.data.total_records.toLocaleString();
            document.getElementById('lastWrite').textContent = data.data.last_write ? 
                new Date(data.data.last_write).toLocaleString() : 'Never';
            
            // Update table information
            const tablesInfo = document.getElementById('tablesInfo');
            tablesInfo.innerHTML = '';
            
            for (const [tableName, tableData] of Object.entries(data.data.tables)) {
                const tableCard = document.createElement('div');
                tableCard.className = 'table_info_card';
                
                const lastWrite = tableData.last_write ? 
                    new Date(tableData.last_write).toLocaleString() : 'Never';
                
                tableCard.innerHTML = `
                    <div class="table_info_header">
                        <i class="fas fa-table"></i>
                        <h4>${tableName}</h4>
                    </div>
                    <div class="table_info_stats">
                        <div class="table_info_stat">
                            <div class="table_info_stat_label">Records</div>
                            <div class="table_info_stat_value">${tableData.record_count.toLocaleString()}</div>
                        </div>
                        <div class="table_info_stat">
                            <div class="table_info_stat_label">Last Write</div>
                            <div class="table_info_stat_value">${lastWrite}</div>
                        </div>
                    </div>
                `;
                
                tablesInfo.appendChild(tableCard);
            }
        }
    } catch (error) {
        console.error('Error loading database statistics:', error);
        showAlert('databaseStatus', 'Error loading database statistics', 'danger');
    }
}

// Function to show alerts in the database section
function showDatabaseAlert(message, type = 'success', skipNotify = false) {
    // Use the window.notify function ONLY, avoid duplicate notifications
    if (typeof window.notify === 'function' && !skipNotify) {
        window.notify(message, type === 'danger' ? 'error' : type, 5000);
    }
}

// Initialize database module
function initializeDatabaseModule() {
    // Load stats immediately
    loadDatabaseStats();
    
    // Backup database listener
    const backupDbBtn = document.getElementById('backupDbBtn');
    if (backupDbBtn) {
        backupDbBtn.addEventListener('click', async () => {
            const button = document.getElementById('backupDbBtn');
            const originalContent = button.innerHTML;
            try {
                button.disabled = true;
                button.innerHTML = `<span class="button-loader"><i class="fas fa-spinner fa-spin"></i> Preparing Backup...</span>`;
                const response = await fetch('/api/database/backup', { method: 'GET' });
                if(response.ok) {
                    const blob = await response.blob();
                    const url = window.URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = 'database_backup.db';
                    document.body.appendChild(a);
                    a.click();
                    a.remove();
                    window.URL.revokeObjectURL(url);
                    showAlert('databaseStatus', 'Backup downloaded successfully', 'success', true);
                } else {
                    const data = await response.json();
                    showAlert('databaseStatus', 'Error downloading backup: ' + data.message, 'danger', true);
                }
            } catch (error) {
                console.error('Error downloading backup:', error);
                showAlert('databaseStatus', 'Error downloading backup', 'danger', true);
            } finally {
                button.disabled = false;
                button.innerHTML = originalContent;
            }
        });
    }

    // Listener for "Optimize Database"
    const optimizeDbBtn = document.getElementById('optimizeDbBtn');
    if (optimizeDbBtn) {
        // Add processing flag
        optimizeDbBtn.dataset.processing = 'false';
        
        optimizeDbBtn.addEventListener('click', async () => {
            // Skip if already processing
            if (optimizeDbBtn.dataset.processing === 'true') {
                return;
            }
            
            const button = document.getElementById('optimizeDbBtn');
            const originalContent = button.innerHTML;
            try {
                // Set processing flag
                optimizeDbBtn.dataset.processing = 'true';
                
                button.disabled = true;
                button.innerHTML = `<span class="button-loader"><i class="fas fa-spinner fa-spin"></i> Optimizing...</span>`;
                const response = await fetch('/api/database/optimize', { 
                    method: 'POST',
                    headers: { "Content-Type": "application/json" },
                    body: "{}"
                });
                const data = await response.json();
                if(data.success){
                    showDatabaseAlert('Database optimized successfully', 'success');
                    await loadDatabaseStats();
                } else {
                    showDatabaseAlert('Error optimizing database: ' + data.message, 'danger');
                }
            } catch (error) {
                console.error('Error optimizing database:', error);
                showDatabaseAlert('Error optimizing database', 'danger');
            } finally {
                // Reset processing flag and button state
                optimizeDbBtn.dataset.processing = 'false';
                button.disabled = false;
                button.innerHTML = originalContent;
            }
        });
    }

    // Listener for "Vacuum Database"
    const vacuumDbBtn = document.getElementById('vacuumDbBtn');
    if (vacuumDbBtn) {
        // Add processing flag
        vacuumDbBtn.dataset.processing = 'false';
        
        vacuumDbBtn.addEventListener('click', async () => {
            // Skip if already processing
            if (vacuumDbBtn.dataset.processing === 'true') {
                return;
            }
            
            const button = document.getElementById('vacuumDbBtn');
            const originalContent = button.innerHTML;
            try {
                // Set processing flag
                vacuumDbBtn.dataset.processing = 'true';
                
                button.disabled = true;
                button.innerHTML = `<span class="button-loader"><i class="fas fa-spinner fa-spin"></i> Vacuuming...</span>`;
                const response = await fetch('/api/database/vacuum', { 
                    method: 'POST',
                    headers: { "Content-Type": "application/json" },
                    body: "{}"
                });
                const data = await response.json();
                if(data.success){
                    showDatabaseAlert('Database vacuumed successfully', 'success');
                    await loadDatabaseStats();
                } else {
                    showDatabaseAlert('Error vacuuming database: ' + data.message, 'danger');
                }
            } catch (error) {
                console.error('Error vacuuming database:', error);
                showDatabaseAlert('Error vacuuming database', 'danger');
            } finally {
                // Reset processing flag and button state
                vacuumDbBtn.dataset.processing = 'false';
                button.disabled = false;
                button.innerHTML = originalContent;
            }
        });
    }
}

// Export functions for use in the main options page
window.loadDatabaseStats = loadDatabaseStats;
window.showDatabaseAlert = showDatabaseAlert;
window.initializeDatabaseModule = initializeDatabaseModule; 