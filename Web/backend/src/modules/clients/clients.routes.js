/**
 * CLIENTS & ORDERS
 * Clients (telecom operators, banks, enterprises …) send orders on WhatsApp / email for links at one or many sites.
 * The company's field engineers paste the order here → one feasibility request per site,
 * owned by the engineer who takes it forward to delivery. The order page tracks every site to go-live and billing.
 */
const express = require('express');
const fs = require('fs');
const path = require('path');
const Joi = require('joi');
const { uploadRoot } = require('../../middlewares/upload.middleware');
const { R, guardIds } = require('../../validation/rules');
const db = require('../../config/db');
const ApiError = require('../../utils/apiError');
const { ah, nextCode, today, notFuture } = require('../../utils/helpers');
const { sendSuccess } = require('../../utils/response');
const validate = require('../../middlewares/validate.middleware');
const { authenticate, requireTenant, requirePerm } = require('../../middlewares/auth.middleware');
const { can, ownsOnly } = require('../../constants/roles');
const activity = require('../../utils/activity');
const { parseOrderText } = require('../../utils/orderParser');
const { siteFields, resolveAssignee, checkAssignee, insertRequest, loadClient } = require('../feasibility/request.service');

/* Stage of one site in its journey — used by order and client views */
const STAGE_SQL = `CASE
  WHEN f.status IN ('NOT_FEASIBLE','CANCELLED') THEN 'STOPPED'
  WHEN q.id IS NULL THEN 'FEASIBILITY'
  WHEN q.status = 'LOST' THEN 'LOST'
  WHEN s.id IS NULL THEN 'QUOTE'
  WHEN s.status = 'AWAITING_PO' THEN 'AWAITING_PO'
  WHEN s.status = 'LIVE' THEN 'LIVE'
  WHEN s.status = 'TERMINATED' THEN 'TERMINATED'
  ELSE 'DELIVERY' END`;

const SITE_ROWS_SQL = `
  SELECT f.id AS feasibility_id, f.code AS feasibility_code, f.site_name, f.address, f.client_site_ref, f.bandwidth_mbps,
    f.status AS feasibility_status, f.stop_reason, f.order_id, f.customer_id, f.assigned_to, u.name AS owner_name, f.created_at,
    f.site_contact_name, f.site_contact_phone, f.link_role, f.static_ip_count, co.code AS order_code,
    q.id AS quote_id, q.code AS quote_code, q.status AS quote_status, q.finalized_value,
    s.id AS site_id, s.code AS site_code, s.status AS site_status, s.po_number, s.live_date, s.target_live_date, s.client_mrc + s.client_ip_mrc AS client_mrc,
    so.name AS site_owner_name,
    (SELECT b.party FROM site_blockers b WHERE b.site_id = s.id AND b.resolved_at IS NULL ORDER BY b.raised_at DESC LIMIT 1) AS pending_with,
    COALESCE(inv.billed, 0) AS billed, COALESCE(inv.received, 0) AS received, COALESCE(inv.outstanding, 0) AS outstanding,
    ${STAGE_SQL} AS stage
  FROM feasibility_requests f
  LEFT JOIN users u ON u.id = f.assigned_to
  LEFT JOIN client_orders co ON co.id = f.order_id
  LEFT JOIN quotes q ON q.feasibility_id = f.id
  LEFT JOIN sites s ON s.quote_id = q.id
  LEFT JOIN users so ON so.id = s.owner_id
  LEFT JOIN LATERAL (
    SELECT SUM(i.total_amount - i.credit_amount) AS billed, SUM(i.amount_received) AS received,
           SUM(i.total_amount - i.amount_received - i.tds_amount - i.credit_amount) FILTER (WHERE i.status IN ('PENDING_SUBMISSION','SUBMITTED','PARTIALLY_PAID')) AS outstanding
      FROM invoices i WHERE i.site_id = s.id AND i.status <> 'CANCELLED') inv ON TRUE`;

const STAGES = ['FEASIBILITY', 'QUOTE', 'AWAITING_PO', 'DELIVERY', 'LIVE', 'STOPPED', 'LOST', 'TERMINATED'];
const stageCounts = (rows) => Object.fromEntries(STAGES.map((k) => [k, rows.filter((r) => r.stage === k).length]));

