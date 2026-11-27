/**
 * ① FEASIBILITY TRACKER
 * WhatsApp feed / Location map → assign surveyor → feasible ISPs (price per ISP) → finalized price
 * → FEASIBILITY COMPLETE (auto-creates Quote draft)  |  STOP (not feasible / cancelled)
 */
const router = require('express').Router();
const Joi = require('joi');
const { R, guardIds } = require('../../validation/rules');
const db = require('../../config/db');
const ApiError = require('../../utils/apiError');
const { ah, nextCode, parseCoordinates, extractMapsUrl, extractPincode, assertStatus, inr } = require('../../utils/helpers');
const { parseOrderText } = require('../../utils/orderParser');
const { siteFields, checkAssignee, resolveAssignee, insertRequest, loadClient } = require('./request.service');
const { sendSuccess } = require('../../utils/response');
const validate = require('../../middlewares/validate.middleware');
const { authenticate, requireTenant, requirePerm } = require('../../middlewares/auth.middleware');
const { ownsOnly } = require('../../constants/roles');
const activity = require('../../utils/activity');

router.use(authenticate, requireTenant);

const LIST_SQL = `
  SELECT f.*, c.name AS customer_name, c.client_type, u.name AS assigned_name, cb.name AS created_by_name,
    co.code AS order_code, co.client_ref AS order_client_ref,
    q.id AS quote_id, q.code AS quote_code, q.status AS quote_status,
    (SELECT COUNT(*) FROM feasibility_isp_options o WHERE o.feasibility_id = f.id)::int AS option_count,
    (SELECT COUNT(*) FROM feasibility_isp_options o WHERE o.feasibility_id = f.id AND o.is_feasible)::int AS feasible_count,
    (SELECT string_agg(v.name, ', ' ORDER BY o.vendor_mrc) FROM feasibility_isp_options o JOIN vendors v ON v.id = o.vendor_id
       WHERE o.feasibility_id = f.id AND o.is_feasible) AS feasible_isps
  FROM feasibility_requests f
  JOIN customers c ON c.id = f.customer_id
  LEFT JOIN users u ON u.id = f.assigned_to
  LEFT JOIN users cb ON cb.id = f.created_by
  LEFT JOIN client_orders co ON co.id = f.order_id
  LEFT JOIN quotes q ON q.feasibility_id = f.id`;

const load = async (tenantId, id, runner = db) => {
  const f = await runner.one(`${LIST_SQL} WHERE f.tenant_id = $1 AND f.id = $2`, [tenantId, id]);
  if (!f) throw ApiError.notFound('Feasibility request');
  return f;
};

const detail = async (tenantId, id) => {
  const f = await load(tenantId, id);
  f.options = await db.many(
    `SELECT o.*, v.name AS vendor_name FROM feasibility_isp_options o JOIN vendors v ON v.id = o.vendor_id
      WHERE o.feasibility_id = $1 ORDER BY o.is_feasible DESC, o.vendor_mrc`, [id]);
  return f;
};

router.get('/', requirePerm('feasibility.view'), ah(async (req, res) => {
  const params = [req.tenantId];
  let where = 'f.tenant_id = $1';
  if (req.query.status) { params.push(String(req.query.status).split(',')); where += ` AND f.status = ANY($${params.length})`; }
  if (req.query.mine === '1') { params.push(req.user.id); where += ` AND f.assigned_to = $${params.length}`; }
  if (req.query.customerId) { params.push(req.query.customerId); where += ` AND f.customer_id = $${params.length}`; }
  if (req.query.orderId) { params.push(req.query.orderId); where += ` AND f.order_id = $${params.length}`; }
  return sendSuccess(res, await db.many(`${LIST_SQL} WHERE ${where} ORDER BY f.created_at DESC`, params));
}));

router.get('/:id', requirePerm('feasibility.view'), ah(async (req, res) => sendSuccess(res, await detail(req.tenantId, req.params.id))));

