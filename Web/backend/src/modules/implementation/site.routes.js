/**
 * ③ IMPLEMENTATION TRACKER
 * PO received → ISP work start → (Pending with client / ISP / our own company / customer at site / authority) → Details of site live
 * Site live → automatic 1st bill: OTC + 1st cycle MRC in one invoice (Billing).
 * The field engineer who owns the site (from feasibility) runs work start → pending items → go-live;
 * Operations / Admin record the client PO (one PO may cover many sites) and can reassign owners.
 * Live sites: a register of every running link (contract end, next bill, ISP cost, uptime); Renew; Disconnect (stops billing);
 * Reconnect (billing restarts from that date); bandwidth / price change from a billing cycle; link faults with the ISP (downtime, uptime).
 * Money (client / ISP prices, PO value) is shown only to roles that may see commercials.
 */
const router = require('express').Router();
const Joi = require('joi');
const { R, guardIds } = require('../../validation/rules');
const db = require('../../config/db');
const ApiError = require('../../utils/apiError');
const { ah, assertStatus, addDays, addMonths, today, daysBetween, notFuture, inr, round2, TIMEZONE, dmy } = require('../../utils/helpers');
const { ownsOnly, can } = require('../../constants/roles');
const { sendSuccess } = require('../../utils/response');
const validate = require('../../middlewares/validate.middleware');
const { authenticate, requireTenant, requirePerm } = require('../../middlewares/auth.middleware');
const activity = require('../../utils/activity');
const billing = require('../billing/billing.engine');

router.use(authenticate, requireTenant);

const LIST_SQL = `
  SELECT s.*, c.name AS customer_name, c.client_type, v.name AS vendor_name, q.code AS quote_code, f.code AS feasibility_code, o.name AS owner_name,
    co.code AS order_code, co.client_ref AS order_client_ref, q.finalized_value, tb.name AS terminated_by_name,
    (SELECT COUNT(*) FROM site_blockers b WHERE b.site_id = s.id AND b.resolved_at IS NULL)::int AS open_blockers,
    (SELECT json_build_object('id', b.id, 'party', b.party, 'reason', b.reason, 'raised_at', b.raised_at)
       FROM site_blockers b WHERE b.site_id = s.id AND b.resolved_at IS NULL ORDER BY b.raised_at DESC LIMIT 1) AS current_blocker,
    (SELECT COUNT(*) FROM documents d WHERE d.entity_type = 'SITE' AND d.entity_id = s.id AND d.doc_type = 'PO_COPY')::int AS po_docs,
    (SELECT COUNT(*) FROM documents d WHERE d.entity_type = 'SITE' AND d.entity_id = s.id AND d.doc_type = 'AT_SIGNOFF')::int AS at_docs,
    (SELECT qo.sla_pct FROM quote_options qo WHERE qo.quote_id = s.quote_id AND qo.option_no = q.won_option_no) AS sla_pct,
    (SELECT json_build_object('id', sf.id, 'reported_at', sf.reported_at, 'docket_no', sf.docket_no, 'description', sf.description)
       FROM site_faults sf WHERE sf.site_id = s.id AND sf.restored_at IS NULL LIMIT 1) AS open_fault,
    (SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (COALESCE(sf.restored_at, NOW()) - GREATEST(sf.reported_at, NOW() - INTERVAL '30 days'))) / 60), 0)
       FROM site_faults sf WHERE sf.site_id = s.id AND COALESCE(sf.restored_at, NOW()) > NOW() - INTERVAL '30 days')::int AS down_minutes_30d
  FROM sites s
  JOIN customers c ON c.id = s.customer_id
  JOIN vendors v ON v.id = s.vendor_id
  JOIN quotes q ON q.id = s.quote_id
  JOIN feasibility_requests f ON f.id = s.feasibility_id
  LEFT JOIN users o ON o.id = s.owner_id
  LEFT JOIN users tb ON tb.id = s.terminated_by
  LEFT JOIN client_orders co ON co.id = s.order_id`;

const decorate = (s) => {
  if (s.work_start_date && !s.live_date) {
    s.days_elapsed = daysBetween(s.work_start_date, today());
    s.sla_overdue = s.target_live_date ? today() > s.target_live_date : false;
  } else if (s.work_start_date && s.live_date) {
    s.days_elapsed = daysBetween(s.work_start_date, s.live_date);
    s.sla_overdue = s.target_live_date ? s.live_date > s.target_live_date : false;
  }
  if (s.live_date) {
    // Contract runs contract_months from its start (the live date, or a restart on reconnection)
    s.contract_end = addDays(addMonths(s.contract_start || s.live_date, s.contract_months), -1);
    s.contract_days_left = s.status === 'LIVE' ? daysBetween(today(), s.contract_end) : null;
    // Uptime over the last 30 days (or since the link went live / was reconnected, if later)
    const since = s.billing_start || s.live_date;
    const windowMin = Math.max(1, Math.min(30 * 1440, (daysBetween(since, today()) + 1) * 1440));
    s.uptime_30d = s.status === 'LIVE' ? Math.max(0, Math.round((1 - Number(s.down_minutes_30d || 0) / windowMin) * 10000) / 100) : null;
  }
  return s;
};

