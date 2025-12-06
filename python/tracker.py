import time
import threading
import json
import math
import os
import re
from datetime import datetime
from pynput import mouse, keyboard
try:
    import win32gui
    import win32process
except ImportError:
    win32gui = None

from config import Config

class BehaviorTracker:
    def __init__(self):
        self.running = False
        self.data = []
        self.current_interval_data = self._reset_interval_data()
        self.lock = threading.Lock()
        
        # Listeners
        self.mouse_listener = None
        self.keyboard_listener = None
        
        # State tracking
        self.last_mouse_pos = None
        self.last_active_window = None
        
        # Load existing data
        self.load_data()
        
        # Blocklist for windows that should be treated as system/idle
        # Blocklist for windows that should be treated as system/idle
        self.IGNORED_TITLES = [
            "Windows Default Lock Screen",
            "Lock App", 
            "Login",
            "Task Switching",
            "Program Manager", # Often the desktop background
            "Microsoft Text Input Application",
            "Snap Assist",
            "Task View"
        ]
        
        # Privacy Settings
        self.privacy_level = "smart" # Default
        self._load_privacy_settings()

    def _load_privacy_settings(self):
        try:
            profile_path = os.path.join(Config.BASE_DIR, "user_profile.json")
            if os.path.exists(profile_path):
                with open(profile_path, 'r') as f:
                    profile = json.load(f)
                    self.privacy_level = profile.get('privacyLevel', 'smart')
                    print(f"Privacy Level loaded: {self.privacy_level}")
        except Exception as e:
            print(f"Error loading privacy settings: {e}")

    def set_privacy_level(self, level):
        self.privacy_level = level
        print(f"Privacy Level updated to: {level}")

    def _apply_privacy(self, title):
        if self.privacy_level == "smart":
            return title
        elif self.privacy_level == "minimal":
            # Heuristic: Extract App Name (Last part after ' - ' or ' — ')
            # Examples: "Doc - Word" -> "Word", "Google - Chrome" -> "Chrome"
            match = re.search(r'[\-—]\s+([^\-—]+)$', title)
            if match:
                return match.group(1).strip()
            return title # Fallback if no delimiter found
        return title
        
    def _reset_interval_data(self):
        return {
            "timestamp": 0,
            "mouse_distance": 0,
            "mouse_scrolls": 0,
            "mouse_clicks": 0,
            "keystrokes": 0,
            "window_switches": 0,
            "active_window": "",
            "is_idle": False
        }

    def start(self):
        self.running = True
        self.mouse_listener = mouse.Listener(on_move=self._on_move, on_click=self._on_click, on_scroll=self._on_scroll)
        self.keyboard_listener = keyboard.Listener(on_press=self._on_press)
        
        self.mouse_listener.start()
        self.keyboard_listener.start()
        
        self.thread = threading.Thread(target=self._loop)
        self.thread.daemon = True
        self.thread.start()
        print("Tracker started.")

    def stop(self):
        self.running = False
        if self.mouse_listener:
            self.mouse_listener.stop()
        if self.keyboard_listener:
            self.keyboard_listener.stop()
        self.save_data() # Ensure data is saved on exit
        print("Tracker stopped.")

    def _on_move(self, x, y):
        if self.last_mouse_pos:
            dist = math.sqrt((x - self.last_mouse_pos[0])**2 + (y - self.last_mouse_pos[1])**2)
            with self.lock:
                self.current_interval_data["mouse_distance"] += dist
        self.last_mouse_pos = (x, y)

    def _on_click(self, x, y, button, pressed):
        if pressed:
            with self.lock:
                self.current_interval_data["mouse_clicks"] += 1

    def _on_scroll(self, x, y, dx, dy):
        with self.lock:
            self.current_interval_data["mouse_scrolls"] += 1

    def _on_press(self, key):
        with self.lock:
            self.current_interval_data["keystrokes"] += 1

    def _get_active_window(self):
        if win32gui:
            try:
                window = win32gui.GetForegroundWindow()
                title = win32gui.GetWindowText(window)
                
                # Check against blocklist
                if not title: return "Unknown"
                
                for ignored in self.IGNORED_TITLES:
                    if ignored.lower() in title.lower():
                        return "IGNORE"
                        
                return title
            except Exception:
                return "Unknown"
        return "Unknown"

    def _loop(self):
        while self.running:
            start_time = time.time()
            
            # 1. Capture Active Window
            current_window = self._get_active_window()
            
            with self.lock:
                if current_window == "IGNORE":
                    # Treat as idle/system time, don't update active window or count switches
                    # If we were previously tracking a valid window, we might want to keep it 
                    # OR switch to "System" to indicate we are away from work.
                    # Let's use a special marker so we can force Idle later.
                    self.current_interval_data["active_window"] = "System Idle"
                else:
                    self.current_interval_data["window_switches"] += 1
                    self.last_active_window = current_window
                    
                    # Apply privacy filtering
                    self.current_interval_data["active_window"] = self._apply_privacy(current_window) 
                
                self.current_interval_data["timestamp"] = start_time

            # 2. Wait for interval
            time.sleep(Config.TRACKING_INTERVAL)
            
            # 3. Flush interval data
            with self.lock:
                # Determine if idle (no input for the whole interval)
                if (self.current_interval_data["mouse_distance"] == 0 and 
                    self.current_interval_data["mouse_clicks"] == 0 and 
                    self.current_interval_data["mouse_scrolls"] == 0 and 
                    self.current_interval_data["keystrokes"] == 0):
                    self.current_interval_data["is_idle"] = True
                
                # Force idle if we are on an ignored window (like lock screen)
                if self.current_interval_data["active_window"] == "System Idle":
                    self.current_interval_data["is_idle"] = True
                
                # Night Suppression Logic:
                # If IDLE and time is between 2 AM and 6 AM, DO NOT LOG data.
                # This prevents "doing nothing during the night" from filling the logs.
                current_hour = datetime.fromtimestamp(time.time()).hour
                if self.current_interval_data["is_idle"] and (2 <= current_hour < 6):
                    pass # Skip logging
                else:
                    self.data.append(self.current_interval_data.copy())
                
                self.current_interval_data = self._reset_interval_data()
            
            # Optional: Save to file periodically (e.g., every minute) to avoid data loss
            if len(self.data) % 12 == 0: # Approx every minute
                 self.save_data()

    def get_data(self):
        with self.lock:
            return self.data

    def save_data(self):
        try:
            print(f"Saving data to {Config.DATA_FILE}...")
            with open(Config.DATA_FILE, 'w') as f:
                json.dump(self.data, f)
        except Exception as e:
            print(f"Error saving data: {e}")

    def load_data(self):
        try:
            print(f"Loading data from {Config.DATA_FILE}...")
            if os.path.exists(Config.DATA_FILE):
                with open(Config.DATA_FILE, 'r') as f:
                    self.data = json.load(f)
                print(f"Loaded {len(self.data)} data points.")
            else:
                print("No existing data file found.")
        except Exception as e:
            print(f"Error loading data: {e}")
