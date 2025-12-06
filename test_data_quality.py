"""
Test for data quality filtering in reflection prompts.
Updated to work with the new Supabase Edge Function proxy approach.
"""
import sys
import os
import time
from unittest.mock import patch

# Add python folder to path
sys.path.insert(0, os.path.join(os.getcwd(), 'python'))

from analyzer import FocusAnalyzer

def test_data_filtering():
    print("Testing Data Quality Filtering...")
    
    analyzer = FocusAnalyzer()
    
    # Create dummy data
    dummy_data = []
    base_time = time.time()
    
    # 1. High activity app (should keep)
    for i in range(5):
        dummy_data.append({
            "timestamp": base_time + i * 5,
            "active_window": "Code",
            "keystrokes": 10, # Total 50
            "mouse_clicks": 0,
            "mouse_scrolls": 0,
            "is_idle": False
        })
        
    # 2. Low activity background app (should filter to "System")
    for i in range(5):
        dummy_data.append({
            "timestamp": base_time + 100 + i * 5,
            "active_window": "Assembly Instruction",
            "keystrokes": 0,
            "mouse_clicks": 1, # Total 5 (below threshold 10)
            "mouse_scrolls": 0,
            "is_idle": False
        })
        
    # 3. Media app (should keep even with low activity)
    for i in range(5):
        dummy_data.append({
            "timestamp": base_time + 200 + i * 5,
            "active_window": "Spotify",
            "keystrokes": 0,
            "mouse_clicks": 0,
            "mouse_scrolls": 0,
            "is_idle": False
        })

    # Mock the proxy call to capture the prompt
    with patch.object(analyzer, '_call_gemini_proxy') as mock_proxy:
        mock_proxy.return_value = "Mocked Reflection"
        
        analyzer.generate_reflection(dummy_data)
        
        call_args = mock_proxy.call_args
        if call_args:
            prompt = call_args[0][0]
            
            print("\nVerifying Prompt Content:")
            
            if "Code" in prompt:
                print("SUCCESS: High activity app 'Code' preserved.")
            else:
                print("FAILURE: 'Code' missing.")
                
            if "Assembly Instruction" not in prompt:
                print("SUCCESS: Low activity app 'Assembly Instruction' filtered out.")
            else:
                print("FAILURE: 'Assembly Instruction' still present.")
                
            if "Spotify" in prompt:
                print("SUCCESS: Media app 'Spotify' preserved.")
            else:
                print("FAILURE: 'Spotify' missing.")
                
            if "System" in prompt:
                print("SUCCESS: 'System' placeholder found.")
            
        else:
            print("Error: _call_gemini_proxy was not called.")

if __name__ == "__main__":
    test_data_filtering()
