import sys
import os
import json
import threading
import time
from datetime import datetime
import logging
from flask import Flask, jsonify, send_from_directory

# Setup Logging (Frozen Debug)
# Setup Logging (Universal Debug)
try:
    if sys.platform == 'win32':
        log_dir = os.path.join(os.environ.get('APPDATA', '.'), 'Ovelo')
    elif sys.platform == 'darwin':
            log_dir = os.path.expanduser('~/Library/Application Support/Ovelo')
    else:
            log_dir = os.path.expanduser('~/.ovelo')
            
    if not os.path.exists(log_dir):
        os.makedirs(log_dir)
        
    # Use timestamped log file to avoid locking issues during debug
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    frozen_status = "Frozen" if getattr(sys, 'frozen', False) else "Dev"
    log_file = os.path.join(log_dir, f'server_{timestamp}_{frozen_status}.log')
    
    # Configure logging to write to file AND stdout
    logging.basicConfig(
        level=logging.DEBUG,
        format='%(asctime)s [%(levelname)s] %(message)s',
        handlers=[
            logging.FileHandler(log_file),
            logging.StreamHandler(sys.stdout)
        ]
    )
    logging.info(f"Server Process Started ({frozen_status})")
    print(f"Logging to {log_file}")
except Exception as e:
    print(f"Failed to setup logging: {e}")

