# lofrayer 🛍️

אגרגטור הנחות ישראלי — כל ההטבות של כל המועדונים שלך, במקום אחד.

## מה זה?

lofrayer מאפשר למשתמשים לבחור את המועדונים שהם חברים בהם (כרטיסי אשראי, בנקים, קופות חולים, ביטוח, הסתדרות וכו') ולראות בדיוק אילו הנחות זמינות להם — בלי לחפש ידנית בכל אתר בנפרד.

**כתובת האתר:** [lofrayer.vercel.app](https://lofrayer.vercel.app)

---

## Stack

| שכבה | טכנולוגיה |
|------|-----------|
| Frontend | React + TypeScript + Vite |
| UI | Tailwind CSS + shadcn/ui |
| Backend / DB | Supabase (PostgreSQL + Edge Functions) |
| Scraping | Puppeteer (Stealth) · Browserless · fetch ישיר |
| Deploy | Vercel |
| Scraper VM | GCP VM ב-`me-west1-b` (IP ישראלי) |

---

## ארכיטקטורה

```
משתמש → Vercel (React SPA)
              ↓
         Supabase DB
              ↑
    scrape-oracle (Edge Function)
              ↓
    ┌─────────────────────────────┐
    │  GCP VM (israel-scraper-vm) │
    │  PM2: lofrayer-proxy :3001  │
    │  Puppeteer Stealth          │
    └─────────────────────────────┘
```

הסקריינפים רצים על VM ישראלי כי חלק מהאתרים (CAL, ישראכרט) חוסמים IP-ים בחו"ל. הנתונים נשמרים ב-Supabase ונמשכים לממשק ב-real-time.

---

## מועדונים נתמכים

**כרטיסי אשראי:** כאל, MAX, ישראכרט, ויזה  
**בנקים:** הפועלים (+ Wonder), לאומי, דיסקונט, מזרחי, יהב  
**קופות חולים:** כללית, מכבי, לאומית, מאוחדת  
**צבא וביטחון:** בהצדעה, חבר, משטרה  
**הסתדרות:** הסתדרות כללית, מורים, מדינה, רפואית  
**תקשורת:** HOT, פרטנר, סלקום, פלאפון, פז, סונול  
**ביטוח:** מגדל, הראל, מנורה, כלל  
**צרכנות:** פייס, ClubHub, פייס פלוס, חופש, רמי לוי, שופרסל  

---

## אתגרים טכניים

### 🛡️ חסימות Cloudflare
ישראכרט וכאל מריצים Cloudflare עם bot-detection אגרסיבי. curl פשוט וגם Browserless רגיל נחסמים. הפתרון: Puppeteer עם `puppeteer-extra-plugin-stealth` שמסתיר fingerprints של automation.

### 🌍 חסימות גיאוגרפיות
חלק מהאתרים מחזירים תוכן שונה (או שגיאה) מ-IP חו"ל. הקמנו GCP VM באזור `me-west1-b` (תל אביב) שמשמש כ-proxy לכל הסקריינפים הרגישים. PM2 מנהל את התהליך ומבטיח restart אוטומטי.

### ⏱️ networkidle2 שלא מסתיים
ישראכרט מריץ analytics traffic רציף — `waitUntil: 'networkidle2'` לא מסתיים לעולם. הפתרון: `waitUntil: 'domcontentloaded'` + המתנה ל-selector ספציפי.

### 🔍 שתי מבניות HTML שונות בישראכרט
הטבות רגילות (אונליין) ב-`.category-item`, הטבות קולנוע ב-`.category-featured-benefit`. כל אחת דורשת extractor נפרד.

### 🔑 ניהול secrets
ה-Edge Functions של Supabase מאחסנות את כל ה-secrets (credentials לסקריינפים, URLs של ה-VM) — לא ב-`.env` ולא ב-git.

---

## הרצה מקומית

```bash
# התקנת dependencies
npm install

# הרצת dev server
npm run dev
```

משתני סביבה נדרשים: מוגדרים ב-Supabase Edge Function secrets (לא נדרש `.env` לפיתוח ממשק).

---

## מבנה תיקיות

```
src/
  pages/
    OnboardingPage.tsx   # בחירת מועדונים
    DashboardPage.tsx    # דף הנחות ראשי (4 tabs)
    AdminPage.tsx        # ניהול הנחות (requires auth)
  components/
    DiscountCard.tsx     # כרטיס הנחה עם לוגו מותג + badge מועדון
  hooks/
    useDiscounts.ts      # fetch הנחות לפי מועדונים נבחרים
  data/
    mockData.ts          # לוגואים מקומיים של מותגים ומועדונים
supabase/
  functions/
    scrape-oracle/       # אורקסטרטור scrapers (Edge Function)
```

---

## Deploy

הפרויקט מועלה אוטומטית ל-Vercel בכל push ל-`main`.
