'use strict';

// Ported verbatim from extractPaisPlusBenefits() in
// supabase/functions/scrape-oracle/index.ts. Kept byte-for-byte identical in
// behaviour on purpose: the queue migration should change *when* parsing runs,
// never *what* it produces. parsers.test.js pins that.
//
// Card structure:
//   <a class="card-item regular category-page" href="/product/ID">
//     <img class="card-img" src="URL">
//     <h3 class="card-title">BRAND - TITLE</h3>
//     <p class="card-sub-title">LOCATION</p>
//     <div class="price-text">החל מ-</div><div class="price-number">52 ₪</div>

function extractPaisPlusBenefits(html, category) {
  const discounts = [];
  const seen = new Set();

  const blockRegex = /<a[^>]+class="[^"]*card-item[^"]*"[^>]+href="(\/product\/\d+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let match;

  while ((match = blockRegex.exec(html)) !== null) {
    const href = match[1];
    const inner = match[2];

    const titleMatch = inner.match(/<h3[^>]+class="[^"]*card-title[^"]*"[^>]*>([\s\S]*?)<\/h3>/i);
    if (!titleMatch) continue;
    const rawTitle = titleMatch[1].replace(/<[^>]+>/g, '').trim();
    if (!rawTitle || seen.has(rawTitle)) continue;
    seen.add(rawTitle);

    // Brand and title: "BRAND - TITLE" format
    let brand = 'פיס פלוס';
    let title = rawTitle;
    const dashIdx = rawTitle.indexOf(' - ');
    if (dashIdx > 0) {
      brand = rawTitle.substring(0, dashIdx).trim();
      title = rawTitle.substring(dashIdx + 3).trim() || rawTitle;
    } else {
      const prepBrand = rawTitle.match(/(?:לרשת ואתר|לרשת|לאתר)\s+(.+?)$/);
      const englishBrand = rawTitle.match(/\b([A-Z][A-Za-z &]{1,30})\b/);
      if (prepBrand) brand = prepBrand[1].trim();
      else if (englishBrand) brand = englishBrand[1].trim();
    }

    const imgMatch = inner.match(/src="([^"]+)"[^>]*class="[^"]*card-img[^"]*"/i) ||
                     inner.match(/class="[^"]*card-img[^"]*"[^>]*src="([^"]+)"/i);
    const brand_logo_url = imgMatch ? imgMatch[1] : null;

    const priceMatch = inner.match(/class="[^"]*price-number[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
    let discount_value = 'הטבה';
    if (priceMatch) {
      const priceText = priceMatch[1].replace(/<[^>]+>/g, '').trim();
      if (priceText) discount_value = `החל מ- ${priceText}`;
    }

    const locationMatch = inner.match(/<p[^>]+class="[^"]*card-sub-title[^"]*"[^>]*>([\s\S]*?)<\/p>/i);
    const location = locationMatch ? locationMatch[1].replace(/<[^>]+>/g, '').trim() : 'כל הארץ';

    discounts.push({
      brand,
      brand_logo_url,
      title,
      discount_value,
      category,
      location: location || 'כל הארץ',
      redeem_url: `https://paisplus.co.il${href}`,
    });
  }

  return discounts;
}

// The 29 category pages, with the Hebrew category each maps to. Lifted from
// the allPaisPlusUrls list in scrape-oracle.
const PAISPLUS_PAGES = [
  { url: 'https://paisplus.co.il/category/279', category: 'קניות' },
  { url: 'https://paisplus.co.il/category/296', category: 'קניות אונליין' },
  { url: 'https://paisplus.co.il/category/314', category: 'מזון' },
  { url: 'https://paisplus.co.il/category/1469', category: 'מזון' },
  { url: 'https://paisplus.co.il/category/1510', category: 'מזון' },
  { url: 'https://paisplus.co.il/category/1326', category: 'מזון' },
  { url: 'https://paisplus.co.il/category/1030', category: 'מזון' },
  { url: 'https://paisplus.co.il/category/1616', category: 'מזון' },
  { url: 'https://paisplus.co.il/category/1833', category: 'מזון' },
  { url: 'https://paisplus.co.il/category/284', category: 'מזון' },
  { url: 'https://paisplus.co.il/category/331', category: 'מזון' },
  { url: 'https://paisplus.co.il/category/285', category: 'מזון' },
  { url: 'https://paisplus.co.il/category/373', category: 'מזון' },
  { url: 'https://paisplus.co.il/category/374', category: 'מזון' },
  { url: 'https://paisplus.co.il/category/375', category: 'מזון' },
  { url: 'https://paisplus.co.il/category/1697', category: 'מזון' },
  { url: 'https://paisplus.co.il/category/1738', category: 'מזון' },
  { url: 'https://paisplus.co.il/category/305', category: 'בידור' },
  { url: 'https://paisplus.co.il/category/304', category: 'בידור' },
  { url: 'https://paisplus.co.il/category/451', category: 'בידור' },
  { url: 'https://paisplus.co.il/category/310', category: 'בידור' },
  { url: 'https://paisplus.co.il/category/306', category: 'בידור' },
  { url: 'https://paisplus.co.il/category/655', category: 'בידור' },
  { url: 'https://paisplus.co.il/category/307', category: 'בידור' },
  { url: 'https://paisplus.co.il/category/282', category: 'בידור' },
  { url: 'https://paisplus.co.il/category/291', category: 'בידור' },
  { url: 'https://paisplus.co.il/category/292', category: 'בידור' },
  { url: 'https://paisplus.co.il/category/337', category: 'בידור' },
  { url: 'https://paisplus.co.il/category/287', category: 'בידור' },
];

module.exports = { extractPaisPlusBenefits, PAISPLUS_PAGES };
