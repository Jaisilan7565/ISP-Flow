/**
 * END-TO-END WORKFLOW TEST
 * Platform Admin → Company → Client order (RailTel, pasted from WhatsApp by Muthu) → Feasibility → Quote
 * → Site (owned by Muthu to delivery) → Billing to the client → Payment waterfall.
 * Runs against a throw-away database (isp_flow_test), through the real HTTP API.
 * Step IDs (E2E-nn) are referenced from Tracking/01_REQUIREMENTS_MATRIX.md.
 *
 *   npm test
 */
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://postgres@localhost:5432/isp_flow_test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-not-for-production';
process.env.PLATFORM_OWNER_EMAIL = 'owner@test.local';
process.env.PLATFORM_OWNER_PASSWORD = 'Owner@12345';
process.env.UPLOAD_DIR = require('path').join(require('os').tmpdir(), 'isp-flow-test-uploads');

const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { pool } = require('../src/config/db');
const { migrate, bootstrapPlatformOwner } = require('../src/database/migrate');
const app = require('../src/app');

let server; let base;
const S = {}; // shared state across steps

const { today: bizToday, addDays: bizAddDays } = require('../src/utils/helpers');
const iso = (daysAgo) => bizAddDays(bizToday(), -daysAgo);
const fixture = (name) => fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');

const api = async (method, p, { token, body, form } = {}) => {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload;
  if (form) payload = form;
  else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const res = await fetch(`${base}/api/v1${p}`, { method, headers, body: payload });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, ...json };
};
const ok = (r, code = 200) => {
  assert.equal(r.status, code, `expected ${code}, got ${r.status}: ${r.message}`);
  return r.data;
};
const login = async (email, password) => ok(await api('POST', '/auth/login', { body: { email, password } })).token;
const upload = (token, entityType, entityId, docType, name = 'doc.pdf') => {
  const form = new FormData();
  form.append('entityType', entityType);
  form.append('entityId', entityId);
  form.append('docType', docType);
  form.append('file', new Blob(['%PDF-1.4 test'], { type: 'application/pdf' }), name);
  return api('POST', '/documents', { token, form });
};

test.before(async () => {
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await migrate();
  await bootstrapPlatformOwner();
  await new Promise((r) => { server = app.listen(0, r); });
  require('../src/realtime').init(server); // Socket.io live sync, as in server.js
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  if (server.closeAllConnections) server.closeAllConnections();
  await new Promise((r) => server.close(r));
  await pool.end();
});

test('E2E-01 Platform Admin signs in', async () => {
  S.owner = await login('owner@test.local', 'Owner@12345');
  const me = ok(await api('GET', '/auth/me', { token: S.owner }));
  assert.equal(me.role, 'PLATFORM_OWNER');
  const bad = await api('POST', '/auth/login', { body: { email: 'owner@test.local', password: 'wrong' } });
  assert.equal(bad.status, 401);
});

test('E2E-02 Platform Admin onboards an ISP company with its Company Admin', async () => {
  const r = ok(await api('POST', '/platform/tenants', { token: S.owner, body: {
    name: 'TechGlora Telecom', code: 'TGT', gstin: '29ABCDE1234F1Z5', state: 'Karnataka', address: 'Bengaluru',
    admin: { name: 'Jay Admin', email: 'admin@tgt.local', password: 'Admin@12345' }
  } }), 201);
  S.tenantId = r.tenant.id;
  S.admin = await login('admin@tgt.local', 'Admin@12345');
  const me = ok(await api('GET', '/auth/me', { token: S.admin }));
  assert.equal(me.role, 'TENANT_ADMIN');
  assert.equal(me.must_change_password, true, 'new admin must be asked to change password');
  // second company for isolation tests
  ok(await api('POST', '/platform/tenants', { token: S.owner, body: { name: 'Other ISP', code: 'OTH', admin: { name: 'Other Admin', email: 'admin@oth.local', password: 'Admin@12345' } } }), 201);
  S.otherAdmin = await login('admin@oth.local', 'Admin@12345');
  const dupe = await api('POST', '/platform/tenants', { token: S.owner, body: { name: 'Duplicate Co', code: 'TGT', admin: { name: 'Dup Admin', email: 'dup@x.local' } } });
  assert.equal(dupe.status, 409);
  // company admin cannot use platform console
  assert.equal((await api('GET', '/platform/tenants', { token: S.admin })).status, 403);
});

test('E2E-03 Suspended company cannot sign in; re-activation restores access', async () => {
  const other = ok(await api('GET', '/platform/tenants', { token: S.owner })).find((t) => t.code === 'OTH');
  ok(await api('PATCH', `/platform/tenants/${other.id}/status`, { token: S.owner, body: { status: 'SUSPENDED', reason: 'test' } }));
  assert.equal((await api('POST', '/auth/login', { body: { email: 'admin@oth.local', password: 'Admin@12345' } })).status, 403);
  assert.equal((await api('GET', '/dashboard/summary', { token: S.otherAdmin })).status, 403, 'existing token blocked immediately');
  ok(await api('PATCH', `/platform/tenants/${other.id}/status`, { token: S.owner, body: { status: 'ACTIVE' } }));
  ok(await api('GET', '/dashboard/summary', { token: S.otherAdmin }));
});

test('E2E-04 Company Admin sets up field team, clients (RailTel), ISPs and settings', async () => {
  const add = async (name, email, role, zone) => ok(await api('POST', '/admin/users', { token: S.admin, body: { name, email, role, zone, password: 'User@12345' } }), 201).user;
  S.muthu = await add('Muthu', 'muthu@tgt.local', 'FIELD_ENGINEER', 'South');
  S.amit = await add('Amit / Shanker', 'amit@tgt.local', 'FIELD_ENGINEER', 'North');
  S.commercialUser = await add('Priya Commercial', 'priya@tgt.local', 'COMMERCIAL_MANAGER');
  S.opsUser = await add('Ravi Ops', 'ravi@tgt.local', 'OPERATIONS');
  S.billingUser = await add('Anita Billing', 'anita@tgt.local', 'BILLING_EXEC');
  S.financeUser = await add('Kiran Finance', 'kiran@tgt.local', 'FINANCE_HEAD');
  assert.equal((await api('POST', '/admin/users', { token: S.admin, body: { name: 'Old', email: 'old@tgt.local', role: 'FIELD_SURVEYOR' } })).status, 400, 'old role name retired');
  S.tok = {
    muthu: await login('muthu@tgt.local', 'User@12345'),
    amit: await login('amit@tgt.local', 'User@12345'),
    commercial: await login('priya@tgt.local', 'User@12345'),
    ops: await login('ravi@tgt.local', 'User@12345'),
    billing: await login('anita@tgt.local', 'User@12345'),
    finance: await login('kiran@tgt.local', 'User@12345')
  };

  S.railtel = ok(await api('POST', '/admin/customers', { token: S.admin, body: {
    name: 'RailTel Corporation of India Ltd', clientType: 'PSU_GOVT', gstin: '29AABCR7176C1ZB', state: 'Karnataka', creditDays: 30, billingFrequency: 'MONTHLY',
    contactName: 'Suresh Kumar', contactPhone: '9845012345'
  } }), 201);
  assert.equal(S.railtel.client_type, 'PSU_GOVT');
  S.hdfc = ok(await api('POST', '/admin/customers', { token: S.admin, body: { name: 'HDFC Bank', clientType: 'BFSI', gstin: '29AAACH2702H1Z1', state: 'Karnataka', creditDays: 30, billingFrequency: 'MONTHLY' } }), 201);
  const vendor = async (name, vendorType = 'ISP') => ok(await api('POST', '/admin/vendors', { token: S.admin, body: { name, vendorType } }), 201);
  S.jio = await vendor('Reliance Jio');
  S.airtel = await vendor('Bharti Airtel');
  S.tata = await vendor('Tata Tele');
  S.contractor = await vendor('FiberLay Contractors', 'CONTRACTOR');

  const settings = { gstPct: 18, defaultContractMonths: 12, defaultCreditDays: 30, defaultSlaDays: 30, monthlySalaryBurn: 100000, salaryReserveMonths: 3, loanEmiMonthly: 20000, authorityLabel: 'ROW / Authority', invoicePrefix: 'TGT' };
  const badSplit = await api('PUT', '/admin/settings', { token: S.admin, body: { ...settings, defaultVendorPct: 50, defaultPartnerPct: 30, defaultCapexPct: 30 } });
  assert.equal(badSplit.status, 400, 'A+B+C must be 100');
  const s = ok(await api('PUT', '/admin/settings', { token: S.admin, body: { ...settings, defaultVendorPct: 55, defaultPartnerPct: 25, defaultCapexPct: 20, loanAccountRef: 'LOAN-8911', companyGstin: '29ABCDE1234F1Z5', companyState: 'Karnataka' } }));
  assert.equal(s.monthly_salary_burn, 100000);
});

test('E2E-05 Role-based access is enforced', async () => {
  assert.equal((await api('GET', '/admin/users', { token: S.tok.muthu })).status, 403, 'field engineer cannot manage users');
  assert.equal((await api('GET', '/treasury/summary', { token: S.tok.muthu })).status, 403, 'field engineer cannot see treasury');
  assert.equal((await api('POST', '/admin/customers', { token: S.tok.billing, body: { name: 'X' } })).status, 403, 'billing cannot add clients');
  assert.equal((await api('POST', '/orders', { token: S.tok.billing, body: { customerId: S.railtel.id, sites: [] } })).status, 403, 'billing cannot log orders');
  const me = ok(await api('GET', '/auth/me', { token: S.tok.finance }));
  assert.ok(me.permissions.includes('treasury.manage'));
  const fe = ok(await api('GET', '/auth/me', { token: S.tok.muthu }));
  for (const p of ['orders.create', 'feasibility.survey', 'implementation.execute']) assert.ok(fe.permissions.includes(p), `field engineer has ${p}`);
  assert.ok(!fe.permissions.includes('implementation.manage'), 'field engineer does not record POs');
});

test('E2E-06 Company data is isolated between tenants', async () => {
  const list = ok(await api('GET', '/admin/customers', { token: S.otherAdmin }));
  assert.equal(list.length, 0, 'other company must not see TGT clients');
  assert.equal((await api('PUT', `/admin/customers/${S.railtel.id}`, { token: S.otherAdmin, body: { name: 'hijack' } })).status, 404);
});

test('E2E-07 Muthu pastes a RailTel WhatsApp order for 3 sites → order + 3 site requests he owns', async () => {
  const msg = fixture('railtel-order.txt');
  const p = ok(await api('POST', '/orders/parse', { token: S.tok.muthu, body: { text: msg } }));
  assert.equal(p.clientRef, 'RTL/SR/BLR/2026/118');
  assert.equal(p.clientContactName, 'Suresh Kumar');
  assert.equal(p.sites.length, 3, 'three numbered sites read from the message');
  assert.deepEqual(p.sites.map((s) => s.siteName), ['Yesvantpur Station', 'KSR Bengaluru Station', 'Mysuru Station']);
  assert.equal(p.sites[0].clientSiteRef, 'RT-BLR-014');
  assert.equal(p.sites[0].latitude, 13.0234);
  assert.equal(p.sites[1].siteContactPhone, '9900112233');
  assert.equal(p.sites[2].bandwidthMbps, 50, 'per-site bandwidth overrides the header');
  assert.equal(p.sites[0].bandwidthMbps, 100, 'header bandwidth applied');

  // field engineer cannot hand a site to a colleague
  const handOff = await api('POST', '/orders', { token: S.tok.muthu, body: { customerId: S.railtel.id, receivedVia: 'WHATSAPP', sites: [{ ...p.sites[0], assignedTo: S.amit.id }] } });
  assert.equal(handOff.status, 403);

  const o = ok(await api('POST', '/orders', { token: S.tok.muthu, body: {
    customerId: S.railtel.id, receivedVia: 'WHATSAPP', receivedDate: iso(60), clientRef: p.clientRef, clientContactName: p.clientContactName,
    clientContactPhone: p.clientContactPhone, rawMessage: msg, sites: p.sites
  } }), 201);
  assert.match(o.code, /^ORD-\d{2}-0001$/);
  assert.equal(o.owner_name, 'Muthu', 'the engineer who pasted it owns the order');
  assert.equal(o.sites.length, 3);
  assert.ok(o.sites.every((s) => s.owner_name === 'Muthu' && s.feasibility_status === 'ASSIGNED'), 'every site assigned to Muthu');
  assert.equal(o.stages.FEASIBILITY, 3);
  S.order = o;
  const list = ok(await api('GET', `/feasibility?orderId=${o.id}`, { token: S.tok.muthu }));
  S.feas = list.find((f) => f.client_site_ref === 'RT-BLR-014');
  S.feas2 = list.find((f) => f.site_name === 'KSR Bengaluru Station');
  S.feas3 = list.find((f) => f.site_name === 'Mysuru Station');
  assert.equal(S.feas.customer_name, 'RailTel Corporation of India Ltd');
  assert.equal(S.feas.order_code, o.code);
  assert.equal(S.feas.source_channel, 'WHATSAPP');
  assert.equal(S.feas.requester_name, 'Suresh Kumar');

  // Order upload: the original WhatsApp screenshot
  ok(await upload(S.tok.muthu, 'ORDER', o.id, 'CLIENT_ORDER', 'whatsapp.jpg'), 201);
});

