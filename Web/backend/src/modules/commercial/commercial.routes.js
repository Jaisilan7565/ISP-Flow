/**
 * ② COMMERCIAL PRICING / QUOTE + BUDGETING
 * Quote-1 / Quote-2 / Quote-3 → Send → BID WIN (finalized quote value, A/B/C budget) → site auto-created (awaiting PO)
 */
const router = require('express').Router();
const Joi = require('joi');
const { R, guardIds } = require('../../validation/rules');
const db = require('../../config/db');
const ApiError = require('../../utils/apiError');
const { ah, nextCode, assertStatus, round2 , inr } = require('../../utils/helpers');
const { sendSuccess } = require('../../utils/response');
const validate = require('../../middlewares/validate.middleware');
const { authenticate, requireTenant, requirePerm } = require('../../middlewares/auth.middleware');
const activity = require('../../utils/activity');

router.use(authenticate, requireTenant);

const LIST_SQL = `
  SELECT q.*, c.name AS customer_name, f.code AS feasibility_code, f.address, f.link_role, f.static_ip_count, f.order_id, f.client_site_ref, f.site_contact_name, f.site_contact_phone,
         f.assigned_to AS field_owner_id, fo.name AS field_owner_name, co.code AS order_code,
         v.name AS final_vendor_name, pv.name AS partner_vendor_name,
         s.id AS site_id, s.code AS site_code, s.status AS site_status, cb.name AS created_by_name,
         (SELECT COUNT(*) FROM quote_options o WHERE o.quote_id = q.id)::int AS option_count
    FROM quotes q
    JOIN customers c ON c.id = q.customer_id
    JOIN feasibility_requests f ON f.id = q.feasibility_id
    LEFT JOIN vendors v ON v.id = q.final_vendor_id
    LEFT JOIN vendors pv ON pv.id = q.partner_vendor_id
    LEFT JOIN users cb ON cb.id = q.created_by
    LEFT JOIN users fo ON fo.id = f.assigned_to
    LEFT JOIN client_orders co ON co.id = f.order_id
    LEFT JOIN sites s ON s.quote_id = q.id`;

/** Monthly price = link MRC + static IP charge (0 when the site needs no static IP) */
const withMargin = (o, months) => {
  const clientMonthly = Number(o.client_mrc) + Number(o.client_ip_mrc || 0);
  const vendorMonthly = Number(o.vendor_mrc) + Number(o.vendor_ip_mrc || 0);
  const clientTotal = Number(o.client_otc) + clientMonthly * months;
  const vendorTotal = Number(o.vendor_otc) + vendorMonthly * months;
  const margin = clientTotal - vendorTotal;
  return { ...o, client_total: round2(clientTotal), vendor_total: round2(vendorTotal), margin: round2(margin), margin_pct: clientTotal > 0 ? round2((margin / clientTotal) * 100) : 0 };
};

const load = async (tenantId, id) => {
  const q = await db.one(`${LIST_SQL} WHERE q.tenant_id = $1 AND q.id = $2`, [tenantId, id]);
  if (!q) throw ApiError.notFound('Quote');
  return q;
};

const detail = async (tenantId, id) => {
  const q = await load(tenantId, id);
  const opts = await db.many(`SELECT o.*, v.name AS vendor_name FROM quote_options o JOIN vendors v ON v.id = o.vendor_id WHERE o.quote_id = $1 ORDER BY o.option_no`, [id]);
  q.options = opts.map((o) => withMargin(o, q.contract_months));
  return q;
};

router.get('/', requirePerm('commercial.view'), ah(async (req, res) => {
  const params = [req.tenantId];
  let where = 'q.tenant_id = $1';
  if (req.query.status) { params.push(String(req.query.status).split(',')); where += ` AND q.status = ANY($${params.length})`; }
  if (req.query.customerId) { params.push(req.query.customerId); where += ` AND q.customer_id = $${params.length}`; }
  const rows = await db.many(`${LIST_SQL} WHERE ${where} ORDER BY q.created_at DESC`, params);
  const opts = rows.length ? await db.many(`SELECT o.*, v.name AS vendor_name FROM quote_options o JOIN vendors v ON v.id = o.vendor_id WHERE o.quote_id = ANY($1) ORDER BY o.option_no`, [rows.map((r) => r.id)]) : [];
  rows.forEach((q) => { q.options = opts.filter((o) => o.quote_id === q.id).map((o) => withMargin(o, q.contract_months)); });
  return sendSuccess(res, rows);
}));

router.get('/:id', requirePerm('commercial.view'), ah(async (req, res) => sendSuccess(res, await detail(req.tenantId, req.params.id))));

