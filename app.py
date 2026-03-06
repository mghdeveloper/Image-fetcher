from flask import Flask, request, Response
from playwright.sync_api import sync_playwright
from urllib.parse import urlparse
import os
import threading
import json

app = Flask(__name__)

COOKIE_DIR = "cookies"
os.makedirs(COOKIE_DIR, exist_ok=True)

browser = None
playwright = None
browser_lock = threading.Lock()

domain_states = {}
domain_locks = {}


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
        with open(path, "r") as f:
            return json.load(f)

    return None


def save_cookie_state(domain, context):

    path = cookie_path(domain)

    context.storage_state(path=path)

    with open(path) as f:
        domain_states[domain] = json.load(f)


def solve_cloudflare(domain):

    print(f"[CF] solving challenge for {domain}")

    context = browser.new_context()

    page = context.new_page()

    page.goto(
        f"https://{domain}",
        wait_until="domcontentloaded",
        timeout=30000
    )

    save_cookie_state(domain, context)

    context.close()

    print(f"[CF] cookies saved for {domain}")


def fetch(url):

    domain = get_domain(url)

    lock = get_domain_lock(domain)

    with lock:

        state = domain_states.get(domain)

        if state is None:
            state = load_cookie_state(domain)

            if state:
                domain_states[domain] = state

    context_args = {}

    if state:
        print(f"[COOKIE] using cached cookies for {domain}")
        context_args["storage_state"] = state
    else:
        print(f"[COOKIE] no cookies for {domain}")

    context = browser.new_context(**context_args)

    page = context.new_page()

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

    context.close()

    if status in [403, 503]:

        print(f"[BLOCKED] refreshing cookies for {domain}")

        with lock:

            solve_cloudflare(domain)

        return fetch(url)

    return status, body, headers


@app.route("/")
def home():
    return """
    <h2>Ultra Fast Playwright Image Proxy</h2>
    <pre>/proxy?url=IMAGE_URL</pre>
    """


@app.route("/proxy")
def proxy():

    url = request.args.get("url")

    if not url:
        return "Missing url", 400

    try:

        status, body, headers = fetch(url)

        content_type = headers.get("content-type", "image/webp")

        return Response(body, status=status, content_type=content_type)

    except Exception as e:

        print("ERROR:", e)

        return str(e), 500


def start_browser():

    global playwright, browser

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

    print("Playwright browser started")


if __name__ == "__main__":

    start_browser()

    print("Server running on http://0.0.0.0:5000")

    app.run(
        host="0.0.0.0",
        port=5000,
        threaded=True,
        debug=False,
        use_reloader=False
    )