/** Hide prices from roles that may not see commercials (e.g. field engineers) */
const MONEY_FIELDS = ['client_otc', 'client_mrc', 'client_ip_mrc', 'vendor_otc', 'vendor_mrc', 'vendor_ip_mrc', 'finalized_value', 'po_value', 'reconnect_charge', 'reconnect_vendor_charge'];
const REV_MONEY = ['old_client_mrc', 'new_client_mrc', 'old_client_ip_mrc', 'new_client_ip_mrc', 'old_vendor_mrc', 'new_vendor_mrc', 'old_vendor_ip_mrc', 'new_vendor_ip_mrc'];
const scrub = (role, s) => {
  if (can(role, 'commercial.view')) return s;
  const out = { ...s };
  MONEY_FIELDS.forEach((k) => delete out[k]);
  if (out.revisions) out.revisions = out.revisions.map((r) => { const x = { ...r }; REV_MONEY.forEach((k) => delete x[k]); return x; });
  return out;
};
const detailFor = async (req, id) => scrub(req.user.role, await detail(req.tenantId, id));

const load = async (tenantId, id) => {
  const s = await db.one(`${LIST_SQL} WHERE s.tenant_id = $1 AND s.id = $2`, [tenantId, id]);
  if (!s) throw ApiError.notFound('Site');
  return decorate(s);
};

const detail = async (tenantId, id) => {
  const s = await load(tenantId, id);
  s.blockers = await db.many(
    `SELECT b.*, r.name AS raised_by_name, x.name AS resolved_by_name,
       EXTRACT(DAY FROM (COALESCE(b.resolved_at, NOW()) - b.raised_at))::int AS days_pending
     FROM site_blockers b LEFT JOIN users r ON r.id = b.raised_by LEFT JOIN users x ON x.id = b.resolved_by
     WHERE b.site_id = $1 ORDER BY b.raised_at DESC`, [id]);
  s.revisions = await db.many(
    `SELECT r.*, u.name AS created_by_name FROM site_revisions r LEFT JOIN users u ON u.id = r.created_by WHERE r.site_id = $1 ORDER BY r.from_cycle DESC`, [id]);
  s.faults = await db.many(
    `SELECT f.*, a.name AS reported_by_name, b.name AS restored_by_name,
       ROUND(EXTRACT(EPOCH FROM (COALESCE(f.restored_at, NOW()) - f.reported_at)) / 60)::int AS down_minutes
     FROM site_faults f LEFT JOIN users a ON a.id = f.reported_by LEFT JOIN users b ON b.id = f.restored_by
     WHERE f.site_id = $1 ORDER BY f.reported_at DESC LIMIT 100`, [id]);
  return s;
};

router.get('/', requirePerm('implementation.view'), ah(async (req, res) => {
  const params = [req.tenantId];
  let where = 's.tenant_id = $1';
  if (req.query.status) { params.push(String(req.query.status).split(',')); where += ` AND s.status = ANY($${params.length})`; }
  if (req.query.mine === '1') { params.push(req.user.id); where += ` AND s.owner_id = $${params.length}`; }
  if (req.query.customerId) { params.push(req.query.customerId); where += ` AND s.customer_id = $${params.length}`; }
  if (req.query.orderId) { params.push(req.query.orderId); where += ` AND s.order_id = $${params.length}`; }
  const rows = await db.many(`${LIST_SQL} WHERE ${where} ORDER BY s.created_at DESC`, params);
  return sendSuccess(res, rows.map((r) => scrub(req.user.role, decorate(r))));
}));

/**
 * Live sites register: every live (and disconnected) link in one list, with contract end, next bill,
 * monthly price / ISP cost / margin (commercial roles) and billed / received / outstanding (billing roles).
 */
router.get('/register', requirePerm('implementation.view'), ah(async (req, res) => {
  const role = req.user.role;
  const rows = await db.many(
    `${LIST_SQL.replace('FROM sites s', `,
       (SELECT COALESCE(SUM(i.total_amount - i.credit_amount),0) FROM invoices i WHERE i.site_id = s.id AND i.status <> 'CANCELLED') AS billed,
       (SELECT COALESCE(SUM(i.amount_received + i.tds_amount),0) FROM invoices i WHERE i.site_id = s.id AND i.status <> 'CANCELLED') AS received,
       (SELECT COUNT(*) FROM invoices i WHERE i.site_id = s.id AND i.status IN ('SUBMITTED','PARTIALLY_PAID') AND i.due_date < CURRENT_DATE)::int AS overdue_bills
     FROM sites s`)}
     WHERE s.tenant_id = $1 AND s.status IN ('LIVE','TERMINATED') ${req.query.mine === '1' ? 'AND s.owner_id = $2' : ''}
     ORDER BY s.status, s.live_date DESC`, req.query.mine === '1' ? [req.tenantId, req.user.id] : [req.tenantId]);
  const out = rows.map((r) => {
    const x = decorate(r);
    if (x.status === 'LIVE') x.next_bill_date = billing.cycleStart(x, Number(x.last_cycle_no) + 1);
    x.monthly_price = round2(Number(x.client_mrc) + Number(x.client_ip_mrc));
    x.monthly_cost = round2(Number(x.vendor_mrc) + Number(x.vendor_ip_mrc));
    x.monthly_margin = round2(x.monthly_price - x.monthly_cost);
    x.outstanding = Math.max(0, round2(Number(x.billed) - Number(x.received)));
    if (!can(role, 'commercial.view')) ['monthly_price', 'monthly_cost', 'monthly_margin'].forEach((f) => delete x[f]);
    if (!can(role, 'billing.view')) ['billed', 'received', 'outstanding', 'overdue_bills'].forEach((f) => delete x[f]);
    return scrub(role, x);
  });
  return sendSuccess(res, out);
}));

