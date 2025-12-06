import { useState, useEffect, useRef } from 'react';
import { invoke } from "@tauri-apps/api/core";
import { Link } from 'react-router-dom';
import "./App.css";

const COLORS = {
    focus: '#00D9C0',   // Bright Teal
    drift: '#E89A3A',   // Muted Amber
    recovery: '#FFC857', // Subtle Yellow
    idle: '#5A6375',    // Low-contrast Grey-Blue
    bgTop: '#1E293B',
    bgBot: '#0F172A',
    text: '#F8FAFC',
    textDim: '#94A3B8'
};

function Passport() {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        loadPassportData();
    }, []);

    async function loadPassportData() {
        try {
            const data: any = await invoke("get_passport_data");
            if (data) {
                const canvas = canvasRef.current;
                if (canvas) {
                    canvas.width = 1080;
                    canvas.height = 1920;
                    const ctx = canvas.getContext('2d');
                    if (ctx) {
                        await renderPassport(ctx, data);
                    }
                }
                setLoading(false);
            } else {
                alert('No data available to generate passport.');
                setLoading(false);
            }
        } catch (error) {
            console.error('Error fetching passport data:', error);
            // alert('Failed to load passport data.');
            setLoading(false);
        }
    }

    const handleDownload = () => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        canvas.toBlob((blob) => {
            if (!blob) return;
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `ovelo-passport-${new Date().toISOString().split('T')[0]}.png`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        });
    };

    return (
        <div className="app-container">
            <header>
                <div className="logo">Ovelo</div>
                <div className="header-controls">
                    <Link to="/" className="nav-btn">Back to Dashboard</Link>
                </div>
            </header>

            <main>
                <div className="passport-layout">
                    <div className="canvas-wrapper">
                        <canvas id="passport-canvas" ref={canvasRef}></canvas>
                    </div>

                    <div className="actions">
                        <button id="export-btn" className="primary-btn" onClick={handleDownload}>
                            <span className="icon">⬇️</span> Download Passport
                        </button>
                    </div>
                </div>

                {loading && (
                    <div id="loading" className="loading-overlay">
                        <div className="spinner"></div>
                        <p>Generating Focus Identity...</p>
                    </div>
                )}
            </main>
        </div>
    );
}