/** Parse a pasted WhatsApp message / maps link into form suggestions */
router.post('/parse', requirePerm('feasibility.create', 'orders.create'), validate(Joi.object({ text: Joi.string().allow('').max(5000).required() })), ah(async (req, res) => {
  const t = req.body.text;
  const coords = parseCoordinates(t);
  const bw = t.match(/(\d{1,5})\s*(mbps|mb|gbps|gb)\b/i);
  const bandwidthMbps = bw ? Number(bw[1]) * (/^g/i.test(bw[2]) ? 1000 : 1) : null;
  const phone = t.match(/(?:\+91[\s-]?)?\b[6-9]\d{9}\b/);
  const site = parseOrderText(t).sites[0] || {};
  return sendSuccess(res, {
    siteName: site.siteName || null,
    address: site.address || null,
    clientSiteRef: site.clientSiteRef || null,
    siteContactName: site.siteContactName || null,
    mapsUrl: extractMapsUrl(t),
    latitude: coords?.latitude ?? null,
    longitude: coords?.longitude ?? null,
    pincode: extractPincode(t),
    bandwidthMbps,
    requesterPhone: phone ? phone[0] : null,
    coordinatesFound: Boolean(coords)
  });
}));

const createSchema = Joi.object({
  ...siteFields,
  customerId: Joi.string().uuid().required(),
  orderId: Joi.string().uuid().allow(null, ''),
  sourceChannel: Joi.string().valid('WHATSAPP', 'MAPS', 'EMAIL', 'PHONE', 'MANUAL').default('WHATSAPP'),
  rawMessage: Joi.string().allow('', null).max(5000),
  requesterName: R.optional(R.name(128)),
  requesterPhone: R.optional(R.phone())
});

router.post('/', requirePerm('feasibility.create'), validate(createSchema), ah(async (req, res) => {
  const b = req.body;
  const customer = await loadClient(req.tenantId, b.customerId);
  let order = null;
  if (b.orderId) {
    order = await db.one('SELECT id, code, customer_id FROM client_orders WHERE id = $1 AND tenant_id = $2', [b.orderId, req.tenantId]);
    if (!order) throw ApiError.badRequest('Client order not found');
    if (order.customer_id !== customer.id) throw ApiError.badRequest(`Order ${order.code} belongs to a different client`);
  }
  const assignee = await resolveAssignee(req, b.assignedTo);
  const id = await db.tx(async (c) => (await insertRequest(c, {
    tenantId: req.tenantId, userId: req.user.id, customer, order, sourceChannel: b.sourceChannel,
    rawMessage: b.rawMessage, requesterName: b.requesterName, requesterPhone: b.requesterPhone
  }, b, assignee)).id);
  return sendSuccess(res, await detail(req.tenantId, id), 'Feasibility request logged', 201);
}));

/** Field engineers may change only the requests they own */
const assertOwner = (req, f, what) => {
  if (ownsOnly(req.user.role) && f.assigned_to !== req.user.id) throw ApiError.forbidden(`This site is owned by ${f.assigned_name || 'someone else'} — you cannot ${what}`);
};

router.patch('/:id', requirePerm('feasibility.create'), validate(createSchema.fork(['customerId', 'siteName', 'address', 'bandwidthMbps'], (s) => s.optional()).fork(['assignedTo', 'orderId'], (s) => s.strip()).min(1).prefs({ noDefaults: true })), ah(async (req, res) => {
  const f = await load(req.tenantId, req.params.id);
  assertStatus(f, ['NEW', 'ASSIGNED', 'SURVEY_DONE'], 'edit the request');
  assertOwner(req, f, 'edit it');
  const b = req.body;
  if (b.customerId) await loadClient(req.tenantId, b.customerId);
  const map = { clientSiteRef: 'client_site_ref', siteContactName: 'site_contact_name', siteContactPhone: 'site_contact_phone', customerId: 'customer_id', siteName: 'site_name', address: 'address', city: 'city', pincode: 'pincode', mapsUrl: 'maps_url', latitude: 'latitude', longitude: 'longitude', sourceChannel: 'source_channel', rawMessage: 'raw_message', notes: 'raw_message', bandwidthMbps: 'bandwidth_mbps', medium: 'medium', requesterName: 'requester_name', requesterPhone: 'requester_phone', linkRole: 'link_role', staticIpCount: 'static_ip_count' };
  if (b.staticIpCount === '' || b.staticIpCount === null) b.staticIpCount = 0;
  const sets = []; const vals = [req.params.id];
  Object.entries(map).forEach(([k, col]) => { if (b[k] !== undefined) { vals.push(b[k] === '' ? null : b[k]); sets.push(`${col} = $${vals.length}`); } });
  if (sets.length) await db.query(`UPDATE feasibility_requests SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $1`, vals);
  return sendSuccess(res, await detail(req.tenantId, req.params.id), 'Request updated');
}));