test('E2E-08 Single request from an email (HDFC); managers assign, engineers keep to their own sites', async () => {
  const msg = 'Need 100 Mbps ILL at HDFC Electronic City branch, 560100. Location https://www.google.com/maps/place/x/@12.8399,77.6770,17z contact 9876543210';
  const parsed = ok(await api('POST', '/feasibility/parse', { token: S.tok.commercial, body: { text: msg } }));
  assert.equal(parsed.latitude, 12.8399);
  assert.equal(parsed.bandwidthMbps, 100);
  assert.equal(parsed.pincode, '560100');
  const f = ok(await api('POST', '/feasibility', { token: S.tok.commercial, body: {
    customerId: S.hdfc.id, siteName: 'Electronic City Branch', address: 'Plot 42, Electronic City, Bengaluru', pincode: '560100',
    sourceChannel: 'EMAIL', rawMessage: msg, bandwidthMbps: 100, medium: 'FIBER', requesterName: 'Branch Manager'
  } }), 201);
  assert.equal(f.status, 'NEW', 'manager-logged request waits for assignment');
  assert.equal(f.latitude, 12.8399, 'lat parsed from message');
  const wrongOrder = await api('POST', '/feasibility', { token: S.tok.commercial, body: { customerId: S.hdfc.id, orderId: S.order.id, siteName: 'x', address: 'y', bandwidthMbps: 10 } });
  assert.equal(wrongOrder.status, 400, 'order belongs to RailTel, not HDFC');

  const bad = await api('POST', `/feasibility/${f.id}/assign`, { token: S.tok.commercial, body: { assignedTo: S.billingUser.id } });
  assert.equal(bad.status, 400, 'billing user has no survey permission');
  assert.equal((await api('POST', `/feasibility/${f.id}/assign`, { token: S.tok.muthu, body: { assignedTo: S.muthu.id } })).status, 403, 'engineers cannot assign');
  const a = ok(await api('POST', `/feasibility/${f.id}/assign`, { token: S.tok.commercial, body: { assignedTo: S.amit.id } }));
  assert.equal(a.status, 'ASSIGNED');
  assert.equal(a.assigned_name, 'Amit / Shanker');
  S.single = a;
  // engineer logging a single request owns it automatically
  const own = ok(await api('POST', '/feasibility', { token: S.tok.amit, body: { customerId: S.hdfc.id, siteName: 'HDFC Whitefield ATM', address: 'ITPL Rd', bandwidthMbps: 20, sourceChannel: 'WHATSAPP' } }), 201);
  assert.equal(own.assigned_name, 'Amit / Shanker');
  assert.equal(own.status, 'ASSIGNED');
  S.amitOwn = own;
  assert.equal((await api('PATCH', `/feasibility/${own.id}`, { token: S.tok.muthu, body: { siteName: 'Renamed site' } })).status, 403, 'cannot edit a colleague’s site');
});

test('E2E-09 Muthu records feasible ISPs with price (only on his own site)', async () => {
  const body = { nearestPopM: 420, surveyNotes: 'POP 420m', options: [
    { vendorId: S.jio.id, isFeasible: true, medium: 'FIBER', distanceM: 420, vendorOtc: 10000, vendorMrc: 8000 },
    { vendorId: S.airtel.id, isFeasible: true, medium: 'FIBER', distanceM: 900, vendorOtc: 12000, vendorMrc: 9000 },
    { vendorId: S.tata.id, isFeasible: false, remarks: 'No POP nearby' }
  ] };
  assert.equal((await api('PUT', `/feasibility/${S.feas.id}/survey`, { token: S.tok.amit, body })).status, 403, 'only the owning engineer');
  const f = ok(await api('PUT', `/feasibility/${S.feas.id}/survey`, { token: S.tok.muthu, body }));
  assert.equal(f.status, 'SURVEY_DONE');
  assert.equal(f.feasible_count, 2);
  S.feas = f;
});

test('E2E-10 Price finalized → Feasibility complete → quote auto-created', async () => {
  const jioOpt = S.feas.options.find((o) => o.vendor_id === S.jio.id);
  const tataOpt = S.feas.options.find((o) => o.vendor_id === S.tata.id);
  assert.equal((await api('POST', `/feasibility/${S.feas.id}/finalize-price`, { token: S.tok.commercial, body: { selectedOptionId: tataOpt.id, clientOtc: 1, clientMrc: 1 } })).status, 400, 'not-feasible ISP rejected');
  assert.equal((await api('POST', `/feasibility/${S.feas.id}/finalize-price`, { token: S.tok.muthu, body: { selectedOptionId: jioOpt.id, clientOtc: 20000, clientMrc: 15000 } })).status, 403, 'engineer cannot finalize price');
  const f = ok(await api('POST', `/feasibility/${S.feas.id}/finalize-price`, { token: S.tok.commercial, body: { selectedOptionId: jioOpt.id, clientOtc: 20000, clientMrc: 15000 } }));
  assert.equal(f.status, 'PRICE_FINALIZED');
  const r = ok(await api('POST', `/feasibility/${S.feas.id}/complete`, { token: S.tok.commercial }));
  assert.equal(r.feasibility.status, 'COMPLETED');
  S.quoteId = r.quoteId;
  const q = ok(await api('GET', `/quotes/${S.quoteId}`, { token: S.tok.commercial }));
  assert.equal(q.status, 'DRAFT');
  assert.equal(q.options.length, 2, 'Quote-1/2 pre-filled from the 2 feasible ISPs');
  assert.equal(q.options[0].vendor_name, 'Reliance Jio', 'Quote-1 = selected ISP');
  assert.equal(q.options[0].client_mrc, 15000);
  assert.equal(q.customer_name, 'RailTel Corporation of India Ltd');
  assert.equal(q.client_site_ref, 'RT-BLR-014');
});

test('E2E-11 STOP — a not-feasible site of the order closes and cannot continue', async () => {
  const s = ok(await api('POST', `/feasibility/${S.feas3.id}/stop`, { token: S.tok.commercial, body: { outcome: 'NOT_FEASIBLE', reason: 'No ISP within 5 km of Mysuru station' } }));
  assert.equal(s.status, 'NOT_FEASIBLE');
  assert.equal((await api('PUT', `/feasibility/${S.feas3.id}/survey`, { token: S.tok.muthu, body: { options: [{ vendorId: S.jio.id, isFeasible: true, vendorMrc: 1 }] } })).status, 409);
  assert.equal((await api('POST', `/feasibility/${S.feas2.id}/stop`, { token: S.tok.muthu, body: { outcome: 'CANCELLED', reason: 'x test' } })).status, 403, 'engineer cannot stop');
  // maps-only request still parses coordinates from the link
  const m = ok(await api('POST', '/feasibility', { token: S.tok.commercial, body: { customerId: S.hdfc.id, siteName: 'Remote ATM', address: 'Hill road', bandwidthMbps: 10, sourceChannel: 'MAPS', mapsUrl: 'https://maps.google.com/?q=13.1,77.5', assignedTo: S.muthu.id } }), 201);
  assert.equal(m.latitude, 13.1);
  ok(await api('POST', `/feasibility/${m.id}/stop`, { token: S.tok.commercial, body: { outcome: 'CANCELLED', reason: 'Client withdrew' } }));
});

test('E2E-12 Quote-1/2/3 edited with margins', async () => {
  const q = ok(await api('PUT', `/quotes/${S.quoteId}/options`, { token: S.tok.commercial, body: { contractMonths: 12, options: [
    { optionNo: 1, vendorId: S.jio.id, vendorOtc: 10000, vendorMrc: 8000, clientOtc: 20000, clientMrc: 15000, slaPct: 99.5 },
    { optionNo: 2, vendorId: S.airtel.id, vendorOtc: 12000, vendorMrc: 9000, clientOtc: 20000, clientMrc: 16000, slaPct: 99.9 },
    { optionNo: 3, vendorId: S.tata.id, vendorOtc: 15000, vendorMrc: 11000, clientOtc: 25000, clientMrc: 18000 }
  ] } }));
  assert.equal(q.options.length, 3);
  assert.equal(q.options[0].client_total, 200000); // 20000 + 15000*12
  assert.equal(q.options[0].margin, 94000);        // 200000 - (10000 + 8000*12)
  assert.equal((await api('PUT', `/quotes/${S.quoteId}/options`, { token: S.tok.ops, body: { contractMonths: 12, options: [] } })).status, 403, 'ops cannot edit quotes');
});

test('E2E-13 Bid Win → finalized value, A/B/C budget, site created and owned by Muthu', async () => {
  assert.equal((await api('POST', `/quotes/${S.quoteId}/bid-win`, { token: S.tok.commercial, body: { optionNo: 1, vendorPct: 55, partnerPct: 25, capexPct: 20 } })).status, 409, 'must send before win');
  ok(await api('POST', `/quotes/${S.quoteId}/send`, { token: S.tok.commercial }));
  assert.equal((await api('POST', `/quotes/${S.quoteId}/bid-win`, { token: S.tok.commercial, body: { optionNo: 1, vendorPct: 50, partnerPct: 25, capexPct: 20 } })).status, 400, 'A+B+C=100');
  const r = ok(await api('POST', `/quotes/${S.quoteId}/bid-win`, { token: S.tok.commercial, body: { optionNo: 1, vendorPct: 55, partnerPct: 25, capexPct: 20 } }));
  assert.equal(r.quote.status, 'WON');
  assert.equal(r.quote.finalized_value, 200000);
  assert.equal(r.quote.vendor_amount, 110000);
  assert.equal(r.quote.partner_amount, 50000, 'B % = the company’s own share');
  assert.equal(r.quote.capex_amount, 40000);
  S.siteId = r.siteId;
  const site = ok(await api('GET', `/sites/${S.siteId}`, { token: S.tok.ops }));
  assert.equal(site.status, 'AWAITING_PO');
  assert.equal(site.vendor_name, 'Reliance Jio');
  assert.equal(site.customer_name, 'RailTel Corporation of India Ltd');
  assert.equal(site.client_mrc, 15000);
  assert.equal(site.owner_name, 'Muthu', 'the engineer from feasibility carries on to delivery');
  assert.equal(site.client_site_ref, 'RT-BLR-014');
  assert.equal(site.order_code, S.order.code);

  // Second RailTel site goes through quickly so one PO can cover both
  const sv = ok(await api('PUT', `/feasibility/${S.feas2.id}/survey`, { token: S.tok.muthu, body: { options: [{ vendorId: S.airtel.id, isFeasible: true, vendorOtc: 8000, vendorMrc: 7000 }] } }));
  ok(await api('POST', `/feasibility/${S.feas2.id}/finalize-price`, { token: S.tok.commercial, body: { selectedOptionId: sv.options[0].id, clientOtc: 15000, clientMrc: 12000 } }));
  const c2 = ok(await api('POST', `/feasibility/${S.feas2.id}/complete`, { token: S.tok.commercial }));
  ok(await api('POST', `/quotes/${c2.quoteId}/send`, { token: S.tok.commercial }));
  S.site2Id = ok(await api('POST', `/quotes/${c2.quoteId}/bid-win`, { token: S.tok.commercial, body: { optionNo: 1, vendorPct: 55, partnerPct: 25, capexPct: 20 } })).siteId;
});

test('E2E-14 One RailTel PO for two sites; PO copy uploaded', async () => {
  assert.equal((await api('POST', `/sites/${S.siteId}/live`, { token: S.tok.muthu, body: { liveDate: iso(0), circuitId: 'X', wanIp: '1.1.1.1', atSignoffDate: iso(0), atSignedBy: 'x' } })).status, 409, 'cannot go live before PO');
  assert.equal((await api('POST', `/sites/${S.siteId}/po`, { token: S.tok.billing, body: { poNumber: 'PO-1', poDate: iso(55), poValue: 200000 } })).status, 403, 'billing cannot record PO');
  assert.equal((await api('POST', '/sites/po-bulk', { token: S.tok.muthu, body: { poNumber: 'PO-1', poDate: iso(55), items: [{ siteId: S.siteId, poValue: 1 }] } })).status, 403, 'engineer does not record POs');
  const dup = await api('POST', '/sites/po-bulk', { token: S.tok.ops, body: { poNumber: 'X', poDate: iso(55), items: [{ siteId: S.siteId, poValue: 1 }, { siteId: S.siteId, poValue: 2 }] } });
  assert.equal(dup.status, 400, 'site listed twice');
  const r = ok(await api('POST', '/sites/po-bulk', { token: S.tok.ops, body: { poNumber: 'RTL/PO/2026/8941', poDate: iso(55), items: [{ siteId: S.siteId, poValue: 200000 }, { siteId: S.site2Id, poValue: 159000 }] } }));
  assert.equal(r.sites, 2);
  assert.equal(r.total, 359000);
  const s = ok(await api('GET', `/sites/${S.siteId}`, { token: S.tok.ops }));
  assert.equal(s.status, 'PO_RECEIVED');
  assert.equal(s.po_number, 'RTL/PO/2026/8941');
  ok(await upload(S.tok.ops, 'SITE', S.siteId, 'PO_COPY', 'po.pdf'), 201);
  const docs = ok(await api('GET', `/documents?entityType=SITE&entityId=${S.siteId}`, { token: S.tok.ops }));
  assert.equal(docs.length, 1);
  const bad = await upload(S.otherAdmin, 'SITE', S.siteId, 'PO_COPY');
  assert.equal(bad.status, 404, 'other company cannot attach to our site');
});

