/**
 * Billing engine — creates the bills of a live site, and credit notes against them.
 * Used by: site go-live (one bill: OTC + 1st cycle), "Run billing" button, the background scheduler, "next cycle",
 * disconnection (cycles that started on or before the date are billed in full — no pro-rata, client decision 2026-11-05 —
 * and a whole period billed in advance after it is credited) and reconnection.
 *
 * Cycles: cycle (cycle_base + 1) starts on billing_start (the live date, or after a reconnection the later of the reconnection date
 * and the day after the last period already billed); each cycle is
 * 1 month (monthly) or 3 months (quarterly) after the previous one. Cycle numbers keep counting across a reconnection.
 * Prices: each cycle is billed at the price in force for it — a bandwidth / price change (site_revisions) applies from its cycle on,
 * so re-issuing an older cycle keeps the older price.
 * One-time charges: the 1st bill carries the OTC; the first bill after a reconnection carries the reconnection charge.
 * Sites billed before the one-first-bill rule have a separate OTC bill (invoice_type OTC); their cycle 1 never repeats the OTC.
 */
const db = require('../../config/db');
const ApiError = require('../../utils/apiError');
const { addMonths, addDays, today, round2, fyLabel, inr, dmy } = require('../../utils/helpers');
const activity = require('../../utils/activity');

const monthsPerCycle = (freq) => (freq === 'QUARTERLY' ? 3 : 1);

/** First day of cycle n */
const cycleStart = (site, n) => addMonths(site.billing_start || site.live_date, (n - 1 - Number(site.cycle_base || 0)) * monthsPerCycle(site.billing_frequency));
/** Last day of cycle n (full length) */
const cycleEnd = (site, n) => addDays(cycleStart(site, n + 1), -1);

const counterNumber = async (c, tenantId, key, date) => {
  const fy = fyLabel(new Date(`${date}T00:00:00Z`));
  const row = await c.one(
    `INSERT INTO counters (tenant_id, key, value) VALUES ($1, $2, 1)
     ON CONFLICT (tenant_id, key) DO UPDATE SET value = counters.value + 1 RETURNING value`,
    [tenantId, `${key}-${fy}`]
  );
  return { fy, n: String(row.value).padStart(4, '0') };
};

/** Prices and bandwidth in force for a cycle: the latest change from that cycle or before, else the prices before the first change */
const pricesFor = async (c, site, cycleNo) => {
  const revs = await c.many('SELECT * FROM site_revisions WHERE site_id = $1 ORDER BY from_cycle', [site.id]);
  const cur = { bandwidth: site.bandwidth_mbps, clientMrc: site.client_mrc, clientIpMrc: site.client_ip_mrc, vendorMrc: site.vendor_mrc, vendorIpMrc: site.vendor_ip_mrc };
  if (!revs.length) return num(cur);
  const applied = revs.filter((r) => r.from_cycle <= cycleNo).pop();
  if (applied) return num({ bandwidth: applied.new_bandwidth_mbps, clientMrc: applied.new_client_mrc, clientIpMrc: applied.new_client_ip_mrc, vendorMrc: applied.new_vendor_mrc, vendorIpMrc: applied.new_vendor_ip_mrc });
  const first = revs[0];
  return num({ bandwidth: first.old_bandwidth_mbps, clientMrc: first.old_client_mrc, clientIpMrc: first.old_client_ip_mrc, vendorMrc: first.old_vendor_mrc, vendorIpMrc: first.old_vendor_ip_mrc });
};
const num = (p) => Object.fromEntries(Object.entries(p).map(([k, v]) => [k, Number(v || 0)]));