/** Hide money the user may not see */
const scrub = (role, r) => {
  const out = { ...r };
  if (!can(role, 'commercial.view')) { delete out.finalized_value; delete out.client_mrc; }
  if (!can(role, 'billing.view')) { delete out.billed; delete out.received; delete out.outstanding; }
  return out;
};

const money = (role, rows) => (can(role, 'billing.view') ? {
  billed: rows.reduce((a, r) => a + Number(r.billed || 0), 0),
  received: rows.reduce((a, r) => a + Number(r.received || 0), 0),
  outstanding: rows.reduce((a, r) => a + Number(r.outstanding || 0), 0),
  live_mrc: can(role, 'commercial.view') ? rows.filter((r) => r.stage === 'LIVE').reduce((a, r) => a + Number(r.client_mrc || 0), 0) : undefined
} : null);

/* ================================ ORDERS ================================ */
const orders = express.Router();
orders.use(authenticate, requireTenant);

const ORDER_SQL = `
  SELECT o.*, c.name AS customer_name, c.client_type, u.name AS owner_name, cb.name AS created_by_name
    FROM client_orders o JOIN customers c ON c.id = o.customer_id
    LEFT JOIN users u ON u.id = o.owner_id LEFT JOIN users cb ON cb.id = o.created_by`;

const loadOrder = async (tenantId, id) => {
  if (!/^[0-9a-f-]{36}$/i.test(String(id))) throw ApiError.badRequest('Invalid order id');
  const o = await db.one(`${ORDER_SQL} WHERE o.tenant_id = $1 AND o.id = $2`, [tenantId, id]);
  if (!o) throw ApiError.notFound('Client order');
  return o;
};

const orderDetail = async (req, id) => {
  const o = await loadOrder(req.tenantId, id);
  const rows = await db.many(`${SITE_ROWS_SQL} WHERE f.tenant_id = $1 AND f.order_id = $2 ORDER BY f.created_at, f.code`, [req.tenantId, id]);
  return { ...o, stages: stageCounts(rows), money: money(req.user.role, rows), sites: rows.map((r) => scrub(req.user.role, r)) };
};

orders.get('/', requirePerm('orders.view'), ah(async (req, res) => {
  const params = [req.tenantId];
  let where = 'o.tenant_id = $1';
  if (req.query.customerId) { params.push(req.query.customerId); where += ` AND o.customer_id = $${params.length}`; }
  if (req.query.mine === '1') {
    params.push(req.user.id);
    where += ` AND (o.owner_id = $${params.length} OR EXISTS (SELECT 1 FROM feasibility_requests x WHERE x.order_id = o.id AND x.assigned_to = $${params.length}))`;
  }
  const list = await db.many(`${ORDER_SQL} WHERE ${where} ORDER BY o.received_date DESC, o.created_at DESC`, params);
  const rows = list.length ? await db.many(`${SITE_ROWS_SQL} WHERE f.tenant_id = $1 AND f.order_id = ANY($2)`, [req.tenantId, list.map((o) => o.id)]) : [];
  return sendSuccess(res, list.map((o) => {
    const mine = rows.filter((r) => r.order_id === o.id);
    return { ...o, site_count: mine.length, stages: stageCounts(mine), money: money(req.user.role, mine) };
  }));
}));

orders.post('/parse', requirePerm('orders.create'), validate(Joi.object({ text: Joi.string().allow('').max(20000).required() })),
  ah(async (req, res) => sendSuccess(res, parseOrderText(req.body.text))));

orders.get('/:id', requirePerm('orders.view'), ah(async (req, res) => sendSuccess(res, await orderDetail(req, req.params.id))));

const orderHeader = {
  clientRef: R.optional(R.text(128)),
  receivedVia: Joi.string().valid('WHATSAPP', 'EMAIL', 'PORTAL', 'LETTER', 'PHONE').default('WHATSAPP'),
  receivedDate: Joi.date().iso().custom(notFuture),
  clientContactName: R.optional(R.name(128)),
  clientContactPhone: R.optional(R.phone()),
  clientContactEmail: R.optional(R.email()),
  expectedBy: Joi.date().iso().allow(null, ''),
  rawMessage: Joi.string().allow('', null).max(20000),
  notes: Joi.string().allow('', null).max(2000)
};
const sitesSchema = Joi.array().min(1).max(100).items(Joi.object(siteFields)).required();
const iso = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : d || null);
const CHANNEL = { WHATSAPP: 'WHATSAPP', EMAIL: 'EMAIL', PHONE: 'PHONE', PORTAL: 'MANUAL', LETTER: 'MANUAL' };

