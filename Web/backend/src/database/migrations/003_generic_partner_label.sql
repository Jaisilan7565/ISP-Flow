-- 003: The product is used by many ISP companies, so defaults must be generic.
-- New companies call the B % party simply "Partner"; each company can rename it in Settings.
-- Existing companies keep whatever name they already have.
ALTER TABLE tenant_settings ALTER COLUMN partner_label SET DEFAULT 'Partner';
