/**
 * Company Admin: team & roles, clients, ISPs / vendors, company settings, activity log.
 */
const router = require('express').Router();
const Joi = require('joi');
const { R, guardIds } = require('../../validation/rules');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const db = require('../../config/db');
const ApiError = require('../../utils/apiError');
const { ah, today, parseCoordinates, round2, notFuture, inr } = require('../../utils/helpers');
const { sendSuccess } = require('../../utils/response');
const validate = require('../../middlewares/validate.middleware');
const { authenticate, requireTenant, requirePerm } = require('../../middlewares/auth.middleware');
const { TENANT_ROLES, ROLE_LABELS, can } = require('../../constants/roles');
const activity = require('../../utils/activity');
const { User, Customer, Vendor, Tenant, TenantSetting, toRow } = require('../../models');

router.use(authenticate, requireTenant);

const isAdmin = requirePerm('users.manage');
const tempPassword = () => `Isp@${crypto.randomBytes(4).toString('hex')}`;

/* ---------------------------------- USERS --------------------------------- */
const USER_COLS = ['id', 'name', 'email', 'phone', 'zone', 'role', 'is_active', 'must_change_password', 'last_login_at', 'created_at'];
const USER_ATTRS = ['id', 'name', 'email', 'phone', 'zone', 'role', 'isActive', 'mustChangePassword', 'lastLoginAt', 'createdAt'];
const pick = (o, keys) => Object.fromEntries(keys.map((k) => [k, o[k] === undefined ? null : o[k]]));

router.get('/roles', (req, res) => sendSuccess(res, TENANT_ROLES.map((r) => ({ id: r, label: ROLE_LABELS[r] }))));

// Lookup for dropdowns (e.g. assign surveyor) — any signed-in company user
router.get('/users/lookup', ah(async (req, res) => {
  const params = [req.tenantId];
  let where = 'tenant_id = $1 AND is_active';
  if (req.query.role) {
    params.push(String(req.query.role).split(','));
    where += ` AND role = ANY($${params.length})`;
  }
  return sendSuccess(res, await db.many(`SELECT id, name, role, zone FROM users WHERE ${where} ORDER BY name`, params));
}));

/** Field team workload — surveys in hand, sites in delivery, delivered, SLA overdue (for managers) */
router.get('/team/workload', requirePerm('users.manage', 'feasibility.assign', 'implementation.manage'), ah(async (req, res) => sendSuccess(res, await db.many(
  `SELECT u.id, u.name, u.role, u.zone,
     (SELECT COUNT(*) FROM feasibility_requests f WHERE f.assigned_to = u.id AND f.status IN ('NEW','ASSIGNED','SURVEY_DONE'))::int AS surveys_open,
     (SELECT COUNT(*) FROM feasibility_requests f WHERE f.assigned_to = u.id AND f.status = 'PRICE_FINALIZED')::int AS awaiting_completion,
     (SELECT COUNT(*) FROM sites s WHERE s.owner_id = u.id AND s.status IN ('AWAITING_PO','PO_RECEIVED','WORK_STARTED','BLOCKED'))::int AS sites_in_delivery,
     (SELECT COUNT(*) FROM sites s WHERE s.owner_id = u.id AND s.status = 'BLOCKED')::int AS sites_blocked,
     (SELECT COUNT(*) FROM sites s WHERE s.owner_id = u.id AND s.status IN ('WORK_STARTED','BLOCKED') AND s.target_live_date < $2)::int AS sla_overdue,
     (SELECT COUNT(*) FROM sites s WHERE s.owner_id = u.id AND s.status = 'LIVE')::int AS delivered
   FROM users u WHERE u.tenant_id = $1 AND u.is_active AND u.role IN ('FIELD_ENGINEER','OPERATIONS')
   ORDER BY u.role DESC, u.name`, [req.tenantId, today()]))));

router.get('/users', isAdmin, ah(async (req, res) => {
  const users = await User.findAll({ where: { tenantId: req.tenantId }, attributes: USER_ATTRS, order: [['createdAt', 'ASC']] });
  return sendSuccess(res, users.map((u) => toRow(u)));
}));

