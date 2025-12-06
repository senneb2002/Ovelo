import sys
import os
import threading
import time

# Add current directory to path so imports work
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from tracker import BehaviorTracker
from analyzer import FocusAnalyzer
from server import OveloServer
from config import Config
from startup import ensure_startup
from learning import LearningEngine

def run_sidecar():
    print("Starting Ovelo Sidecar...")
    
    # Initialize components
    tracker = BehaviorTracker()
    analyzer = FocusAnalyzer()
    server = OveloServer(tracker, analyzer)
    learning = LearningEngine()
    
    # Start Tracker
    print("Starting Tracker...")
    tracker.start()
    
    # Ensure startup (maybe not needed for sidecar if Tauri handles it, but good to have)
    # ensure_startup() 
    
    # Run Learning Engine in background
    def run_learning():
        while True:
            try:
                if os.path.exists(Config.DATA_FILE):
                    with open(Config.DATA_FILE, 'r') as f:
                        import json
                        data = json.load(f)
                    learning.update_profile(data)
                    analyzer.profile = learning.load_profile()
                    analyzer.thresholds = analyzer.profile.get('thresholds', {})
                    analyzer.activity_multiplier = analyzer.thresholds.get('activity_multiplier', 1.0)
            except Exception as e:
                print(f"Learning error: {e}")
            time.sleep(300) # Run every 5 minutes
            
    threading.Thread(target=run_learning, daemon=True).start()
    
    # Start Server (Blocking)
    print(f"Starting Server on port {Config.PORT}...")
    server.run()

if __name__ == "__main__":
    run_sidecar()