def cleanup_zombie_processes(port):
    """
    Checks if the given port is in use and kills the process using it.
    Crucial for preventing 'Address already in use' errors after restarts.
    """
    import subprocess
    import platform
    
    print(f"Checking for zombie processes on port {port}...")
    
    try:
        system = platform.system()
        
        if system == "Windows":
            # 1. Find PID using netstat
            # Output format: "  TCP    0.0.0.0:5006           0.0.0.0:0              LISTENING       1234"
            cmd = f'netstat -ano | findstr :{port}'
            process = subprocess.Popen(cmd, shell=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            stdout, _ = process.communicate()
            
            output = stdout.decode().strip()
            if not output:
                print("No zombie process found.")
                return

            lines = output.split('\n')
            for line in lines:
                parts = line.split()
                # Check if it's actually listening on our port
                if len(parts) >= 5 and f':{port}' in parts[1] and 'LISTENING' in parts[3]:
                    pid = parts[-1]
                    print(f"Found zombie process with PID: {pid}. Terminating...")
                    logging.info(f"Found zombie process with PID: {pid}. Terminating...")
                    
                    # 2. Kill PID
                    subprocess.run(f'taskkill /F /PID {pid}', shell=True)
                    print("Zombie process terminated.")
                    logging.info("Zombie process terminated.")
                    # Give it a moment to release the port
                    time.sleep(1)
                    
        else:
            # Linux/macOS
            # 1. Find PID using lsof
            cmd = f'lsof -t -i:{port}'
            process = subprocess.Popen(cmd, shell=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            stdout, _ = process.communicate()
            
            pid = stdout.decode().strip()
            if pid:
                print(f"Found zombie process with PID: {pid}. Terminating...")
                subprocess.run(f'kill -9 {pid}', shell=True)
                print("Zombie process terminated.")
                time.sleep(1)
            else:
                print("No zombie process found.")
                
    except Exception as e:
        print(f"Error during zombie cleanup: {e}")
        # Log if possible, but don't crash startup
        try:
            logging.error(f"Zombie cleanup failed: {e}")
        except:
            pass


# Wrap imports to catch dependency errors
try:
    from tracker import BehaviorTracker
    from analyzer import FocusAnalyzer
    from config import Config
except Exception as e:
    if getattr(sys, 'frozen', False):
        logging.fatal(f"Failed to import dependencies: {e}", exc_info=True)
    raise e

app = Flask(__name__, static_folder='static')
analyzer = FocusAnalyzer()

# Enable CORS for all routes
@app.after_request
def add_cors_headers(response):
    response.headers['Access-Control-Allow-Origin'] = '*'
    response.headers['Access-Control-Allow-Headers'] = 'Content-Type'
    response.headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS'
    return response

# This will be set by OveloServer
current_tracker = None

@app.route('/')
def serve_index():
    return send_from_directory(app.static_folder, 'index.html')

@app.route('/<path:path>')
def serve_static(path):
    return send_from_directory(app.static_folder, path)

@app.route('/today_state')
@app.route('/api/today')
def get_today_data():
    # Get all available data
    if current_tracker:
        raw_data = current_tracker.get_data()
    elif os.path.exists(Config.DATA_FILE):
        with open(Config.DATA_FILE, 'r') as f:
            raw_data = json.load(f)
    else:
        return jsonify({'timeline': [], 'reflection': 'No data available'})
    
    # Filter for last 24 hours (rolling window, not just today)
    import time
    now = time.time()
    twenty_four_hours_ago = now - (24 * 60 * 60)
    last_24h_data = [d for d in raw_data if d.get('timestamp', 0) >= twenty_four_hours_ago]
    
    if not last_24h_data:
        return jsonify({'timeline': [], 'reflection': None})
    
    # Process with ALL historical data as reference (for natural threshold)
    processed = analyzer.process_day(last_24h_data, reference_data=raw_data)
    timeline = processed.get('timeline', [])
    
    # Check for existing reflection in profile
    reflection = None
    profile_file = os.path.join(Config.BASE_DIR, "user_profile.json")
    if os.path.exists(profile_file):
        try:
            with open(profile_file, 'r') as f:
                profile = json.load(f)
                history = profile.get('reflectionHistory', [])
                if history:
                    last_reflection = history[-1]
                    # Check if it's from today (or reasonably recent, e.g., last 12 hours)
                    last_ts = datetime.fromisoformat(last_reflection['timestamp'])
                    if (datetime.now() - last_ts).total_seconds() < 12 * 3600:
                        reflection = last_reflection['text']
        except Exception as e:
            print(f"Error reading profile for reflection: {e}")
    
    # Compress long idle periods (e.g., overnight)
    # Replace consecutive idle intervals > 30 mins with a single "gap" marker
    IDLE_COMPRESSION_THRESHOLD = 30 * 60  # 30 minutes in seconds
    compressed_timeline = []
    
    i = 0
    while i < len(timeline):
        point = timeline[i]
        
        if point['state'] == 'Idle':
            # Start of potential idle streak
            idle_start = i
            idle_start_time = point['timestamp']
            
            # Find end of idle streak
            while i < len(timeline) and timeline[i]['state'] == 'Idle':
                i += 1
            
            idle_end_time = timeline[i-1]['timestamp'] if i > 0 else idle_start_time
            idle_duration = idle_end_time - idle_start_time
            
            if idle_duration > IDLE_COMPRESSION_THRESHOLD:
                # Replace long idle with a single gap marker
                compressed_timeline.append({
                    'timestamp': idle_start_time,
                    'state': 'IdleGap',
                    'intensity': 0.1,
                    'dominant_app': 'System Idle',
                    'metrics': {},
                    'gap_duration': idle_duration,
                    'gap_end_time': idle_end_time
                })
            else:
                # Keep short idle periods as-is
                for j in range(idle_start, i):
                    compressed_timeline.append(timeline[j])
        else:
            # Non-idle interval, keep as-is
            compressed_timeline.append(point)
            i += 1
    
    timeline = compressed_timeline
    
    # Downsample to max 120 bars if needed
    MAX_BARS = 120
    if len(timeline) > MAX_BARS:
        # Calculate interval size for downsampling
        interval_size = len(timeline) / MAX_BARS
        downsampled = []
        
        for i in range(MAX_BARS):
            start_idx = int(i * interval_size)
            end_idx = int((i + 1) * interval_size)
            chunk = timeline[start_idx:end_idx]
            
            if chunk:
                # Average the chunk
                avg_intensity = sum(p['intensity'] for p in chunk) / len(chunk)
                # Use most common state in chunk
                states = [p['state'] for p in chunk]
                most_common_state = max(set(states), key=states.count)
                
                downsampled.append({
                    'timestamp': chunk[0]['timestamp'],
                    'state': most_common_state,
                    'intensity': avg_intensity,
                    'dominant_app': chunk[0].get('dominant_app', 'Unknown'),
                    'metrics': chunk[0].get('metrics', {})
                })
        
        timeline = downsampled
    
    # NOTE: Reflection is now manually triggered via /api/generate_reflection
    # reflection = analyzer.generate_reflection(last_24h_data)
    
    return jsonify({
        'timeline': timeline,
        'reflection': reflection 
    })

@app.route('/day_summary')
def get_day_summary():
    from flask import request
    date_str = request.args.get('date')
    if not date_str:
        return jsonify({'error': 'Date required'}), 400
    
    # Try to find data for that date
    target_file = f"focus_data_{date_str}.json"
    data = []
    
    if os.path.exists(target_file):
        with open(target_file, 'r') as f:
            data = json.load(f)
    elif os.path.exists(Config.DATA_FILE):
        with open(Config.DATA_FILE, 'r') as f:
            all_data = json.load(f)
        
        try:
            target_date = datetime.strptime(date_str, '%Y-%m-%d').date()
            start_ts = datetime.combine(target_date, datetime.min.time()).timestamp()
            end_ts = datetime.combine(target_date, datetime.max.time()).timestamp()
            data = [d for d in all_data if start_ts <= d['timestamp'] <= end_ts]
        except ValueError:
            return jsonify({'error': 'Invalid date format'}), 400
            
    if not data:
        return jsonify({'timeline': [], 'summary': None})

    processed = analyzer.process_day(data)
    return jsonify(processed)

@app.route('/api/save_reflection', methods=['POST'])
def save_reflection_endpoint():
    try:
        from flask import request
        data = request.json
        text = data.get('text')
        persona = data.get('persona', 'calm_coach')
        
        if not text:
            return jsonify({'error': 'No text provided'}), 400

        profile_file = os.path.join(Config.BASE_DIR, "user_profile.json")
        profile = {}
        if os.path.exists(profile_file):
            with open(profile_file, 'r') as f:
                profile = json.load(f)
        
        if 'reflectionHistory' not in profile:
            profile['reflectionHistory'] = []
            
        profile['reflectionHistory'].append({
            'timestamp': datetime.now().isoformat(),
            'persona': persona,
            'text': text
        })
        
        # Keep last 30
        profile['reflectionHistory'] = profile['reflectionHistory'][-30:]
        
        with open(profile_file, 'w') as f:
            json.dump(profile, f, indent=2)
            
        return jsonify({'status': 'success'})
    except Exception as e:
        print(f"Error saving reflection: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/generate_reflection', methods=['POST'])
@app.route('/api/generate_reflection', methods=['GET', 'POST'])
def trigger_reflection():
    # Get all available data
    if current_tracker:
        raw_data = current_tracker.get_data()
    elif os.path.exists(Config.DATA_FILE):
        with open(Config.DATA_FILE, 'r') as f:
            raw_data = json.load(f)
    else:
        return jsonify({'reflection': 'No data available'})
    
    # Filter for last 24 hours (rolling window)
    import time
    now = time.time()
    three_days_ago = now - (72 * 60 * 60)
    relevant_data = [d for d in raw_data if d.get('timestamp', 0) >= three_days_ago]
    
    # Reload analyzer profile to get latest persona selection
    analyzer.profile = analyzer.learning.load_profile()
    
    # Check for existing recent reflection to save tokens
    from flask import request
    from datetime import datetime
    force_new = request.args.get('force', 'false').lower() == 'true'
    
    profile_file = os.path.join(Config.BASE_DIR, "user_profile.json")
    current_profile = {}
    if os.path.exists(profile_file):
        with open(profile_file, 'r') as f:
            current_profile = json.load(f)
            
    if not force_new:
        history = current_profile.get('reflectionHistory', [])
        if history:
            last_reflection = history[-1]
            last_ts = datetime.fromisoformat(last_reflection['timestamp'])
            # If less than 1 hour old, return cached
            if (datetime.now() - last_ts).total_seconds() < 3600:
                return jsonify({'reflection': last_reflection['text'], 'cached': True})

    reflection = analyzer.generate_reflection(relevant_data)
    
    # NOTE: This returns the PROMPT for the frontend to send to Supabase/Gemini API
    # The actual AI response is received by the frontend, which should save it
    
    return jsonify({'reflection': reflection})

@app.route('/api/replay')
def get_replay_data():
    if current_tracker:
        data = current_tracker.get_data()
    elif os.path.exists(Config.DATA_FILE):
        with open(Config.DATA_FILE, 'r') as f:
            data = json.load(f)
    else:
        return jsonify({'replay_segments': []})

    # Get only today's data for replay
    today_start = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0).timestamp()
    today_data = [d for d in data if d['timestamp'] >= today_start]
    
    processed = analyzer.process_day(today_data)
    timeline = processed.get('timeline', [])
    replay_segments = analyzer.prepare_replay_timeline(timeline)
    
    return jsonify({'replay_segments': replay_segments})

@app.route('/api/passport')
def get_passport_data():
    # Load all available history for the passport
    if current_tracker:
        data = current_tracker.get_data()
    elif os.path.exists(Config.DATA_FILE):
        with open(Config.DATA_FILE, 'r') as f:
            data = json.load(f)
    else:
        return jsonify(None)
        
    passport_data = analyzer.generate_passport_data(data)
    return jsonify(passport_data)

@app.route('/api/save_profile', methods=['POST'])
def save_profile():
    try:
        from flask import request
        new_data = request.get_json()
        profile_file = os.path.join(Config.BASE_DIR, "user_profile.json")
        
        # Load existing profile if it exists
        current_profile = {}
        if os.path.exists(profile_file):
            with open(profile_file, 'r') as f:
                try:
                    current_profile = json.load(f)
                except:
                    pass
        
        # Update with new data (merge)
        current_profile.update(new_data)
        
        with open(profile_file, 'w') as f:
            json.dump(current_profile, f, indent=2)
        
        # Reload analyzer profile
        if analyzer:
            analyzer.profile = analyzer.learning.load_profile()
            analyzer.thresholds = analyzer.profile.get('thresholds', {})
            analyzer.thresholds = analyzer.profile.get('thresholds', {})
            analyzer.activity_multiplier = analyzer.thresholds.get('activity_multiplier', 1.0)
            
        if current_tracker:
            privacy_level = current_profile.get('privacyLevel', 'smart')
            current_tracker.set_privacy_level(privacy_level)
        
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})