const userBody = {
  name: R.name(128),
  email: R.email(),
  phone: R.optional(R.phone()),
  zone: Joi.string().allow('', null).max(64),
  role: Joi.string().valid(...TENANT_ROLES)
};

router.post('/users', isAdmin,
  validate(Joi.object({ ...userBody, name: userBody.name.required(), email: userBody.email.required(), role: userBody.role.required(), password: R.optional(R.password()) })),
  ah(async (req, res) => {
    const b = req.body;
    const password = b.password || tempPassword();
    const user = await User.create({
      tenantId: req.tenantId, name: b.name, email: b.email, phone: b.phone || null, zone: b.zone || null, role: b.role,
      passwordHash: await bcrypt.hash(password, 10), mustChangePassword: true
    });
    const u = pick(toRow(user), USER_COLS);
    await activity.log(null, { tenantId: req.tenantId, userId: req.user.id, entityType: 'USER', entityId: u.id, action: 'USER_CREATED', message: `User ${u.name} (${ROLE_LABELS[u.role]}) added` });
    return sendSuccess(res, { user: u, temporaryPassword: password }, 'User added', 201);
  })
);

router.patch('/users/:id', isAdmin,
  validate(Joi.object({ ...userBody, isActive: Joi.boolean() }).min(1)),
  ah(async (req, res) => {
    const b = req.body;
    if (req.params.id === req.user.id && (b.isActive === false || (b.role && b.role !== 'TENANT_ADMIN'))) {
      throw ApiError.badRequest('You cannot deactivate yourself or remove your own admin role');
    }
    const user = await User.findOne({ where: { id: req.params.id, tenantId: req.tenantId }, attributes: USER_ATTRS });
    if (!user) throw ApiError.notFound('User');
    const changes = {};
    for (const k of ['name', 'email', 'phone', 'zone', 'role', 'isActive']) if (b[k] !== undefined) changes[k] = b[k] === '' ? null : b[k];
    await user.update(changes);
    return sendSuccess(res, pick(toRow(user), USER_COLS), 'User updated');
  })
);

router.post('/users/:id/reset-password', isAdmin, ah(async (req, res) => {
  const password = tempPassword();
  const user = await User.findOne({ where: { id: req.params.id, tenantId: req.tenantId }, attributes: ['id', 'email'] });
  if (!user) throw ApiError.notFound('User');
  await user.update({ passwordHash: await bcrypt.hash(password, 10), mustChangePassword: true });
  return sendSuccess(res, { email: user.email, temporaryPassword: password }, 'Password reset');
}));

/* ------------------------------- CUSTOMERS -------------------------------- */
const customerSchema = Joi.object({
  name: R.name(255).required(),
  clientType: Joi.string().valid('PSU_GOVT', 'TELECOM', 'BFSI', 'ENTERPRISE', 'OTHER').default('ENTERPRISE'),
  gstin: R.optional(R.gstin()),
  billingAddress: Joi.string().allow('', null),
  state: Joi.string().allow('', null).max(64),
  contactName: R.optional(R.name(128)),
  contactPhone: R.optional(R.phone()),
  contactEmail: R.optional(R.email()),
  creditDays: Joi.number().integer().min(0).max(365).default(30),
  billingFrequency: Joi.string().valid('MONTHLY', 'QUARTERLY').default('MONTHLY'),
  notes: R.optional(R.text(2000)),
  isActive: Joi.boolean().default(true)
});

router.get('/customers', ah(async (req, res) => sendSuccess(res, await db.many(
  `SELECT c.*, (SELECT COUNT(*) FROM sites s WHERE s.customer_id = c.id)::int AS site_count,
          (SELECT COUNT(*) FROM feasibility_requests f WHERE f.customer_id = c.id)::int AS request_count
     FROM customers c WHERE c.tenant_id = $1 ORDER BY c.name`, [req.tenantId]))));

/** Empty strings from the form become NULL in the database */
const nulls = (b) => Object.fromEntries(Object.entries(b).map(([k, v]) => [k, v === '' ? null : v]));

