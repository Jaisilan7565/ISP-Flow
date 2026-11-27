-- ISP-Flow core schema. Every business table is tenant-scoped; FKs chain the lifecycle:
-- feasibility_requests -> quotes -> sites -> invoices -> receipts -> waterfall_allocations / payouts

CREATE TABLE IF NOT EXISTS tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(16) NOT NULL UNIQUE,
  name VARCHAR(255) NOT NULL,
  gstin VARCHAR(20),
  address TEXT,
  state VARCHAR(64),
  contact_email VARCHAR(255),
  contact_phone VARCHAR(32),
  status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','SUSPENDED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE, -- NULL = platform staff
  name VARCHAR(128) NOT NULL,
  email VARCHAR(255) NOT NULL UNIQUE,
  phone VARCHAR(32),
  zone VARCHAR(64),
  role VARCHAR(32) NOT NULL CHECK (role IN ('PLATFORM_OWNER','TENANT_ADMIN','COMMERCIAL_MANAGER','FIELD_SURVEYOR','OPERATIONS','BILLING_EXEC','FINANCE_HEAD')),
  password_hash TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK ((role = 'PLATFORM_OWNER') = (tenant_id IS NULL))
);
CREATE INDEX IF NOT EXISTS idx_users_tenant ON users(tenant_id);

CREATE TABLE IF NOT EXISTS tenant_settings (
  tenant_id UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  gst_pct NUMERIC(5,2) NOT NULL DEFAULT 18,
  default_vendor_pct NUMERIC(5,2) NOT NULL DEFAULT 55,
  default_partner_pct NUMERIC(5,2) NOT NULL DEFAULT 25,
  default_capex_pct NUMERIC(5,2) NOT NULL DEFAULT 20,
  default_contract_months INT NOT NULL DEFAULT 12,
  default_credit_days INT NOT NULL DEFAULT 30,
  default_sla_days INT NOT NULL DEFAULT 30,
  monthly_salary_burn NUMERIC(14,2) NOT NULL DEFAULT 0,
  salary_reserve_months INT NOT NULL DEFAULT 3,
  loan_emi_monthly NUMERIC(14,2) NOT NULL DEFAULT 0,
  loan_account_ref VARCHAR(128),
  partner_label VARCHAR(64) NOT NULL DEFAULT 'UDIN / Partner',
  authority_label VARCHAR(64) NOT NULL DEFAULT 'RailTel',
  invoice_prefix VARCHAR(16) NOT NULL DEFAULT 'INV',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS counters (
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  key VARCHAR(32) NOT NULL,
  value INT NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, key)
);

CREATE TABLE IF NOT EXISTS customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  gstin VARCHAR(20),
  billing_address TEXT,
  state VARCHAR(64),
  contact_name VARCHAR(128),
  contact_phone VARCHAR(32),
  contact_email VARCHAR(255),
  credit_days INT NOT NULL DEFAULT 30,
  billing_frequency VARCHAR(16) NOT NULL DEFAULT 'MONTHLY' CHECK (billing_frequency IN ('MONTHLY','QUARTERLY')),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, name)
);

CREATE TABLE IF NOT EXISTS vendors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  vendor_type VARCHAR(16) NOT NULL DEFAULT 'ISP' CHECK (vendor_type IN ('ISP','PARTNER','CONTRACTOR')),
  gstin VARCHAR(20),
  contact_name VARCHAR(128),
  contact_phone VARCHAR(32),
  contact_email VARCHAR(255),
  payment_terms_days INT NOT NULL DEFAULT 30,
  bank_details TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, name)
);

-- ① FEASIBILITY
CREATE TABLE IF NOT EXISTS feasibility_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  code VARCHAR(32) NOT NULL,
  customer_id UUID NOT NULL REFERENCES customers(id),
  site_name VARCHAR(255) NOT NULL,
  address TEXT NOT NULL,
  city VARCHAR(64),
  pincode VARCHAR(10),
  latitude NUMERIC(10,7),
  longitude NUMERIC(10,7),
  maps_url TEXT,
  source_channel VARCHAR(16) NOT NULL DEFAULT 'WHATSAPP' CHECK (source_channel IN ('WHATSAPP','MAPS','EMAIL','PHONE','MANUAL')),
  raw_message TEXT,
  bandwidth_mbps INT NOT NULL CHECK (bandwidth_mbps > 0),
  medium VARCHAR(16) NOT NULL DEFAULT 'FIBER',
  requester_name VARCHAR(128),
  requester_phone VARCHAR(32),
  assigned_to UUID REFERENCES users(id),
  assigned_at TIMESTAMPTZ,
  status VARCHAR(20) NOT NULL DEFAULT 'NEW'
    CHECK (status IN ('NEW','ASSIGNED','SURVEY_DONE','PRICE_FINALIZED','COMPLETED','NOT_FEASIBLE','CANCELLED')),
  survey_notes TEXT,
  nearest_pop_m INT,
  surveyed_at TIMESTAMPTZ,
  selected_option_id UUID,
  final_client_otc NUMERIC(14,2),
  final_client_mrc NUMERIC(14,2),
  price_finalized_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  stop_reason TEXT,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, code)
);
CREATE INDEX IF NOT EXISTS idx_feas_tenant_status ON feasibility_requests(tenant_id, status);

