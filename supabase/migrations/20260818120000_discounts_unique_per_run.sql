-- Make a benefit unique within one scrape run.
--
-- The queue worker processes each category page independently, so it cannot
-- remember what other pages already produced. The old synchronous scraper
-- walked all pages in one pass and deduplicated in memory; splitting the work
-- across messages lost that, and a PaisPlus run produced 237 duplicate rows
-- (one benefit listed under 14 category pages appeared 14 times).
--
-- Enforcing it in the database instead of the worker also makes inserts
-- idempotent, which the queue needs: a page job that fails after inserting
-- gets redelivered by SQS and would otherwise insert its rows a second time.
--
-- scraped_at is part of the key so that each weekly run is its own namespace —
-- consecutive runs legitimately hold the same title.

-- Hand-entered rows carry scraped_at IS NULL and must not be touched; the
-- partial index below excludes them. See docs/scraping-obstacles.md (Behatzada).
DELETE FROM public.discounts a
USING public.discounts b
WHERE a.ctid > b.ctid
  AND a.membership_id = b.membership_id
  AND a.title = b.title
  AND a.scraped_at = b.scraped_at
  AND a.scraped_at IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS discounts_membership_title_run_uniq
  ON public.discounts (membership_id, title, scraped_at)
  WHERE scraped_at IS NOT NULL;
