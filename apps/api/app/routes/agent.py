
import os
import requests
from dotenv import load_dotenv

load_dotenv()


def get_weather(city: str):
    """Return wttr.in JSON for `city`."""
    url = f"https://wttr.in/{city}?format=j1"
    resp = requests.get(url, timeout=10)
    resp.raise_for_status()
    return resp.json()


def call_openrouter(prompt: str, model: str, api_key: str):
    """Call OpenRouter chat completions endpoint with a simple user prompt."""
    url = os.getenv("OPENROUTER_URL", "https://api.openrouter.ai/v1/chat/completions")
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    payload = {
        "model": model,
        "messages": [{"role": "user", "content": prompt}],
        "max_tokens": 128,
        "temperature": 0.2,
    }
    resp = requests.post(url, headers=headers, json=payload, timeout=60)
    resp.raise_for_status()
    return resp.json()


def main():
    city = "Paris"
    print(f"Fetching weather for {city} (wttr.in)...")
    try:
        w = get_weather(city)
        print("Weather JSON keys:", list(w.keys()))
    except Exception as e:
        print("get_weather failed:", e)
        return

    # Prefer OpenRouter (user will provide OPENROUTER_API_KEY in .env)
    or_key = os.getenv("OPENROUTER_API_KEY")
    or_model = os.getenv("OPENROUTER_MODEL", "gpt-4o-mini")
    if not or_key:
        print("OPENROUTER_API_KEY not set; skipping OpenRouter call. Set OPENROUTER_API_KEY in apps/api/.env to enable.")
        return

    # Compose a short prompt summarizing the weather
    excerpt = w.get("current_condition", [{}])[0].get("weatherDesc", [{}])[0].get("value", "")
    prompt = f"Summarize the weather in {city} in one short sentence. Extra info: {excerpt}"
    print(f"Calling OpenRouter model {or_model}...")

    try:
        out = call_openrouter(prompt, or_model, or_key)
        text = ""
        # OpenRouter returns chat-style responses similar to OpenAI: { choices: [{ message: { content: "..." } }] }
        if isinstance(out, dict) and out.get("choices"):
            ch = out["choices"][0]
            msg = ch.get("message") or {}
            text = msg.get("content") or ch.get("text") or str(ch)
        elif isinstance(out, dict):
            text = out.get("generated_text") or out.get("text") or str(out)
        else:
            text = str(out)
        print("OpenRouter response:", text)
    except Exception as e:
        print("OpenRouter request failed:", e)


if __name__ == "__main__":
    main()