CREATE TABLE IF NOT EXISTS feasibility_isp_options (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  feasibility_id UUID NOT NULL REFERENCES feasibility_requests(id) ON DELETE CASCADE,
  vendor_id UUID NOT NULL REFERENCES vendors(id),
  is_feasible BOOLEAN NOT NULL DEFAULT TRUE,
  medium VARCHAR(16),
  distance_m INT,
  vendor_otc NUMERIC(14,2) NOT NULL DEFAULT 0,
  vendor_mrc NUMERIC(14,2) NOT NULL DEFAULT 0,
  lead_time_days INT,
  remarks TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (feasibility_id, vendor_id)
);

-- ② COMMERCIAL
CREATE TABLE IF NOT EXISTS quotes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  code VARCHAR(32) NOT NULL,
  feasibility_id UUID NOT NULL UNIQUE REFERENCES feasibility_requests(id),
  customer_id UUID NOT NULL REFERENCES customers(id),
  site_name VARCHAR(255) NOT NULL,
  bandwidth_mbps INT NOT NULL,
  contract_months INT NOT NULL DEFAULT 12,
  status VARCHAR(16) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','SENT','WON','LOST')),
  sent_at TIMESTAMPTZ,
  decided_at TIMESTAMPTZ,
  lost_reason TEXT,
  won_option_no INT,
  final_vendor_id UUID REFERENCES vendors(id),
  final_vendor_otc NUMERIC(14,2),
  final_vendor_mrc NUMERIC(14,2),
  final_client_otc NUMERIC(14,2),
  final_client_mrc NUMERIC(14,2),
  finalized_value NUMERIC(14,2),
  vendor_pct NUMERIC(5,2),
  partner_pct NUMERIC(5,2),
  capex_pct NUMERIC(5,2),
  vendor_amount NUMERIC(14,2),
  partner_amount NUMERIC(14,2),
  capex_amount NUMERIC(14,2),
  partner_vendor_id UUID REFERENCES vendors(id),
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, code)
);

CREATE TABLE IF NOT EXISTS quote_options (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  quote_id UUID NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  option_no INT NOT NULL CHECK (option_no BETWEEN 1 AND 3),
  vendor_id UUID NOT NULL REFERENCES vendors(id),
  vendor_otc NUMERIC(14,2) NOT NULL DEFAULT 0,
  vendor_mrc NUMERIC(14,2) NOT NULL DEFAULT 0,
  client_otc NUMERIC(14,2) NOT NULL DEFAULT 0,
  client_mrc NUMERIC(14,2) NOT NULL DEFAULT 0,
  sla_pct NUMERIC(5,2),
  notes TEXT,
  UNIQUE (quote_id, option_no)
);

-- ③ IMPLEMENTATION
CREATE TABLE IF NOT EXISTS sites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  code VARCHAR(32) NOT NULL,
  quote_id UUID NOT NULL UNIQUE REFERENCES quotes(id),
  feasibility_id UUID NOT NULL REFERENCES feasibility_requests(id),
  customer_id UUID NOT NULL REFERENCES customers(id),
  vendor_id UUID NOT NULL REFERENCES vendors(id),
  site_name VARCHAR(255) NOT NULL,
  address TEXT,
  bandwidth_mbps INT NOT NULL,
  client_otc NUMERIC(14,2) NOT NULL DEFAULT 0,
  client_mrc NUMERIC(14,2) NOT NULL DEFAULT 0,
  vendor_otc NUMERIC(14,2) NOT NULL DEFAULT 0,
  vendor_mrc NUMERIC(14,2) NOT NULL DEFAULT 0,
  contract_months INT NOT NULL DEFAULT 12,
  status VARCHAR(16) NOT NULL DEFAULT 'AWAITING_PO'
    CHECK (status IN ('AWAITING_PO','PO_RECEIVED','WORK_STARTED','BLOCKED','LIVE','TERMINATED')),
  po_number VARCHAR(64),
  po_date DATE,
  po_value NUMERIC(14,2),
  po_received_at TIMESTAMPTZ,
  work_order_no VARCHAR(64),
  work_start_date DATE,
  sla_days INT,
  target_live_date DATE,
  owner_id UUID REFERENCES users(id),
  live_date DATE,
  circuit_id VARCHAR(64),
  wan_ip VARCHAR(64),
  subnet_mask VARCHAR(45),
  gateway_ip VARCHAR(45),
  primary_dns VARCHAR(45),
  secondary_dns VARCHAR(45),
  latency_ms NUMERIC(8,2),
  packet_loss_pct NUMERIC(5,2),
  mrtg_url TEXT,
  at_signoff_date DATE,
  at_signed_by VARCHAR(128),
  live_remarks TEXT,
  billing_frequency VARCHAR(16) NOT NULL DEFAULT 'MONTHLY',
  credit_days INT NOT NULL DEFAULT 30,
  last_cycle_no INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, code)
);
CREATE INDEX IF NOT EXISTS idx_sites_tenant_status ON sites(tenant_id, status);

