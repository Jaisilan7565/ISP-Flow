import { serviceName } from '../shared';

/**
 * Opens a print-ready GST tax invoice in a new window (Save as PDF from the print dialog).
 * Lines: one-time charges (1st bill only) · the link service for the period (named by its medium) · static IP charges.
 */
const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
const two = (n) => (n < 20 ? ONES[n] : `${TENS[Math.floor(n / 10)]}${n % 10 ? ` ${ONES[n % 10]}` : ''}`);
const three = (n) => (n >= 100 ? `${ONES[Math.floor(n / 100)]} Hundred${n % 100 ? ` ${two(n % 100)}` : ''}` : two(n));

export const rupeesInWords = (amount) => {
  let n = Math.round(Number(amount) || 0);
  if (n === 0) return 'Zero Rupees Only';
  const parts = [];
  const crore = Math.floor(n / 10000000); n %= 10000000;
  const lakh = Math.floor(n / 100000); n %= 100000;
  const thousand = Math.floor(n / 1000); n %= 1000;
  if (crore) parts.push(`${three(crore)} Crore`);
  if (lakh) parts.push(`${two(lakh)} Lakh`);
  if (thousand) parts.push(`${two(thousand)} Thousand`);
  if (n) parts.push(three(n));
  return `${parts.join(' ')} Rupees Only`;
};

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const money = (v) => new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(v) || 0);
const date = (v) => (v ? new Date(`${v}T00:00:00`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');

export const printInvoice = (inv) => {
  const c = inv.company || {};
  const half = Number(inv.gst_amount) / 2;
  const otcLine = `One-time installation & commissioning charges (OTC) — ${inv.site_name}`;
  if (inv.invoice_type === 'OTC') return printLines(inv, c, half, [[otcLine, inv.base_amount]]);
  // A recurring bill: the 1st one also carries the OTC; static IPs are their own line
  const otc = Number(inv.otc_amount) || 0;
  const ip = Number(inv.ip_amount) || 0;
  const service = `${serviceName(inv.medium)} ${inv.bandwidth_mbps} Mbps${inv.link_role === 'SECONDARY' ? ' (secondary / backup link)' : ''} — ${inv.site_name}, period ${date(inv.period_start)} to ${date(inv.period_end)} (Cycle ${inv.cycle_no})`;
  const lines = [
    otc > 0 && [otcLine, otc],
    [service, Number(inv.base_amount) - otc - ip],
    ip > 0 && [`Static IP charges${inv.static_ip_count ? ` (${inv.static_ip_count} IP${inv.static_ip_count > 1 ? 's' : ''}${inv.static_ip_block ? `: ${inv.static_ip_block}` : ''})` : ''} — same period`, ip]
  ].filter(Boolean);
  return printLines(inv, c, half, lines);
};

const printLines = (inv, c, half, lines, doc = {}) => {
  const sameState = !c.state || !inv.customer_state || c.state.trim().toLowerCase() === inv.customer_state.trim().toLowerCase();
  const gstTotal = doc.gst ?? inv.gst_amount;
  const taxRows = sameState
    ? `<tr><td>CGST @ ${inv.gst_pct / 2}%</td><td class="r">${money(half)}</td></tr><tr><td>SGST @ ${inv.gst_pct / 2}%</td><td class="r">${money(half)}</td></tr>`
    : `<tr><td>IGST @ ${inv.gst_pct}%</td><td class="r">${money(gstTotal)}</td></tr>`;
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(doc.number || inv.invoice_number)}</title>
<style>
  body{font-family:Arial,Helvetica,sans-serif;color:#111;margin:32px;font-size:12px}
  h1{font-size:20px;margin:0} .muted{color:#555} table{width:100%;border-collapse:collapse;margin-top:12px}
  td,th{border:1px solid #bbb;padding:6px 8px;vertical-align:top} th{background:#f2f2f2;text-align:left} .r{text-align:right}
  .grid{display:flex;gap:16px;margin-top:16px} .grid>div{flex:1;border:1px solid #bbb;padding:8px} .tot td{font-weight:bold}
  @media print{body{margin:12mm}}
</style></head><body>
<div style="display:flex;justify-content:space-between;align-items:flex-start">
  <div><h1>${esc(c.name)}</h1><div class="muted">${esc(c.address || '')}</div><div>GSTIN: <b>${esc(c.gstin || '—')}</b> ${c.state ? `· State: ${esc(c.state)}` : ''}</div></div>
  <div style="text-align:right"><h1>${doc.title || 'TAX INVOICE'}</h1><div>No: <b>${esc(doc.number || inv.invoice_number)}</b></div><div>Date: ${date(doc.date || inv.invoice_date)}</div>${doc.against ? `<div>Against invoice: <b>${esc(doc.against)}</b> dated ${date(inv.invoice_date)}</div>` : inv.due_date ? `<div>Due: ${date(inv.due_date)}</div>` : ''}</div>
</div>
<div class="grid">
  <div><b>Bill to</b><br>${esc(inv.customer_name)}<br>${esc(inv.customer_address || '')}<br>GSTIN: ${esc(inv.customer_gstin || '—')}</div>
  <div><b>Service location</b><br>${esc(inv.site_name)} (${esc(inv.site_code)})<br>${esc(inv.site_address || '')}<br>Circuit ID: ${esc(inv.circuit_id || '—')}${inv.client_site_ref ? `<br>Your site ID: ${esc(inv.client_site_ref)}` : ''}${inv.po_number ? `<br>Your PO: ${esc(inv.po_number)}${inv.po_date ? ` dated ${date(inv.po_date)}` : ''}` : ''}</div>
</div>
<table><tr><th>Description</th><th>SAC</th><th class="r">Amount (₹)</th></tr>
${lines.map(([d, amt]) => `<tr><td>${esc(d)}</td><td>998422</td><td class="r">${money(amt)}</td></tr>`).join('')}</table>
<table style="width:45%;margin-left:auto"><tr><td>Taxable value</td><td class="r">${money(doc.base ?? inv.base_amount)}</td></tr>${taxRows}
<tr class="tot"><td>${doc.title ? 'Total credit' : 'Total'}</td><td class="r">${money(doc.total ?? inv.total_amount)}</td></tr></table>
<p><b>Amount in words:</b> ${rupeesInWords(doc.total ?? inv.total_amount)}</p>
<p class="muted">${doc.title ? 'This credit note reduces the amount payable against the invoice above.' : `Payment within ${esc(inv.credit_days)} days of bill submission. Please quote the invoice number with your payment (UTR).`}</p>
<div style="margin-top:48px;text-align:right">For ${esc(c.name)}<br><br><br>Authorised signatory</div>
<script>window.onload=function(){window.print()}</script>
</body></html>`;
  const w = window.open('', '_blank');
  if (!w) return false;
  w.document.write(html);
  w.document.close();
  return true;
};

/** Print-ready GST credit note against a bill */
export const printCreditNote = (inv, note) => printLines(inv, inv.company || {}, Number(note.gst_amount) / 2,
  [[`Credit against ${inv.invoice_number} (${inv.label}) — ${inv.site_name}: ${note.reason}`, note.base_amount]],
  { title: 'CREDIT NOTE', number: note.credit_number, date: note.credit_date, against: inv.invoice_number, base: note.base_amount, gst: note.gst_amount, total: note.total_amount });
