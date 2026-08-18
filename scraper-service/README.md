# LoFrayer Scraper Proxy

Replacement for the retired GCP `cal-proxy.js`. Runs as an **AWS Lambda container image** in **`il-central-1` (Tel Aviv)** behind a Function URL.

Its one job: given a URL, load it with a real local Chromium under Stealth from an Israeli IP, and return the HTML.

## Why this shape

| Requirement | How this satisfies it |
|---|---|
| Israeli IP (Isracard, PaisPlus, CAL geo-block) | Lambda runs in `il-central-1` |
| Defeat CAL's MemCyco bot detection | Chromium is **inside the image** and started with `puppeteer.launch()` + StealthPlugin. A remote-browser service would force `puppeteer.connect()`, which Stealth cannot patch. |
| Cost (the previous host died when its free quota ended) | Lambda's free tier is permanent, not a 12-month trial: 1M requests + 400k GB-seconds per month. Periodic scraping stays inside it. |
| Concurrency | Each request is its own invocation, so the old "don't open 5 Puppeteer tabs at once" limit is gone. |

## Callers

Unchanged request shape, so only the `CAL_PROXY_URL` secret has to move:

```
GET /?key=<PROXY_KEY>&url=<url-encoded target>
```

| Param | Required | Meaning |
|---|---|---|
| `key` | yes | Shared secret, compared in constant time against `PROXY_KEY` |
| `url` | yes | Target page. Must match the host allowlist in `fetch-page.js` |
| `selector` | no | CSS selector to wait for after `domcontentloaded` |
| `timeout` | no | Navigation timeout in ms (default 60000, max 120000) |
| `assets` | no | `1` to load images/fonts/CSS (default: blocked, they slow the fetch and carry no benefit data) |

Responses over 256KB come back gzipped and base64-encoded; `fetch()` decompresses them transparently. `GET /health` and `GET /warm` need no key.

Consumers today: CAL, Isracard, PaisPlus in `supabase/functions/scrape-oracle/index.ts`.

## Local development

```bash
cd scraper-service && npm install
```

```bash
PROXY_KEY=dev-key node local.js
```

Then, in another shell:

```bash
curl "http://localhost:3001/?key=dev-key&url=https://yours.co.il/category/866"
```

Geo-blocked targets still fail from a non-Israeli IP — local runs are for debugging the browser and the parsers, not the block itself.

## Verifying the image

The smoke test launches Chromium and asserts the fingerprint has no obvious bot tells. No network needed.

```bash
docker build --platform linux/amd64 -t lofrayer-scraper-proxy:test . && docker run --rm --entrypoint /var/lang/bin/node lofrayer-scraper-proxy:test smoke-test.js
```

Expected: `RESULT=PASS (8/8)`. It checks Chrome starts, `navigator.webdriver` is not `true`, the UA contains no `Headless`, `navigator.languages` starts with `he-IL`, plugins are non-empty, `window.chrome` exists, and `navigator.permissions.query` does not throw.

It runs the same `preparePage()` the scrapers use, so a fingerprint regression in `fetch-page.js` fails here rather than silently in production.

**This does not prove CAL will work.** MemCyco scores far more than these eight signals, and the tuning that beat it originally was lost with the old VM. Expect to iterate against the live site after deploying.

## Deploy

Prerequisites: an AWS account, the AWS CLI, and Docker. Substitute your own account id.

```bash
aws configure
```

```bash
export AWS_REGION=il-central-1 ACCOUNT=<your-account-id> REPO=lofrayer-scraper-proxy
```

Create the registry, then build and push. Lambda container images must be `linux/amd64`:

```bash
aws ecr create-repository --repository-name $REPO --region $AWS_REGION
```

```bash
aws ecr get-login-password --region $AWS_REGION | docker login --username AWS --password-stdin $ACCOUNT.dkr.ecr.$AWS_REGION.amazonaws.com
```

`--provenance=false --sbom=false` is **required**, not optional. Without them BuildKit attaches attestations and emits an OCI image index, which Lambda rejects with `The image manifest, config or layer media type for the source image ... is not supported`:

