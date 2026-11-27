/**
 * 011: client decision (2026-11-05) — no pro-rata. When a link is disconnected, every billing cycle that started on or
 * before that date is billed in full; a whole period billed in advance that starts after it is credited (none of it was used).
 * On reconnection, billing restarts the day after the last period already billed (if later than the reconnection date),
 * so no day is billed twice. The "bill by days used" setting is removed.
 */
module.exports = {
  up: async ({ context: { queryInterface: q, transaction } }) => {
    await q.sequelize.query('ALTER TABLE tenant_settings DROP COLUMN IF EXISTS prorate_on_disconnect;', { transaction });
  },
  down: async ({ context: { queryInterface: q, transaction } }) => {
    await q.sequelize.query('ALTER TABLE tenant_settings ADD COLUMN IF NOT EXISTS prorate_on_disconnect BOOLEAN NOT NULL DEFAULT FALSE;', { transaction });
  }
};
