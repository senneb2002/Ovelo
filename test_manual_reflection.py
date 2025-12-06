"""
Test for manual reflection with full data context.
Updated to work with the new Supabase Edge Function proxy approach.
"""
import sys
import os
import time
from unittest.mock import patch

# Add python folder to path
sys.path.insert(0, os.path.join(os.getcwd(), 'python'))

from analyzer import FocusAnalyzer

def test_manual_reflection():
    print("Testing Manual Reflection with Full Data Context...")
    
    analyzer = FocusAnalyzer()
    
    # Create dummy data with specific apps to test context
    dummy_data = []
    base_time = time.time()
    
    # Add some "Minecraft" usage to see if it appears in the prompt
    for i in range(5):
        interval = {
            "timestamp": base_time + i * 300,
            "keystrokes": 5,
            "mouse_clicks": 50,
            "mouse_scrolls": 0,
            "window_switches": 0,
            "is_idle": False,
            "active_window": "Minecraft"
        }
        dummy_data.append(interval)
        
    analyzer.profile['reflectionPersona'] = 'unhinged'
    
    # Mock reflection history
    analyzer.profile['reflectionHistory'] = [
        {'timestamp': '2023-10-26T10:00:00', 'text': 'Past reflection 1'},
        {'timestamp': '2023-10-27T10:00:00', 'text': 'Past reflection 2'}
    ]
    
    # Mock the proxy call to capture the prompt
    with patch.object(analyzer, '_call_gemini_proxy') as mock_proxy:
        mock_proxy.return_value = "Mocked Reflection"
        
        analyzer.generate_reflection(dummy_data)
        
        call_args = mock_proxy.call_args
        if call_args:
            prompt = call_args[0][0]
            print("Prompt generated successfully.")
            
            # Check if raw data is present
            if "Minecraft" in prompt:
                print("SUCCESS: Raw app data (Minecraft) found in prompt.")
            else:
                print("FAILURE: Raw app data NOT found in prompt.")
                
            if "RAW ACTIVITY LOG" in prompt:
                print("SUCCESS: 'RAW ACTIVITY LOG' section found.")
            else:
                print("FAILURE: 'RAW ACTIVITY LOG' section missing.")
                
            if "PAST REFLECTIONS" in prompt:
                print("SUCCESS: 'PAST REFLECTIONS' section found.")
            else:
                print("FAILURE: 'PAST REFLECTIONS' section missing.")

            if "VISUAL CONTEXT" in prompt:
                print("SUCCESS: 'VISUAL CONTEXT' section found.")
            else:
                print("FAILURE: 'VISUAL CONTEXT' section missing.")

            print("\nPrompt Snippet:")
            print('\n'.join(prompt.split('\n')[-15:]))
        else:
            print("Error: _call_gemini_proxy was not called.")

if __name__ == "__main__":
    test_manual_reflection()