const createInvoice = async (c, site, settings, { type, cycleNo, periodStart, periodEnd, base, ipAmount = 0, otcAmount = 0, vendorCost, invoiceDate, bandwidth, note = '' }, userId) => {
  const gst = round2((base * Number(settings.gst_pct)) / 100);
  const { fy, n } = await counterNumber(c, site.tenant_id, 'INV', invoiceDate);
  const inv = await c.one(
    `INSERT INTO invoices (tenant_id, invoice_number, site_id, customer_id, invoice_type, cycle_no, period_start, period_end,
       base_amount, gst_pct, gst_amount, total_amount, vendor_cost, invoice_date, created_by, ip_amount, otc_amount, billed_bandwidth_mbps)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
     ON CONFLICT (site_id, invoice_type, cycle_no) WHERE status <> 'CANCELLED' DO NOTHING
     RETURNING id, invoice_number, invoice_type, cycle_no, period_start, period_end, total_amount, otc_amount`,
    [site.tenant_id, `${settings.invoice_prefix}/${fy}/${n}`, site.id, site.customer_id, type, cycleNo, periodStart, periodEnd, base, settings.gst_pct, gst, round2(base + gst),
      vendorCost, invoiceDate, userId || null, ipAmount, otcAmount, bandwidth || site.bandwidth_mbps]
  );
  if (inv) {
    const label = type === 'OTC' ? 'Site OTC' : `Cycle ${cycleNo}${Number(otcAmount) > 0 ? ' + OTC' : ''}`;
    await activity.log(c, {
      tenantId: site.tenant_id, userId, entityType: 'INVOICE', entityId: inv.id, action: 'INVOICE_GENERATED',
      message: `${inv.invoice_number} (${label}) generated for ${site.code}: ${inr(inv.total_amount)}${note}${userId ? '' : ' [auto scheduler]'}`, meta: { siteId: site.id }
    });
  }
  return inv;
};

/**
 * Generate the given cycle number for a site (idempotent). Always a full cycle (no pro-rata).
 * period: the period to bill when re-issuing a cycle from before a reconnection (its own dates).
 */
const generateCycle = async (c, site, settings, cycleNo, userId, { period } = {}) => {
  const k = monthsPerCycle(site.billing_frequency);
  const periodStart = period?.start || cycleStart(site, cycleNo);
  const periodEnd = period?.end || cycleEnd(site, cycleNo);
  const p = await pricesFor(c, site, cycleNo);
  // One-time charges: cycle 1 carries the OTC (unless an older separate OTC bill exists); the first cycle after a reconnection carries the reconnection charge
  let otcAmount = 0; let vendorOtc = 0;
  if (cycleNo === 1 && !(await c.one("SELECT 1 FROM invoices WHERE site_id = $1 AND invoice_type = 'OTC' AND status <> 'CANCELLED'", [site.id]))) {
    otcAmount = round2(Number(site.client_otc)); vendorOtc = Number(site.vendor_otc);
  } else if (Number(site.cycle_base) > 0 && cycleNo === Number(site.cycle_base) + 1) {
    otcAmount = round2(Number(site.reconnect_charge || 0)); vendorOtc = Number(site.reconnect_vendor_charge || 0);
  }
  // The static IP charge (if any) is billed every cycle with the link, as its own line
  const mrcAmount = round2(p.clientMrc * k);
  const ipAmount = round2(p.clientIpMrc * k);
  const vendorCost = round2((p.vendorMrc + p.vendorIpMrc) * k + vendorOtc);
  // Billed in advance ("Next cycle"): the bill is dated the day it is raised, not the future period start,
  // so it can be submitted to the client straight away (a submission can be neither future-dated nor before the bill)
  const invoiceDate = periodStart > today() ? today() : periodStart;
  const inv = await createInvoice(c, site, settings, {
    type: 'RECURRING', cycleNo, periodStart, periodEnd, base: round2(otcAmount + mrcAmount + ipAmount), ipAmount, otcAmount, vendorCost, invoiceDate,
    bandwidth: p.bandwidth
  }, userId);
  await c.query('UPDATE sites SET last_cycle_no = GREATEST(last_cycle_no, $2), updated_at = NOW() WHERE id = $1', [site.id, cycleNo]);
  return inv;
};

/** Bill every cycle that has started up to `upTo` (default today) and is not billed yet */
const billDue = async (c, site, settings, userId, upTo = today()) => {
  const created = [];
  // Safety cap of 36 cycles per run
  for (let n = Number(site.last_cycle_no) + 1, guard = 0; guard < 36 && cycleStart(site, n) <= upTo; n += 1, guard += 1) {
    const inv = await generateCycle(c, site, settings, n, userId);
    if (inv) created.push({ ...inv, site_code: site.code });
  }
  return created;
};

/** On site live: one bill — OTC + 1st cycle MRC (+ static IP) */
const onSiteLive = async (c, site, userId) => {
  const settings = await c.one('SELECT * FROM tenant_settings WHERE tenant_id = $1', [site.tenant_id]);
  return [await generateCycle(c, site, settings, 1, userId)].filter(Boolean);
};

