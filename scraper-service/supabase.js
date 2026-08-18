'use strict';

// Minimal PostgREST client. Deliberately dependency-free: adding
// @supabase/supabase-js would grow a container image that already carries
// Chromium, and all we need is four calls.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function assertConfigured() {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must both be set');
  }
}

function headers(extra = {}) {
  return {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    'Content-Type': 'application/json',
    ...extra,
  };
}

async function request(path, init = {}) {
  assertConfigured();
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: headers(init.headers),
  });
  if (!res.ok) {
    throw new Error(`Supabase ${init.method || 'GET'} ${path}: ${res.status}: ${await res.text()}`);
  }
  return res;
}

async function getMembership(slug) {
  const res = await request(`memberships?select=id,name,slug&slug=eq.${encodeURIComponent(slug)}`);
  const rows = await res.json();
  if (!rows.length) throw new Error(`Membership not found: ${slug}`);
  return rows[0];
}

/**
 * Insert one page's worth of benefits, all stamped with this run's timestamp.
 * Nothing is deactivated here — that only happens once the whole run is in,
 * in deactivateStale(). Doing it per page would delete the rows the previous
 * page just wrote.
 */
// `defaults` carries the per-provider fallbacks the old scrape-oracle applied
// inline at each insert site — Isracard defaulted brand to 'ישראכרט', CAL to
// 'כאל', and so on. Folding every provider into one generic insert quietly
// dropped them; an equivalence check caught an Isracard card whose
// caption-sub-title is empty, which used to become 'ישראכרט' and would have
// become null. Falsy, not nullish: an empty string must fall through too.
async function insertDiscounts(rows, membershipId, runId, defaults = {}) {
  if (!rows.length) return 0;

  const payload = rows.map((d) => ({
    brand: d.brand || defaults.brand || null,
    brand_logo_url: d.brand_logo_url || null,
    title: d.title || '',
    // `||`, not `??`: the Deno original collapsed empty strings to null. An
    // equivalence check against CAL caught 14 rows where `??` would have
    // stored "" instead. Keep the two paths byte-identical.
    description: d.description || null,
    discount_value: d.discount_value || '',
    category: d.category || 'כללי',
    location: d.location || 'כל הארץ',
    redeem_url: d.redeem_url || defaults.redeem_url || null,
    membership_id: membershipId,
    scraped_at: runId,
    is_active: true,
  }));

  // on_conflict + ignore-duplicates makes this idempotent against the unique
  // index from migration 20260818120000. Two things depend on it:
  //   - a benefit listed under several category pages inserts once per run,
  //     the way the old single-pass scraper deduplicated in memory
  //   - a job redelivered by SQS after a partial failure re-inserts harmlessly
  await request('discounts?on_conflict=membership_id,title,scraped_at', {
    method: 'POST',
    body: JSON.stringify(payload),
    headers: { Prefer: 'return=minimal,resolution=ignore-duplicates' },
  });
  return payload.length;
}

/**
 * Retire everything from previous runs, now that this run is complete.
 *
 * `scraped_at=not.is.null` is load-bearing: rows entered by hand carry a null
 * timestamp and must survive. See docs/scraping-obstacles.md on Behatzada.
 */
async function deactivateStale(membershipId, runId) {
  const res = await request(
    `discounts?membership_id=eq.${membershipId}&is_active=eq.true` +
      `&scraped_at=not.is.null&scraped_at=lt.${encodeURIComponent(runId)}`,
    {
      method: 'PATCH',
      body: JSON.stringify({ is_active: false }),
      headers: { Prefer: 'return=representation' },
    }
  );
  return (await res.json()).length;
}

async function countActive(membershipId, runId) {
  const res = await request(
    `discounts?select=id&membership_id=eq.${membershipId}&is_active=eq.true&scraped_at=eq.${encodeURIComponent(runId)}`,
    { headers: { Prefer: 'count=exact', Range: '0-0' } }
  );
  const range = res.headers.get('content-range') || '/0';
  return Number(range.split('/')[1] || 0);
}

/** How many rows deactivateStale() would retire — i.e. the previous run's size. */
async function countStalePending(membershipId, runId) {
  const res = await request(
    `discounts?select=id&membership_id=eq.${membershipId}&is_active=eq.true` +
      `&scraped_at=not.is.null&scraped_at=lt.${encodeURIComponent(runId)}`,
    { headers: { Prefer: 'count=exact', Range: '0-0' } }
  );
  const range = res.headers.get('content-range') || '/0';
  return Number(range.split('/')[1] || 0);
}

module.exports = { getMembership, insertDiscounts, deactivateStale, countActive, countStalePending };
