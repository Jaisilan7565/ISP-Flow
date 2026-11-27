/**
 * Query helpers on top of Sequelize.
 *   db.one / db.many / db.query  — parameterised SQL ($1, $2 …) through sequelize.query (bind parameters)
 *   db.tx(fn)                    — managed Sequelize transaction; fn(c) gets c.one / c.many / c.query
 *                                  plus c.transaction (pass it to model calls) and c.afterCommit(cb)
 * Models live in src/models and are used for plain CRUD; reporting / workflow queries stay as SQL here.
 */
const { sequelize } = require('./database');

const clean = (params) => (params && params.length ? params.map((v) => (v === undefined ? null : v)) : undefined);

const run = async (text, params, transaction) => {
  const [rows, result] = await sequelize.query(text, { bind: clean(params), transaction, raw: true });
  const list = Array.isArray(rows) ? rows : [];
  return { rows: list, rowCount: result && Number.isFinite(result.rowCount) ? result.rowCount : list.length };
};

const query = (text, params) => run(text, params);
/** First row or null */
const one = async (text, params) => (await run(text, params)).rows[0] || null;
const many = async (text, params) => (await run(text, params)).rows;

/** Run fn(c) inside a transaction (commit on success, rollback on error) */
const tx = (fn) => sequelize.transaction(async (t) => fn({
  transaction: t,
  query: (s, p) => run(s, p, t),
  one: async (s, p) => (await run(s, p, t)).rows[0] || null,
  many: async (s, p) => (await run(s, p, t)).rows,
  afterCommit: (cb) => t.afterCommit(cb)
}));

/** Compatibility for scripts / tests: pool.query(text, params) and pool.end() */
const pool = { query, end: () => sequelize.close() };

module.exports = { sequelize, pool, query, one, many, tx };
