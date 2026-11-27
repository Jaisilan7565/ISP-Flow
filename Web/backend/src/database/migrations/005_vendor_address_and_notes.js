/**
 * 005: ISP / vendor address (for the future "nearby ISP" feasibility check) and optional notes
 * on ISPs / vendors and clients. Sequelize migration (queryInterface), run by Umzug in one transaction.
 */
module.exports = {
  up: async ({ context: { queryInterface, Sequelize: T, transaction } }) => {
    const add = (table, column, type) => queryInterface.addColumn(table, column, type, { transaction });
    await add('vendors', 'address', { type: T.TEXT });
    await add('vendors', 'city', { type: T.STRING(64) });
    await add('vendors', 'state', { type: T.STRING(64) });
    await add('vendors', 'pincode', { type: T.STRING(10) });
    await add('vendors', 'maps_url', { type: T.TEXT });
    await add('vendors', 'latitude', { type: T.DECIMAL(9, 6) });
    await add('vendors', 'longitude', { type: T.DECIMAL(9, 6) });
    await add('vendors', 'notes', { type: T.TEXT });
    await add('customers', 'notes', { type: T.TEXT });
    // Lookup by area for the future nearby-ISP check
    await queryInterface.addIndex('vendors', ['tenant_id', 'pincode'], { name: 'vendors_tenant_pincode_idx', transaction });
  },
  down: async ({ context: { queryInterface, transaction } }) => {
    await queryInterface.removeIndex('vendors', 'vendors_tenant_pincode_idx', { transaction });
    for (const c of ['address', 'city', 'state', 'pincode', 'maps_url', 'latitude', 'longitude', 'notes']) await queryInterface.removeColumn('vendors', c, { transaction });
    await queryInterface.removeColumn('customers', 'notes', { transaction });
  }
};
