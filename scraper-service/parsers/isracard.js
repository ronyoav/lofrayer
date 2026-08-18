'use strict';

// Ported verbatim from extractIsracardBenefits() in
// supabase/functions/scrape-oracle/index.ts.
//
// Two passes, because Isracard builds its two page types differently:
//   online benefits -> <a class="category-item" onclick="...">
//   cinema          -> <div class="category-featured-benefit" aria-label="...">
// The `seen` set spans both passes, so a benefit appearing in each form on the
// same page is emitted once.
//
// The page is server-rendered (Episerver), so the fetch only waits for
// domcontentloaded — Isracard's analytics traffic never lets networkidle
// resolve. See docs/scraping-obstacles.md.

function extractIsracardBenefits(html, baseUrl) {
  const discounts = [];
  const seen = new Set();

  // Pass 1: each benefit card is an <a> with class "category-item"
  const blockRegex = /<a[^>]+class="[^"]*category-item[^"]*"[^>]*onclick="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
  let blockMatch;

  while ((blockMatch = blockRegex.exec(html)) !== null) {
    const onclick = blockMatch[1];
    const inner = blockMatch[2];

    const titleMatch = inner.match(/class="[^"]*caption-title[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
    if (!titleMatch) continue;
    const title = titleMatch[1].replace(/<[^>]+>/g, '').trim();
    if (!title || seen.has(title)) continue;
    seen.add(title);

    const brandMatch = inner.match(/class="[^"]*caption-sub-title[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
    const brand = brandMatch
      ? brandMatch[1].replace(/<[^>]+>/g, '').trim()
      : title.split('-')[0].trim();

    // Redeem URL: location.href='URL' inside the onclick handler
    const urlMatch = onclick.match(/location\.href='([^']+)'/);
    const redeemUrl = urlMatch ? urlMatch[1] : baseUrl;

    // Category: first argument of benefitClick('CATEGORY', ...)
    const catMatch = onclick.match(/benefitClick\('([^']+)'/);
    let category = 'כללי';
    if (catMatch) {
      const raw = catMatch[1];
      if (/אונליין/.test(raw)) category = 'קניות אונליין';
      else if (/אוכל|מסעד/.test(raw)) category = 'מזון';
      else if (/בריאות/.test(raw)) category = 'בריאות';
      else if (/אופנה/.test(raw)) category = 'אופנה';
      else if (/בידור/.test(raw)) category = 'בידור';
      else if (/תיירות|נסיעות/.test(raw)) category = 'תיירות';
      else if (/ספורט/.test(raw)) category = 'ספורט';
    }

    discounts.push({
      brand,
      title,
      description: null,
      discount_value: discountFrom(title),
      category,
      location: 'כל הארץ',
      redeem_url: redeemUrl,
    });
  }

  // Pass 2: cinema-style cards
  const featuredRegex = /<div[^>]+class="[^"]*category-featured-benefit[^"]*"[^>]*aria-label="([^"]*)"[^>]*>([\s\S]*?)<div class="caption-arrow"><\/div>/gi;
  let featuredMatch;

  while ((featuredMatch = featuredRegex.exec(html)) !== null) {
    const ariaTitle = featuredMatch[1].trim();
    const inner = featuredMatch[2];

    const titleMatch = inner.match(/class="[^"]*caption-title[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
    const title = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, '').trim() : ariaTitle;
    if (!title || seen.has(title)) continue;
    seen.add(title);

    const brandMatch = inner.match(/class="[^"]*caption-sub-title[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
    const brand = brandMatch
      ? brandMatch[1].replace(/<[^>]+>/g, '').trim()
      : title.split('-')[0].trim();

    discounts.push({
      brand,
      title,
      description: null,
      discount_value: discountFrom(title),
      category: 'בידור',
      location: 'כל הארץ',
      redeem_url: baseUrl,
    });
  }

  return discounts;
}

// Most specific pattern found in the title wins.
function discountFrom(title) {
  const patterns = [/עד\s*\d+%/, /\d+%/, /\d+\s*₪/, /קאשבק/, /1\+1/];
  for (const pat of patterns) {
    const m = title.match(pat);
    if (m) return m[0];
  }
  return 'הטבה';
}

const ISRACARD_PAGES = [
  { url: 'https://benefits.isracard.co.il/parentcategories/online-benefits/' },
  { url: 'https://benefits.isracard.co.il/parentcategories/cinema/' },
];

module.exports = { extractIsracardBenefits, ISRACARD_PAGES };
