-- Fix: write policies were granting access to `anon` (unauthenticated).
-- The Supabase anon key is visible in the browser, so anyone could write/delete data.
-- Change to `authenticated` so only users with a valid session JWT can mutate data.

DROP POLICY IF EXISTS "Allow insert discounts" ON public.discounts;
DROP POLICY IF EXISTS "Allow update discounts" ON public.discounts;
DROP POLICY IF EXISTS "Allow delete discounts" ON public.discounts;

CREATE POLICY "Authenticated can insert discounts" ON public.discounts
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated can update discounts" ON public.discounts
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated can delete discounts" ON public.discounts
  FOR DELETE TO authenticated USING (true);
