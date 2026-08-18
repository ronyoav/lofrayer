-- Replace the partial unique index from 20260818120000 with a full one.
--
-- Postgres cannot resolve `ON CONFLICT (cols)` against a *partial* index
-- unless the statement repeats the index predicate, and PostgREST's
-- `on_conflict=` parameter has no way to express one. Every insert failed with
-- 42P10: "there is no unique or exclusion constraint matching the ON CONFLICT
-- specification".
--
-- The predicate was unnecessary anyway. Postgres treats NULLs as distinct in a
-- unique index by default, so hand-entered rows (scraped_at IS NULL) still do
-- not constrain each other under a full index -- which is the only reason the
-- partial version existed. See docs/scraping-obstacles.md (Behatzada).

DROP INDEX IF EXISTS public.discounts_membership_title_run_uniq;

CREATE UNIQUE INDEX IF NOT EXISTS discounts_membership_title_run_uniq
  ON public.discounts (membership_id, title, scraped_at);
