-- Set scrape_url and website_url for Isracard membership
-- The benefits site is publicly accessible without login
UPDATE memberships
SET
  scrape_url  = 'https://benefits.isracard.co.il/',
  website_url = 'https://benefits.isracard.co.il/'
WHERE slug IN ('iscard', 'isracard', 'isracard-benefits');
