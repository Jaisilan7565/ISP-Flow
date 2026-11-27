/**
 * ④ BILLING TRACKER
 * 1st bill (OTC + 1st cycle) → 2nd cycle … each with amount value + date of submission → bill submission & tracking.
 */
const router = require('express').Router();
const Joi = require('joi');
const { R, guardIds } = require('../../validation/rules');
const db = require('../../config/db');
const ApiError = require('../../utils/apiError');
const { ah, addDays, today, daysBetween, notFuture } = require('../../utils/helpers');
const { sendSuccess } = require('../../utils/response');
const validate = require('../../middlewares/validate.middleware');
const { authenticate, requireTenant, requirePerm } = require('../../middlewares/auth.middleware');
const activity = require('../../utils/activity');
const billing = require('./billing.engine');

router.use(authenticate, requireTenant);

const LIST_SQL = `
  SELECT i.*, s.code AS site_code, s.site_name, s.circuit_id, s.static_ip_count, s.static_ip_block, s.link_role, s.medium, COALESCE(i.billed_bandwidth_mbps, s.bandwidth_mbps) AS bandwidth_mbps, s.address AS site_address, s.client_site_ref, s.po_number, s.po_date, c.name AS customer_name, c.gstin AS customer_gstin,
         c.billing_address AS customer_address, c.state AS customer_state, s.credit_days,
         (i.total_amount - i.amount_received - i.tds_amount - i.credit_amount) AS outstanding,
         (SELECT COUNT(*) FROM documents d WHERE d.entity_type = 'INVOICE' AND d.entity_id = i.id)::int AS doc_count
    FROM invoices i JOIN sites s ON s.id = i.site_id JOIN customers c ON c.id = i.customer_id`;

const decorate = (i) => {
  // A paid bill that is later credited leaves money with us: shown as excess received (refund it or adjust it on a later bill)
  i.excess_received = Math.max(0, -Math.round(Number(i.outstanding) * 100) / 100);
  i.outstanding = Math.max(0, Math.round(Number(i.outstanding) * 100) / 100);
  i.is_overdue = Boolean(i.due_date && i.due_date < today() && ['SUBMITTED', 'PARTIALLY_PAID'].includes(i.status));
  i.days_since_invoice = daysBetween(i.invoice_date, today());
  i.label = i.invoice_type === 'OTC' ? 'Site OTC' : `Cycle ${i.cycle_no}${Number(i.otc_amount) > 0 ? ' + OTC' : ''}`;
  return i;
};

const load = async (tenantId, id) => {
  const i = await db.one(`${LIST_SQL} WHERE i.tenant_id = $1 AND i.id = $2`, [tenantId, id]);
  if (!i) throw ApiError.notFound('Invoice');
  return decorate(i);
};

router.get('/', requirePerm('billing.view'), ah(async (req, res) => {
  const params = [req.tenantId];
  let where = "i.tenant_id = $1";
  if (req.query.status) { params.push(String(req.query.status).split(',')); where += ` AND i.status = ANY($${params.length})`; }
  if (req.query.siteId) { params.push(req.query.siteId); where += ` AND i.site_id = $${params.length}`; }
  if (req.query.customerId) { params.push(req.query.customerId); where += ` AND i.customer_id = $${params.length}`; }
  const rows = await db.many(`${LIST_SQL} WHERE ${where} ORDER BY i.invoice_date DESC, i.cycle_no DESC`, params);
  return sendSuccess(res, rows.map(decorate));
}));

router.get('/:id', requirePerm('billing.view'), ah(async (req, res) => {
  const inv = await load(req.tenantId, req.params.id);
  inv.receipts = await db.many('SELECT r.*, w.vendor_amount, w.loan_amount, w.salary_amount, w.surplus_amount FROM receipts r LEFT JOIN waterfall_allocations w ON w.receipt_id = r.id WHERE r.invoice_id = $1 ORDER BY r.received_date', [inv.id]);
  inv.credit_notes = await db.many('SELECT n.*, u.name AS created_by_name FROM credit_notes n LEFT JOIN users u ON u.id = n.created_by WHERE n.invoice_id = $1 ORDER BY n.created_at', [inv.id]);
  inv.company = await db.one('SELECT t.name, t.gstin, t.address, t.state, t.contact_email, t.contact_phone FROM tenants t WHERE t.id = $1', [req.tenantId]);
  return sendSuccess(res, inv);
}));