async function renderPassport(ctx: CanvasRenderingContext2D, data: any) {
    const W = 1080;
    const H = 1920;

    // Convert Hours to Minutes for Display
    const totalFocusMinutes = Math.round(data.totalFocusHours * 60);
    const totalDriftMinutes = Math.round(data.totalDriftHours * 60);

    // 1. Background
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, COLORS.bgTop);
    grad.addColorStop(1, COLORS.bgBot);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    // Add subtle noise/texture (optional, kept simple for canvas perf)

    // 2. Header
    ctx.fillStyle = 'rgba(0, 0, 0, 0.2)';
    ctx.fillRect(0, 0, W, 220); // Top bar background

    ctx.font = '900 60px Inter';
    ctx.fillStyle = COLORS.text;
    ctx.textAlign = 'left';
    ctx.fillText('OVELO', 60, 130);

    ctx.font = '500 32px Inter';
    ctx.fillStyle = COLORS.textDim;
    ctx.textAlign = 'center';
    ctx.fillText('PASSPORT', W / 2, 130);

    // Focus Glyph (Right)
    const gx = W - 100;
    const gy = 110;

    // Glow behind glyph
    ctx.shadowColor = COLORS.focus;
    ctx.shadowBlur = 20;
    ctx.fillStyle = COLORS.focus;
    ctx.beginPath();
    ctx.arc(gx, gy, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    ctx.strokeStyle = COLORS.focus;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(gx, gy, 18, 0, Math.PI * 2);
    ctx.stroke();

    // 3. Hero Graphic: Attention Orbit Map
    const orbitCy = 620;
    const orbitCx = W / 2;
    const maxRadius = 320;
    const minRadius = 120;

    // Draw Orbit Structure (Clock-like)
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.lineWidth = 1;

    // Inner/Outer Rings
    ctx.beginPath();
    ctx.arc(orbitCx, orbitCy, minRadius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(orbitCx, orbitCy, maxRadius, 0, Math.PI * 2);
    ctx.stroke();

    // Reference Ring (30 mins)
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.arc(orbitCx, orbitCy, (minRadius + maxRadius) / 2, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    // Hour Markers (12, 3, 6, 9)
    ctx.font = '700 24px Inter';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const markers = [
        { label: '12', angle: -Math.PI / 2 },
        { label: '3', angle: 0 },
        { label: '6', angle: Math.PI / 2 },
        { label: '9', angle: Math.PI },
    ];

    markers.forEach(m => {
        const r = maxRadius + 40;
        const x = orbitCx + Math.cos(m.angle) * r;
        const y = orbitCy + Math.sin(m.angle) * r;
        ctx.fillText(m.label, x, y);
    });

    // Draw Hourly Segments
    const hourlyFocus = data.hourlyFocusMap || {};
    const hourlyDrift = data.hourlyDriftMap || {};
    const hourlyRecovery = data.hourlyRecoveryMap || {};

    // Calculate max minutes in an hour for normalization (max 60 mins)
    // 1 interval = 5 seconds. 12 intervals = 1 minute.
    const INTERVALS_PER_MIN = 12;

    for (let h = 0; h < 24; h++) {
        const focusCount = hourlyFocus[h] || 0;
        const driftCount = hourlyDrift[h] || 0;
        const recoveryCount = hourlyRecovery[h] || 0;

        const focusMins = focusCount / INTERVALS_PER_MIN;
        const driftMins = driftCount / INTERVALS_PER_MIN;

        const angleStart = (h / 24) * Math.PI * 2 - Math.PI / 2;
        const angleEnd = ((h + 1) / 24) * Math.PI * 2 - Math.PI / 2;
        const angleMid = (angleStart + angleEnd) / 2;

        // --- IDLE (Base Arc) ---
        // Subtle grey arc for structure
        ctx.strokeStyle = 'rgba(90, 99, 117, 0.1)';
        ctx.lineWidth = 2;
        ctx.lineCap = 'butt';
        ctx.beginPath();
        ctx.arc(orbitCx, orbitCy, minRadius, angleStart + 0.02, angleEnd - 0.02);
        ctx.stroke();

        // --- FOCUS (Smooth Teal Arcs) ---
        if (focusMins > 0) {
            // Length proportional to intensity (minutes)
            // Max length is full radius span
            const length = (focusMins / 60) * (maxRadius - minRadius);
            const rEnd = minRadius + length;

            // Glow
            ctx.shadowColor = COLORS.focus;
            ctx.shadowBlur = 15;
            ctx.strokeStyle = COLORS.focus;
            ctx.lineWidth = 12; // Thicker
            ctx.lineCap = 'round';

            ctx.beginPath();
            ctx.moveTo(orbitCx + Math.cos(angleMid) * minRadius, orbitCy + Math.sin(angleMid) * minRadius);
            ctx.lineTo(orbitCx + Math.cos(angleMid) * rEnd, orbitCy + Math.sin(angleMid) * rEnd);
            ctx.stroke();

            ctx.shadowBlur = 0;
        }

        // --- DRIFT (Jittery Amber Arcs) ---
        if (driftMins > 0) {
            const length = (driftMins / 60) * (maxRadius - minRadius);

            const rStart = minRadius + ((focusMins / 60) * (maxRadius - minRadius));
            const rEnd = rStart + length;

            ctx.strokeStyle = COLORS.drift;
            ctx.lineWidth = 8; // Slightly thinner

            // Jitter effect: draw multiple small lines
            const segments = 5;
            const step = (rEnd - rStart) / segments;

            ctx.beginPath();
            let currR = rStart;
            for (let i = 0; i < segments; i++) {
                const jitter = (Math.random() - 0.5) * 0.05; // Jitter angle
                ctx.moveTo(orbitCx + Math.cos(angleMid + jitter) * currR, orbitCy + Math.sin(angleMid + jitter) * currR);
                currR += step;
                ctx.lineTo(orbitCx + Math.cos(angleMid - jitter) * currR, orbitCy + Math.sin(angleMid - jitter) * currR);
            }
            ctx.stroke();
        }

        // --- RECOVERY (Yellow Dots) ---
        if (recoveryCount > 0) {
            // Draw a dot at the end of the activity
            const totalMins = focusMins + driftMins;
            const r = minRadius + (totalMins / 60) * (maxRadius - minRadius) + 15; // Floating above

            ctx.fillStyle = COLORS.recovery;
            ctx.beginPath();
            ctx.arc(orbitCx + Math.cos(angleMid) * r, orbitCy + Math.sin(angleMid) * r, 5, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    // Orbit Labels
    ctx.font = '700 28px Inter';
    ctx.fillStyle = COLORS.text;
    ctx.textAlign = 'center';
    ctx.fillText('ATTENTION SIGNATURE', orbitCx, orbitCy + 420);

    // Narrative Sentence
    const narrative = generateNarrative(data, totalFocusMinutes, totalDriftMinutes);
    ctx.font = '400 20px Inter';
    ctx.fillStyle = COLORS.textDim;
    ctx.fillText(narrative, orbitCx, orbitCy + 460);


    // 4. Icon Row (Focus Territory)
    const catY = 1150;
    const catIcons: any = {
        'editor': '💻', 'browser': '🌐', 'messaging': '💬', 'video': '▶️',
        'game': '🎮', 'notes': '📝', 'design': '🎨', 'other': '📱'
    };

    const categories = data.focusByCategory.slice(0, 5); // Top 5 to fit nicely
    const totalCatWidth = categories.length * 160;
    const startCatX = (W - totalCatWidth) / 2 + 80;

    categories.forEach((cat: any, i: number) => {
        const x = startCatX + i * 160;
        const icon = catIcons[cat.category] || '📱';

        // Soft arc/glow behind
        ctx.fillStyle = 'rgba(255, 255, 255, 0.03)';
        ctx.beginPath();
        ctx.arc(x, catY, 50, 0, Math.PI * 2);
        ctx.fill();

        // Icon
        ctx.font = '50px Arial';
        ctx.fillStyle = '#FFFFFF';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(icon, x, catY);

        // Label: "Editor"
        ctx.font = '600 18px Inter';
        ctx.fillStyle = COLORS.text;
        ctx.textBaseline = 'alphabetic';
        ctx.fillText(cat.category.charAt(0).toUpperCase() + cat.category.slice(1), x, catY + 70);

        // Sub-label: "(97%)"
        ctx.font = '400 16px Inter';
        ctx.fillStyle = COLORS.textDim;
        ctx.fillText(`(${Math.round(cat.share * 100)}%)`, x, catY + 95);
    });


    // 5. Stats Grid (Hierarchy)
    const gridY = 1380;
    const col1 = 200;
    const col2 = 540; // Center
    const col3 = 880;

    // Row 1: BIG STATS (Minutes)
    drawStat(ctx, 'DEEP FOCUS', `${totalFocusMinutes}m`, col1, gridY, true, COLORS.focus);
    drawStat(ctx, 'DRIFT WEATHER', `${totalDriftMinutes}m`, col2, gridY, true, COLORS.drift);
    drawStat(ctx, 'DAILY AVG', `${data.averageDailyFocusMinutes}m`, col3, gridY, true, COLORS.text);

    // Row 2: Secondary Stats
    const row2Y = gridY + 140;
    drawStat(ctx, 'STABILITY', `${Math.round(data.attentionStabilityScore * 100)}%`, col1, row2Y, false);
    drawStat(ctx, 'LONGEST STREAK', `${data.longestFocusStreakMinutes}m`, col2, row2Y, false);
    drawStat(ctx, 'RECOVERY PTS', data.totalRecoveryPoints, col3, row2Y, false, COLORS.recovery);


    // 6. Badges (Habitat & Nemesis)
    const badgeY = 1620;

    // Habitat
    const habitatCat = data.focusByCategory[0]?.category || 'Unknown';
    const habitatApp = data.focusByCategory[0]?.dominant_app || habitatCat;
    // Use specific app name if available and not 'Unknown'
    const habitatLabel = (habitatApp !== 'Unknown' && habitatApp !== habitatCat) ? habitatApp : habitatCat;

    drawBadge(ctx, 'Home Turf', habitatLabel, catIcons[habitatCat], 100, badgeY, COLORS.focus);

    // Nemesis
    const nemesisCat = data.nemesisCategory || 'None';
    const nemesisApp = data.nemesisApp || nemesisCat;
    const nemesisLabel = (nemesisApp !== 'Unknown' && nemesisApp !== nemesisCat) ? nemesisApp : nemesisCat;

    drawBadge(ctx, 'Nemesis', nemesisLabel, catIcons[nemesisCat], 560, badgeY, COLORS.drift);


    // 7. Passport Strip (MRZ Style)
    const stripY = H - 160;
    ctx.fillStyle = '#050810'; // Darker black
    ctx.fillRect(0, stripY, W, 160);

    // Scanlines
    ctx.fillStyle = 'rgba(255, 255, 255, 0.03)';
    for (let i = 0; i < 160; i += 4) {
        ctx.fillRect(0, stripY + i, W, 1);
    }

    // Adjusted font size and spacing to fit
    ctx.font = '400 24px "JetBrains Mono", monospace';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.textAlign = 'left';
    // ctx.letterSpacing = '2px'; // Canvas doesn't support letterSpacing easily in all browsers, skipping for now or use workaround

    // Encode in MINUTES
    const stripText1 = `2025<<OVELO<<${data.username}<<FOCUS${totalFocusMinutes}M<<DRIFT${totalDriftMinutes}M<<RECOV${data.totalRecoveryPoints}<<`;
    const stripText2 = `STAB${Math.round(data.attentionStabilityScore * 100)}PCT<<PEAK${data.bestHourOfDay * 60}M<<OVELO.APP<<<<<<<<<<<<<<<<<<<<`;

    ctx.fillText(stripText1, 40, stripY + 60);
    ctx.fillText(stripText2, 40, stripY + 110);
}

function drawStat(ctx: CanvasRenderingContext2D, label: string, value: any, x: number, y: number, isBig: boolean, color = '#F8FAFC') {
    ctx.textAlign = 'center';
    ctx.font = '500 18px Inter';
    ctx.fillStyle = COLORS.textDim;
    ctx.fillText(label, x, y);

    ctx.font = isBig ? '900 64px Inter' : '700 42px Inter';
    ctx.fillStyle = color;
    // Add glow for big stats
    if (isBig) {
        ctx.shadowColor = color;
        ctx.shadowBlur = 15;
    }
    ctx.fillText(value, x, y + (isBig ? 70 : 50));
    ctx.shadowBlur = 0;
}

function drawBadge(ctx: CanvasRenderingContext2D, label: string, value: string, icon: string, x: number, y: number, accentColor: string) {
    ctx.fillStyle = '#1E293B';
    ctx.beginPath();
    // @ts-ignore
    if (ctx.roundRect) {
        // @ts-ignore
        ctx.roundRect(x, y, 420, 90, 16);
    } else {
        ctx.rect(x, y, 420, 90);
    }
    ctx.fill();

    // Accent bar
    ctx.fillStyle = accentColor;
    ctx.fillRect(x, y, 8, 90);

    ctx.textAlign = 'left';
    ctx.font = '500 20px Inter';
    ctx.fillStyle = COLORS.textDim;
    ctx.fillText(label, x + 30, y + 35);

    // Truncate if too long
    let displayValue = value.toUpperCase();
    if (displayValue.length > 15) displayValue = displayValue.substring(0, 14) + '...';

    ctx.font = '700 28px Inter';
    ctx.fillStyle = COLORS.text;
    ctx.fillText(`${icon || '❓'} ${displayValue}`, x + 30, y + 70);
}

function generateNarrative(data: any, focusMins: number, driftMins: number) {
    // Simple logic to generate a sentence
    const peakHour = data.bestHourOfDay;
    const peakTime = `${peakHour}:00`;

    if (focusMins > driftMins * 2) {
        return `Your focus was unbreakable, peaking around ${peakTime}.`;
    } else if (focusMins > driftMins) {
        return `You maintained steady focus, with your best work at ${peakTime}.`;
    } else {
        return `Drift pressure was high, but you rallied around ${peakTime}.`;
    }
}

export default Passport;
