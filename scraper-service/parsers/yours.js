'use strict';

// Ported from extractYoursBenefits() in scrape-oracle. The verbose per-page
// console.log calls of the original are dropped — in the queue each page is its
// own invocation, so the log line the worker already writes says the same thing.
//
// yours.co.il is server-rendered and unprotected: every product is serialised
// into a window.__PRELOADED_STATE__ script tag. No browser needed.

function extractYoursBenefits(html, category) {
  const discounts = [];
  const seen = new Set();
  const base = 'https://yours.co.il';
  let items = [];

  // Strategy 1: window.__PRELOADED_STATE__ = {...}; products at state.dataApi.products
  const preloadedIdx = html.indexOf('window.__PRELOADED_STATE__');
  if (preloadedIdx !== -1) {
    const jsonStart = html.indexOf('{', preloadedIdx);
    if (jsonStart !== -1) {
      let depth = 0;
      let jsonEnd = jsonStart;
      for (let i = jsonStart; i < html.length; i++) {
        if (html[i] === '{') depth++;
        else if (html[i] === '}') {
          depth--;
          if (depth === 0) { jsonEnd = i; break; }
        }
      }
      try {
        const state = JSON.parse(html.substring(jsonStart, jsonEnd + 1));
        const products = state?.dataApi?.products || state?.data?.products || [];
        if (Array.isArray(products) && products.length > 0 && products[0]?.product_id !== undefined) {
          items = products;
        }
      } catch {
        // fall through to strategy 2
      }
    }
  }

  // Strategy 2: scan every "products":[ occurrence for the largest valid array
  if (items.length === 0) {
    let pos = 0;
    while (pos < html.length) {
      const found = html.indexOf('"products":[', pos);
      if (found === -1) break;
      const arrStart = found + '"products":'.length;
      let depth = 0;
      let arrEnd = arrStart;
      for (let i = arrStart; i < html.length; i++) {
        if (html[i] === '[' || html[i] === '{') depth++;
        else if (html[i] === ']' || html[i] === '}') {
          depth--;
          if (depth === 0) { arrEnd = i; break; }
        }
      }
      try {
        const parsed = JSON.parse(html.substring(arrStart, arrEnd + 1));
        if (
          Array.isArray(parsed) &&
          parsed.length > 0 &&
          parsed[0]?.product_id !== undefined &&
          parsed.length > items.length
        ) {
          items = parsed;
        }
      } catch {
        // skip
      }
      pos = found + 1;
    }
  }

  for (const item of items) {
    if (!item?.name) continue;
    const title = String(item.name).trim();
    if (!title || seen.has(title)) continue;
    seen.add(title);

    const brand = item.business_name ? String(item.business_name).trim() : 'שלך';
    const productId = item.product_id || item.id || '';
    const redeemUrl = productId ? `${base}/product/${productId}` : base;
    const imgUrl = item.images?.[0]?.image_url || item.image || item.image_url || null;
    const description = item.short_description
      ? String(item.short_description).replace(/<[^>]+>/g, '').trim()
      : null;

    let discount_value = 'הטבה';
    if (item.category_page_price_type_name) {
      discount_value = String(item.category_page_price_type_name).trim();
    }

    discounts.push({
      brand,
      brand_logo_url: imgUrl,
      title,
      description,
      discount_value,
      category,
      redeem_url: redeemUrl,
    });
  }

  return discounts;
}

const YOURS_PAGES = [
  { url: 'https://yours.co.il/category/866', category: 'מזון' },
  { url: 'https://yours.co.il/category/753', category: 'קניות' },
  { url: 'https://yours.co.il/category/1777', category: 'קניות אונליין' },
  { url: 'https://yours.co.il/category/789', category: 'בידור' },
];

module.exports = { extractYoursBenefits, YOURS_PAGES };
