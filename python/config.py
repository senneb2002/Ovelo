import os

class Config:
    # Supabase Edge Function for Gemini proxy
    SUPABASE_REFLECTION_URL = "https://huuwlnviesmjatrzgdbp.functions.supabase.co/generate-reflection"
    SUPABASE_ANON_KEY = os.getenv("SUPABASE_ANON_KEY", "")  # Optional if verify_jwt = false
    
    import sys
    if getattr(sys, 'frozen', False):
        # Running as compiled exe: use system appropriate app data dir
        if sys.platform == 'win32':
            BASE_DIR = os.path.join(os.environ.get('APPDATA', '.'), 'Ovelo')
        elif sys.platform == 'darwin':
             BASE_DIR = os.path.expanduser('~/Library/Application Support/Ovelo')
        else:
             BASE_DIR = os.path.expanduser('~/.ovelo')
        
        if not os.path.exists(BASE_DIR):
            os.makedirs(BASE_DIR)
    else:
        # Dev mode: use project root
        BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    DATA_FILE = os.path.join(BASE_DIR, "ovelo_data.json")
    TRACKING_INTERVAL = 5  # seconds
    PORT = 5006
