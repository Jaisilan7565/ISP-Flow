const http = require('http');
const env = require('./src/config/env');
const app = require('./src/app');
const logger = require('./src/utils/logger');
const { run: migrate } = require('./src/database/migrate');
const { runDueCycles } = require('./src/modules/billing/billing.engine');

const start = async () => {
  await migrate(); // schema is always up to date before serving
  const server = http.createServer(app);
  require('./src/realtime').init(server); // Socket.io live sync
  server.listen(env.port, () => {
    logger.info(`ISP-Flow API running on http://localhost:${env.port}  (health: /api/v1/health)`);
  });

  // Automatic recurring billing: generate cycles whose period has started.
  if (env.billingSchedulerMinutes > 0) {
    const tick = async () => {
      try {
        const created = await runDueCycles(null, null);
        if (created.length) logger.info(`Billing scheduler generated ${created.length} cycle invoice(s)`);
      } catch (e) {
        logger.error(`Billing scheduler failed: ${e.message}`);
      }
    };
    setTimeout(tick, 5000);
    setInterval(tick, env.billingSchedulerMinutes * 60 * 1000);
  }
};

start().catch((e) => {
  logger.error(`Failed to start: ${e.message}`);
  process.exit(1);
});
