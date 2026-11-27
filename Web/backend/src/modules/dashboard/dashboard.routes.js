/**
 * Dashboard pipeline + alerts, Site 360 (whole chain for one link), global search.
 */
const router = require('express').Router();
const db = require('../../config/db');
const ApiError = require('../../utils/apiError');
const { ah, today } = require('../../utils/helpers');
const { sendSuccess } = require('../../utils/response');
const { authenticate, requireTenant } = require('../../middlewares/auth.middleware');
const { can, ownsOnly } = require('../../constants/roles');
const activity = require('../../utils/activity');

router.use(authenticate, requireTenant);

router.get('/summary', ah(async (req, res) => {
  const t = req.tenantId;
  const counts = async (table) => Object.fromEntries((await db.many(`SELECT status, COUNT(*)::int AS n FROM ${table} WHERE tenant_id = $1 GROUP BY status`, [t])).map((r) => [r.status, r.n]));
  const [feasibility, quotes, sites, invoices] = await Promise.all([
    counts('feasibility_requests'), counts('quotes'), counts('sites'), counts('invoices')
  ]);
  const money = await db.one(
    `SELECT
       (SELECT COALESCE(SUM(finalized_value),0) FROM quotes WHERE tenant_id = $1 AND status = 'WON') AS won_value,
       (SELECT COALESCE(SUM(client_mrc + client_ip_mrc),0) FROM sites WHERE tenant_id = $1 AND status = 'LIVE') AS live_mrc,
       (SELECT COALESCE(SUM(total_amount - credit_amount),0) FROM invoices WHERE tenant_id = $1 AND status <> 'CANCELLED') AS billed,
       (SELECT COALESCE(SUM(amount),0) FROM receipts WHERE tenant_id = $1) AS collected,
       (SELECT COALESCE(SUM(total_amount - amount_received - tds_amount - credit_amount),0) FROM invoices WHERE tenant_id = $1 AND status IN ('PENDING_SUBMISSION','SUBMITTED','PARTIALLY_PAID')) AS outstanding,
       (SELECT COALESCE(SUM(amount),0) FROM payouts WHERE tenant_id = $1 AND category = 'VENDOR') AS vendor_paid`, [t]);

  const alerts = [];
  const push = (severity, module, title, rows, link) => rows.forEach((r) => alerts.push({ severity, module, title, ...r, link }));

  push('warn', 'feasibility', 'Feasibility not assigned to a surveyor', await db.many(
    `SELECT id, code AS ref, site_name AS detail, created_at AS since FROM feasibility_requests WHERE tenant_id = $1 AND status = 'NEW' ORDER BY created_at`, [t]), 'feasibility');
  push('info', 'commercial', 'Quote sent — awaiting client decision for over 7 days', await db.many(
    `SELECT id, code AS ref, site_name AS detail, sent_at AS since FROM quotes WHERE tenant_id = $1 AND status = 'SENT' AND sent_at < NOW() - INTERVAL '7 days'`, [t]), 'commercial');
  push('warn', 'implementation', 'Bid won — client PO not received', await db.many(
    `SELECT id, code AS ref, site_name AS detail, created_at AS since FROM sites WHERE tenant_id = $1 AND status = 'AWAITING_PO'`, [t]), 'implementation');
  push('warn', 'implementation', 'PO copy not uploaded', await db.many(
    `SELECT s.id, s.code AS ref, s.po_number AS detail, s.po_received_at AS since FROM sites s WHERE s.tenant_id = $1 AND s.po_number IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM documents d WHERE d.entity_type = 'SITE' AND d.entity_id = s.id AND d.doc_type = 'PO_COPY')`, [t]), 'implementation');
  push('bad', 'implementation', 'Site delivery SLA overdue', await db.many(
    `SELECT id, code AS ref, site_name || ' — target ' || to_char(target_live_date, 'DD Mon') AS detail, target_live_date AS since FROM sites
      WHERE tenant_id = $1 AND status IN ('WORK_STARTED','BLOCKED') AND target_live_date < CURRENT_DATE`, [t]), 'implementation');
  push('bad', 'implementation', 'Pending with', await db.many(
    `SELECT s.id, s.code AS ref, (CASE b.party WHEN 'CLIENT' THEN c.name WHEN 'VENDOR' THEN v.name WHEN 'CUSTOMER' THEN 'Customer at site'
         WHEN 'COMPANY' THEN tn.name || ' (internal)' WHEN 'AUTHORITY' THEN ts.authority_label ELSE 'Other' END) || ': ' || b.reason AS detail, b.raised_at AS since
       FROM site_blockers b JOIN sites s ON s.id = b.site_id JOIN customers c ON c.id = s.customer_id JOIN vendors v ON v.id = s.vendor_id
       JOIN tenant_settings ts ON ts.tenant_id = b.tenant_id JOIN tenants tn ON tn.id = b.tenant_id
      WHERE b.tenant_id = $1 AND b.resolved_at IS NULL ORDER BY b.raised_at`, [t]), 'implementation');
  push('warn', 'implementation', 'AT sign-off document not uploaded', await db.many(
    `SELECT s.id, s.code AS ref, s.site_name AS detail, s.live_date AS since FROM sites s WHERE s.tenant_id = $1 AND s.status = 'LIVE'
       AND NOT EXISTS (SELECT 1 FROM documents d WHERE d.entity_type = 'SITE' AND d.entity_id = s.id AND d.doc_type = 'AT_SIGNOFF')`, [t]), 'implementation');
  // Contract ends (live date + contract months): renew with the client, or disconnect
  const CONTRACT_END = "((COALESCE(s.contract_start, s.live_date) + make_interval(months => s.contract_months))::date - 1)";
  push('bad', 'implementation', 'Link down', await db.many(
    `SELECT s.id, s.code AS ref, s.site_name || ' · ' || v.name || COALESCE(' docket ' || f.docket_no, '') || ' — ' || f.description AS detail, f.reported_at AS since
       FROM site_faults f JOIN sites s ON s.id = f.site_id JOIN vendors v ON v.id = f.vendor_id
      WHERE f.tenant_id = $1 AND f.restored_at IS NULL ORDER BY f.reported_at`, [t]), 'live');
  push('bad', 'implementation', 'Contract ended — renew or disconnect', await db.many(
    `SELECT s.id, s.code AS ref, s.site_name || ' · ' || c.name || ' · ended ' || to_char(${CONTRACT_END}, 'DD Mon YYYY') AS detail, ${CONTRACT_END} AS since
       FROM sites s JOIN customers c ON c.id = s.customer_id
      WHERE s.tenant_id = $1 AND s.status = 'LIVE' AND ${CONTRACT_END} < CURRENT_DATE ORDER BY 4`, [t]), 'live');
  push('warn', 'implementation', 'Contract ending within 60 days', await db.many(
    `SELECT s.id, s.code AS ref, s.site_name || ' · ' || c.name || ' · ends ' || to_char(${CONTRACT_END}, 'DD Mon YYYY') AS detail, ${CONTRACT_END} AS since
       FROM sites s JOIN customers c ON c.id = s.customer_id
      WHERE s.tenant_id = $1 AND s.status = 'LIVE' AND ${CONTRACT_END} BETWEEN CURRENT_DATE AND CURRENT_DATE + 60 ORDER BY 4`, [t]), 'live');
  push('warn', 'billing', 'Bill not yet submitted to customer', await db.many(
    `SELECT i.id, i.invoice_number AS ref, s.code || ' · ₹' || i.total_amount AS detail, i.invoice_date AS since FROM invoices i JOIN sites s ON s.id = i.site_id
      WHERE i.tenant_id = $1 AND i.status = 'PENDING_SUBMISSION' ORDER BY i.invoice_date`, [t]), 'billing');
  push('bad', 'billing', 'Payment overdue', await db.many(
    `SELECT i.id, i.invoice_number AS ref, s.code || ' · due ' || to_char(i.due_date, 'DD Mon') AS detail, i.due_date AS since FROM invoices i JOIN sites s ON s.id = i.site_id
      WHERE i.tenant_id = $1 AND i.status IN ('SUBMITTED','PARTIALLY_PAID') AND i.due_date < CURRENT_DATE`, [t]), 'billing');

  push('warn', 'treasury', 'ISP bill differs from the expected cost', (await db.many(
    `SELECT v.id, b.bill_number AS ref, v.name || ': billed ₹' || b.amount || ', expected ₹' || b.expected_amount AS detail, b.bill_date AS since
       FROM vendor_bills b JOIN vendors v ON v.id = b.vendor_id
      WHERE b.tenant_id = $1 AND ABS(b.amount - b.expected_amount) > 1 AND b.bill_date > CURRENT_DATE - 60 ORDER BY b.bill_date DESC`, [t])), 'masters');
  const s = await db.one('SELECT monthly_salary_burn, salary_reserve_months, loan_emi_monthly FROM tenant_settings WHERE tenant_id = $1', [t]);
  if (Number(s.monthly_salary_burn) === 0 || Number(s.loan_emi_monthly) === 0) {
    alerts.push({ severity: 'info', module: 'settings', title: 'Treasury settings incomplete', ref: 'Settings', detail: 'Set monthly salary burn and loan EMI so the payment waterfall can reserve them', link: 'settings' });
  }

  const setup = await db.one(
    `SELECT
       (SELECT COUNT(*) FROM customers WHERE tenant_id = $1)::int AS customers,
       (SELECT COUNT(*) FROM vendors WHERE tenant_id = $1 AND vendor_type = 'ISP')::int AS isp_vendors,
       (SELECT COUNT(*) FROM users WHERE tenant_id = $1 AND role = 'FIELD_ENGINEER' AND is_active)::int AS surveyors,
       (SELECT COUNT(*) FROM client_orders WHERE tenant_id = $1)::int AS orders,
       (SELECT COUNT(*) FROM users WHERE tenant_id = $1 AND is_active)::int AS users,
       (SELECT monthly_salary_burn > 0 AND loan_emi_monthly >= 0 FROM tenant_settings WHERE tenant_id = $1) AS treasury_set,
       (SELECT gstin IS NOT NULL AND gstin <> '' FROM tenants WHERE id = $1) AS gstin_set`, [t]);

  // Role-scoped: only alerts / activity / money for modules this user may view
  const role = req.user.role;
  const MODULE_PERM = { feasibility: 'feasibility.view', commercial: 'commercial.view', implementation: 'implementation.view', billing: 'billing.view', treasury: 'treasury.view', settings: 'settings.manage' };
  const TYPE_PERM = { ORDER: 'orders.view', FEASIBILITY: 'feasibility.view', QUOTE: 'commercial.view', SITE: 'implementation.view', INVOICE: 'billing.view', RECEIPT: 'treasury.view', PAYOUT: 'treasury.view', CUSTOMER: 'masters.view', VENDOR: 'masters.view', USER: 'users.manage', TENANT: 'users.manage', SETTINGS: 'settings.manage' };
  const types = Object.entries(TYPE_PERM).filter(([, p]) => can(role, p)).map(([k]) => k);
  const recent = await db.many(`SELECT a.*, u.name AS user_name FROM activity_log a LEFT JOIN users u ON u.id = a.user_id
     WHERE a.tenant_id = $1 AND a.action <> 'LOGIN' AND a.entity_type = ANY($2) ORDER BY a.created_at DESC LIMIT 15`, [t, types]).then((rows) => activity.redactMoney(role, rows));
  // Field engineer: their own queue, and alerts only for the sites they own
  let mine = null;
  let visibleAlerts = alerts.filter((a) => can(role, MODULE_PERM[a.module] || 'users.manage'));
  if (ownsOnly(role)) {
    const u = req.user.id;
    mine = await db.one(
      `SELECT
         (SELECT COUNT(*) FROM feasibility_requests WHERE tenant_id = $1 AND assigned_to = $2 AND status = 'ASSIGNED')::int AS survey_pending,
         (SELECT COUNT(*) FROM feasibility_requests WHERE tenant_id = $1 AND assigned_to = $2 AND status IN ('SURVEY_DONE','PRICE_FINALIZED'))::int AS with_commercial,
         (SELECT COUNT(*) FROM sites WHERE tenant_id = $1 AND owner_id = $2 AND status = 'AWAITING_PO')::int AS awaiting_po,
         (SELECT COUNT(*) FROM sites WHERE tenant_id = $1 AND owner_id = $2 AND status = 'PO_RECEIVED')::int AS ready_to_start,
         (SELECT COUNT(*) FROM sites WHERE tenant_id = $1 AND owner_id = $2 AND status IN ('WORK_STARTED','BLOCKED'))::int AS in_delivery,
         (SELECT COUNT(*) FROM sites WHERE tenant_id = $1 AND owner_id = $2 AND status = 'BLOCKED')::int AS blocked,
         (SELECT COUNT(*) FROM sites WHERE tenant_id = $1 AND owner_id = $2 AND status = 'LIVE')::int AS delivered`, [t, u]);
    const ownSites = new Set((await db.many('SELECT id FROM sites WHERE tenant_id = $1 AND owner_id = $2', [t, u])).map((r) => r.id));
    const ownSurveys = await db.many(
      `SELECT id, code AS ref, site_name AS detail, assigned_at AS since FROM feasibility_requests WHERE tenant_id = $1 AND assigned_to = $2 AND status = 'ASSIGNED' ORDER BY assigned_at`, [t, u]);
    visibleAlerts = [
      ...ownSurveys.map((r) => ({ severity: 'warn', module: 'feasibility', title: 'Survey pending — assigned to you', ...r, link: 'feasibility' })),
      ...visibleAlerts.filter((a) => a.module === 'implementation' && ownSites.has(a.id))
    ];
  }
  return sendSuccess(res, {
    pipeline: { feasibility, quotes, sites, invoices },
    money: can(role, 'billing.view') ? money : null,
    alerts: visibleAlerts,
    mine,
    recent,
    setup,
    today: today()
  });
}));

