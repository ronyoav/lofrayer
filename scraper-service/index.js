'use strict';

const crypto = require('crypto');
const zlib = require('zlib');
const { promisify } = require('util');

const { fetchPage, isAllowed } = require('./fetch-page');
const { getBrowser } = require('./browser');

const gzip = promisify(zlib.gzip);

// Lambda Function URL buffered responses cap at 6MB. Gzip well before that.
const GZIP_THRESHOLD_BYTES = 256 * 1024;
const MAX_RESPONSE_BYTES = 5.5 * 1024 * 1024;

function timingSafeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function json(statusCode, payload) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(payload),
  };
}

async function htmlResponse(html) {
  const raw = Buffer.from(html, 'utf8');

  if (raw.length < GZIP_THRESHOLD_BYTES) {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
      body: html,
    };
  }

  const compressed = await gzip(raw);
  if (compressed.length > MAX_RESPONSE_BYTES) {
    return json(502, {
      error: 'Page too large to return',
      rawBytes: raw.length,
      gzippedBytes: compressed.length,
    });
  }

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Encoding': 'gzip',
    },
    body: compressed.toString('base64'),
    isBase64Encoded: true,
  };
}

/**
 * Drop-in replacement for the old GCP `cal-proxy.js` endpoint.
 * Callers keep the same shape: GET /?key=<secret>&url=<encoded target>
 * Only CAL_PROXY_URL changes in the Supabase function secrets.
 */
exports.handler = async (event) => {
  const params = event.queryStringParameters || {};
  const path = event.rawPath || '/';

  if (path === '/health') {
    return json(200, { ok: true, region: process.env.AWS_REGION });
  }

  // Keep-warm target, invoked on a schedule. A cold container spends ~30s
  // faulting Chromium in from the image on its first launch — over API
  // Gateway's 30s integration cap, so the first real request after an idle
  // period would 503. Warm invocations run in ~1.5s. /health alone is not
  // enough: it never touches the browser, which is the part that is slow.
  if (path === '/warm') {
    const started = Date.now();
    await getBrowser();
    const elapsedMs = Date.now() - started;
    console.log(`Warm-up completed in ${elapsedMs}ms`);
    return json(200, { warm: true, elapsedMs });
  }

  const expectedKey = process.env.PROXY_KEY;
  if (!expectedKey) {
    // Fail loudly rather than falling back to a literal — the old hardcoded
    // key leaked into the repo and must not be reintroduced.
    console.error('PROXY_KEY is not set');
    return json(500, { error: 'Server misconfigured: PROXY_KEY not set' });
  }

  if (!params.key || !timingSafeEqual(params.key, expectedKey)) {
    return json(401, { error: 'Unauthorized' });
  }

  if (!params.url) {
    return json(400, { error: 'Missing required query parameter: url' });
  }

  const check = isAllowed(params.url);
  if (!check.ok) {
    return json(400, { error: check.reason });
  }

  const started = Date.now();
  try {
    const { html, status, finalUrl } = await fetchPage(params.url, {
      waitForSelector: params.selector || null,
      timeoutMs: Math.min(Number(params.timeout) || 60000, 120000),
      blockAssets: params.assets !== '1',
    });

    console.log(
      `Fetched ${params.url}: HTTP ${status}, ${html.length} chars, ${Date.now() - started}ms`
    );

    if (html.length < 1000) {
      console.warn(`Suspiciously short HTML (${html.length} chars) — likely a challenge page`);
    }

    return htmlResponse(html);
  } catch (err) {
    console.error(`Fetch failed for ${params.url}: ${err.message}`);
    return json(502, {
      error: err.message,
      url: params.url,
      elapsedMs: Date.now() - started,
    });
  }
};
