if (!window.webLogger) {
    class WebLogger {
        constructor() {
            this.enabled = false;  // Default to disabled
            this.logLevel = 'info';  // Default level
            
            // Store original console methods before overriding
            this.originalConsole = {
                log: console.log,
                error: console.error,
                warn: console.warn,
                info: console.info,
                debug: console.debug,
                group: console.group,
                groupEnd: console.groupEnd
            };
            
            // Load saved preferences (must be done before overriding methods)
            this.loadPreferences();
            
            // Override console methods to respect logger enabled state
            this.overrideConsoleMethods();
            
            // Styles for different log types
            this.styles = {
                page: 'color: #2563eb; font-weight: bold;',        // Blue
                data: 'color: #059669; font-weight: bold;',        // Green
                chart: 'color: #7c3aed; font-weight: bold;',       // Purple
                widget: 'color: #db2777; font-weight: bold;',      // Pink
                event: 'color: #ea580c; font-weight: bold;',       // Orange
                error: 'color: #dc2626; font-weight: bold;',       // Red
                warning: 'color: #d97706; font-weight: bold;',     // Yellow
                scheduler: 'color: #6b7280; font-weight: bold;'   // Gray for Scheduler
            };
            
            // Set global window flag to match current state (important for page consistency)
            window.GLOBAL_JS_LOGGING_ENABLED = this.enabled;
            
            // Log initialization state if enabled
            if (this.enabled) {
                this.page('WebLogger initialized with logging enabled', {
                    logLevel: this.logLevel,
                    source: 'localStorage: ' + localStorage.getItem('webLogger.enabled'),
                    sessionSource: 'sessionStorage: ' + sessionStorage.getItem('GLOBAL_JS_LOGGING_ENABLED')
                });
            }
        }

        // Load preferences from localStorage and sessionStorage
        loadPreferences() {
            // Priority order:
            // 1. sessionStorage (for session-wide consistency)
            // 2. localStorage (for persistent preference)
            // 3. Default to disabled if neither is set
            
            const sessionValue = sessionStorage.getItem('GLOBAL_JS_LOGGING_ENABLED');
            const localValue = localStorage.getItem('webLogger.enabled');
            
            // If we have a session value, use that as the primary source of truth
            if (sessionValue !== null) {
                this.enabled = sessionValue === 'true';
                
                // Synchronize localStorage with sessionStorage to ensure consistency
                localStorage.setItem('webLogger.enabled', this.enabled);
            } 
            // Otherwise fall back to localStorage
            else if (localValue !== null) {
                this.enabled = localValue === 'true';
                
                // Set sessionStorage to match localStorage
                sessionStorage.setItem('GLOBAL_JS_LOGGING_ENABLED', this.enabled);
            } 
            // If neither exists, use default (disabled) and initialize both storages
            else {
                this.enabled = false;
                localStorage.setItem('webLogger.enabled', 'false');
                sessionStorage.setItem('GLOBAL_JS_LOGGING_ENABLED', 'false');
            }
            
            // Load log level (or use default)
            this.logLevel = localStorage.getItem('webLogger.level') || 'info';
        }

        // Enable/Disable logging
        enable(status = true) {
            // Convert to boolean to ensure consistent type
            status = Boolean(status);
            
            // Update internal state
            this.enabled = status;
            
            // Synchronize both storage mechanisms
            localStorage.setItem('webLogger.enabled', status);
            sessionStorage.setItem('GLOBAL_JS_LOGGING_ENABLED', status);
            
            // Update global flag to ensure all JS respects this setting
            window.GLOBAL_JS_LOGGING_ENABLED = status;
            
            // Log state change if enabling (can't log if we're disabling)
            if (status) {
                this.page('Logging enabled', { level: this.logLevel });
            }
        }

        // Set logging level
        setLevel(level) {
            this.logLevel = level;
            localStorage.setItem('webLogger.level', level);
            if (this.enabled) {
                this.page('Log level changed', { level: level });
            }
        }
        
        // Override console methods to respect logger enabled state
        overrideConsoleMethods() {
            const self = this;
            
            // Override console.log
            console.log = function() {
                // Only execute if logging is enabled
                if (self.enabled) {
                    self.originalConsole.log.apply(console, arguments);
                }
            };
            
            // Override console.error
            console.error = function() {
                // Only execute if logging is enabled
                if (self.enabled) {
                    self.originalConsole.error.apply(console, arguments);
                }
            };
            
            // Override console.warn
            console.warn = function() {
                // Only execute if logging is enabled
                if (self.enabled) {
                    self.originalConsole.warn.apply(console, arguments);
                }
            };
            
            // Override console.info
            console.info = function() {
                // Only execute if logging is enabled
                if (self.enabled) {
                    self.originalConsole.info.apply(console, arguments);
                }
            };
            
            // Override console.debug
            console.debug = function() {
                // Only execute if logging is enabled
                if (self.enabled) {
                    self.originalConsole.debug.apply(console, arguments);
                }
            };
        }

        // Check if logging is enabled
        isEnabled() {
            return this.enabled;
        }

        // Logging methods for different contexts
        page(message, data = null) {
            this._log('page', '📄 Page', message, data);
        }

        data(message, data = null) {
            this._log('data', '📊 Data', message, data);
        }

        chart(message, data = null) {
            this._log('chart', '📈 Chart', message, data);
        }

        widget(message, data = null) {
            this._log('widget', '🔧 Widget', message, data);
        }

        event(message, data = null) {
            this._log('event', '🔔 Event', message, data);
        }

        error(message, error = null) {
            this._log('error', '❌ Error', message, error, true);
        }

        warning(message, data = null) {
            this._log('warning', '⚠️ Warning', message, data);
        }
        console(message, data = null) {
            this._log('console', '💬 Console', message, data);
        }

        // Internal method for logging
        _log(type, prefix, message, data = null, isError = false) {
            if (!this.enabled) return;

            const timestamp = new Date().toLocaleTimeString();
            const style = this.styles[type];

            if (isError) {
                this.originalConsole.group.call(console, `%c[${timestamp}] ${prefix}: ${message}`, style);
                if (data) this.originalConsole.error.call(console, data);
                this.originalConsole.groupEnd.call(console);
            } else {
                this.originalConsole.group.call(console, `%c[${timestamp}] ${prefix}: ${message}`, style);
                if (data) this.originalConsole.log.call(console, data);
                this.originalConsole.groupEnd.call(console);
            }
        }

        // Method to print page statistics
        pageStats(stats) {
            if (!this.enabled) return;
            
            this.originalConsole.group.call(console, '%c📊 Page Statistics', 'color: #2563eb; font-weight: bold;');
            Object.entries(stats).forEach(([key, value]) => {
                this.originalConsole.log.call(console, `%c${key}: `, 'color: #4b5563', value);
            });
            this.originalConsole.groupEnd.call(console);
        }
    }
    window.webLogger = new WebLogger();
} 