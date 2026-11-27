/**
 * Platform Admin console: onboard ISP companies (tenants) and their first Company Admin.
 */
const router = require('express').Router();
const Joi = require('joi');
const { R, guardIds } = require('../../validation/rules');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const db = require('../../config/db');
const ApiError = require('../../utils/apiError');
const { ah } = require('../../utils/helpers');
const { sendSuccess } = require('../../utils/response');
const validate = require('../../middlewares/validate.middleware');
const { authenticate, requirePlatform } = require('../../middlewares/auth.middleware');
const activity = require('../../utils/activity');
const { Tenant, TenantSetting, User, toRow } = require('../../models');

router.use(authenticate, requirePlatform);

const tempPassword = () => `Isp@${crypto.randomBytes(4).toString('hex')}`;

const TENANT_LIST_SQL = `
  SELECT t.*,
    (SELECT COUNT(*) FROM users u WHERE u.tenant_id = t.id)::int AS user_count,
    (SELECT COUNT(*) FROM feasibility_requests f WHERE f.tenant_id = t.id)::int AS feasibility_count,
    (SELECT COUNT(*) FROM sites s WHERE s.tenant_id = t.id AND s.status = 'LIVE')::int AS live_sites,
    (SELECT COALESCE(SUM(total_amount),0) FROM invoices i WHERE i.tenant_id = t.id) AS billed_total,
    (SELECT json_build_object('id', a.id, 'name', a.name, 'email', a.email, 'phone', a.phone, 'last_login_at', a.last_login_at)
       FROM users a WHERE a.tenant_id = t.id AND a.role = 'TENANT_ADMIN' ORDER BY a.created_at LIMIT 1) AS admin
  FROM tenants t`;

router.get('/stats', ah(async (req, res) => {
  const s = await db.one(`SELECT
      (SELECT COUNT(*) FROM tenants)::int AS tenants,
      (SELECT COUNT(*) FROM tenants WHERE status = 'ACTIVE')::int AS active_tenants,
      (SELECT COUNT(*) FROM users WHERE tenant_id IS NOT NULL)::int AS users,
      (SELECT COUNT(*) FROM feasibility_requests)::int AS feasibility,
      (SELECT COUNT(*) FROM sites WHERE status = 'LIVE')::int AS live_sites,
      (SELECT COALESCE(SUM(total_amount),0) FROM invoices) AS billed_total,
      (SELECT COALESCE(SUM(amount),0) FROM receipts) AS collected_total`);
  return sendSuccess(res, s);
}));

router.get('/tenants', ah(async (req, res) => sendSuccess(res, await db.many(`${TENANT_LIST_SQL} ORDER BY t.created_at DESC`))));

const tenantSchema = {
  name: R.name(255),
  code: R.companyCode(),
  gstin: R.optional(R.gstin()),
  address: Joi.string().allow('', null),
  state: Joi.string().allow('', null).max(64),
  contactEmail: R.optional(R.email()),
  contactPhone: R.optional(R.phone())
};

router.post(
  '/tenants',
  validate(Joi.object({
    ...tenantSchema,
    name: tenantSchema.name.required(),
    code: tenantSchema.code.required(),
    admin: Joi.object({
      name: R.name(255).required(),
      email: R.email().required(),
      phone: R.optional(R.phone()),
      password: R.optional(R.password())
    }).required()
  })),
  ah(async (req, res) => {
    const b = req.body;
    const password = b.admin.password || tempPassword();
    const passwordHash = await bcrypt.hash(password, 10);
    const result = await db.tx(async (c) => {
      const { transaction } = c;
      const t = await Tenant.create({
        code: b.code, name: b.name, gstin: b.gstin || null, address: b.address || null, state: b.state || null,
        contactEmail: b.contactEmail || null, contactPhone: b.contactPhone || null
      }, { transaction });
      await TenantSetting.create({ tenantId: t.id }, { transaction });
      const admin = await User.create({
        tenantId: t.id, name: b.admin.name, email: b.admin.email, phone: b.admin.phone || null, role: 'TENANT_ADMIN', passwordHash, mustChangePassword: true
      }, { transaction });
      await activity.log(c, { tenantId: t.id, userId: req.user.id, entityType: 'TENANT', entityId: t.id, action: 'TENANT_CREATED', message: `Company ${t.name} onboarded by platform admin; admin ${admin.email}` });
      return { tenant: toRow(t), admin: { id: admin.id, name: admin.name, email: admin.email }, temporaryPassword: password };
    });
    return sendSuccess(res, result, 'Company onboarded. Share the admin login securely.', 201);
  })
);