/** Generate every recurring cycle whose period has started (up to today). tenantId=null → all tenants. */
const runDueCycles = async (tenantId = null, userId = null) => {
  const sites = await db.many(
    `SELECT s.* FROM sites s JOIN tenants t ON t.id = s.tenant_id
      WHERE s.status = 'LIVE' AND t.status = 'ACTIVE' ${tenantId ? 'AND s.tenant_id = $1' : ''}`,
    tenantId ? [tenantId] : []
  );
  const created = [];
  for (const site of sites) {
    await db.tx(async (c) => {
      const settings = await c.one('SELECT * FROM tenant_settings WHERE tenant_id = $1', [site.tenant_id]);
      created.push(...await billDue(c, site, settings, userId));
    });
  }
  return created;
};

/**
 * Credit note against a bill: reduces what the client owes (amount before GST, GST added at the bill's rate),
 * and optionally the ISP cost booked on that bill. A bill fully covered by payments + credits is settled (PAID).
 */
const creditNote = async (c, { invoiceId, base, reason, vendorReduction = 0, userId, date = today() }) => {
  const inv = await c.one('SELECT i.*, s.code AS site_code FROM invoices i JOIN sites s ON s.id = i.site_id WHERE i.id = $1 FOR UPDATE OF i', [invoiceId]);
  if (!inv) throw ApiError.notFound('Invoice');
  if (inv.status === 'CANCELLED') throw ApiError.conflict(`${inv.invoice_number} is cancelled`);
  const credited = Number((await c.one('SELECT COALESCE(SUM(base_amount),0) AS n FROM credit_notes WHERE invoice_id = $1', [inv.id])).n);
  const room = round2(Number(inv.base_amount) - credited);
  const amount = round2(base);
  if (amount <= 0) throw ApiError.badRequest('Credit amount must be more than 0', [{ field: 'amount', message: 'Must be more than 0' }]);
  if (amount > room + 0.01) throw ApiError.badRequest(`Credit cannot exceed ${inr(room)} (bill amount before GST, less earlier credits)`, [{ field: 'amount', message: `At most ${inr(room)}` }]);
  const reduce = Math.min(round2(vendorReduction), Number(inv.vendor_cost));
  const gst = round2((amount * Number(inv.gst_pct)) / 100);
  const total = round2(amount + gst);
  const settings = await c.one('SELECT invoice_prefix FROM tenant_settings WHERE tenant_id = $1', [inv.tenant_id]);
  const { fy, n } = await counterNumber(c, inv.tenant_id, 'CN', date);
  const note = await c.one(
    `INSERT INTO credit_notes (tenant_id, credit_number, invoice_id, site_id, customer_id, credit_date, reason, base_amount, gst_pct, gst_amount, total_amount, vendor_cost_reduction, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
    [inv.tenant_id, `${settings.invoice_prefix}-CN/${fy}/${n}`, inv.id, inv.site_id, inv.customer_id, date, reason, amount, inv.gst_pct, gst, total, reduce, userId || null]);
  const newCredit = round2(Number(inv.credit_amount) + total);
  const settled = Number(inv.amount_received) + Number(inv.tds_amount) + newCredit >= Number(inv.total_amount) - 0.5;
  await c.query(`UPDATE invoices SET credit_amount = $2, vendor_cost = vendor_cost - $3, status = CASE WHEN $4 THEN 'PAID' ELSE status END, updated_at = NOW() WHERE id = $1`,
    [inv.id, newCredit, reduce, settled]);
  await activity.log(c, {
    tenantId: inv.tenant_id, userId, entityType: 'INVOICE', entityId: inv.id, action: 'CREDIT_NOTE_ISSUED',
    message: `${note.credit_number} against ${inv.invoice_number} (${inv.site_code}): ${inr(total)} — ${reason}${reduce ? `; ISP cost reduced by ${inr(reduce)}` : ''}${settled ? '; bill settled' : ''}`,
    meta: { siteId: inv.site_id, creditNoteId: note.id }
  });
  return { ...note, invoice_number: inv.invoice_number };
};

/**
 * Disconnection (no pro-rata): bill every cycle that started on or before the date, in full; then credit any period of the
 * current connection that was billed in advance and starts after the date (none of it was used) — the link part, not one-time charges.
 */
const onDisconnect = async (c, site, date, userId) => {
  const settings = await c.one('SELECT * FROM tenant_settings WHERE tenant_id = $1', [site.tenant_id]);
  const billed = [];
  for (let n = Number(site.last_cycle_no) + 1, guard = 0; guard < 120 && cycleStart(site, n) <= date; n += 1, guard += 1) {
    const inv = await generateCycle(c, site, settings, n, userId);
    if (inv) billed.push(inv);
  }
  const credited = [];
  const later = await c.many(
    `SELECT * FROM invoices WHERE site_id = $1 AND invoice_type = 'RECURRING' AND status <> 'CANCELLED' AND cycle_no > $3 AND period_start > $2 ORDER BY cycle_no`,
    [site.id, date, Number(site.cycle_base || 0)]);
  for (const inv of later) {
    const p = await pricesFor(c, site, inv.cycle_no);
    const k = monthsPerCycle(site.billing_frequency);
    const alreadyCredited = Number((await c.one('SELECT COALESCE(SUM(base_amount),0) AS n FROM credit_notes WHERE invoice_id = $1', [inv.id])).n);
    const base = Math.min(round2(Number(inv.base_amount) - Number(inv.otc_amount)), round2(Number(inv.base_amount) - alreadyCredited));
    if (base > 0.01) {
      credited.push(await creditNote(c, { invoiceId: inv.id, base, reason: `link disconnected on ${dmy(date)}, before this period started`,
        vendorReduction: round2((p.vendorMrc + p.vendorIpMrc) * k), userId }));
    }
  }
  return { billed, credited };
};

/**
 * Reconnection: the first day to bill — the reconnection date, or the day after the last period already billed for days
 * the link ran (cycles billed in full up to the disconnection), whichever is later. Nothing is billed twice.
 */
const billingRestart = async (c, site, reconnectDate) => {
  const r = await c.one(
    `SELECT MAX(period_end) AS paid_to FROM invoices WHERE site_id = $1 AND invoice_type = 'RECURRING' AND status <> 'CANCELLED' AND period_start <= $2`,
    [site.id, site.terminated_on]);
  const after = r?.paid_to ? addDays(String(r.paid_to).slice(0, 10), 1) : reconnectDate;
  return after > reconnectDate ? after : reconnectDate;
};

/** Re-issue a cancelled invoice (same cycle, the price in force for that cycle; a re-issued 1st bill carries the OTC again) */
const reissue = async (c, site, cancelled, userId) => {
  const settings = await c.one('SELECT * FROM tenant_settings WHERE tenant_id = $1', [site.tenant_id]);
  if (cancelled.invoice_type === 'RECURRING') {
    // same cycle, same period (a cycle from before a reconnection keeps its own dates)
    return generateCycle(c, site, settings, cancelled.cycle_no, userId, { period: { start: cancelled.period_start, end: cancelled.period_end } });
  }
  // An older separate OTC bill: if the site's cycle 1 bill has no payment or credit yet, merge both into one 1st bill (OTC + cycle 1)
  const c1 = await c.one(
    "SELECT * FROM invoices WHERE site_id = $1 AND invoice_type = 'RECURRING' AND cycle_no = 1 AND status <> 'CANCELLED' FOR UPDATE", [site.id]);
  if (c1 && Number(c1.amount_received) === 0 && Number(c1.tds_amount) === 0 && Number(c1.credit_amount) === 0) {
    await c.query("UPDATE invoices SET status = 'CANCELLED', vendor_cost = 0, submission_remarks = $2, updated_at = NOW() WHERE id = $1",
      [c1.id, `Cancelled: merged with the OTC into one 1st bill (${cancelled.invoice_number} cancelled)`]);
    await activity.log(c, { tenantId: site.tenant_id, userId, entityType: 'INVOICE', entityId: c1.id, action: 'INVOICE_CANCELLED',
      message: `${c1.invoice_number} cancelled: merged with the OTC of ${cancelled.invoice_number} into one 1st bill`, meta: { siteId: site.id } });
    return generateCycle(c, site, settings, 1, userId);
  }
  // cycle 1 already paid: re-issue the OTC on its own
  return createInvoice(c, site, settings, {
    type: 'OTC', otcAmount: Number(site.client_otc), cycleNo: 0, periodStart: site.live_date, periodEnd: site.live_date,
    base: Number(site.client_otc), vendorCost: Number(site.vendor_otc), invoiceDate: today()
  }, userId);
};

module.exports = { onSiteLive, generateCycle, billDue, runDueCycles, monthsPerCycle, cycleStart, cycleEnd, pricesFor, creditNote, onDisconnect, billingRestart, reissue };
