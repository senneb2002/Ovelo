import google.generativeai as genai
from src.config import Config

genai.configure(api_key=Config.GEMINI_API_KEY)

for m in genai.list_models():
    if 'generateContent' in m.supported_generation_methods:
        print(m.name)
