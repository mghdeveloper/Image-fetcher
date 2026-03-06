from flask import Flask, request, Response
from playwright.sync_api import sync_playwright
from urllib.parse import urlparse
import threading
import os
import json

app = Flask(__name__)

COOKIE_DIR = "cookies"
os.makedirs(COOKIE_DIR, exist_ok=True)

browser = None
playwright = None
browser_lock = threading.Lock()

domain_states = {}
domain_locks = {}


def get_browser():
    global browser, playwright

    if browser is None:

        with browser_lock:

            if browser is None:

                print("[INIT] Starting Playwright browser...")

                playwright = sync_playwright().start()

                browser = playwright.chromium.launch(
                    headless=True,
                    args=[
                        "--no-sandbox",
                        "--disable-dev-shm-usage",
                        "--disable-gpu",
                        "--disable-blink-features=AutomationControlled"
                    ]
                )

                print("[INIT] Browser started")

    return browser


def get_domain(url):
    return urlparse(url).hostname


def cookie_path(domain):
    return f"{COOKIE_DIR}/{domain}.json"


def get_domain_lock(domain):
    if domain not in domain_locks:
        domain_locks[domain] = threading.Lock()
    return domain_locks[domain]


def load_cookie_state(domain):

    path = cookie_path(domain)

    if os.path.exists(path):
        try:
            with open(path, "r") as f:
                state = json.load(f)
                domain_states[domain] = state
                return state
        except:
            pass

    return None


def save_cookie_state(domain, context):

    path = cookie_path(domain)

    context.storage_state(path=path)

    try:
        with open(path, "r") as f:
            domain_states[domain] = json.load(f)
    except:
        pass


def solve_cloudflare(domain):

    print(f"[CF] Solving Cloudflare for {domain}")

    browser = get_browser()

    context = browser.new_context()

    page = context.new_page()

    try:

        page.goto(
            f"https://{domain}",
            wait_until="domcontentloaded",
            timeout=30000
        )

        save_cookie_state(domain, context)

        print(f"[CF] Cookies saved for {domain}")

    except Exception as e:

        print("[CF] Error:", e)

    finally:

        context.close()


def fetch(url):

    domain = get_domain(url)

    browser = get_browser()

    lock = get_domain_lock(domain)

    state = domain_states.get(domain)

    if state is None:
        state = load_cookie_state(domain)

    context_args = {}

    if state:
        print(f"[COOKIE] Using cached cookies for {domain}")
        context_args["storage_state"] = state
    else:
        print(f"[COOKIE] No cookies for {domain}")

    context = browser.new_context(**context_args)

    page = context.new_page()

    try:

        response = page.request.get(
            url,
            headers={
                "Referer": f"https://{domain}/",
                "Origin": f"https://{domain}"
            },
            timeout=20000
        )

        status = response.status
        body = response.body()
        headers = response.headers

    finally:

        context.close()

    if status in [403, 503]:

        print(f"[BLOCKED] Cloudflare triggered for {domain}")

        with lock:

            solve_cloudflare(domain)

        return fetch(url)

    return status, body, headers


@app.route("/")
def home():
    return """
    <html>
    <body>
        <h2>Playwright Cloudflare Image Proxy</h2>
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

        status, body, headers = fetch(url)

        content_type = headers.get("content-type", "image/webp")

        return Response(body, status=status, content_type=content_type)

    except Exception as e:

        print("[ERROR]", e)

        return str(e), 500


if __name__ == "__main__":

    print("Server running on http://0.0.0.0:5000")

    app.run(
        host="0.0.0.0",
        port=5000,
        threaded=True,
        debug=False,
        use_reloader=False
    )