/** Site 360 — accepts a site, quote or feasibility id and returns the full chain */
router.get('/lifecycle/:id', ah(async (req, res) => {
  const t = req.tenantId;
  const id = req.params.id;
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw ApiError.badRequest('Invalid id');
  let feasibilityId = (await db.one('SELECT id FROM feasibility_requests WHERE id = $1 AND tenant_id = $2', [id, t]))?.id;
  if (!feasibilityId) feasibilityId = (await db.one('SELECT feasibility_id FROM quotes WHERE id = $1 AND tenant_id = $2', [id, t]))?.feasibility_id;
  if (!feasibilityId) feasibilityId = (await db.one('SELECT feasibility_id FROM sites WHERE id = $1 AND tenant_id = $2', [id, t]))?.feasibility_id;
  if (!feasibilityId) feasibilityId = (await db.one('SELECT s.feasibility_id FROM invoices i JOIN sites s ON s.id = i.site_id WHERE i.id = $1 AND i.tenant_id = $2', [id, t]))?.feasibility_id;
  if (!feasibilityId) throw ApiError.notFound('Record');

  const feasibility = await db.one(
    `SELECT f.*, c.name AS customer_name, u.name AS assigned_name, co.code AS order_code, co.client_ref AS order_client_ref, co.received_via AS order_received_via
       FROM feasibility_requests f JOIN customers c ON c.id = f.customer_id LEFT JOIN users u ON u.id = f.assigned_to
       LEFT JOIN client_orders co ON co.id = f.order_id WHERE f.id = $1`, [feasibilityId]);
  feasibility.options = await db.many('SELECT o.*, v.name AS vendor_name FROM feasibility_isp_options o JOIN vendors v ON v.id = o.vendor_id WHERE o.feasibility_id = $1 ORDER BY o.vendor_mrc', [feasibilityId]);
  const quote = await db.one('SELECT q.*, v.name AS final_vendor_name FROM quotes q LEFT JOIN vendors v ON v.id = q.final_vendor_id WHERE q.feasibility_id = $1', [feasibilityId]);
  if (quote) quote.options = await db.many('SELECT o.*, v.name AS vendor_name FROM quote_options o JOIN vendors v ON v.id = o.vendor_id WHERE o.quote_id = $1 ORDER BY o.option_no', [quote.id]);
  const site = quote ? await db.one('SELECT s.*, v.name AS vendor_name, o.name AS owner_name FROM sites s JOIN vendors v ON v.id = s.vendor_id LEFT JOIN users o ON o.id = s.owner_id WHERE s.quote_id = $1', [quote.id]) : null;
  let blockers = []; let invoices = []; let receipts = []; let payouts = [];
  if (site) {
    blockers = await db.many('SELECT * FROM site_blockers WHERE site_id = $1 ORDER BY raised_at', [site.id]);
    invoices = await db.many("SELECT *, (total_amount - amount_received - tds_amount - credit_amount) AS outstanding FROM invoices WHERE site_id = $1 ORDER BY cycle_no, invoice_date", [site.id]);
    receipts = await db.many('SELECT r.*, i.invoice_number, w.vendor_amount, w.loan_amount, w.salary_amount, w.surplus_amount FROM receipts r JOIN invoices i ON i.id = r.invoice_id LEFT JOIN waterfall_allocations w ON w.receipt_id = r.id WHERE r.site_id = $1 ORDER BY r.received_date', [site.id]);
    payouts = await db.many("SELECT * FROM payouts WHERE site_id = $1 ORDER BY paid_date", [site.id]);
  }
  const ids = [feasibility.order_id, feasibility.id, quote?.id, site?.id, ...invoices.map((i) => i.id), ...receipts.map((r) => r.id), ...payouts.map((p) => p.id)].filter(Boolean);
  const documents = await db.many('SELECT d.*, u.name AS uploaded_by_name FROM documents d LEFT JOIN users u ON u.id = d.uploaded_by WHERE d.tenant_id = $1 AND d.entity_id = ANY($2) ORDER BY d.created_at', [t, ids]);
  const timeline = await db.many('SELECT a.*, u.name AS user_name FROM activity_log a LEFT JOIN users u ON u.id = a.user_id WHERE a.tenant_id = $1 AND a.entity_id = ANY($2) ORDER BY a.created_at', [t, ids]);

  const stage = !site ? (quote ? 'COMMERCIAL' : 'FEASIBILITY') : site.status !== 'LIVE' ? 'IMPLEMENTATION' : receipts.length ? 'PAYMENT' : 'BILLING';
  // Role scoping — hide sections the user may not view
  const role = req.user.role;
  const show = { FEASIBILITY: can(role, 'feasibility.view'), QUOTE: can(role, 'commercial.view'), SITE: can(role, 'implementation.view'), INVOICE: can(role, 'billing.view'), RECEIPT: can(role, 'treasury.view'), PAYOUT: can(role, 'treasury.view') };
  const visibleIds = new Set([
    can(role, 'orders.view') && feasibility.order_id, show.FEASIBILITY && feasibility.id, show.QUOTE && quote?.id, show.SITE && site?.id,
    ...(show.INVOICE ? invoices.map((i) => i.id) : []), ...(show.RECEIPT ? receipts.map((r) => r.id) : []), ...(show.PAYOUT ? payouts.map((p) => p.id) : [])
  ].filter(Boolean));
  return sendSuccess(res, {
    stage,
    feasibility,
    quote: show.QUOTE ? quote : quote && { id: quote.id, code: quote.code, status: quote.status, restricted: true },
    site: site && (can(role, 'commercial.view') ? site : Object.fromEntries(Object.entries(site).filter(([k]) => !/(_otc|_mrc|po_value|reconnect_)/.test(k)))),
    blockers,
    invoices: show.INVOICE ? invoices : [],
    receipts: show.RECEIPT ? receipts : [],
    payouts: show.PAYOUT ? payouts : [],
    documents: documents.filter((d) => visibleIds.has(d.entity_id)),
    timeline: activity.redactMoney(role, timeline.filter((a) => visibleIds.has(a.entity_id)))
  });
}));