router.get('/:id', requirePerm('implementation.view'), ah(async (req, res) => sendSuccess(res, await detailFor(req, req.params.id))));

const logSite = (c, req, s, action, message, meta) =>
  activity.log(c, { tenantId: req.tenantId, userId: req.user.id, entityType: 'SITE', entityId: s.id, action, message, meta });

/** Delivery actions: managers on any site, field engineers only on the sites they own */
const canDeliver = requirePerm('implementation.manage', 'implementation.execute');
const assertOwner = (req, s) => {
  if (ownsOnly(req.user.role) && s.owner_id !== req.user.id) {
    throw ApiError.forbidden(`${s.code} is owned by ${s.owner_name || 'another engineer'} — ask Operations to reassign it to you`);
  }
};

/** Readable name of the party a site is "pending with" */
const partyName = async (tenantId, s, party) => {
  if (party === 'CLIENT') return `${s.customer_name} (client)`;
  if (party === 'VENDOR') return `${s.vendor_name} (ISP)`;
  if (party === 'CUSTOMER') return 'customer at site';
  if (party === 'COMPANY') return `${(await db.one('SELECT name FROM tenants WHERE id = $1', [tenantId])).name} (internal)`;
  const st = await db.one('SELECT authority_label FROM tenant_settings WHERE tenant_id = $1', [tenantId]);
  if (party === 'AUTHORITY') return st?.authority_label || 'Authority';
  return 'other';
};

const poSchema = {
  poNumber: Joi.string().trim().max(64).required(),
  poDate: Joi.date().iso().custom(notFuture).required()
};

/** One client PO covering several sites of the same client (e.g. one PO for 5 sites) */
router.post('/po-bulk', requirePerm('implementation.manage'), validate(Joi.object({
  ...poSchema,
  items: Joi.array().min(1).max(200).unique('siteId').items(Joi.object({
    siteId: Joi.string().uuid().required(),
    poValue: Joi.number().greater(0).required()
  })).required().messages({ 'array.unique': 'Each site can appear only once' })
})), ah(async (req, res) => {
  const b = req.body;
  const poDate = b.poDate.toISOString().slice(0, 10);
  const ids = b.items.map((i) => i.siteId);
  const sites = await db.many(`${LIST_SQL} WHERE s.tenant_id = $1 AND s.id = ANY($2)`, [req.tenantId, ids]);
  if (sites.length !== ids.length) throw ApiError.badRequest('One or more sites were not found');
  const clients = [...new Set(sites.map((x) => x.customer_id))];
  if (clients.length > 1) throw ApiError.badRequest('A PO can cover sites of one client only');
  const wrong = sites.filter((x) => !['AWAITING_PO', 'PO_RECEIVED'].includes(x.status));
  if (wrong.length) throw ApiError.conflict(`Already past PO stage: ${wrong.map((x) => x.code).join(', ')}`);
  await db.tx(async (c) => {
    for (const it of b.items) {
      const st = sites.find((x) => x.id === it.siteId);
      await c.query(`UPDATE sites SET po_number = $2, po_date = $3, po_value = $4, po_received_at = NOW(), status = 'PO_RECEIVED', updated_at = NOW() WHERE id = $1`,
        [it.siteId, b.poNumber, poDate, it.poValue]);
      await logSite(c, req, st, 'SITE_PO_RECEIVED', `${st.code} PO received: ${b.poNumber} dated ${poDate}, value ${inr(it.poValue)} (one PO for ${b.items.length} sites)`);
    }
  });
  const total = b.items.reduce((a, i) => a + i.poValue, 0);
  return sendSuccess(res, { poNumber: b.poNumber, sites: b.items.length, total },
    `PO ${b.poNumber} recorded for ${b.items.length} site(s) of ${sites[0].customer_name}. Upload the PO copy on any one of them.`);
}));

/** Reassign the delivery owner (field engineer) */
router.post('/:id/owner', requirePerm('implementation.manage'), validate(Joi.object({ ownerId: Joi.string().uuid().required() })), ah(async (req, res) => {
  const s = await load(req.tenantId, req.params.id);
  if (['LIVE', 'TERMINATED'].includes(s.status)) throw ApiError.conflict(`${s.code} is already ${s.status.toLowerCase()}`);
  const o = await db.one('SELECT id, name, role FROM users WHERE id = $1 AND tenant_id = $2 AND is_active', [req.body.ownerId, req.tenantId]);
  if (!o) throw ApiError.badRequest('Owner must be an active user');
  if (!can(o.role, 'implementation.execute')) throw ApiError.badRequest(`${o.name} cannot run site delivery`);
  await db.tx(async (c) => {
    await c.query('UPDATE sites SET owner_id = $2, updated_at = NOW() WHERE id = $1', [s.id, o.id]);
    await logSite(c, req, s, 'SITE_OWNER_CHANGED', `${s.code} delivery owner changed${s.owner_name ? ` from ${s.owner_name}` : ''} to ${o.name}`);
  });
  return sendSuccess(res, await detailFor(req, s.id), `Owner set to ${o.name}`);
}));

