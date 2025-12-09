import os
import sys
try:
    import win32com.client
except ImportError:
    win32com = None

def ensure_startup():
    """
    Creates a shortcut to run_ovelo.bat in the Windows Startup folder.
    """
    try:
        startup_dir = os.path.join(os.getenv('APPDATA'), r'Microsoft\Windows\Start Menu\Programs\Startup')
        shortcut_path = os.path.join(startup_dir, 'Ovelo.lnk')
        
        # Target: run_ovelo.bat in the project root
        # We assume src/startup.py is in src/, so project root is one level up
        project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        target_path = os.path.join(project_root, 'run_ovelo.bat')
        
        if not os.path.exists(target_path):
            print(f"Startup Error: Could not find {target_path}")
            return

        if not win32com:
            # On non-Windows or missing pywin32, skip shortcut creation
            return

        shell = win32com.client.Dispatch("WScript.Shell")
        shortcut = shell.CreateShortCut(shortcut_path)
        shortcut.Targetpath = target_path
        shortcut.WorkingDirectory = project_root
        shortcut.WindowStyle = 7 # Minimized (optional, but bat file might show cmd window)
        shortcut.save()
        
        print(f"Startup shortcut created at {shortcut_path}")
        
    except Exception as e:
        print(f"Failed to create startup shortcut: {e}")
