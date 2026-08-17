'use strict';

// Chromium lives INSIDE this container image and is launched locally with
// puppeteer.launch(). This is deliberately NOT a remote-browser service:
// puppeteer-extra-plugin-stealth only patches the fingerprint at browser
// startup, so puppeteer.connect() to a remote Chrome cannot hide us from
// CAL's MemCyco bot detection. See docs/scraping-obstacles.md.

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

// Stealth's navigator.languages evasion hardcodes en-US and defines the
// property non-configurably, so it cannot be overridden from the page after
// the fact. Swap the evasion out for a configured copy instead: an Israeli IP
// paired with a US-English browser is the sort of contradiction bot scoring
// keys on, and every target here is an Israel-only site.
const stealth = StealthPlugin();
stealth.enabledEvasions.delete('navigator.languages');
puppeteer.use(stealth);

const languagesEvasion = require('puppeteer-extra-plugin-stealth/evasions/navigator.languages');
puppeteer.use(languagesEvasion({ languages: ['he-IL', 'he', 'en-US', 'en'] }));

// Lambda freezes the container between invocations rather than destroying it,
// so a warm invocation can reuse the browser and skip the ~1s startup.
let browserPromise = null;

const LAUNCH_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage', // /dev/shm is only 64MB in Lambda
  '--disable-gpu',
  '--no-zygote',
  '--hide-scrollbars',
  '--disable-blink-features=AutomationControlled',
  '--lang=he-IL,he',
  // Chrome needs a writable profile dir; /tmp is the only writable path in Lambda.
  '--user-data-dir=/tmp/chrome-user-data',
];

async function launch() {
  return puppeteer.launch({
    headless: true,
    args: LAUNCH_ARGS,
    defaultViewport: { width: 1920, height: 1080 },
    // Set by the Dockerfile so the runtime finds the Chrome baked into the image.
    executablePath: process.env.CHROME_PATH || undefined,
    protocolTimeout: 120000,
  });
}

async function getBrowser() {
  if (browserPromise) {
    try {
      const browser = await browserPromise;
      if (browser.connected) return browser;
    } catch {
      // fall through and relaunch
    }
    browserPromise = null;
  }

  browserPromise = launch().catch((err) => {
    browserPromise = null;
    throw err;
  });

  return browserPromise;
}

// Chrome reports itself as "HeadlessChrome" in the UA even under Stealth,
// which is the cheapest possible bot tell. Rewrite it to match the real Chrome
// build already running in the container, rather than hardcoding a version
// that will drift out of date the next time the image is rebuilt.
let cachedUserAgent = null;

async function getUserAgent(browser) {
  if (cachedUserAgent) return cachedUserAgent;
  const raw = await browser.userAgent();
  cachedUserAgent = raw
    .replace('HeadlessChrome', 'Chrome')
    .replace(/\(X11; Linux x86_64\)/, '(Windows NT 10.0; Win64; x64)');
  return cachedUserAgent;
}

async function closeBrowser() {
  cachedUserAgent = null;
  if (!browserPromise) return;
  const pending = browserPromise;
  browserPromise = null;
  try {
    const browser = await pending;
    await browser.close();
  } catch {
    // best effort
  }
}

module.exports = { getBrowser, closeBrowser, getUserAgent };
