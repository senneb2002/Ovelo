import { useState } from 'react';
import { invoke } from "@tauri-apps/api/core";
import { useNavigate } from 'react-router-dom';
import "./App.css";

function Onboarding() {
    const navigate = useNavigate();
    const [currentStep, setCurrentStep] = useState(1);
    const totalSteps = 7;
    const [data, setData] = useState({
        userName: '',
        workArchetype: '',
        primaryGoal: '',
        priorityCategory: '',
        focusLength: null as number | null,
        sensitivity: '',
        driftStyle: '',
        reflectionPersona: '',
        privacyLevel: 'smart'
    });

    const updateData = (key: string, value: any) => {
        setData(prev => ({ ...prev, [key]: value }));

        // Auto-advance for single-choice steps (2, 3, 4, 6)
        const autoAdvanceKeys = ['workArchetype', 'primaryGoal', 'priorityCategory', 'reflectionPersona', 'privacyLevel'];
        if (autoAdvanceKeys.includes(key)) {
            setTimeout(() => {
                if (currentStep < totalSteps) {
                    setCurrentStep(prev => prev + 1);
                }
            }, 300); // Small delay for visual feedback
        }
    };

    const canProceed = () => {
        switch (currentStep) {
            case 1: return data.userName.trim() !== '';
            case 2: return data.workArchetype !== '';
            case 3: return data.primaryGoal !== '';
            case 4: return data.priorityCategory !== '';
            case 5: return data.focusLength !== null && data.sensitivity !== '' && data.driftStyle !== '';
            case 6: return data.reflectionPersona !== '';
            case 7: return data.privacyLevel !== '';
            default: return false;
        }
    };

    const handleNext = () => {
        if (!canProceed()) return;
        if (currentStep === totalSteps) {
            submitProfile();
        } else {
            setCurrentStep(prev => prev + 1);
        }
    };

    const handleBack = () => {
        if (currentStep > 1) {
            setCurrentStep(prev => prev - 1);
        }
    };

    const submitProfile = async () => {
        const profile = buildFocusProfile();
        try {
            await invoke("save_profile", { profile });
            navigate('/');
        } catch (error) {
            console.error('Error saving profile:', error);
            alert('Error saving profile. Please try again.');
        }
    };

    const buildFocusProfile = () => {
        const { userName, workArchetype, primaryGoal, priorityCategory, focusLength, sensitivity, driftStyle, reflectionPersona, privacyLevel } = data;

        // Calculate weights based on archetype
        const archetypeWeights: any = {
            programmer: { typing: 1.2, mouseStill: 0.8, switchTolerance: 0.3, readingWeight: 0.6 },
            researcher: { typing: 0.7, mouseStill: 1.3, switchTolerance: 0.5, readingWeight: 1.5 },
            writer: { typing: 1.5, mouseStill: 0.6, switchTolerance: 0.4, readingWeight: 0.9 },
            designer: { typing: 0.6, mouseStill: 0.5, switchTolerance: 0.7, readingWeight: 0.5 },
            manager: { typing: 0.8, mouseStill: 0.7, switchTolerance: 1.2, readingWeight: 0.7 },
            custom: { typing: 1.0, mouseStill: 1.0, switchTolerance: 0.5, readingWeight: 1.0 }
        };

        const weights = archetypeWeights[workArchetype] || archetypeWeights.custom;

        // Sensitivity to distraction mapping (0-1 scale)
        const sensitivityMap: any = { high: 0.3, medium: 0.6, low: 0.9 };
        const sensitivityValue = sensitivityMap[sensitivity] || 0.6;

        // Drift detection style mapping
        const driftThresholds: any = {
            strict: { activityMultiplier: 1.3, switchThreshold: 0.8 },
            balanced: { activityMultiplier: 1.0, switchThreshold: 1.0 },
            gentle: { activityMultiplier: 0.7, switchThreshold: 1.2 }
        };

        const driftConfig = driftThresholds[driftStyle] || driftThresholds.balanced;

        // Category focus multipliers
        const categoryMultipliers: any = {
            editor: 1.2,
            browser: 0.9,
            notes: 1.1,
            design: 1.0,
            messaging: 0.7,
            video: 0.8
        };

        // Build final profile
        return {
            userName: userName.trim() || 'User',
            workArchetype,
            primaryGoal,
            priorityCategory,

            preferredFocusLengthMinutes: focusLength,
            sensitivityToDistraction: sensitivityValue,
            driftDetectionStyle: driftStyle,
            reflectionPersona: reflectionPersona,
            privacyLevel: privacyLevel,

            baselines: {
                focus_keystrokes_per_min: 40 * weights.typing,
                focus_clicks_per_min: 10 * (1 / weights.mouseStill),
                focus_scrolls_per_min: 5 * weights.readingWeight,
                avg_switch_frequency: 0.5 * weights.switchTolerance
            },

            thresholds: {
                activity_multiplier: driftConfig.activityMultiplier * weights.typing,
                reading_scroll_threshold: 2.0 * weights.readingWeight,
                switch_tolerance: driftConfig.switchThreshold
            },

            categoryFocusMultiplier: {
                [priorityCategory]: categoryMultipliers[priorityCategory] || 1.0
            },

            createdAt: Date.now()
        };
    }

    const progress = (currentStep / totalSteps) * 100;

    return (
        <div className="onboarding-container-wrapper">
            <div className="onboarding-container">
                {/* Progress Bar */}
                <div className="progress-bar">
                    <div className="progress-fill" style={{ width: `${progress}%` }}></div>
                </div>

                {/* Step 1: Identity */}
                {currentStep === 1 && (
                    <div className="step active">
                        <h1 className="step-title">Welcome to Ovelo</h1>
                        <p className="step-description">Help us understand your version of focus.</p>

                        <div className="input-group">
                            <label htmlFor="userName">What should we call you?</label>
                            <input
                                type="text"
                                id="userName"
                                placeholder="Your name"
                                value={data.userName}
                                onChange={(e) => updateData('userName', e.target.value)}
                            />
                        </div>
                    </div>
                )}

                {/* Step 2: Work Style Archetype */}
                {currentStep === 2 && (
                    <div className="step active">
                        <h1 className="step-title">Your Work Style</h1>
                        <p className="step-description">What best describes your daily work style?</p>

                        <div className="options-grid">
                            {[
                                { value: 'programmer', icon: '💻', title: 'Programmer / Engineer', desc: 'Deep coding sessions' },
                                { value: 'researcher', icon: '🔬', title: 'Researcher / Analyst', desc: 'Long reading & thinking' },
                                { value: 'writer', icon: '✍️', title: 'Writer / Student', desc: 'Heavy typing & notes' },
                                { value: 'designer', icon: '🎨', title: 'Designer / Creative', desc: 'Visual tools & iteration' },
                                { value: 'manager', icon: '📊', title: 'Manager / Communicator', desc: 'Many apps & meetings' },
                                { value: 'custom', icon: '⚙️', title: 'Custom Blend', desc: "I'll customize it" }
                            ].map(opt => (
                                <div
                                    key={opt.value}
                                    className={`option-card ${data.workArchetype === opt.value ? 'selected' : ''}`}
                                    onClick={() => updateData('workArchetype', opt.value)}
                                >
                                    <div className="option-icon">{opt.icon}</div>
                                    <h3>{opt.title}</h3>
                                    <p>{opt.desc}</p>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Step 3: Focus Goals */}
                {currentStep === 3 && (
                    <div className="step active">
                        <h1 className="step-title">Your Focus Goal</h1>
                        <p className="step-description">What is your main focus goal right now?</p>

                        <div className="options-list">
                            {[
                                { value: 'deep-focus', title: 'More Deep Focus Blocks', desc: 'Long uninterrupted sessions' },
                                { value: 'reduce-drift', title: 'Reduce Mindless Drift', desc: 'Catch myself when wandering' },
                                { value: 'better-rhythm', title: 'Better Daily Rhythm', desc: 'Consistent focus patterns' },
                                { value: 'less-switching', title: 'Less App-Hopping', desc: 'Stay in one place longer' },
                                { value: 'stay-consistent', title: 'Stay Consistent', desc: 'Build long-term habits' }
                            ].map(opt => (
                                <div
                                    key={opt.value}
                                    className={`option-row ${data.primaryGoal === opt.value ? 'selected' : ''}`}
                                    onClick={() => updateData('primaryGoal', opt.value)}
                                >
                                    <div className="option-content">
                                        <h3>{opt.title}</h3>
                                        <p>{opt.desc}</p>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Step 4: Priority App Category */}
                {currentStep === 4 && (
                    <div className="step active">
                        <h1 className="step-title">Your Priority Apps</h1>
                        <p className="step-description">Which app category matters most to you?</p>

                        <div className="options-grid">
                            {[
                                { value: 'editor', icon: '⌨️', title: 'Code Editor' },
                                { value: 'browser', icon: '🌐', title: 'Browser' },
                                { value: 'notes', icon: '📝', title: 'Notes / Docs' },
                                { value: 'design', icon: '🖌️', title: 'Design Tools' },
                                { value: 'messaging', icon: '💬', title: 'Messaging' },
                                { value: 'video', icon: '🎬', title: 'Video Tools' }
                            ].map(opt => (
                                <div
                                    key={opt.value}
                                    className={`option-card small ${data.priorityCategory === opt.value ? 'selected' : ''}`}
                                    onClick={() => updateData('priorityCategory', opt.value)}
                                >
                                    <div className="option-icon">{opt.icon}</div>
                                    <h3>{opt.title}</h3>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Step 5: Focus Patterns */}
                {currentStep === 5 && (
                    <div className="step active">
                        <h1 className="step-title">Your Focus Patterns</h1>
                        <p className="step-description">Everyone focuses differently — let's find your rhythm.</p>

                        <div className="pattern-questions">
                            <div className="pattern-question">
                                <label>How long is your ideal focus session?</label>
                                <div className="button-group">
                                    {[25, 50, 90].map(val => (
                                        <button
                                            key={val}
                                            className={`pattern-btn ${data.focusLength === val ? 'selected' : ''}`}
                                            onClick={() => updateData('focusLength', val)}
                                        >
                                            {val === 25 ? '~20–30 min' : val === 50 ? '~40–60 min' : '90+ min'}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div className="pattern-question">
                                <label>How easily do you get pulled out of focus?</label>
                                <div className="button-group">
                                    {['high', 'medium', 'low'].map(val => (
                                        <button
                                            key={val}
                                            className={`pattern-btn ${data.sensitivity === val ? 'selected' : ''}`}
                                            onClick={() => updateData('sensitivity', val)}
                                        >
                                            {val === 'high' ? 'Very easily' : val === 'medium' ? 'Sometimes' : 'Rarely'}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div className="pattern-question">
                                <label>Should Ovelo be strict or gentle detecting drift?</label>
                                <div className="button-group">
                                    {['strict', 'balanced', 'gentle'].map(val => (
                                        <button
                                            key={val}
                                            className={`pattern-btn ${data.driftStyle === val ? 'selected' : ''}`}
                                            onClick={() => updateData('driftStyle', val)}
                                        >
                                            {val.charAt(0).toUpperCase() + val.slice(1)}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* Step 6: Reflection Persona */}
                {currentStep === 6 && (
                    <div className="step active">
                        <h1 className="step-title">Your Reflection Persona</h1>
                        <p className="step-description">How should Ovelo talk to you about your focus?</p>

                        <div className="options-grid">
                            {[
                                { value: 'calm_coach', icon: '🧘', title: 'Calm Coach', desc: 'Soft, supportive, warm' },
                                { value: 'scientist', icon: '🧪', title: 'Scientist', desc: 'Data-driven, neutral' },
                                { value: 'no_bullshit', icon: '🛑', title: 'No-Bullshit', desc: 'Direct, honest, tough-love' },
                                { value: 'unhinged', icon: '🤪', title: 'Unhinged', desc: 'Chaotic, funny, roasted' },
                                { value: 'ceo', icon: '👔', title: 'CEO Mode', desc: 'Strategic, results-oriented' }
                            ].map(opt => (
                                <div
                                    key={opt.value}
                                    className={`option-card ${data.reflectionPersona === opt.value ? 'selected' : ''}`}
                                    onClick={() => updateData('reflectionPersona', opt.value)}
                                >
                                    <div className="option-icon">{opt.icon}</div>
                                    <h3>{opt.title}</h3>
                                    <p>{opt.desc}</p>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Step 7: Privacy Level */}
                {currentStep === 7 && (
                    <div className="step active">
                        <h1 className="step-title">Privacy Level</h1>
                        <p className="step-description">How much detail should Ovelo track?</p>

                        <div className="options-grid">
                            <div
                                className={`option-card ${data.privacyLevel === 'minimal' ? 'selected' : ''}`}
                                onClick={() => updateData('privacyLevel', 'minimal')}
                            >
                                <div className="option-icon">🔒</div>
                                <h3>Level 1 – Minimal</h3>
                                <p>Track only app names (e.g. Chrome). No titles/URLs.</p>
                            </div>

                            <div
                                className={`option-card ${data.privacyLevel === 'smart' ? 'selected' : ''}`}
                                onClick={() => updateData('privacyLevel', 'smart')}
                            >
                                <div className="option-icon">🧠</div>
                                <h3>Level 2 – Smart</h3>
                                <p>Track app names and window titles. Better stats.</p>
                            </div>
                        </div>
                    </div>
                )}

                {/* Navigation */}
                <div className="navigation">
                    <button
                        className="nav-btn"
                        id="back-btn"
                        onClick={handleBack}
                        disabled={currentStep === 1}
                        style={{ opacity: currentStep === 1 ? 0.5 : 1, cursor: currentStep === 1 ? 'not-allowed' : 'pointer' }}
                    >
                        Back
                    </button>
                    <button
                        className="nav-btn primary"
                        id="next-btn"
                        onClick={handleNext}
                        disabled={!canProceed()}
                    >
                        {currentStep === totalSteps ? 'Finish' : 'Next'}
                    </button>
                </div>
            </div>
        </div>
    );
}

export default Onboarding;
