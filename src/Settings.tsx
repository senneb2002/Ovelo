import { useState, useEffect } from 'react';
import { invoke } from "@tauri-apps/api/core";
import { Link, useNavigate } from 'react-router-dom';
import { registerDevice, createCheckoutSession, createPortalSession } from './services/api';
import { openUrl } from '@tauri-apps/plugin-opener';
import { isEnabled, enable, disable } from '@tauri-apps/plugin-autostart';
import "./App.css";

function Settings() {
    const navigate = useNavigate();
    const [settings, setSettings] = useState<any>({
        name: '',
        email: '',
        language: 'en',
        timezone: 'auto',
        clockFormat: '12h',
        notifications: { focusReminders: true, dailySummary: true },
        privacy: { dataCollection: true },
        reflectionPersona: 'calm_coach',
        privacyLevel: 'smart'
    });

    const [autostartEnabled, setAutostartEnabled] = useState(false);

    useEffect(() => {
        loadSettings();
        loadAutostartStatus();
    }, []);

    async function loadAutostartStatus() {
        try {
            const enabled = await isEnabled();
            setAutostartEnabled(enabled);
        } catch (error) {
            console.error('Error loading autostart status:', error);
        }
    }

    async function toggleAutostart() {
        try {
            if (autostartEnabled) {
                await disable();
                setAutostartEnabled(false);
                showNotification('Autostart disabled', 'success');
            } else {
                await enable();
                setAutostartEnabled(true);
                showNotification('Autostart enabled', 'success');
            }
        } catch (error) {
            console.error('Error toggling autostart:', error);
            showNotification('Failed to change autostart setting', 'error');
        }
    }

    async function loadSettings() {
        try {
            const data: any = await invoke("get_profile");
            if (data) {
                setSettings({
                    ...settings,
                    ...data,
                    notifications: data.notifications || settings.notifications,
                    privacy: data.privacy || settings.privacy
                });
            }
        } catch (error) {
            console.error('Error loading settings:', error);
        }
    }

    const updateSetting = async (key: string, value: any, nestedKey?: string) => {
        try {
            let payload: any = {};
            if (nestedKey) {
                payload[key] = { ...settings[key], [nestedKey]: value };
                setSettings({ ...settings, [key]: { ...settings[key], [nestedKey]: value } });
            } else {
                payload[key] = value;
                setSettings({ ...settings, [key]: value });
            }

            await invoke("update_settings", { settings: payload });
            showNotification('Setting updated', 'success');
        } catch (error) {
            console.error('Error updating setting:', error);
            showNotification('Failed to update setting', 'error');
        }
    };

    const updateName = async () => {
        try {
            const nameToSave = settings.userName || settings.name;
            await invoke("save_profile", { profile: { userName: nameToSave, name: nameToSave } });
            showNotification('Name updated successfully!', 'success');
        } catch (error) {
            console.error('Error updating name:', error);
            showNotification('Error updating name', 'error');
        }
    };

    const updatePersona = async () => {
        try {
            await invoke("save_profile", { profile: { reflectionPersona: settings.reflectionPersona } });
            showNotification('Persona updated successfully!', 'success');
        } catch (error) {
            console.error('Error updating persona:', error);
            showNotification('Error updating persona', 'error');
        }
    }

    const resetAccount = async () => {
        if (!confirm('Are you sure you want to reset your account? This will delete all your focus data and history.')) return;
        if (!confirm('This is your last chance. Are you absolutely sure?')) return;

        try {
            await invoke("reset_account");
            showNotification('Account reset successfully', 'success');
            setTimeout(() => navigate('/onboarding'), 2000);
        } catch (error) {
            console.error('Error resetting account:', error);
            showNotification('Error resetting account', 'error');
        }
    };

    const deleteAccount = async () => {
        if (!confirm('WARNING: DELETE ACCOUNT. This will PERMANENTLY delete your account and ALL data. Are you sure?')) return;
        const verification = prompt('To confirm deletion, please type "DELETE MY ACCOUNT" exactly:');
        if (verification !== 'DELETE MY ACCOUNT') return;

        try {
            await invoke("delete_account");
            showNotification('Account deleted. Goodbye.', 'success');
            setTimeout(() => navigate('/onboarding.html'), 2000);
        } catch (error) {
            console.error('Error deleting account:', error);
            showNotification('Error deleting account', 'error');
        }
    };


    const showNotification = (message: string, type: 'success' | 'error' | 'info' = 'info') => {
        // Simple alert for now, or implement a toast component
        // alert(`${type.toUpperCase()}: ${message}`);
        // Ideally we use a Toast context/component, but for parity with original JS which appended to body:
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
            font-family: 'Inter', sans-serif;
            font-size: 0.875rem;
            font-weight: 500;
            animation: slideIn 0.3s ease;
        `;

        document.body.appendChild(notification);

        setTimeout(() => {
            notification.style.animation = 'slideOut 0.3s ease';
            setTimeout(() => notification.remove(), 300);
        }, 3000);
    };

    const [subscriptionStatus, setSubscriptionStatus] = useState<'free' | 'pro' | 'loading'>('loading');
    const [deviceId, setDeviceId] = useState<string | null>(null);
    const [renewalDate, setRenewalDate] = useState<string | null>(null);

    useEffect(() => {
        checkSubscription();
    }, []);

    const checkSubscription = async () => {
        try {
            setSubscriptionStatus('loading');
            const data = await registerDevice();
            setDeviceId(data.deviceId);
            setSubscriptionStatus(data.licenseStatus);
            setRenewalDate(data.renewalDate || null);
            console.log("Device registered:", data);
        } catch (error) {
            console.error("Failed to check subscription:", error);
            showNotification('Failed to check subscription status', 'error');
        }
    };

    const handleSubscribe = async () => {
        if (!deviceId) {
            showNotification('Device ID not found. Please refresh.', 'error');
            return;
        }
        try {
            showNotification('Creating checkout session...', 'info');
            const url = await createCheckoutSession(deviceId);
            console.log('Checkout URL:', url);
            await openUrl(url);
        } catch (error) {
            console.error("Failed to create checkout session:", error);
            showNotification('Failed to start subscription process', 'error');
        }
    };

    const handleManageSubscription = async () => {
        if (!deviceId) {
            showNotification('Device ID not found. Please refresh.', 'error');
            return;
        }
        try {
            showNotification('Opening billing portal...', 'info');
            const url = await createPortalSession(deviceId);
            console.log('Portal URL:', url);
            await openUrl(url);
        } catch (error) {
            console.error("Failed to open billing portal:", error);
            showNotification('Failed to open billing portal', 'error');
        }
    };

    return (
        <div className="app-container">
            <header>
                <div className="logo">Ovelo</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                    <Link to="/" className="back-link">← Back to Dashboard</Link>
                </div>
            </header>

            <main>
                <section className="settings-section">
                    <h1 className="settings-title">Settings</h1>

                    {/* Profile Section */}
                    <div className="settings-card">
                        <div className="settings-card-header">
                            <h2>👤 {settings.userName || settings.name || 'Profile'}</h2>
                            <p className="settings-subtitle">Manage your personal information</p>
                        </div>
                        <div className="settings-item">
                            <div className="settings-item-info">
                                <label htmlFor="user-name">Display Name</label>
                                <p className="settings-item-description">This is how you'll be identified in the app</p>
                            </div>
                            <div className="settings-item-control">
                                <input
                                    type="text"
                                    id="user-name"
                                    className="settings-input"
                                    placeholder="Your Name"
                                    value={settings.userName || settings.name || ''}
                                    onChange={(e) => setSettings({ ...settings, userName: e.target.value, name: e.target.value })}
                                />
                                <button className="settings-btn settings-btn-primary" onClick={updateName}>Save</button>
                            </div>
                        </div>
                        <div className="settings-item">
                            <div className="settings-item-info">
                                <label htmlFor="persona-select">Reflection Persona</label>
                                <p className="settings-item-description">Choose the AI's personality for daily reflections</p>
                            </div>
                            <div className="settings-item-control">
                                <select
                                    id="persona-select"
                                    className="settings-select"
                                    value={settings.reflectionPersona}
                                    onChange={(e) => setSettings({ ...settings, reflectionPersona: e.target.value })}
                                >
                                    <option value="calm_coach">Calm Coach 🌿</option>
                                    <option value="scientist">Scientist 🔬</option>
                                    <option value="no_bullshit">No-Bullshit 🚫</option>
                                    <option value="unhinged">Unhinged 🤪</option>
                                    <option value="ceo">CEO 💼</option>
                                </select>
                                <button className="settings-btn settings-btn-primary" onClick={updatePersona}>Save</button>
                            </div>
                        </div>
                        <div className="settings-item">
                            <div className="settings-item-info">
                                <label htmlFor="privacy-level">Privacy Level</label>
                                <p className="settings-item-description">Control what details Ovelo tracks</p>
                            </div>
                            <div className="settings-item-control">
                                <select
                                    id="privacy-level"
                                    className="settings-select"
                                    value={settings.privacyLevel || 'smart'}
                                    onChange={(e) => updateSetting('privacyLevel', e.target.value)}
                                >
                                    <option value="minimal">Minimal (App Names Only) 🔒</option>
                                    <option value="smart">Smart (Apps + Titles) 🧠</option>
                                </select>
                            </div>
                        </div>
                    </div>

                    {/* Billing Section */}
                    <div className="settings-card">
                        <div className="settings-card-header">
                            <h2>💳 Billing & Subscription</h2>
                            <p className="settings-subtitle">Manage your subscription and payment methods</p>
                        </div>

                        <div className="settings-item">
                            <div className="settings-item-info">
                                <label>Subscription Status</label>
                                <p className="settings-item-description">
                                    {subscriptionStatus === 'loading' ? 'Checking status...' :
                                        subscriptionStatus === 'pro'
                                            ? `You are on the Pro Plan${renewalDate ? ` • Renews ${new Date(renewalDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}` : ''}`
                                            : 'You are on the Free Plan'}
                                </p>
                            </div>
                            <div className="settings-item-control">
                                {subscriptionStatus === 'loading' ? (
                                    <span className="settings-badge">Loading...</span>
                                ) : subscriptionStatus === 'pro' ? (
                                    <span className="settings-badge" style={{ background: 'linear-gradient(135deg, #10B981, #059669)' }}>Pro Active</span>
                                ) : (
                                    <span className="settings-badge" style={{ background: '#6B7280' }}>Free</span>
                                )}
                            </div>
                        </div>

                        <div className="settings-item">
                            <div className="settings-item-info">
                                <label>Actions</label>
                            </div>
                            <div className="settings-item-control">
                                <button className="settings-btn settings-btn-secondary" onClick={checkSubscription}>Refresh Status</button>
                                {subscriptionStatus === 'free' && (
                                    <button className="settings-btn settings-btn-primary" onClick={handleSubscribe}>
                                        Upgrade to Pro
                                    </button>
                                )}
                                {subscriptionStatus === 'pro' && (
                                    <button className="settings-btn settings-btn-secondary" onClick={handleManageSubscription}>
                                        Manage Subscription
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Notifications */}
                    <div className="settings-card">
                        <div className="settings-card-header">
                            <h2>🔔 Notifications</h2>
                            <p className="settings-subtitle">Control what notifications you receive</p>
                        </div>
                        <div className="settings-item">
                            <div className="settings-item-info">
                                <label htmlFor="focus-reminders">Focus Reminders</label>
                                <p className="settings-item-description">Get reminded when you drift off task</p>
                            </div>
                            <div className="settings-item-control">
                                <label className="toggle-switch">
                                    <input
                                        type="checkbox"
                                        id="focus-reminders"
                                        checked={settings.notifications.focusReminders}
                                        onChange={(e) => updateSetting('notifications', e.target.checked, 'focusReminders')}
                                    />
                                    <span className="toggle-slider"></span>
                                </label>
                            </div>
                        </div>
                        <div className="settings-item">
                            <div className="settings-item-info">
                                <label htmlFor="daily-summary">Daily Summary</label>
                                <p className="settings-item-description">Receive a daily focus report</p>
                            </div>
                            <div className="settings-item-control">
                                <label className="toggle-switch">
                                    <input
                                        type="checkbox"
                                        id="daily-summary"
                                        checked={settings.notifications.dailySummary}
                                        onChange={(e) => updateSetting('notifications', e.target.checked, 'dailySummary')}
                                    />
                                    <span className="toggle-slider"></span>
                                </label>
                            </div>
                        </div>
                        <div className="settings-item">
                            <div className="settings-item-info">
                                <label htmlFor="autostart-toggle">Run on Startup</label>
                                <p className="settings-item-description">Launch Ovelo automatically when your computer starts</p>
                            </div>
                            <div className="settings-item-control">
                                <label className="toggle-switch">
                                    <input
                                        type="checkbox"
                                        id="autostart-toggle"
                                        checked={autostartEnabled}
                                        onChange={toggleAutostart}
                                    />
                                    <span className="toggle-slider"></span>
                                </label>
                            </div>
                        </div>
                    </div>

                    {/* Preferences */}
                    <div className="settings-card">
                        <div className="settings-card-header">
                            <h2>⚙️ Preferences</h2>
                            <p className="settings-subtitle">Customize your experience</p>
                        </div>
                        <div className="settings-item">
                            <div className="settings-item-info">
                                <label htmlFor="clock-format">Clock Format</label>
                                <p className="settings-item-description">Choose 12-hour or 24-hour time display</p>
                            </div>
                            <div className="settings-item-control">
                                <select
                                    id="clock-format"
                                    className="settings-select"
                                    value={settings.clockFormat || '12h'}
                                    onChange={(e) => updateSetting('clockFormat', e.target.value)}
                                >
                                    <option value="12h">12-hour (2:30 PM)</option>
                                    <option value="24h">24-hour (14:30)</option>
                                </select>
                            </div>
                        </div>
                    </div>

                    {/* Privacy & Data */}
                    <div className="settings-card">
                        <div className="settings-card-header">
                            <h2>🔒 Privacy & Data</h2>
                            <p className="settings-subtitle">Control your data and privacy settings</p>
                        </div>
                        <div className="settings-item">
                            <div className="settings-item-info">
                                <label htmlFor="data-collection">Activity Tracking</label>
                                <p className="settings-item-description">Allow Ovelo to track your focus patterns</p>
                            </div>
                            <div className="settings-item-control">
                                <label className="toggle-switch">
                                    <input
                                        type="checkbox"
                                        id="data-collection"
                                        checked={settings.privacy.dataCollection}
                                        onChange={(e) => updateSetting('privacy', e.target.checked, 'dataCollection')}
                                    />
                                    <span className="toggle-slider"></span>
                                </label>
                            </div>
                        </div>

                        <div className="settings-item">
                            <div className="settings-item-info">
                                <label>Reset Account</label>
                                <p className="settings-item-description">Clear all focus data and start fresh (keeps your profile settings)</p>
                            </div>
                            <div className="settings-item-control">
                                <button className="settings-btn settings-btn-warning" onClick={resetAccount}>
                                    Reset Data
                                </button>
                            </div>
                        </div>
                        <div className="settings-item">
                            <div className="settings-item-info">
                                <label>Delete Profile</label>
                                <p className="settings-item-description">Delete your profile and data. Your subscription is tied to this device and will remain active.</p>
                            </div>
                            <div className="settings-item-control">
                                <button className="settings-btn settings-btn-danger" onClick={deleteAccount}>
                                    Delete Profile
                                </button>
                            </div>
                        </div>
                        <p className="settings-note" style={{ fontSize: '0.8rem', color: '#64748b', marginTop: '1rem', textAlign: 'center' }}>
                            Your account is device-based — no login required. Subscriptions are linked to this device.
                        </p>
                    </div>
                </section>
            </main>
        </div>
    );
}

export default Settings;
