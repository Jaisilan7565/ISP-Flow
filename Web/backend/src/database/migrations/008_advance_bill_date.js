/**
 * 008: bills raised in advance ("Next cycle") were dated at their future period start, so they could not be
 * submitted until that day (a submission may not be future-dated nor before the bill date).
 * The engine now dates them the day they are raised; this fixes such bills already raised and not yet submitted.
 */
module.exports = {
  up: async ({ context: { queryInterface: q, transaction } }) => {
    await q.sequelize.query(`
      UPDATE invoices SET invoice_date = (created_at AT TIME ZONE 'Asia/Kolkata')::date, updated_at = NOW()
       WHERE status = 'PENDING_SUBMISSION' AND invoice_type = 'RECURRING'
         AND invoice_date > (created_at AT TIME ZONE 'Asia/Kolkata')::date`, { transaction });
  },
  down: async () => { /* data fix only */ }
};