test('E2E-15 Muthu starts ISP work on his site with SLA target', async () => {
  const body = { workOrderNo: 'WO-JIO-001', workStartDate: iso(50), slaDays: 30, ownerId: S.amit.id };
  assert.equal((await api('POST', `/sites/${S.siteId}/work-start`, { token: S.tok.amit, body })).status, 403, 'not Amit’s site');
  const s = ok(await api('POST', `/sites/${S.siteId}/work-start`, { token: S.tok.muthu, body }));
  assert.equal(s.status, 'WORK_STARTED');
  assert.equal(s.owner_name, 'Muthu', 'an engineer cannot hand the site over by changing owner');
  assert.equal(s.target_live_date, iso(20));
  assert.equal(s.sla_overdue, true, 'started 50 days ago with 30-day SLA → overdue');
});

test('E2E-16 Pending with Client (RailTel) / Customer — blocks go-live until resolved', async () => {
  let s = ok(await api('POST', `/sites/${S.siteId}/blockers`, { token: S.tok.muthu, body: { party: 'CLIENT', reason: 'RailTel approval for rack space at station' } }));
  assert.equal(s.status, 'BLOCKED');
  s = ok(await api('POST', `/sites/${S.siteId}/blockers`, { token: S.tok.muthu, body: { party: 'CUSTOMER', reason: 'Station master: power point not ready' } }));
  assert.equal(s.open_blockers, 2);
  // "Pending with UDIN" in the sketch = pending with our own company (internal), shown by the company name
  s = ok(await api('POST', `/sites/${S.siteId}/blockers`, { token: S.tok.muthu, body: { party: 'COMPANY', reason: 'Our CPE router not yet issued from store' } }));
  assert.equal(s.open_blockers, 3);
  assert.equal((await api('POST', `/sites/${S.siteId}/blockers`, { token: S.tok.muthu, body: { party: 'PARTNER', reason: 'old party code' } })).status, 400, 'partner party retired');
  const log = ok(await api('GET', `/admin/activity?entityId=${S.siteId}`, { token: S.admin }));
  assert.ok(log.some((a) => /pending with RailTel Corporation of India Ltd \(client\)/.test(a.message)), 'activity names the client');
  assert.ok(log.some((a) => /pending with TechGlora Telecom \(internal\)/.test(a.message)), 'activity names our own company');
  const d = ok(await api('GET', '/dashboard/summary', { token: S.tok.ops }));
  assert.ok(d.alerts.some((a) => a.title === 'Pending with' && a.detail.startsWith('RailTel Corporation of India Ltd:')), 'dashboard shows client name');
  assert.ok(d.alerts.some((a) => a.title === 'Pending with' && a.detail.startsWith('TechGlora Telecom (internal):')), 'dashboard shows own company');
  const live = await api('POST', `/sites/${S.siteId}/live`, { token: S.tok.muthu, body: { liveDate: iso(40), circuitId: 'X', wanIp: '1.1.1.1', atSignoffDate: iso(40), atSignedBy: 'x' } });
  assert.equal(live.status, 409, 'cannot go live while blocked');
  assert.equal((await api('POST', `/sites/${S.siteId}/blockers/${s.blockers[0].id}/resolve`, { token: S.tok.amit, body: { resolution: 'Cleared' } })).status, 403);
  for (const b of s.blockers) {
    s = ok(await api('POST', `/sites/${S.siteId}/blockers/${b.id}/resolve`, { token: S.tok.muthu, body: { resolution: 'Cleared' } }));
  }
  assert.equal(s.status, 'WORK_STARTED');
  assert.equal(s.blockers.length, 3, 'history kept');
});

test('E2E-17 Muthu marks the site live → one 1st bill (OTC + 1st cycle MRC) to RailTel automatically', async () => {
  const r = ok(await api('POST', `/sites/${S.siteId}/live`, { token: S.tok.muthu, body: {
    liveDate: iso(40), circuitId: 'JIO/BLR/ILL/7781', wanIp: '103.24.120.45/30', gatewayIp: '103.24.120.46', latencyMs: 8.4, packetLossPct: 0,
    atSignoffDate: iso(40), atSignedBy: 'RailTel SR – Suresh'
  } }));
  assert.equal(r.site.status, 'LIVE');
  assert.equal(r.invoices.length, 1, 'one first bill, not a separate OTC bill');
  ok(await upload(S.tok.muthu, 'SITE', S.siteId, 'AT_SIGNOFF', 'at.pdf'), 201);
  const inv = ok(await api('GET', `/invoices?siteId=${S.siteId}`, { token: S.tok.billing }));
  assert.equal(inv.length, 1);
  S.c1 = inv[0];
  assert.equal(S.c1.invoice_type, 'RECURRING');
  assert.equal(S.c1.cycle_no, 1);
  assert.equal(S.c1.label, 'Cycle 1 + OTC');
  assert.equal(S.c1.customer_name, 'RailTel Corporation of India Ltd', 'billed to the client');
  assert.equal(S.c1.client_site_ref, 'RT-BLR-014', 'client site id on the bill');
  assert.equal(S.c1.po_number, 'RTL/PO/2026/8941');
  assert.equal(S.c1.medium, 'FIBER', 'the link medium from the order is printed on the bill');
  assert.equal(S.c1.otc_amount, 20000);
  assert.equal(S.c1.base_amount, 20000 + 15000, 'OTC + 1st month MRC');
  assert.equal(S.c1.gst_amount, 6300);
  assert.equal(S.c1.total_amount, 41300);
  assert.equal(S.c1.vendor_cost, 10000 + 8000, 'ISP OTC + 1st month ISP MRC');
  assert.equal(S.c1.period_start, iso(40));
  assert.match(S.c1.invoice_number, /^TGT\/\d{2}-\d{2}\/0001$/);
  assert.equal(ok(await api('GET', `/invoices?customerId=${S.hdfc.id}`, { token: S.tok.billing })).length, 0, 'client filter');
});

test('E2E-18 Billing scheduler creates the 2nd cycle', async () => {
  const created = ok(await api('POST', '/invoices/run-billing', { token: S.tok.billing }));
  assert.equal(created.length, 1, 'only cycle 2 has started (live 40 days ago)');
  assert.equal(created[0].cycle_no, 2);
  S.c2 = created[0];
  assert.equal(S.c2.total_amount, 17700, 'later cycles are MRC only');
  const again = ok(await api('POST', '/invoices/run-billing', { token: S.tok.billing }));
  assert.equal(again.length, 0, 'idempotent');
});

test('E2E-19 Bill submission with date, mode and proof → due date computed', async () => {
  const noAwb = await api('POST', `/invoices/${S.c1.id}/submission`, { token: S.tok.billing, body: { submissionMode: 'COURIER', submissionDate: iso(38) } });
  assert.equal(noAwb.status, 400, 'courier needs AWB');
  const pay = await api('POST', '/treasury/receipts', { token: S.tok.finance, body: { invoiceId: S.c1.id, amount: 100, receivedDate: iso(1), utrRef: 'UTR-EARLY' } });
  assert.equal(pay.status, 409, 'payment before bill submission rejected');
  const i = ok(await api('POST', `/invoices/${S.c1.id}/submission`, { token: S.tok.billing, body: { submissionMode: 'PHYSICAL', submissionDate: iso(38), acknowledgedBy: 'RailTel Accounts – stamp' } }));
  assert.equal(i.status, 'SUBMITTED');
  assert.equal(i.due_date, iso(8));
  ok(await upload(S.tok.billing, 'INVOICE', S.c1.id, 'SUBMISSION_PROOF', 'stamped.jpg'), 201);

});

test('E2E-20 Sitewise payment → Vendor → Loan → Salary(3 months) waterfall, then payouts', async () => {
  // Site vendor cost accrued = ISP OTC 10,000 + C1 8,000 + C2 8,000 = 26,000
  // 1st bill (41,300): 41,000 + TDS 300. Vendor 26,000 → loan 15,000 (EMI 20,000; nothing yet this month) → salary 0
  const r1 = ok(await api('POST', '/treasury/receipts', { token: S.tok.finance, body: { invoiceId: S.c1.id, amount: 41000, tdsAmount: 300, receivedDate: iso(0), utrRef: 'RTLR0001' } }), 201);
  assert.equal(r1.invoiceStatus, 'PAID');
  assert.deepEqual([r1.allocation.vendor_amount, r1.allocation.loan_amount, r1.allocation.salary_amount, r1.allocation.surplus_amount], [26000, 15000, 0, 0]);

  const dupe = await api('POST', '/treasury/receipts', { token: S.tok.finance, body: { invoiceId: S.c2.id, amount: 1, receivedDate: iso(0), utrRef: 'RTLR0001' } });
  assert.equal(dupe.status, 409);

  // C2 partial payment: 10,000 → vendor 0, loan 5,000 (completes EMI), salary 5,000
  ok(await api('POST', `/invoices/${S.c2.id}/submission`, { token: S.tok.billing, body: { submissionMode: 'EMAIL', submissionDate: iso(0) } }));
  const r3 = ok(await api('POST', '/treasury/receipts', { token: S.tok.finance, body: { invoiceId: S.c2.id, amount: 10000, receivedDate: iso(0), utrRef: 'RTLR0003' } }), 201);
  assert.equal(r3.invoiceStatus, 'PARTIALLY_PAID');
  assert.deepEqual([r3.allocation.vendor_amount, r3.allocation.loan_amount, r3.allocation.salary_amount, r3.allocation.surplus_amount], [0, 5000, 5000, 0]);
  const over = await api('POST', '/treasury/receipts', { token: S.tok.finance, body: { invoiceId: S.c2.id, amount: 99999, receivedDate: iso(0), utrRef: 'RTLR0004' } });
  assert.equal(over.status, 400, 'cannot exceed outstanding');

  // Payouts
  ok(await api('POST', '/treasury/payouts', { token: S.tok.finance, body: { category: 'VENDOR', siteId: S.siteId, amount: 18000, paidDate: iso(0), reference: 'AXIS-VP-01' } }), 201);
  assert.equal((await api('POST', '/treasury/payouts', { token: S.tok.finance, body: { category: 'VENDOR', siteId: S.siteId, amount: 9000, paidDate: iso(0), reference: 'AXIS-VP-02' } })).status, 400, 'cannot overpay vendor (8,000 left)');
  ok(await api('POST', '/treasury/payouts', { token: S.tok.finance, body: { category: 'LOAN', amount: 20000, paidDate: iso(0), reference: 'EMI-NOV', periodLabel: 'Nov 2026' } }), 201);
  assert.equal((await api('POST', '/treasury/payouts', { token: S.tok.finance, body: { category: 'SALARY', amount: 6000, paidDate: iso(0), reference: 'SAL-1' } })).status, 400, 'reserve only 5,000');
  ok(await api('POST', '/treasury/payouts', { token: S.tok.finance, body: { category: 'SALARY', amount: 5000, paidDate: iso(0), reference: 'SAL-NOV', periodLabel: 'Nov 2026' } }), 201);
  assert.equal((await api('POST', '/treasury/payouts', { token: S.tok.billing, body: { category: 'LOAN', amount: 1, paidDate: iso(0), reference: 'x123' } })).status, 403, 'billing cannot pay out');
});

test('E2E-21 Treasury & dashboard reflect the whole chain', async () => {
  const t = ok(await api('GET', '/treasury/summary', { token: S.tok.finance }));
  assert.equal(t.pools.vendor_pool, 26000 - 18000);
  assert.equal(t.pools.loan_pool, 0);
  assert.equal(t.pools.salary_reserve, 0);
  assert.equal(t.salary_target, 300000);
  const site = t.site_payables.find((p) => p.site_id === S.siteId);
  assert.equal(site.accrued, 26000);
  assert.equal(site.paid, 18000);
  assert.equal(site.outstanding, 8000);

  const d = ok(await api('GET', '/dashboard/summary', { token: S.admin }));
  assert.equal(d.pipeline.feasibility.COMPLETED, 2);
  assert.equal(d.pipeline.feasibility.NOT_FEASIBLE, 1);
  assert.equal(d.pipeline.quotes.WON, 2);
  assert.equal(d.pipeline.sites.LIVE, 1);
  assert.equal(d.pipeline.sites.PO_RECEIVED, 1);
  assert.equal(d.pipeline.invoices.PAID, 1);
  assert.equal(d.pipeline.invoices.PARTIALLY_PAID, 1);
  assert.equal(d.money.collected, 51000);
  assert.equal(d.setup.orders, 1);
  assert.ok(!d.alerts.some((a) => a.title === 'PO copy not uploaded' && a.id === S.siteId), 'PO copy present');
  assert.ok(!d.alerts.some((a) => a.title === 'AT sign-off document not uploaded'), 'AT doc present');
});

