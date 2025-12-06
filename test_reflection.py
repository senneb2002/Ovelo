"""
Test for reflection personas.
Updated to work with the new Supabase Edge Function proxy approach.
"""
import sys
import os
import time
from unittest.mock import patch, MagicMock

# Add python folder to path
sys.path.insert(0, os.path.join(os.getcwd(), 'python'))

from analyzer import FocusAnalyzer

def test_personas():
    print("Testing Reflection Personas...")
    
    # Create analyzer (no longer needs API key)
    analyzer = FocusAnalyzer()
    
    # Create dummy data
    dummy_data = []
    base_time = time.time()
    
    for i in range(10):
        interval = {
            "timestamp": base_time + i * 300,
            "keystrokes": 100 if i < 5 else 0,
            "mouse_clicks": 20 if i < 5 else 5,
            "mouse_scrolls": 10,
            "window_switches": 1 if i < 5 else 10,
            "is_idle": True if i >= 8 else False,
            "active_window": "Code" if i < 5 else "Twitter"
        }
        dummy_data.append(interval)

    personas = ['calm_coach', 'scientist', 'no_bullshit', 'unhinged', 'ceo']
    
    # Mock the proxy call
    with patch.object(analyzer, '_call_gemini_proxy') as mock_proxy:
        mock_proxy.return_value = "Mocked Reflection Response"
        
        for persona in personas:
            print(f"\n--- Testing Persona: {persona} ---")
            analyzer.profile['reflectionPersona'] = persona
            
            result = analyzer.generate_reflection(dummy_data)
            
            # Verify the proxy was called with correct persona
            call_args = mock_proxy.call_args
            if call_args:
                prompt, called_persona = call_args[0]
                print(f"Prompt generated successfully.")
                print(f"Called with persona: {called_persona}")
                print(f"Persona matches? {called_persona == persona}")
            else:
                print("Error: _call_gemini_proxy was not called.")

if __name__ == "__main__":
    test_personas()
