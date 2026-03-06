from flask import Flask, request, Response
from playwright.sync_api import sync_playwright

app = Flask(__name__)


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
                    "--disable-blink-features=AutomationControlled",
                ]
            )

            context = browser.new_context(
                viewport={"width": 1280, "height": 800},
                user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
                locale="en-US"
            )

            page = context.new_page()

            # Visit main site to simulate real browser
            page.goto(
                "https://comix.to/",
                wait_until="domcontentloaded",
                timeout=15000
            )

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


if __name__ == "__main__":
    print("Server running on http://localhost:5000")

    app.run(
        host="0.0.0.0",
        port=5000,
        debug=False,
        threaded=False,
        use_reloader=False
    )
