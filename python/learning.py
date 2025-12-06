import json
import os
import statistics
from config import Config

class LearningEngine:
    def __init__(self):
        self.profile_file = os.path.join(Config.BASE_DIR, "user_profile.json")
        self.default_profile = {
            "baselines": {
                "focus_keystrokes_per_min": 40.0,
                "focus_clicks_per_min": 10.0,
                "focus_scrolls_per_min": 5.0,
                "avg_switch_frequency": 0.5
            },
            "thresholds": {
                "activity_multiplier": 1.0, # Multiplier for activity score
                "reading_scroll_threshold": 2.0
            },
            "nemesis_apps": [],
            "focus_habitats": []
        }
        self.profile = self.load_profile()

    def load_profile(self):
        if os.path.exists(self.profile_file):
            try:
                with open(self.profile_file, 'r') as f:
                    loaded_profile = json.load(f)
                
                # Merge with default profile to ensure all keys exist
                result = self.default_profile.copy()
                
                # If the loaded profile is from onboarding, it will have different structure
                # We need to be flexible and merge intelligently
                if 'baselines' in loaded_profile:
                    result['baselines'].update(loaded_profile['baselines'])
                if 'thresholds' in loaded_profile:
                    result['thresholds'].update(loaded_profile['thresholds'])
                
                # Copy top-level fields
                for key in ['userName', 'workArchetype', 'primaryGoal', 'priorityCategory',
                           'preferredFocusLengthMinutes', 'sensitivityToDistraction', 
                           'driftDetectionStyle', 'reflectionPersona']:
                    if key in loaded_profile:
                        result[key] = loaded_profile[key]
                
                return result
            except Exception as e:
                print(f"Error loading profile: {e}")
        return self.default_profile.copy()

    def save_profile(self):
        try:
            with open(self.profile_file, 'w') as f:
                json.dump(self.profile, f, indent=2)
            print("User profile updated.")
        except Exception as e:
            print(f"Error saving profile: {e}")

    def update_profile(self, all_history_data):
        """Analyzes full history to update user baselines."""
        if not all_history_data:
            return

        print("Learning from history...")
        
        # 1. Filter for High Focus moments to establish baselines
        # We need to re-process raw data to identify "HighFocus" intervals based on *current* (or default) logic first,
        # then refine the baselines. Or simply look at raw stats of "active" periods.
        
        # Let's look at the top 20% of active intervals to define "High Focus" for this user.
        
        active_intervals = []
        for interval in all_history_data:
            # Calculate raw activity sum
            keys = interval.get('keystrokes', 0)
            clicks = interval.get('mouse_clicks', 0)
            scrolls = interval.get('mouse_scrolls', 0)
            
            # Simple activity metric
            total_activity = keys + clicks + scrolls
            
            if total_activity > 0:
                active_intervals.append({
                    'keys': keys,
                    'clicks': clicks,
                    'scrolls': scrolls,
                    'total': total_activity,
                    'app': interval.get('active_window', 'Unknown')
                })
        
        if not active_intervals:
            return

        # Sort by total activity to find the "Peak Performance" moments
        active_intervals.sort(key=lambda x: x['total'], reverse=True)
        
        # Take top 25% as "Deep Work" baseline
        top_n = max(1, int(len(active_intervals) * 0.25))
        top_performers = active_intervals[:top_n]
        
        # Calculate averages per interval (5 seconds) -> convert to per minute (* 12)
        avg_keys = statistics.mean(x['keys'] for x in top_performers) * 12
        avg_clicks = statistics.mean(x['clicks'] for x in top_performers) * 12
        avg_scrolls = statistics.mean(x['scrolls'] for x in top_performers) * 12
        
        # Update Baselines
        self.profile['baselines']['focus_keystrokes_per_min'] = round(avg_keys, 1)
        self.profile['baselines']['focus_clicks_per_min'] = round(avg_clicks, 1)
        self.profile['baselines']['focus_scrolls_per_min'] = round(avg_scrolls, 1)
        
        # 2. Determine Activity Multiplier
        # If user is very active (e.g., gamer/coder), multiplier might be lower to normalize to 1.0
        # If user is passive (reader), multiplier higher.
        # Standard "High Focus" is often ~50 actions/min.
        # If user avg is 100, multiplier = 0.5. If 25, multiplier = 2.0.
        
        standard_activity = 50.0
        user_activity = avg_keys + avg_clicks + avg_scrolls
        if user_activity > 0:
            self.profile['thresholds']['activity_multiplier'] = round(standard_activity / user_activity, 2)
        
        # 3. Identify Focus Habitats (Apps)
        app_counts = {}
        for x in top_performers:
            app = x['app']
            app_counts[app] = app_counts.get(app, 0) + 1
            
        sorted_apps = sorted(app_counts.items(), key=lambda x: x[1], reverse=True)
        self.profile['focus_habitats'] = [app for app, count in sorted_apps[:5]]
        
        self.save_profile()
        print(f"Profile Updated: Baselines [K:{avg_keys:.1f}, C:{avg_clicks:.1f}, S:{avg_scrolls:.1f}]")

    def get_thresholds(self):
        return self.profile['thresholds']