router.get('/search', ah(async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 2) return sendSuccess(res, []);
  const like = `%${q}%`;
  const t = req.tenantId;
  const rows = await db.many(
    `(SELECT 'orders' AS module, o.id, o.code AS ref, c.name || COALESCE(' · ' || o.client_ref, '') AS detail, o.received_via AS status FROM client_orders o JOIN customers c ON c.id = o.customer_id
        WHERE o.tenant_id = $1 AND (o.code ILIKE $2 OR o.client_ref ILIKE $2 OR c.name ILIKE $2) LIMIT 8)
     UNION ALL
     (SELECT 'feasibility' AS module, f.id, f.code AS ref, f.site_name || COALESCE(' [' || f.client_site_ref || ']', '') || ' · ' || c.name AS detail, f.status FROM feasibility_requests f JOIN customers c ON c.id = f.customer_id
        WHERE f.tenant_id = $1 AND (f.code ILIKE $2 OR f.site_name ILIKE $2 OR c.name ILIKE $2 OR f.address ILIKE $2 OR f.client_site_ref ILIKE $2) LIMIT 8)
     UNION ALL
     (SELECT 'commercial', q.id, q.code, q.site_name, q.status FROM quotes q WHERE q.tenant_id = $1 AND (q.code ILIKE $2 OR q.site_name ILIKE $2) LIMIT 8)
     UNION ALL
     (SELECT 'implementation', s.id, s.code, s.site_name || COALESCE(' · PO ' || s.po_number, ''), s.status FROM sites s
        WHERE s.tenant_id = $1 AND (s.code ILIKE $2 OR s.site_name ILIKE $2 OR s.po_number ILIKE $2 OR s.circuit_id ILIKE $2 OR s.wan_ip ILIKE $2 OR s.client_site_ref ILIKE $2) LIMIT 8)
     UNION ALL
     (SELECT 'billing', i.id, i.invoice_number, s.code || ' · ₹' || i.total_amount, i.status FROM invoices i JOIN sites s ON s.id = i.site_id
        WHERE i.tenant_id = $1 AND (i.invoice_number ILIKE $2 OR i.courier_awb ILIKE $2 OR s.client_site_ref ILIKE $2 OR s.po_number ILIKE $2) LIMIT 8)`,
    [t, like]
  );
  const perm = { orders: 'orders.view', feasibility: 'feasibility.view', commercial: 'commercial.view', implementation: 'implementation.view', billing: 'billing.view' };
  return sendSuccess(res, rows.filter((r) => can(req.user.role, perm[r.module])));
}));

module.exports = router;