router.post('/:id/assign', requirePerm('feasibility.assign'), validate(Joi.object({ assignedTo: Joi.string().uuid().required() })), ah(async (req, res) => {
  const f = await load(req.tenantId, req.params.id);
  assertStatus(f, ['NEW', 'ASSIGNED', 'SURVEY_DONE'], 'assign a surveyor');
  const u = await checkAssignee(req.tenantId, req.body.assignedTo);
  await db.tx(async (c) => {
    await c.query(`UPDATE feasibility_requests SET assigned_to = $2, assigned_at = NOW(), status = CASE WHEN status = 'NEW' THEN 'ASSIGNED' ELSE status END, updated_at = NOW() WHERE id = $1`, [f.id, u.id]);
    await activity.log(c, { tenantId: req.tenantId, userId: req.user.id, entityType: 'FEASIBILITY', entityId: f.id, action: 'FEAS_ASSIGNED', message: `${f.code} assigned to ${u.name}` });
  });
  return sendSuccess(res, await detail(req.tenantId, f.id), `Assigned to ${u.name}`);
}));

router.put('/:id/survey', requirePerm('feasibility.survey'), validate(Joi.object({
  nearestPopM: Joi.number().integer().min(0).allow(null),
  surveyNotes: Joi.string().allow('', null).max(5000),
  options: Joi.array().min(1).max(12).unique('vendorId').items(Joi.object({
    vendorId: Joi.string().uuid().required(),
    isFeasible: Joi.boolean().required(),
    medium: Joi.string().allow('', null).max(16),
    distanceM: Joi.number().integer().min(0).allow(null),
    vendorOtc: Joi.number().min(0).default(0),
    vendorMrc: Joi.number().min(0).default(0),
    vendorIpMrc: Joi.number().min(0).allow(null, '').default(0).description('ISP charge per month for the static IPs (only when the site needs static IPs)'),
    leadTimeDays: Joi.number().integer().min(0).allow(null),
    remarks: Joi.string().trim().max(1000).allow('', null).when('isFeasible', { is: false, then: Joi.string().trim().min(3).required().messages({ 'any.required': 'Say why the ISP is not feasible (remarks)', 'string.empty': 'Say why the ISP is not feasible (remarks)', 'string.min': 'Say why the ISP is not feasible (remarks)' }) })
  })).required().messages({ 'array.unique': 'Each ISP can be listed only once' })
})), ah(async (req, res) => {
  const f = await load(req.tenantId, req.params.id);
  assertStatus(f, ['ASSIGNED', 'SURVEY_DONE'], 'record the survey');
  assertOwner(req, f, 'record its survey');
  const b = req.body;
  const vendorIds = b.options.map((o) => o.vendorId);
  const found = await db.many("SELECT id FROM vendors WHERE tenant_id = $1 AND id = ANY($2) AND vendor_type = 'ISP'", [req.tenantId, vendorIds]);
  if (found.length !== vendorIds.length) throw ApiError.badRequest('Every option must be an ISP vendor from Masters');
  const bad = b.options.find((o) => o.isFeasible && !(o.vendorMrc > 0));
  if (bad) throw ApiError.badRequest('A feasible ISP must have a monthly price (MRC) greater than 0');

  await db.tx(async (c) => {
    await c.query('UPDATE feasibility_requests SET selected_option_id = NULL WHERE id = $1', [f.id]);
    await c.query('DELETE FROM feasibility_isp_options WHERE feasibility_id = $1', [f.id]);
    for (const o of b.options) {
      await c.query(
        `INSERT INTO feasibility_isp_options (tenant_id, feasibility_id, vendor_id, is_feasible, medium, distance_m, vendor_otc, vendor_mrc, vendor_ip_mrc, lead_time_days, remarks)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [req.tenantId, f.id, o.vendorId, o.isFeasible, o.medium || null, o.distanceM ?? null, o.vendorOtc, o.vendorMrc,
          f.static_ip_count > 0 ? Number(o.vendorIpMrc) || 0 : 0, o.leadTimeDays ?? null, o.remarks || null]
      );
    }
    await c.query(`UPDATE feasibility_requests SET nearest_pop_m = $2, survey_notes = $3, surveyed_at = NOW(), status = 'SURVEY_DONE', updated_at = NOW() WHERE id = $1`,
      [f.id, b.nearestPopM ?? null, b.surveyNotes || null]);
    const feasible = b.options.filter((o) => o.isFeasible).length;
    await activity.log(c, { tenantId: req.tenantId, userId: req.user.id, entityType: 'FEASIBILITY', entityId: f.id, action: 'FEAS_SURVEYED',
      message: `${f.code} survey recorded: ${feasible} of ${b.options.length} ISPs feasible` });
  });
  return sendSuccess(res, await detail(req.tenantId, f.id), 'Survey saved');
}));

router.post('/:id/finalize-price', requirePerm('feasibility.finalize'), validate(Joi.object({
  selectedOptionId: Joi.string().uuid().required(),
  clientOtc: Joi.number().min(0).required(),
  clientMrc: Joi.number().greater(0).required(),
  clientIpMrc: Joi.number().min(0).allow(null, '').default(0).description('Client price per month for the static IPs (only when the site needs static IPs)')
})), ah(async (req, res) => {
  const f = await load(req.tenantId, req.params.id);
  assertStatus(f, ['SURVEY_DONE', 'PRICE_FINALIZED'], 'finalize the price');
  const opt = await db.one('SELECT o.*, v.name AS vendor_name FROM feasibility_isp_options o JOIN vendors v ON v.id = o.vendor_id WHERE o.id = $1 AND o.feasibility_id = $2', [req.body.selectedOptionId, f.id]);
  if (!opt) throw ApiError.badRequest('Selected ISP option does not belong to this request');
  if (!opt.is_feasible) throw ApiError.badRequest(`${opt.vendor_name} was marked not feasible`);
  const { clientOtc, clientMrc } = req.body;
  const clientIpMrc = f.static_ip_count > 0 ? Number(req.body.clientIpMrc) || 0 : 0;
  const warns = [];
  if (clientMrc < opt.vendor_mrc) warns.push(`client MRC is below ${opt.vendor_name} cost`);
  if (clientIpMrc < Number(opt.vendor_ip_mrc)) warns.push(`client static IP charge is below ${opt.vendor_name} cost`);
  const warn = warns.length ? ` (warning: ${warns.join('; ')})` : '';
  await db.tx(async (c) => {
    await c.query(`UPDATE feasibility_requests SET selected_option_id = $2, final_client_otc = $3, final_client_mrc = $4, final_client_ip_mrc = $5, price_finalized_at = NOW(), status = 'PRICE_FINALIZED', updated_at = NOW() WHERE id = $1`,
      [f.id, opt.id, clientOtc, clientMrc, clientIpMrc]);
    await activity.log(c, { tenantId: req.tenantId, userId: req.user.id, entityType: 'FEASIBILITY', entityId: f.id, action: 'FEAS_PRICE_FINALIZED',
      message: `${f.code} price finalized with ${opt.vendor_name}: client OTC ${inr(clientOtc)}, MRC ${inr(clientMrc)}${f.static_ip_count > 0 ? `, static IP ${inr(clientIpMrc)}/month` : ''}${warn}` });
  });
  return sendSuccess(res, await detail(req.tenantId, f.id), `Price finalized${warn}`);
}));

/** Feasibility complete → auto-create the Commercial quote (Quote-1/2/3 pre-filled) */
router.post('/:id/complete', requirePerm('feasibility.finalize'), ah(async (req, res) => {
  const f = await load(req.tenantId, req.params.id);
  assertStatus(f, ['PRICE_FINALIZED'], 'complete feasibility');
  const settings = await db.one('SELECT default_contract_months FROM tenant_settings WHERE tenant_id = $1', [req.tenantId]);
  const quoteId = await db.tx(async (c) => {
    await c.query(`UPDATE feasibility_requests SET status = 'COMPLETED', completed_at = NOW(), updated_at = NOW() WHERE id = $1`, [f.id]);
    const opts = await c.many(
      `SELECT * FROM feasibility_isp_options WHERE feasibility_id = $1 AND is_feasible
       ORDER BY (id = $2) DESC, vendor_mrc ASC LIMIT 3`, [f.id, f.selected_option_id]);
    const code = await nextCode(c, req.tenantId, 'QTE', 'QTE');
    const q = await c.one(
      `INSERT INTO quotes (tenant_id, code, feasibility_id, customer_id, site_name, bandwidth_mbps, contract_months, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, code`,
      [req.tenantId, code, f.id, f.customer_id, f.site_name, f.bandwidth_mbps, settings.default_contract_months, req.user.id]
    );
    // Selected ISP keeps the finalized client price; alternatives get the same mark-up ratio for a fair comparison.
    const selected = opts[0];
    const markup = selected.vendor_mrc > 0 ? f.final_client_mrc / selected.vendor_mrc : 1;
    let n = 1;
    for (const o of opts) {
      const isSelected = o.id === f.selected_option_id;
      const clientMrc = isSelected ? f.final_client_mrc : Math.round(o.vendor_mrc * markup);
      const clientOtc = f.final_client_otc;
      // The client's static IP price stays the same whichever ISP is used
      await c.query(
        `INSERT INTO quote_options (tenant_id, quote_id, option_no, vendor_id, vendor_otc, vendor_mrc, vendor_ip_mrc, client_otc, client_mrc, client_ip_mrc)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [req.tenantId, q.id, n, o.vendor_id, o.vendor_otc, o.vendor_mrc, o.vendor_ip_mrc, clientOtc, clientMrc, Number(f.final_client_ip_mrc) || 0]
      );
      n += 1;
    }
    await activity.log(c, { tenantId: req.tenantId, userId: req.user.id, entityType: 'FEASIBILITY', entityId: f.id, action: 'FEAS_COMPLETED',
      message: `${f.code} feasibility complete → quote ${q.code} created with ${opts.length} option(s)`, meta: { quoteId: q.id } });
    await activity.log(c, { tenantId: req.tenantId, userId: req.user.id, entityType: 'QUOTE', entityId: q.id, action: 'QUOTE_CREATED',
      message: `${q.code} created automatically from ${f.code}` });
    return q.id;
  });
  return sendSuccess(res, { feasibility: await detail(req.tenantId, f.id), quoteId }, 'Feasibility complete — quote created in Commercial');
}));

/** STOP — not feasible / cancelled */
router.post('/:id/stop', requirePerm('feasibility.finalize', 'feasibility.assign'), validate(Joi.object({
  outcome: Joi.string().valid('NOT_FEASIBLE', 'CANCELLED').required(),
  reason: Joi.string().trim().min(3).max(1000).required()
})), ah(async (req, res) => {
  const f = await load(req.tenantId, req.params.id);
  assertStatus(f, ['NEW', 'ASSIGNED', 'SURVEY_DONE', 'PRICE_FINALIZED'], 'stop this request');
  await db.tx(async (c) => {
    await c.query('UPDATE feasibility_requests SET status = $2, stop_reason = $3, completed_at = NOW(), updated_at = NOW() WHERE id = $1', [f.id, req.body.outcome, req.body.reason]);
    await activity.log(c, { tenantId: req.tenantId, userId: req.user.id, entityType: 'FEASIBILITY', entityId: f.id, action: `FEAS_${req.body.outcome}`,
      message: `${f.code} stopped (${req.body.outcome.replace('_', ' ').toLowerCase()}): ${req.body.reason}` });
  });
  return sendSuccess(res, await detail(req.tenantId, f.id), 'Request stopped');
}));

guardIds(router, ['id']);

module.exports = router;