test('E2E-22 Site 360 shows order → feasibility → quote → site → invoices → receipts → payouts with timeline', async () => {
  const l = ok(await api('GET', `/dashboard/lifecycle/${S.feas.id}`, { token: S.admin }));
  assert.equal(l.stage, 'PAYMENT');
  assert.equal(l.feasibility.code, S.feas.code);
  assert.equal(l.feasibility.order_code, S.order.code);
  assert.equal(l.quote.status, 'WON');
  assert.equal(l.site.status, 'LIVE');
  assert.equal(l.site.owner_name, 'Muthu');
  assert.equal(l.invoices.length, 2, '1st bill (OTC + C1) + C2');
  assert.equal(l.receipts.length, 2);
  assert.equal(l.payouts.length, 1);
  assert.equal(l.documents.length, 4, 'order screenshot + PO + AT + stamped bill');
  const actions = l.timeline.map((a) => a.action);
  for (const a of ['ORDER_CREATED', 'FEAS_CREATED', 'FEAS_SURVEYED', 'FEAS_PRICE_FINALIZED', 'FEAS_COMPLETED', 'QUOTE_SENT', 'QUOTE_WON', 'SITE_PO_RECEIVED', 'SITE_WORK_STARTED', 'SITE_BLOCKED', 'SITE_UNBLOCKED', 'SITE_LIVE', 'INVOICE_GENERATED', 'INVOICE_SUBMITTED', 'PAYMENT_RECEIVED', 'WATERFALL_SPLIT', 'PAYOUT_VENDOR']) {
    assert.ok(actions.includes(a), `timeline has ${a}`);
  }
  const bySite = ok(await api('GET', `/dashboard/lifecycle/${S.siteId}`, { token: S.admin }));
  assert.equal(bySite.feasibility.id, S.feas.id);
  const search = ok(await api('GET', '/dashboard/search?q=8941', { token: S.admin }));
  assert.ok(search.some((r) => r.module === 'implementation'), 'search by PO number');
  const byRef = ok(await api('GET', '/dashboard/search?q=RT-BLR-014', { token: S.admin }));
  assert.ok(byRef.some((r) => r.module === 'feasibility') && byRef.some((r) => r.module === 'implementation'), 'search by client site id');
  const byOrder = ok(await api('GET', '/dashboard/search?q=RTL/SR', { token: S.admin }));
  assert.ok(byOrder.some((r) => r.module === 'orders'), 'search by client order ref');
});

test('E2E-23 Cancel & re-issue an unpaid bill; validation errors are clear', async () => {
  const fresh = ok(await api('POST', `/invoices/sites/${S.siteId}/next-cycle`, { token: S.tok.billing }), 201);
  assert.equal(fresh.cycle_no, 3);
  const r = ok(await api('POST', `/invoices/${fresh.id}/cancel`, { token: S.tok.billing, body: { reason: 'Wrong period' } }));
  assert.equal(r.cancelled.status, 'CANCELLED');
  assert.equal(r.replacement.cycle_no, 3);
  // raised in advance: dated today (not the future period start), so it can be submitted today
  const adv = ok(await api('GET', `/invoices/${r.replacement.id}`, { token: S.tok.billing }));
  assert.ok(adv.period_start > iso(0), 'cycle 3 period starts in the future');
  assert.equal(adv.invoice_date, iso(0), 'advance bill dated the day it is raised');
  assert.equal(adv.days_since_invoice, 0);
  ok(await api('POST', `/invoices/${adv.id}/submission`, { token: S.tok.billing, body: { submissionMode: 'EMAIL', submissionDate: iso(0) } }));
  assert.equal((await api('POST', `/invoices/${S.c1.id}/cancel`, { token: S.tok.billing, body: { reason: 'x', reissue: false } })).status, 400, 'reason min length');
  assert.equal((await api('POST', `/invoices/${S.c1.id}/cancel`, { token: S.tok.billing, body: { reason: 'paid one' } })).status, 409, 'paid invoice cannot be cancelled');
  const v = await api('POST', '/feasibility', { token: S.tok.commercial, body: { siteName: 'x' } });
  assert.equal(v.status, 400);
  assert.ok(Array.isArray(v.errors) && v.errors.some((e) => e.field === 'customerId'));
});

test('E2E-24 Order tracker and client overview follow every site to delivery and billing', async () => {
  const o = ok(await api('GET', `/orders/${S.order.id}`, { token: S.admin }));
  assert.deepEqual([o.stages.LIVE, o.stages.DELIVERY, o.stages.STOPPED, o.stages.FEASIBILITY], [1, 1, 1, 0]);
  const live = o.sites.find((s) => s.stage === 'LIVE');
  assert.equal(live.client_site_ref, 'RT-BLR-014');
  assert.equal(live.billed, 41300 + 17700 + 17700, '1st bill (OTC + C1) + C2 + C3 (cancelled one excluded)');
  assert.equal(o.money.received, 51000);
  assert.equal(o.money.live_mrc, 15000);
  // field engineer sees progress but not money
  const fe = ok(await api('GET', `/orders/${S.order.id}`, { token: S.tok.muthu }));
  assert.equal(fe.money, null);
  assert.equal(fe.sites[0].billed, undefined);
  assert.equal(fe.sites[0].finalized_value, undefined);
  // client sends 1 more site later → added to the same order
  const more = ok(await api('POST', `/orders/${S.order.id}/sites`, { token: S.tok.muthu, body: { sites: [{ siteName: 'Tumakuru Station', address: 'Station Rd, Tumakuru 572101', bandwidthMbps: 100, clientSiteRef: 'RT-TMK-003' }] } }));
  assert.equal(more.sites.length, 4);
  assert.equal(more.stages.FEASIBILITY, 1);
  assert.equal((await api('POST', `/orders/${S.order.id}/sites`, { token: S.tok.amit, body: { sites: [{ siteName: 'Extra site', address: 'Somewhere', bandwidthMbps: 1 }] } })).status, 403, 'not Amit’s order');

  const list = ok(await api('GET', '/orders', { token: S.tok.muthu, body: undefined }));
  assert.equal(list.length, 1);
  assert.equal(list[0].site_count, 4);
  assert.equal(ok(await api('GET', '/orders?mine=1', { token: S.tok.amit })).length, 0);

  const clients = ok(await api('GET', '/clients', { token: S.admin }));
  const rt = clients.find((c) => c.id === S.railtel.id);
  assert.equal(rt.order_count, 1);
  assert.equal(rt.site_count, 4);
  assert.equal(rt.stages.LIVE, 1);
  const c = ok(await api('GET', `/clients/${S.railtel.id}`, { token: S.tok.finance }));
  assert.equal(c.orders.length, 1);
  assert.equal(c.sites.length, 4);
  assert.equal(c.money.outstanding, 17700 + 7700, 'C2 balance (17,700 − 10,000) + reissued C3');
  assert.equal(c.money.overdue_count, 0, 'C2 was submitted today, so it is not yet due');
});

test('E2E-25 Field team workload, “my work”, and reassigning a site to another engineer', async () => {
  const w = ok(await api('GET', '/admin/team/workload', { token: S.tok.ops }));
  const muthu = w.find((u) => u.id === S.muthu.id);
  assert.equal(muthu.delivered, 1);
  assert.equal(muthu.sites_in_delivery, 1, 'site 2 (PO received)');
  assert.equal(muthu.surveys_open, 1, 'Tumakuru added later');
  assert.equal((await api('GET', '/admin/team/workload', { token: S.tok.muthu })).status, 403);

  const mine = ok(await api('GET', '/dashboard/summary', { token: S.tok.muthu })).mine;
  assert.equal(mine.delivered, 1);
  assert.equal(mine.ready_to_start, 1);
  assert.equal(mine.survey_pending, 1);
  assert.equal(ok(await api('GET', '/sites?mine=1', { token: S.tok.muthu })).length, 2);

  assert.equal((await api('POST', `/sites/${S.site2Id}/owner`, { token: S.tok.muthu, body: { ownerId: S.amit.id } })).status, 403, 'engineer cannot reassign');
  assert.equal((await api('POST', `/sites/${S.site2Id}/owner`, { token: S.tok.ops, body: { ownerId: S.billingUser.id } })).status, 400, 'owner must be able to deliver');
  const s = ok(await api('POST', `/sites/${S.site2Id}/owner`, { token: S.tok.ops, body: { ownerId: S.amit.id } }));
  assert.equal(s.owner_name, 'Amit / Shanker');
  assert.equal((await api('POST', `/sites/${S.site2Id}/work-start`, { token: S.tok.muthu, body: { workOrderNo: 'WO-2', workStartDate: iso(1), slaDays: 21 } })).status, 403, 'no longer Muthu’s');
  const st = ok(await api('POST', `/sites/${S.site2Id}/work-start`, { token: S.tok.amit, body: { workOrderNo: 'WO-AIR-2', workStartDate: iso(1), slaDays: 21 } }));
  assert.equal(st.status, 'WORK_STARTED');
  assert.equal(st.owner_name, 'Amit / Shanker');
  assert.equal((await api('POST', `/sites/${S.siteId}/owner`, { token: S.tok.ops, body: { ownerId: S.amit.id } })).status, 409, 'live site owner is final');
});

test('E2E-26 Platform Admin edits an onboarded company and its admin login', async () => {
  const other = ok(await api('GET', '/platform/tenants', { token: S.owner })).find((t) => t.code === 'OTH');
  const t = ok(await api('PATCH', `/platform/tenants/${other.id}`, { token: S.owner, body: {
    name: 'Other ISP Pvt Ltd', code: 'oth2', gstin: '29zzzzz9999z1z5', state: 'Karnataka', address: 'Mysuru', contactPhone: '9800011111',
    admin: { name: 'Other Admin (new)', email: 'Boss@OTH.local', phone: '9811122222' }
  } }));
  assert.equal(t.name, 'Other ISP Pvt Ltd');
  assert.equal(t.code, 'OTH2', 'code is upper-cased');
  assert.equal(t.gstin, '29ZZZZZ9999Z1Z5');
  assert.equal(t.admin.email, 'boss@oth.local');
  assert.equal(t.admin.phone, '9811122222');
  // admin signs in with the new email and the same password; old email no longer works
  assert.equal((await api('POST', '/auth/login', { body: { email: 'admin@oth.local', password: 'Admin@12345' } })).status, 401);
  const tok = await login('boss@oth.local', 'Admin@12345');
  assert.equal(ok(await api('GET', '/auth/me', { token: tok })).tenant_name, 'Other ISP Pvt Ltd');
  // an optional field can be cleared; sending the same values changes nothing
  assert.equal(ok(await api('PATCH', `/platform/tenants/${other.id}`, { token: S.owner, body: { contactPhone: '' } })).contact_phone, null);
  assert.equal((await api('PATCH', `/platform/tenants/${other.id}`, { token: S.owner, body: { name: 'Other ISP Pvt Ltd' } })).message, 'Nothing changed');
  // refused: duplicate code, an email another user has, empty body, bad code, unknown company, company admin
  assert.equal((await api('PATCH', `/platform/tenants/${other.id}`, { token: S.owner, body: { code: 'TGT' } })).status, 409);
  assert.equal((await api('PATCH', `/platform/tenants/${other.id}`, { token: S.owner, body: { admin: { email: 'muthu@tgt.local' } } })).status, 409);
  assert.equal((await api('PATCH', `/platform/tenants/${other.id}`, { token: S.owner, body: {} })).status, 400);
  assert.equal((await api('PATCH', `/platform/tenants/${other.id}`, { token: S.owner, body: { code: 'A' } })).status, 400);
  assert.equal((await api('PATCH', '/platform/tenants/00000000-0000-0000-0000-000000000000', { token: S.owner, body: { name: 'Ghost' } })).status, 404);
  assert.equal((await api('PATCH', `/platform/tenants/${other.id}`, { token: S.admin, body: { name: 'Hijack' } })).status, 403);
  // the change is in the platform activity
  const log = ok(await api('GET', '/platform/activity', { token: S.owner }));
  assert.ok(log.some((a) => a.action === 'TENANT_UPDATED' && /code, GSTIN.*admin email/.test(a.message)), 'edit is logged with the fields changed');
});

