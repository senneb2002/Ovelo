// Settings Page JavaScript

// Load user settings on page load
async function loadSettings() {
    try {
        const response = await fetch('/api/get_profile');
        if (response.ok) {
            const settings = await response.json();

            // Populate form fields
            if (settings.name) {
                document.getElementById('user-name').value = settings.name;
            }
            if (settings.email) {
                document.getElementById('user-email').textContent = settings.email;
            }
            if (settings.language) {
                document.getElementById('language-select').value = settings.language;
            }
            if (settings.timezone) {
                document.getElementById('timezone-select').value = settings.timezone;
            }

            // Set toggle states
            if (settings.notifications) {
                document.getElementById('focus-reminders').checked = settings.notifications.focusReminders !== false;
                document.getElementById('daily-summary').checked = settings.notifications.dailySummary !== false;
            }
            if (settings.privacy) {
                document.getElementById('data-collection').checked = settings.privacy.dataCollection !== false;
            }
            if (settings.reflectionPersona) {
                document.getElementById('persona-select').value = settings.reflectionPersona;
            }
        }
    } catch (error) {
        console.error('Error loading settings:', error);
    }
}

// Update user name
async function updateName() {
    const name = document.getElementById('user-name').value.trim();
    if (!name) {
        showNotification('Please enter a valid name', 'error');
        return;
    }

    try {
        const response = await fetch('/api/update_profile', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name })
        });

        if (response.ok) {
            showNotification('Name updated successfully!', 'success');
        } else {
            showNotification('Failed to update name', 'error');
        }
    } catch (error) {
        console.error('Error updating name:', error);
        showNotification('Error updating name', 'error');
    }
}

// Update language
async function updateLanguage() {
    const language = document.getElementById('language-select').value;

    try {
        const response = await fetch('/api/update_settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ language })
        });

        if (response.ok) {
            showNotification('Language updated successfully!', 'success');
            // In a real app, you would reload the page with new language
            // window.location.reload();
        } else {
            showNotification('Failed to update language', 'error');
        }
    } catch (error) {
        console.error('Error updating language:', error);
        showNotification('Error updating language', 'error');
    }
}

// Update timezone
async function updateTimezone() {
    const timezone = document.getElementById('timezone-select').value;

    try {
        const response = await fetch('/api/update_settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ timezone })
        });

        if (response.ok) {
            showNotification('Timezone updated successfully!', 'success');
        } else {
            showNotification('Failed to update timezone', 'error');
        }
    } catch (error) {
        console.error('Error updating timezone:', error);
        showNotification('Error updating timezone', 'error');
    }
}

// Update persona
async function updatePersona() {
    const persona = document.getElementById('persona-select').value;

    try {
        const response = await fetch('/api/save_profile', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ reflectionPersona: persona })
        });

        if (response.ok) {
            showNotification('Persona updated successfully!', 'success');
        } else {
            showNotification('Failed to update persona', 'error');
        }
    } catch (error) {
        console.error('Error updating persona:', error);
        showNotification('Error updating persona', 'error');
    }
}

// Manage payments (Stripe integration placeholder)
function managePayments() {
    showNotification('Stripe payment integration coming soon!', 'info');
    // In production, this would redirect to Stripe Customer Portal:
    // window.location.href = '/api/create_stripe_portal_session';
}

// View billing history
function viewBillingHistory() {
    showNotification('Billing history coming soon!', 'info');
    // In production, this would show a modal or redirect to billing page
}

