/* ================================
   SHARED JAVASCRIPT FOR ALL PAGES
   ================================ */

// ================================
// POPUP NOTIFICATION SYSTEM
// ================================

function showPopup(type, message, title, autoDismiss = 2000) {
    const container = document.getElementById('popup-container') || createPopupContainer();
    const popupId = `popup-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    const icons = {
        success: '✓',
        error: '✕',
        warning: '⚠',
        info: 'ℹ'
    };

    const defaultTitles = {
        success: 'Success',
        error: 'Error',
        warning: 'Warning',
        info: 'Information'
    };

    const popup = document.createElement('div');
    popup.id = popupId;
    popup.className = `popup-notification ${type}`;

    // Create icon container
    const iconDiv = document.createElement('div');
    iconDiv.className = 'popup-icon';
    iconDiv.textContent = icons[type] || 'ℹ';

    // Create content container
    const contentDiv = document.createElement('div');
    contentDiv.className = 'popup-content';

    // Create title safely
    const titleDiv = document.createElement('div');
    titleDiv.className = 'popup-title';
    titleDiv.textContent = title || defaultTitles[type];

    // Create message safely
    const messageDiv = document.createElement('div');
    messageDiv.className = 'popup-message';
    messageDiv.textContent = message;

    contentDiv.appendChild(titleDiv);
    contentDiv.appendChild(messageDiv);

    // Create close button safely
    const closeButton = document.createElement('button');
    closeButton.className = 'popup-close';
    closeButton.textContent = '✕';
    closeButton.addEventListener('click', () => dismissPopup(popupId));

    // Assemble popup
    popup.appendChild(iconDiv);
    popup.appendChild(contentDiv);
    popup.appendChild(closeButton);

    // Add progress bar if auto-dismiss
    if (autoDismiss) {
        const progressDiv = document.createElement('div');
        progressDiv.className = 'popup-progress';

        const progressBar = document.createElement('div');
        progressBar.className = 'popup-progress-bar';
        progressBar.style.animation = `shrink ${autoDismiss}ms linear forwards`;

        progressDiv.appendChild(progressBar);
        popup.appendChild(progressDiv);
    }

    container.appendChild(popup);

    // Auto-dismiss if specified
    if (autoDismiss) {
        setTimeout(() => {
            dismissPopup(popupId);
        }, autoDismiss);
    }

    return popupId;
}

function dismissPopup(popupId) {
    const popup = document.getElementById(popupId);
    if (popup) {
        popup.classList.add('removing');
        setTimeout(() => {
            if (popup.parentNode) {
                popup.parentNode.removeChild(popup);
            }
        }, 300);
    }
}

function createPopupContainer() {
    const container = document.createElement('div');
    container.id = 'popup-container';
    container.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        z-index: 9999;
        display: flex;
        flex-direction: column;
        gap: 10px;
        pointer-events: none;
    `;
    container.children.forEach = function(callback) {
        Array.prototype.forEach.call(this.children, callback);
    };
    document.body.appendChild(container);
    return container;
}

// Add CSS animation for progress bar
const style = document.createElement('style');
style.textContent = `
    @keyframes shrink {
        from { width: 100%; }
        to { width: 0%; }
    }
`;
document.head.appendChild(style);

// ================================
// PAGE DETECTION UTILITIES
// ================================

function getCurrentPage() {
    const path = window.location.pathname;
    const filename = path.split('/').pop() || 'index.html';

    if (filename === 'index.html' || filename === '') {
        return 'map';
    }

    return filename.replace('.html', '');
}

function isMapPage() {
    return getCurrentPage() === 'map';
}

// ================================
// NAVIGATION UTILITIES
// ================================

function initializeNavigation() {
    // Add active page styling to navigation
    const currentPage = getCurrentPage();
    const navLinks = document.querySelectorAll('[data-nav-page]');

    navLinks.forEach(link => {
        if (link.dataset.navPage === currentPage) {
            link.classList.add('active');
        }
    });
}

// ================================
// SHARED INITIALIZATION
// ================================

document.addEventListener('DOMContentLoaded', function() {
    // Initialize navigation for all pages
    initializeNavigation();

    // Initialize Feather icons if available
    if (typeof feather !== 'undefined') {
        feather.replace();
    }
});

// ================================
// UTILITY FUNCTIONS
// ================================

function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

function throttle(func, limit) {
    let inThrottle;
    return function() {
        const args = arguments;
        const context = this;
        if (!inThrottle) {
            func.apply(context, args);
            inThrottle = true;
            setTimeout(() => inThrottle = false, limit);
        }
    };
}