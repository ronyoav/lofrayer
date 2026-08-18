'use strict';

const { getBrowser, getUserAgent } = require('./browser');

// SSRF guard. Mirrors ALLOWED_SCRAPE_HOSTS in
// supabase/functions/scrape-oracle/index.ts — keep the two lists in sync.
const ALLOWED_HOSTS = [
  'behatzada.mod.gov.il',
  'www.behatsdaa.org.il',
  'benefits.isracard.co.il',
  'cal-store.co.il',
  'cal-online.co.il',
  'yours.co.il',
  'paisplus.co.il',
  'www.hever.co.il',
  'max.co.il',
  'www.max.co.il',
  'clubhub.co.il',
  'hofesh.co.il',
  'clalbit.co.il',
  'www.bankhapoalim.co.il',
];

function isAllowed(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { ok: false, reason: 'Invalid URL' };
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { ok: false, reason: `Protocol not permitted: ${parsed.protocol}` };
  }
  const host = parsed.hostname;
  const allowed = ALLOWED_HOSTS.some((h) => host === h || host.endsWith('.' + h));
  if (!allowed) return { ok: false, reason: `Host not permitted: ${host}` };
  return { ok: true, url: parsed };
}

// Resources that cost time and never contain benefit data.
const BLOCKED_RESOURCE_TYPES = new Set(['image', 'media', 'font', 'stylesheet']);

// Sites whose content is rendered client-side, so 'domcontentloaded' returns
// an empty shell. Waiting for a selector is what makes them usable. Keeping
// this here rather than in the caller means scrape-oracle does not have to
// know each site's DOM — it just asks for a URL.
//
// Only list a host if the selector is present on EVERY page scraped from it:
// a selector that never appears costs a 15s wait before giving up. Isracard is
// deliberately absent — it is server-rendered, and its cinema pages use a
// different container than its benefit pages.
const DEFAULT_SELECTORS = {
  'cal-store.co.il': '.categories__text',
};

function defaultSelectorFor(hostname) {
  const match = Object.keys(DEFAULT_SELECTORS).find(
    (h) => hostname === h || hostname.endsWith('.' + h)
  );
  return match ? DEFAULT_SELECTORS[match] : null;
}

/**
 * Load a page with a real local Chromium and return its HTML.
 *
 * waitUntil is 'domcontentloaded' on purpose: every target here is
 * server-rendered, and Isracard/CAL run continuous analytics traffic that keeps
 * 'networkidle2' from ever resolving. Where a selector is known, we wait for
 * that instead. See docs/scraping-obstacles.md.
 */
/**
 * Apply every fingerprint and performance setting a page needs, in one place
 * so the smoke test can exercise the same code the scrapers run.
 */
async function preparePage(page, browser, { blockAssets = true } = {}) {
  await page.setUserAgent(await getUserAgent(browser));
  // Matches the navigator.languages evasion configured in browser.js — the
  // header and the JS-visible value have to agree.
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'he-IL,he;q=0.9,en;q=0.8' });

  if (blockAssets) {
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      if (BLOCKED_RESOURCE_TYPES.has(req.resourceType())) req.abort().catch(() => {});
      else req.continue().catch(() => {});
    });
  }
}

async function fetchPage(targetUrl, opts = {}) {
  const {
    waitForSelector = null,
    timeoutMs = 60000,
    blockAssets = true,
  } = opts;

  // An explicit selector always wins; the per-host default is the fallback.
  const selector = waitForSelector || defaultSelectorFor(new URL(targetUrl).hostname);

  const browser = await getBrowser();
  const context = await browser.createBrowserContext();
  const page = await context.newPage();

  try {
    await preparePage(page, browser, { blockAssets });

    const response = await page.goto(targetUrl, {
      waitUntil: 'domcontentloaded',
      timeout: timeoutMs,
    });

    if (selector) {
      await page
        .waitForSelector(selector, { timeout: 15000 })
        .catch(() => {
          console.warn(`Selector "${selector}" never appeared — returning HTML as-is`);
        });
    }

    const html = await page.content();

    return {
      html,
      status: response ? response.status() : 0,
      finalUrl: page.url(),
    };
  } finally {
    // Close the whole context so cookies/storage never leak between requests.
    await context.close().catch(() => {});
  }
}

/**
 * Plain HTTP fetch, no browser.
 *
 * Yours, Poalim Wonder and MAX are server-rendered and unprotected — booting
 * Chromium for them costs seconds and hundreds of MB for nothing. Same headers
 * as the browser path so the sites see a consistent client.
 */
async function fetchDirect(targetUrl, opts = {}) {
  const { timeoutMs = 30000 } = opts;

  const response = await fetch(targetUrl, {
    headers: {
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'he-IL,he;q=0.9,en;q=0.8',
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    },
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok) throw new Error(`HTTP ${response.status} for ${targetUrl}`);

  return { html: await response.text(), status: response.status, finalUrl: targetUrl };
}

module.exports = { fetchPage, fetchDirect, preparePage, isAllowed, ALLOWED_HOSTS };