test('E2E-27 API validation: bad input is refused with a message per field', async () => {
  const fields = (r) => (r.errors || []).map((e) => e.field).sort();
  // client with a bad GSTIN, phone, email and a one-letter name
  let r = await api('POST', '/admin/customers', { token: S.admin, body: { name: 'X', gstin: '29ABC', contactPhone: '123', contactEmail: 'not-an-email', creditDays: 30 } });
  assert.equal(r.status, 400);
  assert.deepEqual(fields(r), ['contactEmail', 'contactPhone', 'gstin', 'name']);
  assert.match(r.errors.find((e) => e.field === 'gstin').message, /15-character GSTIN/);
  // user with a weak password
  r = await api('POST', '/admin/users', { token: S.admin, body: { name: 'New Person', email: 'new@tgt.local', role: 'FIELD_ENGINEER', password: 'password' } });
  assert.equal(r.status, 400);
  assert.deepEqual(fields(r), ['password']);
  // order site with a bad pincode, bad maps link and zero bandwidth
  r = await api('POST', '/orders', { token: S.tok.muthu, body: { customerId: S.railtel.id, sites: [{ siteName: 'Test site', address: 'Somewhere', pincode: '0123', mapsUrl: 'maps.google.com', bandwidthMbps: 0 }] } });
  assert.equal(r.status, 400);
  assert.deepEqual(fields(r), ['sites.0.bandwidthMbps', 'sites.0.mapsUrl', 'sites.0.pincode']);
  // settings: invoice prefix with a dash, GST above 40, budget not 100
  r = await api('PUT', '/admin/settings', { token: S.admin, body: { gstPct: 50, defaultVendorPct: 55, defaultPartnerPct: 25, defaultCapexPct: 20, defaultContractMonths: 12, defaultCreditDays: 30, defaultSlaDays: 30, monthlySalaryBurn: 1, salaryReserveMonths: 3, loanEmiMonthly: 0, authorityLabel: 'ROW', invoicePrefix: 'TG-T' } });
  assert.equal(r.status, 400);
  assert.deepEqual(fields(r), ['gstPct', 'invoicePrefix']);
  // site live details: bad WAN IP and gateway, future AT date (validation runs before any state check)
  const tomorrow = bizAddDays(bizToday(), 1);
  r = await api('POST', `/sites/${S.site2Id}/live`, { token: S.tok.amit, body: { liveDate: iso(0), circuitId: 'C1', wanIp: '999.1.1.1', gatewayIp: '10.0.0.1/30', atSignoffDate: tomorrow, atSignedBy: 'Client engineer' } });
  assert.equal(r.status, 400);
  assert.deepEqual(fields(r), ['atSignoffDate', 'gatewayIp', 'wanIp']);
  // survey: a not-feasible ISP needs a reason
  r = await api('PUT', `/feasibility/${S.amitOwn.id}/survey`, { token: S.tok.amit, body: { options: [{ vendorId: S.jio.id, isFeasible: false }] } });
  assert.equal(r.status, 400);
  assert.match(r.message, /not feasible/);
  // malformed record id in the URL
  r = await api('GET', '/sites/not-an-id', { token: S.admin });
  assert.equal(r.status, 400);
  assert.match(r.message, /Invalid id/);
  // change password: weak new password, then same as current
  r = await api('POST', '/auth/change-password', { token: S.tok.muthu, body: { currentPassword: 'User@12345', newPassword: 'onlyletters' } });
  assert.equal(r.status, 400);
  r = await api('POST', '/auth/change-password', { token: S.tok.muthu, body: { currentPassword: 'User@12345', newPassword: 'User@12345' } });
  assert.equal(r.status, 400);
  assert.match(r.message, /differ/);
});

test('E2E-28 API documentation (Swagger / OpenAPI) is generated from the live routes', async () => {
  const spec = await (await fetch(`${base}/api/docs.json`)).json();
  assert.equal(spec.openapi, '3.0.3');
  const post = spec.paths['/api/v1/orders'].post;
  assert.ok(post.requestBody.content['application/json'].schema.properties.sites, 'order body comes from the Joi schema');
  assert.match(spec.paths['/api/v1/sites/{id}/live'].post.description, /implementation\.execute/);
  assert.equal(spec.paths['/api/v1/admin/customers'].post.requestBody.content['application/json'].schema.properties.gstin.pattern.length > 10, true);
  assert.equal(spec.paths['/api/v1/auth/login'].post.security, undefined, 'sign-in is public');
  const ui = await fetch(`${base}/api/docs/`);
  assert.equal(ui.status, 200);
  assert.match(await ui.text(), /swagger-ui/i);
});

test('E2E-29 Live sync (Socket.io): a change reaches a colleague’s open screen, not other companies', async () => {
  const { io } = require('socket.io-client');
  const connect = (token) => new Promise((resolve, reject) => {
    const sk = io(base, { path: '/socket.io', auth: { token }, transports: ['websocket'], reconnection: false });
    sk.on('connect', () => resolve(sk));
    sk.on('connect_error', (e) => { sk.close(); reject(e); });
  });
  const next = (sk, ms = 3000) => new Promise((resolve) => {
    const t = setTimeout(() => resolve(null), ms);
    sk.once('changed', (e) => { clearTimeout(t); resolve(e); });
  });
  await assert.rejects(connect('not-a-token'), /unauthorized/, 'bad token refused');
  const billing = await connect(S.tok.billing);
  const otherCompany = await connect(S.otherAdmin);
  try {
    const gotBilling = next(billing);
    const gotOther = next(otherCompany, 1500);
    // Ops hands a site over → billing user (same company) is told; the other company hears nothing
    ok(await api('POST', `/sites/${S.site2Id}/owner`, { token: S.tok.ops, body: { ownerId: S.muthu.id } }));
    const e = await gotBilling;
    assert.ok(e, 'colleague received the change');
    assert.equal(e.entityType, 'SITE');
    assert.equal(e.entityId, S.site2Id);
    assert.equal(await gotOther, null, 'other company not told');
  } finally {
    billing.close();
    otherCompany.close();
  }
});

test('E2E-30 ISP / vendor address (map location from the link) and optional notes on vendors and clients', async () => {
  const v = ok(await api('POST', '/admin/vendors', { token: S.admin, body: {
    name: 'Nearby Fiber Pvt Ltd', vendorType: 'ISP', address: '12 MG Road, Bengaluru', city: 'Bengaluru', state: 'Karnataka', pincode: '560001',
    mapsUrl: 'https://maps.app.goo.gl/x?q=12.9756,77.6050', notes: 'Strong in central Bengaluru; ask for Ravi'
  } }), 201);
  assert.equal(v.pincode, '560001');
  assert.equal(v.latitude, 12.9756, 'latitude read from the maps link');
  assert.equal(v.longitude, 77.605);
  assert.equal(v.notes, 'Strong in central Bengaluru; ask for Ravi');
  const listed = ok(await api('GET', '/admin/vendors?type=ISP', { token: S.tok.muthu })).find((x) => x.id === v.id);
  assert.equal(listed.city, 'Bengaluru', 'field engineers can see ISP locations');
  // edit: typed coordinates win; clearing the address works
  const e = ok(await api('PUT', `/admin/vendors/${v.id}`, { token: S.admin, body: { name: 'Nearby Fiber Pvt Ltd', vendorType: 'ISP', address: '', pincode: '560002', latitude: 12.97, longitude: 77.6, notes: '' } }));
  assert.equal(e.address, null);
  assert.equal(e.latitude, 12.97);
  assert.equal(e.notes, null);
  // validation: bad pincode, bad link, latitude out of range
  const bad = await api('POST', '/admin/vendors', { token: S.admin, body: { name: 'Bad Vendor', pincode: '0600', mapsUrl: 'maps.google.com', latitude: 95 } });
  assert.equal(bad.status, 400);
  assert.deepEqual(bad.errors.map((x) => x.field).sort(), ['latitude', 'mapsUrl', 'pincode']);
  // client notes
  const c = ok(await api('PUT', `/admin/customers/${S.hdfc.id}`, { token: S.admin, body: { name: 'HDFC Bank', clientType: 'BFSI', creditDays: 30, notes: 'Bills go to the regional office' } }));
  assert.equal(c.notes, 'Bills go to the regional office');
  assert.equal(ok(await api('GET', `/clients/${S.hdfc.id}`, { token: S.admin })).notes, 'Bills go to the regional office');
});

test('E2E-31 A logged client order can be edited, and deleted while no site has a quote', async () => {
  // the single-site form: order header + one site (with city and medium)
  const o = ok(await api('POST', '/orders', { token: S.tok.muthu, body: {
    customerId: S.hdfc.id, receivedVia: 'EMAIL',
    sites: [{ siteName: 'Indiranagar Branch', bandwidthMbps: 50, address: '100 Ft Rd, Indiranagar', city: 'Bengaluru', pincode: '560038', medium: 'RF' }]
  } }), 201);
  assert.equal(o.sites.length, 1);
  const feasId = o.sites[0].feasibility_id;
  const f0 = ok(await api('GET', `/feasibility/${feasId}`, { token: S.admin }));
  assert.equal(f0.city, 'Bengaluru');
  assert.equal(f0.medium, 'RF');
  // edit: reference, notes and the client (logged under the wrong client) — the site follows the order
  const e = ok(await api('PATCH', `/orders/${o.id}`, { token: S.tok.muthu, body: { clientRef: 'RT/2026/77', notes: 'Wrong client fixed', customerId: S.railtel.id } }));
  assert.equal(e.client_ref, 'RT/2026/77');
  assert.equal(e.notes, 'Wrong client fixed');
  assert.equal(e.customer_id, S.railtel.id);
  assert.equal(ok(await api('GET', `/feasibility/${feasId}`, { token: S.admin })).customer_id, S.railtel.id, 'site request moved to the new client');
  // only the owner (or a manager) may change it
  assert.equal((await api('PATCH', `/orders/${o.id}`, { token: S.tok.amit, body: { notes: 'x y' } })).status, 403);
  assert.equal((await api('DELETE', `/orders/${o.id}`, { token: S.tok.amit })).status, 403);
  assert.equal((await api('DELETE', `/orders/${o.id}`, { token: S.tok.billing })).status, 403);
  // an order whose sites already have a quote is locked: no client change, no delete
  const lockedClient = await api('PATCH', `/orders/${S.order.id}`, { token: S.admin, body: { customerId: S.hdfc.id } });
  assert.equal(lockedClient.status, 400);
  assert.match(lockedClient.message, /already has a quote/);
  const lockedDelete = await api('DELETE', `/orders/${S.order.id}`, { token: S.admin });
  assert.equal(lockedDelete.status, 400);
  assert.match(lockedDelete.message, /Stop the site instead/);
  // delete the order logged by mistake: the order and its site request are gone, the log keeps a record
  const gone = ok(await api('DELETE', `/orders/${o.id}`, { token: S.tok.muthu }));
  assert.equal(gone.code, o.code);
  assert.equal((await api('GET', `/orders/${o.id}`, { token: S.admin })).status, 404);
  assert.equal((await api('GET', `/feasibility/${feasId}`, { token: S.admin })).status, 404);
  const log = ok(await api('GET', `/admin/activity?entityId=${o.id}`, { token: S.admin }));
  assert.ok(log.some((a) => a.action === 'ORDER_DELETED' && a.message.includes(f0.code)), 'deletion is logged with the site codes');
  assert.ok(log.some((a) => a.action === 'ORDER_UPDATED' && /client changed from HDFC Bank to RailTel/.test(a.message)), 'client change is logged');
});

