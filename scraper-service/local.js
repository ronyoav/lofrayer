'use strict';

// Local dev server. Same request shape as the deployed Lambda Function URL,
// so you can point CAL_PROXY_URL at http://localhost:3001 while developing.
//
//   PROXY_KEY=dev-key node local.js
//   curl "http://localhost:3001/?key=dev-key&url=https://yours.co.il/category/866"
//
// Note: from a non-Israeli IP the geo-blocked targets (Isracard, PaisPlus,
// CAL) will still fail locally. Only the deployed il-central-1 function has
// an Israeli exit. Use this to debug the parser and the browser, not the block.

const http = require('http');
const { fetchPage, isAllowed } = require('./fetch-page');
const { closeBrowser } = require('./browser');

const PORT = Number(process.env.PORT) || 3001;
const PROXY_KEY = process.env.PROXY_KEY;

if (!PROXY_KEY) {
  console.error('PROXY_KEY is required. Run: PROXY_KEY=dev-key node local.js');
  process.exit(1);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  const send = (status, body, headers = {}) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...headers });
    res.end(typeof body === 'string' ? body : JSON.stringify(body));
  };

  if (url.pathname === '/health') return send(200, { ok: true });

  if (url.searchParams.get('key') !== PROXY_KEY) return send(401, { error: 'Unauthorized' });

  const target = url.searchParams.get('url');
  if (!target) return send(400, { error: 'Missing required query parameter: url' });

  const check = isAllowed(target);
  if (!check.ok) return send(400, { error: check.reason });

  const started = Date.now();
  try {
    const { html, status } = await fetchPage(target, {
      waitForSelector: url.searchParams.get('selector') || null,
      blockAssets: url.searchParams.get('assets') !== '1',
    });
    console.log(`${target}: HTTP ${status}, ${html.length} chars, ${Date.now() - started}ms`);
    send(200, html, { 'Content-Type': 'text/html; charset=utf-8' });
  } catch (err) {
    console.error(`Fetch failed for ${target}: ${err.message}`);
    send(502, { error: err.message });
  }
});

server.listen(PORT, () => console.log(`Scraper proxy listening on http://localhost:${PORT}`));

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    await closeBrowser();
    server.close(() => process.exit(0));
  });
}
