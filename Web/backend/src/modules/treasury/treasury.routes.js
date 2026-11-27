/**
 * ⑤ PAYMENT TO VENDOR / TREASURY
 * Sitewise amount received → automatic priority waterfall:
 *   P1 Vendor / site payment (that site's outstanding vendor cost)
 *   P2 Loan payment (this month's EMI not yet covered)
 *   P3 Salary reserve — top up to N (=3) months of payroll
 *   remainder → surplus
 * Payouts (vendor / loan / salary) then draw down these pools.
 */
const router = require('express').Router();
const Joi = require('joi');
const { R, guardIds } = require('../../validation/rules');
const db = require('../../config/db');
const ApiError = require('../../utils/apiError');
const { ah, round2, today, notFuture , inr } = require('../../utils/helpers');
const { sendSuccess } = require('../../utils/response');
const validate = require('../../middlewares/validate.middleware');
const { authenticate, requireTenant, requirePerm } = require('../../middlewares/auth.middleware');
const activity = require('../../utils/activity');

router.use(authenticate, requireTenant);

const monthStart = () => `${today().slice(0, 7)}-01`;

/** Pool balances for a tenant (optionally inside a tx) */
const pools = async (runner, tenantId) => {
  const r = await runner.one(
    `SELECT
       (SELECT COALESCE(SUM(vendor_amount),0) FROM waterfall_allocations WHERE tenant_id = $1) AS vendor_allocated,
       (SELECT COALESCE(SUM(loan_amount),0)   FROM waterfall_allocations WHERE tenant_id = $1) AS loan_allocated,
       (SELECT COALESCE(SUM(salary_amount),0) FROM waterfall_allocations WHERE tenant_id = $1) AS salary_allocated,
       (SELECT COALESCE(SUM(surplus_amount),0) FROM waterfall_allocations WHERE tenant_id = $1) AS surplus_total,
       (SELECT COALESCE(SUM(amount),0) FROM payouts WHERE tenant_id = $1 AND category = 'VENDOR') AS vendor_paid,
       (SELECT COALESCE(SUM(amount),0) FROM payouts WHERE tenant_id = $1 AND category = 'LOAN') AS loan_paid,
       (SELECT COALESCE(SUM(amount),0) FROM payouts WHERE tenant_id = $1 AND category = 'SALARY') AS salary_paid,
       (SELECT COALESCE(SUM(w.loan_amount),0) FROM waterfall_allocations w JOIN receipts r ON r.id = w.receipt_id
          WHERE w.tenant_id = $1 AND r.received_date >= $2::date) AS loan_allocated_this_month,
       (SELECT COALESCE(SUM(vendor_cost),0) FROM invoices WHERE tenant_id = $1 AND status <> 'CANCELLED') AS vendor_accrued`,
    [tenantId, monthStart()]
  );
  return {
    ...r,
    vendor_pool: round2(r.vendor_allocated - r.vendor_paid),
    loan_pool: round2(r.loan_allocated - r.loan_paid),
    salary_reserve: round2(r.salary_allocated - r.salary_paid),
    vendor_payable_outstanding: round2(r.vendor_accrued - r.vendor_paid)
  };
};

const sitePayables = (runner, tenantId, siteId = null) => runner.many(
  `SELECT s.id AS site_id, s.code AS site_code, s.site_name, v.id AS vendor_id, v.name AS vendor_name, c.name AS customer_name,
     COALESCE((SELECT SUM(vendor_cost) FROM invoices i WHERE i.site_id = s.id AND i.status <> 'CANCELLED'),0) AS accrued,
     COALESCE((SELECT SUM(vendor_amount) FROM waterfall_allocations w WHERE w.site_id = s.id),0) AS allocated,
     COALESCE((SELECT SUM(amount) FROM payouts p WHERE p.site_id = s.id AND p.category = 'VENDOR'),0) AS paid,
     COALESCE((SELECT SUM(amount) FROM receipts r WHERE r.site_id = s.id),0) AS received
   FROM sites s JOIN vendors v ON v.id = s.vendor_id JOIN customers c ON c.id = s.customer_id
   WHERE s.tenant_id = $1 AND s.status = 'LIVE' ${siteId ? 'AND s.id = $2' : ''} ORDER BY s.code`,
  siteId ? [tenantId, siteId] : [tenantId]
).then((rows) => rows.map((r) => ({
  ...r,
  outstanding: round2(r.accrued - r.paid),
  ready_to_pay: round2(Math.min(r.allocated - r.paid, r.accrued - r.paid)),
  unfunded: round2(r.accrued - r.allocated)
})));