const saveCustomer = (isNew) => ah(async (req, res) => {
  const data = nulls(req.body);
  let row;
  if (isNew) row = await Customer.create({ ...data, tenantId: req.tenantId });
  else {
    row = await Customer.findOne({ where: { id: req.params.id, tenantId: req.tenantId } });
    if (!row) throw ApiError.notFound('Client');
    await row.update(data);
  }
  if (isNew) await activity.log(null, { tenantId: req.tenantId, userId: req.user.id, entityType: 'CUSTOMER', entityId: row.id, action: 'CUSTOMER_CREATED', message: `Client ${row.name} added` });
  return sendSuccess(res, toRow(row), isNew ? 'Client added' : 'Client updated', isNew ? 201 : 200);
});
router.post('/customers', requirePerm('masters.manage'), validate(customerSchema), saveCustomer(true));
router.put('/customers/:id', requirePerm('masters.manage'), validate(customerSchema), saveCustomer(false));

/* -------------------------------- VENDORS --------------------------------- */
const vendorSchema = Joi.object({
  name: R.name(255).required(),
  vendorType: Joi.string().valid('ISP', 'PARTNER', 'CONTRACTOR').default('ISP'),
  gstin: R.optional(R.gstin()),
  contactName: R.optional(R.name(128)),
  contactPhone: R.optional(R.phone()),
  contactEmail: R.optional(R.email()),
  paymentTermsDays: Joi.number().integer().min(0).max(365).default(30),
  bankDetails: Joi.string().allow('', null),
  // address — used later to find ISPs near a new feasibility site
  address: R.optional(R.text(1000)),
  city: R.optional(R.text(64)),
  state: R.optional(R.text(64)),
  pincode: R.optional(R.pincode()),
  mapsUrl: R.optional(R.url()),
  latitude: Joi.number().min(-90).max(90).allow(null, ''),
  longitude: Joi.number().min(-180).max(180).allow(null, ''),
  notes: R.optional(R.text(2000)),
  isActive: Joi.boolean().default(true)
});

/** Map location: typed latitude / longitude, else read from the Google Maps link */
const withLocation = (data) => {
  let { latitude, longitude } = data;
  if (latitude === '' || latitude === undefined) latitude = null;
  if (longitude === '' || longitude === undefined) longitude = null;
  if ((latitude === null || longitude === null) && data.mapsUrl) {
    const p = parseCoordinates(data.mapsUrl);
    if (p) ({ latitude, longitude } = p);
  }
  return { ...data, latitude, longitude };
};

/**
 * Everything that can point at a vendor (every foreign key to vendors). A vendor can be deleted only when all are 0;
 * otherwise mark it inactive so its history (surveys, quotes, sites, payouts) stays complete.
 */
const VENDOR_USAGE_SQL = `
  (SELECT COUNT(*) FROM feasibility_isp_options x WHERE x.vendor_id = v.id)::int AS survey_count,
  ((SELECT COUNT(*) FROM quote_options x WHERE x.vendor_id = v.id)
    + (SELECT COUNT(*) FROM quotes x WHERE x.final_vendor_id = v.id OR x.partner_vendor_id = v.id))::int AS quote_count,
  (SELECT COUNT(*) FROM sites x WHERE x.vendor_id = v.id)::int AS site_count,
  (SELECT COUNT(*) FROM sites x WHERE x.vendor_id = v.id AND x.status = 'LIVE')::int AS live_sites,
  (SELECT COUNT(*) FROM payouts x WHERE x.vendor_id = v.id)::int AS payout_count,
  (SELECT COUNT(*) FROM vendor_bills x WHERE x.vendor_id = v.id)::int AS bill_count`;
const USAGE = [['survey_count', 'survey'], ['quote_count', 'quote'], ['site_count', 'site'], ['payout_count', 'payout'], ['bill_count', 'ISP bill']];
const usageText = (v) => USAGE.filter(([k]) => v[k] > 0).map(([k, w]) => `${v[k]} ${w}${v[k] > 1 ? 's' : ''}`).join(', ');

router.get('/vendors', ah(async (req, res) => {
  const params = [req.tenantId];
  let where = 'v.tenant_id = $1';
  if (req.query.type) { params.push(req.query.type); where += ` AND v.vendor_type = $${params.length}`; }
  const rows = await db.many(`SELECT v.*, ${VENDOR_USAGE_SQL} FROM vendors v WHERE ${where} ORDER BY v.name`, params);
  return sendSuccess(res, rows.map((v) => ({ ...v, used_in: usageText(v) || null })));
}));

