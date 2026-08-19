'use strict';

// MAX is the odd one out: no HTML, no browser. The site's own pages call a
// public JSON endpoint and render the result client-side, so we call the same
// endpoint and skip the rendering. Fields arrive named (`name`, `subTitle`,
// `urlName`), which also makes this far more redesign-proof than the regex
// scraping every other provider needs — see Poalim Wonder for the failure mode.
//
// It is also the only provider whose page count is unknown up front: each
// response says whether it is the last. So a job here is one *category*, and
// pagination happens inside it, rather than one job per page.
//
// Ported from the isMax branch of scrape-oracle.

const API = 'https://www.max.co.il/api/benefits/getCategoriesLobby';

const MAX_CATEGORIES = [
  { slug: 'movies', category: 'בידור' },
  { slug: 'plays', category: 'בידור' },
  { slug: 'musicshows', category: 'בידור' },
  { slug: 'standupshows', category: 'בידור' },
  { slug: 'attractions', category: 'פנאי ומשפחה' },
  { slug: 'tastytreat', category: 'מזון' },
  { slug: 'paybacksites', category: 'קניות אונליין' },
  { slug: 'online', category: 'קניות אונליין' },
  { slug: 'fashion', category: 'אופנה' },
  { slug: 'vacation', category: 'תיירות' },
  { slug: 'abroadbenefits', category: 'תיירות' },
];

// Stop runaway pagination if the API ever stops setting isLast.
const MAX_PAGES = 50;

function toDiscount(b, category) {
  const title = b.name || b.title || '';
  if (!title) return null;

  // "BRAND - REST" is MAX's convention; fall back to the whole title.
  let brand = title;
  const dashIdx = title.indexOf(' - ');
  if (dashIdx > 0) brand = title.substring(0, dashIdx).trim();

  return {
    brand,
    brand_logo_url: b.image?.url || null,
    title,
    discount_value: b.subTitle?.split('\n')[0]?.trim() || 'הטבה',
    category,
    redeem_url: b.urlName
      ? `https://www.max.co.il/benefits/${b.urlName}`
      : 'https://www.max.co.il/benefits',
  };
}

/**
 * Walk one category to its last page and return every benefit on it.
 *
 * The old path deduplicated by benefit id across all 11 categories in one pass.
 * Per-category jobs cannot share that, so cross-category duplicates are handled
 * by the unique index on (membership_id, title, scraped_at) instead — same as
 * PaisPlus. Within a category, ids are still deduplicated here.
 */
async function fetchMaxCategory({ slug, category }) {
  const discounts = [];
  const seenIds = new Set();

  for (let page = 0; page < MAX_PAGES; page++) {
    const url =
      `${API}?isMobile=true&page=${page}&loadLobby=false` +
      `&category=${encodeURIComponent(slug)}&club=undefined&region=undefined`;

    const res = await fetch(url, {
      headers: { Accept: 'application/json', 'Accept-Language': 'he-IL,he;q=0.9' },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`MAX API ${slug} page ${page}: HTTP ${res.status}`);

    const data = await res.json();
    const benefits = data?.result?.benefits || [];

    for (const b of benefits) {
      if (!b.id || seenIds.has(b.id)) continue;
      seenIds.add(b.id);
      const d = toDiscount(b, category);
      if (d) discounts.push(d);
    }

    if (data?.result?.isLast === true || benefits.length === 0) break;
  }

  return discounts;
}

module.exports = { fetchMaxCategory, MAX_CATEGORIES, toDiscount };
