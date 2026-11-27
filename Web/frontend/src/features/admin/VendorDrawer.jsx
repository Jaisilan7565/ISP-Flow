import React, { useMemo, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Pencil, MapPin, Trash2 } from 'lucide-react';
import { Button, Status } from '../../components/common/ui';
import { FormikForm, TextField, NumberField, DateField, SelectField } from '../../components/form/FormKit';
import { R, MSG, yup } from '../../validation/rules';
import { Drawer } from '../../components/common/Overlay';
import PillTabs from '../../components/common/PillTabs';
import { Table, Loading, ErrorBox, KV, Section } from '../../components/common/kit';
import { useApi, useAction } from '../../api/hooks';
import { post, del } from '../../api/client';
import { hasPerm } from '../../store/slices/authSlice';
import { openLifecycle } from '../../store/slices/uiSlice';
import { formatCurrency, formatMbps, formatDate, formatDateTime, todayIso } from '../../utils/formatters';
import { Code, LinkTags, mediumLabel } from '../shared';
import { TYPE } from './VendorForm';

const SITE_TABS = [
  { id: 'LIVE', label: 'Live', test: (s) => s.status === 'LIVE' },
  { id: 'DELIVERY', label: 'In delivery', test: (s) => !['LIVE', 'TERMINATED'].includes(s.status) },
  { id: 'TERMINATED', label: 'Disconnected', test: (s) => s.status === 'TERMINATED' },
  { id: 'ALL', label: 'All', test: () => true }
];

const hm = (m) => (m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`);

/** The ISP's own bills to you, each checked against the ISP cost booked on your bills for that period */
const IspBills = ({ v, bills, sites, canEnter }) => {
  const [open, setOpen] = useState(false);
  const add = useAction((b) => post(`/admin/vendors/${v.id}/bills`, b), { onSuccess: () => setOpen(false) });
  const remove = useAction((id) => del(`/admin/vendors/${v.id}/bills/${id}`));
  const schema = yup.object({
    billNumber: R.text(64).required(MSG.required),
    billDate: R.pastDate().required(MSG.required),
    periodFrom: R.date().required(MSG.required),
    periodTo: R.date().required(MSG.required).test('after', 'Cannot be before "period from"', function (to) { return !to || !this.parent.periodFrom || to >= this.parent.periodFrom; }),
    amount: R.money().required(MSG.required), gstAmount: R.money(),
    siteId: yup.string(), notes: R.text(2000)
  });
  return (
    <div className="space-y-3">
      {canEnter && (open ? (
        <FormikForm initialValues={{ billNumber: '', billDate: todayIso(), periodFrom: '', periodTo: '', amount: '', gstAmount: '', siteId: '', notes: '' }} schema={schema} busy={add.isPending}
          submitLabel="Record ISP bill" onSubmit={(b) => add.mutateAsync(b)} extra={<Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>}>
          <div className="grid gap-3 sm:grid-cols-3">
            <TextField name="billNumber" label="Bill no. *" hint={`As printed on ${v.name}'s bill`} />
            <DateField name="billDate" max={todayIso()} label="Bill date *" hint={`Due ${v.payment_terms_days} days later`} />
            <SelectField name="siteId" label="For site" hint="Blank = a bill for all its links" placeholder="All its sites"
              options={sites.filter((x) => x.relation === 'ISP').map((x) => ({ value: x.id, label: `${x.code} · ${x.site_name}` }))} />
            <DateField name="periodFrom" label="Period from *" hint="Service period on the bill" />
            <DateField name="periodTo" label="Period to *" hint="" />
            <div />
            <NumberField name="amount" min="0" label="Amount before GST (₹) *" hint="Compared with the cost you expected" />
            <NumberField name="gstAmount" min="0" label="GST (₹)" hint="As on the bill" />
          </div>
          <TextField name="notes" label="Notes" hint="Optional" />
        </FormikForm>
      ) : <Button size="sm" variant="outline" onClick={() => setOpen(true)}>Record an ISP bill</Button>)}
      <Table rows={bills} empty={`No bills from ${v.name} recorded yet.`}
        columns={[
          { key: 'n', label: 'Bill', render: (b) => <div className="text-xs"><p className="font-semibold text-ink">{b.bill_number}</p><p className="text-muted">{formatDate(b.bill_date)}{b.site_code ? ` · ${b.site_code}` : ' · all sites'}</p></div> },
          { key: 'p', label: 'Period', render: (b) => <span className="text-xs">{formatDate(b.period_from)} – {formatDate(b.period_to)}</span> },
          { key: 'a', label: 'Billed / expected', render: (b) => <div className="text-xs tnum"><p>{formatCurrency(b.amount)} <span className="text-muted">+ GST {formatCurrency(b.gst_amount)}</span></p><p className="text-muted">expected {formatCurrency(b.expected_amount)}</p></div> },
          { key: 'd', label: 'Check', render: (b) => (b.mismatch ? <span className="text-xs font-semibold text-[#C0283C]">{b.difference > 0 ? 'Over' : 'Under'} by {formatCurrency(Math.abs(b.difference))}</span> : <span className="text-xs font-semibold text-brand-700">Matches</span>) },
          { key: 'due', label: 'Due', render: (b) => <span className="text-xs">{formatDate(b.due_date)}</span> },
          ...(canEnter ? [{ key: 'x', label: '', render: (b) => <Button size="sm" variant="ghost" aria-label={`Remove bill ${b.bill_number}`} className="text-[#C0283C]!" onClick={() => window.confirm(`Remove ${v.name} bill ${b.bill_number} (entered by mistake)?`) && remove.mutate(b.id)}><Trash2 className="h-3.5 w-3.5" /></Button> }] : [])
        ]} />
      <p className="text-[11px] text-muted">Expected = the ISP cost booked on your bills of its sites whose period starts in the bill period (MRC, static IP, installation). A difference means the ISP billed a link you did not expect, a wrong price, or a period after disconnection.</p>
    </div>
  );
};