test('E2E-32 Secondary link and static IP: priced monthly from survey to bill, and recorded at go-live', async () => {
  // One order: a primary link with a /29 static IP block, and a secondary (backup) link at the same station
  const o = ok(await api('POST', '/orders', { token: S.tok.muthu, body: {
    customerId: S.railtel.id, receivedVia: 'EMAIL', clientRef: 'RT/IP/2026/9',
    sites: [
      { siteName: 'Hubballi Station', bandwidthMbps: 100, address: 'Station Rd, Hubballi', pincode: '580020', staticIpCount: 8, medium: 'BROADBAND' },
      { siteName: 'Hubballi Station', bandwidthMbps: 50, address: 'Station Rd, Hubballi', pincode: '580020', linkRole: 'SECONDARY' }
    ]
  } }), 201);
  const [pri, sec] = o.sites;
  assert.equal(pri.link_role, 'PRIMARY', 'primary is the default');
  assert.equal(pri.static_ip_count, 8);
  assert.equal(sec.link_role, 'SECONDARY');
  assert.equal(sec.static_ip_count, 0);
  assert.equal((await api('POST', '/orders', { token: S.tok.muthu, body: { customerId: S.railtel.id, sites: [{ siteName: 'Bad', bandwidthMbps: 1, address: 'Somewhere', linkRole: 'BACKUP', staticIpCount: 999 }] } })).status, 400, 'unknown link type / too many IPs refused');
  // Editing another field does not reset the link type or the IPs
  const fsec = ok(await api('PATCH', `/feasibility/${sec.feasibility_id}`, { token: S.tok.muthu, body: { siteContactName: 'Station Master' } }));
  assert.equal(fsec.link_role, 'SECONDARY');

  // Survey: the ISP's static IP charge is recorded only for the site that needs IPs
  const sv = ok(await api('PUT', `/feasibility/${pri.feasibility_id}/survey`, { token: S.tok.muthu, body: { options: [{ vendorId: S.jio.id, isFeasible: true, vendorOtc: 5000, vendorMrc: 6000, vendorIpMrc: 500 }] } }));
  assert.equal(sv.options[0].vendor_ip_mrc, 500);
  const sv2 = ok(await api('PUT', `/feasibility/${sec.feasibility_id}/survey`, { token: S.tok.muthu, body: { options: [{ vendorId: S.airtel.id, isFeasible: true, vendorOtc: 0, vendorMrc: 3000, vendorIpMrc: 400 }] } }));
  assert.equal(sv2.options[0].vendor_ip_mrc, 0, 'no static IP needed → no IP charge kept');

  // Final price with the client's static IP charge → quote options carry it
  const fp = ok(await api('POST', `/feasibility/${pri.feasibility_id}/finalize-price`, { token: S.tok.commercial, body: { selectedOptionId: sv.options[0].id, clientOtc: 10000, clientMrc: 9000, clientIpMrc: 1000 } }));
  assert.equal(fp.final_client_ip_mrc, 1000);
  const done = ok(await api('POST', `/feasibility/${pri.feasibility_id}/complete`, { token: S.tok.commercial }));
  let q = ok(await api('GET', `/quotes/${done.quoteId}`, { token: S.tok.commercial }));
  assert.equal(q.static_ip_count, 8);
  assert.equal(q.options[0].client_ip_mrc, 1000);
  assert.equal(q.options[0].vendor_ip_mrc, 500);
  const months = q.contract_months;
  assert.equal(q.options[0].client_total, 10000 + (9000 + 1000) * months, 'quote value includes the static IP');
  assert.equal(q.options[0].margin, (10000 + 10000 * months) - (5000 + 6500 * months), 'margin includes the static IP');

  // Bid Win at a changed static IP price → site carries link type, IPs and both IP prices
  ok(await api('POST', `/quotes/${q.id}/send`, { token: S.tok.commercial }));
  const win = ok(await api('POST', `/quotes/${q.id}/bid-win`, { token: S.tok.commercial, body: { optionNo: 1, finalClientIpMrc: 1200, vendorPct: 55, partnerPct: 25, capexPct: 20 } }));
  assert.equal(win.quote.final_client_ip_mrc, 1200);
  assert.equal(win.quote.finalized_value, 10000 + (9000 + 1200) * months);
  const site = ok(await api('GET', `/sites/${win.siteId}`, { token: S.tok.ops }));
  assert.equal(site.static_ip_count, 8);
  assert.equal(site.client_ip_mrc, 1200);
  assert.equal(site.vendor_ip_mrc, 500);
  assert.equal(site.link_role, 'PRIMARY');
  assert.equal(site.medium, 'BROADBAND', 'the medium from the order is kept on the site');

  // Go-live needs the static IP block; the monthly bill has the IP charge as its own part
  ok(await api('POST', `/sites/${site.id}/po`, { token: S.tok.ops, body: { poNumber: 'RT/PO/IP/1', poDate: iso(10), poValue: 200000 } }));
  ok(await api('POST', `/sites/${site.id}/work-start`, { token: S.tok.muthu, body: { workOrderNo: 'WO-IP-1', workStartDate: iso(5), slaDays: 30 } }));
  const liveBody = { liveDate: iso(1), circuitId: 'JIO/HBL/1', wanIp: '103.24.121.2/30', atSignoffDate: iso(1), atSignedBy: 'RailTel SR' };
  const noBlock = await api('POST', `/sites/${site.id}/live`, { token: S.tok.muthu, body: liveBody });
  assert.equal(noBlock.status, 400);
  assert.deepEqual(noBlock.errors.map((x) => x.field), ['staticIpBlock']);
  assert.equal((await api('POST', `/sites/${site.id}/live`, { token: S.tok.muthu, body: { ...liveBody, staticIpBlock: '103.21.4.8/33' } })).status, 400, 'bad block refused');
  const live = ok(await api('POST', `/sites/${site.id}/live`, { token: S.tok.muthu, body: { ...liveBody, staticIpBlock: '103.21.4.8/29' } }));
  assert.equal(live.site.static_ip_block, '103.21.4.8/29');
  const bills = ok(await api('GET', `/invoices?siteId=${site.id}`, { token: S.tok.billing }));
  assert.equal(bills.length, 1, 'one first bill');
  const c1 = bills[0];
  assert.equal(c1.cycle_no, 1);
  assert.equal(c1.otc_amount, 10000);
  assert.equal(c1.base_amount, 10000 + 9000 + 1200, '1st bill = OTC + link MRC + static IP');
  assert.equal(c1.ip_amount, 1200);
  assert.equal(c1.vendor_cost, 5000 + 6500, 'ISP OTC + ISP MRC incl. its static IP charge');
  assert.equal(c1.static_ip_block, '103.21.4.8/29', 'printed on the bill');
  assert.equal(c1.medium, 'BROADBAND', 'the bill describes a broadband link, not a leased line');
  S.ipSiteId = site.id;
  // the next cycle has no OTC
  const c2 = ok(await api('POST', `/invoices/sites/${site.id}/next-cycle`, { token: S.tok.billing }), 201);
  assert.deepEqual([Number(c2.otc_amount ?? 0), c2.cycle_no], [0, 2]);
  // The order shows both links; live MRC includes the static IP
  const od = ok(await api('GET', `/orders/${o.id}`, { token: S.admin }));
  assert.deepEqual(od.sites.map((x) => x.link_role).sort(), ['PRIMARY', 'SECONDARY']);
  assert.equal(od.money.live_mrc, 10200);
});

test('E2E-33 A missing ISP can be added from the survey (field engineer: ISP only); duplicate names are refused', async () => {
  const v = ok(await api('POST', '/admin/vendors', { token: S.tok.muthu, body: { name: 'ACT Fibernet', vendorType: 'ISP', contactName: 'Kiran', contactPhone: '9845011111', city: 'Bengaluru', pincode: '560034' } }), 201);
  assert.equal(v.vendor_type, 'ISP');
  assert.equal(v.city, 'Bengaluru');
  assert.ok(ok(await api('GET', '/admin/vendors?type=ISP', { token: S.tok.muthu })).some((x) => x.id === v.id), 'available in the survey ISP list');
  // a field engineer cannot add other vendor types or edit vendors
  assert.equal((await api('POST', '/admin/vendors', { token: S.tok.muthu, body: { name: 'Some Contractor', vendorType: 'CONTRACTOR' } })).status, 403);
  assert.equal((await api('PUT', `/admin/vendors/${v.id}`, { token: S.tok.muthu, body: { name: 'ACT Fibernet Ltd', vendorType: 'ISP' } })).status, 403);
  assert.equal((await api('POST', '/admin/vendors', { token: S.tok.billing, body: { name: 'Billing ISP', vendorType: 'ISP' } })).status, 403, 'no survey permission → cannot add');
  // the same company twice (any case / spaces) is refused, on add and on rename
  const dup = await api('POST', '/admin/vendors', { token: S.tok.muthu, body: { name: '  reliance JIO ', vendorType: 'ISP' } });
  assert.equal(dup.status, 409);
  assert.deepEqual(dup.errors.map((x) => x.field), ['name']);
  assert.match(dup.message, /Reliance Jio is already in ISPs & Vendors/);
  assert.equal((await api('PUT', `/admin/vendors/${v.id}`, { token: S.admin, body: { name: 'Bharti Airtel', vendorType: 'ISP' } })).status, 409);
  ok(await api('PUT', `/admin/vendors/${v.id}`, { token: S.admin, body: { name: 'ACT Fibernet', vendorType: 'ISP', gstin: '29AABCA1234B1Z5' } }), 200);
});

test('E2E-34 A vendor can be deleted only when no survey, quote, site or payout uses it', async () => {
  // Jio is used across the whole flow → refused, with what uses it
  const jio = ok(await api('GET', '/admin/vendors', { token: S.admin })).find((x) => x.id === S.jio.id);
  assert.match(jio.used_in, /survey/);
  assert.match(jio.used_in, /site/);
  assert.match(jio.used_in, /payout/);
  const refused = await api('DELETE', `/admin/vendors/${S.jio.id}`, { token: S.admin });
  assert.equal(refused.status, 409);
  assert.match(refused.message, /Reliance Jio cannot be deleted: it is used in .*survey.*Mark it inactive instead/);
  assert.ok(ok(await api('GET', '/admin/vendors', { token: S.admin })).some((x) => x.id === S.jio.id), 'still there');

  // A vendor used only in one survey is refused too; once the survey no longer lists it, it can be deleted
  const v = ok(await api('POST', '/admin/vendors', { token: S.admin, body: { name: 'Survey Only Broadband', vendorType: 'ISP' } }), 201);
  const o = ok(await api('POST', '/orders', { token: S.tok.muthu, body: { customerId: S.hdfc.id, sites: [{ siteName: 'Koramangala Branch', bandwidthMbps: 20, address: '80 Ft Rd, Koramangala' }] } }), 201);
  const feasId = o.sites[0].feasibility_id;
  ok(await api('PUT', `/feasibility/${feasId}/survey`, { token: S.tok.muthu, body: { options: [{ vendorId: v.id, isFeasible: true, vendorMrc: 2000 }] } }));
  const listed = ok(await api('GET', '/admin/vendors', { token: S.admin })).find((x) => x.id === v.id);
  assert.equal(listed.used_in, '1 survey');
  const r1 = await api('DELETE', `/admin/vendors/${v.id}`, { token: S.admin });
  assert.equal(r1.status, 409);
  assert.match(r1.message, /used in 1 survey/);
  ok(await api('PUT', `/feasibility/${feasId}/survey`, { token: S.tok.muthu, body: { options: [{ vendorId: S.airtel.id, isFeasible: true, vendorMrc: 2100 }] } }));
  assert.equal(ok(await api('GET', '/admin/vendors', { token: S.admin })).find((x) => x.id === v.id).used_in, null, 'no longer used');

  // only masters.manage can delete; unknown / malformed ids are refused
  assert.equal((await api('DELETE', `/admin/vendors/${v.id}`, { token: S.tok.muthu })).status, 403);
  assert.equal((await api('DELETE', `/admin/vendors/${v.id}`, { token: S.tok.billing })).status, 403);
  assert.equal((await api('DELETE', `/admin/vendors/${v.id}`, { token: S.otherAdmin })).status, 404, 'another company cannot delete it');
  assert.equal((await api('DELETE', '/admin/vendors/00000000-0000-0000-0000-000000000000', { token: S.admin })).status, 404);
  assert.equal((await api('DELETE', '/admin/vendors/not-an-id', { token: S.admin })).status, 400);

  const gone = ok(await api('DELETE', `/admin/vendors/${v.id}`, { token: S.admin }));
  assert.equal(gone.id, v.id);
  assert.ok(!ok(await api('GET', '/admin/vendors', { token: S.admin })).some((x) => x.id === v.id), 'deleted');
  const log = ok(await api('GET', `/admin/activity?entityId=${v.id}`, { token: S.admin }));
  assert.ok(log.some((a) => a.action === 'VENDOR_DELETED'), 'deletion is logged');
  // the name is free again
  ok(await api('POST', '/admin/vendors', { token: S.admin, body: { name: 'Survey Only Broadband', vendorType: 'ISP' } }), 201);
});

test('E2E-35 Sites billed before the one-first-bill rule: no OTC charged twice, and their OTC + cycle 1 bills can be merged', async () => {
  // Make the Hubballi site look like it was billed the old way: a separate OTC bill, and a cycle 1 bill without the OTC
  const [c1] = ok(await api('GET', `/invoices?siteId=${S.ipSiteId}`, { token: S.tok.billing })).filter((i) => i.cycle_no === 1);
  await pool.query(`UPDATE invoices SET otc_amount = 0, base_amount = 10200, gst_amount = 1836, total_amount = 12036, vendor_cost = 6500 WHERE id = $1`, [c1.id]);
  await pool.query(
    `INSERT INTO invoices (tenant_id, invoice_number, site_id, customer_id, invoice_type, cycle_no, period_start, period_end, base_amount, otc_amount, gst_pct, gst_amount, total_amount, vendor_cost, invoice_date)
     SELECT tenant_id, 'OLD/OTC/0001', site_id, customer_id, 'OTC', 0, invoice_date, invoice_date, 10000, 10000, 18, 1800, 11800, 5000, invoice_date FROM invoices WHERE id = $1`, [c1.id]);
  const oldOtc = ok(await api('GET', `/invoices?siteId=${S.ipSiteId}`, { token: S.tok.billing })).find((i) => i.invoice_type === 'OTC');
  assert.equal(oldOtc.label, 'Site OTC');

  // Re-issuing cycle 1 while the separate OTC bill stands does not bill the OTC again
  const r1 = ok(await api('POST', `/invoices/${c1.id}/cancel`, { token: S.tok.billing, body: { reason: 'Wrong PO on bill' } }));
  assert.equal(r1.replacement.cycle_no, 1);
  assert.equal(Number(r1.replacement.otc_amount), 0, 'OTC already billed separately');
  assert.equal(Number(r1.replacement.total_amount), 12036);

  // Cancel & re-issue on the old OTC bill → one 1st bill with OTC + cycle 1; the separate cycle 1 bill is cancelled too
  const r2 = ok(await api('POST', `/invoices/${oldOtc.id}/cancel`, { token: S.tok.billing, body: { reason: 'Client wants one first bill' } }));
  assert.equal(r2.replacement.cycle_no, 1);
  assert.equal(Number(r2.replacement.otc_amount), 10000);
  assert.equal(Number(r2.replacement.total_amount), Math.round((10000 + 9000 + 1200) * 1.18 * 100) / 100);
  const active = ok(await api('GET', `/invoices?siteId=${S.ipSiteId}`, { token: S.tok.billing })).filter((i) => i.status !== 'CANCELLED');
  assert.deepEqual(active.map((i) => i.label).sort(), ['Cycle 1 + OTC', 'Cycle 2']);
  const merged = active.find((i) => i.cycle_no === 1);
  assert.equal(merged.vendor_cost, 5000 + 6500, 'ISP OTC moves to the merged bill');
});

