const express = require('express');
const axios = require('axios');
const { chromium } = require('playwright');

const app = express();
const PORT = process.env.PORT || 3000;

const TARGET_HOST = 'https://c1.manhwatop.com';
const REFERER = 'https://manhwatop.com/';

let browser;
let context;
let cachedCookies = [];
let refreshing = false;

/* ================= INIT BROWSER ================= */

async function initBrowser() {
    if (browser) return;

    console.log("Launching Chromium...");

    browser = await chromium.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36'
    });

    await refreshCookies();
}

/* ================= REFRESH COOKIES ================= */

async function refreshCookies() {
    if (refreshing) return;
    refreshing = true;

    console.log("Refreshing Cloudflare cookies...");

    const page = await context.newPage();

    try {
        await page.goto('https://manhwatop.com/', {
            waitUntil: 'networkidle',
            timeout: 60000
        });

        await page.waitForTimeout(8000);

        cachedCookies = await context.cookies();
        console.log("Cookies refreshed successfully");
    } catch (err) {
        console.log("Cookie refresh failed:", err.message);
    }

    await page.close();
    refreshing = false;
}

/* ================= FETCH IMAGE ================= */

async function fetchImage(url) {

    const cookieHeader = cachedCookies
        .map(c => `${c.name}=${c.value}`)
        .join('; ');

    try {
        const res = await axios.get(url, {
            responseType: 'arraybuffer',
            timeout: 20000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
                'Referer': REFERER,
                'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
                'Cookie': cookieHeader
            }
        });

        return res;

    } catch {
        return null;
    }
}

/* ================= ROUTES ================= */

app.get('/health', (req, res) => {
    res.send("OK");
});

app.get('/image', async (req, res) => {
    const imageUrl = req.query.url;

    if (!imageUrl || !imageUrl.startsWith(TARGET_HOST)) {
        return res.status(400).send("Invalid URL");
    }

    if (!browser) {
        await initBrowser();
    }

    let response = await fetchImage(imageUrl);

    // If failed → refresh cookies once
    if (!response || response.status !== 200) {
        console.log("Axios failed, retrying with fresh cookies...");
        await refreshCookies();
        response = await fetchImage(imageUrl);
    }

    if (!response || response.status !== 200) {
        return res.status(500).send("Failed to fetch image");
    }

    res.set('Content-Type', response.headers['content-type']);
    res.send(response.data);
});

/* ================= START SERVER ================= */

app.listen(PORT, async () => {
    console.log(`Server running on port ${PORT}`);
    await initBrowser();
});
