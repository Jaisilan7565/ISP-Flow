/**
 * 006: primary / secondary link, and static IP with its own monthly price.
 *  - Each site request says whether it is the PRIMARY link (default) or a SECONDARY (backup) link, and how many static IPs it needs (0 = none).
 *  - The static IP has a monthly charge at every price step: ISP cost (survey option), client price (finalized price),
 *    quote options, the won quote and the site. Recurring bills carry it as a separate line (invoices.ip_amount).
 */
const MONEY = (T) => ({ type: T.DECIMAL(14, 2), allowNull: false, defaultValue: 0 });

module.exports = {
  up: async ({ context: { queryInterface: q, Sequelize: T, transaction } }) => {
    const add = (table, column, type) => q.addColumn(table, column, type, { transaction });
    const role = { type: T.STRING(10), allowNull: false, defaultValue: 'PRIMARY' };
    const ipCount = { type: T.INTEGER, allowNull: false, defaultValue: 0 };

    await add('feasibility_requests', 'link_role', role);
    await add('feasibility_requests', 'static_ip_count', ipCount);
    await add('feasibility_requests', 'final_client_ip_mrc', { type: T.DECIMAL(14, 2) });
    await add('feasibility_isp_options', 'vendor_ip_mrc', MONEY(T));
    await add('quote_options', 'vendor_ip_mrc', MONEY(T));
    await add('quote_options', 'client_ip_mrc', MONEY(T));
    await add('quotes', 'final_vendor_ip_mrc', { type: T.DECIMAL(14, 2) });
    await add('quotes', 'final_client_ip_mrc', { type: T.DECIMAL(14, 2) });
    await add('sites', 'link_role', role);
    await add('sites', 'static_ip_count', ipCount);
    await add('sites', 'client_ip_mrc', MONEY(T));
    await add('sites', 'vendor_ip_mrc', MONEY(T));
    await add('sites', 'static_ip_block', { type: T.STRING(64) });
    await add('invoices', 'ip_amount', MONEY(T));

    for (const t of ['feasibility_requests', 'sites']) {
      await q.sequelize.query(`ALTER TABLE ${t} ADD CONSTRAINT ${t}_link_role_check CHECK (link_role IN ('PRIMARY','SECONDARY')),
        ADD CONSTRAINT ${t}_static_ip_count_check CHECK (static_ip_count BETWEEN 0 AND 256)`, { transaction });
    }
    await q.sequelize.query(`
      COMMENT ON COLUMN feasibility_requests.link_role IS 'PRIMARY (default) or SECONDARY = backup link at a location';
      COMMENT ON COLUMN feasibility_requests.static_ip_count IS 'Static IPs the client needs with the link; 0 = none';
      COMMENT ON COLUMN invoices.ip_amount IS 'Static IP part of base_amount (shown as its own line on the bill)';`, { transaction });
  },
  down: async ({ context: { queryInterface: q, transaction } }) => {
    for (const t of ['feasibility_requests', 'sites']) {
      await q.removeConstraint(t, `${t}_link_role_check`, { transaction });
      await q.removeConstraint(t, `${t}_static_ip_count_check`, { transaction });
    }
    const drop = { feasibility_requests: ['link_role', 'static_ip_count', 'final_client_ip_mrc'], feasibility_isp_options: ['vendor_ip_mrc'],
      quote_options: ['vendor_ip_mrc', 'client_ip_mrc'], quotes: ['final_vendor_ip_mrc', 'final_client_ip_mrc'],
      sites: ['link_role', 'static_ip_count', 'client_ip_mrc', 'vendor_ip_mrc', 'static_ip_block'], invoices: ['ip_amount'] };
    for (const [t, cols] of Object.entries(drop)) for (const c of cols) await q.removeColumn(t, c, { transaction });
  }
};
