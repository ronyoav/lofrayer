# Fixes Log — AWS migration & queue (2026-08-18)

Every problem hit while moving scraping off the dead GCP VM and putting PaisPlus
on a queue, with the cause and what actually fixed it. Kept short on purpose;
the reasoning lives in `scraping-obstacles.md`.

## Infrastructure

| # | Problem | Cause | Fix |
|---|---|---|---|
| 1 | Proxy source gone | `cal-proxy.js` lived only on the VM, never committed | Rewritten as `scraper-service/`, in the repo this time |
| 2 | Shared secret public | `scrape-oracle` fell back to a literal `CAL_PROXY_KEY` in 3 places | `getProxyConfig()` throws when a secret is missing; fresh 64-hex key |
| 3 | `create-function-url-config` failed | Function URLs are **not supported in `il-central-1`** | API Gateway HTTP API in front of the Lambda instead |
| 4 | Lambda rejected the image | BuildKit attaches attestations and emits an OCI index | Build with `--provenance=false --sbom=false` (**required**, not optional) |
| 5 | `dnf install` failed mid-build | Amazon Linux CDN slower than dnf's 30s minimum transfer rate | `timeout=300 minrate=100 retries=10` in `/etc/dnf/dnf.conf` |
| 6 | First request after idle → 503 | Cold start ~32s vs API Gateway's 30s integration cap (warm: ~1.5s) | One retry on 503/504 in `fetchViaProxy()` |
| 7 | Keep-warm was the biggest cost | 8,640 pings/month to avoid one cold start per weekly run — ~25× the real work, on a credit-metered account | EventBridge rule disabled; the retry above covers it |

## Scraping correctness

| # | Problem | Cause | Fix |
|---|---|---|---|
| 8 | CAL returned an empty 42KB shell | CAL is **client-side rendered** — the old notes wrongly said SSR | Wait for `.categories__text`; `DEFAULT_SELECTORS` applies it per host so callers need not know |
| 9 | UA said `HeadlessChrome` | Stealth does not rewrite the UA string | Rewrite it from the running Chrome's own version, so it cannot drift |
| 10 | `navigator.languages` was `en-US` | Stealth's evasion hardcodes it, non-configurably | Swapped the evasion for a copy configured to `he-IL` — a US browser on an Israel-only site is exactly what bot scoring looks for |
| 11 | Isracard intermittently returns ~6KB | Cloudflare challenge, not a regression | Known and expected; retries succeed. Count extractor markers, never bytes |

## Queue

| # | Problem | Cause | Fix |
|---|---|---|---|
| 12 | 237 duplicate rows in one run | Per-page jobs cannot share the in-memory dedup the single-pass scraper had | Unique index on `(membership_id, title, scraped_at)` + `resolution=ignore-duplicates`. Also makes SQS redelivery safe |
| 13 | Every insert failed, `42P10` | The index was **partial**; Postgres will not match `ON CONFLICT` against one, and PostgREST cannot send the predicate | Non-partial index. NULLs are distinct by default, so hand-entered rows stay unconstrained anyway |
| 14 | A healthy page kept hitting the DLQ | `category/655` genuinely has no benefits; "0 parsed = failure" was too strict | Tolerate an empty *page*; guard at the *run* level instead |
| 15 | Risk of wiping live data | If a run yields nothing, retiring the previous run empties the app | `finalize` refuses to retire when the run produced 0, or under half the previous run. **This fired for real during #13 and saved 763 rows** |
| 16 | `db push` replayed every migration | Remote migration history was empty although the schema existed (tables made via the dashboard) | `migration repair --status applied` for the 10 pre-existing versions — bookkeeping only, no schema change |

## Tooling

| # | Problem | Cause | Fix |
|---|---|---|---|
| 17 | AWS CLI crashed reading logs | A `→` in log messages; the Windows CLI cannot encode it and truncates its own JSON output | ASCII in all log strings |
| 18 | Shell could not read the proxy key | `.env.deploy` written with a UTF-8 BOM and CRLF | File normalised; note that PowerShell 5.1 `Set-Content -Encoding utf8` writes a BOM |

## Open

- **Behatzada's ~149 hand-entered rows carry a non-null `scraped_at`**, so they look
  scraped. Nothing deletes them today, but the first run of any future Behatzada
  scraper would. Set `scraped_at = NULL` on them before writing one.
- **HTML entities are stored unescaped** — `GOLF&amp;KIDS` instead of `GOLF&KIDS`.
  Predates this work; affects every provider.
