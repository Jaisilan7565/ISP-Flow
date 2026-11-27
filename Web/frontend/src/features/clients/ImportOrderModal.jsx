/**
 * Import a client order from Excel: choose the client → upload the filled template (or the client's own sheet)
 * → preview every row with its problems → import the good rows as ONE order (all or nothing on the server).
 * The optional "ISPs" sheet adds missing ISPs / vendors first.
 */
import React, { useMemo, useRef, useState } from 'react';
import { useSelector } from 'react-redux';
import { Download, FileSpreadsheet, Upload, AlertTriangle, CheckCircle2, Info, Loader2 } from 'lucide-react';
import { Modal, Field, inputClass } from '../../components/common/Overlay';
import { selectClass, EmptyState, ErrorBox } from '../../components/common/kit';
import { Button } from '../../components/common/ui';
import { useApi, useAction } from '../../api/hooks';
import { post } from '../../api/client';
import { hasPerm } from '../../store/slices/authSlice';
import { todayIso, formatMbps } from '../../utils/formatters';
import { readSpreadsheet, downloadBlob } from '../../utils/spreadsheet';
import { buildTemplate, parseWorkbook, TEMPLATE_FILE } from './importTemplate';
import { mediumLabel } from '../shared';

const VIA = [['EMAIL', 'Email'], ['WHATSAPP', 'WhatsApp'], ['PORTAL', 'Client portal'], ['LETTER', 'Letter / LOI'], ['PHONE', 'Phone']];
const ENGINEER_ROLES = { role: 'FIELD_ENGINEER,OPERATIONS' };
const SHOW_ROWS = 400;

export const downloadTemplate = () => downloadBlob(buildTemplate(), TEMPLATE_FILE);

const Stat = ({ tone = 'ink', value, label }) => {
  const color = { ink: 'text-ink', good: 'text-brand-700', bad: 'text-[#C0283C]', warn: 'text-[#B26B00]' }[tone];
  return (
    <div className="rounded-xl bg-panel px-3.5 py-2.5">
      <p className={`text-xl font-semibold tnum ${color}`}>{value}</p>
      <p className="text-[11px] text-muted">{label}</p>
    </div>
  );
};

const RowIssues = ({ errors, warnings }) => (
  <ul className="space-y-0.5 text-[11px]">
    {errors.map((e) => <li key={e} className="flex gap-1 text-[#C0283C]"><AlertTriangle className="mt-px h-3 w-3 shrink-0" />{e}</li>)}
    {warnings.map((w) => <li key={w} className="flex gap-1 text-[#8A5A00]"><Info className="mt-px h-3 w-3 shrink-0" />{w}</li>)}
    {!errors.length && !warnings.length && <li className="flex gap-1 text-brand-700"><CheckCircle2 className="mt-px h-3 w-3 shrink-0" />Ready</li>}
  </ul>
);

