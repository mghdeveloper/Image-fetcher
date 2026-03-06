import express from "express";
import { chromium } from "playwright";

const app = express();
const PORT = process.env.PORT || 10000;

let browser;
let context;
let page;

let lastLoadTime = 0;
let lockPromise = null;

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
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36"
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
   FETCH IMAGE DIRECT
========================= */

async function fetchImage(url) {
  if (lockPromise) await lockPromise;

  lockPromise = (async () => {
    await initBrowser();

    console.log("Loading image:", url);

    const response = await page.goto(url, {
      waitUntil: "commit",
      timeout: 45000
    });

    lastLoadTime = Date.now();

    if (!response) throw new Error("No response");

    const status = response.status();

    if (status !== 200) {
      console.log("Blocked with status:", status);
      throw new Error("Blocked");
    }

    const buffer = await response.body();

    return {
      data: buffer,
      type: response.headers()["content-type"]
    };
  })();

  const result = await lockPromise;
  lockPromise = null;

  return result;
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
  } catch (err) {
    console.error(err.message);
    res.status(500).send("Failed to fetch image");
  }
});

/* =========================
   START SERVER
========================= */

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
