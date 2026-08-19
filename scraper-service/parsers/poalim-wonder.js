'use strict';

// REWRITTEN 2026-08-19. bankhapoalim.co.il was rebuilt as a Next.js app, and
// the previous extractor — which looked for .team-member / .team-member-title
// blocks — silently returned nothing from roughly 2026-08-01 onward. The app
// served 18-day-old benefits as current until the queue migration caught it.
//
// The rebuild is an improvement for us. Only a handful of cards are rendered
// into HTML (the rest sit behind tabs), but every benefit is present in the
// React Server Components payload as a named object:
//
//   { label, bigTitle, subtitle, image: { src }, link, checkbox, popup }
//
// Reading that instead of the markup means a future restyle cannot break us
// the way this one did — the same reasoning as the MAX API parser.

const BASE = 'https://www.bankhapoalim.co.il';

/**
 * Next.js streams its payload as a series of self.__next_f.push([1, "chunk"])
 * calls whose decoded strings concatenate into one flight stream.
 */
function flightStream(html) {
  const re = /self\.__next_f\.push\(\[1,\s*("(?:[^"\\]|\\.)*")\]\)/g;
  let match;
  let stream = '';
  while ((match = re.exec(html)) !== null) {
    try {
      stream += JSON.parse(match[1]);
    } catch {
      // A chunk that will not decode is not worth failing the whole page over.
    }
  }
  return stream;
}

/**
 * Pull out the balanced JSON object that starts at `openIndex`.
 * Returns null if it does not parse — the flight stream is not valid JSON as a
 * whole, so only the individual objects can be trusted.
 */
function objectAt(stream, openIndex) {
  let depth = 0;
  for (let i = openIndex; i < stream.length; i++) {
    if (stream[i] === '{') depth++;
    else if (stream[i] === '}') {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(stream.substring(openIndex, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/** Walk back from `idx` to the '{' that opens the object containing it. */
function enclosingObjectStart(stream, idx) {
  let depth = 0;
  for (let i = idx; i >= 0; i--) {
    if (stream[i] === '}') depth++;
    else if (stream[i] === '{') {
      if (depth === 0) return i;
      depth--;
    }
  }
  return -1;
}

function categoryFor(text) {
  const t = text.toLowerCase();
  if (/מסעד|אוכל|קפה|פיצ|סושי|המבורג|מזון/.test(t)) return 'מזון';
  if (/קולנוע|סרט|בידור|תיאטרון/.test(t)) return 'בידור';
  if (/ספא|יופי|שיער|בריאות|כושר|ספורט/.test(t)) return 'בריאות';
  if (/אופנה|ביגוד|נעל|תיק/.test(t)) return 'אופנה';
  if (/נסיע|טיסה|מלון|תיירות/.test(t)) return 'תיירות';
  if (/קניות|שופינג|שובר/.test(t)) return 'קניות';
  return 'כללי';
}

function extractPoalimWonderBenefits(html, _baseUrl) {
  const stream = flightStream(html);
  const discounts = [];
  const seen = new Set();

  // Every benefit card object carries a bigTitle. Anchor on that rather than on
  // any styling class, which is what made the old parser fragile.
  const marker = '"bigTitle":';
  let pos = 0;

  while ((pos = stream.indexOf(marker, pos)) !== -1) {
    const start = enclosingObjectStart(stream, pos);
    pos += marker.length;
    if (start === -1) continue;

    const obj = objectAt(stream, start);
    if (!obj) continue;

    // Next.js writes the literal string "$undefined" for absent props.
    const brand = typeof obj.bigTitle === 'string' && obj.bigTitle !== '$undefined'
      ? obj.bigTitle.trim()
      : '';
    const subtitle = typeof obj.subtitle === 'string' && obj.subtitle !== '$undefined'
      ? obj.subtitle.trim()
      : '';

    if (!brand || seen.has(brand)) continue;
    seen.add(brand);

    // Title is the brand, not the offer text. Poalim reuses identical offer
    // wording across merchants — "זוג כרטיסים לסרט ... תמורת 48.00 ₪ + 25 נקודות"
    // is shared by two cinema chains — and the unique index keys on
    // (membership_id, title, scraped_at), so offer-as-title silently collapsed
    // distinct benefits into one row. The offer text goes to discount_value,
    // which is where the old path meant to put it and never managed to.
    const title = brand;
    const discount_value = subtitle || 'הטבה';

    const src = obj.image?.src;
    const brand_logo_url = src
      ? src.startsWith('http')
        ? src
        : `${BASE}${src}`
      : null;

    discounts.push({
      brand,
      brand_logo_url,
      title,
      discount_value,
      // Classify on the offer text, not the title — the title is the brand, so
      // brand+title carries no signal ("WOLT WOLT"). The offer wording is where
      // "סרט", "שובר" and the rest actually appear.
      category: categoryFor(`${brand} ${discount_value}`),
    });
  }

  return discounts;
}

module.exports = { extractPoalimWonderBenefits, flightStream };
