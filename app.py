from flask import Flask, request, Response
from playwright.sync_api import sync_playwright
import threading
import time
import os

app = Flask(__name__)

COOKIE_FILE = "cookies.json"
COOKIE_REFRESH_INTERVAL = 1800  # 30 minutes


def refresh_cookies():
    while True:
        try:
            with sync_playwright() as p:

                browser = p.chromium.launch(
                    headless=True,
                    args=[
                        "--no-sandbox",
                        "--disable-dev-shm-usage",
                        "--disable-gpu",
                        "--disable-blink-features=AutomationControlled",
                    ]
                )

                context = browser.new_context()

                page = context.new_page()

                print("Refreshing cookies...")

                page.goto(
                    "https://comix.to/",
                    wait_until="domcontentloaded",
                    timeout=15000
                )

                context.storage_state(path=COOKIE_FILE)

                browser.close()

                print("Cookies updated")

        except Exception as e:
            print("Cookie refresh error:", e)

        time.sleep(COOKIE_REFRESH_INTERVAL)


@app.route("/")
def home():
    return """
    <html>
    <body>
        <h2>Playwright Headless Proxy</h2>
        <p>Usage:</p>
        <pre>/proxy?url=IMAGE_URL</pre>
    </body>
    </html>
    """


@app.route("/proxy")
def proxy():

    url = request.args.get("url")

    if not url:
        return "Missing url parameter", 400

    try:
        with sync_playwright() as p:

            browser = p.chromium.launch(
                headless=True,
                args=[
                    "--no-sandbox",
                    "--disable-dev-shm-usage",
                    "--disable-gpu",
                ]
            )

            if os.path.exists(COOKIE_FILE):
                context = browser.new_context(storage_state=COOKIE_FILE)
            else:
                context = browser.new_context()

            page = context.new_page()

            response = page.request.get(
                url,
                headers={
                    "Referer": "https://comix.to/",
                    "Origin": "https://comix.to"
                },
                timeout=15000
            )

            body = response.body()
            status = response.status
            content_type = response.headers.get("content-type", "image/webp")

            browser.close()

            return Response(body, status=status, content_type=content_type)

    except Exception as e:
        return str(e), 500


def start_cookie_worker():
    thread = threading.Thread(target=refresh_cookies, daemon=True)
    thread.start()


if __name__ == "__main__":

    print("Starting cookie worker...")
    start_cookie_worker()

    print("Server running on http://localhost:5000")

    app.run(
        host="0.0.0.0",
        port=5000,
        debug=False,
        threaded=True,
        use_reloader=False
    )