const saveVendor = (isNew) => ah(async (req, res) => {
  const data = withLocation(nulls(req.body));
  // Field engineers may add a missing ISP while recording a survey; everything else needs masters.manage
  if (!can(req.user.role, 'masters.manage')) {
    if (!isNew || data.vendorType !== 'ISP') throw ApiError.forbidden('You can only add a new ISP (from the survey); ask the admin for other vendors');
  }
  // The same company cannot be listed twice (e.g. "Jio" and "jio ")
  const dup = await db.one(
    'SELECT id, name FROM vendors WHERE tenant_id = $1 AND lower(btrim(name)) = lower(btrim($2)) AND ($3::uuid IS NULL OR id <> $3)',
    [req.tenantId, data.name, isNew ? null : req.params.id]);
  if (dup) throw ApiError.conflict(`${dup.name} is already in ISPs & Vendors`, [{ field: 'name', message: `${dup.name} is already in ISPs & Vendors` }]);
  let row;
  if (isNew) row = await Vendor.create({ ...data, tenantId: req.tenantId });
  else {
    row = await Vendor.findOne({ where: { id: req.params.id, tenantId: req.tenantId } });
    if (!row) throw ApiError.notFound('Vendor');
    await row.update(data);
  }
  if (isNew) await activity.log(null, { tenantId: req.tenantId, userId: req.user.id, entityType: 'VENDOR', entityId: row.id, action: 'VENDOR_CREATED', message: `Vendor ${row.name} (${row.vendorType}) added` });
  return sendSuccess(res, toRow(row), isNew ? 'Vendor added' : 'Vendor updated', isNew ? 201 : 200);
});
router.post('/vendors', requirePerm('masters.manage', 'feasibility.survey'), validate(vendorSchema), saveVendor(true));
router.put('/vendors/:id', requirePerm('masters.manage'), validate(vendorSchema), saveVendor(false));

/**
 * One ISP / vendor at a glance: the sites it supplies (or is partner on) at every stage, its surveys,
 * monthly cost of its live links and what we owe it. Prices need commercial.view; payables need treasury.view.
 */
