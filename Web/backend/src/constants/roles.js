/**
 * Roles & permission matrix — implements the RBAC table in Docs/ISP_FLOW_SYSTEM_BLUEPRINT.md §4.
 */
const ROLES = {
  PLATFORM_OWNER: 'PLATFORM_OWNER',
  TENANT_ADMIN: 'TENANT_ADMIN',
  COMMERCIAL_MANAGER: 'COMMERCIAL_MANAGER',
  FIELD_ENGINEER: 'FIELD_ENGINEER',
  OPERATIONS: 'OPERATIONS',
  BILLING_EXEC: 'BILLING_EXEC',
  FINANCE_HEAD: 'FINANCE_HEAD'
};

const ROLE_LABELS = {
  PLATFORM_OWNER: 'Platform Admin',
  TENANT_ADMIN: 'Company Admin',
  COMMERCIAL_MANAGER: 'Commercial Manager',
  FIELD_ENGINEER: 'Field Engineer (Feasibility → Delivery)',
  OPERATIONS: 'Operations / Field Lead',
  BILLING_EXEC: 'Billing / Accounts',
  FINANCE_HEAD: 'Finance / Treasury Head'
};

const VIEW_ALL = ['orders.view', 'feasibility.view', 'commercial.view', 'implementation.view', 'billing.view', 'treasury.view', 'masters.view'];

const PERMISSIONS = {
  TENANT_ADMIN: ['*'],
  COMMERCIAL_MANAGER: [
    ...VIEW_ALL,
    'orders.create', 'feasibility.create', 'feasibility.assign', 'feasibility.survey', 'feasibility.finalize',
    'commercial.manage', 'masters.manage'
  ],
  // The company's own field team: paste client orders, survey ISPs, and deliver
  // the sites they own (work start, pending items, go-live). PO entry stays with Operations / Admin.
  FIELD_ENGINEER: [
    'orders.view', 'orders.create', 'feasibility.view', 'feasibility.create', 'feasibility.survey',
    'implementation.view', 'implementation.execute', 'masters.view'
  ],
  OPERATIONS: [
    'orders.view', 'orders.create', 'feasibility.view', 'feasibility.create', 'feasibility.assign', 'feasibility.survey',
    'commercial.view', 'implementation.view', 'implementation.manage', 'implementation.execute', 'billing.view', 'masters.view'
  ],
  BILLING_EXEC: [...VIEW_ALL, 'billing.manage'],
  FINANCE_HEAD: [...VIEW_ALL, 'billing.manage', 'treasury.manage']
};

const can = (role, perm) => {
  const list = PERMISSIONS[role] || [];
  return list.includes('*') || list.includes(perm);
};

const permissionsFor = (role) => {
  if (role === ROLES.PLATFORM_OWNER) return ['platform.*'];
  return PERMISSIONS[role] || [];
};

const TENANT_ROLES = Object.keys(PERMISSIONS);

/** Field engineers may act only on the records they own; managers act on all. */
const ownsOnly = (role) => role === ROLES.FIELD_ENGINEER;

module.exports = { ownsOnly, ROLES, ROLE_LABELS, PERMISSIONS, TENANT_ROLES, can, permissionsFor };
