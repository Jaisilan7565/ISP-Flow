const router = require('express').Router();
const Joi = require('joi');
const { R } = require('../../validation/rules');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const env = require('../../config/env');
const ApiError = require('../../utils/apiError');
const { ah } = require('../../utils/helpers');
const { sendSuccess } = require('../../utils/response');
const validate = require('../../middlewares/validate.middleware');
const { authenticate } = require('../../middlewares/auth.middleware');
const { permissionsFor, ROLE_LABELS } = require('../../constants/roles');
const activity = require('../../utils/activity');
const { User, Tenant, TenantSetting, toRow } = require('../../models');

const PROFILE_ATTRS = ['id', 'name', 'email', 'phone', 'role', 'zone', 'tenantId', 'mustChangePassword'];
const tenantInclude = { model: Tenant, as: 'tenant', attributes: ['name', 'code', 'status'] };

/** Signed-in user's profile: who they are, their company, permissions and company settings */
const profile = async (userId) => {
  const u = await User.findByPk(userId, { attributes: PROFILE_ATTRS, include: [tenantInclude] });
  const row = toRow(u);
  delete row.tenant;
  const settings = u.tenantId ? toRow(await TenantSetting.findByPk(u.tenantId)) : null;
  return {
    ...row,
    tenant_name: u.tenant?.name ?? null, tenant_code: u.tenant?.code ?? null, tenant_status: u.tenant?.status ?? null,
    role_label: ROLE_LABELS[u.role], permissions: permissionsFor(u.role), settings
  };
};

router.post(
  '/login',
  validate(Joi.object({ email: R.email().required(), password: Joi.string().required() })),
  ah(async (req, res) => {
    const user = await User.scope('withPassword').findOne({ where: { email: req.body.email.toLowerCase() }, include: [tenantInclude] });
    if (!user || !(await bcrypt.compare(req.body.password, user.passwordHash))) {
      throw ApiError.unauthorized('Incorrect email or password');
    }
    if (!user.isActive) throw ApiError.unauthorized('Your account has been deactivated. Contact your company admin.');
    if (user.tenantId && user.tenant?.status !== 'ACTIVE') {
      throw ApiError.forbidden('Your company account is suspended. Contact the platform administrator.');
    }
    await user.update({ lastLoginAt: new Date() }, { silent: true });
    const token = jwt.sign({ sub: user.id, tid: user.tenantId, role: user.role }, env.jwtSecret, { expiresIn: env.jwtExpiresIn });
    await activity.log(null, { tenantId: user.tenantId, userId: user.id, entityType: 'USER', entityId: user.id, action: 'LOGIN', message: `${user.name} signed in` });
    return sendSuccess(res, { token, user: await profile(user.id) }, 'Signed in');
  })
);

router.get('/me', authenticate, ah(async (req, res) => sendSuccess(res, await profile(req.user.id))));

router.post(
  '/change-password',
  authenticate,
  validate(Joi.object({
    currentPassword: Joi.string().required(),
    newPassword: R.password().invalid(Joi.ref('currentPassword')).required().messages({ 'any.invalid': 'New password must differ from the current one' })
  })),
  ah(async (req, res) => {
    const u = await User.scope('withPassword').findByPk(req.user.id);
    if (!(await bcrypt.compare(req.body.currentPassword, u.passwordHash))) throw ApiError.badRequest('Current password is incorrect');
    await u.update({ passwordHash: await bcrypt.hash(req.body.newPassword, 10), mustChangePassword: false });
    return sendSuccess(res, await profile(req.user.id), 'Password changed');
  })
);

module.exports = router;