router.get('/vendors/:id/overview', requirePerm('masters.view'), ah(async (req, res) => {
  const role = req.user.role;
  const v = await db.one(`SELECT v.*, ${VENDOR_USAGE_SQL} FROM vendors v WHERE v.id = $1 AND v.tenant_id = $2`, [req.params.id, req.tenantId]);
  if (!v) throw ApiError.notFound('Vendor');
  const sites = await db.many(
    `SELECT s.id, s.code, s.site_name, s.status, s.bandwidth_mbps, s.medium, s.link_role, s.static_ip_count, s.circuit_id, s.live_date, s.terminated_on,
            s.client_site_ref, s.contract_months, s.feasibility_id, c.name AS customer_name, o.name AS owner_name,
            CASE WHEN s.vendor_id = $1 THEN 'ISP' ELSE 'PARTNER' END AS relation,
            s.vendor_otc, s.vendor_mrc, s.vendor_ip_mrc, s.client_mrc, s.client_ip_mrc,
            COALESCE((SELECT SUM(i.vendor_cost) FROM invoices i WHERE i.site_id = s.id AND i.status <> 'CANCELLED'),0) AS accrued,
            COALESCE((SELECT SUM(p.amount) FROM payouts p WHERE p.site_id = s.id AND p.category = 'VENDOR'),0) AS paid
       FROM sites s JOIN quotes q ON q.id = s.quote_id JOIN customers c ON c.id = s.customer_id LEFT JOIN users o ON o.id = s.owner_id
      WHERE s.tenant_id = $2 AND (s.vendor_id = $1 OR q.partner_vendor_id = $1)
      ORDER BY CASE s.status WHEN 'LIVE' THEN 0 WHEN 'TERMINATED' THEN 2 ELSE 1 END, s.code`, [v.id, req.tenantId]);
  const surveys = await db.many(
    `SELECT f.id AS feasibility_id, f.code, f.site_name, f.status, c.name AS customer_name, o.is_feasible, o.medium, o.distance_m, o.remarks,
            o.vendor_otc, o.vendor_mrc, o.lead_time_days, o.created_at
       FROM feasibility_isp_options o JOIN feasibility_requests f ON f.id = o.feasibility_id JOIN customers c ON c.id = f.customer_id
      WHERE o.vendor_id = $1 AND f.tenant_id = $2 ORDER BY o.created_at DESC LIMIT 100`, [v.id, req.tenantId]);
  const live = sites.filter((s) => s.status === 'LIVE' && s.relation === 'ISP');
  const isp = sites.filter((s) => s.relation === 'ISP');
  const summary = {
    live: live.length,
    in_delivery: isp.filter((s) => !['LIVE', 'TERMINATED'].includes(s.status)).length,
    disconnected: isp.filter((s) => s.status === 'TERMINATED').length,
    partner_sites: sites.length - isp.length,
    live_bandwidth_mbps: live.reduce((a, s) => a + Number(s.bandwidth_mbps), 0),
    surveys: surveys.length,
    feasible: surveys.filter((x) => x.is_feasible).length
  };
  const money = can(role, 'commercial.view');
  const pay = can(role, 'treasury.view');
  if (money) {
    summary.monthly_cost = round2(live.reduce((a, s) => a + Number(s.vendor_mrc) + Number(s.vendor_ip_mrc), 0));
    summary.monthly_billing = round2(live.reduce((a, s) => a + Number(s.client_mrc) + Number(s.client_ip_mrc), 0));
  }
  if (pay) {
    summary.accrued = round2(isp.reduce((a, s) => a + Number(s.accrued), 0));
    summary.paid = round2((await db.one("SELECT COALESCE(SUM(amount),0) AS n FROM payouts WHERE tenant_id = $1 AND vendor_id = $2", [req.tenantId, v.id])).n);
    summary.outstanding = round2(summary.accrued - isp.reduce((a, s) => a + Number(s.paid), 0));
  }
  const strip = (r, keys) => { const o = { ...r }; keys.forEach((k) => delete o[k]); return o; };
  const PRICE = ['vendor_otc', 'vendor_mrc', 'vendor_ip_mrc', 'client_mrc', 'client_ip_mrc'];
  const payouts = pay ? await db.many(
    `SELECT p.id, p.paid_date, p.amount, p.reference, p.period_label, s.code AS site_code FROM payouts p LEFT JOIN sites s ON s.id = p.site_id
      WHERE p.tenant_id = $1 AND p.vendor_id = $2 ORDER BY p.paid_date DESC LIMIT 50`, [req.tenantId, v.id]) : null;
  // Link faults on its sites: open now, last 90 days, average time to restore, uptime of its live links (30 days)
  const f = await db.one(
    `SELECT COUNT(*) FILTER (WHERE restored_at IS NULL)::int AS open_now,
            COUNT(*) FILTER (WHERE reported_at > NOW() - INTERVAL '90 days')::int AS last_90d,
            ROUND(AVG(EXTRACT(EPOCH FROM (restored_at - reported_at)) / 3600) FILTER (WHERE restored_at IS NOT NULL AND reported_at > NOW() - INTERVAL '90 days'), 1) AS avg_restore_hours
       FROM site_faults WHERE vendor_id = $1 AND tenant_id = $2`, [v.id, req.tenantId]);
  const faults = await db.many(
    `SELECT f.id, f.reported_at, f.restored_at, f.docket_no, f.description, f.cause, s.code AS site_code, s.site_name, s.feasibility_id,
            ROUND(EXTRACT(EPOCH FROM (COALESCE(f.restored_at, NOW()) - f.reported_at)) / 60)::int AS down_minutes
       FROM site_faults f JOIN sites s ON s.id = f.site_id WHERE f.vendor_id = $1 AND f.tenant_id = $2 ORDER BY f.reported_at DESC LIMIT 50`, [v.id, req.tenantId]);
  Object.assign(summary, { faults_open: f.open_now, faults_90d: f.last_90d, avg_restore_hours: f.avg_restore_hours === null ? null : Number(f.avg_restore_hours) });
  const seeBills = can(role, 'billing.view') || can(role, 'treasury.view');
  const bills = seeBills ? await vendorBills(req.tenantId, v.id) : null;
  if (bills) {
    summary.isp_billed = round2(bills.reduce((a, b) => a + Number(b.amount), 0));
    summary.isp_bills_mismatch = bills.filter((b) => b.mismatch).length;
  }
  return sendSuccess(res, {
    vendor: { ...v, used_in: usageText(v) || null },
    summary,
    faults,
    bills,
    sites: sites.map((s) => strip(s, [...(money ? [] : PRICE), ...(pay ? [] : ['accrued', 'paid'])])),
    surveys: surveys.map((x) => (money ? x : strip(x, ['vendor_otc', 'vendor_mrc']))),
    payouts
  });
}));