const addMonthsIso = (d, n) => require('../src/utils/helpers').addMonths(d, n);
const { daysBetween, round2 } = require('../src/utils/helpers');

test('E2E-36 Live sites register: every running link in one list; prices hidden from field engineers; contract-end alerts', async () => {
  const all = ok(await api('GET', '/sites/register', { token: S.admin }));
  assert.ok(all.every((r) => ['LIVE', 'TERMINATED'].includes(r.status)), 'only live / disconnected sites');
  const r = all.find((x) => x.id === S.siteId);
  assert.equal(r.status, 'LIVE');
  assert.equal(r.vendor_name, 'Reliance Jio');
  assert.equal(r.circuit_id, 'JIO/BLR/ILL/7781');
  assert.equal(r.contract_end, bizAddDays(addMonthsIso(iso(40), 12), -1), 'contract = live date + 12 months');
  assert.ok(r.contract_days_left > 300);
  assert.equal(r.next_bill_date, addMonthsIso(iso(40), 3), 'cycles 1–3 billed → next bill when cycle 4 starts');
  assert.deepEqual([r.monthly_price, r.monthly_cost, r.monthly_margin], [15000, 8000, 7000]);
  assert.deepEqual([r.billed, r.received, r.outstanding], [41300 + 17700 + 17700, 41300 + 10000, 17700 + 7700]);
  // Field engineer: sees the links, not the money (register and site detail)
  const fe = ok(await api('GET', '/sites/register', { token: S.tok.muthu })).find((x) => x.id === S.siteId);
  assert.equal(fe.circuit_id, 'JIO/BLR/ILL/7781');
  for (const k of ['client_mrc', 'vendor_mrc', 'monthly_price', 'monthly_margin', 'billed', 'outstanding', 'po_value', 'finalized_value']) assert.equal(fe[k], undefined, `${k} hidden`);
  const feSite = ok(await api('GET', `/sites/${S.siteId}`, { token: S.tok.muthu }));
  assert.equal(feSite.client_mrc, undefined);
  assert.equal(feSite.vendor_otc, undefined);
  assert.equal(ok(await api('GET', `/sites/${S.siteId}`, { token: S.tok.ops })).client_mrc, 15000, 'operations still sees prices');
  assert.equal(ok(await api('GET', '/sites/register', { token: S.otherAdmin })).length, 0, 'other company sees none');

  // Contract-end alerts on the dashboard
  await pool.query('UPDATE sites SET contract_months = 2 WHERE id = $1', [S.siteId]);
  let d = ok(await api('GET', '/dashboard/summary', { token: S.admin }));
  assert.ok(d.alerts.some((a) => a.title === 'Contract ending within 60 days' && a.id === S.siteId && a.link === 'live'));
  await pool.query('UPDATE sites SET contract_months = 1 WHERE id = $1', [S.siteId]);
  d = ok(await api('GET', '/dashboard/summary', { token: S.admin }));
  assert.ok(d.alerts.some((a) => a.title === 'Contract ended — renew or disconnect' && a.id === S.siteId));
  // Renew: the client sends a renewal PO for 11 more months → contract back to 12 months, alert gone
  assert.equal((await api('POST', `/sites/${S.siteId}/renew`, { token: S.tok.muthu, body: { extendMonths: 11 } })).status, 403, 'engineer cannot renew');
  assert.equal((await api('POST', `/sites/${S.siteId}/renew`, { token: S.tok.ops, body: { extendMonths: 0 } })).status, 400);
  const rn = ok(await api('POST', `/sites/${S.siteId}/renew`, { token: S.tok.ops, body: { extendMonths: 11, poNumber: 'RTL/PO/2027/REN-1', poDate: iso(0) } }));
  assert.equal(rn.contract_months, 12);
  assert.equal(rn.po_number, 'RTL/PO/2027/REN-1');
  assert.equal(rn.contract_end, bizAddDays(addMonthsIso(iso(40), 12), -1));
  d = ok(await api('GET', '/dashboard/summary', { token: S.admin }));
  assert.ok(!d.alerts.some((a) => /Contract/.test(a.title) && a.id === S.siteId), 'no alert a year ahead');
  await pool.query("UPDATE sites SET po_number = 'RTL/PO/2026/8941' WHERE id = $1", [S.siteId]); // keep later checks on the original PO
});

test('E2E-37 Disconnect a live site: the running cycle is billed in full (no pro-rata), then billing and ISP cost stop', async () => {
  const id = S.ipSiteId; // Hubballi (Jio, live, monthly): ₹9,000 + static IP ₹1,200 / month; ISP ₹6,000 + ₹500
  // Make it a link that went live 70 days ago (cycles 1 and 2 billed), so cycle 3 has started but is not billed yet
  const L = iso(70);
  await pool.query('UPDATE sites SET live_date = $2, billing_start = $2, contract_start = $2 WHERE id = $1', [id, L]);
  for (const n of [1, 2]) {
    await pool.query(`UPDATE invoices SET period_start = $3, period_end = $4 WHERE site_id = $1 AND cycle_no = $2 AND status <> 'CANCELLED'`,
      [id, n, addMonthsIso(L, n - 1), bizAddDays(addMonthsIso(L, n), -1)]);
  }
  const body = { disconnectDate: iso(0), reason: 'Client closed the station office' };
  assert.equal((await api('POST', `/sites/${id}/disconnect`, { token: S.tok.muthu, body })).status, 403, 'field engineer cannot disconnect');
  assert.equal((await api('POST', `/sites/${id}/disconnect`, { token: S.tok.ops, body: { disconnectDate: iso(-3), reason: 'x y z' } })).status, 400, 'future date refused');
  const early = await api('POST', `/sites/${id}/disconnect`, { token: S.tok.ops, body: { disconnectDate: iso(80), reason: 'too early' } });
  assert.equal(early.status, 400);
  assert.deepEqual(early.errors.map((e) => e.field), ['disconnectDate'], 'before live date');
  assert.equal((await api('POST', `/sites/${id}/disconnect`, { token: S.tok.ops, body: { disconnectDate: iso(0) } })).status, 400, 'reason required');
  assert.equal(ok(await api('GET', '/admin/settings', { token: S.admin })).prorate_on_disconnect, undefined, 'no pro-rata setting (client decision: always the full cycle)');

  const r = ok(await api('POST', `/sites/${id}/disconnect`, { token: S.tok.ops, body }));
  assert.equal(r.site.status, 'TERMINATED');
  assert.equal(r.site.terminated_on, iso(0));
  assert.equal(r.site.termination_reason, 'Client closed the station office');
  assert.equal(r.site.terminated_by_name, 'Ravi Ops');
  // Cycle 3 (running on the disconnection date) is billed in full
  const e3 = bizAddDays(addMonthsIso(L, 3), -1);
  assert.deepEqual(r.billed.map((i) => i.cycle_no), [3]);
  assert.equal(r.billed[0].period_end, e3, 'the whole cycle');
  const last = ok(await api('GET', `/invoices/${r.billed[0].id}`, { token: S.tok.billing }));
  assert.equal(last.base_amount, 9000 + 1200, 'full month: link + static IP');
  assert.equal(last.vendor_cost, 6500, 'full month of ISP cost');
  assert.equal(r.credited.length, 0, 'nothing was billed after the disconnection');
  S.e3 = e3;
  // Billing stops
  assert.equal((await api('POST', `/invoices/sites/${id}/next-cycle`, { token: S.tok.billing })).status, 409);
  const due = ok(await api('POST', '/invoices/run-billing', { token: S.tok.billing }));
  assert.ok(!due.some((i) => i.site_code === r.site.code), 'scheduler skips disconnected sites');
  assert.equal((await api('POST', `/sites/${id}/disconnect`, { token: S.tok.ops, body })).status, 409, 'already disconnected');
  const row = ok(await api('GET', '/sites/register', { token: S.admin })).find((x) => x.id === id);
  assert.equal(row.status, 'TERMINATED');
  assert.equal(row.next_bill_date, undefined);
  assert.equal(row.contract_days_left, null);
  const l = ok(await api('GET', `/dashboard/lifecycle/${id}`, { token: S.admin }));
  assert.ok(l.timeline.some((a) => a.action === 'SITE_DISCONNECTED'));
});

test('E2E-38 ISP overview: which sites each ISP has, its surveys, monthly cost and what we owe it', async () => {
  const o = ok(await api('GET', `/admin/vendors/${S.jio.id}/overview`, { token: S.admin }));
  assert.equal(o.vendor.name, 'Reliance Jio');
  const rail = o.sites.find((s) => s.id === S.siteId);
  assert.equal(rail.relation, 'ISP');
  assert.equal(rail.status, 'LIVE');
  assert.equal(rail.customer_name, 'RailTel Corporation of India Ltd');
  assert.ok(o.sites.some((s) => s.id === S.ipSiteId && s.status === 'TERMINATED'));
  assert.equal(o.summary.live, o.sites.filter((s) => s.relation === 'ISP' && s.status === 'LIVE').length);
  assert.ok(o.summary.live >= 1);
  assert.equal(o.summary.disconnected, 1);
  assert.equal(o.summary.monthly_cost, o.sites.filter((s) => s.relation === 'ISP' && s.status === 'LIVE').reduce((a, s) => a + Number(s.vendor_mrc) + Number(s.vendor_ip_mrc), 0));
  assert.ok(o.summary.surveys >= 2 && o.surveys.some((x) => x.code === S.feas.code && x.is_feasible));
  assert.ok(o.summary.accrued > 0 && o.summary.paid >= 18000, 'what we owe Jio and what was paid');
  assert.ok(o.payouts.some((p) => p.reference === 'AXIS-VP-01'));
  // Airtel: surveyed, never won the RailTel site
  const a = ok(await api('GET', `/admin/vendors/${S.airtel.id}/overview`, { token: S.admin }));
  assert.ok(a.summary.surveys >= 1);
  assert.ok(a.sites.every((s) => s.id !== S.siteId));
  // Field engineer: the sites and surveys, no prices or payables
  const fe = ok(await api('GET', `/admin/vendors/${S.jio.id}/overview`, { token: S.tok.muthu }));
  assert.ok(fe.sites.length >= 2);
  for (const k of ['vendor_mrc', 'client_mrc', 'accrued', 'paid']) assert.equal(fe.sites[0][k], undefined, `${k} hidden`);
  assert.equal(fe.summary.monthly_cost, undefined);
  assert.equal(fe.summary.outstanding, undefined);
  assert.equal(fe.payouts, null);
  assert.equal(fe.surveys[0].vendor_mrc, undefined);
  assert.equal((await api('GET', `/admin/vendors/${S.jio.id}/overview`, { token: S.otherAdmin })).status, 404, 'other company');
  assert.equal((await api('GET', '/admin/vendors/not-a-uuid/overview', { token: S.admin })).status, 400);
});

