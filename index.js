import express from "express";
import axios from "axios";
import { chromium } from "playwright";

const app = express();
const PORT = process.env.PORT || 10000;

let browser = null;
let context = null;
let page = null;
let cookiesCache = null;
let lastTokenTime = 0;
let isRefreshing = false;

const TOKEN_TTL = 10 * 60 * 1000; // 10 minutes

/* =========================
   SAFE BROWSER INIT
========================= */

async function initBrowser() {
  if (browser) return;

  console.log("Launching Chromium...");

  browser = await chromium.launch({
    headless: true,
    executablePath: chromium.executablePath(), // critical for Render
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage"
    ]
  });

  context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36"
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
   REFRESH CLOUDFLARE COOKIE
========================= */

async function refreshCookies(targetUrl) {
  if (isRefreshing) return;
  isRefreshing = true;

  try {
    await initBrowser();

    console.log("Refreshing Cloudflare token...");

    await page.goto(targetUrl, {
      waitUntil: "networkidle",
      timeout: 60000
    });

    await page.waitForTimeout(5000);

    cookiesCache = await context.cookies();
    lastTokenTime = Date.now();

    console.log("Cookies refreshed.");
  } catch (err) {
    console.error("Cookie refresh failed:", err.message);
  }

  isRefreshing = false;
}

/* =========================
   FETCH WITH COOKIE
========================= */

async function fetchWithCookies(url) {
  if (!cookiesCache || Date.now() - lastTokenTime > TOKEN_TTL) {
    await refreshCookies(url);
  }

  const cookieHeader = cookiesCache
    ? cookiesCache.map(c => `${c.name}=${c.value}`).join("; ")
    : "";

  try {
    const response = await axios.get(url, {
      headers: {
        Cookie: cookieHeader,
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
        Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8"
      },
      responseType: "arraybuffer",
      timeout: 20000,
      validateStatus: () => true
    });

    if (response.status === 200) {
      return response;
    }

    console.log("Image request blocked. Retrying with new token...");

    await refreshCookies(url);

    return await axios.get(url, {
      headers: {
        Cookie: cookiesCache.map(c => `${c.name}=${c.value}`).join("; "),
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36"
      },
      responseType: "arraybuffer"
    });

  } catch (err) {
    console.error("Final fetch failed:", err.message);
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
  if (!url) return res.status(400).send("Missing url parameter");

  try {
    const response = await fetchWithCookies(url);

    res.set("Content-Type", response.headers["content-type"] || "image/jpeg");
    res.send(response.data);

  } catch (err) {
    res.status(500).send("Failed to fetch resource");
  }
});

/* =========================
   START SERVER
========================= */

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
