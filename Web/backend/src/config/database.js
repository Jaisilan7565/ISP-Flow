/**
 * Sequelize connection (PostgreSQL). Every query in the app — model calls and parameterised SQL — goes through this instance.
 */
const pg = require('pg');
const { Sequelize } = require('sequelize');
const env = require('./env');
const logger = require('../utils/logger');

const TIMEZONE = process.env.APP_TIMEZONE || 'Asia/Kolkata';

// Value types the app relies on: NUMERIC / BIGINT → JS numbers, DATE → 'YYYY-MM-DD' (no timezone shift),
// timestamps → JS Date. Set on pg and enforced over Sequelize's own parsers below.
pg.types.setTypeParser(1700, (v) => (v === null ? null : Number(v)));
pg.types.setTypeParser(20, (v) => (v === null ? null : Number(v)));
pg.types.setTypeParser(1082, (v) => v);
const PG_DEFAULT_OIDS = [1700, 20, 1082, 1114, 1184];

const sequelize = new Sequelize(env.databaseUrl, {
  dialect: 'postgres',
  dialectModule: pg,
  // Session timezone = business timezone, so CURRENT_DATE / NOW() agree with the app's "today"
  timezone: TIMEZONE,
  logging: process.env.SQL_LOG === '1' ? (sql) => logger.debug(sql) : false,
  pool: { max: Number(process.env.DB_POOL_MAX) || 10, min: 0, idle: 10000, acquire: 30000 },
  define: { underscored: true, freezeTableName: true }
});

// Sequelize registers its own parsers for some type OIDs (e.g. NUMERIC → string). Keep pg's for the types above.
const cm = sequelize.connectionManager;
const fixed = new Map(PG_DEFAULT_OIDS.map((oid) => [oid, pg.types.getTypeParser(oid)]));
cm.oidParserMap = new (class extends Map {
  get(oid) { return fixed.get(oid) || super.get(oid); }
})(cm.oidParserMap);

module.exports = { sequelize, Sequelize, TIMEZONE };
