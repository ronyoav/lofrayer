# lofrayer 🛍️

An Israeli discount aggregator — all the benefits from all your membership clubs, in one place.

## What it does

Israelis carry memberships across credit cards, banks, HMOs, unions, insurance companies, and more — each with their own discount portal. lofrayer lets users select the clubs they belong to and instantly see every discount available to them, without manually checking each site.

**Live:** [lofrayer.vercel.app](https://lofrayer.vercel.app)

---

## Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React + TypeScript + Vite |
| UI | Tailwind CSS + shadcn/ui |
| Database | Supabase (PostgreSQL) |
| Scraping | Supabase Edge Functions + Puppeteer (Stealth) + Browserless + direct fetch |
| Deploy | Vercel |
| Scraper infrastructure | GCP VM in `me-west1-b` (Israeli IP) |

---

## Architecture

```
User → Vercel (React SPA)
             ↓
        Supabase DB
             ↑
   scrape-oracle (Edge Function)
             ↓
   ┌──────────────────────────────┐
   │  GCP VM (israel-scraper-vm)  │
   │  PM2: lofrayer-proxy :3001   │
   │  Puppeteer Stealth           │
   └──────────────────────────────┘
```

Scrapers run on an Israeli GCP VM because several sites (CAL, Isracard) block non-Israeli IPs. Data is stored in Supabase and fetched client-side filtered by the user's selected memberships.

---

## Supported clubs

**Credit cards:** CAL, MAX, Isracard, Visa  
**Banks:** Hapoalim (+ Wonder), Leumi, Discount, Mizrahi, Yahav  
**HMOs:** Clalit, Maccabi, Leumit, Meuhedet  
**Military / security:** Behatzada, Hever, Police  
**Labor unions:** Histadrut, Teachers, Civil Service, Medical  
**Telecom & energy:** HOT, Partner, Cellcom, Pelephone, Paz, Sonol  
**Insurance:** Migdal, Harel, Menora, Clal  
**Consumer clubs:** Face, ClubHub, Pais Plus, Hofesh, Rami Levy, Shufersal  

---

## Technical challenges

### Cloudflare bot protection
Isracard and CAL run aggressive Cloudflare bot detection. Plain curl and standard Browserless both get blocked. Fix: Puppeteer with `puppeteer-extra-plugin-stealth` to mask automation fingerprints, launched from the Israeli VM.

### Geographic blocking
Some sites return different content (or errors) from non-Israeli IPs. Solved by routing all sensitive scrapers through a GCP VM in `me-west1-b` (Tel Aviv). PM2 keeps the proxy process alive with automatic restarts.

### `networkidle2` never resolving
Isracard runs continuous analytics traffic, so `waitUntil: 'networkidle2'` hangs indefinitely. Fix: `waitUntil: 'domcontentloaded'` + waiting for a specific DOM selector instead.

### Two different HTML structures on Isracard
Regular (online) benefits are in `.category-item`; cinema benefits are in `.category-featured-benefit`. Each requires its own extractor.

### Secrets management
All scraper credentials and VM URLs live in Supabase Edge Function secrets — not in `.env`, not in git.

---

## Getting started

```bash
npm install
npm run dev
```

No `.env` needed for frontend development — environment variables live in Supabase Edge Function secrets.

---

## Project structure

```
src/
  pages/
    OnboardingPage.tsx   # membership selection flow
    DashboardPage.tsx    # main dashboard (4 tabs: Home / Search / Wallet / Me)
    AdminPage.tsx        # discount management (auth-gated)
  components/
    DiscountCard.tsx     # discount card with brand logo + membership badge
  hooks/
    useDiscounts.ts      # fetches discounts filtered by selected memberships
  data/
    mockData.ts          # local brand and membership logos
supabase/
  functions/
    scrape-oracle/       # scraper orchestrator (Edge Function)
```

---

## Deployment

Every push to `main` triggers an automatic Vercel deployment.