router.get('/summary', requirePerm('treasury.view'), ah(async (req, res) => {
  const s = await db.one('SELECT monthly_salary_burn, salary_reserve_months, loan_emi_monthly, loan_account_ref FROM tenant_settings WHERE tenant_id = $1', [req.tenantId]);
  const p = await pools(db, req.tenantId);
  const recv = await db.one(
    `SELECT
       COALESCE(SUM(total_amount - amount_received - tds_amount - credit_amount) FILTER (WHERE status IN ('SUBMITTED','PARTIALLY_PAID')),0) AS receivable_submitted,
       COALESCE(SUM(total_amount - credit_amount) FILTER (WHERE status = 'PENDING_SUBMISSION'),0) AS not_yet_submitted,
       COALESCE(SUM(total_amount - amount_received - tds_amount - credit_amount) FILTER (WHERE status IN ('SUBMITTED','PARTIALLY_PAID') AND due_date < CURRENT_DATE),0) AS overdue
     FROM invoices WHERE tenant_id = $1`, [req.tenantId]);
  const collected = await db.one('SELECT COALESCE(SUM(amount),0) AS this_month FROM receipts WHERE tenant_id = $1 AND received_date >= $2::date', [req.tenantId, monthStart()]);
  const target = round2(s.monthly_salary_burn * s.salary_reserve_months);
  return sendSuccess(res, {
    settings: s,
    pools: p,
    receivables: recv,
    collected_this_month: collected.this_month,
    salary_target: target,
    salary_coverage_pct: target > 0 ? Math.min(100, round2((p.salary_reserve / target) * 100)) : 100,
    runway_months: s.monthly_salary_burn > 0 ? round2(p.salary_reserve / s.monthly_salary_burn) : null,
    loan_emi_covered_this_month: p.loan_allocated_this_month,
    loan_emi_coverage_pct: s.loan_emi_monthly > 0 ? Math.min(100, round2((p.loan_allocated_this_month / s.loan_emi_monthly) * 100)) : 100,
    site_payables: await sitePayables(db, req.tenantId)
  });
}));

router.get('/receipts', requirePerm('treasury.view', 'billing.view'), ah(async (req, res) => sendSuccess(res, await db.many(
  `SELECT r.*, i.invoice_number, i.invoice_type, i.cycle_no, i.otc_amount, s.code AS site_code, s.site_name, c.name AS customer_name, u.name AS created_by_name,
          w.vendor_amount, w.loan_amount, w.salary_amount, w.surplus_amount
     FROM receipts r JOIN invoices i ON i.id = r.invoice_id JOIN sites s ON s.id = r.site_id JOIN customers c ON c.id = i.customer_id
     LEFT JOIN waterfall_allocations w ON w.receipt_id = r.id LEFT JOIN users u ON u.id = r.created_by
    WHERE r.tenant_id = $1 ORDER BY r.received_date DESC, r.created_at DESC`, [req.tenantId]))));

