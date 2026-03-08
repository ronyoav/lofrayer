
-- Create memberships table
CREATE TABLE public.memberships (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  logo_url TEXT,
  color TEXT,
  website_url TEXT,
  scrape_url TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create discounts table
CREATE TABLE public.discounts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  brand TEXT NOT NULL,
  brand_logo_url TEXT,
  title TEXT NOT NULL,
  description TEXT,
  discount_value TEXT NOT NULL,
  membership_id UUID REFERENCES public.memberships(id) ON DELETE CASCADE NOT NULL,
  category TEXT,
  location TEXT,
  redeem_url TEXT,
  expires_at TIMESTAMP WITH TIME ZONE,
  is_active BOOLEAN NOT NULL DEFAULT true,
  scraped_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.discounts ENABLE ROW LEVEL SECURITY;

-- Public read access for both tables (no auth required to view discounts)
CREATE POLICY "Anyone can view memberships" ON public.memberships FOR SELECT USING (true);
CREATE POLICY "Anyone can view active discounts" ON public.discounts FOR SELECT USING (is_active = true);

-- Service role can manage all data (for edge functions)
CREATE POLICY "Service role can manage memberships" ON public.memberships FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role can manage discounts" ON public.discounts FOR ALL USING (true) WITH CHECK (true);

-- Create index for faster queries
CREATE INDEX idx_discounts_membership ON public.discounts(membership_id);
CREATE INDEX idx_discounts_category ON public.discounts(category);
CREATE INDEX idx_discounts_location ON public.discounts(location);
CREATE INDEX idx_discounts_active ON public.discounts(is_active);

-- Update timestamp trigger
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_discounts_updated_at
  BEFORE UPDATE ON public.discounts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
