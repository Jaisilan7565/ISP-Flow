-- 002: Clients place multi-site orders (WhatsApp / email); the company's field engineers
-- pastes them in and owns each site from feasibility to delivery.

-- Clients (table stays "customers"): type of client
ALTER TABLE customers ADD COLUMN IF NOT EXISTS client_type VARCHAR(16) NOT NULL DEFAULT 'ENTERPRISE'
  CHECK (client_type IN ('PSU_GOVT','TELECOM','BFSI','ENTERPRISE','OTHER'));

-- Client order: one WhatsApp / email order from a client, covering one or many sites
CREATE TABLE IF NOT EXISTS client_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  code VARCHAR(32) NOT NULL,
  customer_id UUID NOT NULL REFERENCES customers(id),
  client_ref VARCHAR(128),
  received_via VARCHAR(16) NOT NULL DEFAULT 'WHATSAPP' CHECK (received_via IN ('WHATSAPP','EMAIL','PORTAL','LETTER','PHONE')),
  received_date DATE NOT NULL,
  client_contact_name VARCHAR(128),
  client_contact_phone VARCHAR(32),
  client_contact_email VARCHAR(255),
  expected_by DATE,
  raw_message TEXT,
  notes TEXT,
  owner_id UUID REFERENCES users(id),
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, code)
);
CREATE INDEX IF NOT EXISTS idx_orders_tenant_customer ON client_orders(tenant_id, customer_id);

-- Each site request carries the order, the client's own site ID and the contact at the site
ALTER TABLE feasibility_requests ADD COLUMN IF NOT EXISTS order_id UUID REFERENCES client_orders(id);
ALTER TABLE feasibility_requests ADD COLUMN IF NOT EXISTS client_site_ref VARCHAR(64);
ALTER TABLE feasibility_requests ADD COLUMN IF NOT EXISTS site_contact_name VARCHAR(128);
ALTER TABLE feasibility_requests ADD COLUMN IF NOT EXISTS site_contact_phone VARCHAR(32);
CREATE INDEX IF NOT EXISTS idx_feas_order ON feasibility_requests(order_id);

ALTER TABLE sites ADD COLUMN IF NOT EXISTS order_id UUID REFERENCES client_orders(id);
ALTER TABLE sites ADD COLUMN IF NOT EXISTS client_site_ref VARCHAR(64);
ALTER TABLE sites ADD COLUMN IF NOT EXISTS site_contact_name VARCHAR(128);
ALTER TABLE sites ADD COLUMN IF NOT EXISTS site_contact_phone VARCHAR(32);
CREATE INDEX IF NOT EXISTS idx_sites_owner ON sites(tenant_id, owner_id);

-- Field Surveyor -> Field Engineer (owns the site from feasibility to delivery)
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
UPDATE users SET role = 'FIELD_ENGINEER' WHERE role = 'FIELD_SURVEYOR';
ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role IN ('PLATFORM_OWNER','TENANT_ADMIN','COMMERCIAL_MANAGER','FIELD_ENGINEER','OPERATIONS','BILLING_EXEC','FINANCE_HEAD'));

-- Sites already won keep their surveyor as the delivery owner
UPDATE sites s SET owner_id = f.assigned_to FROM feasibility_requests f
 WHERE f.id = s.feasibility_id AND s.owner_id IS NULL AND f.assigned_to IS NOT NULL;

-- "Pending with <client name>" = pending with the CLIENT. AUTHORITY stays for ROW / permissions.
ALTER TABLE site_blockers DROP CONSTRAINT IF EXISTS site_blockers_party_check;
UPDATE site_blockers SET party = 'CLIENT' WHERE party = 'AUTHORITY';
ALTER TABLE site_blockers ADD CONSTRAINT site_blockers_party_check
  CHECK (party IN ('VENDOR','PARTNER','CLIENT','CUSTOMER','AUTHORITY','OTHER'));
ALTER TABLE tenant_settings ALTER COLUMN authority_label SET DEFAULT 'ROW / Authority';
UPDATE tenant_settings SET authority_label = 'ROW / Authority' WHERE authority_label = 'RailTel';

-- Documents can be attached to a client order (the original WhatsApp screenshot / email)
ALTER TABLE documents DROP CONSTRAINT IF EXISTS documents_entity_type_check;
ALTER TABLE documents ADD CONSTRAINT documents_entity_type_check
  CHECK (entity_type IN ('ORDER','FEASIBILITY','QUOTE','SITE','INVOICE','RECEIPT','PAYOUT'));