@app.route('/api/sync_device_id', methods=['POST'])
def sync_device_id():
    """Sync the device ID from frontend to backend."""
    try:
        from flask import request
        data = request.get_json()
        device_id = data.get('deviceId')
        
        if not device_id:
            return jsonify({'success': False, 'error': 'deviceId required'}), 400
        
        # Save to file
        device_file = os.path.join(Config.BASE_DIR, "device_id.txt")
        with open(device_file, 'w') as f:
            f.write(device_id)
        
        print(f"[Server] Device ID synced: {device_id}")
        print(f"[Server] Device ID synced: {device_id}")
        return jsonify({'success': True, 'deviceId': device_id})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/get_device_id', methods=['GET'])
def get_device_id_endpoint():
    """Get the persistent device ID from the backend."""
    try:
        # Create if not exists
        device_id = analyzer._get_device_id()
        return jsonify({'success': True, 'deviceId': device_id})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/save_reflection', methods=['POST'])
def save_reflection():
    """Save a reflection to a dedicated history file for persistence"""
    try:
        from flask import request
        data = request.get_json()
        text = data.get('text', '')
        persona = data.get('persona', 'calm_coach')
        
        # Use dedicated file at same location as ovelo_data.json
        history_file = os.path.join(Config.BASE_DIR, "reflection_history.json")
        print(f"[DEBUG] Saving reflection to: {history_file}")
        
        # Load existing history
        history = []
        if os.path.exists(history_file):
            try:
                with open(history_file, 'r') as f:
                    history = json.load(f)
            except:
                pass
        
        # Add new reflection
        reflection_entry = {
            'text': text,
            'persona': persona,
            'timestamp': datetime.now().isoformat()
        }
        history.append(reflection_entry)
        
        # Keep only last 30 reflections
        history = history[-30:]
        
        print(f"[DEBUG] Saved reflection #{len(history)} for persona {persona}")
        
        # Save to dedicated file
        with open(history_file, 'w') as f:
            json.dump(history, f, indent=2)
        
        return jsonify({'success': True})
    except Exception as e:
        print(f"Error saving reflection: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/reflection_history')
def get_reflection_history():
    """Get past reflections for history view"""
    # Use dedicated file at same location as ovelo_data.json
    history_file = os.path.join(Config.BASE_DIR, "reflection_history.json")
    print(f"[DEBUG] Loading reflection history from: {history_file}")
    
    if os.path.exists(history_file):
        try:
            with open(history_file, 'r') as f:
                history = json.load(f)
                print(f"[DEBUG] Loaded {len(history)} reflections")
                # Return in reverse chronological order (newest first)
                return jsonify({'history': list(reversed(history))})
        except Exception as e:
            print(f"Error reading reflection history: {e}")
            return jsonify({'history': []})
    print("[DEBUG] No reflection history file found")
    return jsonify({'history': []})

@app.route('/api/get_profile')
def get_profile():
    """Get the current user profile"""
    profile_file = os.path.join(Config.BASE_DIR, "user_profile.json")
    if os.path.exists(profile_file):
        with open(profile_file, 'r') as f:
            try:
                return jsonify(json.load(f))
            except:
                return jsonify({})
    return jsonify({})

@app.route('/api/delete_database', methods=['POST'])
def delete_database():
    """Delete the tracker database file"""
    try:
        if os.path.exists(Config.DATA_FILE):
            os.remove(Config.DATA_FILE)
            
            # Also clear current tracker memory if active
            if current_tracker:
                current_tracker.data = []
                current_tracker.last_save_time = time.time()
                
            return jsonify({'success': True})
        else:
            return jsonify({'success': True, 'message': 'Database already empty'})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})

