'use strict';

// Ported verbatim from extractPoalimWonderBenefits() in scrape-oracle.
//
// A plain public Drupal site: server-rendered, no protections, no browser
// needed. Card structure:
//   <div class="team-member with-img">
//     <img class="team-member-img" src="URL">
//     <div class="team-member-title">BRAND</div>
//     <div class="team-member-subtitle">שובר בשווי 250₪\nתמורת 199₪ + 25 נקודות</div>
//   </div>
//
// Unlike the other providers, Poalim Wonder is split across three membership
// slugs, one per section, each with its own scrape_url on the memberships row.
// The dispatcher reads that rather than holding a hardcoded page list.

function extractPoalimWonderBenefits(html, _baseUrl) {
  const discounts = [];
  const seen = new Set();
  const base = 'https://www.bankhapoalim.co.il';

  const blockRegex = /<div[^>]+class="[^"]*team-member[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/gi;
  let match;

  while ((match = blockRegex.exec(html)) !== null) {
    const inner = match[1];

    const titleMatch = inner.match(/class="[^"]*team-member-title[^"]*"[^>]*>([\s\S]*?)<\/(?:div|h2|h3|p)>/i);
    if (!titleMatch) continue;
    const brand = titleMatch[1].replace(/<[^>]+>/g, '').trim();
    if (!brand || seen.has(brand)) continue;
    seen.add(brand);

    const subtitleMatch = inner.match(/<div[^>]+class="[^"]*team-member-subtitle[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
    const subtitleRaw = subtitleMatch ? subtitleMatch[1].replace(/<[^>]+>/g, '').trim() : '';
    const title = subtitleRaw.split('\n')[0].trim() || brand;
    const discount_value = subtitleRaw || 'הטבה';

    const imgMatch =
      inner.match(/<img[^>]+class="[^"]*team-member-img[^"]*"[^>]+src="([^"]+)"/i) ||
      inner.match(/src="([^"]+)"[^>]+class="[^"]*team-member-img[^"]*"/i);
    const brand_logo_url = imgMatch
      ? imgMatch[1].startsWith('http')
        ? imgMatch[1]
        : `${base}${imgMatch[1]}`
      : null;

    let category = 'כללי';
    const text = (brand + ' ' + title).toLowerCase();
    if (/מסעד|אוכל|קפה|פיצ|סושי|המבורג|מזון/.test(text)) category = 'מזון';
    else if (/קולנוע|סרט|בידור|תיאטרון/.test(text)) category = 'בידור';
    else if (/ספא|יופי|שיער|בריאות|כושר|ספורט/.test(text)) category = 'בריאות';
    else if (/אופנה|ביגוד|נעל|תיק/.test(text)) category = 'אופנה';
    else if (/נסיע|טיסה|מלון|תיירות/.test(text)) category = 'תיירות';
    else if (/קניות|שופינג|שובר/.test(text)) category = 'קניות';

    discounts.push({ brand, brand_logo_url, title, discount_value, category });
  }

  return discounts;
}

module.exports = { extractPoalimWonderBenefits };
