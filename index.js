import express from "express";
import { chromium } from "playwright";

const app = express();
const PORT = process.env.PORT || 10000;

let browser;
let context;
let page;

let lastTokenTime = 0;
let refreshPromise = null;

const TOKEN_TTL = 10 * 60 * 1000;

/* =========================
   INIT BROWSER
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
  });
}

/* =========================
   SOLVE CLOUDFLARE
========================= */

async function solveCloudflare(url) {
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    await initBrowser();

    const domain = new URL(url).origin;

    console.log("Solving Cloudflare:", domain);

    await page.goto(domain, {
      waitUntil: "domcontentloaded",
      timeout: 45000
    });

    await page.waitForTimeout(7000);

    lastTokenTime = Date.now();

    console.log("Cloudflare solved");
  })();

  await refreshPromise;
  refreshPromise = null;
}

/* =========================
   FETCH IMAGE (BROWSER)
========================= */

async function fetchImage(url) {
  if (!browser || Date.now() - lastTokenTime > TOKEN_TTL) {
    await solveCloudflare(url);
  }

  try {
    const response = await page.request.get(url);

    if (response.status() === 200) {
      const buffer = await response.body();
      return {
        data: buffer,
        type: response.headers()["content-type"]
      };
    }

    console.log("Blocked. Re-solving Cloudflare...");

    await solveCloudflare(url);

    const retry = await page.request.get(url);

    return {
      data: await retry.body(),
      type: retry.headers()["content-type"]
    };
  } catch (err) {
    console.error("Image fetch failed:", err.message);
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
    const result = await fetchImage(url);

    res.set("Content-Type", result.type || "image/jpeg");
    res.send(result.data);
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
