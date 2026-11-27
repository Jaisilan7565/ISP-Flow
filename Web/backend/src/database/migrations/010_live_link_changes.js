/**
 * 010: running a live link after go-live.
 *  - site_revisions: bandwidth / price change on a live link, from a billing cycle onwards (history kept;
 *    bills of earlier cycles keep the earlier price, also when re-issued).
 *  - credit_notes (+ invoices.credit_amount): reduce a bill — e.g. unused days after a disconnection, or a goodwill credit.
 *    Outstanding = total − received − TDS − credited.
 *  - tenant_settings.prorate_on_disconnect: bill the last cycle by days used (default) or in full.
 *  - invoices.billed_bandwidth_mbps: bandwidth printed on that bill (so a later upgrade does not change old bills).
 *  - vendor_bills: the ISP's own bills to us, checked against the cost we expected (accrued) for that period.
 *  - site_faults: link down / restored with the ISP docket, for downtime and uptime per site and per ISP.
 *  - sites.billing_start / cycle_base / contract_start / reconnect_*: reconnect a disconnected link.
 */
module.exports = {
  up: async ({ context: { queryInterface: q, transaction } }) => {
    await q.sequelize.query(`
      CREATE TABLE IF NOT EXISTS site_revisions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        site_id UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
        from_cycle INTEGER NOT NULL CHECK (from_cycle >= 1),
        effective_from DATE NOT NULL,
        old_bandwidth_mbps INTEGER NOT NULL, new_bandwidth_mbps INTEGER NOT NULL,
        old_client_mrc NUMERIC(14,2) NOT NULL, new_client_mrc NUMERIC(14,2) NOT NULL,
        old_client_ip_mrc NUMERIC(14,2) NOT NULL, new_client_ip_mrc NUMERIC(14,2) NOT NULL,
        old_vendor_mrc NUMERIC(14,2) NOT NULL, new_vendor_mrc NUMERIC(14,2) NOT NULL,
        old_vendor_ip_mrc NUMERIC(14,2) NOT NULL, new_vendor_ip_mrc NUMERIC(14,2) NOT NULL,
        reason TEXT NOT NULL,
        po_number VARCHAR(64),
        created_by UUID REFERENCES users(id),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (site_id, from_cycle)
      );
      CREATE INDEX IF NOT EXISTS ix_site_revisions_site ON site_revisions(site_id, from_cycle);

      ALTER TABLE invoices ADD COLUMN IF NOT EXISTS credit_amount NUMERIC(14,2) NOT NULL DEFAULT 0;
      ALTER TABLE invoices ADD COLUMN IF NOT EXISTS billed_bandwidth_mbps INTEGER;
      UPDATE invoices i SET billed_bandwidth_mbps = s.bandwidth_mbps FROM sites s WHERE s.id = i.site_id AND i.billed_bandwidth_mbps IS NULL;
      CREATE TABLE IF NOT EXISTS credit_notes (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        credit_number VARCHAR(32) NOT NULL,
        invoice_id UUID NOT NULL REFERENCES invoices(id),
        site_id UUID NOT NULL REFERENCES sites(id),
        customer_id UUID NOT NULL REFERENCES customers(id),
        credit_date DATE NOT NULL,
        reason TEXT NOT NULL,
        base_amount NUMERIC(14,2) NOT NULL CHECK (base_amount > 0),
        gst_pct NUMERIC(5,2) NOT NULL,
        gst_amount NUMERIC(14,2) NOT NULL,
        total_amount NUMERIC(14,2) NOT NULL,
        vendor_cost_reduction NUMERIC(14,2) NOT NULL DEFAULT 0,
        created_by UUID REFERENCES users(id),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (tenant_id, credit_number)
      );
      CREATE INDEX IF NOT EXISTS ix_credit_notes_invoice ON credit_notes(invoice_id);

      ALTER TABLE tenant_settings ADD COLUMN IF NOT EXISTS prorate_on_disconnect BOOLEAN NOT NULL DEFAULT TRUE;

      CREATE TABLE IF NOT EXISTS vendor_bills (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        vendor_id UUID NOT NULL REFERENCES vendors(id),
        site_id UUID REFERENCES sites(id),
        bill_number VARCHAR(64) NOT NULL,
        bill_date DATE NOT NULL,
        period_from DATE NOT NULL,
        period_to DATE NOT NULL CHECK (period_to >= period_from),
        amount NUMERIC(14,2) NOT NULL CHECK (amount >= 0),
        gst_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
        expected_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
        due_date DATE,
        notes TEXT,
        created_by UUID REFERENCES users(id),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE UNIQUE INDEX IF NOT EXISTS uq_vendor_bill_no ON vendor_bills(vendor_id, lower(bill_number));

      CREATE TABLE IF NOT EXISTS site_faults (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        site_id UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
        vendor_id UUID NOT NULL REFERENCES vendors(id),
        reported_at TIMESTAMPTZ NOT NULL,
        docket_no VARCHAR(64),
        description TEXT NOT NULL,
        restored_at TIMESTAMPTZ,
        cause TEXT,
        reported_by UUID REFERENCES users(id),
        restored_by UUID REFERENCES users(id),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CHECK (restored_at IS NULL OR restored_at >= reported_at)
      );
      CREATE INDEX IF NOT EXISTS ix_site_faults_site ON site_faults(site_id, reported_at);
      CREATE UNIQUE INDEX IF NOT EXISTS uq_site_open_fault ON site_faults(site_id) WHERE restored_at IS NULL;

      -- Reconnecting a disconnected link: billing restarts from the reconnection date (the gap is not billed),
      -- cycle numbers continue (cycle_base = cycles billed before the restart), and the contract may restart.
      ALTER TABLE sites ADD COLUMN IF NOT EXISTS billing_start DATE;
      ALTER TABLE sites ADD COLUMN IF NOT EXISTS cycle_base INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE sites ADD COLUMN IF NOT EXISTS contract_start DATE;
      ALTER TABLE sites ADD COLUMN IF NOT EXISTS reconnect_charge NUMERIC(14,2) NOT NULL DEFAULT 0;
      ALTER TABLE sites ADD COLUMN IF NOT EXISTS reconnect_vendor_charge NUMERIC(14,2) NOT NULL DEFAULT 0;
      UPDATE sites SET billing_start = live_date WHERE billing_start IS NULL AND live_date IS NOT NULL;
      UPDATE sites SET contract_start = live_date WHERE contract_start IS NULL AND live_date IS NOT NULL;
      COMMENT ON COLUMN sites.billing_start IS 'Cycle (cycle_base + 1) starts here: the live date, or the last reconnection date';
      COMMENT ON COLUMN sites.contract_start IS 'Contract end = contract_start + contract_months - 1 day';
    `, { transaction });
  },
  down: async ({ context: { queryInterface: q, transaction } }) => {
    await q.sequelize.query(`
      DROP TABLE IF EXISTS site_faults; DROP TABLE IF EXISTS vendor_bills; DROP TABLE IF EXISTS credit_notes; DROP TABLE IF EXISTS site_revisions;
      ALTER TABLE invoices DROP COLUMN IF EXISTS credit_amount; ALTER TABLE invoices DROP COLUMN IF EXISTS billed_bandwidth_mbps;
      ALTER TABLE tenant_settings DROP COLUMN IF EXISTS prorate_on_disconnect;
      ALTER TABLE sites DROP COLUMN IF EXISTS billing_start, DROP COLUMN IF EXISTS cycle_base, DROP COLUMN IF EXISTS contract_start,
        DROP COLUMN IF EXISTS reconnect_charge, DROP COLUMN IF EXISTS reconnect_vendor_charge;`, { transaction });
  }
};