```bash
docker buildx build --platform linux/amd64 --provenance=false --sbom=false --load -t $ACCOUNT.dkr.ecr.$AWS_REGION.amazonaws.com/$REPO:latest .
```

```bash
docker push $ACCOUNT.dkr.ecr.$AWS_REGION.amazonaws.com/$REPO:latest
```

Create the execution role the function runs as. `trust-policy.json` (in this directory) is what lets Lambda assume it; the attached policy is only what's needed to write CloudWatch logs:

```bash
aws iam create-role --role-name lofrayer-scraper-role --assume-role-policy-document file://trust-policy.json
```

```bash
aws iam attach-role-policy --role-name lofrayer-scraper-role --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole
```

IAM is global, so these two take no `--region`. Wait a few seconds after creating the role — IAM propagates asynchronously and `create-function` fails if it runs too soon.

Create the function. **Memory matters** — Chromium needs at least 2048MB, and on Lambda more memory also means proportionally more CPU, so a larger size is often cheaper per scrape, not dearer:

```bash
aws lambda create-function --function-name lofrayer-scraper-proxy --package-type Image --code ImageUri=$ACCOUNT.dkr.ecr.$AWS_REGION.amazonaws.com/$REPO:latest --role arn:aws:iam::$ACCOUNT:role/lofrayer-scraper-role --timeout 180 --memory-size 3008 --ephemeral-storage Size=1024 --environment "Variables={PROXY_KEY=<generate-a-fresh-secret>}" --region $AWS_REGION
```

Add a Function URL. `--auth-type NONE` is safe here only because the handler enforces `PROXY_KEY` itself:

```bash
aws lambda create-function-url-config --function-name lofrayer-scraper-proxy --auth-type NONE --region $AWS_REGION
```

That prints a `FunctionUrl`. Check it end to end before wiring anything up:

```bash
curl "<function-url>health"
```

```bash
curl -s "<function-url>?key=<your-secret>&url=https%3A%2F%2Fbenefits.isracard.co.il%2Fparentcategories%2Fonline-benefits%2F" | wc -c
```

A few hundred thousand characters means the Israeli IP and Stealth both did their job. Around 5,500 means Cloudflare served a challenge page instead — see the Isracard notes in `../docs/scraping-obstacles.md`.

Then point Supabase at it:

```bash
supabase secrets set CAL_PROXY_URL=<the function url, no trailing slash> CAL_PROXY_KEY=<the same fresh secret>
```

### Redeploying after a code change

```bash
docker build --platform linux/amd64 -t $ACCOUNT.dkr.ecr.$AWS_REGION.amazonaws.com/$REPO:latest . && docker push $ACCOUNT.dkr.ecr.$AWS_REGION.amazonaws.com/$REPO:latest && aws lambda update-function-code --function-name lofrayer-scraper-proxy --image-uri $ACCOUNT.dkr.ecr.$AWS_REGION.amazonaws.com/$REPO:latest --region $AWS_REGION
```

## Generating the shared secret

Do not reuse the old key — it was committed to this repo as a literal fallback and must be considered public.

```bash
openssl rand -hex 32
```

## Known limits

- **The image is ~2.3GB** (Chromium dominates). Well under Lambda's 10GB cap, but a first-ever cold start pays for pulling it. Storage in ECR costs roughly $0.10/month at this size — delete superseded tags after each deploy rather than letting them accumulate.
- **Cold start** is a few seconds while Chromium boots, plus image-pull time on the very first invocation after a deploy. Warm invocations reuse the browser.
- **Response cap:** Function URLs buffer at 6MB. The handler gzips above 256KB and returns a 502 with byte counts if a page still will not fit.
- **`/tmp` is the only writable path**, which is why Chrome's profile directory is pinned there.
- **Fonts:** only Liberation fonts are installed. Hebrew glyphs may render as boxes in screenshots, which does not affect HTML extraction — add a Hebrew font package if screenshots are ever needed.
