-- Allow anyone to insert discounts (will be done via edge function with service role)
-- No additional RLS needed since edge function uses service role key
-- But let's add a policy for direct anon inserts for the admin UI
CREATE POLICY "Allow insert discounts" ON public.discounts FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "Allow update discounts" ON public.discounts FOR UPDATE TO anon USING (true) WITH CHECK (true);
CREATE POLICY "Allow delete discounts" ON public.discounts FOR DELETE TO anon USING (true);