router.post('/:id/submission', requirePerm('billing.manage'), validate(Joi.object({
  submissionMode: Joi.string().valid('PHYSICAL', 'COURIER', 'PORTAL', 'EMAIL').required(),
  submissionDate: Joi.date().iso().custom(notFuture).required(),
  courierAwb: Joi.string().trim().max(128).when('submissionMode', { is: 'COURIER', then: Joi.required(), otherwise: Joi.allow('', null) }),
  acknowledgedBy: Joi.string().trim().max(128).when('submissionMode', { is: 'PHYSICAL', then: Joi.required(), otherwise: Joi.allow('', null) }),
  remarks: Joi.string().allow('', null).max(1000)
})), ah(async (req, res) => {
  const inv = await load(req.tenantId, req.params.id);
  if (!['PENDING_SUBMISSION', 'SUBMITTED'].includes(inv.status)) throw ApiError.conflict(`Submission cannot be changed once the invoice is ${inv.status.replace('_', ' ').toLowerCase()}`);
  const b = req.body;
  const date = b.submissionDate.toISOString().slice(0, 10);
  if (date < inv.invoice_date) throw ApiError.badRequest('Submission date cannot be before the invoice date');
  const due = addDays(date, inv.credit_days);
  await db.tx(async (c) => {
    await c.query(
      `UPDATE invoices SET status = 'SUBMITTED', submission_mode = $2, submission_date = $3, courier_awb = $4, acknowledged_by = $5, submission_remarks = $6, due_date = $7, updated_at = NOW() WHERE id = $1`,
      [inv.id, b.submissionMode, date, b.courierAwb || null, b.acknowledgedBy || null, b.remarks || null, due]
    );
    await activity.log(c, { tenantId: req.tenantId, userId: req.user.id, entityType: 'INVOICE', entityId: inv.id, action: 'INVOICE_SUBMITTED',
      message: `${inv.invoice_number} submitted to ${inv.customer_name} by ${b.submissionMode.toLowerCase()} on ${date}; payment due ${due}`, meta: { siteId: inv.site_id } });
  });
  return sendSuccess(res, await load(req.tenantId, inv.id), `Bill submission recorded — payment due ${due}`);
}));

/** Generate all recurring cycles that have started (same job the scheduler runs) */
router.post('/run-billing', requirePerm('billing.manage'), ah(async (req, res) => {
  const created = await billing.runDueCycles(req.tenantId, req.user.id);
  return sendSuccess(res, created, created.length ? `${created.length} cycle invoice(s) generated` : 'No cycles are due today');
}));

/** Raise the next cycle in advance for one site */
router.post('/sites/:siteId/next-cycle', requirePerm('billing.manage'), ah(async (req, res) => {
  const site = await db.one('SELECT * FROM sites WHERE id = $1 AND tenant_id = $2', [req.params.siteId, req.tenantId]);
  if (!site) throw ApiError.notFound('Site');
  if (site.status !== 'LIVE') throw ApiError.conflict('Only live sites can be billed');
  const inv = await db.tx(async (c) => {
    const settings = await c.one('SELECT * FROM tenant_settings WHERE tenant_id = $1', [req.tenantId]);
    return billing.generateCycle(c, site, settings, site.last_cycle_no + 1, req.user.id);
  });
  if (!inv) throw ApiError.conflict('That cycle already exists');
  return sendSuccess(res, inv, `${inv.invoice_number} (Cycle ${inv.cycle_no}) generated`, 201);
}));

router.post('/:id/cancel', requirePerm('billing.manage'), validate(Joi.object({
  reason: Joi.string().trim().min(3).required(),
  reissue: Joi.boolean().default(true)
})), ah(async (req, res) => {
  const inv = await load(req.tenantId, req.params.id);
  if (Number(inv.amount_received) > 0 || Number(inv.tds_amount) > 0) throw ApiError.conflict('Cannot cancel an invoice that has payments recorded');
  if (inv.status === 'CANCELLED') throw ApiError.conflict('Already cancelled');
  if (Number(inv.credit_amount) > 0) throw ApiError.conflict(`${inv.invoice_number} has a credit note — it cannot be cancelled; issue another credit note instead`);
  const replacement = await db.tx(async (c) => {
    await c.query("UPDATE invoices SET status = 'CANCELLED', vendor_cost = 0, submission_remarks = $2, updated_at = NOW() WHERE id = $1", [inv.id, `Cancelled: ${req.body.reason}`]);
    await activity.log(c, { tenantId: req.tenantId, userId: req.user.id, entityType: 'INVOICE', entityId: inv.id, action: 'INVOICE_CANCELLED', message: `${inv.invoice_number} cancelled: ${req.body.reason}`, meta: { siteId: inv.site_id } });
    if (!req.body.reissue) return null;
    const site = await c.one('SELECT * FROM sites WHERE id = $1', [inv.site_id]);
    return billing.reissue(c, site, inv, req.user.id);
  });
  return sendSuccess(res, { cancelled: await load(req.tenantId, inv.id), replacement },
    replacement ? `Invoice cancelled and re-issued as ${replacement.invoice_number}` : 'Invoice cancelled');
}));

/** Credit note against a bill (e.g. a link outage, a goodwill reduction, unused days). Amount is before GST. */
router.post('/:id/credit-notes', requirePerm('billing.manage'), validate(Joi.object({
  amount: Joi.number().greater(0).required().description('Credit before GST; GST is added at the bill rate'),
  reason: Joi.string().trim().min(3).max(1000).required(),
  reduceIspCost: Joi.number().min(0).default(0).description('Also reduce the ISP cost booked on this bill (e.g. the ISP credits you too)')
})), ah(async (req, res) => {
  const inv = await load(req.tenantId, req.params.id);
  const note = await db.tx((c) => billing.creditNote(c, { invoiceId: inv.id, base: req.body.amount, reason: req.body.reason, vendorReduction: req.body.reduceIspCost, userId: req.user.id }));
  return sendSuccess(res, { creditNote: note, invoice: await load(req.tenantId, inv.id) }, `Credit note ${note.credit_number} issued`, 201);
}));

guardIds(router, ['id', 'siteId']);

module.exports = router;
