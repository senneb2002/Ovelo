const canvas = document.getElementById('trace-canvas');
const ctx = canvas.getContext('2d');
const loading = document.getElementById('loading');
const tooltip = document.getElementById('tooltip');
const reflectionText = document.getElementById('reflection-text');

// Configuration
const CONFIG = {
    colors: {
        'Focus Peak': '#14B8A6',
        'Light Focus': '#14B8A6',
        'Drift Zone': '#F59E0B',
        'Recovery Point': '#F472B6',
        'Idle': '#64748B',
        'IdleGap': '#475569'
    }
};

async function checkProfile() {
    try {
        const response = await fetch('/api/check_profile');
        const data = await response.json();
        if (!data.exists) window.location.href = 'onboarding.html';
    } catch (error) {
        console.error('Error checking profile:', error);
    }
}

async function logout() {
    try {
        await fetch('/api/logout', { method: 'POST' });
        window.location.reload();
    } catch (error) {
        console.error('Error logging out:', error);
    }
}

function resizeCanvas() {
    const container = document.getElementById('trace-container');
    canvas.width = container.clientWidth;
    canvas.height = container.clientHeight;
}

function drawTimeline(timeline) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (!timeline || timeline.length === 0) {
        ctx.fillStyle = '#9ca3af';
        ctx.font = '14px Inter';
        ctx.fillText('No activity recorded yet today', 20, 30);
        return;
    }

    const centerY = canvas.height / 2;
    const totalDuration = timeline.length;
    const availableWidth = canvas.width;
    const widthPerUnit = Math.max(2, availableWidth / totalDuration);

    // Pre-calculate heights for smoothing
    const rawHeights = timeline.map(point => {
        const intensity = point.intensity || 0.1;
        let h = 0;
        if (point.state === 'IdleGap') {
            h = 15;
        } else if (point.state === 'Focus Peak' || point.state === 'Light Focus') {
            h = 60 + (intensity * 140);
        } else if (point.state === 'Drift Zone') {
            h = 40 + (intensity * 60);
        } else if (point.state === 'Recovery Point') {
            h = 50 + (intensity * 80);
        } else {
            h = 20;
        }
        return h;
    });

    // Apply 3-point moving average smoothing (skip IdleGap)
    const smoothedHeights = rawHeights.map((h, i) => {
        if (timeline[i].state === 'IdleGap') return h;
        if (i === 0 || i === rawHeights.length - 1) return h;
        return (rawHeights[i - 1] + h + rawHeights[i + 1]) / 3;
    });

    // Track actual x positions for hover detection
    const barPositions = [];
    let currentX = 0;

    // Draw bars with proper gaps
    timeline.forEach((point, index) => {
        const height = smoothedHeights[index];
        const color = CONFIG.colors[point.state] || CONFIG.colors['Idle'];

        ctx.fillStyle = color;

        // IdleGap gets special spacing - create an actual visual gap
        if (point.state === 'IdleGap') {
            const gapTotalWidth = widthPerUnit * 4; // Total space for gap
            const barWidth = widthPerUnit * 0.5;    // Small bar at edges

            // Draw start bar (faded)
            ctx.globalAlpha = 0.3;
            ctx.fillRect(currentX, centerY - height / 2, barWidth, height);

            // Draw end bar (faded)
            ctx.fillRect(currentX + gapTotalWidth - barWidth, centerY - height / 2, barWidth, height);
            ctx.globalAlpha = 1.0;

            // Draw a subtle "break" line in the middle
            ctx.strokeStyle = '#334155';
            ctx.lineWidth = 1;
            ctx.setLineDash([2, 2]);
            ctx.beginPath();
            ctx.moveTo(currentX + gapTotalWidth / 2, centerY - 10);
            ctx.lineTo(currentX + gapTotalWidth / 2, centerY + 10);
            ctx.stroke();
            ctx.setLineDash([]);

            barPositions.push({ x: currentX, width: gapTotalWidth, index });
            currentX += gapTotalWidth;
        } else {
            // Normal bar
            ctx.fillRect(currentX, centerY - height / 2, widthPerUnit - 0.5, height);
            barPositions.push({ x: currentX, width: widthPerUnit - 0.5, index });
            currentX += widthPerUnit;
        }
    });

    // Draw Recovery Point Markers (Overlay)
    timeline.forEach((point, index) => {
        if (point.state === 'Recovery Point') {
            const barPos = barPositions[index];
            if (barPos) {
                const x = barPos.x + barPos.width / 2;
                const height = smoothedHeights[index];
                const y = centerY - height / 2 - 8; // Just above the bar

                // Glow effect
                ctx.shadowColor = CONFIG.colors['Recovery Point'];
                ctx.shadowBlur = 10;

                ctx.fillStyle = CONFIG.colors['Recovery Point'];
                ctx.beginPath();
                ctx.arc(x, y, 4, 0, Math.PI * 2); // Larger dot
                ctx.fill();

                // Reset shadow
                ctx.shadowBlur = 0;
            }
        }
    });

    // Store for hover detection
    window.timelineBarPositions = barPositions;

    // Draw x-axis time labels (Full Hours Only)
    if (timeline.length > 0) {
        ctx.fillStyle = '#64748b';
        ctx.font = '12px Inter'; // Slightly larger
        ctx.textAlign = 'center';

        const minLabelSpacing = 100; // Minimum pixels between labels
        let lastLabelX = -minLabelSpacing;

        timeline.forEach((point, i) => {
            if (point.state === 'IdleGap') return;

            const barPos = barPositions[i];
            if (!barPos) return;

            const x = barPos.x + barPos.width / 2;
            const timestamp = point.timestamp;
            const date = new Date(timestamp * 1000);
            const minutes = date.getMinutes();

            // ONLY draw if it's a full hour (minute == 0) AND we have space
            // Allow a small window (0-2 mins) in case exact 00 is missed due to interval
            if (minutes <= 2 && (x - lastLabelX >= minLabelSpacing)) {

                const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

                // Draw subtle vertical line
                ctx.strokeStyle = '#334155';
                ctx.lineWidth = 0.5;
                ctx.setLineDash([2, 4]);
                ctx.beginPath();
                ctx.moveTo(x, centerY + 80); // Start lower
                ctx.lineTo(x, canvas.height - 20);
                ctx.stroke();
                ctx.setLineDash([]);

                // Draw time label at bottom
                ctx.fillText(timeStr, x, canvas.height - 5);

                lastLabelX = x;
            }
        });
    }
}

