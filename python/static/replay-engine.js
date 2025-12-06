// NOTE: Real app logos would require loading actual image files.
// For now using emojis. To use real logos, you'd need to:
// 1. Create a `logos` folder with PNG files for each app
// 2. Load images in constructor: new Image(); img.src =  'logos/chrome.png'
// 3. Use ctx.drawImage() instead of fillText() for icons

class FocusReplayEngine {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.segments = [];
        this.bars = [];
        this.isPlaying = false;
        this.isPaused = false;
        this.currentTime = 0;
        this.totalDuration = 20;
        this.playbackSpeed = 1;
        this.animationId = null;
        this.lastTimestamp = 0;

        this.stats = { clicks: 0, keystrokes: 0, scrolls: 0, switches: 0 };

        this.appIconMap = {
            'chrome': { icon: '🌐', name: 'Chrome' }, 'firefox': { icon: '🌐', name: 'Firefox' },
            'edge': { icon: '🌐', name: 'Edge' }, 'discord': { icon: '💬', name: 'Discord' },
            'slack': { icon: '💬', name: 'Slack' }, 'steam': { icon: '🎮', name: 'Steam' },
            'youtube': { icon: '▶️', name: 'YouTube' }, 'vscode': { icon: '💻', name: 'VS Code' },
            'visual studio': { icon: '💻', name: 'Visual Studio' }, 'notepad': { icon: '📝', name: 'Notepad' }
        };

