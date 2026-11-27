/**
 * Activity log writer — every workflow step records who did what.
 * Pass the transaction context (c from db.tx) when inside a transaction so the log commits / rolls back with the change.
 */
const log = async (c, { tenantId, userId, entityType, entityId, action, message, meta }) => {
  const { ActivityLog } = require('../models');
  await ActivityLog.create(
    { tenantId: tenantId || null, userId: userId || null, entityType, entityId: entityId || null, action, message, meta: meta || null },
    { transaction: c?.transaction }
  );
  // live refresh for the company's open screens — after commit when inside a transaction
  if (action === 'LOGIN') return;
  const { notify } = require('../realtime');
  const send = () => notify(tenantId, { entityType, entityId, action, userId });
  if (c?.afterCommit) c.afterCommit(send); else send();
};

/**
 * Activity text is plain text and may mention amounts ("PO … value ₹2,00,000"). Roles that may see neither
 * prices nor bills (field engineers) get the amounts masked.
 */
const MONEY_RE = /₹\s?-?[\d,]+(\.\d+)?/g;
const redactMoney = (role, rows) => {
  const { can } = require('../constants/roles');
  if (can(role, 'commercial.view') || can(role, 'billing.view')) return rows;
  return rows.map((a) => ({ ...a, message: String(a.message || '').replace(MONEY_RE, '₹ ••'), meta: a.meta && { siteId: a.meta.siteId } }));
};

module.exports = { log, redactMoney };