@app.route('/api/check_profile')
def check_profile():
    profile_file = os.path.join(Config.BASE_DIR, "user_profile.json")
    exists = os.path.exists(profile_file)
    return jsonify({'exists': exists})

@app.route('/api/logout', methods=['POST'])
def logout():
    try:
        profile_file = os.path.join(Config.BASE_DIR, "user_profile.json")
        if os.path.exists(profile_file):
            os.remove(profile_file)
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})

@app.route('/api/update_profile', methods=['POST'])
@app.route('/api/update_settings', methods=['POST'])
def update_profile_proxy():
    return save_profile()

@app.route('/api/reset_account', methods=['POST'])
def reset_account_proxy():
    return delete_database()

@app.route('/api/delete_account', methods=['POST', 'DELETE'])
def delete_account_proxy():
    try:
        # Delete database first
        delete_database()
        # Then delete profile (logout logic)
        return logout()
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})

class OveloServer:
    def __init__(self, tracker, analyzer_instance):
        global app, current_tracker, analyzer
        self.app = app
        self.tracker = tracker
        self.analyzer = analyzer_instance
        self.port = Config.PORT
        
        # Set globals
        current_tracker = tracker
        analyzer = analyzer_instance

    def run(self):
        # Prevent port conflicts by killing old instances
        cleanup_zombie_processes(self.port)
        
        # Disable Flask banner
        import logging
        log = logging.getLogger('werkzeug')
        log.setLevel(logging.ERROR)
        self.app.run(port=self.port, debug=False, use_reloader=False)

    def start_thread(self):
        thread = threading.Thread(target=self.run)
        thread.daemon = True
        thread.start()

if __name__ == '__main__':
    try:
        # 1. Initialize Tracker
        tracker = BehaviorTracker()
        
        # 2. Initialize Analyzer
        analyzer = FocusAnalyzer()
        
        # 3. Initialize Server
        server = OveloServer(tracker, analyzer)
        
        # 4. Start Tracker (Background Thread)
        tracker.start()
        
        # 5. Start Server (Blocking Main Thread)
        print("Starting Ovelo Server...")
        server.run()
        
    except Exception as e:
        import traceback
        traceback.print_exc()
        logging.fatal(f"Fatal Startup Error: {e}", exc_info=True)
        # Keep window open if in console mode
        try:
            input("Press Enter to exit...")
        except:
            pass