/**
 * One ISP / vendor at a glance: which sites it supplies (live, in delivery, disconnected),
 * where it was surveyed, what its live links cost per month and what we owe it.
 * Prices and payables show only for roles allowed to see them (the API leaves them out otherwise).
 */
export const VendorDrawer = ({ id, onClose, onEdit }) => {
  const dispatch = useDispatch();
  const user = useSelector((s) => s.auth.user);
  const { data, isLoading, error } = useApi(id ? `/admin/vendors/${id}/overview` : null);
  const [tab, setTab] = useState('LIVE');
  const sites = useMemo(() => (data?.sites || []).filter(SITE_TABS.find((t) => t.id === tab).test), [data, tab]);
  const v = data?.vendor;
  const m = data?.summary;
  const prices = m?.monthly_cost !== undefined;
  const owed = m?.accrued !== undefined;
  const site360 = (fid) => dispatch(openLifecycle(fid));

  return (
    <Drawer open={Boolean(id)} onClose={onClose} label="ISP / vendor" width="sm:w-[820px]">
      {isLoading || !data ? (error ? <ErrorBox error={error} /> : <Loading />) : (
        <div>
          <div className="flex flex-wrap items-center gap-2 pr-10">
            <span className="rounded-md bg-panel px-2 py-0.5 text-[11px] font-semibold">{TYPE[v.vendor_type] || v.vendor_type}</span>
            <Status value={v.is_active ? 'ACTIVE' : 'SUSPENDED'} />
          </div>
          <h2 className="mt-2 text-xl font-semibold text-ink">{v.name}</h2>
          <p className="text-sm text-muted">{[v.gstin || 'No GSTIN', [v.city, v.state].filter(Boolean).join(', '), `${v.payment_terms_days} days payment terms`].filter(Boolean).join(' · ')}</p>
          {onEdit && hasPerm(user, 'masters.manage') && <div className="mt-3"><Button size="sm" variant="outline" onClick={() => onEdit(v)}><Pencil className="h-3.5 w-3.5" /> Edit {v.vendor_type === 'ISP' ? 'ISP' : 'vendor'}</Button></div>}

          <Section title="At a glance">
            <KV cols={4} items={[
              ['Live links', <b key="l" className="tnum">{m.live}</b>],
              ['Live bandwidth', formatMbps(m.live_bandwidth_mbps)],
              ['In delivery', m.in_delivery],
              ['Disconnected', m.disconnected],
              ['Surveys', `${m.feasible} feasible of ${m.surveys}`],
              m.partner_sites > 0 && ['Partner on', `${m.partner_sites} site(s)`],
              prices && ['Monthly cost (live)', <b key="c" className="tnum">{formatCurrency(m.monthly_cost)}</b>],
              prices && ['We bill on its links', formatCurrency(m.monthly_billing)],
              owed && ['Accrued to it', formatCurrency(m.accrued)],
              owed && ['Paid to it', formatCurrency(m.paid)],
              owed && ['We owe', <b key="o" className={`tnum ${m.outstanding > 0 ? 'text-[#B26B00]' : ''}`}>{formatCurrency(m.outstanding)}</b>],
              ['Faults (90 days)', <span key="f" className={m.faults_open ? 'font-semibold text-[#C0283C]' : ''}>{m.faults_90d}{m.faults_open ? ` · ${m.faults_open} down now` : ''}</span>],
              m.avg_restore_hours !== null && ['Avg. time to restore', `${m.avg_restore_hours} h`],
              m.isp_billed !== undefined && ['ISP bills recorded', `${formatCurrency(m.isp_billed)}${m.isp_bills_mismatch ? ` · ${m.isp_bills_mismatch} to check` : ''}`]
            ]} />
          </Section>

          <Section title={`Sites (${data.sites.length})`}>
            <div className="mb-3"><PillTabs value={tab} onChange={setTab} options={SITE_TABS.map((t) => ({ id: t.id, label: t.label, count: data.sites.filter(t.test).length }))} /></div>
            <Table rows={sites} onRowClick={(s) => site360(s.feasibility_id)} empty={tab === 'LIVE' ? `No live links with ${v.name} yet.` : 'No sites here.'}
              columns={[
                { key: 'site', label: 'Site / client', render: (s) => <div><p className="font-semibold text-ink"><Code>{s.code}</Code> {s.site_name}{s.client_site_ref && <span className="ml-1 text-[11px] font-medium text-muted">[{s.client_site_ref}]</span>}<LinkTags role={s.link_role} ips={s.static_ip_count} /></p><p className="text-[11px] text-muted">{s.customer_name}{s.relation === 'PARTNER' ? ' · as partner (Budget B)' : ''}</p></div> },
                { key: 'link', label: 'Link', render: (s) => <div className="text-xs"><p>{mediumLabel(s.medium)} · {formatMbps(s.bandwidth_mbps)}</p><p className="text-muted">{s.circuit_id || '—'}</p></div> },
                { key: 'when', label: 'Live', render: (s) => <span className="text-xs">{s.terminated_on ? `Disconnected ${formatDate(s.terminated_on)}` : s.live_date ? formatDate(s.live_date) : '—'}</span> },
                ...(prices ? [{ key: 'cost', label: 'ISP MRC', render: (s) => <span className="text-xs tnum">{formatCurrency(Number(s.vendor_mrc) + Number(s.vendor_ip_mrc))}</span> }] : []),
                ...(owed ? [{ key: 'owed', label: 'Owed', render: (s) => <span className="text-xs tnum">{formatCurrency(Number(s.accrued) - Number(s.paid))}</span> }] : []),
                { key: 'status', label: 'Status', render: (s) => <Status value={s.status} /> }
              ]} />
          </Section>

          <Section title={`Surveys (${data.surveys.length})`}>
            <Table rows={data.surveys} rowKey="feasibility_id" onRowClick={(x) => site360(x.feasibility_id)} empty={`${v.name} has not been surveyed for any site yet.`}
              columns={[
                { key: 'site', label: 'Site / client', render: (x) => <div><p className="font-semibold text-ink">{x.site_name}</p><p className="text-[11px] text-muted">{x.code} · {x.customer_name}</p></div> },
                { key: 'ok', label: 'Feasible', render: (x) => (x.is_feasible ? <span className="text-xs font-semibold text-brand-700">Yes{x.distance_m ? ` · ${x.distance_m} m` : ''}</span> : <span className="text-xs text-[#C0283C]">No{x.remarks ? ` · ${x.remarks}` : ''}</span>) },
                ...(prices ? [{ key: 'p', label: 'ISP OTC / MRC', render: (x) => (x.is_feasible ? <span className="text-xs tnum">{formatCurrency(x.vendor_otc)} / {formatCurrency(x.vendor_mrc)}</span> : '—') }] : []),
                { key: 'd', label: 'Surveyed', render: (x) => <span className="text-xs">{formatDate(x.created_at)}</span> }
              ]} />
          </Section>

          {data.bills && (
            <Section title={`${v.name}'s bills to you (${data.bills.length})`}>
              <IspBills v={v} bills={data.bills} sites={data.sites} canEnter={hasPerm(user, 'billing.manage') || hasPerm(user, 'treasury.manage')} />
            </Section>
          )}

          <Section title={`Link faults (${data.faults.length})`}>
            <Table rows={data.faults} onRowClick={(f) => site360(f.feasibility_id)} empty={`No faults logged on ${v.name}'s links.`}
              columns={[
                { key: 's', label: 'Site', render: (f) => <div className="text-xs"><p className="font-semibold text-ink">{f.site_code} · {f.site_name}</p><p className="text-muted">{f.description}{f.docket_no ? ` · docket ${f.docket_no}` : ''}</p></div> },
                { key: 'd', label: 'Down', render: (f) => <span className="text-xs">{formatDateTime(f.reported_at)}</span> },
                { key: 'r', label: 'Restored · cause', render: (f) => <div className="text-xs">{f.restored_at ? <><p>{formatDateTime(f.restored_at)}</p><p className="text-muted">{f.cause}</p></> : <b className="text-[#C0283C]">Still down</b>}</div> },
                { key: 'm', label: 'Downtime', render: (f) => <span className="text-xs tnum">{hm(f.down_minutes)}</span> }
              ]} />
          </Section>

          {data.payouts && (
            <Section title={`Payments to ${v.name} (${data.payouts.length})`}>
              <Table rows={data.payouts} empty="Nothing paid yet."
                columns={[
                  { key: 'd', label: 'Paid on', render: (p) => <span className="text-xs">{formatDate(p.paid_date)}</span> },
                  { key: 's', label: 'Site', render: (p) => p.site_code || '—' },
                  { key: 'r', label: 'Reference', render: (p) => <span className="text-xs">{p.reference}{p.period_label ? ` · ${p.period_label}` : ''}</span> },
                  { key: 'a', label: 'Amount', render: (p) => <span className="tnum">{formatCurrency(p.amount)}</span> }
                ]} />
            </Section>
          )}

          <Section title="Contact & address">
            <KV cols={2} items={[
              ['Contact', [v.contact_name, v.contact_phone, v.contact_email].filter(Boolean).join(' · ') || '—'],
              ['Address', <span key="a">{[v.address, v.city, v.state, v.pincode].filter(Boolean).join(', ') || '—'}{v.maps_url && <a href={v.maps_url} target="_blank" rel="noreferrer" className="ml-1.5 inline-flex items-center gap-0.5 text-brand-700 underline"><MapPin className="h-3 w-3" />Map</a>}</span>],
              v.bank_details && ['Bank details', v.bank_details]
            ]} />
            {v.notes && <p className="mt-3 whitespace-pre-line rounded-xl bg-panel p-3 text-xs text-ink-2">{v.notes}</p>}
          </Section>
        </div>
      )}
    </Drawer>
  );
};

export default VendorDrawer;