router.put('/:id/options', requirePerm('commercial.manage'), validate(Joi.object({
  contractMonths: Joi.number().integer().min(1).max(120).required(),
  options: Joi.array().min(1).max(3).unique('optionNo').items(Joi.object({
    optionNo: Joi.number().integer().min(1).max(3).required(),
    vendorId: Joi.string().uuid().required(),
    vendorOtc: Joi.number().min(0).required(),
    vendorMrc: Joi.number().min(0).required(),
    clientOtc: Joi.number().min(0).required(),
    clientMrc: Joi.number().greater(0).required(),
    vendorIpMrc: Joi.number().min(0).allow(null, '').default(0).description('ISP static IP charge per month'),
    clientIpMrc: Joi.number().min(0).allow(null, '').default(0).description('Client static IP charge per month'),
    slaPct: Joi.number().min(90).max(100).allow(null, ''),
    notes: Joi.string().allow('', null).max(1000)
  })).required()
})), ah(async (req, res) => {
  const q = await load(req.tenantId, req.params.id);
  assertStatus(q, ['DRAFT', 'SENT'], 'edit quote options');
  const ids = [...new Set(req.body.options.map((o) => o.vendorId))];
  const ip = (v) => (q.static_ip_count > 0 ? Number(v) || 0 : 0);
  const found = await db.many('SELECT id FROM vendors WHERE tenant_id = $1 AND id = ANY($2)', [req.tenantId, ids]);
  if (found.length !== ids.length) throw ApiError.badRequest('Unknown vendor in options');
  await db.tx(async (c) => {
    await c.query('UPDATE quotes SET contract_months = $2, updated_at = NOW() WHERE id = $1', [q.id, req.body.contractMonths]);
    await c.query('DELETE FROM quote_options WHERE quote_id = $1', [q.id]);
    for (const o of req.body.options) {
      await c.query(
        `INSERT INTO quote_options (tenant_id, quote_id, option_no, vendor_id, vendor_otc, vendor_mrc, vendor_ip_mrc, client_otc, client_mrc, client_ip_mrc, sla_pct, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [req.tenantId, q.id, o.optionNo, o.vendorId, o.vendorOtc, o.vendorMrc, ip(o.vendorIpMrc), o.clientOtc, o.clientMrc, ip(o.clientIpMrc), o.slaPct === '' ? null : o.slaPct ?? null, o.notes || null]
      );
    }
    await activity.log(c, { tenantId: req.tenantId, userId: req.user.id, entityType: 'QUOTE', entityId: q.id, action: 'QUOTE_UPDATED', message: `${q.code} options updated (${req.body.options.length})` });
  });
  return sendSuccess(res, await detail(req.tenantId, q.id), 'Quote options saved');
}));

router.post('/:id/send', requirePerm('commercial.manage'), ah(async (req, res) => {
  const q = await load(req.tenantId, req.params.id);
  assertStatus(q, ['DRAFT'], 'send the quote');
  if (!q.option_count) throw ApiError.badRequest('Add at least one quote option before sending');
  await db.tx(async (c) => {
    await c.query("UPDATE quotes SET status = 'SENT', sent_at = NOW(), updated_at = NOW() WHERE id = $1", [q.id]);
    await activity.log(c, { tenantId: req.tenantId, userId: req.user.id, entityType: 'QUOTE', entityId: q.id, action: 'QUOTE_SENT', message: `${q.code} sent to ${q.customer_name}` });
  });
  return sendSuccess(res, await detail(req.tenantId, q.id), 'Quote marked as sent to client');
}));

router.post('/:id/bid-win', requirePerm('commercial.manage'), validate(Joi.object({
  optionNo: Joi.number().integer().min(1).max(3).required(),
  finalClientOtc: Joi.number().min(0),
  finalClientMrc: Joi.number().greater(0),
  finalClientIpMrc: Joi.number().min(0).allow(null, '').description('Client static IP charge per month, if changed at Bid Win'),
  contractMonths: Joi.number().integer().min(1).max(120),
  vendorPct: Joi.number().min(0).max(100).required(),
  partnerPct: Joi.number().min(0).max(100).required(),
  capexPct: Joi.number().min(0).max(100).required(),
  partnerVendorId: Joi.string().uuid().allow(null, '')
})), ah(async (req, res) => {
  const q = await detail(req.tenantId, req.params.id);
  assertStatus(q, ['SENT'], 'record Bid Win');
  const b = req.body;
  const total = b.vendorPct + b.partnerPct + b.capexPct;
  if (Math.abs(total - 100) > 0.01) throw ApiError.badRequest(`Budget A + B + C must equal 100% (now ${total}%)`);
  const opt = q.options.find((o) => o.option_no === b.optionNo);
  if (!opt) throw ApiError.badRequest(`Quote-${b.optionNo} does not exist`);
  if (b.partnerVendorId) {
    const p = await db.one("SELECT id FROM vendors WHERE id = $1 AND tenant_id = $2", [b.partnerVendorId, req.tenantId]);
    if (!p) throw ApiError.badRequest('Partner not found');
  }
  const months = b.contractMonths || q.contract_months;
  const otc = b.finalClientOtc ?? opt.client_otc;
  const mrc = b.finalClientMrc ?? opt.client_mrc;
  const ipMrc = q.static_ip_count > 0 ? (b.finalClientIpMrc === '' || b.finalClientIpMrc == null ? Number(opt.client_ip_mrc) : Number(b.finalClientIpMrc)) : 0;
  const vendorIpMrc = q.static_ip_count > 0 ? Number(opt.vendor_ip_mrc) : 0;
  const value = round2(otc + (mrc + ipMrc) * months);
  const amounts = { vendor: round2((value * b.vendorPct) / 100), partner: round2((value * b.partnerPct) / 100) };
  amounts.capex = round2(value - amounts.vendor - amounts.partner);

  const siteId = await db.tx(async (c) => {
    await c.query(
      `UPDATE quotes SET status = 'WON', decided_at = NOW(), won_option_no = $2, final_vendor_id = $3, final_vendor_otc = $4, final_vendor_mrc = $5,
         final_client_otc = $6, final_client_mrc = $7, contract_months = $8, finalized_value = $9, vendor_pct = $10, partner_pct = $11, capex_pct = $12,
         vendor_amount = $13, partner_amount = $14, capex_amount = $15, partner_vendor_id = $16, final_vendor_ip_mrc = $17, final_client_ip_mrc = $18, updated_at = NOW() WHERE id = $1`,
      [q.id, b.optionNo, opt.vendor_id, opt.vendor_otc, opt.vendor_mrc, otc, mrc, months, value, b.vendorPct, b.partnerPct, b.capexPct,
        amounts.vendor, amounts.partner, amounts.capex, b.partnerVendorId || null, vendorIpMrc, ipMrc]
    );
    const cust = await c.one('SELECT credit_days, billing_frequency FROM customers WHERE id = $1', [q.customer_id]);
    // The link medium: as surveyed for the winning ISP, else as asked for in the order
    const med = await c.one(
      `SELECT COALESCE(NULLIF(o.medium, ''), f.medium, 'FIBER') AS medium FROM feasibility_requests f
         LEFT JOIN feasibility_isp_options o ON o.feasibility_id = f.id AND o.vendor_id = $2 WHERE f.id = $1 LIMIT 1`, [q.feasibility_id, opt.vendor_id]);
    const code = await nextCode(c, req.tenantId, 'SITE', 'SITE');
    const site = await c.one(
      `INSERT INTO sites (tenant_id, code, quote_id, feasibility_id, customer_id, vendor_id, site_name, address, bandwidth_mbps,
         client_otc, client_mrc, vendor_otc, vendor_mrc, contract_months, billing_frequency, credit_days,
         order_id, client_site_ref, site_contact_name, site_contact_phone, owner_id, link_role, static_ip_count, client_ip_mrc, vendor_ip_mrc, medium)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26) RETURNING id, code`,
      [req.tenantId, code, q.id, q.feasibility_id, q.customer_id, opt.vendor_id, q.site_name, q.address, q.bandwidth_mbps,
        otc, mrc, opt.vendor_otc, opt.vendor_mrc, months, cust.billing_frequency, cust.credit_days,
        q.order_id, q.client_site_ref, q.site_contact_name, q.site_contact_phone, q.field_owner_id, q.link_role, q.static_ip_count, ipMrc, vendorIpMrc, med?.medium || 'FIBER']
    );
    await activity.log(c, { tenantId: req.tenantId, userId: req.user.id, entityType: 'QUOTE', entityId: q.id, action: 'QUOTE_WON',
      message: `${q.code} BID WON with Quote-${b.optionNo} (${opt.vendor_name}); finalized value ${inr(value)}; budget A ${b.vendorPct}% / B ${b.partnerPct}% / C ${b.capexPct}%`, meta: { siteId: site.id } });
    await activity.log(c, { tenantId: req.tenantId, userId: req.user.id, entityType: 'SITE', entityId: site.id, action: 'SITE_CREATED',
      message: `${site.code} created from ${q.code} — awaiting client PO${q.field_owner_name ? `; delivery owner ${q.field_owner_name}` : ''}` });
    return site.id;
  });
  return sendSuccess(res, { quote: await detail(req.tenantId, q.id), siteId }, 'Bid won — site created in Implementation (awaiting PO)');
}));

router.post('/:id/lost', requirePerm('commercial.manage'), validate(Joi.object({ reason: Joi.string().trim().min(3).max(1000).required() })), ah(async (req, res) => {
  const q = await load(req.tenantId, req.params.id);
  assertStatus(q, ['DRAFT', 'SENT'], 'mark the bid lost');
  await db.tx(async (c) => {
    await c.query("UPDATE quotes SET status = 'LOST', lost_reason = $2, decided_at = NOW(), updated_at = NOW() WHERE id = $1", [q.id, req.body.reason]);
    await activity.log(c, { tenantId: req.tenantId, userId: req.user.id, entityType: 'QUOTE', entityId: q.id, action: 'QUOTE_LOST', message: `${q.code} bid lost: ${req.body.reason}` });
  });
  return sendSuccess(res, await detail(req.tenantId, q.id), 'Bid marked lost');
}));

guardIds(router, ['id']);

module.exports = router;
