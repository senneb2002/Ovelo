import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Link, useNavigate } from 'react-router-dom';
import { isPermissionGranted, requestPermission, sendNotification } from '@tauri-apps/plugin-notification';
import { generateReflectionApi } from './services/api';
import { check } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';

import "./App.css";

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

function App() {
  const navigate = useNavigate();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [loading, setLoading] = useState(true);
  const [reflection, setReflection] = useState<string>("Your day is still taking shape. Check back later for a reflection.");
  const [stats, setStats] = useState({ focus: "--", stability: "--" });
  const [generating, setGenerating] = useState(false);
  const [tooltip, setTooltip] = useState<{ show: boolean, x: number, y: number, content: string }>({ show: false, x: 0, y: 0, content: "" });
  const [currentPersona, setCurrentPersona] = useState<string>("calm_coach");
  const [backendError, setBackendError] = useState(false);

  // History state
  const [showHistory, setShowHistory] = useState(false);
  const [reflectionHistory, setReflectionHistory] = useState<any[]>([]);
  const [selectedReflection, setSelectedReflection] = useState<any>(null);

  // Paywall state
  const [freeRemaining, setFreeRemaining] = useState<number | null>(null);
  const [requiresUpgrade, setRequiresUpgrade] = useState(false);
  const [isPreview, setIsPreview] = useState(false);

  // Store timeline data for tooltip interaction
  const timelineDataRef = useRef<any[]>([]);
  const barPositionsRef = useRef<any[]>([]);

  // Sync device ID with backend on startup
  async function syncDeviceId() {
    try {
      // FETCH from backend first (Hardware ID)
      const res: any = await invoke("get_device_id");
      if (res && res.success && res.deviceId) {
        // Update local storage to match the persistent hardware ID
        console.log("Synced Hardware Device ID:", res.deviceId);
        localStorage.setItem("machine_fingerprint", res.deviceId);
      } else {
        // Fallback (should typically not happen if backend is running)
        let deviceId = localStorage.getItem("machine_fingerprint");
        if (!deviceId) {
          deviceId = crypto.randomUUID();
          localStorage.setItem("machine_fingerprint", deviceId);
        }
        await invoke("sync_device_id", { deviceId });
      }
    } catch (error) {
      console.error('Error syncing device ID:', error);
      // Don't show backend error immediately on this, wait for loadData
    }
  }

  async function forceStartServer() {
    try {
      setLoading(true);
      await invoke('force_start_server');
      console.log("Force start command sent");
      // Wait a bit before reloading data to give server time to start
      setTimeout(() => {
        setBackendError(false);
        setLoading(false);
        loadData();
      }, 5000);
    } catch (e) {
      console.error("Failed to force start server", e);
      setLoading(false);
      sendNotification({
        title: 'Force Start Failed',
        body: `Error: ${e}`
      });
    }
  }

  useEffect(() => {
    syncDeviceId();
    checkProfile();
    loadData();
    const interval = setInterval(loadData, 60000); // Refresh every minute

    window.addEventListener('resize', handleResize);

    // Auto-update check
    // Auto-update check
    const checkForUpdates = async () => {
      try {
        const update = await check();
        if (update?.available) {
          sendNotification({
            title: 'Update Available',
            body: `Update to ${update.version} available! Downloading...`
          });
          console.log(`Update to ${update.version} available! Downloading...`);
          await update.downloadAndInstall();

          sendNotification({
            title: 'Update Ready',
            body: "Update installed, relaunching..."
          });
          console.log("Update installed, relaunching...");
          await relaunch();
        } else {
          // Optional: Notify that no update was found (good for debugging, maybe remove later)
          /* sendNotification({
             title: 'No Update',
             body: "You are on the latest version."
          }); */
          console.log("No update available.");
        }
      } catch (error) {
        console.error('Error checking for updates:', error);
        sendNotification({
          title: 'Update Check Failed',
          body: `Error: ${error}`
        });
      }
    };
    checkForUpdates();

    return () => {
      clearInterval(interval);
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  const handleResize = () => {
    if (timelineDataRef.current.length > 0) {
      resizeCanvas();
      drawTimeline(timelineDataRef.current);
    }
  };

  async function checkProfile() {
    try {
      const profile: any = await invoke("get_profile");
      if (profile && Object.keys(profile).length > 0) {
        if (profile.reflectionPersona) {
          setCurrentPersona(profile.reflectionPersona);
        }
      } else {
        // No profile found, redirect to onboarding
        navigate('/onboarding');
      }
    } catch (error) {
      console.error('Error checking profile:', error);
      setBackendError(true);
    }
  }

  // Check and send morning notification
  async function checkMorningNotification(reflectionText: string) {
    try {
      const now = new Date();
      const hour = now.getHours();

      // Only notify between 8 AM and 11 AM
      if (hour < 8 || hour > 11) return;

      // Check if already notified today
      const today = now.toISOString().split('T')[0];
      const lastNotified = localStorage.getItem('ovelo_last_notification_date');
      if (lastNotified === today) return;

      // Check permission and request if needed
      let permissionGranted = await isPermissionGranted();
      if (!permissionGranted) {
        const permission = await requestPermission();
        permissionGranted = permission === 'granted';
      }

      if (permissionGranted) {
        // Extract first sentence or first 100 chars as preview
        const preview = reflectionText.length > 100
          ? reflectionText.substring(0, 97) + '...'
          : reflectionText;

        sendNotification({
          title: 'Good morning! ☀️',
          body: preview
        });

        // Mark as notified today
        localStorage.setItem('ovelo_last_notification_date', today);
      }
    } catch (error) {
      console.error('Error sending morning notification:', error);
    }
  }

  async function loadData() {
    try {
      const data: any = await invoke("get_today_state");
      setLoading(false);

      if (data) {
        timelineDataRef.current = data.timeline || [];
        resizeCanvas();
        drawTimeline(data.timeline);

        if (data.reflection) {
          setReflection(data.reflection);
          // Try to send morning notification if conditions are met
          checkMorningNotification(data.reflection);
        }

        calculateStats(data.timeline);
      }
    } catch (error) {
      console.error('Error loading data:', error);
      setLoading(false);
      setBackendError(true);
    }
  }

  function resizeCanvas() {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Use getBoundingClientRect to get the actual displayed size
    const rect = canvas.getBoundingClientRect();
    // Set internal canvas size to match displayed size (1:1 ratio prevents scaling issues)
    canvas.width = rect.width;
    canvas.height = rect.height;
  }

  function calculateStats(timeline: any[]) {
    if (!timeline || timeline.length === 0) return;

    let focusDuration = 0;
    let driftDuration = 0;
    let totalActiveDuration = 0;

    // Iterate through timeline to calculate actual durations
    for (let i = 0; i < timeline.length; i++) {
      const current = timeline[i];

      // Determine duration of this point
      let duration = 0;
      if (i < timeline.length - 1) {
        const next = timeline[i + 1];
        duration = next.timestamp - current.timestamp;

        // Cap duration to avoid huge jumps (e.g. if app was closed)
        // Max 5 minutes per point if gap is huge
        if (duration > 300) duration = 5;
      } else {
        // Last point, assume 5 seconds (standard interval)
        duration = 5;
      }

      // Categorize duration
      if (current.state === 'Focus Peak' || current.state === 'Light Focus') {
        focusDuration += duration;
        totalActiveDuration += duration;
      } else if (current.state === 'Drift Zone') {
        driftDuration += duration;
        totalActiveDuration += duration;
      }
      // Idle and Recovery are ignored for "Stability" calculation but could be tracked
    }

    const stability = totalActiveDuration > 0 ? (focusDuration / totalActiveDuration) * 100 : 0;

    // Format Focus Time
    const focusMins = Math.round(focusDuration / 60);
    const hours = Math.floor(focusMins / 60);
    const mins = focusMins % 60;
    const timeStr = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;

    setStats({
      focus: `Focus: ${timeStr}`,
      stability: `Stability: ${Math.round(stability)}%`
    });
  }

  function drawTimeline(timeline: any[]) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

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

    // Pre-calculate heights
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

    // Smoothing
    const smoothedHeights = rawHeights.map((h, i) => {
      if (timeline[i].state === 'IdleGap') return h;
      if (i === 0 || i === rawHeights.length - 1) return h;
      return (rawHeights[i - 1] + h + rawHeights[i + 1]) / 3;
    });

    const barPositions: any[] = [];
    let currentX = 0;

    timeline.forEach((point, index) => {
      const height = smoothedHeights[index];
      // @ts-ignore
      const color = CONFIG.colors[point.state] || CONFIG.colors['Idle'];

      ctx.fillStyle = color;

      if (point.state === 'IdleGap') {
        const gapTotalWidth = widthPerUnit * 4;
        const barWidth = widthPerUnit * 0.5;

        ctx.globalAlpha = 0.3;
        ctx.fillRect(currentX, centerY - height / 2, barWidth, height);
        ctx.fillRect(currentX + gapTotalWidth - barWidth, centerY - height / 2, barWidth, height);
        ctx.globalAlpha = 1.0;

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
        ctx.fillRect(currentX, centerY - height / 2, widthPerUnit - 0.5, height);
        barPositions.push({ x: currentX, width: widthPerUnit - 0.5, index });
        currentX += widthPerUnit;
      }
    });

    // Recovery Points
    timeline.forEach((point, index) => {
      if (point.state === 'Recovery Point') {
        const barPos = barPositions[index];
        if (barPos) {
          const x = barPos.x + barPos.width / 2;
          const height = smoothedHeights[index];
          const y = centerY - height / 2 - 8;

          ctx.shadowColor = CONFIG.colors['Recovery Point'];
          ctx.shadowBlur = 10;
          ctx.fillStyle = CONFIG.colors['Recovery Point'];
          ctx.beginPath();
          ctx.arc(x, y, 4, 0, Math.PI * 2);
          ctx.fill();
          ctx.shadowBlur = 0;
        }
      }
    });

    barPositionsRef.current = barPositions;

    // Time Labels
    if (timeline.length > 0) {
      ctx.fillStyle = '#64748b';
      ctx.font = '12px Inter';
      ctx.textAlign = 'center';

      const minLabelSpacing = 100;
      let lastLabelX = -minLabelSpacing;

      timeline.forEach((point, i) => {
        if (point.state === 'IdleGap') return;

        const barPos = barPositions[i];
        if (!barPos) return;

        const x = barPos.x + barPos.width / 2;
        const timestamp = point.timestamp;
        const date = new Date(timestamp * 1000);
        const minutes = date.getMinutes();

        if (minutes <= 5 && (x - lastLabelX >= minLabelSpacing)) { // Relaxed to 5 mins
          const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });

          ctx.strokeStyle = '#334155';
          ctx.lineWidth = 0.5;
          ctx.setLineDash([2, 4]);
          ctx.beginPath();
          ctx.moveTo(x, centerY + 80);
          ctx.lineTo(x, canvas.height - 20);
          ctx.stroke();
          ctx.setLineDash([]);

          ctx.fillText(timeStr, x, canvas.height - 5);
          lastLabelX = x;
        }
      });
    }
  }

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    // Since canvas internal size matches display size, no scaling needed
    const mouseX = e.clientX - rect.left;

    const barPositions = barPositionsRef.current;
    let hoveredIndex = -1;

    for (let i = 0; i < barPositions.length; i++) {
      const bar = barPositions[i];
      if (mouseX >= bar.x && mouseX <= bar.x + bar.width) {
        hoveredIndex = bar.index;
        break;
      }
    }

    if (hoveredIndex >= 0 && hoveredIndex < timelineDataRef.current.length) {
      const point = timelineDataRef.current[hoveredIndex];

      let content = "";
      if (point.state === 'IdleGap') {
        const gapMinutes = Math.floor(point.gap_duration / 60);
        content = `<strong>Idle Gap</strong><br>Duration: ${gapMinutes} minutes<br>(System was idle)`;
      } else {
        const time = new Date(point.timestamp * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });
        content = `<strong>${time}</strong><br>State: ${point.state}<br>App: ${point.dominant_app || 'Unknown'}`;
      }

      // Position tooltip relative to the trace container, not viewport
      const container = canvas.parentElement;
      const containerRect = container?.getBoundingClientRect();
      const tooltipX = e.clientX - (containerRect?.left || 0) + 10;
      const tooltipY = e.clientY - (containerRect?.top || 0) - 70; // Position above cursor

      setTooltip({
        show: true,
        x: tooltipX,
        y: tooltipY,
        content: content
      });
    } else {
      setTooltip(prev => ({ ...prev, show: false }));
    }
  };

  const handleMouseLeave = () => {
    setTooltip(prev => ({ ...prev, show: false }));
  };

  async function generateReflection() {
    setGenerating(true);
    setReflection("Analyzing your day...");
    setIsPreview(false);
    setRequiresUpgrade(false);

    try {
      // First get the prompt data from local backend
      // First get the prompt data from local backend
      const date = new Date().toISOString().split('T')[0];
      console.log('[DEBUG] Calling generate_reflection...');
      const localRes: any = await invoke("generate_reflection", { date, persona: currentPersona });
      console.log('[DEBUG] generate_reflection returned:', localRes?.cached ? 'CACHED' : 'NEW PROMPT');

      // Helper function to save reflection to localStorage (reliable storage)
      const saveReflectionToHistory = (text: string, persona: string) => {
        console.log('[DEBUG] Saving reflection to localStorage...');
        try {
          const historyKey = 'ovelo_reflection_history';
          const existing = localStorage.getItem(historyKey);
          let history: any[] = [];
          if (existing) {
            try { history = JSON.parse(existing); } catch { }
          }

          // Add new reflection
          history.push({
            text,
            persona,
            timestamp: new Date().toISOString()
          });

          // Keep only last 30
          history = history.slice(-30);

          // Save to localStorage
          localStorage.setItem(historyKey, JSON.stringify(history));
          console.log('[DEBUG] Saved reflection #', history.length, 'to localStorage');

          // Also update state
          setReflectionHistory([...history].reverse());
        } catch (saveError) {
          console.error('[DEBUG] Save reflection error:', saveError);
        }
      };

      // FIX: If we have a cached reflection, display it directly. 
      // Do NOT send it back to the API as a prompt (which causes "blandness").
      if (localRes.cached && localRes.reflection) {
        console.log("Using cached reflection");
        setReflection(localRes.reflection);
        // Still save cached reflections to history
        saveReflectionToHistory(localRes.reflection, currentPersona);
        setGenerating(false);
        return;
      }

      const prompt = localRes.prompt || localRes.reflection || "";

      // Call Supabase API which handles paywall
      console.log('[DEBUG] Calling Supabase API...');
      const res = await generateReflectionApi(prompt, currentPersona, date);
      console.log('[DEBUG] Supabase API returned');

      // Update paywall state
      setFreeRemaining(res.freeRemaining);
      setRequiresUpgrade(res.requiresUpgrade);
      setIsPreview(res.isPreview);

      let cleanText = res.text || "";
      cleanText = cleanText.replace(/^Reflection:\s*/i, '');
      cleanText = cleanText.replace(/\n\s*Suggestion:\s*/i, '\n\n');
      cleanText = cleanText.trim();

      setReflection(cleanText);

      // Save for persistence across reloads - call Flask API directly
      saveReflectionToHistory(cleanText, currentPersona);
    } catch (e) {
      console.error("Error generating reflection", e);
      setReflection("Error generating reflection.");
    } finally {
      setGenerating(false);
    }
  }

  // Load reflection history from localStorage
  function loadReflectionHistory() {
    try {
      const historyKey = 'ovelo_reflection_history';
      const existing = localStorage.getItem(historyKey);
      if (existing) {
        const history = JSON.parse(existing);
        // Return in reverse order (newest first)
        setReflectionHistory([...history].reverse());
        console.log('[DEBUG] Loaded', history.length, 'reflections from localStorage');
      }
    } catch (e) {
      console.error("Error loading reflection history:", e);
    }
  }

  // Toggle history view
  function toggleHistory() {
    if (!showHistory) {
      loadReflectionHistory();
    }
    setShowHistory(!showHistory);
  }

  // View a specific past reflection
  function viewHistoryItem(item: any) {
    setReflection(item.text);
    setSelectedReflection(item);
    setShowHistory(false);
  }

  // Format date for display
  function formatDate(isoString: string) {
    const date = new Date(isoString);
    return date.toLocaleDateString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  // Get persona display name
  function getPersonaName(persona: string) {
    const names: Record<string, string> = {
      'calm_coach': '🧘 Calm Coach',
      'scientist': '🔬 Scientist',
      'no_bullshit': '💪 No BS',
      'unhinged': '🔥 Unhinged',
      'ceo': '👔 CEO'
    };
    return names[persona] || persona;
  }

  // Strip markdown for clean preview text
  function stripMarkdown(text: string): string {
    return text
      .replace(/^#{1,3}\s+/gm, '')  // Remove headers (##, ###)
      .replace(/\*\*(.*?)\*\*/g, '$1')  // Remove bold **
      .replace(/\*(.*?)\*/g, '$1')  // Remove italic *
      .replace(/\n+/g, ' ')  // Replace newlines with spaces
      .trim();
  }

  // Helper to render reflection with highlights and paragraphs
  // Helper to render reflection with highlights, paragraphs, and headers
  const renderReflectionContent = () => {
    if (!reflection) return null;
    let formatted = reflection;

    // Headers (simple markdown)
    formatted = formatted.replace(/^### (.*$)/gim, '<h3>$1</h3>');
    formatted = formatted.replace(/^## (.*$)/gim, '<h2>$1</h2>');

    // Bold (double asterisks)
    formatted = formatted.replace(/\*\*(.*?)\*\*/g, '<span class="highlight-text">$1</span>');
    // Bold (single asterisks) - user requested *word* to be bold
    formatted = formatted.replace(/\*([^\s*](?:[^*]*?[^\s*])?)\*/g, '<span class="highlight-text">$1</span>');

    // Split by double newlines to identify paragraphs vs headers
    // We already converted headers to HTML, so they will be distinct lines if there were newlines
    // But regex replace leaves the string intact. 
    // Let's rely on splitting by \n\n
    const parts = formatted.split(/\n\n+/);

    const html = parts.map(part => {
      const trimmed = part.trim();
      if (trimmed.startsWith('<h2') || trimmed.startsWith('<h3')) {
        return trimmed; // It's a header, return as is
      }
      // It's a paragraph
      return `<p>${part.replace(/\n/g, '<br/>')}</p>`;
    }).join('');

    return <div className="reflection-text" dangerouslySetInnerHTML={{ __html: html }} />;
  };

  if (backendError) {
    return (
      <div className="app-container" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', padding: '20px', textAlign: 'center', background: '#0f172a' }}>
        <div style={{ maxWidth: '500px' }}>
          <h2 style={{ color: '#ef4444', marginBottom: '10px' }}>Backend Service Failed</h2>
          <p style={{ marginBottom: '20px', color: '#cbd5e1' }}>The Ovelo background service could not start.</p>

          <div style={{ background: '#1e293b', padding: '15px', borderRadius: '8px', textAlign: 'left', marginBottom: '20px' }}>
            <p style={{ marginBottom: '8px', fontSize: '0.9em', color: '#94a3b8' }}>Please check the crash log:</p>
            <div style={{ display: 'flex', gap: '10px' }}>
              <code style={{ display: 'block', background: '#0f172a', padding: '8px', borderRadius: '4px', width: '100%', fontFamily: 'monospace', color: '#e2e8f0' }}>%APPDATA%\Ovelo\server.log</code>
            </div>
          </div>

          <div style={{ textAlign: 'left', fontSize: '0.9em', color: '#cbd5e1', lineHeight: '1.6' }}>
            <strong>To investigate:</strong>
            <ol style={{ paddingLeft: '20px', marginTop: '5px', color: '#94a3b8' }}>
              <li>Press <code>Windows + R</code> on your keyboard.</li>
              <li>Paste <code>%APPDATA%\Ovelo</code> and press Enter.</li>
              <li>Open <code>server.log</code> and share the content.</li>
            </ol>
          </div>

          <button
            onClick={() => window.location.reload()}
            style={{ marginTop: '30px', padding: '10px 20px', background: '#334155', border: 'none', borderRadius: '6px', color: 'white', cursor: 'pointer', fontSize: '1em', marginRight: '10px' }}
          >
            Retry Connection
          </button>

          <button
            onClick={forceStartServer}
            style={{ marginTop: '30px', padding: '10px 20px', background: '#dc2626', border: 'none', borderRadius: '6px', color: 'white', cursor: 'pointer', fontSize: '1em' }}
          >
            {loading ? "Starting..." : "Force Start Server"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="app-container">
      <header>
        <div className="logo">Ovelo</div>
        <div className="date" id="current-date">Today</div>
        <Link to="/settings.html" className="profile-btn" title="Settings">⚙️</Link>
      </header>

      <main>
        <section className="trace-section">
          <h2>Day Trace</h2>
          <div className="trace-container" id="trace-container">
            <canvas
              id="trace-canvas"
              ref={canvasRef}
              onMouseMove={handleMouseMove}
              onMouseLeave={handleMouseLeave}
            ></canvas>
            {loading && <div className="loading-state" id="loading">Waiting for data...</div>}
            {tooltip.show && (
              <div
                id="tooltip"
                className="tooltip"
                style={{ display: 'block', left: tooltip.x, top: tooltip.y }}
                dangerouslySetInnerHTML={{ __html: tooltip.content }}
              ></div>
            )}
          </div>
          <div className="legend">
            <span className="legend-item"><span className="dot focus"></span> Focus Peak</span>
            <span className="legend-item"><span className="dot drift"></span> Drift Zone</span>
            <span className="legend-item"><span className="dot recovery"></span> Recovery Point</span>
            <span className="legend-item"><span className="dot idle"></span> Idle</span>
          </div>
        </section>

        <div className="replay-section" style={{ display: 'flex', gap: '20px' }}>
          <div className="stats-card" style={{ flex: 1 }}>
            <span className="replay-icon">📊</span>
            <div className="replay-text">
              <h3 id="stats-focus">{stats.focus}</h3>
              <p id="stats-stability">{stats.stability}</p>
            </div>
          </div>

          <Link to="/passport.html" className="replay-button"
            style={{ flex: 1, background: 'linear-gradient(135deg, rgba(53, 28, 112, 0.4) 0%, rgba(20, 184, 166, 0.1) 100%)' }}>
            <span className="replay-icon">🎫</span>
            <div className="replay-text">
              <h3>Ovelo Passport</h3>
              <p>Focus Identity Card</p>
            </div>
          </Link>
        </div>

        <section className="reflection-section">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <h2 style={{
                margin: 0,
                background: 'linear-gradient(135deg, #818CF8, #2DD4BF)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text'
              }}>Ovelo Reflection</h2>
              {selectedReflection && (
                <span style={{ fontSize: '0.75rem', color: '#64748b' }}>
                  {formatDate(selectedReflection.timestamp)}
                </span>
              )}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              {freeRemaining !== null && (
                <span style={{
                  padding: '0.25rem 0.75rem',
                  borderRadius: '12px',
                  fontSize: '0.75rem',
                  fontWeight: 500,
                  background: freeRemaining > 0
                    ? 'linear-gradient(135deg, rgba(20, 184, 166, 0.2), rgba(20, 184, 166, 0.1))'
                    : 'linear-gradient(135deg, rgba(245, 158, 11, 0.2), rgba(245, 158, 11, 0.1))',
                  color: freeRemaining > 0 ? '#14b8a6' : '#f59e0b',
                  border: `1px solid ${freeRemaining > 0 ? 'rgba(20, 184, 166, 0.3)' : 'rgba(245, 158, 11, 0.3)'}`
                }}>
                  {freeRemaining > 0 ? `${freeRemaining} free left` : 'Free reflections used'}
                </span>
              )}
              <button
                onClick={toggleHistory}
                title="View past reflections"
                style={{
                  background: showHistory ? 'rgba(20, 184, 166, 0.2)' : 'rgba(100, 116, 139, 0.2)',
                  border: 'none',
                  borderRadius: '8px',
                  padding: '0.5rem 0.75rem',
                  cursor: 'pointer',
                  fontSize: '0.875rem',
                  color: showHistory ? '#14b8a6' : '#94a3b8',
                  transition: 'all 0.2s'
                }}
              >
                📜 {showHistory ? 'Hide' : 'History'}
              </button>
            </div>
          </div>

          {/* History Panel */}
          {showHistory && (
            <div className="reflection-history-panel" style={{
              background: 'rgba(30, 41, 59, 0.8)',
              borderRadius: '12px',
              padding: '1rem',
              marginBottom: '1rem',
              maxHeight: '300px',
              overflowY: 'auto',
              border: '1px solid rgba(100, 116, 139, 0.2)'
            }}>
              <h4 style={{ margin: '0 0 0.75rem 0', color: '#94a3b8', fontSize: '0.875rem' }}>Past Reflections</h4>
              {reflectionHistory.length === 0 ? (
                <p style={{ color: '#64748b', fontSize: '0.875rem' }}>No past reflections yet.</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {reflectionHistory.slice(0, 5).map((item, index) => (
                    <div
                      key={index}
                      onClick={() => viewHistoryItem(item)}
                      style={{
                        background: 'rgba(15, 23, 42, 0.6)',
                        borderRadius: '8px',
                        padding: '0.75rem',
                        cursor: 'pointer',
                        transition: 'all 0.2s',
                        border: '1px solid transparent'
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.border = '1px solid rgba(20, 184, 166, 0.3)'}
                      onMouseLeave={(e) => e.currentTarget.style.border = '1px solid transparent'}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.25rem' }}>
                        <span style={{ fontSize: '0.75rem', color: '#14b8a6' }}>{getPersonaName(item.persona)}</span>
                        <span style={{ fontSize: '0.7rem', color: '#64748b' }}>{formatDate(item.timestamp)}</span>
                      </div>
                      <p style={{
                        margin: 0,
                        fontSize: '0.8rem',
                        color: '#cbd5e1',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap'
                      }}>
                        {stripMarkdown(item.text).substring(0, 80)}...
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="reflection-card" style={{ position: 'relative' }}>
            {renderReflectionContent()}

            {/* Paywall overlay */}
            {requiresUpgrade && isPreview && (
              <div style={{
                position: 'absolute',
                bottom: 0,
                left: 0,
                right: 0,
                height: '70%',
                background: 'linear-gradient(to bottom, transparent 0%, rgba(15, 23, 42, 0.95) 30%, rgba(15, 23, 42, 1) 100%)',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'flex-end',
                paddingBottom: '1.5rem',
                borderRadius: '0 0 16px 16px'
              }}>
                <p style={{ color: '#94a3b8', marginBottom: '1rem', fontSize: '0.9rem' }}>
                  ✨ Upgrade to Pro for full reflections
                </p>
                <Link
                  to="/settings.html"
                  className="action-btn"
                  style={{ textDecoration: 'none', padding: '0.75rem 1.5rem' }}
                >
                  🚀 Upgrade to Ovelo Pro
                </Link>
              </div>
            )}

            <div style={{ marginTop: '1.5rem', textAlign: 'right' }}>
              <button
                id="generate-reflection-btn"
                className="action-btn"
                onClick={generateReflection}
                disabled={generating}
              >
                {generating ? "Thinking..." : "✨ Generate Reflection"}
              </button>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

export default App;
