/**
 * 012: make sure the removed pro-rata setting is gone everywhere (no pro-rata — client decision 2026-11-05).
 * Databases that applied an earlier version of 011 (which only switched it off) still had the column.
 */
module.exports = {
  up: async ({ context: { queryInterface: q, transaction } }) => {
    await q.sequelize.query('ALTER TABLE tenant_settings DROP COLUMN IF EXISTS prorate_on_disconnect;', { transaction });
  },
  down: async () => { /* nothing to restore */ }
};
