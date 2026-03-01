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

const TOKEN_TTL = 10 * 60 * 1000; // 10 minutes

/* =========================
   BROWSER INITIALIZATION
========================= */

async function initBrowser() {
  if (browser) return;

  console.log("Launching Chromium...");

  browser = await chromium.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage"
    ]
  });

  context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36"
  });

  page = await context.newPage();
}

/* =========================
   GET CLOUDFLARE COOKIE
========================= */

async function getClearanceCookie(targetUrl) {
  await initBrowser();

  console.log("Solving Cloudflare challenge...");

  await page.goto(targetUrl, {
    waitUntil: "networkidle",
    timeout: 60000
  });

  await page.waitForTimeout(5000);

  const cookies = await context.cookies();
  cookiesCache = cookies;
  lastTokenTime = Date.now();

  console.log("Cookies acquired.");
  return cookies;
}

/* =========================
   FETCH WITH COOKIE
========================= */

async function fetchWithCookies(url) {
  if (!cookiesCache || Date.now() - lastTokenTime > TOKEN_TTL) {
    await getClearanceCookie(url);
  }

  try {
    const cookieHeader = cookiesCache
      .map(c => `${c.name}=${c.value}`)
      .join("; ");

    const response = await axios.get(url, {
      headers: {
        Cookie: cookieHeader,
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36"
      },
      responseType: "arraybuffer"
    });

    return response.data;
  } catch (err) {
    console.log("Request failed. Refreshing token...");
    cookiesCache = null;
    await getClearanceCookie(url);
    return fetchWithCookies(url);
  }
}

/* =========================
   ROUTE
========================= */

app.get("/fetch", async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).send("Missing url parameter");

  try {
    const data = await fetchWithCookies(url);
    res.set("Content-Type", "image/jpeg");
    res.send(data);
  } catch (err) {
    console.error(err);
    res.status(500).send("Failed to fetch resource");
  }
});

/* =========================
   START SERVER
========================= */

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
