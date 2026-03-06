from flask import Flask, request, Response
from playwright.sync_api import sync_playwright
import requests
import threading

app = Flask(__name__)

# Global variables
playwright = None
browser = None
context = None
cookies = {}
headers = {}
session = requests.Session()
lock = threading.Lock()  # Ensure thread-safe browser init


def start_browser():
    """Start Playwright browser and context."""
    global playwright, browser, context, cookies, headers

    if context is not None:
        # Already started
        return

    print("🔹 Starting Playwright browser...")

    playwright = sync_playwright().start()
    browser = playwright.chromium.launch(
        headless=True,
        args=[
            "--no-sandbox",
            "--disable-dev-shm-usage",
            "--disable-gpu"
        ]
    )

    context = browser.new_context(
        viewport={"width": 1280, "height": 800},
        user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                   "AppleWebKit/537.36 Chrome/120 Safari/537.36",
        locale="en-US"
    )

    print("✅ Playwright browser started")
    refresh_session()


def refresh_session():
    """Refresh cookies and headers using Playwright."""
    global cookies, headers, context

    if context is None:
        print("⚠️ Browser context not initialized")
        return

    print("🔄 Refreshing session via Playwright...")
    page = context.new_page()
    page.goto("https://comix.to/", wait_until="domcontentloaded")

    # Get cookies and headers
    cookies_list = context.cookies()
    cookies = {c["name"]: c["value"] for c in cookies_list}

    headers = {
        "User-Agent": page.evaluate("() => navigator.userAgent"),
        "Referer": "https://comix.to/",
        "Origin": "https://comix.to"
    }

    page.close()
    print(f"✅ Session refreshed ({len(cookies)} cookies)")


def fast_fetch(url):
    """Try to fetch via HTTP using cached cookies and headers."""
    print(f"⚡ Fast request: {url}")

    try:
        r = session.get(
            url,
            headers=headers,
            cookies=cookies,
            timeout=10
        )

        print(f"HTTP status: {r.status_code}")
        if r.status_code == 200:
            print("✅ Served via FAST HTTP request")
            return r

        print("⚠️ Fast request failed")
        return None

    except Exception as e:
        print("❌ Fast request error:", e)
        return None


@app.route("/")
def home():
    return "Playwright + Fast HTTP Proxy is running"


@app.route("/proxy")
def proxy():
    global context

    url = request.args.get("url")
    if not url:
        return "Missing url parameter", 400

    print("\n==============================")
    print("Incoming request:", url)

    # Lazy browser initialization (thread-safe)
    if context is None:
        with lock:
            if context is None:
                print("⚠️ Browser not initialized, starting now...")
                start_browser()

    # 1️⃣ Try fast fetch first
    r = fast_fetch(url)
    if r:
        return Response(
            r.content,
            status=r.status_code,
            content_type=r.headers.get("content-type", "image/webp")
        )

    # 2️⃣ Fallback: refresh Playwright session and retry
    print("🧠 Falling back to Playwright")
    refresh_session()

    r = fast_fetch(url)
    if r:
        return Response(
            r.content,
            status=r.status_code,
            content_type=r.headers.get("content-type", "image/webp")
        )

    print("❌ Request failed after Playwright fallback")
    return "Failed", 500


if __name__ == "__main__":
    # Local dev: start browser immediately
    start_browser()
    app.run(host="0.0.0.0", port=5000, threaded=True)