const ImportOrderModal = ({ open, onClose, onCreated }) => {
  const user = useSelector((s) => s.auth.user);
  const canAssign = hasPerm(user, 'feasibility.assign');
  const canMasters = hasPerm(user, 'masters.manage');
  const clients = useApi(open ? '/admin/customers' : null);
  const engineers = useApi(open && canAssign ? '/admin/users/lookup' : null, ENGINEER_ROLES);
  const vendors = useApi(open && canMasters ? '/admin/vendors' : null);
  const fileRef = useRef(null);

  const [header, setHeader] = useState({ customerId: '', receivedVia: 'EMAIL', receivedDate: todayIso(), clientRef: '', ownerId: '' });
  const [file, setFile] = useState(null);
  const [parsed, setParsed] = useState(null);
  const [parseError, setParseError] = useState(null);
  const [reading, setReading] = useState(false);
  const [onlyProblems, setOnlyProblems] = useState(false);
  const [withIsps, setWithIsps] = useState(true);
  const [progress, setProgress] = useState('');

  const reset = () => { setFile(null); setParsed(null); setParseError(null); setOnlyProblems(false); setProgress(''); if (fileRef.current) fileRef.current.value = ''; };
  const close = () => { reset(); onClose(); };
  const set = (k) => (e) => setHeader((h) => ({ ...h, [k]: e.target.value }));

  const onFile = async (f) => {
    reset();
    if (!f) return;
    setFile(f); setReading(true);
    try {
      const wb = await readSpreadsheet(f);
      const result = parseWorkbook(wb, canAssign ? engineers.data || [] : null);
      setParsed(result);
      if (!header.clientRef) setHeader((h) => ({ ...h, clientRef: f.name.replace(/\.(xlsx|csv)$/i, '').replace(/[_-]+/g, ' ').slice(0, 128) }));
    } catch (e) {
      setParseError(e);
    } finally { setReading(false); }
  };

  const existingVendors = useMemo(() => new Set((vendors.data || []).map((v) => v.name.trim().replace(/\s+/g, ' ').toLowerCase())), [vendors.data]);
  const sum = useMemo(() => {
    if (!parsed) return null;
    const good = parsed.sites.filter((r) => !r.errors.length);
    const ispGood = parsed.isps.filter((r) => !r.errors.length && !r.duplicate);
    const ispNew = ispGood.filter((r) => !existingVendors.has(r.vendor.name.toLowerCase()));
    return {
      good, bad: parsed.sites.length - good.length, warn: parsed.sites.filter((r) => r.warnings.length).length,
      ispGood, ispNew, ispBad: parsed.isps.filter((r) => r.errors.length).length
    };
  }, [parsed, existingVendors]);

  const run = useAction(async () => {
    const importIsps = withIsps && canMasters && sum.ispNew.length > 0;
    if (importIsps) {
      setProgress(`Adding ${sum.ispNew.length} ISP(s)…`);
      await post('/admin/vendors/import', { vendors: sum.ispNew.map((r) => r.vendor) });
    }
    setProgress(`Creating the order with ${sum.good.length} site(s)…`);
    try {
      return await post('/orders/import', {
        customerId: header.customerId, receivedVia: header.receivedVia, receivedDate: header.receivedDate,
        clientRef: header.clientRef || null, ownerId: header.ownerId || null,
        notes: `Imported from ${file.name}: ${sum.good.length} site(s)${sum.bad ? `, ${sum.bad} row(s) with errors left out` : ''}.`,
        sites: sum.good.map((r) => r.site)
      });
    } catch (e) {
      // Point API row errors ("sites.12.address") back at the sheet row
      const first = e.errors?.[0];
      const m = first?.field?.match(/^sites\.(\d+)\.(.+)$/);
      if (m) e.message = `Row ${sum.good[Number(m[1])].rowNo}: ${m[2]} — ${first.message}`;
      throw e;
    } finally { setProgress(''); }
  }, { onSuccess: (res) => { close(); onCreated(res.data.id); } });

  const active = (clients.data || []).filter((c) => c.is_active);
  const rows = parsed ? (onlyProblems ? parsed.sites.filter((r) => r.errors.length || r.warnings.length) : parsed.sites) : [];
  const canImport = parsed && sum.good.length > 0 && header.customerId && !run.isPending;

  return (
    <Modal open={open} onClose={close} title="Import client order from Excel" width="max-w-[1040px]">
      {clients.data && active.length === 0 ? (
        <EmptyState title="Add a client first" hint="Add the client who sent this list in the Clients tab, then import." />
      ) : (
        <div className="space-y-4">
          {/* Step 1 — template */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-panel/60 p-3.5">
            <div className="flex items-start gap-2.5">
              <FileSpreadsheet className="mt-0.5 h-5 w-5 shrink-0 text-brand-600" />
              <div>
                <p className="text-[13px] font-semibold text-ink">1. Fill the import template</p>
                <p className="text-xs text-muted">One row per site: <b>Site Name, Address, Bandwidth</b> are required; coordinates, pincode, medium, static IPs, client site ID, contact and notes are optional. An optional <b>ISPs</b> sheet adds new ISPs.</p>
              </div>
            </div>
            <Button size="sm" variant="outline" onClick={downloadTemplate}><Download className="h-3.5 w-3.5" /> Download template</Button>
          </div>

          {/* Step 2 — order details + file */}
          <div>
            <p className="mb-2 text-[13px] font-semibold text-ink">2. Order details and file</p>
            <div className="grid gap-3 sm:grid-cols-4">
              <Field label="Client *" className="sm:col-span-2" hint="All imported sites go to one new order for this client">
                <select value={header.customerId} onChange={set('customerId')} className={selectClass}>
                  <option value="">Select client…</option>
                  {active.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </Field>
              <Field label="Received on">
                <select value={header.receivedVia} onChange={set('receivedVia')} className={selectClass}>
                  {VIA.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </Field>
              <Field label="Received date">
                <input type="date" max={todayIso()} value={header.receivedDate} onChange={set('receivedDate')} className={inputClass} />
              </Field>
              <Field label="Client's order / ref no." className="sm:col-span-2" hint="Their reference (filled from the file name — edit it)">
                <input value={header.clientRef} maxLength={128} onChange={set('clientRef')} className={inputClass} />
              </Field>
              {canAssign && (
                <Field label="Order owner (optional)" className="sm:col-span-2" hint="Field engineer for sites without a Field Engineer in the sheet">
                  <select value={header.ownerId} onChange={set('ownerId')} className={selectClass}>
                    <option value="">Assign later</option>
                    {(engineers.data || []).map((u) => <option key={u.id} value={u.id}>{u.name}{u.zone ? ` · ${u.zone}` : ''}</option>)}
                  </select>
                </Field>
              )}
            </div>
            <label className="mt-3 flex cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed border-line-strong px-4 py-5 text-sm text-ink-2 transition-colors hover:border-brand-600 hover:bg-brand-50/50"
              onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); onFile(e.dataTransfer.files?.[0]); }}>
              {reading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4 text-brand-600" />}
              {file ? <span><b>{file.name}</b> · click to choose another file</span> : <span>Drop the <b>.xlsx</b> or <b>.csv</b> file here, or click to choose</span>}
              <input ref={fileRef} type="file" accept=".xlsx,.csv" className="sr-only" onChange={(e) => onFile(e.target.files?.[0])} />
            </label>
            {parseError && <div className="mt-3"><ErrorBox error={parseError} /></div>}
          </div>

          {/* Step 3 — preview */}
          {parsed && (
            <div>
              <p className="mb-2 text-[13px] font-semibold text-ink">3. Check and import</p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Stat tone="good" value={sum.good.length} label="sites ready to import" />
                <Stat tone={sum.bad ? 'bad' : 'ink'} value={sum.bad} label="rows with errors (left out)" />
                <Stat tone={sum.warn ? 'warn' : 'ink'} value={sum.warn} label="rows with notes / auto-fixes" />
                <Stat value={parsed.isps.length ? `${sum.ispNew.length} new` : '—'} label={parsed.isps.length ? `of ${parsed.isps.length} ISPs in sheet "${parsed.ispSheet.name}"` : 'no ISPs sheet'} />
              </div>
              {parsed.siteSheet.unknownColumns.length > 0 && (
                <p className="mt-2 text-[11px] text-muted">Extra columns kept in each site's notes: {parsed.siteSheet.unknownColumns.slice(0, 8).join(', ')}{parsed.siteSheet.unknownColumns.length > 8 ? ` and ${parsed.siteSheet.unknownColumns.length - 8} more` : ''}.</p>
              )}
              {parsed.isps.length > 0 && (
                canMasters ? (
                  <label className="mt-2 flex items-center gap-2 text-xs font-medium text-ink-2">
                    <input type="checkbox" checked={withIsps} onChange={(e) => setWithIsps(e.target.checked)} />
                    Also add the {sum.ispNew.length} new ISP(s) to ISPs & Vendors{sum.ispGood.length > sum.ispNew.length ? ` (${sum.ispGood.length - sum.ispNew.length} already listed — skipped)` : ''}{sum.ispBad ? ` · ${sum.ispBad} with errors left out` : ''}
                  </label>
                ) : <p className="mt-2 text-[11px] text-muted">The ISPs sheet is ignored — only the admin can add ISPs & vendors.</p>
              )}

              <div className="mt-3 flex items-center justify-between gap-2">
                <p className="text-xs text-muted">Sheet "{parsed.siteSheet.name}" · {parsed.sites.length} row(s)</p>
                <label className="flex items-center gap-1.5 text-xs font-medium text-ink-2"><input type="checkbox" checked={onlyProblems} onChange={(e) => setOnlyProblems(e.target.checked)} /> Only rows with errors or notes</label>
              </div>
              <div className="mt-2 max-h-[46vh] overflow-auto rounded-xl border border-line">
                <table className="w-full min-w-[760px] text-left text-xs">
                  <thead className="sticky top-0 bg-card">
                    <tr className="border-b border-line text-[10px] uppercase tracking-wide text-subtle">
                      <th className="px-3 py-2 font-semibold">Row</th><th className="px-3 py-2 font-semibold">Site</th><th className="px-3 py-2 font-semibold">City / pincode</th>
                      <th className="px-3 py-2 font-semibold">Link</th><th className="px-3 py-2 font-semibold">Location</th><th className="px-3 py-2 font-semibold">Check</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.slice(0, SHOW_ROWS).map((r) => (
                      <tr key={r.rowNo} className={`border-b border-line/70 align-top last:border-0 ${r.errors.length ? 'bg-[#FDF0F1]/60' : ''}`}>
                        <td className="px-3 py-2 tnum text-muted">{r.rowNo}</td>
                        <td className="px-3 py-2"><p className="font-semibold text-ink">{r.site.siteName || '—'}{r.site.clientSiteRef && <span className="ml-1 font-normal text-muted">[{r.site.clientSiteRef}]</span>}</p><p className="line-clamp-1 max-w-[260px] text-muted">{r.site.address}</p></td>
                        <td className="px-3 py-2">{r.site.city || '—'}<p className="text-muted">{r.site.pincode || ''}</p></td>
                        <td className="px-3 py-2 whitespace-nowrap">{Number.isFinite(Number(r.site.bandwidthMbps)) && r.site.bandwidthMbps !== '' ? formatMbps(r.site.bandwidthMbps) : '—'}<p className="text-muted">{mediumLabel(r.site.medium)}{r.site.staticIpCount ? ` · ${r.site.staticIpCount} IP` : ''}{r.site.linkRole === 'SECONDARY' ? ' · secondary' : ''}</p></td>
                        <td className="px-3 py-2 tnum text-muted">{r.site.latitude !== '' ? `${Number(r.site.latitude).toFixed(4)}, ${Number(r.site.longitude).toFixed(4)}` : '—'}</td>
                        <td className="px-3 py-2"><RowIssues errors={r.errors} warnings={r.warnings} /></td>
                      </tr>
                    ))}
                    {!rows.length && <tr><td colSpan={6} className="px-3 py-6 text-center text-muted">{onlyProblems ? 'No problems found.' : 'No site rows found under the header.'}</td></tr>}
                  </tbody>
                </table>
              </div>
              {rows.length > SHOW_ROWS && <p className="mt-1 text-[11px] text-muted">Showing the first {SHOW_ROWS} of {rows.length} rows — all of them are imported.</p>}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line pt-4">
            {progress && <span className="mr-auto flex items-center gap-1.5 text-xs text-muted"><Loader2 className="h-3.5 w-3.5 animate-spin" />{progress}</span>}
            {!progress && parsed && !header.customerId && <span className="mr-auto text-xs text-[#B26B00]">Choose the client to import into.</span>}
            <Button variant="ghost" onClick={close}>Cancel</Button>
            <Button disabled={!canImport} onClick={() => run.mutate()}>
              {run.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              {parsed ? `Import ${sum.good.length} site(s)` : 'Import'}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
};

export default ImportOrderModal;
