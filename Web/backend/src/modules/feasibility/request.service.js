/**
 * Shared by single feasibility requests and multi-site client orders:
 * validates the client / order / assignee and inserts one site request.
 */
const Joi = require('joi');
const { R, guardIds } = require('../../validation/rules');
const db = require('../../config/db');
const ApiError = require('../../utils/apiError');
const { nextCode, parseCoordinates, extractMapsUrl } = require('../../utils/helpers');
const { can } = require('../../constants/roles');
const activity = require('../../utils/activity');

/** Fields of one site (used inside an order's site list and by the single request form) */
const siteFields = {
  siteName: R.name(255).required(),
  address: Joi.string().trim().required(),
  city: Joi.string().allow('', null).max(64),
  pincode: R.optional(R.pincode()),
  mapsUrl: R.optional(R.url()),
  latitude: Joi.number().min(-90).max(90).allow(null, ''),
  longitude: Joi.number().min(-180).max(180).allow(null, ''),
  bandwidthMbps: Joi.number().integer().min(1).max(100000).required(),
  medium: Joi.string().valid('FIBER', 'RF', 'LEASED_LINE', 'BROADBAND', '4G_5G').default('FIBER'),
  linkRole: Joi.string().valid('PRIMARY', 'SECONDARY').default('PRIMARY').description('PRIMARY (default) or SECONDARY = backup link at the location'),
  staticIpCount: Joi.number().integer().min(0).max(256).allow(null, '').default(0).description('Static IPs needed with the link; 0 = none'),
  clientSiteRef: Joi.string().allow('', null).max(64),
  siteContactName: R.optional(R.name(128)),
  siteContactPhone: R.optional(R.phone()),
  assignedTo: Joi.string().uuid().allow(null, '')
};

const checkAssignee = async (tenantId, userId) => {
  const u = await db.one('SELECT id, name, role FROM users WHERE id = $1 AND tenant_id = $2 AND is_active', [userId, tenantId]);
  if (!u) throw ApiError.badRequest('Assignee must be an active user of your company');
  if (!can(u.role, 'feasibility.survey')) throw ApiError.badRequest(`${u.name} does not have survey permission`);
  return u;
};

/**
 * Who owns the request. Managers may assign anyone with survey permission.
 * A field engineer who pastes an order owns it (they cannot hand it to a colleague).
 */
const resolveAssignee = async (req, assignedTo) => {
  const canAssign = can(req.user.role, 'feasibility.assign');
  if (assignedTo) {
    if (!canAssign && assignedTo !== req.user.id) throw ApiError.forbidden('Only a manager can assign a site to someone else');
    return checkAssignee(req.tenantId, assignedTo);
  }
  if (!canAssign && can(req.user.role, 'feasibility.survey')) return { id: req.user.id, name: req.user.name };
  return null;
};

const coordsFor = (b, rawMessage) => {
  let { latitude, longitude } = b;
  if (latitude === '' || latitude === undefined) latitude = null;
  if (longitude === '' || longitude === undefined) longitude = null;
  if (latitude === null || longitude === null) {
    const parsed = parseCoordinates(b.mapsUrl) || parseCoordinates(rawMessage);
    if (parsed) ({ latitude, longitude } = parsed);
  }
  return { latitude, longitude };
};

/** Insert one site request inside a transaction. `ctx` = { tenantId, userId, customer, order, sourceChannel, rawMessage, requesterName, requesterPhone } */
const insertRequest = async (c, ctx, b, assignee) => {
  const { latitude, longitude } = coordsFor(b, ctx.rawMessage && !ctx.order ? ctx.rawMessage : null);
  const mapsUrl = b.mapsUrl || (!ctx.order ? extractMapsUrl(ctx.rawMessage) : null) || null;
  const code = await nextCode(c, ctx.tenantId, 'FEAS', 'FEAS');
  const row = await c.one(
    `INSERT INTO feasibility_requests (tenant_id, code, customer_id, order_id, site_name, address, city, pincode, latitude, longitude, maps_url, source_channel,
       raw_message, bandwidth_mbps, medium, requester_name, requester_phone, client_site_ref, site_contact_name, site_contact_phone,
       assigned_to, assigned_at, status, created_by, link_role, static_ip_count)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26) RETURNING id, code`,
    [ctx.tenantId, code, ctx.customer.id, ctx.order?.id || null, b.siteName, b.address, b.city || null, b.pincode || null, latitude, longitude, mapsUrl,
      ctx.sourceChannel, ctx.order ? null : ctx.rawMessage || null, b.bandwidthMbps, b.medium || 'FIBER', ctx.requesterName || null, ctx.requesterPhone || null,
      b.clientSiteRef || null, b.siteContactName || null, b.siteContactPhone || null,
      assignee?.id || null, assignee ? new Date() : null, assignee ? 'ASSIGNED' : 'NEW', ctx.userId, b.linkRole || 'PRIMARY', Number(b.staticIpCount) || 0]
  );
  const ref = `${b.clientSiteRef ? ` (client site ${b.clientSiteRef})` : ''}${b.linkRole === 'SECONDARY' ? ', secondary link' : ''}${Number(b.staticIpCount) ? `, ${b.staticIpCount} static IP(s)` : ''}`;
  await activity.log(c, { tenantId: ctx.tenantId, userId: ctx.userId, entityType: 'FEASIBILITY', entityId: row.id, action: 'FEAS_CREATED',
    message: `${row.code} logged from ${ctx.sourceChannel}${ctx.order ? ` under order ${ctx.order.code}` : ''} for ${ctx.customer.name} – ${b.siteName}${ref}${assignee ? `; owner ${assignee.name}` : ''}` });
  return row;
};

const loadClient = async (tenantId, customerId) => {
  const cust = await db.one('SELECT id, name, is_active FROM customers WHERE id = $1 AND tenant_id = $2', [customerId, tenantId]);
  if (!cust) throw ApiError.badRequest('Client not found — add the client in Clients first');
  if (!cust.is_active) throw ApiError.badRequest(`${cust.name} is marked inactive`);
  return cust;
};

module.exports = { siteFields, checkAssignee, resolveAssignee, insertRequest, loadClient };