// Export user data
async function exportData() {
    try {
        showNotification('Preparing your data export...', 'info');
        const response = await fetch('/api/export_data');

        if (response.ok) {
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `ovelo_data_export_${new Date().toISOString().split('T')[0]}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            window.URL.revokeObjectURL(url);
            showNotification('Data exported successfully!', 'success');
        } else {
            showNotification('Failed to export data', 'error');
        }
    } catch (error) {
        console.error('Error exporting data:', error);
        showNotification('Error exporting data', 'error');
    }
}

// Delete database
async function deleteDatabase() {
    const confirmed = confirm(
        '⚠️ Are you sure you want to delete your database?\n\n' +
        'This will permanently remove all your tracked activity history.\n' +
        'This action cannot be undone.'
    );

    if (!confirmed) return;

    try {
        const response = await fetch('/api/delete_database', {
            method: 'POST'
        });

        if (response.ok) {
            showNotification('Database deleted successfully', 'success');
        } else {
            showNotification('Failed to delete database', 'error');
        }
    } catch (error) {
        console.error('Error deleting database:', error);
        showNotification('Error deleting database', 'error');
    }
}

// Reset account
async function resetAccount() {
    const confirmed = confirm(
        'Are you sure you want to reset your account?\n\n' +
        'This will delete all your focus data and history, but keep your account.\n' +
        'This action cannot be undone.'
    );

    if (!confirmed) return;

    const doubleConfirm = confirm('This is your last chance. Are you absolutely sure?');
    if (!doubleConfirm) return;

    try {
        const response = await fetch('/api/reset_account', {
            method: 'POST'
        });

        if (response.ok) {
            showNotification('Account reset successfully', 'success');
            setTimeout(() => {
                window.location.href = 'onboarding.html';
            }, 2000);
        } else {
            showNotification('Failed to reset account', 'error');
        }
    } catch (error) {
        console.error('Error resetting account:', error);
        showNotification('Error resetting account', 'error');
    }
}

// Logout
async function logout() {
    try {
        await fetch('/api/logout', { method: 'POST' });
        window.location.href = 'index.html';
    } catch (error) {
        console.error('Error logging out:', error);
        showNotification('Error logging out', 'error');
    }
}

// Delete account
async function deleteAccount() {
    const confirmed = confirm(
        '⚠️ WARNING: DELETE ACCOUNT ⚠️\n\n' +
        'This will PERMANENTLY delete your account and ALL data.\n' +
        'This action CANNOT be undone.\n\n' +
        'Are you absolutely sure?'
    );

    if (!confirmed) return;

    const verification = prompt(
        'To confirm deletion, please type "DELETE MY ACCOUNT" exactly:'
    );

    if (verification !== 'DELETE MY ACCOUNT') {
        showNotification('Account deletion cancelled', 'info');
        return;
    }

    try {
        const response = await fetch('/api/delete_account', {
            method: 'DELETE'
        });

        if (response.ok) {
            showNotification('Account deleted. Goodbye.', 'success');
            setTimeout(() => {
                window.location.href = '/';
            }, 2000);
        } else {
            showNotification('Failed to delete account', 'error');
        }
    } catch (error) {
        console.error('Error deleting account:', error);
        showNotification('Error deleting account', 'error');
    }
}

// Show notification (toast)
function showNotification(message, type = 'info') {
    // Remove existing notification if any
    const existing = document.querySelector('.notification-toast');
    if (existing) existing.remove();

    const notification = document.createElement('div');
    notification.className = `notification-toast notification-${type}`;
    notification.textContent = message;

    const colors = {
        success: 'linear-gradient(135deg, #14B8A6, #10B981)',
        error: 'linear-gradient(135deg, #EF4444, #DC2626)',
        warning: 'linear-gradient(135deg, #F59E0B, #D97706)',
        info: 'linear-gradient(135deg, #818CF8, #6366F1)'
    };

    notification.style.cssText = `
        position: fixed;
        top: 2rem;
        right: 2rem;
        background: ${colors[type]};
        color: white;
        padding: 1rem 1.5rem;
        border-radius: 12px;
        box-shadow: 0 8px 20px rgba(0, 0, 0, 0.3);
        z-index: 1000;
        font-family: var(--font-ui);
        font-size: 0.875rem;
        font-weight: 500;
        animation: slideIn 0.3s ease;
    `;

    document.body.appendChild(notification);

    setTimeout(() => {
        notification.style.animation = 'slideOut 0.3s ease';
        setTimeout(() => notification.remove(), 300);
    }, 3000);
}

// Add animation styles
const style = document.createElement('style');
style.textContent = `
    @keyframes slideIn {
        from {
            transform: translateX(400px);
            opacity: 0;
        }
        to {
            transform: translateX(0);
            opacity: 1;
        }
    }

    @keyframes slideOut {
        from {
            transform: translateX(0);
            opacity: 1;
        }
        to {
            transform: translateX(400px);
            opacity: 0;
        }
    }
`;
document.head.appendChild(style);

// Initialize settings on page load
window.addEventListener('load', loadSettings);

// Auto-save toggle switches
document.addEventListener('DOMContentLoaded', () => {
    const toggles = document.querySelectorAll('.toggle-switch input');
    toggles.forEach(toggle => {
        toggle.addEventListener('change', async (e) => {
            const setting = e.target.id;
            const value = e.target.checked;

            try {
                await fetch('/api/update_settings', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ [setting]: value })
                });
                showNotification('Setting updated', 'success');
            } catch (error) {
                console.error('Error updating setting:', error);
                showNotification('Failed to update setting', 'error');
                e.target.checked = !value; // Revert on error
            }
        });
    });
});