        this.setupCanvas();
    }

    setupCanvas() {
        this.canvas.width = 540;
        this.canvas.height = 960;
    }

    async loadData() {
        try {
            const response = await fetch('/api/replay');
            const data = await response.json();
            this.segments = data.replay_segments || [];

            this.segments.forEach(seg => {
                if (seg.metrics) {
                    this.stats.switches += seg.metrics.switches || 0;
                    this.stats.keystrokes += seg.metrics.keystrokes || 0;
                }
            });

            this.stats.clicks = Math.floor(this.stats.keystrokes * 0.3);
            this.stats.scrolls = Math.floor(this.stats.keystrokes * 0.5);

            this.compressTo20Bars();
        } catch (error) {
            console.error('Error loading replay data:', error);
        }
    }

    compressTo20Bars() {
        if (this.segments.length === 0) return;

        const TARGET_BARS = 20;
        const segmentsPerBar = Math.max(1, Math.ceil(this.segments.length / TARGET_BARS));
        this.bars = [];

        for (let i = 0; i < this.segments.length; i += segmentsPerBar) {
            const chunk = this.segments.slice(i, i + segmentsPerBar);
            if (chunk.length === 0) continue;

            const states = chunk.map(s => s.state);
            const stateCount = {};
            states.forEach(s => stateCount[s] = (stateCount[s] || 0) + 1);
            const dominantState = Object.keys(stateCount).reduce((a, b) => stateCount[a] > stateCount[b] ? a : b);

            const avgIntensity = chunk.reduce((sum, s) => sum + s.intensity, 0) / chunk.length;

            const apps = chunk.map(s => s.dominant_app).filter(a => a && a !== 'Unknown');
            let dominantApp = 'Unknown';
            if (apps.length > 0) {
                const appCount = {};
                apps.forEach(a => appCount[a] = (appCount[a] || 0) + 1);
                dominantApp = Object.keys(appCount).reduce((a, b) => appCount[a] > appCount[b] ? a : b);
            }

            this.bars.push({
                state: dominantState,
                intensity: avgIntensity,
                app: dominantApp,
                startTime: (this.bars.length / TARGET_BARS) * this.totalDuration
            });
        }
    }

    getAppDisplay(appName) {
        if (!appName || appName === 'Unknown') return null;
        const lower = appName.toLowerCase();
        for (const [key, data] of Object.entries(this.appIconMap)) {
            if (lower.includes(key)) return data;
        }
        const firstWord = appName.split(/[\s\-\.]/)[0];
        return { icon: '📱', name: firstWord };
    }

    start() {
        this.isPlaying = true;
        this.isPaused = false;
        this.currentTime = 0;
        this.lastTimestamp = performance.now();
        this.animate(this.lastTimestamp);
    }

    pause() {
        this.isPaused = !this.isPaused;
    }

    restart() {
        this.currentTime = 0;
        if (!this.isPlaying) this.start();
    }

    setSpeed(speed) {
        this.playbackSpeed = speed;
    }

    animate(timestamp) {
        if (!this.isPlaying) return;

        if (!this.isPaused) {
            const delta = (timestamp - this.lastTimestamp) / 1000;
            this.currentTime += delta * this.playbackSpeed;

            if (this.currentTime >= this.totalDuration) {
                this.currentTime = this.totalDuration;
                this.isPlaying = false;
            }
        }

        this.lastTimestamp = timestamp;
        this.render();

        if (this.currentTime < this.totalDuration) {
            this.animationId = requestAnimationFrame((t) => this.animate(t));
        }
    }

    render() {
        const bgGradient = this.ctx.createLinearGradient(0, 0, 0, this.canvas.height);
        bgGradient.addColorStop(0, '#0F172A');
        bgGradient.addColorStop(1, '#1E293B');
        this.ctx.fillStyle = bgGradient;
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        const inEndingPhase = this.currentTime > (this.totalDuration - 3);
        this.renderStats(inEndingPhase);

        const centerY = this.canvas.height / 2 + 50;
        const totalWidth = this.canvas.width * 0.9;
        const startX = (this.canvas.width - totalWidth) / 2;
        const barWidth = totalWidth / this.bars.length;

        const currentBarIndex = Math.floor((this.currentTime / this.totalDuration) * this.bars.length);

        let activeApp = null;
        let currentBar = null;

        this.bars.forEach((bar, index) => {
            if (index > currentBarIndex) return;

            const x = startX + index * barWidth;
            const progress = index < currentBarIndex ? 1 : (this.currentTime / this.totalDuration * this.bars.length) % 1;
            const actualWidth = barWidth * 0.9 * progress;

            this.renderBar(x, centerY, actualWidth, bar);

            if (index === currentBarIndex && progress > 0.3) {
                activeApp = this.getAppDisplay(bar.app);
                currentBar = bar;
            }
        });

        if (activeApp && currentBar) {
            const barX = startX + currentBarIndex * barWidth;
            this.renderAppLabel(activeApp, barX + barWidth / 2, centerY, 1.0);
        }
    }

    renderStats(showTotal) {
        const y = 100;
        const centerX = this.canvas.width / 2;

        if (showTotal) {
            this.ctx.font = 'bold 20px Inter, sans-serif';
            this.ctx.textAlign = 'center';
            this.ctx.fillStyle = '#94A3B8';
            this.ctx.fillText('Today\'s Total', centerX, y - 20);

            this.ctx.font = 'bold 28px Inter, sans-serif';
            this.ctx.fillStyle = '#F8FAFC';
            const statsText = `${this.stats.keystrokes.toLocaleString()} keys  •  ${this.stats.clicks.toLocaleString()} clicks`;
            this.ctx.fillText(statsText, centerX, y + 10);

            this.ctx.font = '18px Inter, sans-serif';
            this.ctx.fillStyle = '#94A3B8';
            const secondaryText = `${this.stats.scrolls.toLocaleString()} scrolls  •  ${this.stats.switches} switches`;
            this.ctx.fillText(secondaryText, centerX, y + 40);
        } else {
            const currentBarIndex = Math.floor((this.currentTime / this.totalDuration) * this.bars.length);
            if (currentBarIndex >= 0 && currentBarIndex < this.bars.length) {
                const currentBar = this.bars[currentBarIndex];
                const appDisplay = this.getAppDisplay(currentBar.app);

                if (appDisplay) {
                    const barDuration = (this.totalDuration / this.bars.length);
                    const timeInApp = Math.floor(barDuration * 60);

                    this.ctx.font = 'bold 20px Inter, sans-serif';
                    this.ctx.textAlign = 'center';
                    this.ctx.fillStyle = '#94A3B8';
                    this.ctx.fillText(appDisplay.name, centerX, y - 10);

                    this.ctx.font = 'bold 32px Inter, sans-serif';
                    this.ctx.fillStyle = '#F8FAFC';
                    this.ctx.fillText(`${timeInApp} min`, centerX, y + 25);
                }
            }
        }
    }

    renderBar(x, y, width, bar) {
        let color, height;

        switch (bar.state) {
            case 'Focus Peak':
            case 'Light Focus':
                color = '#14B8A6';  // Green - all focus (tall bars)
                height = 90 + (bar.intensity * 120);
                break;
            case 'Drift Zone':
                color = '#F59E0B';  // Orange - drift (small bars)
                height = 50 + (bar.intensity * 80);
                break;
            case 'Recovery Point':
                color = '#F472B6';  // Pink - recovery
                height = 60 + (bar.intensity * 90);
                break;
            case 'Idle':
                color = '#64748B';  // Gray - idle
                height = 30;
                break;
            default:
                color = '#64748B';
                height = 40;
        }

        this.ctx.fillStyle = color;
        this.ctx.fillRect(x, y - height / 2, width, height);
    }

    renderAppLabel(appDisplay, x, y, opacity) {
        this.ctx.globalAlpha = opacity;

        this.ctx.font = '48px Arial';
        this.ctx.textAlign = 'center';
        this.ctx.textBaseline = 'middle';
        this.ctx.fillStyle = '#F8FAFC';
        this.ctx.fillText(appDisplay.icon, x, y - 120);

        this.ctx.font = 'bold 14px Inter, sans-serif';
        this.ctx.fillStyle = '#94A3B8';
        this.ctx.fillText(appDisplay.name, x, y - 70);

        this.ctx.globalAlpha = 1.0;
    }

    getCurrentTime() {
        return this.currentTime;
    }
}