router.post('/:id/po', requirePerm('implementation.manage'), validate(Joi.object({
  ...poSchema,
  poValue: Joi.number().greater(0).required()
})), ah(async (req, res) => {
  const s = await load(req.tenantId, req.params.id);
  assertStatus(s, ['AWAITING_PO', 'PO_RECEIVED'], 'record the PO');
  const b = req.body;
  const poDate = b.poDate.toISOString().slice(0, 10);
  await db.tx(async (c) => {
    await c.query(`UPDATE sites SET po_number = $2, po_date = $3, po_value = $4, po_received_at = NOW(), status = 'PO_RECEIVED', updated_at = NOW() WHERE id = $1`,
      [s.id, b.poNumber, poDate, b.poValue]);
    await logSite(c, req, s, 'SITE_PO_RECEIVED', `${s.code} PO received: ${b.poNumber} dated ${poDate}, value ${inr(b.poValue)}`);
  });
  return sendSuccess(res, await detailFor(req, s.id), 'PO recorded. Upload the PO copy in Documents.');
}));

router.post('/:id/work-start', canDeliver, validate(Joi.object({
  workOrderNo: Joi.string().trim().max(64).required(),
  workStartDate: R.pastDate().required(),
  slaDays: Joi.number().integer().min(1).max(365).required(),
  ownerId: Joi.string().uuid().allow(null, '')
})), ah(async (req, res) => {
  const s = await load(req.tenantId, req.params.id);
  assertStatus(s, ['PO_RECEIVED'], 'start ISP work');
  assertOwner(req, s);
  const b = req.body;
  if (ownsOnly(req.user.role)) b.ownerId = req.user.id;
  const start = b.workStartDate.toISOString().slice(0, 10);
  if (s.po_date && start < s.po_date) throw ApiError.badRequest('Work start date cannot be before the PO date');
  if (b.ownerId) {
    const o = await db.one('SELECT id, role FROM users WHERE id = $1 AND tenant_id = $2 AND is_active', [b.ownerId, req.tenantId]);
    if (!o) throw ApiError.badRequest('Owner must be an active user');
    if (!can(o.role, 'implementation.execute')) throw ApiError.badRequest('Owner must be a field engineer, operations user or admin');
  }
  const target = addDays(start, b.slaDays);
  await db.tx(async (c) => {
    await c.query(`UPDATE sites SET work_order_no = $2, work_start_date = $3, sla_days = $4, target_live_date = $5, owner_id = $6, status = 'WORK_STARTED', updated_at = NOW() WHERE id = $1`,
      [s.id, b.workOrderNo, start, b.slaDays, target, b.ownerId || s.owner_id || null]);
    await logSite(c, req, s, 'SITE_WORK_STARTED', `${s.code} ISP work started with ${s.vendor_name} (WO ${b.workOrderNo}); target live ${target}`);
  });
  return sendSuccess(res, await detailFor(req, s.id), 'ISP work started');
}));

router.post('/:id/blockers', canDeliver, validate(Joi.object({
  party: Joi.string().valid('CLIENT', 'VENDOR', 'COMPANY', 'CUSTOMER', 'AUTHORITY', 'OTHER').required(),
  reason: Joi.string().trim().min(3).max(2000).required()
})), ah(async (req, res) => {
  const s = await load(req.tenantId, req.params.id);
  assertStatus(s, ['WORK_STARTED', 'BLOCKED'], 'raise a pending item');
  assertOwner(req, s);
  const who = await partyName(req.tenantId, s, req.body.party);
  await db.tx(async (c) => {
    await c.query('INSERT INTO site_blockers (tenant_id, site_id, party, reason, raised_by) VALUES ($1,$2,$3,$4,$5)', [req.tenantId, s.id, req.body.party, req.body.reason, req.user.id]);
    await c.query("UPDATE sites SET status = 'BLOCKED', updated_at = NOW() WHERE id = $1", [s.id]);
    await logSite(c, req, s, 'SITE_BLOCKED', `${s.code} pending with ${who}: ${req.body.reason}`);
  });
  return sendSuccess(res, await detailFor(req, s.id), 'Pending item raised');
}));

