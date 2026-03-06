import os
import json
import tldextract
from urllib.parse import urlparse

from flask import Flask, request, Response
from playwright.sync_api import sync_playwright

app = Flask(__name__)

COOKIE_DIR = "cookies"
os.makedirs(COOKIE_DIR, exist_ok=True)


def get_main_domain(url):
    ext = tldextract.extract(url)
    return f"{ext.domain}.{ext.suffix}"


def cookie_path(domain):
    return os.path.join(COOKIE_DIR, f"{domain}.json")


def load_cookies(domain):
    path = cookie_path(domain)
    if os.path.exists(path):
        with open(path, "r") as f:
            return json.load(f)
    return None


def save_cookies(domain, cookies):
    with open(cookie_path(domain), "w") as f:
        json.dump(cookies, f)


@app.route("/")
def home():
    return "Playwright Proxy"


@app.route("/proxy")
def proxy():

    url = request.args.get("url")
    if not url:
        return "Missing url parameter", 400

    domain = get_main_domain(url)
    parsed = urlparse(url)
    base_url = f"{parsed.scheme}://{parsed.netloc}"

    try:
        with sync_playwright() as p:

            browser = p.chromium.launch(
                headless=True,
                args=[
                    "--no-sandbox",
                    "--disable-dev-shm-usage",
                    "--disable-gpu",
                ],
            )

            context = browser.new_context(
                user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36"
            )

            cookies = load_cookies(domain)

            if cookies:
                print(f"[COOKIE] Using cached cookies for {domain}")
                context.add_cookies(cookies)
            else:
                print(f"[COOKIE] No cookies for {domain}")

            page = context.new_page()

            # Open site root (Cloudflare check happens here)
            page.goto(base_url, wait_until="domcontentloaded", timeout=20000)

            # Fetch image
            response = page.request.get(
                url,
                headers={
                    "Referer": base_url,
                    "Origin": base_url,
                },
                timeout=20000
            )

            # If Cloudflare triggered, update cookies
            new_cookies = context.cookies()

            if new_cookies:
                save_cookies(domain, new_cookies)
                print(f"[COOKIE] Updated cookies for {domain}")

            body = response.body()
            status = response.status
            content_type = response.headers.get("content-type", "image/webp")

            browser.close()

            return Response(body, status=status, content_type=content_type)

    except Exception as e:
        return str(e), 500


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)