CREATE TABLE IF NOT EXISTS site_blockers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  site_id UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  party VARCHAR(16) NOT NULL CHECK (party IN ('VENDOR','PARTNER','CUSTOMER','AUTHORITY','OTHER')),
  reason TEXT NOT NULL,
  raised_by UUID REFERENCES users(id),
  raised_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES users(id),
  resolution TEXT
);
CREATE INDEX IF NOT EXISTS idx_blockers_open ON site_blockers(tenant_id, site_id) WHERE resolved_at IS NULL;

-- ④ BILLING
CREATE TABLE IF NOT EXISTS invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  invoice_number VARCHAR(64) NOT NULL,
  site_id UUID NOT NULL REFERENCES sites(id),
  customer_id UUID NOT NULL REFERENCES customers(id),
  invoice_type VARCHAR(16) NOT NULL CHECK (invoice_type IN ('OTC','RECURRING')),
  cycle_no INT NOT NULL DEFAULT 0,
  period_start DATE,
  period_end DATE,
  base_amount NUMERIC(14,2) NOT NULL,
  gst_pct NUMERIC(5,2) NOT NULL,
  gst_amount NUMERIC(14,2) NOT NULL,
  total_amount NUMERIC(14,2) NOT NULL,
  vendor_cost NUMERIC(14,2) NOT NULL DEFAULT 0, -- vendor cost accrued by this bill (OTC or MRC x months)
  invoice_date DATE NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'PENDING_SUBMISSION'
    CHECK (status IN ('PENDING_SUBMISSION','SUBMITTED','PARTIALLY_PAID','PAID','CANCELLED')),
  submission_mode VARCHAR(16) CHECK (submission_mode IN ('PHYSICAL','COURIER','PORTAL','EMAIL')),
  submission_date DATE,
  courier_awb VARCHAR(128),
  acknowledged_by VARCHAR(128),
  submission_remarks TEXT,
  due_date DATE,
  amount_received NUMERIC(14,2) NOT NULL DEFAULT 0,
  tds_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, invoice_number)
);
-- One live (non-cancelled) invoice per site cycle; cancelled ones can be re-issued.
CREATE UNIQUE INDEX IF NOT EXISTS uq_invoice_cycle ON invoices(site_id, invoice_type, cycle_no) WHERE status <> 'CANCELLED';
CREATE INDEX IF NOT EXISTS idx_invoices_tenant_status ON invoices(tenant_id, status, due_date);

-- ⑤ PAYMENT
CREATE TABLE IF NOT EXISTS receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  invoice_id UUID NOT NULL REFERENCES invoices(id),
  site_id UUID NOT NULL REFERENCES sites(id),
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  tds_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  received_date DATE NOT NULL,
  utr_ref VARCHAR(128) NOT NULL,
  mode VARCHAR(16) NOT NULL DEFAULT 'NEFT',
  remarks TEXT,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS waterfall_allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  receipt_id UUID NOT NULL UNIQUE REFERENCES receipts(id) ON DELETE CASCADE,
  site_id UUID NOT NULL REFERENCES sites(id),
  vendor_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  loan_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  salary_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  surplus_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS payouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  category VARCHAR(16) NOT NULL CHECK (category IN ('VENDOR','LOAN','SALARY')),
  site_id UUID REFERENCES sites(id),
  vendor_id UUID REFERENCES vendors(id),
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  paid_date DATE NOT NULL,
  reference VARCHAR(128) NOT NULL,
  period_label VARCHAR(32),
  remarks TEXT,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (category <> 'VENDOR' OR site_id IS NOT NULL)
);

-- DOCUMENTS & AUDIT
CREATE TABLE IF NOT EXISTS documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  entity_type VARCHAR(16) NOT NULL CHECK (entity_type IN ('FEASIBILITY','QUOTE','SITE','INVOICE','RECEIPT','PAYOUT')),
  entity_id UUID NOT NULL,
  doc_type VARCHAR(32) NOT NULL,
  file_name VARCHAR(255) NOT NULL,
  stored_name VARCHAR(255) NOT NULL,
  mime_type VARCHAR(128),
  size_bytes INT,
  uploaded_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_docs_entity ON documents(tenant_id, entity_type, entity_id);

CREATE TABLE IF NOT EXISTS activity_log (
  id BIGSERIAL PRIMARY KEY,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  entity_type VARCHAR(16) NOT NULL,
  entity_id UUID,
  action VARCHAR(48) NOT NULL,
  message TEXT NOT NULL,
  meta JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_activity_tenant ON activity_log(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_entity ON activity_log(entity_type, entity_id);

CREATE TABLE IF NOT EXISTS schema_migrations (
  name VARCHAR(128) PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