router.post('/:id/blockers/:blockerId/resolve', canDeliver, validate(Joi.object({
  resolution: Joi.string().trim().min(3).max(2000).required()
})), ah(async (req, res) => {
  const s = await load(req.tenantId, req.params.id);
  assertOwner(req, s);
  const b = await db.one('SELECT * FROM site_blockers WHERE id = $1 AND site_id = $2', [req.params.blockerId, s.id]);
  if (!b) throw ApiError.notFound('Pending item');
  if (b.resolved_at) throw ApiError.conflict('This pending item is already resolved');
  const who = await partyName(req.tenantId, s, b.party);
  await db.tx(async (c) => {
    await c.query('UPDATE site_blockers SET resolved_at = NOW(), resolved_by = $2, resolution = $3 WHERE id = $1', [b.id, req.user.id, req.body.resolution]);
    const open = await c.one('SELECT COUNT(*)::int AS n FROM site_blockers WHERE site_id = $1 AND resolved_at IS NULL', [s.id]);
    if (open.n === 0) await c.query("UPDATE sites SET status = 'WORK_STARTED', updated_at = NOW() WHERE id = $1", [s.id]);
    await logSite(c, req, s, 'SITE_UNBLOCKED', `${s.code} pending with ${who} resolved: ${req.body.resolution}`);
  });
  return sendSuccess(res, await detailFor(req, s.id), 'Pending item resolved');
}));

