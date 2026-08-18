'use strict';

// Ported verbatim from extractCalBenefits() in
// supabase/functions/scrape-oracle/index.ts. Behaviour is deliberately
// unchanged: the queue migration moves *when* parsing runs, never *what* it
// produces. The equivalence check against production rows is what pins that.
//
// List page structure (one categories__text div per product card):
//   <div class="categories__text">
//     <a href="/product.php?pid=UUID&cid=UUID">
//       <h3 class="font-weight-600">TITLE <span>...price info...</span></h3>
//       <p class="d-table-row">DESCRIPTION</p>
//     </a>
//   </div>
//
// Note cal-store.co.il renders client-side, so the fetch must wait for
// .categories__text — handled by DEFAULT_SELECTORS in fetch-page.js.

function extractCalBenefits(html, baseUrl) {
  const discounts = [];
  const seen = new Set();
  const base = 'https://www.cal-store.co.il';

  const blockRegex = /<div[^>]+class="[^"]*categories__text[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/gi;
  let blockMatch;

  while ((blockMatch = blockRegex.exec(html)) !== null) {
    const inner = blockMatch[1];

    const hrefMatch = inner.match(/href="(\/product\.php\?[^"]+)"/i);
    const redeemUrl = hrefMatch ? `${base}${hrefMatch[1]}` : baseUrl;

    const h3Match = inner.match(/<h3[^>]*>([\s\S]*?)<\/h3>/i);
    if (!h3Match) continue;
    const h3Inner = h3Match[1];

    // Strip all tags -> clean readable text e.g. "תו קנייה לרשת BBB החל מ- ₪ 85 במקום ₪ 100"
    const h3Text = h3Inner.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

    // Title = everything before "החל מ-" (the price prefix); fallback: strip trailing number
    const beforePriceMatch = h3Text.match(/^([\s\S]+?)\s+החל מ-/);
    const titleRaw = beforePriceMatch
      ? beforePriceMatch[1].trim()
      : h3Text.replace(/\s+\d[\d,]*\s*$/, '').trim();

    if (!titleRaw || seen.has(titleRaw)) continue;
    seen.add(titleRaw);

    // All ₪ prices in the h3: first = deal price, second = original price
    const h3Prices = [...h3Text.matchAll(/₪\s*([\d,]+)/g)].map((m) => m[1]);
    const dealPrice = h3Prices[0] || null;
    const origPrice = h3Prices[1] || null;

    // Image: the card carries data-setbg="URL" in a sibling div just before this one
    const lookBefore = html.substring(Math.max(0, blockMatch.index - 700), blockMatch.index);
    const bgMatch = lookBefore.match(/data-setbg="([^"]+)"/);
    const imageUrl = bgMatch ? bgMatch[1] : null;

    let fullTitle = titleRaw;
    if (dealPrice && origPrice) fullTitle = `${titleRaw} ב-₪${dealPrice} במקום ₪${origPrice}`;
    else if (dealPrice) fullTitle = `${titleRaw} ב-₪${dealPrice}`;

    let discountValue = dealPrice ? `₪${dealPrice}` : 'הטבה';
    if (dealPrice && origPrice) {
      const pct = Math.round(
        (1 - parseInt(dealPrice.replace(',', '')) / parseInt(origPrice.replace(',', ''))) * 100
      );
      if (pct > 0) discountValue = `${pct}% הנחה`;
    }

    const descMatch = inner.match(/<p[^>]+class="[^"]*d-table-row[^"]*"[^>]*>([\s\S]*?)<\/p>/i);
    const description = descMatch ? descMatch[1].replace(/<[^>]+>/g, '').trim() : null;

    let brand = 'כאל';
    const englishBrand = titleRaw.match(/\b([A-Z][A-Za-z]{1,}(?:\s+[A-Z][A-Za-z]+)*)\b/);
    const afterPrepBrand = titleRaw.match(
      /(?:לרשת|לאתר|לחנות|למסעדת|למסעד|לפיצרייה|לבית קפה|לקפה|לספא)\s+([^\d\s][^,\n]*?)(?=\s+\d|\s*$)/
    );
    if (englishBrand) brand = englishBrand[1];
    else if (afterPrepBrand) brand = afterPrepBrand[1].trim();
    else brand = titleRaw.split(/\s+/).slice(0, 2).join(' ') || 'כאל';

    let category = 'כללי';
    const text = (titleRaw + ' ' + (description || '')).toLowerCase();
    if (/מסעד|אוכל|קפה|פיצ|שוקו|סושי|המבורג/.test(text)) category = 'מזון';
    else if (/קולנוע|סרט|תיאטרון|הצגה|בידור/.test(text)) category = 'בידור';
    else if (/ספא|קוסמ|יופי|שיער|ניקוי|בריאות|כושר|ספורט/.test(text)) category = 'בריאות';
    else if (/אופנה|ביגוד|נעל|תיק|תכשיט/.test(text)) category = 'אופנה';
    else if (/נסיע|טיסה|מלון|תיירות|חופשה/.test(text)) category = 'תיירות';
    else if (/ילד|משפח|גן|פארק|אטרקצ/.test(text)) category = 'פנאי ומשפחה';
    else if (/תו|קנייה/.test(text)) category = 'קניות';

    discounts.push({
      brand,
      brand_logo_url: imageUrl,
      title: fullTitle,
      description,
      discount_value: discountValue,
      category,
      location: 'כל הארץ',
      redeem_url: redeemUrl,
    });
  }

  return discounts;
}

// The four product-list pages. CAL has no per-page category: the extractor
// derives one per benefit from its text, so `category` here is unused and the
// worker passes the page URL as the second argument instead.
const CAL_PAGES = [
  { url: 'https://www.cal-store.co.il/productlist.php?cid=B0E087D2-212B-4308-813D-C8693B2563F7' },
  { url: 'https://www.cal-store.co.il/productlist.php?cid=11FAA02A-199E-4789-B826-4AD4FF5A8994' },
  { url: 'https://www.cal-store.co.il/productlist.php?cid=6BA2A2E1-768B-47A5-A43C-97B745E0B8F6' },
  { url: 'https://www.cal-store.co.il/productlist.php?cid=1A680972-97C4-4B2F-9950-37EC7297DA73' },
];

module.exports = { extractCalBenefits, CAL_PAGES };