/* ---------------- The ISP's own bills to us, checked against the cost we accrued for that period ---------------- */
const vendorBills = async (tenantId, vendorId) => (await db.many(
  `SELECT b.*, s.code AS site_code, s.site_name, u.name AS created_by_name FROM vendor_bills b LEFT JOIN sites s ON s.id = b.site_id LEFT JOIN users u ON u.id = b.created_by
    WHERE b.tenant_id = $1 AND b.vendor_id = $2 ORDER BY b.bill_date DESC, b.created_at DESC`, [tenantId, vendorId]))
  .map((b) => ({ ...b, difference: round2(Number(b.amount) - Number(b.expected_amount)), mismatch: Math.abs(Number(b.amount) - Number(b.expected_amount)) > 1 }));

/** What we expected this ISP to bill for a period: the ISP cost booked on our bills of its sites whose period starts in it */
const expectedCost = (c, tenantId, vendorId, from, to, siteId) => c.one(
  `SELECT COALESCE(SUM(i.vendor_cost),0) AS n FROM invoices i JOIN sites s ON s.id = i.site_id
    WHERE i.tenant_id = $1 AND s.vendor_id = $2 AND i.status <> 'CANCELLED' AND i.period_start BETWEEN $3 AND $4 ${siteId ? 'AND s.id = $5' : ''}`,
  siteId ? [tenantId, vendorId, from, to, siteId] : [tenantId, vendorId, from, to]).then((r) => round2(r.n));

router.get('/vendors/:id/bills', requirePerm('billing.view', 'treasury.view'), ah(async (req, res) => {
  if (!await db.one('SELECT 1 FROM vendors WHERE id = $1 AND tenant_id = $2', [req.params.id, req.tenantId])) throw ApiError.notFound('Vendor');
  return sendSuccess(res, await vendorBills(req.tenantId, req.params.id));
}));

