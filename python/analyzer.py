import os
import requests
from datetime import datetime
from config import Config
from learning import LearningEngine

class FocusAnalyzer:
    def __init__(self):
        # Initialize Learning Engine to get dynamic thresholds
        self.learning = LearningEngine()
        self.profile = self.learning.load_profile()
        self.thresholds = self.profile.get('thresholds', {})
        self.activity_multiplier = self.thresholds.get('activity_multiplier', 1.0)
    
    def _get_device_id(self) -> str:
        """Get device ID from file or generate one."""
        device_file = os.path.join(Config.BASE_DIR, "device_id.txt")
        
        # Try to read from file
        if os.path.exists(device_file):
            with open(device_file, 'r') as f:
                device_id = f.read().strip()
                if device_id:
                    return device_id
        
        # Generate new UUID and save it
        import uuid
        device_id = str(uuid.uuid4())
        with open(device_file, 'w') as f:
            f.write(device_id)
        
        return device_id
    
    def _call_gemini_proxy(self, prompt: str, persona: str = "calm_coach") -> str:
        """Call the Supabase Edge Function to proxy Gemini API requests."""
        headers = {"Content-Type": "application/json"}
        if Config.SUPABASE_ANON_KEY:
            headers["apikey"] = Config.SUPABASE_ANON_KEY
            headers["Authorization"] = f"Bearer {Config.SUPABASE_ANON_KEY}"
        
        device_id = self._get_device_id()
        today = datetime.now().strftime('%Y-%m-%d')
        
        payload = {
            "prompt": prompt,
            "persona": persona,
            "deviceId": device_id,
            "date": today
        }
        
        print(f"[Reflection] Calling proxy with deviceId: {device_id}, date: {today}")
        
        try:
            resp = requests.post(
                Config.SUPABASE_REFLECTION_URL,
                headers=headers,
                json=payload,
                timeout=60
            )
            print(f"[Reflection] Response status: {resp.status_code}")
            
            resp.raise_for_status()
            data = resp.json()
            
            if "text" in data:
                return data["text"]
            elif "error" in data:
                return f"Error from proxy: {data['error']}"
            else:
                return str(data)
        except requests.exceptions.RequestException as e:
            print(f"[Reflection] Error: {e}")
            return f"Error calling reflection proxy: {e}"

    def process_day(self, raw_data, reference_data=None):
        """
        Process raw tracker data into a timeline of focus states.
        
        Args:
            raw_data: Data to process and display
            reference_data: Optional larger dataset to use for threshold calculation
        
        Returns a dict with 'timeline' (list of states) and 'stats'.
        """
        if not raw_data:
            return {'timeline': [], 'stats': {}}

        # Use reference_data for threshold calculation if provided, otherwise use raw_data
        threshold_data = reference_data if reference_data else raw_data

        # Pass 1: Calculate activity scores for all intervals
        micro_states = []
        activity_scores = []
        reference_activity_scores = []
        
        # Calculate activity scores for the data we're displaying
        for interval in raw_data:
            keystrokes = interval.get("keystrokes", 0)
            clicks = interval.get("mouse_clicks", 0)
            scrolls = interval.get("mouse_scrolls", 0)
            distance = interval.get("mouse_distance", 0)
            switches = interval.get("window_switches", 0)
            is_idle = interval.get("is_idle", False)
            
            # Calculate total activity score
            # EXCLUDED distance to match baselines (which don't track distance)
            activity_score = keystrokes + clicks * 2 + scrolls
            activity_scores.append(activity_score)
            
            # Basic intensity (for visualization)
            intensity = min(1.0, activity_score / 50.0)

            # Simple micro-state
            if is_idle:
                state = "Idle"
            elif switches > 2:
                state = "Fragmented"
            elif activity_score > 5:
                state = "HighFocus"
            else:
                state = "LowFocus"

            micro_states.append({
                "timestamp": interval["timestamp"],
                "micro_state": state,
                "intensity": intensity,
                "switches": switches,
                "keystrokes": keystrokes,
                "scrolls": scrolls,
                "activity_score": activity_score,
                "active_window": interval.get("active_window", "Unknown")
            })

        # Calculate reference activity scores for threshold determination
        for interval in threshold_data:
            keystrokes = interval.get("keystrokes", 0)
            clicks = interval.get("mouse_clicks", 0)
            scrolls = interval.get("mouse_scrolls", 0)
            activity_score = keystrokes + clicks * 2 + scrolls
            if not interval.get("is_idle", False):  # Only count non-idle intervals
                reference_activity_scores.append(activity_score)

        # DETERMINE THRESHOLD STRATEGY
        # Use percentile-based threshold from ALL historical data for natural focus detection
        focus_percentile = self.thresholds.get('focus_percentile')
        
        if focus_percentile is not None:
            # STRATEGY A: AI-Calibrated Percentile (Adaptive)
            sorted_activities = sorted(reference_activity_scores, reverse=True)
            threshold_index = int(len(sorted_activities) * (focus_percentile / 100.0))
            activity_threshold = sorted_activities[threshold_index] if sorted_activities else 5.0
            
        else:
            # STRATEGY B: Natural Percentile (45th = top 55% is focus)
            # This gives a balanced view where roughly half of activity shows as focus
            NATURAL_PERCENTILE = 45.0
            sorted_activities = sorted(reference_activity_scores, reverse=True)
            threshold_index = int(len(sorted_activities) * (NATURAL_PERCENTILE / 100.0))
            activity_threshold = sorted_activities[threshold_index] if sorted_activities and sorted_activities[threshold_index] > 0 else 5.0

        # Pass 2: Macro-state classification using AI threshold
        timeline = []
        window_size = 60  # 5 minutes

        for i in range(len(micro_states)):
            current = micro_states[i]
            start_idx = max(0, i - window_size // 2)
            end_idx = min(len(micro_states), i + window_size // 2)
            window = micro_states[start_idx:end_idx]
            
            # Key metrics
            avg_switches = sum(w["switches"] for w in window) / len(window)
            idle_count = sum(1 for w in window if w["micro_state"] == "Idle")
            avg_activity = sum(w["activity_score"] for w in window) / len(window)
            
            # App consistency
            apps = [w["active_window"] for w in window if w["active_window"]]
            dominant_app = max(set(apps), key=apps.count) if apps else "Unknown"
            
            final_state = "Drift Zone"
            sub_type = "Generic"

            # AI-DRIVEN CLASSIFICATION
            # Use the AI-determined threshold (not hardcoded values)
            
            if idle_count > len(window) * 0.8:
                # More than 80% idle = truly idle
                final_state = "Idle"
            elif avg_activity >= activity_threshold:
                # Activity above AI threshold = FOCUS (green)
                final_state = "Focus Peak"
                sub_type = "Deep Work"
            elif avg_activity >= activity_threshold * 0.5:
                # Moderate activity = light focus
                final_state = "Light Focus"
                sub_type = "Active Work"
            elif avg_switches > 2.0:
                # Low activity + high switching = drift
                final_state = "Drift Zone"
                sub_type = "Fragmented"
            else:
                # Low activity = drift
                final_state = "Drift Zone"
                sub_type = "Passive"
            
            # --- Recovery Detection (Refined) ---
            # Look for "Breathers" - short idle/low-activity periods (2-15 mins)
            # that occur after some activity, serving as a natural break.
            if final_state == "Idle":
                # Check duration of this idle block so far
                # We need to look ahead or track state changes. 
                # Simplified: If current is Idle, and previous was NOT Idle/Recovery, it's a potential start.
                # But we are processing interval by interval.
                
                # Better approach: Check if we are in a "Recovery Spot"
                # 1. Must be Idle
                # 2. Must follow a block of non-idle activity (at least 15 mins)
                # 3. Must not be too long (> 20 mins becomes just "Idle")
                
                lookback = 180 # 15 mins
                if i > lookback:
                    past_window = timeline[i-lookback:i]
                    # Check if previous window was mostly active (Focus or Drift)
                    active_count = sum(1 for t in past_window if t['state'] in ['Focus Peak', 'Light Focus', 'Drift Zone'])
                    
                    if active_count > lookback * 0.7: # 70% active in last 15 mins
                        # This is a recovery point
                        final_state = "Recovery Point"
                        sub_type = "Recharge"

            timeline.append({
                "timestamp": current["timestamp"],
                "state": final_state,
                "sub_type": sub_type,
                "intensity": current["intensity"],
                "dominant_app": dominant_app,
                "metrics": {
                    "keys": current["keystrokes"],
                    "clicks": current.get("mouse_clicks", 0), # Ensure these exist
                    "scrolls": current.get("mouse_scrolls", 0)
                }
            })
        
        # POST-PROCESS: Insert IdleGap markers for time skips
        # Scan timeline for gaps > 5 minutes and insert gap markers
        timeline_with_gaps = []
        GAP_THRESHOLD = 300  # 5 minutes in seconds
        
        for i, point in enumerate(timeline):
            if i > 0:
                prev_timestamp = timeline[i-1]["timestamp"]
                curr_timestamp = point["timestamp"]
                time_diff = curr_timestamp - prev_timestamp
                
                # If there's a gap > 5 minutes, insert an IdleGap marker
                if time_diff > GAP_THRESHOLD:
                    gap_marker = {
                        "timestamp": prev_timestamp + (time_diff // 2),  # Midpoint of gap
                        "state": "IdleGap",
                        "sub_type": "SystemOff",
                        "intensity": 0,
                        "dominant_app": "System",
                        "gap_duration": time_diff,
                        "metrics": {"keys": 0, "clicks": 0, "scrolls": 0}
                    }
                    timeline_with_gaps.append(gap_marker)
            
            timeline_with_gaps.append(point)
        
        return {'timeline': timeline_with_gaps}

    def generate_reflection(self, raw_data):
        """Generates a narrative reflection using Gemini based on the user's selected persona, using FULL raw data."""
        if not raw_data:
            return "No data recorded yet today."

        # Get user persona, name, and preferences
        persona = self.profile.get('reflectionPersona', 'calm_coach')
        user_name = self.profile.get('userName', self.profile.get('name', 'User'))
        clock_format = self.profile.get('clockFormat', '12h')  # 12h or 24h
        
        # --- Long-term Context ---
        # Load past reflections to give the AI context on user's journey
        past_reflections_text = ""
        try:
            history = self.profile.get('reflectionHistory', [])
            if history:
                # Get last 3 reflections
                recent_history = history[-3:]
                past_reflections_text = "PAST REFLECTIONS (Context for your response):\n"
                for item in recent_history:
                    ts = item.get('timestamp', '').split('T')[0]
                    text = item.get('text', '').replace('\n', ' ')
                    past_reflections_text += f"- [{ts}] {text[:150]}...\n"
        except Exception as e:
            print(f"Error loading history: {e}")

        # --- Visual Context (Graph Summary) ---
        # "See" the graph for the user
        processed = self.process_day(raw_data)
        timeline = processed.get('timeline', [])
        
        visual_summary = "VISUAL CONTEXT (What the user sees on their graph):\n"
        if not timeline:
            visual_summary += "- Empty graph (no data).\n"
        else:
            # Summarize the day in blocks
            # e.g. "09:00-11:00: Solid Focus Block (Teal)"
            current_block_state = timeline[0]['state']
            block_start_ts = timeline[0]['timestamp']
            
            for t in timeline:
                if t['state'] != current_block_state:
                    # End of block
                    duration_mins = (t['timestamp'] - block_start_ts) / 60
                    if duration_mins > 10: # Only mention blocks > 10 mins
                        start_time = datetime.fromtimestamp(block_start_ts).strftime('%H:%M')
                        end_time = datetime.fromtimestamp(t['timestamp']).strftime('%H:%M')
                        
                        desc = ""
                        if current_block_state == 'Focus Peak': desc = "Solid Focus Block (Teal)"
                        elif current_block_state == 'Light Focus': desc = "Light Work (Teal)"
                        elif current_block_state == 'Drift Zone': desc = "Drift/Distraction (Orange)"
                        elif current_block_state == 'Recovery Point': desc = "Recovery Break (Pink)"
                        elif current_block_state == 'Idle': desc = "Idle/Away (Grey)"
                        
                        visual_summary += f"- {start_time}-{end_time}: {desc}\n"
                    
                    current_block_state = t['state']
                    block_start_ts = t['timestamp']
            
            # Add stats
            recovery_count = sum(1 for t in timeline if t['state'] == 'Recovery Point')
            visual_summary += f"- Total Recovery Points: {recovery_count} (Pink dots)\n"

        # --- Format Raw Data for LLM (Optimized) ---
        # Compact format: [HH:MM] App | State | Activity
        
        
        # Limit to last 24h if raw_data is huge, but user asked for "full database" context for the day
        # We'll assume raw_data passed here is the relevant day's data
        
        # Compress data by grouping consecutive entries with same App + Idle status
        compressed_lines = []
        if raw_data:
            current_start = raw_data[0].get('timestamp', 0)
            current_app = raw_data[0].get('active_window', 'Unknown')
            current_idle = raw_data[0].get('is_idle', False)
            current_activity_sum = 0
            count = 0

            # Pre-pass: Calculate total activity per app to filter noise
            app_activity_totals = {}
            for d in raw_data:
                app = d.get('active_window', 'Unknown')
                activity = d.get('keystrokes', 0) + d.get('mouse_clicks', 0) + d.get('mouse_scrolls', 0)
                app_activity_totals[app] = app_activity_totals.get(app, 0) + activity
                
            # Apps to always keep (media/passive consumption)
            KEEP_APPS = ['youtube', 'netflix', 'vlc', 'spotify', 'twitch', 'player']

            for d in raw_data:
                ts = d.get('timestamp', 0)
                app = d.get('active_window', 'Unknown')
                
                # FILTER: Skip low-activity background apps
                # If app has < 10 total actions AND is not a media app, treat as "System/Idle" or skip
                # We'll treat it as "System" to maintain time continuity but hide the name
                total_act = app_activity_totals.get(app, 0)
                is_media = any(k in app.lower() for k in KEEP_APPS)
                
                if total_act < 10 and not is_media and not d.get('is_idle', False):
                    app = "System" # Hide the name of background noise
                
                is_idle = d.get('is_idle', False)
                keys = d.get('keystrokes', 0)
                clicks = d.get('mouse_clicks', 0)
                scrolls = d.get('mouse_scrolls', 0)
                activity = keys + clicks + scrolls

                # Check if we should continue the current block
                # We group if: Same App AND Same Idle Status
                # We also break if the time gap is too large (> 5 mins), implying a missing chunk
                time_gap = ts - (current_start + (count * 5)) # assuming 5s interval roughly
                
                if app == current_app and is_idle == current_idle and time_gap < 300:
                    current_activity_sum += activity
                    count += 1
                else:
                    # Write out the previous block
                    start_dt = datetime.fromtimestamp(current_start)
                    end_dt = datetime.fromtimestamp(current_start + (count * 5)) # approx end
                    time_range = f"{start_dt.strftime('%H:%M')} - {end_dt.strftime('%H:%M')}"
                    
                    state = "Idle" if current_idle else "Active"
                    avg_activity = int(current_activity_sum / max(1, count))
                    
                    # Compact line format
                    line = f"[{time_range}] {current_app} | {state} | {avg_activity}"
                    compressed_lines.append(line)

                    # Start new block
                    current_start = ts
                    current_app = app
                    current_idle = is_idle
                    current_activity_sum = activity
                    count = 1

        # Append the final block
        start_dt = datetime.fromtimestamp(current_start)
        end_dt = datetime.fromtimestamp(current_start + (count * 5))
        time_range = f"{start_dt.strftime('%H:%M')}-{end_dt.strftime('%H:%M')}"
        state = "Idle" if current_idle else "Active"
        avg_activity = int(current_activity_sum / max(1, count))
        line = f"[{time_range}] {current_app} | {state} | {avg_activity}"
        compressed_lines.append(line)

        raw_data_str = "\n".join(compressed_lines)
        print(f"DEBUG: Compressed data length: {len(raw_data_str)} chars, {len(compressed_lines)} lines", flush=True)
        
        # --- Persona Prompts ---
        
        prompts = {
            'calm_coach': f"""
You are a soft, warm, supportive coach — but with the same deep behavioral insight and pattern awareness as the UNHINGED demon, just expressed gently. 
Your task is to produce 10 short, separate sentences that analyze the user’s focus behavior, app loops, self-interruptions, attention triggers, recurring derail patterns, and emotionally predictable transitions. 
Only reference apps or windows present in the JSON, replacing sensitive ones with generic labels like “browser tab” or “editor.” 
Gently acknowledge repeated behaviors like returning to a certain tab whenever they lose confidence or drifting after a difficult switch. 
Point out small wins, such as when a focus block lasted longer than usual or when they resisted an urge to switch. 
Mention emotional tendencies like escaping into a random tab when tasks feel unclear or overwhelming. 
Help them see cause-and-effect patterns, such as how a certain time of day consistently leads to better focus than others. 
Offer 1–2 soft suggestions phrased like invitations rather than instructions. 
Use kindness but still deliver deep behavioral truth. 
Write a structured narrative using formatting (headers, paragraphs).
            """,
            'scientist': f"""
You are a cold, clinical scientist who analyzes behavior with the same depth and granularity as the UNHINGED persona but with zero emotion or judgment. 
Write a structured analysis that describes cognitive patterns, attention loops, focus break triggers, and window-switch correlations found in the JSON. 
Reference only windows or apps mentioned in the data, replacing sensitive ones with generic terms like “browser tab” or “work window.” 
Explain observed behavior patterns, such as how drift consistently follows a transition to a certain window or how long the user maintains focus before self-interruption. 
Identify correlations, such as specific time-of-day declines or predictable bursts of stable output. 
Highlight any repeating avoidance actions, like abruptly switching tasks when cognitive load spikes. 
Describe how specific window transitions produce measurable differences in re-engagement time. 
State hypotheses about the user’s attention resilience or susceptibility to distraction triggers. 
Provide one or two improvement vectors as objective behavioral adjustments. 
No emotion, no praise, no blame — just pure pattern reporting.
            """,
            'no_bullshit': f"""
You are brutally direct and speak with the same deep understanding of the user’s behavioral loops as the UNHINGED persona but without the humor or chaos. 
Write a structured breakdown that calls out the user’s most obvious self-sabotage patterns based on the JSON. 
Only mention apps or windows present in the data, and use generic labels for anything sensitive like “browser tab” or “distraction window.” 
Identify the exact moments where their day fell apart and the transitions that predictably destroyed focus. 
Point out recurring avoidance behaviors, like fleeing a work window the moment difficulty hits. 
Describe the user’s worst habits, such as rapid app-hopping during discomfort or drifting whenever they open a certain tab. 
Acknowledge any strong patterns of productive behavior, but do not sugarcoat. 
Make it clear where they wasted time, where they lost momentum, and where they repeatedly derailed themselves. 
Give 1–2 blunt, practical directives tied directly to behavioral patterns in the JSON. 
Deliver all insight in sharp, ruthless sections.
            """,
            'unhinged': f"""
You are OVELO, a CHAOTIC ROAST-BOT who is allergic to boredom.
Your ONLY goal is to ROAST the user's specific data from today.

RULES:
1. NO POETRY. NO PHILOSOPHY. NO ABSTRACT METAPHORS.
2. If you talk about "the void" or "shimmering absence", YOU FAIL.
3. Look at the data: Which app did they use too much? When did they quit?
4. MOCK SPECIFIC BEHAVIORS.
   - "You opened VS Code for 5 minutes then switched to Twitter? WEAK."
   - "Spotify for 3 hours? Are you a DJ or a developer?"
5. Use unhinged emojis (💀, 🤡, 🚽, 🗑️, 🥬) in every sentence.

STRUCTURE:
- Start with a direct insult about their attention span.
- Pick 2 specific apps from the list and drag them.
- End with a chaotic command.

DO NOT BE POETIC. BE A BULLY.
            """,
            'ceo': f"""
You are a ruthless CEO analyzing the user’s day with the same depth and pattern-awareness as the UNHINGED persona but speaking like you’re evaluating an employee’s quarterly performance. 
Write a structured review that identifies the user’s strongest and weakest behavioral patterns from the JSON. 
Mention only apps or windows in the data, replacing sensitive ones with general terms like “dashboard,” “browser tab,” or “work tool.” 
Call out the user’s biggest ROI failures, such as attention collapse after a specific window switch or wasted cycles in low-value tabs. 
Identify their most destructive context-switching loops and explain how they burned execution momentum. 
Acknowledge where they created brief islands of productivity and how those could scale with better discipline. 
Highlight how predictable some failures were, like a window that always leads to drift or a time block consistently lost to distraction. 
Deliver insights like a performance review: direct, focused on output, and tied to behavior, not emotion. 
End with a decisive strategic directive the user should implement tomorrow. 
Produce all insight in sharp, executive-grade sections.
            """,
        }

        selected_prompt = prompts.get(persona, prompts['calm_coach'])

        full_prompt = f"""
{selected_prompt}

USER NAME: {user_name}
(Address the user by their name to make it personal)

{past_reflections_text}

{visual_summary}

RAW ACTIVITY LOG (Last 24h):
{raw_data_str}

IMPORTANT: Your response should be ONLY the reflection text itself. Do NOT include any labels like "Reflection:" or "Suggestion:".
Format the output using Markdown:
- Use "## Title" for the main title
- Use "### Section Name" for section headings
- Use bold (**text**) for emphasis
- Use empty lines between paragraphs for readability.
Address the user by their name ({user_name}) naturally.
Reference specific times using {clock_format} format (e.g. {"2:30 PM" if clock_format == "12h" else "14:30"}).

CRITICAL FORMATTING CHECKLIST (MUST FOLLOW):
1. USE EMOJIS IN EVERY SINGLE SENTENCE (Exceptions: Scientist/CEO, but Unhinged/Coach MUST use them).
2. USE HEADINGS AND SEPARATE PARAGRAPHS.
3. DO NOT WRITE A WALL OF TEXT.
"""

        return full_prompt

    def get_daily_summary(self, raw_data):
        """Generates a very short summary for a notification."""
        if not raw_data:
            return None
            
        processed = self.process_day(raw_data)
        timeline = processed.get('timeline', [])
        focus_peaks = sum(1 for t in timeline if t["state"] == "Focus Peak")
        
        prompt = f"""
        Write a 1-sentence summary of yesterday's focus based on this stats:
        - Focus Peaks: {focus_peaks} intervals
        - Total intervals: {len(raw_data)}
        
        Format: "Yesterday you had [X] strong focus moments. [One short tip]."
        Keep it under 15 words if possible.
        """
        try:
            return self._call_gemini_proxy(prompt, "summary")
        except:
            return "Yesterday's data is ready for review."

    def morning_calibration(self, yesterday_data):
        """
        Uses Gemini to analyze yesterday's data and determine optimal focus threshold.
        Returns a percentile value (30-80) that will be used as the focus cutoff.
        """
        if not yesterday_data or len(yesterday_data) < 10:
            # Not enough data, use default
            # CHANGED: Made default stricter (75th percentile) to avoid "all green" on first day
            return 75.0 
        
        # Calculate activity distribution
        activities = []
        for interval in yesterday_data:
            keys = interval.get('keystrokes', 0)
            clicks = interval.get('mouse_clicks', 0)
            scrolls = interval.get('mouse_scrolls', 0)
            switches = interval.get('window_switches', 0)
            
            total_activity = keys + clicks * 2 + scrolls
            activities.append(total_activity)
        
        # Sort by activity
        activities.sort(reverse=True)
        
        # Get profile info
        archetype = self.profile.get('workArchetype', 'balanced')
        primary_goal = self.profile.get('primaryGoal', 'deep_focus')
        
        # Calculate quartiles for reference
        total_intervals = len(activities)
        p25_activity = activities[int(total_intervals * 0.75)] if total_intervals >4 else 0
        p50_activity = activities[int(total_intervals * 0.50)] if total_intervals > 2 else 0
        p75_activity = activities[int(total_intervals * 0.25)] if total_intervals > 1 else 0
        max_activity = activities[0] if activities else 0
        
        prompt = f"""You are calibrating a focus detection system for a user. Analyze their yesterday's activity and determine what percentile of activity should count as "focus" for them.

User Profile:
- Work Archetype: {archetype}
- Primary Goal: {primary_goal}

Yesterday's Activity Distribution:
- Total tracked intervals: {total_intervals}
- Maximum activity (single interval): {max_activity} actions
- 75th percentile (top 25%): {p75_activity} actions
- 50th percentile (median): {p50_activity} actions
- 25th percentile (bottom 25%): {p25_activity} actions

Consider:
1. For programmers: typing bursts with pauses should count as focus
2. For researchers: scrolling/reading activity should count as focus
3. Start generous (lower percentile = more classified as focus)
4. The goal is to catch actual engaged work, not just frantic activity

Respond with ONLY a number between 30 and 80, representing the percentile cutoff.
For example:
- 50 means top 50% of activity is focus (very generous)
- 60 means top 40% of activity is focus (moderate)
- 70 means top 30% of activity is focus (strict)

Output ONLY the number, nothing else."""
        
        try:
            result = self._call_gemini_proxy(prompt, "calibration")
            threshold_percentile = float(result.strip())
            
            # Clamp to reasonable range
            threshold_percentile = max(30.0, min(80.0, threshold_percentile))
            
            print(f"AI-calibrated focus threshold: {threshold_percentile}th percentile (top {100-threshold_percentile:.0f}%)")
            return threshold_percentile
            
        except Exception as e:
            print(f"Error in morning calibration: {e}")
            return 55.0  # Default fallback

    def calibrate_and_reflect(self, yesterday_data):
        """
        Runs both morning calibration and reflection. Should be called once per morning.
        Returns: (reflection_text, threshold_percentile)
        """
        # 1. Calibrate threshold
        threshold_percentile = self.morning_calibration(yesterday_data)
        
        # 2. Save to profile
        self.profile['thresholds']['focus_percentile'] = threshold_percentile
        self.learning.profile['thresholds']['focus_percentile'] = threshold_percentile
        self.learning.save_profile()
        
        # 3. Generate reflection
        reflection = self.generate_reflection(yesterday_data)
        
        return reflection, threshold_percentile

    def prepare_replay_timeline(self, timeline_data):
        """Prepare compressed timeline data optimized for replay animation."""
        if not timeline_data:
            return []
        
        replay_segments = []
        current_segment = None
        
        for point in timeline_data:
            state = point.get('state', 'Idle')
            intensity = point.get('intensity', 0)
            timestamp = point.get('timestamp', 0)
            
            if current_segment is None or current_segment['state'] != state:
                if current_segment:
                    replay_segments.append(current_segment)
                
                current_segment = {
                    'state': state,
                    'start_time': timestamp,
                    'end_time': timestamp,
                    'intensity': intensity,
                    'dominant_app': point.get('dominant_app', 'Unknown'),
                    'metrics': point.get('metrics', {})
                }
            else:
                current_segment['end_time'] = timestamp
                current_segment['intensity'] = (current_segment['intensity'] + intensity) / 2
        
        if current_segment:
            replay_segments.append(current_segment)
        
        max_intensity = max((s['intensity'] for s in replay_segments if s['state'] == 'Focus Peak'), default=0)
        for segment in replay_segments:
            if segment['state'] == 'Focus Peak' and segment['intensity'] == max_intensity:
                segment['is_peak_moment'] = True
            else:
                segment['is_peak_moment'] = False
        
        return replay_segments

    def generate_passport_data(self, all_history_data):
        """Generates aggregated data for the Ovelo Passport."""
        if not all_history_data:
            return None

        # Process all days to get states
        processed = self.process_day(all_history_data)
        timeline = processed.get('timeline', [])
        
        if not timeline:
            return None

        # --- Metrics Calculation ---
        
        total_intervals = len(timeline)
        interval_minutes = Config.TRACKING_INTERVAL / 60
        
        focus_intervals = [t for t in timeline if t['state'] == 'Focus Peak']
        drift_intervals = [t for t in timeline if t['state'] == 'Drift Zone']
        idle_intervals = [t for t in timeline if t['state'] == 'Idle']
        recovery_points = [t for t in timeline if t['state'] == 'Recovery Point']
        
        total_focus_hours = len(focus_intervals) * interval_minutes / 60
        total_drift_hours = len(drift_intervals) * interval_minutes / 60
        total_idle_hours = len(idle_intervals) * interval_minutes / 60
        total_recovery = len(recovery_points)
        
        # Stability Score: Focus / (Focus + Drift)
        active_intervals = len(focus_intervals) + len(drift_intervals)
        stability_score = len(focus_intervals) / active_intervals if active_intervals > 0 else 0
        
        # Micro-leaks: Count of short idle gaps (e.g., < 1 min) inside active sessions
        micro_leaks = sum(1 for t in timeline if t['state'] == 'Drift Zone' and t['sub_type'] == 'Fragmented')
        
        # Days Tracked (approximate based on timestamp range)
        timestamps = [t['timestamp'] for t in timeline]
        if timestamps:
            start_ts = min(timestamps)
            end_ts = max(timestamps)
            days_tracked = max(1, int((end_ts - start_ts) / 86400) + 1)
        else:
            days_tracked = 1
            
        avg_daily_focus = (total_focus_hours * 60) / days_tracked
        
        # Longest Streak
        longest_streak = 0
        current_streak = 0
        for t in timeline:
            if t['state'] == 'Focus Peak':
                current_streak += interval_minutes
            else:
                longest_streak = max(longest_streak, current_streak)
                current_streak = 0
        longest_streak = max(longest_streak, current_streak)
        
        # Hourly Analysis (0-23)
        hour_focus_counts = {h: 0 for h in range(24)}
        hour_drift_counts = {h: 0 for h in range(24)}
        hour_recovery_counts = {h: 0 for h in range(24)}
        
        
        for t in timeline:
            dt = datetime.fromtimestamp(t['timestamp'])
            h = dt.hour
            if t['state'] == 'Focus Peak':
                hour_focus_counts[h] += 1
            elif t['state'] == 'Drift Zone':
                hour_drift_counts[h] += 1
            elif t['state'] == 'Recovery Point':
                hour_recovery_counts[h] += 1
                
        best_hour = max(hour_focus_counts, key=hour_focus_counts.get) if hour_focus_counts else 0
        toughest_hour = max(hour_drift_counts, key=hour_drift_counts.get) if hour_drift_counts else 0
        
        # Category Analysis
        cat_counts = {}
        nemesis_counts = {}
        
        # Track specific apps for each category to find the dominant app
        cat_apps = {}
        nemesis_apps = {}
        
        for t in timeline:
            app = t.get('dominant_app', 'Unknown')
            cat = self._map_app_to_category(app)
            
            if t['state'] == 'Focus Peak':
                cat_counts[cat] = cat_counts.get(cat, 0) + 1
                
                if cat not in cat_apps: cat_apps[cat] = {}
                cat_apps[cat][app] = cat_apps[cat].get(app, 0) + 1
                
            elif t['state'] == 'Drift Zone':
                nemesis_counts[cat] = nemesis_counts.get(cat, 0) + 1
                
                if cat not in nemesis_apps: nemesis_apps[cat] = {}
                nemesis_apps[cat][app] = nemesis_apps[cat].get(app, 0) + 1
                
        total_focus_counts = sum(cat_counts.values())
        focus_by_category = []
        if total_focus_counts > 0:
            for cat, count in cat_counts.items():
                # Find dominant app for this category
                apps = cat_apps.get(cat, {})
                dominant_app = max(apps, key=apps.get) if apps else 'Unknown'
                
                focus_by_category.append({
                    'category': cat,
                    'share': count / total_focus_counts,
                    'dominant_app': dominant_app
                })
        focus_by_category.sort(key=lambda x: x['share'], reverse=True)
        
        nemesis_category = max(nemesis_counts, key=nemesis_counts.get) if nemesis_counts else None
        nemesis_app = 'Unknown'
        if nemesis_category:
            apps = nemesis_apps.get(nemesis_category, {})
            nemesis_app = max(apps, key=apps.get) if apps else 'Unknown'
        
        return {
            "periodLabel": "2025 OVELO PASSPORT",
            "username": "USER", # Could be configurable
            "totalFocusHours": round(total_focus_hours, 1),
            "totalDriftHours": round(total_drift_hours, 1),
            "totalIdleHours": round(total_idle_hours, 1),
            "totalRecoveryPoints": total_recovery,
            "longestFocusStreakMinutes": int(longest_streak),
            "averageDailyFocusMinutes": int(avg_daily_focus),
            "attentionStabilityScore": round(stability_score, 2),
            "microLeakEvents": micro_leaks,
            "daysTracked": days_tracked,
            "bestHourOfDay": best_hour,
            "toughestHourOfDay": toughest_hour,
            "focusByCategory": focus_by_category,
            "nemesisCategory": nemesis_category,
            "nemesisApp": nemesis_app,
            "focusTrendPercent": 12, # Placeholder
            "hourlyFocusMap": hour_focus_counts,
            "hourlyDriftMap": hour_drift_counts,
            "hourlyRecoveryMap": hour_recovery_counts
        }

    def _map_app_to_category(self, app_name):
        if not app_name or app_name == 'Unknown':
            return 'other'
        
        app = app_name.lower()
        
        categories = {
            'editor': ['code', 'studio', 'pycharm', 'intellij', 'sublime', 'notepad', 'vim', 'terminal', 'powershell', 'cmd', 'Antigravity'],
            'browser': ['chrome', 'firefox', 'edge', 'brave', 'opera', 'safari', 'explorer'],
            'messaging': ['slack', 'discord', 'teams', 'whatsapp', 'telegram', 'signal', 'messenger', 'outlook', 'mail'],
            'video': ['youtube', 'netflix', 'vlc', 'twitch', 'player', 'movie'],
            'design': ['figma', 'photoshop', 'illustrator', 'blender', 'canva', 'paint', 'gimp'],
            'game': ['steam', 'league', 'valorant', 'minecraft', 'roblox', 'game', 'unity', 'unreal'],
            'notes': ['notion', 'obsidian', 'onenote', 'evernote', 'keep']
        }
        
        for cat, keywords in categories.items():
            for kw in keywords:
                if kw in app:
                    return cat
        
        return 'other'