// Edit an onboarded company: its details and its Company Admin's name / email / phone.
// Only the fields sent are changed; an empty string clears an optional field.
const TENANT_FIELDS = ['name', 'code', 'gstin', 'address', 'state', 'contactEmail', 'contactPhone'];
const ADMIN_FIELDS = ['name', 'email', 'phone'];
const LABEL = { name: 'name', code: 'code', gstin: 'GSTIN', address: 'address', state: 'state', contactEmail: 'contact email', contactPhone: 'contact phone' };
const blankToNull = (v) => (v === '' ? null : v);

router.patch(
  '/tenants/:id',
  validate(Joi.object({
    ...tenantSchema,
    name: tenantSchema.name.min(2),
    admin: Joi.object({
      name: R.name(255),
      email: R.email(),
      phone: R.optional(R.phone())
    }).min(1)
  }).min(1)),
  ah(async (req, res) => {
    const b = req.body;
    const result = await db.tx(async (c) => {
      const { transaction } = c;
      const tenant = await Tenant.findByPk(req.params.id, { transaction, lock: transaction.LOCK.UPDATE });
      if (!tenant) throw ApiError.notFound('Company');
      const changed = [];

      const tChanges = {};
      for (const k of TENANT_FIELDS) {
        if (b[k] === undefined) continue;
        const v = blankToNull(b[k]);
        if ((tenant[k] ?? null) !== v) { tChanges[k] = v; changed.push(LABEL[k]); }
      }
      if (Object.keys(tChanges).length) await tenant.update(tChanges, { transaction });

      if (b.admin) {
        const admin = await User.findOne({ where: { tenantId: tenant.id, role: 'TENANT_ADMIN' }, order: [['createdAt', 'ASC']], transaction, lock: transaction.LOCK.UPDATE });
        if (!admin) throw ApiError.notFound('Company admin');
        const aChanges = {};
        for (const k of ADMIN_FIELDS) {
          if (b.admin[k] === undefined) continue;
          const v = blankToNull(b.admin[k]);
          if ((admin[k] ?? null) !== v) { aChanges[k] = v; changed.push(`admin ${k}`); }
        }
        if (Object.keys(aChanges).length) await admin.update(aChanges, { transaction });
      }

      if (changed.length) {
        await activity.log(c, { tenantId: tenant.id, userId: req.user.id, entityType: 'TENANT', entityId: tenant.id, action: 'TENANT_UPDATED', message: `Company ${tenant.name} edited by platform admin: ${changed.join(', ')}` });
      }
      return { tenant: await c.one(`${TENANT_LIST_SQL} WHERE t.id = $1`, [tenant.id]), changed };
    });
    return sendSuccess(res, result.tenant, result.changed.length ? 'Company updated' : 'Nothing changed');
  })
);

router.patch(
  '/tenants/:id/status',
  validate(Joi.object({ status: Joi.string().valid('ACTIVE', 'SUSPENDED').required(), reason: Joi.string().allow('', null) })),
  ah(async (req, res) => {
    const tenant = await Tenant.findByPk(req.params.id);
    if (!tenant) throw ApiError.notFound('Company');
    await tenant.update({ status: req.body.status });
    const t = toRow(tenant);
    await activity.log(null, { tenantId: t.id, userId: req.user.id, entityType: 'TENANT', entityId: t.id, action: `TENANT_${req.body.status}`, message: `Company ${t.name} ${req.body.status.toLowerCase()} by platform admin${req.body.reason ? `: ${req.body.reason}` : ''}` });
    return sendSuccess(res, t, `Company ${req.body.status === 'ACTIVE' ? 'activated' : 'suspended'}`);
  })
);

router.post('/tenants/:id/reset-admin-password', ah(async (req, res) => {
  const admin = await User.findOne({ where: { tenantId: req.params.id, role: 'TENANT_ADMIN' }, order: [['createdAt', 'ASC']], attributes: ['id', 'email'] });
  if (!admin) throw ApiError.notFound('Company admin');
  const password = tempPassword();
  await admin.update({ passwordHash: await bcrypt.hash(password, 10), mustChangePassword: true, isActive: true });
  return sendSuccess(res, { email: admin.email, temporaryPassword: password }, 'Admin password reset');
}));

router.get('/activity', ah(async (req, res) => sendSuccess(res, await db.many(
  `SELECT a.*, u.name AS user_name, t.name AS tenant_name FROM activity_log a
     LEFT JOIN users u ON u.id = a.user_id LEFT JOIN tenants t ON t.id = a.tenant_id
   WHERE a.action LIKE 'TENANT_%' OR a.tenant_id IS NULL ORDER BY a.created_at DESC LIMIT 100`
))));

guardIds(router, ['id']);

module.exports = router;