router.post('/:id/live', canDeliver, validate(Joi.object({
  liveDate: Joi.date().iso().custom(notFuture).required(),
  circuitId: Joi.string().trim().max(64).required(),
  wanIp: R.ipv4Cidr().required(),
  subnetMask: R.optional(R.ipv4()),
  gatewayIp: R.optional(R.ipv4()),
  primaryDns: R.optional(R.ipv4()),
  secondaryDns: R.optional(R.ipv4()),
  latencyMs: Joi.number().min(0).max(10000).allow(null, ''),
  packetLossPct: Joi.number().min(0).max(100).allow(null, ''),
  mrtgUrl: R.optional(R.url()),
  staticIpBlock: R.optional(R.ipv4Cidr()).description('Static IP / block allotted, e.g. 103.21.4.8/29 (required when the site needs static IPs)'),
  atSignoffDate: R.pastDate().required(),
  atSignedBy: Joi.string().trim().max(128).required(),
  remarks: Joi.string().allow('', null).max(2000)
})), ah(async (req, res) => {
  const s = await load(req.tenantId, req.params.id);
  assertOwner(req, s);
  if (s.status === 'BLOCKED') throw ApiError.conflict(`Resolve the open pending item(s) before marking ${s.code} live`);
  assertStatus(s, ['WORK_STARTED'], 'mark the site live');
  const b = req.body;
  const liveDate = b.liveDate.toISOString().slice(0, 10);
  if (liveDate < s.work_start_date) throw ApiError.badRequest('Live date cannot be before the work start date');
  if (b.atSignoffDate.toISOString().slice(0, 10) < s.work_start_date) throw ApiError.badRequest('AT sign-off date cannot be before the work start date');
  const n = (v) => (v === '' || v === undefined ? null : v);
  if (s.static_ip_count > 0 && !n(b.staticIpBlock)) {
    throw ApiError.badRequest(`Enter the static IP block allotted (${s.static_ip_count} IPs needed)`, [{ field: 'staticIpBlock', message: `Enter the static IP block allotted (${s.static_ip_count} IPs needed)` }]);
  }
  const invoices = await db.tx(async (c) => {
    const site = await c.one(
      `UPDATE sites SET status = 'LIVE', live_date = $2, circuit_id = $3, wan_ip = $4, subnet_mask = $5, gateway_ip = $6, primary_dns = $7, secondary_dns = $8,
         latency_ms = $9, packet_loss_pct = $10, mrtg_url = $11, at_signoff_date = $12, at_signed_by = $13, live_remarks = $14, static_ip_block = $15,
         billing_start = $2, contract_start = $2, cycle_base = 0, updated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [s.id, liveDate, b.circuitId, b.wanIp, n(b.subnetMask), n(b.gatewayIp), n(b.primaryDns), n(b.secondaryDns), n(b.latencyMs), n(b.packetLossPct), n(b.mrtgUrl),
        b.atSignoffDate.toISOString().slice(0, 10), b.atSignedBy, n(b.remarks), s.static_ip_count > 0 ? n(b.staticIpBlock) : null]
    );
    await logSite(c, req, s, 'SITE_LIVE', `${s.code} is LIVE on ${liveDate} (circuit ${b.circuitId}, WAN ${b.wanIp}${s.static_ip_count > 0 ? `, static IPs ${b.staticIpBlock}` : ''}); AT signed by ${b.atSignedBy}`);
    return billing.onSiteLive(c, site, req.user.id);
  });
  const shown = can(req.user.role, 'billing.view') ? invoices : invoices.map((i) => ({ id: i.id, invoice_number: i.invoice_number, cycle_no: i.cycle_no }));
  return sendSuccess(res, { site: await detailFor(req, s.id), invoices: shown },
    `Site live — ${invoices.length} invoice(s) generated in Billing (${invoices.map((i) => i.invoice_number).join(', ')})`);
}));

/** Renew / extend a live site's contract (e.g. the client sends a renewal PO); clears the contract-end alert */
router.post('/:id/renew', requirePerm('implementation.manage'), validate(Joi.object({
  extendMonths: Joi.number().integer().min(1).max(60).required(),
  poNumber: Joi.string().trim().max(64).allow('', null),
  poDate: Joi.date().iso().custom(notFuture).allow(null, ''),
  remarks: Joi.string().allow('', null).max(1000)
})), ah(async (req, res) => {
  const s = await load(req.tenantId, req.params.id);
  if (s.status !== 'LIVE') throw ApiError.conflict(`${s.code} is ${s.status.replace('_', ' ').toLowerCase()} — only a live site's contract can be renewed`);
  const b = req.body;
  const poDate = b.poDate ? b.poDate.toISOString().slice(0, 10) : null;
  const months = s.contract_months + b.extendMonths;
  const end = addDays(addMonths(s.contract_start || s.live_date, months), -1);
  await db.tx(async (c) => {
    await c.query(
      `UPDATE sites SET contract_months = $2, po_number = COALESCE($3, po_number), po_date = COALESCE($4, po_date), updated_at = NOW() WHERE id = $1`,
      [s.id, months, b.poNumber || null, b.poNumber ? poDate || today() : null]);
    await logSite(c, req, s, 'SITE_RENEWED',
      `${s.code} contract extended by ${b.extendMonths} month(s) to ${end} (${months} months)${b.poNumber ? `; renewal PO ${b.poNumber}` : ''}${b.remarks ? ` — ${b.remarks}` : ''}`);
  });
  return sendSuccess(res, await detailFor(req, s.id), `Contract extended to ${dmy(end)}`);
}));

/**
 * Disconnect a live site: bills every cycle that started on or before the disconnection date, then stops billing
 * and the ISP cost for it. Bills already raised for later periods are listed so they can be cancelled.
 */
router.post('/:id/disconnect', requirePerm('implementation.manage'), validate(Joi.object({
  disconnectDate: Joi.date().iso().custom(notFuture).required().description('Date the link was disconnected (today or earlier)'),
  reason: Joi.string().trim().min(3).max(1000).required()
})), ah(async (req, res) => {
  const s = await load(req.tenantId, req.params.id);
  if (s.status !== 'LIVE') throw ApiError.conflict(`${s.code} is ${s.status.replace('_', ' ').toLowerCase()} — only a live site can be disconnected`);
  const date = req.body.disconnectDate.toISOString().slice(0, 10);
  if (date < s.live_date) throw ApiError.badRequest('Disconnection date cannot be before the live date', [{ field: 'disconnectDate', message: `Cannot be before the live date (${s.live_date})` }]);
  const result = await db.tx(async (c) => {
    const site = await c.one("SELECT * FROM sites WHERE id = $1 AND status = 'LIVE' FOR UPDATE", [s.id]);
    if (!site) throw ApiError.conflict(`${s.code} is no longer live`);
    // Final bills (cycles started on or before the date, in full) and credit notes for whole periods billed in advance after it
    const r = await billing.onDisconnect(c, site, date, req.user.id);
    await c.query(
      `UPDATE sites SET status = 'TERMINATED', terminated_on = $2, termination_reason = $3, terminated_by = $4, updated_at = NOW() WHERE id = $1`,
      [s.id, date, req.body.reason, req.user.id]);
    await c.query('UPDATE site_faults SET restored_at = GREATEST(reported_at, $2::date + INTERVAL \'1 day\' - INTERVAL \'1 second\'), cause = COALESCE(cause, \'Closed on disconnection\'), restored_by = $3 WHERE site_id = $1 AND restored_at IS NULL',
      [s.id, date, req.user.id]);
    await logSite(c, req, s, 'SITE_DISCONNECTED',
      `${s.code} disconnected on ${date}: ${req.body.reason}. Billing stopped${r.billed.length ? `; final bill(s): ${r.billed.map((i) => i.invoice_number).join(', ')}` : ''}${r.credited.length ? `; credit note(s): ${r.credited.map((x) => `${x.credit_number} on ${x.invoice_number}`).join(', ')}` : ''}`);
    return r;
  });
  const msg = [`${s.code} disconnected — billing stopped`];
  if (result.billed.length) msg.push(`final bill: ${result.billed.map((i) => i.invoice_number).join(', ')}`);
  if (result.credited.length) msg.push(`credit note: ${result.credited.map((x) => `${x.credit_number} (${inr(x.total_amount)} on ${x.invoice_number})`).join(', ')}`);
  return sendSuccess(res, { site: await detailFor(req, s.id), billed: result.billed, credited: result.credited }, msg.join('; '));
}));

/**
 * Reconnect a disconnected link: it is live again from the reconnection date. Billing restarts from that date — or from the day
 * after the last period already billed in full, if that is later (nothing is billed twice; the off period is not billed;
 * cycle numbers continue) — optionally with a one-time reconnection charge on the first bill and a fresh contract term.
 */
router.post('/:id/reconnect', requirePerm('implementation.manage'), validate(Joi.object({
  reconnectDate: Joi.date().iso().custom(notFuture).required(),
  reason: Joi.string().trim().min(3).max(1000).required(),
  reconnectCharge: Joi.number().min(0).default(0).description('One-time reconnection charge to the client (before GST), on the first bill'),
  reconnectVendorCharge: Joi.number().min(0).default(0).description("ISP's one-time reconnection charge to us"),
  contractMonths: Joi.number().integer().min(1).max(120).allow(null, '').description('Restart the contract from the reconnection date for this many months (blank = keep the current contract end)'),
  circuitId: Joi.string().trim().max(64).allow('', null)
})), ah(async (req, res) => {
  const s = await load(req.tenantId, req.params.id);
  if (s.status !== 'TERMINATED') throw ApiError.conflict(`${s.code} is ${s.status.replace('_', ' ').toLowerCase()} — only a disconnected site can be reconnected`);
  const b = req.body;
  const date = b.reconnectDate.toISOString().slice(0, 10);
  if (date < s.terminated_on) throw ApiError.badRequest('Reconnection date cannot be before the disconnection date', [{ field: 'reconnectDate', message: `Cannot be before the disconnection (${s.terminated_on})` }]);
  let restart = date;
  const invoices = await db.tx(async (c) => {
    restart = await billing.billingRestart(c, s, date);
    const site = await c.one(
      `UPDATE sites SET status = 'LIVE', billing_start = $7, cycle_base = last_cycle_no, reconnect_charge = $3, reconnect_vendor_charge = $4,
         contract_start = CASE WHEN $5::int IS NULL THEN contract_start ELSE $2::date END, contract_months = COALESCE($5::int, contract_months),
         circuit_id = COALESCE($6, circuit_id), terminated_on = NULL, termination_reason = NULL, terminated_by = NULL, updated_at = NOW()
       WHERE id = $1 AND status = 'TERMINATED' RETURNING *`,
      [s.id, date, b.reconnectCharge, b.reconnectVendorCharge, b.contractMonths || null, b.circuitId || null, restart]);
    if (!site) throw ApiError.conflict(`${s.code} is no longer disconnected`);
    await logSite(c, req, s, 'SITE_RECONNECTED',
      `${s.code} reconnected on ${date} (disconnected ${s.terminated_on}): ${b.reason}. Billing restarts from ${restart}${restart > date ? ' (already billed until the day before)' : ''}${b.reconnectCharge ? `; reconnection charge ${inr(b.reconnectCharge)}` : ''}${b.contractMonths ? `; new contract ${b.contractMonths} months` : ''}`);
    const settings = await c.one('SELECT * FROM tenant_settings WHERE tenant_id = $1', [site.tenant_id]);
    return billing.billDue(c, site, settings, req.user.id);
  });
  const shown = can(req.user.role, 'billing.view') ? invoices : invoices.map((i) => ({ id: i.id, invoice_number: i.invoice_number, cycle_no: i.cycle_no }));
  return sendSuccess(res, { site: await detailFor(req, s.id), invoices: shown },
    `${s.code} reconnected — billing restarts from ${dmy(restart)}${restart > date ? ' (the day after the period already billed)' : ''}${invoices.length ? ` (${invoices.map((i) => i.invoice_number).join(', ')})` : ''}`);
}));

/**
 * Bandwidth / price change on a live link (upgrade, downgrade, re-pricing at renewal). Applies from a billing cycle
 * not yet billed (default: the next one); bills of earlier cycles keep their price. History is kept.
 */
router.post('/:id/revisions', requirePerm('commercial.manage'), validate(Joi.object({
  bandwidthMbps: Joi.number().integer().min(1).max(100000).required(),
  clientMrc: Joi.number().min(0).required(),
  clientIpMrc: Joi.number().min(0).default(0),
  vendorMrc: Joi.number().min(0).required(),
  vendorIpMrc: Joi.number().min(0).default(0),
  fromCycle: Joi.number().integer().min(1).allow(null, ''),
  reason: Joi.string().trim().min(3).max(1000).required(),
  poNumber: Joi.string().trim().max(64).allow('', null)
})), ah(async (req, res) => {
  const s = await load(req.tenantId, req.params.id);
  if (s.status !== 'LIVE') throw ApiError.conflict(`${s.code} is ${s.status.replace('_', ' ').toLowerCase()} — only a live link can be changed`);
  const b = req.body;
  const next = Number(s.last_cycle_no) + 1;
  const from = b.fromCycle || next;
  if (from < next) throw ApiError.badRequest(`Cycle ${from} is already billed — a change applies from cycle ${next} or later (cancel & re-issue a bill to correct it)`, [{ field: 'fromCycle', message: `Cycle ${next} or later` }]);
  const ip = s.static_ip_count > 0;
  const n = { bw: b.bandwidthMbps, cm: b.clientMrc, cip: ip ? b.clientIpMrc : 0, vm: b.vendorMrc, vip: ip ? b.vendorIpMrc : 0 };
  if (n.bw === s.bandwidth_mbps && n.cm === Number(s.client_mrc) && n.cip === Number(s.client_ip_mrc) && n.vm === Number(s.vendor_mrc) && n.vip === Number(s.vendor_ip_mrc)) {
    throw ApiError.badRequest('Nothing changed — enter the new bandwidth or price');
  }
  const effective = billing.cycleStart(s, from);
  await db.tx(async (c) => {
    if (await c.one('SELECT 1 FROM site_revisions WHERE site_id = $1 AND from_cycle >= $2', [s.id, from])) {
      throw ApiError.conflict(`A change from cycle ${from} or later already exists for ${s.code}`);
    }
    await c.query(
      `INSERT INTO site_revisions (tenant_id, site_id, from_cycle, effective_from, old_bandwidth_mbps, new_bandwidth_mbps, old_client_mrc, new_client_mrc,
         old_client_ip_mrc, new_client_ip_mrc, old_vendor_mrc, new_vendor_mrc, old_vendor_ip_mrc, new_vendor_ip_mrc, reason, po_number, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
      [req.tenantId, s.id, from, effective, s.bandwidth_mbps, n.bw, s.client_mrc, n.cm, s.client_ip_mrc, n.cip, s.vendor_mrc, n.vm, s.vendor_ip_mrc, n.vip, b.reason, b.poNumber || null, req.user.id]);
    await c.query(
      `UPDATE sites SET bandwidth_mbps = $2, client_mrc = $3, client_ip_mrc = $4, vendor_mrc = $5, vendor_ip_mrc = $6,
         po_number = COALESCE($7, po_number), updated_at = NOW() WHERE id = $1`,
      [s.id, n.bw, n.cm, n.cip, n.vm, n.vip, b.poNumber || null]);
    await logSite(c, req, s, 'SITE_REVISED',
      `${s.code} changed from cycle ${from} (${effective}): ${s.bandwidth_mbps} → ${n.bw} Mbps; client MRC ${inr(s.client_mrc)} → ${inr(n.cm)}; ISP MRC ${inr(s.vendor_mrc)} → ${inr(n.vm)} — ${b.reason}`);
  });
  return sendSuccess(res, await detailFor(req, s.id), `Change saved — billed from cycle ${from} (${dmy(effective)})`, 201);
}));

/* ---------------- Link faults: down → restored, with the ISP docket ---------------- */
/** Calendar date of a moment in the business time zone (India), e.g. 02:30 IST on 5 Nov → 2026-11-05 */
const bizDate = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
const pastTime = (value, helpers) => (value > new Date(Date.now() + 5 * 60000) ? helpers.message('{{#label}} cannot be in the future') : value);

router.post('/:id/faults', canDeliver, validate(Joi.object({
  reportedAt: Joi.date().iso().custom(pastTime).required().description('When the link went down'),
  docketNo: Joi.string().trim().max(64).allow('', null).description("ISP's complaint / docket number"),
  description: Joi.string().trim().min(3).max(2000).required()
})), ah(async (req, res) => {
  const s = await load(req.tenantId, req.params.id);
  assertOwner(req, s);
  if (s.status !== 'LIVE') throw ApiError.conflict(`${s.code} is not live`);
  if (s.open_fault) throw ApiError.conflict(`${s.code} already has an open fault (reported ${new Date(s.open_fault.reported_at).toISOString().slice(0, 16).replace('T', ' ')}) — mark it restored first`);
  const at = req.body.reportedAt;
  if (bizDate(at) < (s.billing_start || s.live_date)) throw ApiError.badRequest('A fault cannot be before the link went live', [{ field: 'reportedAt', message: 'Before the live date' }]);
  await db.tx(async (c) => {
    await c.query(
      `INSERT INTO site_faults (tenant_id, site_id, vendor_id, reported_at, docket_no, description, reported_by) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [req.tenantId, s.id, s.vendor_id, at, req.body.docketNo || null, req.body.description, req.user.id]);
    await logSite(c, req, s, 'SITE_FAULT', `${s.code} link DOWN — ${req.body.description}${req.body.docketNo ? ` (${s.vendor_name} docket ${req.body.docketNo})` : ''}`);
  });
  return sendSuccess(res, await detailFor(req, s.id), 'Fault logged — mark it restored when the link is back', 201);
}));

router.post('/:id/faults/:faultId/restore', canDeliver, validate(Joi.object({
  restoredAt: Joi.date().iso().custom(pastTime).required(),
  cause: Joi.string().trim().min(3).max(2000).required()
})), ah(async (req, res) => {
  const s = await load(req.tenantId, req.params.id);
  assertOwner(req, s);
  const f = await db.one('SELECT * FROM site_faults WHERE id = $1 AND site_id = $2', [req.params.faultId, s.id]);
  if (!f) throw ApiError.notFound('Fault');
  if (f.restored_at) throw ApiError.conflict('Already restored');
  if (req.body.restoredAt < new Date(f.reported_at)) throw ApiError.badRequest('Restored time cannot be before the fault was reported', [{ field: 'restoredAt', message: 'Before the fault time' }]);
  const mins = Math.round((req.body.restoredAt - new Date(f.reported_at)) / 60000);
  await db.tx(async (c) => {
    await c.query('UPDATE site_faults SET restored_at = $2, cause = $3, restored_by = $4 WHERE id = $1', [f.id, req.body.restoredAt, req.body.cause, req.user.id]);
    await logSite(c, req, s, 'SITE_RESTORED', `${s.code} link restored after ${Math.floor(mins / 60)} h ${mins % 60} min — ${req.body.cause}`);
  });
  return sendSuccess(res, await detailFor(req, s.id), `Link restored (down ${Math.floor(mins / 60)} h ${mins % 60} min)`);
}));

guardIds(router, ['id', 'blockerId', 'faultId']);

module.exports = router;
