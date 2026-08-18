'use strict';

// Fingerprint smoke test. Verifies that the Chromium baked into the image
// launches and that Stealth leaves no obvious bot tells. Requires no network,
// so it runs in CI and locally.
//
//   npm run smoke                      # against the host
//   docker run --rm --entrypoint /var/lang/bin/node <image> smoke-test.js
//
// It exercises the real preparePage() the scrapers use rather than a copy, so
// a fingerprint regression in fetch-page.js fails here.

const { getBrowser, closeBrowser } = require('./browser');
const { preparePage } = require('./fetch-page');

const checks = [];

function expect(name, actual, predicate, expected) {
  const ok = predicate(actual);
  checks.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} = ${actual}${ok ? '' : `   (want ${expected})`}`);
}

(async () => {
  const browser = await getBrowser();
  const context = await browser.createBrowserContext();
  const page = await context.newPage();

  // blockAssets off: request interception would abort the setContent load.
  await preparePage(page, browser, { blockAssets: false });
  await page.setContent('<h1>shalom</h1>');

  const read = (fn) => page.evaluate(fn);

  expect('chrome version', await browser.version(), (v) => /^Chrome\//.test(v), 'a Chrome build');
  expect('render', await read(() => document.querySelector('h1').textContent),
    (t) => t === 'shalom', 'shalom');

  // The load-bearing anti-bot assertions. Each of these is something MemCyco
  // or Cloudflare reads directly.
  expect('navigator.webdriver', String(await read(() => navigator.webdriver)),
    (v) => v !== 'true', 'not true');
  expect('user agent', await read(() => navigator.userAgent),
    (ua) => !/Headless/i.test(ua), 'no "Headless"');
  expect('navigator.languages', await read(() => navigator.languages.join(',')),
    (l) => l.startsWith('he-IL'), 'starts with he-IL');
  expect('navigator.plugins', await read(() => navigator.plugins.length),
    (n) => n > 0, '> 0');
  expect('window.chrome', await read(() => typeof window.chrome),
    (t) => t === 'object', 'object');
  expect('permissions query', await read(async () => {
    try {
      return (await navigator.permissions.query({ name: 'notifications' })).state;
    } catch {
      return 'threw';
    }
  }), (s) => s !== 'threw', 'does not throw');

  await context.close();
  await closeBrowser();

  const passed = checks.filter((c) => c.ok).length;
  console.log(`\nRESULT=${passed === checks.length ? 'PASS' : 'FAIL'}  (${passed}/${checks.length})`);
  process.exit(passed === checks.length ? 0 : 1);
})().catch((err) => {
  console.error('RESULT=FAIL  ' + err.stack);
  process.exit(1);
});