test('E2E-39 Reconnect inside a period already billed in full: billing restarts the day after it; a whole advance period is credited on a later disconnection', async () => {
  const id = S.ipSiteId; // disconnected today in E2E-37; cycle 3 was billed in full until S.e3
  const before = ok(await api('GET', `/sites/${id}`, { token: S.tok.ops }));
  const body = { reconnectDate: iso(0), reason: 'Client reopened the office', reconnectCharge: 2000, reconnectVendorCharge: 1000, contractMonths: 12 };
  assert.equal((await api('POST', `/sites/${id}/reconnect`, { token: S.tok.muthu, body })).status, 403, 'field engineer cannot reconnect');
  const bad = await api('POST', `/sites/${id}/reconnect`, { token: S.tok.ops, body: { ...body, reconnectDate: iso(5) } });
  assert.deepEqual(bad.errors.map((e) => e.field), ['reconnectDate'], 'not before the disconnection');
  assert.equal((await api('POST', `/sites/${S.siteId}/reconnect`, { token: S.tok.ops, body })).status, 409, 'a live site cannot be reconnected');
  const r = ok(await api('POST', `/sites/${id}/reconnect`, { token: S.tok.ops, body }));
  assert.equal(r.site.status, 'LIVE');
  assert.equal(r.site.billing_start, bizAddDays(S.e3, 1), 'the client already paid until the end of cycle 3 — no day billed twice');
  assert.equal(r.site.cycle_base, before.last_cycle_no, 'cycle numbers continue');
  assert.equal(r.site.terminated_on, null);
  assert.equal(r.site.contract_end, bizAddDays(addMonthsIso(iso(0), 12), -1), 'new contract from the reconnection');
  assert.equal(r.invoices.length, 0, 'nothing due yet');
  // The first bill after reconnection (raised in advance): reconnection charge + a full cycle from the day after the paid period
  const adv = ok(await api('POST', `/invoices/sites/${id}/next-cycle`, { token: S.tok.billing }), 201);
  const c = ok(await api('GET', `/invoices/${adv.id}`, { token: S.tok.billing }));
  assert.equal(c.cycle_no, before.last_cycle_no + 1);
  assert.equal(c.period_start, bizAddDays(S.e3, 1));
  assert.equal(c.otc_amount, 2000);
  assert.equal(c.base_amount, 2000 + 9000 + 1200);
  assert.equal(c.vendor_cost, 1000 + 6500);
  assert.equal(c.label, `Cycle ${c.cycle_no} + OTC`);
  assert.equal(c.invoice_date, iso(0), 'advance bill dated today');

  // Disconnected again today, before that period started: its link part is credited in full; the reconnection charge stays
  const d = ok(await api('POST', `/sites/${id}/disconnect`, { token: S.tok.ops, body: { disconnectDate: iso(0), reason: 'Closed again' } }));
  assert.equal(d.billed.length, 0);
  assert.equal(d.credited.length, 1);
  assert.equal(d.credited[0].invoice_id, c.id);
  assert.equal(d.credited[0].base_amount, 10200, 'the unused period (link + static IP), not the reconnection charge');
  assert.match(d.credited[0].credit_number, /^TGT-CN\/\d{2}-\d{2}\/\d{4}$/);
  const now = ok(await api('GET', `/invoices/${c.id}`, { token: S.tok.billing }));
  assert.equal(now.outstanding, round2(2000 * 1.18), 'only the reconnection charge is still due');
  assert.equal(now.vendor_cost, 1000, 'ISP cost for the unused period removed');
  assert.equal(now.credit_notes.length, 1);
});

test('E2E-40 Bandwidth / price change on a live link: applies from the next cycle; earlier cycles keep their price, also when re-issued', async () => {
  const id = S.siteId; // RailTel, live 40 days ago, cycles 1–3 billed at ₹15,000 (100 Mbps)
  const site = ok(await api('GET', `/sites/${id}`, { token: S.tok.ops }));
  const body = { bandwidthMbps: 200, clientMrc: 25000, vendorMrc: 14000, reason: 'Upgrade to 200 Mbps', poNumber: 'RTL/PO/UPG/1' };
  assert.equal((await api('POST', `/sites/${id}/revisions`, { token: S.tok.ops, body })).status, 403, 'price change is a commercial decision');
  const early = await api('POST', `/sites/${id}/revisions`, { token: S.tok.commercial, body: { ...body, fromCycle: 2 } });
  assert.equal(early.status, 400, 'already-billed cycle refused');
  assert.deepEqual(early.errors.map((e) => e.field), ['fromCycle']);
  assert.equal((await api('POST', `/sites/${id}/revisions`, { token: S.tok.commercial, body: { bandwidthMbps: 100, clientMrc: 15000, vendorMrc: 8000, reason: 'same' } })).status, 400, 'nothing changed');
  const r = ok(await api('POST', `/sites/${id}/revisions`, { token: S.tok.commercial, body }), 201);
  assert.equal(r.bandwidth_mbps, 200);
  assert.equal(r.client_mrc, 25000);
  assert.equal(r.revisions.length, 1);
  assert.equal(r.revisions[0].from_cycle, site.last_cycle_no + 1);
  assert.equal(r.revisions[0].effective_from, addMonthsIso(iso(40), site.last_cycle_no));
  assert.equal(r.revisions[0].old_client_mrc, 15000);
  assert.equal((await api('POST', `/sites/${id}/revisions`, { token: S.tok.commercial, body: { ...body, clientMrc: 26000 } })).status, 409, 'one change per cycle');
  // The next cycle bills the new price and bandwidth
  const c4 = ok(await api('POST', `/invoices/sites/${id}/next-cycle`, { token: S.tok.billing }), 201);
  const inv4 = ok(await api('GET', `/invoices/${c4.id}`, { token: S.tok.billing }));
  assert.equal(inv4.base_amount, 25000);
  assert.equal(inv4.vendor_cost, 14000);
  assert.equal(inv4.bandwidth_mbps, 200, 'the bill shows the bandwidth of its period');
  S.c4 = inv4;
  // Re-issuing cycle 3 keeps the old price and bandwidth
  const c3 = ok(await api('GET', `/invoices?siteId=${id}`, { token: S.tok.billing })).find((i) => i.cycle_no === 3 && i.status !== 'CANCELLED');
  const re = ok(await api('POST', `/invoices/${c3.id}/cancel`, { token: S.tok.billing, body: { reason: 'Re-issue to check the price' } }));
  const re3 = ok(await api('GET', `/invoices/${re.replacement.id}`, { token: S.tok.billing }));
  assert.equal(re3.base_amount, 15000);
  assert.equal(re3.bandwidth_mbps, 100);
  // Field engineer: sees the change, not the prices
  const fe = ok(await api('GET', `/sites/${id}`, { token: S.tok.muthu }));
  assert.equal(fe.revisions[0].new_bandwidth_mbps, 200);
  assert.equal(fe.revisions[0].new_client_mrc, undefined);
});

test('E2E-41 Credit note on a bill (e.g. for an outage); link faults with the ISP; uptime', async () => {
  // Credit note
  const note = { amount: 5000, reason: 'Link down 3 days in the period' };
  assert.equal((await api('POST', `/invoices/${S.c4.id}/credit-notes`, { token: S.tok.muthu, body: note })).status, 403);
  assert.equal((await api('POST', `/invoices/${S.c4.id}/credit-notes`, { token: S.tok.billing, body: { amount: 30000, reason: 'too much' } })).status, 400, 'more than the bill');
  const cn = ok(await api('POST', `/invoices/${S.c4.id}/credit-notes`, { token: S.tok.billing, body: note }), 201);
  assert.equal(cn.creditNote.total_amount, 5900, 'GST added at the bill rate');
  assert.equal(cn.invoice.outstanding, 29500 - 5900);
  assert.equal(cn.invoice.credit_amount, 5900);
  assert.equal((await api('POST', `/invoices/${S.c4.id}/cancel`, { token: S.tok.billing, body: { reason: 'try cancel' } })).status, 409, 'a bill with a credit note cannot be cancelled');

  // Faults: the owner logs the link down with the ISP docket, then restored
  const id = S.siteId;
  const down = new Date(Date.now() - 3 * 3600000).toISOString();
  assert.equal((await api('POST', `/sites/${id}/faults`, { token: S.tok.amit, body: { reportedAt: down, description: 'No link' } })).status, 403, 'not his site');
  const f = ok(await api('POST', `/sites/${id}/faults`, { token: S.tok.muthu, body: { reportedAt: down, docketNo: 'JIO-77881', description: 'Fibre cut near the station' } }), 201);
  assert.ok(f.open_fault && f.faults.length === 1);
  assert.equal((await api('POST', `/sites/${id}/faults`, { token: S.tok.muthu, body: { reportedAt: down, description: 'again' } })).status, 409, 'one open fault at a time');
  let dash = ok(await api('GET', '/dashboard/summary', { token: S.admin }));
  assert.ok(dash.alerts.some((a) => a.title === 'Link down' && a.id === id && /JIO-77881/.test(a.detail)));
  assert.ok(ok(await api('GET', '/sites/register', { token: S.admin })).find((x) => x.id === id).open_fault, 'Live Sites shows it down');
  const up = new Date(Date.now() - 1 * 3600000).toISOString();
  assert.equal((await api('POST', `/sites/${id}/faults/${f.faults[0].id}/restore`, { token: S.tok.muthu, body: { restoredAt: new Date(Date.now() - 5 * 3600000).toISOString(), cause: 'x y z' } })).status, 400, 'before the fault');
  const rs = ok(await api('POST', `/sites/${id}/faults/${f.faults[0].id}/restore`, { token: S.tok.muthu, body: { restoredAt: up, cause: 'ISP spliced the fibre' } }));
  assert.equal(rs.open_fault, null);
  assert.ok(Math.abs(rs.faults[0].down_minutes - 120) <= 1);
  assert.ok(rs.uptime_30d < 100 && rs.uptime_30d > 99, `uptime ${rs.uptime_30d}`);
  dash = ok(await api('GET', '/dashboard/summary', { token: S.admin }));
  assert.ok(!dash.alerts.some((a) => a.title === 'Link down' && a.id === id));
  const jio = ok(await api('GET', `/admin/vendors/${S.jio.id}/overview`, { token: S.admin }));
  assert.equal(jio.summary.faults_90d, 1);
  assert.equal(jio.summary.avg_restore_hours, 2);
  assert.equal(jio.faults[0].docket_no, 'JIO-77881');
});

test('E2E-42 ISP bills checked against the expected cost; activity hides amounts from field engineers', async () => {
  const url = `/admin/vendors/${S.jio.id}/bills`;
  const bill = { billNumber: 'JIO/2026/5512', billDate: iso(0), periodFrom: iso(45), periodTo: iso(0), amount: 1, gstAmount: 0.18 };
  assert.equal((await api('POST', url, { token: S.tok.muthu, body: bill })).status, 403);
  assert.equal((await api('POST', url, { token: S.tok.billing, body: { ...bill, periodTo: iso(50) } })).status, 400, 'period to before from');
  const wrong = ok(await api('POST', url, { token: S.tok.billing, body: bill }), 201);
  assert.ok(wrong.expected_amount > 0, 'expected = ISP cost booked for that period');
  assert.equal(wrong.mismatch, true);
  assert.equal(wrong.due_date, bizAddDays(iso(0), 30), 'due by the ISP payment terms');
  const dash = ok(await api('GET', '/dashboard/summary', { token: S.tok.finance }));
  assert.ok(dash.alerts.some((a) => a.title === 'ISP bill differs from the expected cost' && a.id === S.jio.id && a.link === 'masters'));
  assert.equal((await api('POST', url, { token: S.tok.billing, body: { ...bill, billNumber: ' jio/2026/5512 '.trim().toLowerCase() } })).status, 409, 'same bill number');
  ok(await api('DELETE', `${url}/${wrong.id}`, { token: S.tok.billing }));
  const right = ok(await api('POST', url, { token: S.tok.finance, body: { ...bill, amount: wrong.expected_amount, gstAmount: round2(wrong.expected_amount * 0.18) } }), 201);
  assert.equal(right.mismatch, false);
  const o = ok(await api('GET', `/admin/vendors/${S.jio.id}/overview`, { token: S.admin }));
  assert.equal(o.bills.length, 1);
  assert.equal(o.summary.isp_bills_mismatch, 0);
  assert.equal(ok(await api('GET', `/admin/vendors/${S.jio.id}/overview`, { token: S.tok.muthu })).bills, null, 'engineer sees no ISP bills');
  assert.equal((await api('GET', '/admin/vendors/x/bills', { token: S.admin })).status, 400);

  // Activity: amounts masked for the field engineer, shown to the admin
  const mine = ok(await api('GET', `/admin/activity?entityId=${S.siteId}`, { token: S.tok.muthu }));
  assert.ok(mine.length > 3);
  assert.ok(mine.every((a) => !/₹\s?\d/.test(a.message)), 'no amounts for the engineer');
  assert.ok(mine.some((a) => /₹ ••/.test(a.message)), 'masked');
  const adm = ok(await api('GET', `/admin/activity?entityId=${S.siteId}`, { token: S.admin }));
  assert.ok(adm.some((a) => /₹2,00,000/.test(a.message)), 'admin sees the PO value');
  const l = ok(await api('GET', `/dashboard/lifecycle/${S.siteId}`, { token: S.tok.muthu }));
  assert.ok(l.timeline.every((a) => !/₹\s?\d/.test(a.message)));
  assert.equal(l.site.client_mrc, undefined, 'Site 360 hides prices from the engineer');
});

test('E2E-43 Reconnect after the paid period: billing starts on the reconnection date — the days it was off are not billed', async () => {
  const id = S.ipSiteId; // disconnected (E2E-39). Make it a link switched off 45 days ago, so its paid period has ended
  await pool.query('UPDATE sites SET terminated_on = $2 WHERE id = $1', [id, iso(45)]);
  const r = ok(await api('POST', `/sites/${id}/reconnect`, { token: S.tok.ops, body: { reconnectDate: iso(0), reason: 'Back after a long break' } }));
  assert.equal(r.site.billing_start, iso(0));
  assert.equal(r.invoices.length, 1, 'the cycle starting today is billed now');
  const inv = ok(await api('GET', `/invoices/${r.invoices[0].id}`, { token: S.tok.billing }));
  assert.equal(inv.period_start, iso(0), 'nothing billed for the days it was off');
  assert.equal(inv.base_amount, 9000 + 1200, 'no reconnection charge this time');
  assert.equal(ok(await api('GET', '/admin/settings', { token: S.admin })).prorate_on_disconnect, undefined);
});
