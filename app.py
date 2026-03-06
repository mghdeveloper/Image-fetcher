from flask import Flask, request, Response
from playwright.sync_api import sync_playwright
import requests

app = Flask(__name__)

playwright = None
browser = None
context = None

cookies = {}
headers = {}

session = requests.Session()


def start_browser():
    global playwright, browser, context

    playwright = sync_playwright().start()

    browser = playwright.chromium.launch(headless=True)

    context = browser.new_context(
        user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36"
    )

    print("✅ Playwright browser started")

    refresh_session()


def refresh_session():
    global cookies, headers

    print("🔄 Refreshing cookies using Playwright...")

    page = context.new_page()

    page.goto("https://comix.to/", wait_until="domcontentloaded")

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


@app.route("/proxy")
def proxy():

    url = request.args.get("url")

    if not url:
        return "Missing url", 400

    print("\n==============================")
    print("Incoming request:", url)

    # 1️⃣ try fast request
    r = fast_fetch(url)

    if r:
        return Response(
            r.content,
            status=r.status_code,
            content_type=r.headers.get("content-type")
        )

    # 2️⃣ fallback to browser refresh
    print("🧠 Falling back to Playwright")

    refresh_session()

    r = fast_fetch(url)

    if r:
        return Response(
            r.content,
            status=r.status_code,
            content_type=r.headers.get("content-type")
        )

    print("❌ Request failed after refresh")

    return "Failed", 500


if __name__ == "__main__":

    start_browser()

    app.run(
        host="0.0.0.0",
        port=5000,
        threaded=True
    )
