# lofrayer 🛍️

An Israeli discount aggregator — all the benefits from all your membership clubs, in one place.

## What it does

Israelis carry memberships across credit cards, banks, Consumer clubs  — each with their own discount portal. lofrayer lets users select the clubs they belong to and instantly see every discount available to them, without manually checking each site.

**Try it:** [lofrayer.vercel.app](https://lofrayer.vercel.app/onboarding)

[![LoFrayer Demo](https://img.youtube.com/vi/jJN95On66o4/maxresdefault.jpg)](https://youtu.be/jJN95On66o4)
---

## Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React + TypeScript + Vite |
| UI | Tailwind CSS + shadcn/ui |
| Database | Supabase (PostgreSQL) |
| Scraping | Supabase Edge Functions + Puppeteer (Stealth) + Browserless + direct fetch |
| Deploy | Vercel |
| Cloud Server | GCP VM in `me-west1-b` (Israeli IP) |

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

**Credit cards:** CAL, MAX, Isracard
**Banks:** Hapoalim (+ Wonder)    
**Military / security:** Behatzada        
**Consumer clubs:** Pais Plus, שלך.  

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
