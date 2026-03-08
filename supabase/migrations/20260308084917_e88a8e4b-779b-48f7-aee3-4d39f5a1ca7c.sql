
-- Drop overly permissive policies
DROP POLICY "Service role can manage memberships" ON public.memberships;
DROP POLICY "Service role can manage discounts" ON public.discounts;

-- Recreate with proper restrictions (only service role via auth.role check)
-- For inserts/updates/deletes, we rely on edge functions using service_role key
-- No public write access
