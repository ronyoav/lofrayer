# Scraping Obstacles & Strategies

Condensed reference for how LoFrayer scrapes each benefits provider, what blocks us, and why each strategy was chosen.

Orchestrator: `supabase/functions/scrape-oracle/index.ts`

---

## Status: infrastructure

> **The GCP VM `israel-scraper-vm` (me-west1-b) is no longer running.**
> Everything below that says "from the Israeli VM" describes the *previous* working setup. Any scraper that depended on an Israeli IP or on a locally launched Puppeteer is currently broken and needs a new host. See [Next steps](#next-steps).

| Component | What it was | State |
|---|---|---|
| GCP VM `israel-scraper-vm` (`me-west1-b`) | Israeli IP for geo-blocked sites; host for Stealth Puppeteer | **Down** |
| PM2 process `lofrayer-proxy` (`cal-proxy.js`, port 3001) | HTTP proxy in front of the CAL scraper | **Down** with the VM |
| Browserless | Remote Chrome over `puppeteer.connect()` | Independent of the VM |
| Gemini (AI fallback) | Parses raw HTML when no parser exists | Free-tier quota exhausted during debugging |

Scraper secrets live in Supabase Edge Function secrets, not in `.env`.

### Two problems found during the migration

1. **`cal-proxy.js` was never in this repo.** The Puppeteer + Stealth proxy only ever existed on the VM, and there is no backup — so it has been **rewritten from scratch** as `scraper-service/`, this time version-controlled. The fingerprint tuning that made CAL work is gone with the original and will need re-testing against MemCyco.
2. **A shared secret was hardcoded in the repo.** `scrape-oracle/index.ts` fell back to a literal `CAL_PROXY_KEY` in three places when the env var was unset. **Fixed:** all three now call `getProxyConfig()`, which throws if either secret is missing. The old literal must be treated as public — generate a fresh key for the new host.

---

## Strategy per provider

| Provider | Strategy | Primary obstacle | Needs the VM? |
|---|---|---|---|
| CAL | Proxy + Stealth, **wait for `.categories__text`**, then parse | MemCyco anti-bot + client-side rendering | Yes |
| Isracard | Proxy, parse HTML, Gemini fallback | Cloudflare + geo-block | Yes |
| PaisPlus | Proxy, parse HTML | Geo-block | Yes |
| MAX | Direct JSON API — no browser | *(none anymore)* | No |
| Sheli ("שלך") | Direct fetch, read `__PRELOADED_STATE__` JSON | None — SSR, no protection | No |
| Poalim Wonder | Direct fetch, parse HTML | None — Drupal, SSR | No |
| Behatzada | **No scraper — benefits entered by hand** | — | No |

The three proxy-dependent providers all call the same `CAL_PROXY_URL`, so one host serves all three. Verified working end to end on 2026-08-18 against the AWS deployment: Isracard 82, CAL 107, PaisPlus 759.

### Behatzada is manual — and its rows are mislabelled

There is no Behatzada scraper and there never was; its ~149 benefits were entered by hand. Nothing deactivates them today, because `scrape-oracle` falls through to a plain error for unknown slugs without touching the data.

**The trap:** those rows carry a non-null `scraped_at`, so they are indistinguishable from scraped rows. Every provider branch deactivates with `.not('scraped_at', 'is', null)`. The day a Behatzada scraper is added, its first run erases the manual work. Setting `scraped_at = NULL` on hand-entered rows is what marks them as protected.

### CAL

Runs **MemCyco** anti-bot, which fingerprints headless Chrome and blocks it. Must use `puppeteer.launch()` (a fresh browser) together with `puppeteer-extra-plugin-stealth` — the plugin only patches the fingerprint fully at browser startup, so `puppeteer.connect()` to a remote Chrome does not hide us.

**CAL is client-side rendered.** This contradicts what the original notes said and was only caught by testing: `domcontentloaded` returns a 42KB shell with an empty `<body>` and zero product cards. Waiting for `.categories__text` turns the same request into 135KB with 96 product links. The proxy applies that selector automatically for `cal-store.co.il` (see `DEFAULT_SELECTORS` in `scraper-service/fetch-page.js`), so callers do not need to know.

A page that returns HTTP 200 at a plausible size can still be empty of benefits — always count extractor markers, not bytes.

### Isracard

Two independent defenses: Cloudflare bot protection *and* an Israel-only geo-block. Both had to be solved at once — an Israeli IP alone is not enough.

Detailed notes in [Isracard deep dive](#isracard-deep-dive).

### MAX

**Historical:** MAX was an Angular SPA whose benefits render client-side, so a plain fetch returned empty HTML and a browser was required.

**Current:** the scraper no longer uses a browser at all. MAX exposes a paginated JSON API that returns every benefit directly:

```
https://www.max.co.il/api/benefits/getCategoriesLobby?isMobile=true&page=N&loadLobby=false&category=SLUG
```

The orchestrator walks 11 category slugs and paginates until `result.isLast`. `extractMaxBenefits()` in `scrape-oracle/index.ts` is now dead code kept for reference. MAX is unaffected by the VM going down.

### PaisPlus

Only obstacle is the geo-block. Routing through the Israeli VM solved it — this is the cheapest of the three broken scrapers to restore, since it needs an Israeli IP but **not** a browser.

### Sheli

Easiest target. Server-rendered, no protection, and every benefit is already serialized into a `__PRELOADED_STATE__` script tag. Direct fetch + JSON parse — no browser needed.

### Poalim Wonder

Plain public Drupal site, server-rendered, no protections. Direct fetch + HTML parse.

### Behatzada / generic

No dedicated parser exists. Falls back to feeding raw HTML to Gemini and letting it locate the benefits. Cheapest to add, least reliable, and currently limited by the Gemini quota.

---

## Isracard deep dive

Everything we hit, in the order we hit it:

1. **Cloudflare blocks plain `curl`** — and blocks Browserless *without* Stealth too, even from an Israeli GCP IP. What comes back is ~5,500 characters of challenge page, not the site.
2. **Browserless + Stealth do not compose.** StealthPlugin only works with `puppeteer.launch()`, not `puppeteer.connect()`. You get one or the other, not both.
3. **`networkidle2` never resolves.** Isracard fires tracking/analytics requests continuously, so the wait sits until the 45s timeout every time.
4. **Fix: `waitUntil: 'domcontentloaded'`.** The page is server-rendered (Episerver CMS) — the benefits are already in the HTML the server sends. Waiting on JS is pointless; wait for a specific DOM selector instead.
5. **The cinema page has a different structure.** Regular online benefits are `<a class="category-item">`; cinema benefits are `<div class="category-featured-benefit">`. The extractor needs a second pass for them.
6. **Gemini free-tier quota ran out mid-debug**, so the AI fallback stopped covering for parser failures.

---

## Design rules learned

- **StealthPlugin requires `launch()`.** If a site needs Stealth, it needs a machine you control — you cannot get it from a remote Chrome service.
- **Prefer `connect()` when Stealth isn't needed.** Browserless uses far less memory than spawning and tearing down a browser per scrape (MAX, Isracard, PaisPlus).
- **Prefer no browser at all.** Check for SSR HTML or a preloaded JSON blob first (Sheli, Poalim Wonder). A browser is the last resort, not the default.
- **Never wait on `networkidle`** for sites with live analytics. Wait for a selector.
- **Geo-block and bot-block are separate problems.** Solving one does not solve the other.

---

## The queue (PaisPlus only, so far)

PaisPlus runs on an AWS queue instead of `scrape-oracle`. Everything else still
uses the synchronous path. **A provider lives in exactly one of the two** —
`QUEUE_MIGRATED` in `scrape-oracle/index.ts` and `PROVIDERS` in
`scraper-service/dispatcher.js` must never both list it, or the two paths fight
over the same rows. `scrape-oracle` returns 409 for a migrated slug.

`EventBridge Scheduler (Sun 03:00 Asia/Jerusalem) → dispatcher → SQS → worker`

- **Timezone, not UTC.** The schedule is pinned to `Asia/Jerusalem` so DST does
  not silently move the run by an hour twice a year.
- **One message per category page**, so a single bad page retries on its own
  (3 attempts, then the DLQ) instead of failing the other 28.
- **Run stamping.** Every row from one run shares a `scraped_at`. A delayed
  `finalize` message retires the previous run's rows once the pages have landed;
  deactivating per page would delete what the previous page just wrote.

### Three guards worth keeping

1. **An empty page is not a failure.** `paisplus.co.il/category/655` genuinely
   has no benefits — its only `/product/` links are navigation chrome. Treating
   0 as an error pushed a healthy page into the DLQ every run.
2. **An empty *run* is a failure.** `finalize` refuses to retire the old rows if
   the run produced none, or fewer than half the previous run. This is the net
   under guard 1, and it has already fired for real: when the unique index was
   wrong, every insert failed and the guard saved 763 live rows.
3. **Inserts are idempotent.** A unique index on
   `(membership_id, title, scraped_at)` plus `on_conflict=…&resolution=ignore-duplicates`.
   This fixes two things at once: a benefit listed under 14 category pages
   inserting 14 times, and SQS redelivering a job that already inserted.

**The index must not be partial.** A `WHERE scraped_at IS NOT NULL` predicate
made every insert fail with `42P10` — Postgres will not match `ON CONFLICT`
against a partial index, and PostgREST cannot send the predicate. The predicate
was pointless anyway: NULLs are distinct in a unique index by default, so
hand-entered rows are unconstrained either way.

## Next steps

Ordered by urgency, following the loss of the VM:

1. **Migrate scraping to AWS.** *In progress.* The replacement lives in `scraper-service/` — an AWS Lambda container image for `il-central-1` (Tel Aviv) with Chromium baked in, launched locally under Stealth so CAL still works. The image builds and its fingerprint smoke test passes 8/8 locally; **not yet deployed** (no AWS account exists yet). Deploy steps are in `scraper-service/README.md`.

   Two fingerprint leaks the smoke test caught and that are now fixed: Chrome reported `HeadlessChrome` in its UA, and Stealth pinned `navigator.languages` to `en-US` — a US-English browser arriving from an Israeli IP at an Israel-only site. Neither would have been visible without testing for it.

   Note the shape: Lambda here is *not* a remote-browser service. The container carries its own Chromium and calls `puppeteer.launch()`, exactly as the VM did. What changed is the machine's lifetime, not the browser — which is what keeps StealthPlugin effective.
2. **Add a queue system.** Natural fit on the same scraping code: decouple "schedule a scrape" from "run a scrape" so failures retry instead of dropping, and providers run independently.
3. **Add text search over benefits.** The benefits are already in the database; search is the next layer on top of them.
