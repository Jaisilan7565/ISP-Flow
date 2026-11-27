/**
 * Demo company for UAT: creates "TechGlora Telecom" with team, clients, ISPs and settings.
 * The workflow itself (order → feasibility → payment) is left EMPTY so the tester runs it end to end.
 * Idempotent. If TGT already exists it only applies upgrades (e.g. RailTel as a client), never deletes.
 *   npm run seed:demo
 */
const bcrypt = require('bcryptjs');
const { pool, tx, one } = require('../config/db');
const { run: migrate } = require('./migrate');

const PASSWORD = process.env.DEMO_PASSWORD || 'Demo@1234';

// Clients place orders (WhatsApp / email) for links at many sites. RailTel is our main client.
const CLIENTS = [
  // name, type, gstin, state, billing address, frequency, credit days, contact
  ['RailTel Corporation of India Ltd', 'PSU_GOVT', '29AABCR7176C1ZB', 'Karnataka', 'RailTel Corporation of India Ltd, Territorial Office, Bengaluru 560023', 'MONTHLY', 45, 'Suresh Kumar (RailTel SR)', '9845012345'],
  ['HDFC Bank', 'BFSI', '29AAACH2702H1Z1', 'Karnataka', 'HDFC Bank Accounts, Karnataka', 'MONTHLY', 30, null, null],
  ['Apollo Pharmacy', 'ENTERPRISE', '33AABCA1234B1Z2', 'Tamil Nadu', 'Apollo Pharmacy Accounts, Tamil Nadu', 'QUARTERLY', 30, null, null]
];
// Upstream ISPs we buy bandwidth from, and a contractor for site work (budget C %)
const VENDORS = [['Bharti Airtel', 'ISP'], ['Tata Tele', 'ISP'], ['Reliance Jio', 'ISP'], ['BSNL', 'ISP'], ['FiberLay Contractors', 'CONTRACTOR']];

const addClients = async (c, tenantId) => {
  for (const [name, type, gstin, state, addr, freq, credit, contact, phone] of CLIENTS) {
    await c.query(
      `INSERT INTO customers (tenant_id, name, client_type, gstin, state, billing_address, billing_frequency, credit_days, contact_name, contact_phone)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (tenant_id, name) DO NOTHING`,
      [tenantId, name, type, gstin, state, addr, freq, credit, contact, phone]);
  }
};

const addVendors = async (c, tenantId) => {
  for (const [name, type] of VENDORS) {
    await c.query('INSERT INTO vendors (tenant_id, name, vendor_type) VALUES ($1,$2,$3) ON CONFLICT (tenant_id, name) DO NOTHING', [tenantId, name, type]);
  }
};

/** Earlier demo data listed RailTel as an ISP. It is a client: add it as one and retire the unused ISP entry. */
const upgrade = async (tenantId) => {
  await tx(async (c) => {
    await addClients(c, tenantId);
    await addVendors(c, tenantId);
    await c.query("UPDATE customers SET client_type = 'BFSI' WHERE tenant_id = $1 AND name = 'HDFC Bank' AND client_type = 'ENTERPRISE'", [tenantId]);
    // "UDIN" was the ISP company itself (B % = its own share), not a partner: retire the sample partner if unused
    const retired = await c.query(
      `UPDATE vendors SET is_active = FALSE, updated_at = NOW() WHERE tenant_id = $1 AND name = 'UDIN Partner Co' AND is_active
         AND NOT EXISTS (SELECT 1 FROM quotes q WHERE q.partner_vendor_id = vendors.id) AND NOT EXISTS (SELECT 1 FROM payouts p WHERE p.vendor_id = vendors.id)`, [tenantId]);
    if (retired.rowCount) console.log('  sample "UDIN Partner Co" entry deactivated (UDIN = your own company)');
    const v = await c.one("SELECT id FROM vendors WHERE tenant_id = $1 AND name = 'RailTel' AND is_active", [tenantId]);
    if (v) {
      const used = await c.one(
        `SELECT EXISTS (SELECT 1 FROM feasibility_isp_options WHERE vendor_id = $1) OR EXISTS (SELECT 1 FROM quote_options WHERE vendor_id = $1)
             OR EXISTS (SELECT 1 FROM sites WHERE vendor_id = $1) OR EXISTS (SELECT 1 FROM payouts WHERE vendor_id = $1) AS used`, [v.id]);
      if (!used.used) {
        await c.query('UPDATE vendors SET is_active = FALSE, updated_at = NOW() WHERE id = $1', [v.id]);
        console.log('  RailTel ISP entry deactivated (RailTel is now a client)');
      } else {
        console.log('  RailTel ISP entry is in use by existing records — left active; review it in Masters');
      }
    }
  });
  console.log('Demo company TGT upgraded: RailTel added as a client.');
};

const seed = async () => {
  await migrate();
  const existing = await one("SELECT id FROM tenants WHERE code = 'TGT'");
  if (existing) return upgrade(existing.id);
  const hash = await bcrypt.hash(PASSWORD, 10);
  await tx(async (c) => {
    const t = await c.one(
      `INSERT INTO tenants (code, name, gstin, address, state, contact_email, contact_phone)
       VALUES ('TGT','TechGlora Telecom','29ABCDE1234F1Z5','2nd Floor, Koramangala, Bengaluru 560034','Karnataka','ops@techglora.local','9800000000') RETURNING id`
    );
    await c.query(
      `INSERT INTO tenant_settings (tenant_id, monthly_salary_burn, salary_reserve_months, loan_emi_monthly, loan_account_ref, authority_label, invoice_prefix)
       VALUES ($1, 350000, 3, 42000, 'Equipment loan A/C 8911', 'ROW / Authority', 'TGT')`, [t.id]
    );
    const users = [
      ['Company Admin', 'admin@techglora.local', 'TENANT_ADMIN', null],
      ['Priya (Commercial)', 'commercial@techglora.local', 'COMMERCIAL_MANAGER', null],
      ['Muthu', 'muthu@techglora.local', 'FIELD_ENGINEER', 'South'],
      ['Fiberwa', 'fiberwa@techglora.local', 'FIELD_ENGINEER', 'Dark fiber'],
      ['Amit / Shanker', 'amit@techglora.local', 'FIELD_ENGINEER', 'North'],
      ['Ravi (Operations)', 'ops@techglora.local', 'OPERATIONS', null],
      ['Anita (Billing)', 'billing@techglora.local', 'BILLING_EXEC', null],
      ['Kiran (Finance)', 'finance@techglora.local', 'FINANCE_HEAD', null]
    ];
    for (const [name, email, role, zone] of users) {
      await c.query('INSERT INTO users (tenant_id, name, email, role, zone, password_hash, must_change_password) VALUES ($1,$2,$3,$4,$5,$6,FALSE)', [t.id, name, email, role, zone, hash]);
    }
    await addClients(c, t.id);
    await addVendors(c, t.id);
  });
  console.log(`Demo company created. All demo users use password: ${PASSWORD}`);
};

const printLogins = async () => {
  const { rows } = await pool.query(
    `SELECT u.email, u.role FROM users u JOIN tenants t ON t.id = u.tenant_id WHERE t.code = 'TGT' AND u.is_active ORDER BY u.created_at`
  );
  const { ROLE_LABELS } = require('../constants/roles');
  console.log(`\nDemo logins (password ${PASSWORD} unless changed):`);
  for (const r of rows) console.log(`  ${r.email.padEnd(32)} ${ROLE_LABELS[r.role] || r.role}`);
};

seed()
  .then(printLogins)
  .then(() => pool.end())
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
