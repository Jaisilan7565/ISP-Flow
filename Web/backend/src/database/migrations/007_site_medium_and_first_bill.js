/**
 * 007: the site's link medium, and the OTC billed on the first bill.
 *  - sites.medium: how the link is delivered (Fiber, Broadband, RF …). Taken from the winning ISP's survey row,
 *    or from the order. The bill prints it, so a Fiber link is no longer described as a leased line.
 *  - invoices.otc_amount: the one-time charge included in a bill. From now on the 1st bill of a site carries
 *    OTC + 1st cycle MRC (+ static IP) together; older sites keep their separate OTC bill.
 */
module.exports = {
  up: async ({ context: { queryInterface: q, Sequelize: T, transaction } }) => {
    await q.addColumn('sites', 'medium', { type: T.STRING(16), allowNull: false, defaultValue: 'FIBER' }, { transaction });
    await q.addColumn('invoices', 'otc_amount', { type: T.DECIMAL(14, 2), allowNull: false, defaultValue: 0 }, { transaction });
    // Existing sites: the winning ISP's surveyed medium, else the medium asked for in the order
    await q.sequelize.query(`
      UPDATE sites s SET medium = f.medium FROM feasibility_requests f WHERE f.id = s.feasibility_id AND f.medium IS NOT NULL;
      UPDATE sites s SET medium = o.medium FROM feasibility_isp_options o
       WHERE o.feasibility_id = s.feasibility_id AND o.vendor_id = s.vendor_id AND COALESCE(o.medium, '') <> '';`, { transaction });
    // Existing separate OTC bills: the whole base is the one-time charge
    await q.sequelize.query("UPDATE invoices SET otc_amount = base_amount WHERE invoice_type = 'OTC'", { transaction });
    await q.sequelize.query(`
      COMMENT ON COLUMN sites.medium IS 'How the link is delivered: FIBER, BROADBAND, LEASED_LINE, RF, 4G_5G (printed on the bill)';
      COMMENT ON COLUMN invoices.otc_amount IS 'One-time charge part of base_amount (the 1st bill carries OTC + 1st cycle)';`, { transaction });
  },
  down: async ({ context: { queryInterface: q, transaction } }) => {
    await q.removeColumn('sites', 'medium', { transaction });
    await q.removeColumn('invoices', 'otc_amount', { transaction });
  }
};
