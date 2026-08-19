'use strict';

// Weekly entry point. Splits each provider into one queue message per page,
// then enqueues a delayed 'finalize' message that retires the previous run's
// rows once this run's pages have all landed.
//
// Invoked by EventBridge Scheduler: Sundays 03:00 Asia/Jerusalem.

const { SQSClient, SendMessageBatchCommand } = require('@aws-sdk/client-sqs');
const { getMembership } = require('./supabase');
const { PAISPLUS_PAGES } = require('./parsers/paisplus');
const { CAL_PAGES } = require('./parsers/cal');
const { ISRACARD_PAGES } = require('./parsers/isracard');
const { YOURS_PAGES } = require('./parsers/yours');
const { MAX_CATEGORIES } = require('./parsers/max');

const sqs = new SQSClient({});
const QUEUE_URL = process.env.JOB_QUEUE_URL;

// How long to wait before retiring the old rows. SQS has no "wait for these
// jobs to finish" primitive, so the finalize message is simply delayed past the
// point where every page job should have landed. Too short and it counts a
// partial run and refuses — or worse, retires good rows against a partial count.
//
// 600s is sized for the widest provider (PaisPlus, 29 pages). A single-page
// provider does not need it, and a manual test run certainly does not, so the
// dispatch event can override it. The env var stays the production default:
// changing that instead would leave the weekly run short if anyone forgot to
// put it back.
const DEFAULT_FINALIZE_DELAY_SECONDS = Number(process.env.FINALIZE_DELAY_SECONDS || 600);
const MAX_SQS_DELAY_SECONDS = 900;

// Providers that have been migrated to the queue. Anything not listed here is
// still served by the old synchronous path in scrape-oracle — a provider must
// appear in exactly one of the two, never both, or they will fight over the
// same rows.
// `mode` decides how the worker fetches: 'browser' boots the Chromium in this
// image (needed for bot protection or client-side rendering), 'direct' is a
// plain HTTP request. Booting a browser for a server-rendered, unprotected site
// costs seconds and hundreds of MB for nothing.
//
// Poalim Wonder is three membership slugs, one per section, each carrying its
// own scrape_url on the memberships row — so its page comes from the database
// rather than a list here.
const PROVIDERS = {
  pais: { pages: PAISPLUS_PAGES, mode: 'browser' },
  cal: { pages: CAL_PAGES, mode: 'browser' },
  isracard: { pages: ISRACARD_PAGES, mode: 'browser' },
  yours: { pages: YOURS_PAGES, mode: 'direct' },
  // MAX has no page list: each job is one API category, and the worker pages
  // through it until the API says it is done. Page count is only discoverable
  // by walking, so it cannot be split further up front.
  max: {
    pages: MAX_CATEGORIES.map((c) => ({ apiCategory: c.slug, category: c.category })),
    mode: 'api',
  },
  // Browser mode: a plain request gets a 307 and the payload only arrives after
  // the redirect chain, which the browser path already handles reliably.
  'poalim-wonder': { pagesFromMembership: true, mode: 'browser' },
  'poalim-wonder-food': { pagesFromMembership: true, mode: 'browser' },
  'poalim-wonder-movies': { pagesFromMembership: true, mode: 'browser' },
};

async function enqueueAll(messages) {
  // SendMessageBatch takes at most 10 entries per call.
  for (let i = 0; i < messages.length; i += 10) {
    const chunk = messages.slice(i, i + 10);
    const res = await sqs.send(
      new SendMessageBatchCommand({
        QueueUrl: QUEUE_URL,
        Entries: chunk.map((m, n) => ({
          Id: String(i + n),
          MessageBody: JSON.stringify(m.body),
          ...(m.delaySeconds ? { DelaySeconds: m.delaySeconds } : {}),
        })),
      })
    );
    if (res.Failed?.length) {
      throw new Error(`Failed to enqueue ${res.Failed.length} messages: ${JSON.stringify(res.Failed)}`);
    }
  }
}

exports.handler = async (event = {}) => {
  if (!QUEUE_URL) throw new Error('JOB_QUEUE_URL is not set');

  // Allow a manual run of one provider; default to every migrated provider.
  const slugs = event.slug ? [event.slug] : Object.keys(PROVIDERS);

  const finalizeDelay = Math.min(
    Math.max(Number(event.finalizeDelaySeconds) || DEFAULT_FINALIZE_DELAY_SECONDS, 0),
    MAX_SQS_DELAY_SECONDS
  );
  const runId = new Date().toISOString();
  const summary = [];

  for (const slug of slugs) {
    const provider = PROVIDERS[slug];
    if (!provider) {
      throw new Error(`Provider '${slug}' is not migrated to the queue`);
    }

    const membership = await getMembership(slug);

    const pages = provider.pagesFromMembership
      ? [{ url: membership.scrape_url }]
      : provider.pages;

    if (provider.pagesFromMembership && !membership.scrape_url) {
      throw new Error(`Membership '${slug}' has no scrape_url to dispatch`);
    }

    const pageJobs = pages.map((p) => ({
      body: {
        type: 'page',
        slug,
        runId,
        membershipId: membership.id,
        url: p.url,
        apiCategory: p.apiCategory,
        category: p.category,
        mode: provider.mode,
      },
    }));

    // Retiring the old rows is itself a queue message, so it inherits the same
    // retry and dead-letter behaviour as the page jobs.
    const finalizeJob = {
      delaySeconds: finalizeDelay,
      body: { type: 'finalize', slug, runId, membershipId: membership.id, expectedPages: pageJobs.length },
    };

    await enqueueAll([...pageJobs, finalizeJob]);

    console.log(`Enqueued ${pageJobs.length} page jobs for ${slug} (run ${runId}), finalize in ${finalizeDelay}s`);
    summary.push({ slug, pages: pageJobs.length });
  }

  return { runId, dispatched: summary };
};
