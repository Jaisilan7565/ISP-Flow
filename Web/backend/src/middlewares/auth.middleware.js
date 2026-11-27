const jwt = require('jsonwebtoken');
const env = require('../config/env');
const ApiError = require('../utils/apiError');
const { can, ROLES } = require('../constants/roles');

/**
 * Verifies the JWT and re-checks the user + company on every request, so deactivating a user
 * or suspending a company takes effect immediately (not when the token expires).
 */
const authenticate = async (req, res, next) => {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : req.query.token; // query token only for file downloads
    if (!token) throw ApiError.unauthorized();
    let claims;
    try {
      claims = jwt.verify(token, env.jwtSecret);
    } catch {
      throw ApiError.unauthorized('Session expired — please sign in again');
    }
    const { User, Tenant } = require('../models');
    const u = await User.findByPk(claims.sub, {
      attributes: ['id', 'tenantId', 'name', 'email', 'role', 'isActive'],
      include: [{ model: Tenant, as: 'tenant', attributes: ['status', 'name'] }]
    });
    if (!u || !u.isActive) throw ApiError.unauthorized('Account disabled');
    if (u.tenantId && u.tenant?.status !== 'ACTIVE') throw ApiError.forbidden('Your company account is suspended. Contact the platform administrator.');
    req.user = { id: u.id, tenant_id: u.tenantId, name: u.name, email: u.email, role: u.role, is_active: u.isActive, tenant_status: u.tenant?.status ?? null, tenant_name: u.tenant?.name ?? null };
    req.tenantId = u.tenantId;
    next();
  } catch (e) {
    next(e);
  }
};

const requirePlatform = (req, res, next) =>
  req.user?.role === ROLES.PLATFORM_OWNER ? next() : next(ApiError.forbidden('Platform administrators only'));

const requireTenant = (req, res, next) =>
  req.tenantId ? next() : next(ApiError.forbidden('This area is for company users. Platform admin manages companies from the Platform console.'));

/** requirePerm('billing.manage') — any one of the listed permissions */
const requirePerm = (...perms) => Object.assign((req, res, next) =>
  (perms.some((p) => can(req.user.role, p)) ? next() : next(ApiError.forbidden())), { perms });

module.exports = { authenticate, requirePlatform, requireTenant, requirePerm };