router.post('/vendors/:id/bills', requirePerm('billing.manage', 'treasury.manage'), validate(Joi.object({
  billNumber: Joi.string().trim().min(1).max(64).required(),
  billDate: Joi.date().iso().custom(notFuture).required(),
  periodFrom: Joi.date().iso().required(),
  periodTo: Joi.date().iso().min(Joi.ref('periodFrom')).required().messages({ 'date.min': 'Period to cannot be before period from' }),
  amount: Joi.number().min(0).required().description('Bill amount before GST'),
  gstAmount: Joi.number().min(0).default(0),
  siteId: Joi.string().uuid().allow(null, '').description('Only when the bill is for one site'),
  notes: Joi.string().allow('', null).max(2000)
})), ah(async (req, res) => {
  const b = req.body;
  const iso = (d) => d.toISOString().slice(0, 10);
  const v = await db.one('SELECT id, name, payment_terms_days FROM vendors WHERE id = $1 AND tenant_id = $2', [req.params.id, req.tenantId]);
  if (!v) throw ApiError.notFound('Vendor');
  if (b.siteId && !await db.one('SELECT 1 FROM sites WHERE id = $1 AND tenant_id = $2 AND vendor_id = $3', [b.siteId, req.tenantId, v.id])) {
    throw ApiError.badRequest(`That site is not with ${v.name}`, [{ field: 'siteId', message: `Not a ${v.name} site` }]);
  }
  if (await db.one('SELECT 1 FROM vendor_bills WHERE vendor_id = $1 AND lower(bill_number) = lower($2)', [v.id, b.billNumber])) {
    throw ApiError.conflict(`${v.name} bill ${b.billNumber} is already recorded`, [{ field: 'billNumber', message: 'Already recorded' }]);
  }
  const bill = await db.tx(async (c) => {
    const expected = await expectedCost(c, req.tenantId, v.id, iso(b.periodFrom), iso(b.periodTo), b.siteId || null);
    const due = iso(new Date(b.billDate.getTime() + v.payment_terms_days * 86400000));
    const row = await c.one(
      `INSERT INTO vendor_bills (tenant_id, vendor_id, site_id, bill_number, bill_date, period_from, period_to, amount, gst_amount, expected_amount, due_date, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
      [req.tenantId, v.id, b.siteId || null, b.billNumber, iso(b.billDate), iso(b.periodFrom), iso(b.periodTo), b.amount, b.gstAmount, expected, due, b.notes || null, req.user.id]);
    const diff = round2(b.amount - expected);
    await activity.log(c, { tenantId: req.tenantId, userId: req.user.id, entityType: 'VENDOR', entityId: v.id, action: 'VENDOR_BILL_RECORDED',
      message: `${v.name} bill ${b.billNumber} (${iso(b.periodFrom)} – ${iso(b.periodTo)}) recorded: ${inr(b.amount)} + GST ${inr(b.gstAmount)}; expected ${inr(expected)}${Math.abs(diff) > 1 ? ` — ${inr(Math.abs(diff))} ${diff > 0 ? 'more' : 'less'} than expected` : ' — matches'}` });
    return row;
  });
  const diff = round2(Number(bill.amount) - Number(bill.expected_amount));
  return sendSuccess(res, { ...bill, difference: diff, mismatch: Math.abs(diff) > 1 },
    Math.abs(diff) > 1 ? `Bill recorded — ${inr(Math.abs(diff))} ${diff > 0 ? 'more' : 'less'} than the expected ${inr(bill.expected_amount)}: check it with the ISP` : 'Bill recorded — matches the expected cost', 201);
}));

router.delete('/vendors/:id/bills/:billId', requirePerm('billing.manage', 'treasury.manage'), ah(async (req, res) => {
  const b = await db.one('SELECT b.*, v.name AS vendor_name FROM vendor_bills b JOIN vendors v ON v.id = b.vendor_id WHERE b.id = $1 AND b.vendor_id = $2 AND b.tenant_id = $3', [req.params.billId, req.params.id, req.tenantId]);
  if (!b) throw ApiError.notFound('ISP bill');
  await db.tx(async (c) => {
    await c.query('DELETE FROM vendor_bills WHERE id = $1', [b.id]);
    await activity.log(c, { tenantId: req.tenantId, userId: req.user.id, entityType: 'VENDOR', entityId: b.vendor_id, action: 'VENDOR_BILL_DELETED', message: `${b.vendor_name} bill ${b.bill_number} removed (entered by mistake)` });
  });
  return sendSuccess(res, { id: b.id }, `Bill ${b.bill_number} removed`);
}));

/** Remove a vendor added by mistake: only if no survey, quote, site or payout uses it */
router.delete('/vendors/:id', requirePerm('masters.manage'), ah(async (req, res) => {
  const name = await db.tx(async (c) => {
    // Lock the vendor row so nothing can start using it between the check and the removal
    const v = await c.one(`SELECT v.id, v.name, ${VENDOR_USAGE_SQL} FROM vendors v WHERE v.id = $1 AND v.tenant_id = $2 FOR UPDATE OF v`, [req.params.id, req.tenantId]);
    if (!v) throw ApiError.notFound('Vendor');
    const used = usageText(v);
    if (used) throw ApiError.conflict(`${v.name} cannot be deleted: it is used in ${used}. Mark it inactive instead, so it is hidden from new surveys and quotes.`);
    await c.query('DELETE FROM vendors WHERE id = $1 AND tenant_id = $2', [v.id, req.tenantId]);
    await activity.log(c, { tenantId: req.tenantId, userId: req.user.id, entityType: 'VENDOR', entityId: v.id, action: 'VENDOR_DELETED', message: `Vendor ${v.name} deleted (it was not used anywhere)` });
    return v.name;
  });
  return sendSuccess(res, { id: req.params.id }, `${name} deleted`);
}));

/* -------------------------------- SETTINGS -------------------------------- */
const SETTINGS_SQL = 'SELECT s.*, t.name AS company_name, t.gstin AS company_gstin, t.address AS company_address, t.state AS company_state FROM tenant_settings s JOIN tenants t ON t.id = s.tenant_id WHERE s.tenant_id = $1';

router.get('/settings', ah(async (req, res) => sendSuccess(res, await db.one(SETTINGS_SQL, [req.tenantId]))));

router.put('/settings', requirePerm('settings.manage'),
  validate(Joi.object({
    gstPct: Joi.number().min(0).max(40).required(),
    defaultVendorPct: Joi.number().min(0).max(100).required(),
    defaultPartnerPct: Joi.number().min(0).max(100).required(),
    defaultCapexPct: Joi.number().min(0).max(100).required(),
    defaultContractMonths: Joi.number().integer().min(1).max(120).required(),
    defaultCreditDays: Joi.number().integer().min(0).max(365).required(),
    defaultSlaDays: Joi.number().integer().min(1).max(365).required(),
    monthlySalaryBurn: Joi.number().min(0).required(),
    salaryReserveMonths: Joi.number().integer().min(0).max(24).required(),
    loanEmiMonthly: Joi.number().min(0).required(),
    loanAccountRef: R.optional(R.text(128)),
    authorityLabel: R.name(64).required(),
    invoicePrefix: R.invoicePrefix().required(),
    companyGstin: R.optional(R.gstin()),
    companyAddress: Joi.string().allow('', null),
    companyState: Joi.string().allow('', null).max(64)
  })),
  ah(async (req, res) => {
    const { companyGstin, companyAddress, companyState, ...settings } = nulls(req.body);
    const total = Number(settings.defaultVendorPct) + Number(settings.defaultPartnerPct) + Number(settings.defaultCapexPct);
    if (Math.abs(total - 100) > 0.01) throw ApiError.badRequest(`Default budget A + B + C must equal 100% (now ${total}%)`);
    await db.tx(async (c) => {
      await TenantSetting.update(settings, { where: { tenantId: req.tenantId }, transaction: c.transaction });
      await Tenant.update({ gstin: companyGstin, address: companyAddress, state: companyState }, { where: { id: req.tenantId }, transaction: c.transaction });
      await activity.log(c, { tenantId: req.tenantId, userId: req.user.id, entityType: 'SETTINGS', action: 'SETTINGS_UPDATED', message: 'Company settings updated' });
    });
    return sendSuccess(res, await db.one(SETTINGS_SQL, [req.tenantId]), 'Settings saved');
  })
);

/* -------------------------------- ACTIVITY -------------------------------- */
// Each role only sees activity for the modules it may view (e.g. surveyors never see payments).
const ACTIVITY_PERM = {
  ORDER: 'orders.view', FEASIBILITY: 'feasibility.view', QUOTE: 'commercial.view', SITE: 'implementation.view', INVOICE: 'billing.view',
  RECEIPT: 'treasury.view', PAYOUT: 'treasury.view', CUSTOMER: 'masters.view', VENDOR: 'masters.view',
  USER: 'users.manage', TENANT: 'users.manage', SETTINGS: 'settings.manage'
};
router.get('/activity', ah(async (req, res) => {
  const allowed = Object.entries(ACTIVITY_PERM).filter(([, p]) => can(req.user.role, p)).map(([t]) => t);
  const params = [req.tenantId, allowed];
  let where = "a.tenant_id = $1 AND a.entity_type = ANY($2) AND a.action <> 'LOGIN'";
  if (req.query.entityId) { params.push(req.query.entityId); where += ` AND a.entity_id = $${params.length}`; }
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  return sendSuccess(res, activity.redactMoney(req.user.role, await db.many(
    `SELECT a.*, u.name AS user_name FROM activity_log a LEFT JOIN users u ON u.id = a.user_id WHERE ${where} ORDER BY a.created_at DESC LIMIT ${limit}`, params)));
}));

guardIds(router, ['id', 'billId']);

module.exports = router;
