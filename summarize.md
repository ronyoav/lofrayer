# סיכום ארכיטקטורה — LoFrayer

---

## ארכיטקטורה כללית

```
משתמש
  ↓
React App (Vite + Tailwind)
  ↓
Supabase (PostgreSQL + Edge Functions)
  ↓
scrape-oracle (Deno Edge Function)
  ├── GCP VM (cal-proxy.js on port 3001)
  │     ├── puppeteer.launch() + Stealth → CAL
  │     └── puppeteer.connect() → Browserless (Docker) → Isracard
  └── Firecrawl API → Yours, PaisPlus, שאר
```

**רכיבים:**

- **Frontend**: React + Vite, hosted on Lovable/Netlify
- **Database**: Supabase (PostgreSQL) — טבלאות `memberships`, `discounts`
- **Scraping**: Edge function `scrape-oracle` מופעלת דרך `pg_cron` כל יום ב-03:00 UTC
- **GCP VM**: `israel-scraper-vm`, IP חיצוני `34.165.116.90`, פורט `3001`
- **Browserless**: Docker container על ה-VM, פורט `80→3000`, מאפשר חיבור `puppeteer.connect()` ביעילות זיכרון גבוהה

---

## אסטרטגיית Scraping לפי Membership

| Membership | אסטרטגיה | סיבה |
|---|---|---|
| **CAL** | GCP VM → `puppeteer.launch()` + StealthPlugin | MemCyco מזהה headless Chrome בלי stealth מלא |
| **Isracard** | GCP VM → `puppeteer.connect()` → Browserless | Cloudflare + חסימת IP לא-ישראלי |
| **Yours** | Firecrawl API | אין הגנה, אבל צריך JS rendering |
| **PaisPlus** | Firecrawl API (markdown) | אין הגנה, regex על markdown |
| **Behatzada + שאר** | Firecrawl → Gemini AI | מבנה HTML לא קבוע, AI מפרסר |

---

## האם Firecrawl בשימוש?

**כן.** Firecrawl בשימוש עבור:

- `yours` — scraping ישיר דרך API
- `paisplus` — scraping עם `location: IL` (עוקף חסימת IP)
- `behatzada` + כל membership ללא טיפול מיוחד — Firecrawl → Gemini AI

**כדי למחוק Firecrawl** יצטרך להחליף את Yours ו-PaisPlus בפתרון אחר (לדוגמה GCP proxy), ולמצוא פתרון ל-Behatzada.

---

## Kubernetes

**לא בשימוש בפרויקט.** ה-VM משתמש ב:

- `PM2` — process manager ל-`cal-proxy.js`
- `Docker` — לריצת Browserless בלבד

---

## GCP — כמה GB יש?

- **דיסק**: 10GB סה"כ
- **לפני ניקוי**: 9.7GB תפוס (100%) — `cal-proxy.js` נמחק!
- **אחרי ניקוי** (`docker system prune`): ~279MB פנוי + 553MB swap
- **הסיבה לבעיה**: `/var/lib/docker` צבר 6.7GB של Docker images ישנים

---

## מעבר ל-Oracle Cloud Always Free

**אפשרי.** שינויים הנדרשים:

1. VM חדש → התקן `Node.js`, `PM2`, `puppeteer-extra`, `puppeteer-extra-plugin-stealth`
2. התקן Docker + Browserless (אותה פקודה, עובד על כל VM)
3. עדכן סוד Supabase: `CAL_PROXY_URL = http://NEW_ORACLE_IP:3001`
4. פתח פורט `3001` ב-Oracle Security Rules (מקבילה ל-GCP Firewall)

**Oracle Always Free מציע:**
- 2 VMs עם 1GB RAM כל אחד (או 1 VM עם ARM 24GB!)
- 47GB דיסק לכל VM — **הרבה יותר מ-GCP**

---

## כלי אבטחה בשימוש

| כלי | מטרה |
|---|---|
| **JWT Auth** | כל קריאה ל-`scrape-oracle` דורשת `service_role` או session token |
| **SSRF Protection** | רשימת מאושרים (allowlist) של דומיינים שמותר לscrape |
| **Rate Limiting** | 10 בקשות לדקה לכל IP דרך `increment_rate_limit` RPC |
| **RLS (Row Level Security)** | Supabase — משתמשים רואים רק נתונים מורשים |
| **Secret key על ה-proxy** | `lofrayer-cal-2024` — מונע שימוש לא מורשה ב-VM |

---

## תזכורת: שינוי Cron ל-כל שבועיים

**כרגע**: כל יום ב-03:00 UTC

**רצוי**: כל שבועיים (חוסך מקום בדיסק ועלויות Firecrawl/Gemini)

כדי לשנות:
```sql
SELECT cron.alter_job(1, schedule := '0 3 */14 * *');
```

---

## למה CAL ו-Isracard עבדו בעבר אבל היום הצריכו תיקון?

שתי בעיות נפרדות התגלו היום:

1. **`CAL_PROXY_URL` נשמר שגוי** — הסוד נשמר עם הטקסט `CAL_PROXY_URL = http://...` במקום רק ה-URL. כנראה קרה בהגדרה ראשונית שגויה.

2. **GCP Firewall חסם פורט 3001** — לא הייתה חוק firewall שפותח את הפורט לאינטרנט. ה-VM עצמו לא חסם, אבל GCP חוסם הכל כברירת מחדל. נוצר חוק `allow-cal-proxy`.

בנוסף — הדיסק ב-VM היה מלא 100% (בגלל Docker images), מה שמחק את `cal-proxy.js` בזמן שמירה ב-nano.

---

## למה Yours לא עובד? (עבד בעבר)

**הבעיה**: yours.co.il שינה את מבנה ה-HTML.

**בעבר**: הנתונים היו ב-HTML רגיל עם elements:
```html
<a class="card-item" href="/product/123">
  <h3 class="card-title">...</h3>
```

**היום**: הנתונים נמצאים בתוך JSON blob בתוך `<script>` tag (SSR data):
```json
{"title":"...","business_name":"...","is_giveaway":"N",...}
```

ה-regex הישן מחפש `class="card-item"` שכבר לא קיים. צריך לעדכן את `extractYoursBenefits` לפרסר JSON מתוך ה-script tag.