/** Assignee per site: managers may set one per row; a field engineer always owns what they paste */
const assigneesFor = async (req, sites, orderOwner) => {
  const cache = new Map();
  const out = [];
  for (const st of sites) {
    const wanted = st.assignedTo || orderOwner?.id || null;
    if (!cache.has(wanted)) cache.set(wanted, wanted ? await resolveAssignee(req, wanted) : await resolveAssignee(req, null));
    out.push(cache.get(wanted));
  }
  return out;
};

const addSites = async (c, req, order, customer, sites, assignees, rawMessage) => {
  const created = [];
  for (let i = 0; i < sites.length; i += 1) {
    created.push(await insertRequest(c, {
      tenantId: req.tenantId, userId: req.user.id, customer, order, sourceChannel: CHANNEL[order.received_via] || 'MANUAL', rawMessage,
      requesterName: order.client_contact_name, requesterPhone: order.client_contact_phone
    }, sites[i], assignees[i]));
  }
  return created;
};

/** Create an order with all its sites in one transaction (from the form, or from an Excel import) */
const createOrder = async (req, b, via = '') => {
  const customer = await loadClient(req.tenantId, b.customerId);
  const owner = await resolveAssignee(req, b.ownerId || null);
  const assignees = await assigneesFor(req, b.sites, owner);
  return db.tx(async (c) => {
    const code = await nextCode(c, req.tenantId, 'ORD', 'ORD');
    const o = await c.one(
      `INSERT INTO client_orders (tenant_id, code, customer_id, client_ref, received_via, received_date, client_contact_name, client_contact_phone,
         client_contact_email, expected_by, raw_message, notes, owner_id, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
      [req.tenantId, code, customer.id, b.clientRef || null, b.receivedVia, iso(b.receivedDate) || today(), b.clientContactName || null, b.clientContactPhone || null,
        b.clientContactEmail || null, iso(b.expectedBy), b.rawMessage || null, b.notes || null, owner?.id || null, req.user.id]
    );
    await activity.log(c, { tenantId: req.tenantId, userId: req.user.id, entityType: 'ORDER', entityId: o.id, action: 'ORDER_CREATED',
      message: `${o.code} received from ${customer.name} on ${b.receivedVia}${b.clientRef ? ` (ref ${b.clientRef})` : ''}: ${b.sites.length} site(s)${via}${owner ? `, owner ${owner.name}` : ''}` });
    await addSites(c, req, o, customer, b.sites, assignees, b.rawMessage);
    return o.id;
  });
};

const newOrderSchema = (sites) => Joi.object({
  ...orderHeader,
  customerId: Joi.string().uuid().required(),
  ownerId: Joi.string().uuid().allow(null, ''),
  sites
});

orders.post('/', requirePerm('orders.create'), validate(newOrderSchema(sitesSchema)), ah(async (req, res) => {
  const id = await createOrder(req, req.body);
  return sendSuccess(res, await orderDetail(req, id), `Order logged — ${req.body.sites.length} site request(s) created in Feasibility`, 201);
}));

/**
 * Excel import: one order with up to 2000 sites (rows of the import template), all or nothing.
 * The web app validates every row first and only sends the rows without errors.
 */
const IMPORT_MAX_SITES = 2000;
orders.post('/import', requirePerm('orders.create'),
  validate(newOrderSchema(Joi.array().min(1).max(IMPORT_MAX_SITES).items(Joi.object(siteFields)).required())),
  ah(async (req, res) => {
    const id = await createOrder(req, req.body, ' (Excel import)');
    return sendSuccess(res, await orderDetail(req, id), `Imported ${req.body.sites.length} site(s) — created in Feasibility`, 201);
  }));

/** Add more sites to an existing order (client sends another list later) */
orders.post('/:id/sites', requirePerm('orders.create'), validate(Joi.object({ sites: sitesSchema })), ah(async (req, res) => {
  const o = await loadOrder(req.tenantId, req.params.id);
  if (ownsOnly(req.user.role) && o.owner_id && o.owner_id !== req.user.id) throw ApiError.forbidden(`${o.code} is owned by ${o.owner_name}`);
  const customer = await loadClient(req.tenantId, o.customer_id);
  const owner = o.owner_id ? { id: o.owner_id } : null;
  const assignees = await assigneesFor(req, req.body.sites, owner);
  await db.tx(async (c) => {
    await addSites(c, req, o, customer, req.body.sites, assignees, null);
    await activity.log(c, { tenantId: req.tenantId, userId: req.user.id, entityType: 'ORDER', entityId: o.id, action: 'ORDER_SITES_ADDED', message: `${req.body.sites.length} site(s) added to ${o.code}` });
  });
  return sendSuccess(res, await orderDetail(req, o.id), `${req.body.sites.length} site(s) added`);
}));

/** Sites of the order that have gone past feasibility (a quote exists) — the order is then locked to its client and cannot be deleted */
const quotedSites = (tenantId, orderId, runner = db) => runner.many(
  `SELECT f.code FROM feasibility_requests f JOIN quotes q ON q.feasibility_id = f.id
    WHERE f.tenant_id = $1 AND f.order_id = $2 ORDER BY f.code`, [tenantId, orderId]);

const assertOrderOwner = (req, o, what) => {
  if (ownsOnly(req.user.role) && o.owner_id && o.owner_id !== req.user.id) throw ApiError.forbidden(`${o.code} is owned by ${o.owner_name} — you cannot ${what}`);
};

orders.patch('/:id', requirePerm('orders.create'), validate(Joi.object({
  ...orderHeader,
  customerId: Joi.string().uuid(),
  receivedVia: Joi.string().valid('WHATSAPP', 'EMAIL', 'PORTAL', 'LETTER', 'PHONE'),
  ownerId: Joi.string().uuid().allow(null, '')
}).min(1)), ah(async (req, res) => {
  const o = await loadOrder(req.tenantId, req.params.id);
  assertOrderOwner(req, o, 'edit it');
  const b = req.body;
  if (b.ownerId && b.ownerId !== o.owner_id) {
    if (!can(req.user.role, 'feasibility.assign')) throw ApiError.forbidden('Only a manager can change the order owner');
    await checkAssignee(req.tenantId, b.ownerId);
  }
  const changeClient = b.customerId && b.customerId !== o.customer_id;
  let customer = null;
  if (changeClient) {
    customer = await loadClient(req.tenantId, b.customerId);
    const quoted = await quotedSites(req.tenantId, o.id);
    if (quoted.length) throw ApiError.badRequest(`The client cannot be changed: ${quoted.map((q) => q.code).join(', ')} already has a quote`);
  }
  const map = { customerId: 'customer_id', clientRef: 'client_ref', receivedVia: 'received_via', receivedDate: 'received_date', clientContactName: 'client_contact_name', clientContactPhone: 'client_contact_phone',
    clientContactEmail: 'client_contact_email', expectedBy: 'expected_by', notes: 'notes', ownerId: 'owner_id' };
  const sets = []; const vals = [o.id];
  Object.entries(map).forEach(([k, col]) => { if (b[k] !== undefined) { vals.push(b[k] === '' ? null : iso(b[k])); sets.push(`${col} = $${vals.length}`); } });
  await db.tx(async (c) => {
    if (sets.length) await c.query(`UPDATE client_orders SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $1`, vals);
    // The site requests of the order follow the order's client
    if (changeClient) await c.query('UPDATE feasibility_requests SET customer_id = $1, updated_at = NOW() WHERE order_id = $2 AND tenant_id = $3', [customer.id, o.id, req.tenantId]);
    await activity.log(c, { tenantId: req.tenantId, userId: req.user.id, entityType: 'ORDER', entityId: o.id, action: 'ORDER_UPDATED',
      message: `${o.code} edited${changeClient ? `: client changed from ${o.customer_name} to ${customer.name}` : ''}` });
  });
  return sendSuccess(res, await orderDetail(req, o.id), 'Order updated');
}));

/**
 * Delete an order logged by mistake, with its site requests. Allowed only while no site has a quote;
 * after that, stop the site in Feasibility / Quote instead so the history is kept.
 */
orders.delete('/:id', requirePerm('orders.create'), ah(async (req, res) => {
  const o = await loadOrder(req.tenantId, req.params.id);
  assertOrderOwner(req, o, 'delete it');
  const files = await db.tx(async (c) => {
    const quoted = await quotedSites(req.tenantId, o.id, c);
    if (quoted.length) throw ApiError.badRequest(`${o.code} cannot be deleted: ${quoted.map((q) => q.code).join(', ')} already has a quote. Stop the site instead.`);
    const feas = (await c.many('SELECT id, code FROM feasibility_requests WHERE tenant_id = $1 AND order_id = $2', [req.tenantId, o.id]));
    const ids = [o.id, ...feas.map((f) => f.id)];
    const docs = await c.many(`DELETE FROM documents WHERE tenant_id = $1 AND entity_id = ANY($2) RETURNING stored_name`, [req.tenantId, ids]);
    await c.query('DELETE FROM feasibility_requests WHERE tenant_id = $1 AND order_id = $2', [req.tenantId, o.id]);
    await c.query('DELETE FROM client_orders WHERE tenant_id = $1 AND id = $2', [req.tenantId, o.id]);
    await activity.log(c, { tenantId: req.tenantId, userId: req.user.id, entityType: 'ORDER', entityId: o.id, action: 'ORDER_DELETED',
      message: `${o.code} from ${o.customer_name} deleted${feas.length ? ` with ${feas.length} site request(s): ${feas.map((f) => f.code).join(', ')}` : ''}` });
    return docs.map((d) => d.stored_name);
  });
  files.forEach((f) => fs.promises.unlink(path.join(uploadRoot, req.tenantId, f)).catch(() => {}));
  return sendSuccess(res, { id: o.id, code: o.code }, `${o.code} deleted`);
}));

/* ================================ CLIENTS ================================ */
const clients = express.Router();
clients.use(authenticate, requireTenant);

clients.get('/', requirePerm('masters.view'), ah(async (req, res) => {
  const list = await db.many(
    `SELECT c.*, (SELECT COUNT(*) FROM client_orders o WHERE o.customer_id = c.id)::int AS order_count,
       (SELECT MAX(o.received_date) FROM client_orders o WHERE o.customer_id = c.id) AS last_order_date
       FROM customers c WHERE c.tenant_id = $1 ORDER BY c.is_active DESC, c.name`, [req.tenantId]);
  const rows = await db.many(`${SITE_ROWS_SQL} WHERE f.tenant_id = $1`, [req.tenantId]);
  return sendSuccess(res, list.map((c) => {
    const mine = rows.filter((r) => r.customer_id === c.id);
    return { ...c, site_count: mine.length, stages: stageCounts(mine), money: money(req.user.role, mine) };
  }));
}));

clients.get('/:id', requirePerm('masters.view'), ah(async (req, res) => {
  if (!/^[0-9a-f-]{36}$/i.test(req.params.id)) throw ApiError.badRequest('Invalid client id');
  const c = await db.one('SELECT * FROM customers WHERE id = $1 AND tenant_id = $2', [req.params.id, req.tenantId]);
  if (!c) throw ApiError.notFound('Client');
  const rows = await db.many(`${SITE_ROWS_SQL} WHERE f.tenant_id = $1 AND f.customer_id = $2 ORDER BY f.created_at DESC`, [req.tenantId, c.id]);
  const orderList = await db.many(`${ORDER_SQL} WHERE o.tenant_id = $1 AND o.customer_id = $2 ORDER BY o.received_date DESC, o.created_at DESC`, [req.tenantId, c.id]);
  const overdue = can(req.user.role, 'billing.view') ? await db.one(
    `SELECT COUNT(*)::int AS n, COALESCE(SUM(total_amount - amount_received - tds_amount - credit_amount),0) AS amount FROM invoices
      WHERE tenant_id = $1 AND customer_id = $2 AND status IN ('SUBMITTED','PARTIALLY_PAID') AND due_date < $3`, [req.tenantId, c.id, today()]) : null;
  return sendSuccess(res, {
    ...c,
    stages: stageCounts(rows),
    money: money(req.user.role, rows) && { ...money(req.user.role, rows), overdue_count: overdue.n, overdue_amount: overdue.amount },
    orders: orderList.map((o) => {
      const mine = rows.filter((r) => r.order_id === o.id);
      return { ...o, site_count: mine.length, stages: stageCounts(mine) };
    }),
    sites: rows.map((r) => scrub(req.user.role, r))
  });
}));

guardIds(orders, ['id']);
guardIds(clients, ['id']);

module.exports = { orders, clients, STAGE_SQL };
