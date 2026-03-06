from flask import Flask, request, Response
from playwright.sync_api import sync_playwright

app = Flask(__name__)

playwright = None
browser = None
context = None

def start_browser():
    global playwright, browser, context

    playwright = sync_playwright().start()

    browser = playwright.chromium.launch(
        headless=True,
        args=[
            "--no-sandbox",
            "--disable-dev-shm-usage",
            "--disable-gpu",
            "--disable-blink-features=AutomationControlled",
        ]
    )

    context = browser.new_context(
        viewport={"width": 1280, "height": 800},
        user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
        locale="en-US"
    )

    print("Browser started")


@app.route("/")
def home():
    return "Playwright Proxy Running"


@app.route("/proxy")
def proxy():
    url = request.args.get("url")

    if not url:
        return "Missing url parameter", 400

    try:
        response = context.request.get(
            url,
            headers={
                "Referer": "https://comix.to/",
                "Origin": "https://comix.to"
            },
            timeout=15000
        )

        body = response.body()

        return Response(
            body,
            status=response.status,
            content_type=response.headers.get("content-type", "image/webp")
        )

    except Exception as e:
        return str(e), 500


if __name__ == "__main__":
    start_browser()

    app.run(
        host="0.0.0.0",
        port=5000,
        threaded=False
    )
    
