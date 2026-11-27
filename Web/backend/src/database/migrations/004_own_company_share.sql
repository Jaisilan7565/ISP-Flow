-- 004: "UDIN" in the sketch is the ISP company itself (the company onboarded by the Platform Admin that uses the tool),
-- not an outside partner.
--   B %  of the budget  = the company's own share
--   "Pending with UDIN" = pending with the company itself (internal work) -> party COMPANY, shown by the company's name
ALTER TABLE site_blockers DROP CONSTRAINT IF EXISTS site_blockers_party_check;
UPDATE site_blockers SET party = 'COMPANY' WHERE party = 'PARTNER';
ALTER TABLE site_blockers ADD CONSTRAINT site_blockers_party_check
  CHECK (party IN ('CLIENT','VENDOR','COMPANY','CUSTOMER','AUTHORITY','OTHER'));

-- The separate "partner" name is no longer used: the company's own name is shown instead.
ALTER TABLE tenant_settings DROP COLUMN IF EXISTS partner_label;

COMMENT ON COLUMN tenant_settings.default_partner_pct IS 'Default B %: the company''s own share of the finalized quote value';
COMMENT ON COLUMN quotes.partner_pct IS 'B %: the company''s own share of the finalized quote value';
COMMENT ON COLUMN quotes.partner_amount IS 'B amount: the company''s own share';
COMMENT ON COLUMN quotes.partner_vendor_id IS 'Unused since 004 (kept for old records)';
