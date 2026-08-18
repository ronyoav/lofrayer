'use strict';

// SQS-triggered worker. Handles two message types:
//   page     — fetch one URL, parse it, insert this run's rows
//   finalize — retire rows left over from previous runs
//
// Fetching happens in-process against the Chromium in this image, not over
// HTTP through API Gateway, so the 30s integration cap does not apply here.

const { fetchPage } = require('./fetch-page');
const { insertDiscounts, deactivateStale, countActive, countStalePending } = require('./supabase');
const { extractPaisPlusBenefits } = require('./parsers/paisplus');
const { extractCalBenefits } = require('./parsers/cal');
const { extractIsracardBenefits } = require('./parsers/isracard');

// Each extractor takes (html, X) but they disagree on what X is, because they
// were written independently against different sites. Rather than rewrite them
// — and risk changing output the equivalence checks pinned — each provider
// declares what its second argument should be.
// `defaults` mirrors the per-provider fallbacks scrape-oracle applied inline at
// each insert site. Without them a benefit whose brand element is empty loses
// its provider name — see insertDiscounts.
const PARSERS = {
  pais: {
    parse: extractPaisPlusBenefits,
    secondArg: (job) => job.category,
    defaults: { brand: 'פיס פלוס' },
  },
  cal: {
    parse: extractCalBenefits,
    secondArg: (job) => job.url,
    defaults: { brand: 'כאל' },
  },
  isracard: {
    parse: extractIsracardBenefits,
    secondArg: (job) => job.url,
    defaults: { brand: 'ישראכרט' },
  },
};

async function handlePage(job) {
  const parser = PARSERS[job.slug];
  if (!parser) throw new Error(`No parser registered for slug '${job.slug}'`);

  const { html, status } = await fetchPage(job.url);
  console.log(`${job.slug} ${job.url}: HTTP ${status}, ${html.length} chars`);

  // A challenge page or an unrendered shell still arrives as HTTP 200, so size
  // is the real signal that the fetch worked. Throwing sends the message back
  // for a retry.
  if (html.length < 1000) {
    throw new Error(`Suspiciously short HTML (${html.length} chars) for ${job.url}`);
  }

  const rows = parser.parse(html, parser.secondArg(job));

  // An empty category is legitimate — paisplus.co.il/category/655 has no
  // benefits at all, and its only /product/ links are navigation chrome.
  // Failing here would push a healthy page into the DLQ every single week.
  //
  // The real risk this leaves — a parser breaking and silently yielding 0
  // everywhere — is caught one level up, where handleFinalize compares the
  // whole run against what it is about to retire.
  if (rows.length === 0) {
    console.warn(`${job.slug} ${job.url}: 0 benefits parsed from ${html.length} chars (empty category?)`);
    return 0;
  }

  const inserted = await insertDiscounts(rows, job.membershipId, job.runId, parser.defaults);
  console.log(`${job.slug} ${job.url}: inserted ${inserted} benefits (run ${job.runId})`);
  return inserted;
}

// A run may legitimately shrink, but not collapse. Below this share of the
// previous run we assume the scraper broke rather than the retailer removing
// most of its offers.
const MIN_RUN_RATIO = 0.5;

async function handleFinalize(job) {
  const fresh = await countActive(job.membershipId, job.runId);
  const previous = await countStalePending(job.membershipId, job.runId);

  // This is the safety net for the per-page tolerance of empty categories.
  // One page returning nothing is normal; the whole run collapsing is not, and
  // at a weekly cadence nobody would notice until the app looked empty for
  // days. Better a week of stale benefits than none.
  if (fresh === 0) {
    throw new Error(
      `Run ${job.runId} for ${job.slug} produced 0 rows - refusing to retire ${previous} existing rows`
    );
  }
  if (previous > 0 && fresh < previous * MIN_RUN_RATIO) {
    throw new Error(
      `Run ${job.runId} for ${job.slug} produced ${fresh} rows vs ${previous} previously ` +
        `(under ${MIN_RUN_RATIO * 100}%) - refusing to retire, likely a broken parser`
    );
  }

  const retired = await deactivateStale(job.membershipId, job.runId);
  console.log(`${job.slug} run ${job.runId}: ${fresh} fresh rows live, ${retired} old rows retired`);
  return { fresh, retired };
}

exports.handler = async (event) => {
  const failures = [];

  for (const record of event.Records || []) {
    let job;
    try {
      job = JSON.parse(record.body);
    } catch {
      // Unparseable message: let it go to the DLQ rather than retrying forever.
      console.error(`Skipping unparseable message ${record.messageId}`);
      continue;
    }

    try {
      if (job.type === 'finalize') await handleFinalize(job);
      else await handlePage(job);
    } catch (err) {
      console.error(`Job failed (${job.type} ${job.url || job.slug}): ${err.message}`);
      // Partial batch response: only this message is retried, not the whole batch.
      failures.push({ itemIdentifier: record.messageId });
    }
  }

  return { batchItemFailures: failures };
};
