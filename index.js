import express from "express";
import axios from "axios";
import { chromium } from "playwright";

const app = express();
const PORT = process.env.PORT || 10000;

let browser;
let context;
let page;

let cookiesCache = null;
let lastTokenTime = 0;
let refreshPromise = null;

const TOKEN_TTL = 10 * 60 * 1000; // 10 minutes

/* =========================
   BROWSER INIT
========================= */

async function initBrowser() {
  if (browser) return;

  console.log("Launching Chromium...");

  browser = await chromium.launch({
    headless: true,
    executablePath: chromium.executablePath(),
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--single-process"
    ]
  });

  context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
    viewport: { width: 1280, height: 800 }
  });

  page = await context.newPage();

  browser.on("disconnected", () => {
    console.log("Browser crashed. Resetting...");
    browser = null;
    context = null;
    page = null;
    cookiesCache = null;
  });
}

/* =========================
   COOKIE REFRESH
========================= */

async function refreshCookies(targetUrl) {
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    try {
      await initBrowser();

      const domain = new URL(targetUrl).origin;

      console.log("Refreshing Cloudflare token for:", domain);

      await page.goto(domain, {
        waitUntil: "domcontentloaded",
        timeout: 45000
      });

      // allow CF JS challenge to finish
      await page.waitForTimeout(7000);

      cookiesCache = await context.cookies();
      lastTokenTime = Date.now();

      console.log("Cloudflare cookies updated");
    } catch (err) {
      console.error("Cookie refresh failed:", err.message);
      cookiesCache = null;
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

/* =========================
   BUILD COOKIE HEADER
========================= */

function buildCookieHeader() {
  if (!cookiesCache) return "";

  return cookiesCache
    .map(cookie => `${cookie.name}=${cookie.value}`)
    .join("; ");
}

/* =========================
   FETCH RESOURCE
========================= */

async function fetchWithCookies(url) {
  if (!cookiesCache || Date.now() - lastTokenTime > TOKEN_TTL) {
    await refreshCookies(url);
  }

  const headers = {
    Cookie: buildCookieHeader(),
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
    Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
    Referer: new URL(url).origin
  };

  try {
    let response = await axios.get(url, {
      headers,
      responseType: "arraybuffer",
      timeout: 20000,
      validateStatus: () => true
    });

    if (response.status === 200) {
      return response;
    }

    console.log("Blocked (", response.status, ") retrying with new cookies");

    await refreshCookies(url);

    headers.Cookie = buildCookieHeader();

    response = await axios.get(url, {
      headers,
      responseType: "arraybuffer",
      timeout: 20000
    });

    return response;
  } catch (err) {
    console.error("Fetch failed:", err.message);
    throw err;
  }
}

/* =========================
   ROUTES
========================= */

app.get("/health", (req, res) => {
  res.send("OK");
});

app.get("/fetch", async (req, res) => {
  const { url } = req.query;

  if (!url) {
    return res.status(400).send("Missing url parameter");
  }

  try {
    const response = await fetchWithCookies(url);

    res.set(
      "Content-Type",
      response.headers["content-type"] || "image/jpeg"
    );

    res.send(response.data);
  } catch {
    res.status(500).send("Failed to fetch resource");
  }
});

/* =========================
   START SERVER
========================= */

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