let engine;
let mediaRecorder;
let recordedChunks = [];

document.addEventListener('DOMContentLoaded', async () => {
    const canvas = document.getElementById('replay-canvas');
    const loading = document.getElementById('loading');
    const controls = document.getElementById('controls');
    const playPauseBtn = document.getElementById('play-pause-btn');
    const playIcon = document.getElementById('play-icon');
    const restartBtn = document.getElementById('restart-btn');
    const speedBtns = document.querySelectorAll('.speed-btn');
    const exportBtn = document.getElementById('export-btn');
    const progress = document.getElementById('progress');
    const currentTimeEl = document.getElementById('current-time');
    const totalTimeEl = document.getElementById('total-time');

    engine = new FocusReplayEngine(canvas);
    await engine.loadData();
    loading.classList.add('hidden');
    controls.style.display = 'block';
    totalTimeEl.textContent = '0:20';

    playPauseBtn.addEventListener('click', () => {
        if (!engine.isPlaying) {
            engine.start();
            playIcon.textContent = '⏸';
        } else {
            engine.pause();
            playIcon.textContent = engine.isPaused ? '▶' : '⏸';
        }
    });

    restartBtn.addEventListener('click', () => {
        engine.restart();
        playIcon.textContent = '⏸';
    });

    speedBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            speedBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            engine.setSpeed(parseFloat(btn.dataset.speed));
        });
    });

    setInterval(() => {
        const curTime = engine.getCurrentTime();
        progress.style.width = `${(curTime / engine.totalDuration) * 100}%`;
        currentTimeEl.textContent = `0:${Math.floor(curTime).toString().padStart(2, '0')}`;
    }, 100);

    exportBtn.addEventListener('click', async () => { await exportReplay(); });
});

async function exportReplay() {
    const modal = document.getElementById('export-modal');
    const exportProgress = document.getElementById('export-progress');
    const exportStatus = document.getElementById('export-status');

    modal.classList.add('active');
    exportStatus.textContent = 'Preparing...';
    recordedChunks = [];

    try {
        engine.currentTime = 0;
        engine.isPlaying = false;
        engine.isPaused = false;
        engine.render();

        await new Promise(r => setTimeout(r, 100));

        const stream = engine.canvas.captureStream(60);
        let mimeType = 'video/webm;codecs=vp8';
        if (MediaRecorder.isTypeSupported('video/webm;codecs=vp9')) {
            mimeType = 'video/webm;codecs=vp9';
        }

        mediaRecorder = new MediaRecorder(stream, {
            mimeType: mimeType,
            videoBitsPerSecond: 8000000
        });

        mediaRecorder.ondataavailable = (e) => {
            if (e.data && e.data.size > 0) {
                recordedChunks.push(e.data);
            }
        };

        mediaRecorder.onstop = () => {
            if (recordedChunks.length === 0) {
                exportStatus.textContent = 'No data';
                setTimeout(() => modal.classList.remove('active'), 2000);
                return;
            }

            const blob = new Blob(recordedChunks, { type: mimeType });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `ovelo-replay-${Date.now()}.webm`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setTimeout(() => URL.revokeObjectURL(url), 1000);

            exportStatus.textContent = 'Done!';
            setTimeout(() => modal.classList.remove('active'), 1500);
        };

        mediaRecorder.start(100);
        exportStatus.textContent = 'Recording...';

        await new Promise(r => setTimeout(r, 50));

        engine.isPlaying = true;
        engine.lastTimestamp = performance.now();
        engine.animate(engine.lastTimestamp);

        const progInt = setInterval(() => {
            const pct = (engine.getCurrentTime() / engine.totalDuration) * 100;
            exportProgress.style.width = `${pct}%`;
            exportStatus.textContent = `Recording... ${Math.floor(pct)}%`;

            if (engine.getCurrentTime() >= engine.totalDuration || !engine.isPlaying) {
                clearInterval(progInt);
                exportStatus.textContent = 'Finalizing...';
                setTimeout(() => mediaRecorder.stop(), 500);
            }
        }, 100);

    } catch (error) {
        console.error('Error:', error);
        exportStatus.textContent = `Failed: ${error.message}`;
        setTimeout(() => modal.classList.remove('active'), 3000);
    }
}
