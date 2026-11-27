/**
 * 009: disconnect a live site (status TERMINATED), so billing and ISP cost stop.
 *  - terminated_on: the date the link was disconnected (cycles starting after it are not billed)
 *  - termination_reason, terminated_by: why and who, for the record
 */
module.exports = {
  up: async ({ context: { queryInterface: q, Sequelize: T, transaction } }) => {
    await q.addColumn('sites', 'terminated_on', { type: T.DATEONLY }, { transaction });
    await q.addColumn('sites', 'termination_reason', { type: T.TEXT }, { transaction });
    await q.addColumn('sites', 'terminated_by', { type: T.UUID, references: { model: 'users', key: 'id' } }, { transaction });
    await q.sequelize.query(`
      CREATE INDEX IF NOT EXISTS ix_sites_vendor ON sites(tenant_id, vendor_id);
      COMMENT ON COLUMN sites.terminated_on IS 'Date the live link was disconnected; billing stops after the cycle running on that date';`, { transaction });
  },
  down: async ({ context: { queryInterface: q, transaction } }) => {
    await q.sequelize.query('DROP INDEX IF EXISTS ix_sites_vendor', { transaction });
    for (const c of ['terminated_on', 'termination_reason', 'terminated_by']) await q.removeColumn('sites', c, { transaction });
  }
};
