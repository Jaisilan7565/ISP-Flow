const router = require('express').Router();
const db = require('../config/db');

const clientsModule = require('../modules/clients/clients.routes');

/** [path, router, tag] — also read by the OpenAPI generator (src/docs/openapi.js) */
const MOUNTS = [
  ['/auth', require('../modules/auth/auth.routes'), 'Auth'],
  ['/platform', require('../modules/platform/platform.routes'), 'Platform'],
  ['/admin', require('../modules/admin/admin.routes'), 'Company admin'],
  ['/clients', clientsModule.clients, 'Clients'],
  ['/orders', clientsModule.orders, 'Client orders'],
  ['/feasibility', require('../modules/feasibility/feasibility.routes'), 'Feasibility'],
  ['/quotes', require('../modules/commercial/commercial.routes'), 'Quote & budget'],
  ['/sites', require('../modules/implementation/site.routes'), 'Implementation'],
  ['/invoices', require('../modules/billing/invoice.routes'), 'Billing'],
  ['/treasury', require('../modules/treasury/treasury.routes'), 'Payments'],
  ['/documents', require('../modules/documents/documents.routes'), 'Documents'],
  ['/dashboard', require('../modules/dashboard/dashboard.routes'), 'Dashboard']
];
for (const [path, r] of MOUNTS) router.use(path, r);

router.get('/health', async (req, res) => {
  let database = 'ok';
  try { await db.query('SELECT 1'); } catch { database = 'down'; }
  res.status(database === 'ok' ? 200 : 503).json({ status: database === 'ok' ? 'ok' : 'degraded', database, service: 'ISP-Flow API', timestamp: new Date().toISOString() });
});

module.exports = router;
module.exports.MOUNTS = MOUNTS;
