"""
Notification Scheduler for Ovelo

Runs in background and triggers a personalized notification once per day
when the user has accumulated enough activity data and is currently active.
"""

import os
import json
import time
import threading
from datetime import datetime, timedelta
from config import Config


class NotificationScheduler:
    """
    Background scheduler that triggers one proactive notification per day
    when conditions are right:
    1. User has accumulated enough activity data (at least 2 hours of tracking)
    2. User is currently active (not idle)
    3. Haven't already sent a notification today
    4. It's during reasonable hours (9 AM - 8 PM)
    """
    
    STATE_FILE = os.path.join(Config.BASE_DIR, "notification_state.json")
    CHECK_INTERVAL = 5 * 60  # Check every 5 minutes
    MIN_ACTIVITY_HOURS = 2  # Minimum hours of activity before triggering
    QUIET_HOURS_START = 20  # 8 PM - no notifications after this
    QUIET_HOURS_END = 9     # 9 AM - no notifications before this
    
    def __init__(self, tracker, analyzer):
        self.tracker = tracker
        self.analyzer = analyzer
        self.running = False
        self.thread = None
        self._notification_callback = None
        self._load_state()
    
    def _load_state(self):
        """Load notification state from file."""
        self.state = {
            "last_notification_date": None,
            "last_teaser": None,
            "notifications_today": 0
        }
        
        try:
            if os.path.exists(self.STATE_FILE):
                with open(self.STATE_FILE, 'r') as f:
                    self.state = json.load(f)
        except Exception as e:
            print(f"[NotificationScheduler] Error loading state: {e}")
    
    def _save_state(self):
        """Save notification state to file."""
        try:
            with open(self.STATE_FILE, 'w') as f:
                json.dump(self.state, f, indent=2)
        except Exception as e:
            print(f"[NotificationScheduler] Error saving state: {e}")
    
    def set_notification_callback(self, callback):
        """Set callback function that will be called when notification should be sent.
        
        The callback receives (title: str, body: str, teaser_for_storage: str)
        """
        self._notification_callback = callback
    
    def start(self):
        """Start the background scheduler thread."""
        if self.running:
            return
            
        self.running = True
        self.thread = threading.Thread(target=self._scheduler_loop, daemon=True)
        self.thread.start()
        print("[NotificationScheduler] Started background scheduler")
    
    def stop(self):
        """Stop the scheduler."""
        self.running = False
        print("[NotificationScheduler] Stopped")
    
    def _scheduler_loop(self):
        """Main scheduler loop - runs every CHECK_INTERVAL."""
        # Wait a bit on startup to let other systems initialize
        time.sleep(30)
        
        while self.running:
            try:
                should_notify, teaser = self._check_notification_conditions()
                
                if should_notify and teaser:
                    self._trigger_notification(teaser)
                    
            except Exception as e:
                print(f"[NotificationScheduler] Error in loop: {e}")
            
            # Sleep until next check
            time.sleep(self.CHECK_INTERVAL)
    
    def _check_notification_conditions(self) -> tuple:
        """
        Check if all conditions are met for sending a notification.
        
        Returns: (should_notify: bool, teaser: str or None)
        """
        now = datetime.now()
        today_str = now.strftime('%Y-%m-%d')
        current_hour = now.hour
        
        print(f"[NotificationScheduler] Checking conditions at {now.strftime('%H:%M:%S')}")
        
        # 1. Check if already notified today
        if self.state.get("last_notification_date") == today_str:
            print(f"[NotificationScheduler] SKIP: Already notified today ({today_str})")
            return False, None
        
        # 2. Check quiet hours (no notifications before 9 AM or after 8 PM)
        if current_hour < self.QUIET_HOURS_END or current_hour >= self.QUIET_HOURS_START:
            print(f"[NotificationScheduler] SKIP: Quiet hours (current={current_hour}, allowed={self.QUIET_HOURS_END}-{self.QUIET_HOURS_START})")
            return False, None
        
        # 3. Check if user is currently active (not idle in last 5 minutes)
        recent_data = self._get_recent_activity(minutes=5)
        if not recent_data:
            print(f"[NotificationScheduler] SKIP: No recent activity data")
            return False, None
            
        idle_count = sum(1 for d in recent_data if d.get('is_idle', True))
        active_count = len(recent_data) - idle_count
        print(f"[NotificationScheduler] Recent activity: {active_count} active, {idle_count} idle (of {len(recent_data)} intervals)")
        
        if all(d.get('is_idle', True) for d in recent_data):
            print(f"[NotificationScheduler] SKIP: User currently idle")
            return False, None
        
        # 4. Check if enough activity has accumulated (at least 2 hours today)
        today_data = self._get_today_activity()
        if not today_data:
            print(f"[NotificationScheduler] SKIP: No activity data for today")
            return False, None
            
        active_intervals = [d for d in today_data if not d.get('is_idle', True)]
        active_hours = (len(active_intervals) * Config.TRACKING_INTERVAL) / 3600
        
        print(f"[NotificationScheduler] Today's activity: {active_hours:.2f}h (need {self.MIN_ACTIVITY_HOURS}h)")
        
        if active_hours < self.MIN_ACTIVITY_HOURS:
            print(f"[NotificationScheduler] SKIP: Not enough activity ({active_hours:.2f}h < {self.MIN_ACTIVITY_HOURS}h)")
            return False, None
        
        # 5. All conditions met - generate teaser
        print(f"[NotificationScheduler] ✓ ALL CONDITIONS MET! Generating teaser...")
        
        teaser = self._generate_teaser(today_data)
        if teaser:
            return True, teaser
        
        print(f"[NotificationScheduler] SKIP: Failed to generate teaser")
        return False, None
    
    def _get_recent_activity(self, minutes=5):
        """Get activity data from the last N minutes."""
        if not self.tracker:
            return []
            
        all_data = self.tracker.get_data()
        if not all_data:
            return []
        
        cutoff = time.time() - (minutes * 60)
        return [d for d in all_data if d.get('timestamp', 0) >= cutoff]
    
    def _get_today_activity(self):
        """Get all activity data from today."""
        if not self.tracker:
            return []
            
        all_data = self.tracker.get_data()
        if not all_data:
            return []
        
        today_start = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0).timestamp()
        return [d for d in all_data if d.get('timestamp', 0) >= today_start]
    
    def _generate_teaser(self, activity_data) -> str:
        """Generate a personalized, engaging teaser for the notification."""
        
        # Get user info
        profile = self.analyzer.profile
        user_name = profile.get('userName', profile.get('name', ''))
        
        # Analyze activity for insights
        insights = self._extract_insights(activity_data)
        
        # Build teaser prompt
        prompt = f"""Generate a single notification teaser (max 60 chars) that will make the user want to open Ovelo immediately.

User Name: {user_name if user_name else 'there'}
Today's Insights:
{insights}

Requirements:
1. Include ONE emoji at the end
2. Reference something SPECIFIC from the insights
3. Create curiosity - don't reveal everything
4. Be conversational and personal
5. If user has a name, use it

Examples of GOOD teasers:
- "Your focus peaked at 2pm. Want to know why? 🔍"
- "3 hours of deep work today - impressive 🎯"
- "That context-switching at 4pm... let's talk 👀"

Output ONLY the teaser text, nothing else."""

        try:
            teaser = self.analyzer._call_gemini_proxy(prompt, "teaser")
            # Clean up the response
            teaser = teaser.strip().strip('"').strip("'")
            
            # Ensure it's not too long
            if len(teaser) > 80:
                teaser = teaser[:77] + "..."
            
            print(f"[NotificationScheduler] Generated teaser: {teaser}")
            return teaser
            
        except Exception as e:
            print(f"[NotificationScheduler] Error generating teaser: {e}")
            # Fallback teaser
            return f"Your daily focus insights are ready 📊"
    
    def _extract_insights(self, activity_data) -> str:
        """Extract key insights from activity data for teaser generation."""
        if not activity_data:
            return "- No activity data yet"
        
        insights = []
        
        # Calculate focus time
        active_intervals = [d for d in activity_data if not d.get('is_idle', True)]
        active_hours = (len(active_intervals) * Config.TRACKING_INTERVAL) / 3600
        insights.append(f"- Total active time: {active_hours:.1f} hours")
        
        # Find most used apps
        app_counts = {}
        for d in activity_data:
            app = d.get('active_window', 'Unknown')
            if app and app != 'Unknown' and app != 'System Idle':
                # Simplify app name
                app_simple = app.split(' - ')[-1] if ' - ' in app else app
                app_counts[app_simple] = app_counts.get(app_simple, 0) + 1
        
        if app_counts:
            top_apps = sorted(app_counts.items(), key=lambda x: x[1], reverse=True)[:3]
            apps_str = ", ".join([f"{app}" for app, _ in top_apps])
            insights.append(f"- Top apps: {apps_str}")
        
        # Find peak activity hour
        hour_activity = {}
        for d in activity_data:
            if not d.get('is_idle', True):
                hour = datetime.fromtimestamp(d.get('timestamp', 0)).hour
                activity = d.get('keystrokes', 0) + d.get('mouse_clicks', 0)
                hour_activity[hour] = hour_activity.get(hour, 0) + activity
        
        if hour_activity:
            peak_hour = max(hour_activity.items(), key=lambda x: x[1])[0]
            insights.append(f"- Peak focus hour: {peak_hour}:00")
        
        # Count context switches
        window_switches = sum(d.get('window_switches', 0) for d in activity_data)
        if window_switches > 50:
            insights.append(f"- Context switches: {window_switches} (high)")
        
        return "\n".join(insights)
    
    def _trigger_notification(self, teaser: str):
        """Send the notification and update state."""
        today_str = datetime.now().strftime('%Y-%m-%d')
        
        # Update state FIRST to prevent duplicate sends
        self.state["last_notification_date"] = today_str
        self.state["last_teaser"] = teaser
        self.state["notifications_today"] = self.state.get("notifications_today", 0) + 1
        self._save_state()
        
        print(f"[NotificationScheduler] Triggering notification: {teaser}")
        
        # Call the notification callback if set
        if self._notification_callback:
            try:
                self._notification_callback(
                    title="Ovelo",
                    body=teaser
                )
            except Exception as e:
                print(f"[NotificationScheduler] Callback error: {e}")
    
    def get_pending_notification(self) -> dict:
        """
        Check if there's a pending notification to send.
        Called by the frontend/Tauri to poll for notifications.
        
        Returns: {should_notify: bool, teaser: str, title: str}
        """
        should_notify, teaser = self._check_notification_conditions()
        
        if should_notify and teaser:
            # Mark as sent
            self._trigger_notification(teaser)
            return {
                "should_notify": True,
                "title": "Ovelo",
                "teaser": teaser
            }
        
        return {
            "should_notify": False,
            "title": None,
            "teaser": None
        }
    
    def force_check(self) -> dict:
        """Force a check for debugging purposes."""
        return self.get_pending_notification()
