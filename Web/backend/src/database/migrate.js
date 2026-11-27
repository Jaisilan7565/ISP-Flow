/**
 * Schema migrations with Umzug (Sequelize's migration runner), then bootstraps the first Platform Admin.
 * Usage: npm run db:setup        (also runs automatically when the API starts)
 *
 * Migrations live in src/database/migrations, applied in file-name order, each in its own transaction:
 *   NNN_name.sql — plain SQL
 *   NNN_name.js  — module.exports = { up: async ({ context: { queryInterface, Sequelize, transaction } }) => … }
 * Applied names are recorded in the existing `schema_migrations` table, so databases created before Sequelize keep working.
 */
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { Umzug } = require('umzug');
const env = require('../config/env');
const { sequelize, Sequelize } = require('../config/database');
const { User } = require('../models');

const DIR = path.join(__dirname, 'migrations');

/** Umzug storage on the existing schema_migrations table */
const storage = {
  async ensure() {
    await sequelize.query('CREATE TABLE IF NOT EXISTS schema_migrations (name VARCHAR(128) PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())');
  },
  async executed() {
    await this.ensure();
    const [rows] = await sequelize.query('SELECT name FROM schema_migrations ORDER BY name');
    return rows.map((r) => r.name);
  },
  async logMigration({ name }) {
    await sequelize.query('INSERT INTO schema_migrations (name) VALUES ($1) ON CONFLICT DO NOTHING', { bind: [name] });
  },
  async unlogMigration({ name }) {
    await sequelize.query('DELETE FROM schema_migrations WHERE name = $1', { bind: [name] });
  }
};

const umzug = new Umzug({
  migrations: {
    glob: ['*.{sql,js}', { cwd: DIR }],
    resolve: ({ name, path: file, context }) => ({
      name,
      up: () => sequelize.transaction(async (transaction) => {
        if (name.endsWith('.sql')) return sequelize.query(fs.readFileSync(file, 'utf8'), { transaction });
        return require(file).up({ context: { ...context, transaction } });
      }),
      down: async () => {
        if (name.endsWith('.sql')) throw new Error(`${name} is a SQL migration and cannot be reverted automatically`);
        return sequelize.transaction((transaction) => require(file).down({ context: { ...context, transaction } }));
      }
    })
  },
  context: { queryInterface: sequelize.getQueryInterface(), Sequelize },
  storage,
  logger: { info: (e) => e.event === 'migrated' && console.log(`  applied ${e.name}`), warn: console.warn, error: console.error, debug: () => {} }
});

const migrate = () => umzug.up();

const bootstrapPlatformOwner = async () => {
  const existing = await User.findOne({ where: { role: 'PLATFORM_OWNER' }, attributes: ['id', 'email'] });
  if (existing) return console.log(`  platform admin exists (${existing.email})`);
  const { name, email, password } = env.platformOwner;
  if (!email || !password) throw new Error('Set PLATFORM_OWNER_EMAIL and PLATFORM_OWNER_PASSWORD to bootstrap the platform admin');
  await User.create({ tenantId: null, name, email: email.toLowerCase(), role: 'PLATFORM_OWNER', passwordHash: await bcrypt.hash(password, 10), mustChangePassword: true });
  console.log(`  platform admin created: ${email}`);
};

const run = async () => {
  console.log('Running migrations…');
  await migrate();
  await bootstrapPlatformOwner();
};

if (require.main === module) {
  run()
    .then(() => sequelize.close())
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}

module.exports = { run, migrate, bootstrapPlatformOwner, umzug };