async function loadData() {
    try {
        const response = await fetch('/api/today');
        if (!response.ok) throw new Error('Failed to load data');

        const data = await response.json();
        loading.style.display = 'none';

        resizeCanvas();
        drawTimeline(data.timeline);

        resizeCanvas();
        drawTimeline(data.timeline);

        // Check for persisted reflection
        if (data.reflection) {
            // Render with markdown support
            renderReflection(data.reflection);

            const generateBtn = document.getElementById('generate-reflection-btn');
            if (generateBtn) {
                generateBtn.textContent = '✨ Regenerate Reflection';
            }
        }

        // Manual reflection handling
        const generateBtn = document.getElementById('generate-reflection-btn');
        if (generateBtn) {
            generateBtn.onclick = async () => {
                generateBtn.disabled = true;
                generateBtn.textContent = 'Thinking...';
                reflectionText.textContent = 'Analyzing your day...';

                try {
                    const res = await fetch('/api/generate_reflection');
                    const resData = await res.json();

                    // Clean up any residual prefixes the AI might add despite instructions
                    let cleanText = resData.reflection;
                    cleanText = cleanText.replace(/^Reflection:\s*/i, '');
                    cleanText = cleanText.replace(/\n\s*Suggestion:\s*/i, '\n\n');
                    cleanText = cleanText.trim();

                    renderReflection(cleanText);
                } catch (e) {
                    reflectionText.textContent = 'Error generating reflection.';
                } finally {
                    generateBtn.disabled = false;
                    generateBtn.textContent = '✨ Generate Reflection';
                }
            };
        }

        // --- Calculate & Display Daily Stats (New Card) ---
        let focusMins = 0;
        let driftMins = 0;
        const intervalMins = 5 / 60; // 5 seconds per interval

        data.timeline.forEach(t => {
            if (t.state === 'Focus Peak' || t.state === 'Light Focus') {
                focusMins += intervalMins;
            } else if (t.state === 'Drift Zone') {
                driftMins += intervalMins;
            }
        });

        const totalActive = focusMins + driftMins;
        const stability = totalActive > 0 ? (focusMins / totalActive) * 100 : 0;

        // Format Focus Time (e.g., "2h 15m")
        const hours = Math.floor(focusMins / 60);
        const mins = Math.round(focusMins % 60);
        const timeStr = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;

        // Update DOM
        const focusEl = document.getElementById('stats-focus');
        const stabilityEl = document.getElementById('stats-stability');

        if (focusEl) focusEl.textContent = `Focus: ${timeStr}`;
        if (stabilityEl) stabilityEl.textContent = `Stability: ${Math.round(stability)}%`;

        // Setup tooltip interaction with correct position detection
        canvas.onmousemove = (e) => {
            const rect = canvas.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;

            // Find which bar we're hovering over using stored positions
            const barPositions = window.timelineBarPositions || [];
            let hoveredIndex = -1;

            for (let i = 0; i < barPositions.length; i++) {
                const bar = barPositions[i];
                if (mouseX >= bar.x && mouseX <= bar.x + bar.width) {
                    hoveredIndex = bar.index;
                    break;
                }
            }

            if (hoveredIndex >= 0 && hoveredIndex < data.timeline.length) {
                const point = data.timeline[hoveredIndex];
                tooltip.style.display = 'block';
                tooltip.style.left = `${e.clientX - 340}px`;
                tooltip.style.top = `${e.clientY - 125}px`;

                const time = new Date(point.timestamp * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

                // Special tooltip for IdleGap
                if (point.state === 'IdleGap') {
                    const gapMinutes = Math.floor(point.gap_duration / 60);
                    tooltip.innerHTML = `<strong>Idle Gap</strong><br>Duration: ${gapMinutes} minutes<br>(System was idle)`;
                } else {
                    tooltip.innerHTML = `<strong>${time}</strong><br>State: ${point.state}<br>App: ${point.dominant_app || 'Unknown'}`;
                }
            } else {
                tooltip.style.display = 'none';
            }
        };

        canvas.onmouseleave = () => tooltip.style.display = 'none';
    } catch (error) {
        console.error('Error loading data:', error);
        loading.textContent = 'Error loading data. Is the server running?';
    }
}

window.addEventListener('load', () => {
    checkProfile();
    loadData();
    setInterval(loadData, 60000);
    window.addEventListener('resize', () => {
        resizeCanvas();
        loadData();
    });
});

function renderReflection(text) {
    if (!text) return;

    // Replace **text** with <span class="highlight-text">text</span>
    // We use a class to style it big and bold
    const formatted = text.replace(/\*\*(.*?)\*\*/g, '<span class="highlight-text">$1</span>');

    // Use innerHTML since we are injecting spans
    reflectionText.innerHTML = formatted;
}

window.logout = logout;
