import pystray
from PIL import Image, ImageDraw
import webbrowser
import threading
import sys
import os

from .tracker import BehaviorTracker
from .analyzer import FocusAnalyzer
from .server import OveloServer
from .config import Config
from .startup import ensure_startup
from .learning import LearningEngine
from win10toast import ToastNotifier
import datetime
import json

def create_icon():
    # Create a simple icon programmatically
    width = 64
    height = 64
    color1 = "#4F46E5" # Indigo
    color2 = "#14B8A6" # Teal

    image = Image.new('RGB', (width, height), color1)
    dc = ImageDraw.Draw(image)
    dc.ellipse((16, 16, 48, 48), fill=color2)
    
    return image

class OveloApp:
    def __init__(self):
        self.tracker = BehaviorTracker()
        self.analyzer = FocusAnalyzer()
        self.server = OveloServer(self.tracker, self.analyzer)
        self.learning = LearningEngine() # Initialize Learning Engine
        self.icon = None

    def open_dashboard(self, icon=None, item=None):
        # Open in app mode for borderless window (native app feel)
        import subprocess
        url = f"http://localhost:{Config.PORT}"
        
        # Try Chrome app mode first (no browser chrome)
        try:
            chrome_paths = [
                r"C:\Program Files\Google\Chrome\Application\chrome.exe",
                r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
                os.path.expanduser(r"~\AppData\Local\Google\Chrome\Application\chrome.exe")
            ]
            
            chrome_path = None
            for path in chrome_paths:
                if os.path.exists(path):
                    chrome_path = path
                    break
            
            if chrome_path:
                subprocess.Popen([chrome_path, f"--app={url}", "--window-size=1200,900"])
            else:
                webbrowser.open(url)
        except:
            webbrowser.open(url)

    def quit_app(self, icon, item):
        self.tracker.stop()
        self.icon.stop()
        sys.exit(0)

    def run(self):
        # Start Tracker
        self.tracker.start()
        
        # Start Server
        self.server.start_thread()
        
        # Setup System Tray
        image = create_icon()
        menu = pystray.Menu(
            pystray.MenuItem("Open Dashboard", self.open_dashboard, default=True),
            pystray.MenuItem("Quit", self.quit_app)
        )
        
        self.icon = pystray.Icon("Ovelo", image, "Ovelo", menu)
        
        # Ensure startup
        ensure_startup()
        
        # Check for morning notification
        self.check_morning_briefing()
        
        # Run Learning Engine in background to update profile
        threading.Thread(target=self._run_learning, daemon=True).start()
        
        # Auto-open dashboard in app mode
        threading.Thread(target=lambda: self._delayed_open(), daemon=True).start()
        
        self.icon.run()

    def _delayed_open(self):
        """Wait for server to be ready, then open dashboard"""
        import time
        time.sleep(2)  # Wait for server to start
        self.open_dashboard()

    def _run_learning(self):
        """Runs the learning process in the background."""
        try:
            # Load existing data to learn from
            if os.path.exists(Config.DATA_FILE):
                with open(Config.DATA_FILE, 'r') as f:
                    data = json.load(f)
                self.learning.update_profile(data)
                # Reload analyzer profile to apply new thresholds immediately
                self.analyzer.profile = self.learning.load_profile()
                self.analyzer.thresholds = self.analyzer.profile.get('thresholds', {})
                self.analyzer.activity_multiplier = self.analyzer.thresholds.get('activity_multiplier', 1.0)
        except Exception as e:
            print(f"Learning error: {e}")

    def check_morning_briefing(self):
        try:
            # Simple state file for last notification
            state_file = "ovelo_state.json"
            today_str = datetime.date.today().isoformat()
            last_notif = ""
            
            if os.path.exists(state_file):
                with open(state_file, 'r') as f:
                    state = json.load(f)
                    last_notif = state.get("last_notification_date", "")
            
            if last_notif != today_str:
                # It's a new day! Load yesterday's data and run AI calibration
                yesterday_date = (datetime.date.today() - datetime.timedelta(days=1)).isoformat()
                yesterday_file = f"focus_data_{yesterday_date}.json"
                
                if os.path.exists(yesterday_file):
                    try:
                        with open(yesterday_file, 'r') as f:
                            yesterday_data = json.load(f)
                        
                        # Run AI calibration and reflection
                        reflection, threshold = self.analyzer.calibrate_and_reflect(yesterday_data)
                        
                        # Show reflection as toast
                        toaster = ToastNotifier()
                        toaster.show_toast("Ovelo Morning Brief",
                                           reflection[:100],  # Truncate for toast
                                           duration=8,
                                           threaded=True)
                    except Exception as e:
                        print(f"Morning calibration error: {e}")
                        # Fallback to generic message
                        toaster = ToastNotifier()
                        toaster.show_toast("Ovelo Morning Brief",
                                           "Ovelo is tracking your focus for today.",
                                           duration=5,
                                           threaded=True)
                else:
                    # No yesterday data yet (first day)
                    toaster = ToastNotifier()
                    toaster.show_toast("Ovelo Morning Brief",
                                       "Ovelo is running and tracking your focus for today.",
                                       duration=5,
                                       threaded=True)
                                   
                # Save state
                with open(state_file, 'w') as f:
                    json.dump({"last_notification_date": today_str}, f)
                    
        except Exception as e:
            print(f"Notification error: {e}")

if __name__ == "__main__":
    app = OveloApp()
    app.run()
