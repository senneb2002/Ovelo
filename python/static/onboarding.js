// Onboarding State
const state = {
    currentStep: 1,
    totalSteps: 6,
    data: {
        userName: '',
        workArchetype: '',
        primaryGoal: '',
        priorityCategory: '',
        focusLength: null,
        sensitivity: '',
        driftStyle: '',
        reflectionPersona: ''
    }
};

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    updateProgress();
    setupEventListeners();
    updateNavigationButtons();
});

function setupEventListeners() {
    // Navigation buttons
    document.getElementById('next-btn').addEventListener('click', handleNext);
    document.getElementById('back-btn').addEventListener('click', handleBack);

    // Input field
    document.getElementById('userName').addEventListener('input', (e) => {
        state.data.userName = e.target.value;
        updateNavigationButtons();
    });

    // Option cards (Step 2 & 4)
    document.querySelectorAll('.option-card').forEach(card => {
        card.addEventListener('click', () => {
            const parent = card.parentElement;
            parent.querySelectorAll('.option-card').forEach(c => c.classList.remove('selected'));
            card.classList.add('selected');

            if (state.currentStep === 2) {
                state.data.workArchetype = card.dataset.value;
            } else if (state.currentStep === 4) {
                state.data.priorityCategory = card.dataset.value;
            } else if (state.currentStep === 6) {
                state.data.reflectionPersona = card.dataset.value;
            }
            updateNavigationButtons();
        });
    });

    // Option rows (Step 3)
    document.querySelectorAll('.option-row').forEach(row => {
        row.addEventListener('click', () => {
            const parent = row.parentElement;
            parent.querySelectorAll('.option-row').forEach(r => r.classList.remove('selected'));
            row.classList.add('selected');
            state.data.primaryGoal = row.dataset.value;
            updateNavigationButtons();
        });
    });

    // Pattern buttons (Step 5)
    document.querySelectorAll('.pattern-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const question = btn.dataset.question;
            const value = btn.dataset.value;

            // Deselect siblings
            document.querySelectorAll(`[data-question="${question}"]`).forEach(b => b.classList.remove('selected'));
            btn.classList.add('selected');

            // Save value
            if (question === 'length') {
                state.data.focusLength = parseInt(value);
            } else if (question === 'sensitivity') {
                state.data.sensitivity = value;
            } else if (question === 'style') {
                state.data.driftStyle = value;
            }

            updateNavigationButtons();
        });
    });
}

function handleNext() {
    if (!canProceed()) return;

    if (state.currentStep === state.totalSteps) {
        // Submit profile
        submitProfile();
    } else {
        // Go to next step
        state.currentStep++;
        updateStepDisplay();
        updateProgress();
        updateNavigationButtons();
    }
}

function handleBack() {
    if (state.currentStep > 1) {
        state.currentStep--;
        updateStepDisplay();
        updateProgress();
        updateNavigationButtons();
    }
}

function canProceed() {
    switch (state.currentStep) {
        case 1:
            return state.data.userName.trim() !== '';
        case 2:
            return state.data.workArchetype !== '';
        case 3:
            return state.data.primaryGoal !== '';
        case 4:
            return state.data.priorityCategory !== '';
        case 5:
            return state.data.focusLength !== null && state.data.sensitivity !== '' && state.data.driftStyle !== '';
        case 6:
            return state.data.reflectionPersona !== '';
        default:
            return false;
    }
}

function updateStepDisplay() {
    document.querySelectorAll('.step').forEach((step, index) => {
        if (index + 1 === state.currentStep) {
            step.classList.add('active');
        } else {
            step.classList.remove('active');
        }
    });
}

function updateProgress() {
    const progress = (state.currentStep / state.totalSteps) * 100;
    document.getElementById('progress-fill').style.width = `${progress}%`;
}

function updateNavigationButtons() {
    const backBtn = document.getElementById('back-btn');
    const nextBtn = document.getElementById('next-btn');

    // Back button
    backBtn.style.opacity = state.currentStep === 1 ? '0.5' : '1';
    backBtn.style.cursor = state.currentStep === 1 ? 'not-allowed' : 'pointer';

    // Next button
    if (!canProceed()) {
        nextBtn.disabled = true;
    } else {
        nextBtn.disabled = false;
        nextBtn.textContent = state.currentStep === state.totalSteps ? 'Finish' : 'Next';
    }
}

function submitProfile() {
    // Build FocusProfile with calculated weights
    const profile = buildFocusProfile();

    // Save to backend
    fetch('/api/save_profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(profile)
    })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                // Redirect to main dashboard
                window.location.href = '/';
            } else {
                alert('Error saving profile. Please try again.');
            }
        })
        .catch(err => {
            console.error('Error:', err);
            alert('Error saving profile. Please try again.');
        });
}

function buildFocusProfile() {
    const { userName, workArchetype, primaryGoal, priorityCategory, focusLength, sensitivity, driftStyle, reflectionPersona } = state.data;

    // Calculate weights based on archetype
    const archetypeWeights = {
        programmer: { typing: 1.2, mouseStill: 0.8, switchTolerance: 0.3, readingWeight: 0.6 },
        researcher: { typing: 0.7, mouseStill: 1.3, switchTolerance: 0.5, readingWeight: 1.5 },
        writer: { typing: 1.5, mouseStill: 0.6, switchTolerance: 0.4, readingWeight: 0.9 },
        designer: { typing: 0.6, mouseStill: 0.5, switchTolerance: 0.7, readingWeight: 0.5 },
        manager: { typing: 0.8, mouseStill: 0.7, switchTolerance: 1.2, readingWeight: 0.7 },
        custom: { typing: 1.0, mouseStill: 1.0, switchTolerance: 0.5, readingWeight: 1.0 }
    };

    const weights = archetypeWeights[workArchetype] || archetypeWeights.custom;

    // Sensitivity to distraction mapping (0-1 scale)
    const sensitivityMap = { high: 0.3, medium: 0.6, low: 0.9 };
    const sensitivityValue = sensitivityMap[sensitivity] || 0.6;

    // Drift detection style mapping
    const driftThresholds = {
        strict: { activityMultiplier: 1.3, switchThreshold: 0.8 },
        balanced: { activityMultiplier: 1.0, switchThreshold: 1.0 },
        gentle: { activityMultiplier: 0.7, switchThreshold: 1.2 }
    };

    const driftConfig = driftThresholds[driftStyle] || driftThresholds.balanced;

    // Category focus multipliers
    const categoryMultipliers = {
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
