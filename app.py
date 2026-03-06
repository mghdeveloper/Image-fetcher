from flask import Flask, request, Response
from playwright.sync_api import sync_playwright
import requests

app = Flask(__name__)

# Global variables
playwright = None
browser = None
context = None
cookies = {}
headers = {}
session = requests.Session()


def start_browser():
    """Start Playwright and initialize a browser context."""
    global playwright, browser, context

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
        print("⚠️ Browser context is None, cannot refresh session")
        return

    print("🔄 Refreshing session via Playwright...")

    page = context.new_page()
    page.goto("https://comix.to/", wait_until="domcontentloaded")

    # Collect cookies
    cookies_list = context.cookies()
    cookies = {c["name"]: c["value"] for c in cookies_list}

    # Collect headers
    headers = {
        "User-Agent": page.evaluate("() => navigator.userAgent"),
        "Referer": "https://comix.to/",
        "Origin": "https://comix.to"
    }

    page.close()
    print(f"✅ Session refreshed ({len(cookies)} cookies)")


def fast_fetch(url):
    """Try to fetch the image using requests + cached cookies/headers."""
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


@app.before_first_request
def init_browser():
    """Initialize browser when the first request hits Flask (works with Gunicorn)."""
    start_browser()


@app.route("/")
def home():
    return "Playwright + Fast HTTP Proxy is running"


@app.route("/proxy")
def proxy():
    url = request.args.get("url")
    if not url:
        return "Missing url parameter", 400

    print("\n==============================")
    print("Incoming request:", url)

    # 1️⃣ Try fast request
    r = fast_fetch(url)
    if r:
        return Response(
            r.content,
            status=r.status_code,
            content_type=r.headers.get("content-type", "image/webp")
        )

    # 2️⃣ Fallback to Playwright refresh
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


# Optional safety: allow running locally via python app.py
if __name__ == "__main__":
    start_browser()
    app.run(host="0.0.0.0", port=5000, threaded=True)