router.post('/receipts', requirePerm('treasury.manage', 'billing.manage'), validate(Joi.object({
  invoiceId: Joi.string().uuid().required(),
  amount: Joi.number().greater(0).required(),
  tdsAmount: Joi.number().min(0).default(0),
  receivedDate: Joi.date().iso().custom(notFuture).required(),
  utrRef: Joi.string().trim().min(4).max(128).required(),
  mode: Joi.string().valid('NEFT', 'RTGS', 'IMPS', 'CHEQUE', 'UPI', 'OTHER').default('NEFT'),
  remarks: Joi.string().allow('', null).max(1000)
})), ah(async (req, res) => {
  const b = req.body;
  const receivedDate = b.receivedDate.toISOString().slice(0, 10);
  const result = await db.tx(async (c) => {
    const inv = await c.one(`SELECT i.*, s.code AS site_code FROM invoices i JOIN sites s ON s.id = i.site_id WHERE i.id = $1 AND i.tenant_id = $2 FOR UPDATE OF i`, [b.invoiceId, req.tenantId]);
    if (!inv) throw ApiError.notFound('Invoice');
    if (inv.status === 'PENDING_SUBMISSION') throw ApiError.conflict(`Record the bill submission for ${inv.invoice_number} first — the payment clock starts on submission`);
    if (!['SUBMITTED', 'PARTIALLY_PAID'].includes(inv.status)) throw ApiError.conflict(`${inv.invoice_number} is ${inv.status.replace('_', ' ').toLowerCase()}`);
    const outstanding = round2(inv.total_amount - inv.amount_received - inv.tds_amount - inv.credit_amount);
    if (b.amount + b.tdsAmount > outstanding + 0.5) throw ApiError.badRequest(`Amount + TDS (${inr(round2(b.amount + b.tdsAmount))}) exceeds outstanding ${inr(outstanding)}`);
    const dupe = await c.one('SELECT id FROM receipts WHERE tenant_id = $1 AND utr_ref = $2', [req.tenantId, b.utrRef]);
    if (dupe) throw ApiError.conflict(`UTR ${b.utrRef} is already recorded`);

    const receipt = await c.one(
      `INSERT INTO receipts (tenant_id, invoice_id, site_id, amount, tds_amount, received_date, utr_ref, mode, remarks, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [req.tenantId, inv.id, inv.site_id, b.amount, b.tdsAmount, receivedDate, b.utrRef, b.mode, b.remarks || null, req.user.id]
    );
    const newReceived = round2(Number(inv.amount_received) + b.amount);
    const newTds = round2(Number(inv.tds_amount) + b.tdsAmount);
    const status = newReceived + newTds + Number(inv.credit_amount) >= Number(inv.total_amount) - 0.5 ? 'PAID' : 'PARTIALLY_PAID';
    await c.query('UPDATE invoices SET amount_received = $2, tds_amount = $3, status = $4, updated_at = NOW() WHERE id = $1', [inv.id, newReceived, newTds, status]);

    // ---- Priority waterfall ----
    const settings = await c.one('SELECT monthly_salary_burn, salary_reserve_months, loan_emi_monthly FROM tenant_settings WHERE tenant_id = $1', [req.tenantId]);
    const [site] = await sitePayables(c, req.tenantId, inv.site_id);
    const p = await pools(c, req.tenantId);
    let remaining = Number(b.amount);
    const vendorNeed = Math.max(0, round2((site?.accrued || 0) - (site?.allocated || 0)));
    const vendor = round2(Math.min(remaining, vendorNeed)); remaining = round2(remaining - vendor);
    const loanNeed = Math.max(0, round2(settings.loan_emi_monthly - p.loan_allocated_this_month));
    const loan = round2(Math.min(remaining, loanNeed)); remaining = round2(remaining - loan);
    const salaryNeed = Math.max(0, round2(settings.monthly_salary_burn * settings.salary_reserve_months - p.salary_reserve));
    const salary = round2(Math.min(remaining, salaryNeed)); remaining = round2(remaining - salary);
    const surplus = remaining;
    const alloc = await c.one(
      `INSERT INTO waterfall_allocations (tenant_id, receipt_id, site_id, vendor_amount, loan_amount, salary_amount, surplus_amount)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`, [req.tenantId, receipt.id, inv.site_id, vendor, loan, salary, surplus]);

    await activity.log(c, { tenantId: req.tenantId, userId: req.user.id, entityType: 'INVOICE', entityId: inv.id, action: 'PAYMENT_RECEIVED',
      message: `${inr(b.amount)} received for ${inv.invoice_number} (${inv.site_code}), UTR ${b.utrRef}${b.tdsAmount ? `, TDS ${inr(b.tdsAmount)}` : ''} → ${status.replace('_', ' ').toLowerCase()}`, meta: { siteId: inv.site_id, receiptId: receipt.id } });
    await activity.log(c, { tenantId: req.tenantId, userId: req.user.id, entityType: 'RECEIPT', entityId: receipt.id, action: 'WATERFALL_SPLIT',
      message: `Waterfall: Vendor ${inr(vendor)} · Loan ${inr(loan)} · Salary reserve ${inr(salary)} · Surplus ${inr(surplus)}`, meta: { siteId: inv.site_id } });
    return { receipt, allocation: alloc, invoiceStatus: status };
  });
  return sendSuccess(res, result, 'Payment recorded and split by priority', 201);
}));

router.get('/payouts', requirePerm('treasury.view'), ah(async (req, res) => sendSuccess(res, await db.many(
  `SELECT p.*, s.code AS site_code, s.site_name, v.name AS vendor_name, u.name AS created_by_name
     FROM payouts p LEFT JOIN sites s ON s.id = p.site_id LEFT JOIN vendors v ON v.id = p.vendor_id LEFT JOIN users u ON u.id = p.created_by
    WHERE p.tenant_id = $1 ORDER BY p.paid_date DESC, p.created_at DESC`, [req.tenantId]))));

router.post('/payouts', requirePerm('treasury.manage'), validate(Joi.object({
  category: Joi.string().valid('VENDOR', 'LOAN', 'SALARY').required(),
  siteId: Joi.string().uuid().when('category', { is: 'VENDOR', then: Joi.required(), otherwise: Joi.allow(null, '') }),
  amount: Joi.number().greater(0).required(),
  paidDate: Joi.date().iso().custom(notFuture).required(),
  reference: Joi.string().trim().min(3).max(128).required(),
  periodLabel: R.optional(R.text(32)),
  remarks: Joi.string().allow('', null).max(1000)
})), ah(async (req, res) => {
  const b = req.body;
  const paidDate = b.paidDate.toISOString().slice(0, 10);
  const payout = await db.tx(async (c) => {
    await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`payout-${req.tenantId}`]);
    let vendorId = null; let label;
    if (b.category === 'VENDOR') {
      const [site] = await sitePayables(c, req.tenantId, b.siteId);
      if (!site) throw ApiError.badRequest('Vendor payment needs a live site');
      if (b.amount > site.outstanding + 0.5) throw ApiError.badRequest(`Amount exceeds ${site.vendor_name} payable for ${site.site_code} (${inr(site.outstanding)})`);
      vendorId = site.vendor_id; label = `Vendor payment ${inr(b.amount)} to ${site.vendor_name} for ${site.site_code}`;
    } else {
      const p = await pools(c, req.tenantId);
      const pool = b.category === 'LOAN' ? p.loan_pool : p.salary_reserve;
      if (b.amount > pool + 0.5) throw ApiError.badRequest(`Amount exceeds the ${b.category === 'LOAN' ? 'loan pool' : 'salary reserve'} balance (${inr(pool)})`);
      label = `${b.category === 'LOAN' ? 'Loan' : 'Salary'} payment ${inr(b.amount)}${b.periodLabel ? ` for ${b.periodLabel}` : ''}`;
    }
    const row = await c.one(
      `INSERT INTO payouts (tenant_id, category, site_id, vendor_id, amount, paid_date, reference, period_label, remarks, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [req.tenantId, b.category, b.category === 'VENDOR' ? b.siteId : null, vendorId, b.amount, paidDate, b.reference, b.periodLabel || null, b.remarks || null, req.user.id]
    );
    await activity.log(c, { tenantId: req.tenantId, userId: req.user.id, entityType: 'PAYOUT', entityId: row.id, action: `PAYOUT_${b.category}`,
      message: `${label} (ref ${b.reference})`, meta: { siteId: row.site_id } });
    return row;
  });
  return sendSuccess(res, payout, 'Payout recorded', 201);
}));

guardIds(router, ['id']);

module.exports = router;
