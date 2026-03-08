-- Delete mock/seed discounts that were not scraped
DELETE FROM public.discounts WHERE scraped_at IS NULL;