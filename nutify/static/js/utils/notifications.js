/**
 * Shows a notification to the user
 * 
 * window.notify('TEXT HERE.', 'info', 5000);
 * 
 * @param {string} message - The message to display
 * @param {string} type - The type of notification (info, success, error, warning)
 * @param {number|boolean} duration - How long the notification should remain visible in milliseconds (default: 5000)
 *                                  - If true is passed, use default 5000ms
 */
function notify(message, type = 'info', duration = 5000) {
    // Handle case where duration is a boolean (for backward compatibility)
    if (typeof duration === 'boolean') {
        duration = 5000; // Use default 5000ms if true is passed
    } else if (typeof duration === 'number') {
        // Force minimum duration of 5000ms
        duration = Math.max(duration, 5000);
    } else {
        // For any other type, use default
        duration = 5000;
    }
    
    // Log the notification duration for debugging
    console.log(`Creating notification with duration: ${duration}ms`);
    
    // Ensure CSS is loaded
    ensureNotificationsCssLoaded();
    
    // Create a notification element with the message and an icon
    const notification = document.createElement('div');
    
    // Apply notification styling
    notification.className = `notification notification-${type}`;
    
    // Add visibility class for entry animation
    notification.classList.add('notification-visible');
    
    // Add icon based on notification type
    let iconClass = 'fa-info-circle';
    if (type === 'success') {
        iconClass = 'fa-check-circle';
    } else if (type === 'error') {
        iconClass = 'fa-exclamation-circle';
    } else if (type === 'warning') {
        iconClass = 'fa-exclamation-triangle';
    }
    
    notification.innerHTML = `<i class="fas ${iconClass}"></i><span>${message}</span>`;
    
    // Get the notification container or create it if it doesn't exist
    let notificationContainer = document.getElementById('notification-container');
    if (!notificationContainer) {
        notificationContainer = document.createElement('div');
        notificationContainer.id = 'notification-container';
        document.body.appendChild(notificationContainer);
    }
    
    // Add the notification to the container as the first child (top position)
    notificationContainer.insertBefore(notification, notificationContainer.firstChild);
    
    // Set up removal after duration
    const timer = setTimeout(() => {
        // Log when the notification is being removed
        console.log(`Removing notification after ${duration}ms`);
        
        // Add exit class for animation
        notification.classList.add('notification-hidden');
        
        // Remove after animation completes
        const removeTimer = setTimeout(() => {
            if (notification && notification.parentNode) {
                notification.parentNode.removeChild(notification);
            }
            
            // If container is empty, remove it
            if (notificationContainer && notificationContainer.children.length === 0) {
                notificationContainer.remove();
            }
        }, 500); // 500ms to ensure animation completes
        
        // Store the removal timer on the notification element
        notification.removeTimer = removeTimer;
    }, duration);
    
    // Store the timer on the notification element
    notification.timer = timer;
    
    return notification;
}

// Make sure CSS for notifications is loaded
function ensureNotificationsCssLoaded() {
    // Check if the style has already been injected
    if (document.getElementById('notification-styles')) {
        return;
    }
    
    // Create the style element
    const style = document.createElement('style');
    style.id = 'notification-styles';
    
    // Add the CSS
    style.textContent = `
    /* Notification System Styles */
    #notification-container {
        position: fixed;
        right: 20px;
        bottom: 20px;
        z-index: 99999; /* Higher z-index to ensure visibility */
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        pointer-events: none;
        max-width: 350px;
        gap: 10px; /* Fixed gap between notifications */
    }

    .notification {
        padding: 12px 16px;
        border-radius: 6px;
        border-left: 4px solid;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
        display: flex;
        align-items: center;
        width: 100%;
        background-color: #2d3748;
        color: #e2e8f0;
        pointer-events: auto;
        position: relative;
        overflow: hidden;
        font-weight: 500;
        min-width: 300px;
        transform: translateX(100%);
        opacity: 0;
        transition: transform 0.5s ease-out, opacity 0.5s ease-out;
    }
    
    .notification-visible {
        transform: translateX(0);
        opacity: 1;
    }
    
    .notification-hidden {
        transform: translateX(100%);
        opacity: 0;
        transition: transform 0.5s ease-in, opacity 0.5s ease-in;
    }

    /* Notification types */
    .notification-success {
        background-color: #065f46;
        color: #ecfdf5;
        border-left-color: #34d399;
    }

    .notification-error {
        background-color: #991b1b;
        color: #fee2e2;
        border-left-color: #f87171;
    }

    .notification-warning {
        background-color: #92400e;
        color: #fef3c7;
        border-left-color: #fbbf24;
    }

    .notification-info {
        background-color: #1e40af;
        color: #e0f2fe;
        border-left-color: #38bdf8;
    }

    /* Icon styling */
    .notification i {
        margin-right: 10px;
        font-size: 18px;
    }

    .notification-success i {
        color: #34d399;
    }

    .notification-error i {
        color: #f87171;
    }

    .notification-warning i {
        color: #fbbf24;
    }

    .notification-info i {
        color: #38bdf8;
    }

    /* Dark theme modifications */
    :root[data-theme="dark"] .notification {
        background: #2a3444;
        color: #e2e8f0;
    }

    /* Light theme modifications */
    :root[data-theme="light"] .notification {
        background: #f1f5f9;
        color: #334155;
    }
    
    :root[data-theme="light"] .notification-info {
        border-left-color: #0284c7;
    }
    
    :root[data-theme="light"] .notification-info i {
        color: #0284c7;
    }`;
    
    // Add the style to the head
    document.head.appendChild(style);
}

// Inject CSS when script loads
ensureNotificationsCssLoaded();

// Make the function globally available
window.notify = notify; 