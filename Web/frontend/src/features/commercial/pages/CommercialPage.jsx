import React, { useCallback, useMemo, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { motion } from 'framer-motion';
import { Send, Plus, Trash2, ArrowRight } from 'lucide-react';
import { page, rise } from '../../../utils/motion';
import { Button, Status, ProgressBar } from '../../../components/common/ui';
import PageHeader from '../../../components/common/PageHeader';
import PillTabs from '../../../components/common/PillTabs';
import { FieldArray } from 'formik';
import { Drawer, inputClass } from '../../../components/common/Overlay';
import { Table, Loading, ErrorBox, KV, Section, NextStep, Stepper, DocumentsPanel } from '../../../components/common/kit';
import { FormikForm, TextField, NumberField, SelectField, FormError } from '../../../components/form/FormKit';
import { R, MSG, yup, totals100 } from '../../../validation/rules';
import { useApi, useAction } from '../../../api/hooks';
import { post, put } from '../../../api/client';
import { hasPerm } from '../../../store/slices/authSlice';
import { openRecord } from '../../../store/slices/uiSlice';
import { formatCurrency, formatMbps, formatDate } from '../../../utils/formatters';
import { useFocusRecord, RecordActivity, Site360Button, Code, filterBy, LinkTags, staticIpLabel, needsStaticIp } from '../../shared';
import { shortName } from '../../../utils/names';

/** Budget B % is the company's own share (the ISP company using the tool) */
const ownShareLabel = (user) => `${shortName(user?.tenant_name) || 'Own'} share`;

const TABS = [
  { id: 'ALL', label: 'All', statuses: null },
  { id: 'DRAFT', label: 'Draft', statuses: ['DRAFT'] },
  { id: 'SENT', label: 'Sent', statuses: ['SENT'] },
  { id: 'WON', label: 'Bid won', statuses: ['WON'] },
  { id: 'LOST', label: 'Lost', statuses: ['LOST'] }
];

const marginOf = (o, months) => {
  // Monthly = link MRC + static IP charge
  const client = (Number(o.clientOtc) || 0) + ((Number(o.clientMrc) || 0) + (Number(o.clientIpMrc) || 0)) * months;
  const vendor = (Number(o.vendorOtc) || 0) + ((Number(o.vendorMrc) || 0) + (Number(o.vendorIpMrc) || 0)) * months;
  return { client, vendor, margin: client - vendor, pct: client ? ((client - vendor) / client) * 100 : 0 };
};

/** Mirrors PUT /quotes/:id/options (Joi) */
const optionsSchema = yup.object({
  contractMonths: R.int(1, 120).required(MSG.required),
  options: yup.array().of(yup.object({
    vendorId: yup.string().required('Choose the ISP'),
    vendorOtc: R.money(),
    vendorMrc: R.money(),
    clientOtc: R.money(),
    clientMrc: R.positiveMoney().required(MSG.required),
    vendorIpMrc: R.money(),
    clientIpMrc: R.money(),
    slaPct: R.number().min(90, 'SLA must be 90–100%').max(100, 'SLA must be 90–100%'),
    notes: R.text(1000)
  })).min(1, 'Keep at least one quote').max(3, 'At most 3 quotes')
});

const OptionsEditor = ({ q }) => {
  const vendors = useApi('/admin/vendors', { type: 'ISP' });
  const save = useAction((body) => put(`/quotes/${q.id}/options`, body));
  const init = {
    contractMonths: q.contract_months,
    options: q.options.map((o) => ({ vendorId: o.vendor_id, vendorOtc: o.vendor_otc, vendorMrc: o.vendor_mrc, clientOtc: o.client_otc, clientMrc: o.client_mrc, vendorIpMrc: o.vendor_ip_mrc ?? '', clientIpMrc: o.client_ip_mrc ?? '', slaPct: o.sla_pct ?? '', notes: o.notes || '' }))
  };
  const ispOptions = (vendors.data || []).map((v) => ({ value: v.id, label: v.name }));
  const ip = needsStaticIp(q);
  return (
    <FormikForm initialValues={init} schema={optionsSchema} busy={save.isPending} submitLabel="Save quotes"
      onSubmit={(v) => save.mutateAsync({
        contractMonths: v.contractMonths,
        options: v.options.map((r, i) => ({ ...r, optionNo: i + 1, vendorOtc: r.vendorOtc ?? 0, vendorMrc: r.vendorMrc ?? 0, clientOtc: r.clientOtc ?? 0, vendorIpMrc: ip ? r.vendorIpMrc ?? 0 : 0, clientIpMrc: ip ? r.clientIpMrc ?? 0 : 0, slaPct: r.slaPct ?? null }))
      })}>
      {({ values }) => {
        const m = Number(values.contractMonths) || 1;
        return (
          <>
            <NumberField name="contractMonths" min="1" max="120" className="max-w-[200px]" label="Contract months" hint={ip ? '1–120; quote value = OTC + (MRC + static IP) × months' : '1–120; quote value = OTC + MRC × months'} />
            {ip && <NextStep>This site needs <b>static IP: {staticIpLabel(q.static_ip_count)}</b>. Each quote has an ISP and a client static IP charge per month.</NextStep>}
            <FieldArray name="options">
              {(arr) => (
                <>
                  {values.options.map((r, i) => {
                    const mg = marginOf(r, m);
                    return (
                      <div key={i} className="rounded-xl border border-line bg-panel p-3">
                        <div className="mb-2 flex items-center justify-between">
                          <span className="text-sm font-semibold text-ink">Quote-{i + 1}</span>
                          <span className={`text-xs font-semibold tnum ${mg.margin < 0 ? 'text-[#C0283C]' : 'text-brand-700'}`}>Margin {formatCurrency(mg.margin)} ({mg.pct.toFixed(1)}%)</span>
                        </div>
                        <div className="grid gap-2 sm:grid-cols-[1.4fr_1fr_1fr_auto]">
                          <SelectField name={`options.${i}.vendorId`} aria-label="ISP" placeholder="ISP…" options={ispOptions} hint="ISP offered in this quote" />
                          <NumberField name={`options.${i}.slaPct`} aria-label="SLA %" step="0.01" min="90" max="100" placeholder="SLA %" hint="Uptime promise, 90–100 (optional)" />
                          <TextField name={`options.${i}.notes`} aria-label="Notes" placeholder="Notes" hint="Shown to the team only" />
                          <button type="button" aria-label="Remove quote" disabled={values.options.length === 1} onClick={() => arr.remove(i)} className="grid h-9 w-9 place-items-center rounded-full text-muted hover:bg-card disabled:opacity-30"><Trash2 className="h-4 w-4" /></button>
                        </div>
                        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                          <NumberField name={`options.${i}.vendorOtc`} min="0" label="ISP OTC" hint="ISP one-time ₹" />
                          <NumberField name={`options.${i}.vendorMrc`} min="0" label="ISP MRC" hint="ISP monthly ₹" />
                          <NumberField name={`options.${i}.clientOtc`} min="0" label="Client OTC" hint="Client one-time ₹" />
                          <NumberField name={`options.${i}.clientMrc`} min="1" label="Client MRC *" hint="Client monthly ₹, more than 0" />
                          {ip && <NumberField name={`options.${i}.vendorIpMrc`} min="0" className="sm:col-start-2" label="ISP static IP" hint="ISP monthly ₹ for the IPs" />}
                          {ip && <NumberField name={`options.${i}.clientIpMrc`} min="0" className="sm:col-start-4" label="Client static IP" hint="Client monthly ₹ for the IPs" />}
                        </div>
                      </div>
                    );
                  })}
                  {values.options.length < 3 && <Button type="button" size="sm" variant="ghost" onClick={() => arr.push({ vendorId: '', vendorOtc: '', vendorMrc: '', clientOtc: '', clientMrc: '', vendorIpMrc: '', clientIpMrc: values.options[0]?.clientIpMrc ?? '', slaPct: '', notes: '' })}><Plus className="h-3.5 w-3.5" /> Add Quote-{values.options.length + 1}</Button>}
                  <FormError name="options" />
                </>
              )}
            </FieldArray>
          </>
        );
      }}
    </FormikForm>
  );
};

/** Mirrors POST /quotes/:id/bid-win (Joi) */
const bidWinSchema = yup.object({
  optionNo: R.int(1, 3).required(MSG.required),
  finalClientOtc: R.money().required(MSG.required),
  finalClientMrc: R.positiveMoney().required(MSG.required),
  finalClientIpMrc: R.money(),
  contractMonths: R.int(1, 120).required(MSG.required),
  vendorPct: R.pct().required(MSG.required),
  partnerPct: R.pct().required(MSG.required),
  capexPct: totals100('vendorPct', 'partnerPct', 'capexPct')(R.pct().required(MSG.required))
});

const BidWinForm = ({ q, settings }) => {
  const user = useSelector((st) => st.auth.user);
  const o = q.options[0];
  const win = useAction((body) => post(`/quotes/${q.id}/bid-win`, body));
  const label = ownShareLabel(user);
  const ip = needsStaticIp(q);
  const init = {
    optionNo: String(o?.option_no || 1), finalClientOtc: o?.client_otc ?? '', finalClientMrc: o?.client_mrc ?? '', finalClientIpMrc: o?.client_ip_mrc ?? '', contractMonths: q.contract_months,
    vendorPct: settings?.default_vendor_pct ?? 55, partnerPct: settings?.default_partner_pct ?? 25, capexPct: settings?.default_capex_pct ?? 20
  };
  return (
    <FormikForm initialValues={init} schema={bidWinSchema} busy={win.isPending} submitLabel="Confirm Bid Win" onSubmit={(v) => win.mutateAsync(ip ? v : { ...v, finalClientIpMrc: undefined })}>
      {({ values, setValues }) => {
        const monthly = (Number(values.finalClientMrc) || 0) + (ip ? Number(values.finalClientIpMrc) || 0 : 0);
        const value = (Number(values.finalClientOtc) || 0) + monthly * (Number(values.contractMonths) || 0);
        const abc = Number(values.vendorPct || 0) + Number(values.partnerPct || 0) + Number(values.capexPct || 0);
        return (
          <>
            <SelectField name="optionNo" label="Winning quote" hint="The quote the client accepted; its prices are copied below"
              options={q.options.map((x) => ({ value: String(x.option_no), label: `Quote-${x.option_no} · ${x.vendor_name} · MRC ${formatCurrency(x.client_mrc)}` }))}
              onValueChange={(v) => { const n = q.options.find((x) => x.option_no === Number(v)); if (n) setValues({ ...values, optionNo: v, finalClientOtc: n.client_otc, finalClientMrc: n.client_mrc, finalClientIpMrc: n.client_ip_mrc }); }} />
            <div className={`grid gap-3 ${ip ? 'sm:grid-cols-4' : 'sm:grid-cols-3'}`}>
              <NumberField name="finalClientOtc" min="0" label="Final client OTC" hint="Agreed one-time charge ₹" />
              <NumberField name="finalClientMrc" min="1" label="Final client MRC" hint="Agreed monthly charge ₹" />
              {ip && <NumberField name="finalClientIpMrc" min="0" label="Final static IP / month" hint={`${staticIpLabel(q.static_ip_count)}, ₹ per month`} />}
              <NumberField name="contractMonths" min="1" max="120" label="Contract months" hint="1–120" />
            </div>
            <p className="text-sm">Finalized quote value: <b className="tnum">{formatCurrency(value)}</b></p>
            <div className="grid gap-3 sm:grid-cols-3">
              <NumberField name="vendorPct" min="0" max="100" label="A % → Vendor" hint={`${formatCurrency((value * (Number(values.vendorPct) || 0)) / 100)} for the ISP`} />
              <NumberField name="partnerPct" min="0" max="100" label={`B % → ${label}`} hint={`${formatCurrency((value * (Number(values.partnerPct) || 0)) / 100)} kept by the company`} />
              <NumberField name="capexPct" min="0" max="100" label="C % → Site implementation" hint={`${formatCurrency((value * (Number(values.capexPct) || 0)) / 100)} for CPE, cabling, field work`} />
            </div>
            {Math.abs(abc - 100) > 0.01 && <p className="text-xs font-semibold text-[#C0283C]">A + B + C = {abc}% — must be 100%</p>}
            <NextStep>Bid Win locks this value and creates the site in Implementation, waiting for the customer PO.</NextStep>
          </>
        );
      }}
    </FormikForm>
  );
};

const lostSchema = yup.object({ reason: R.reason(1000).required(MSG.required) });

const QuoteDrawer = ({ id, onClose }) => {
  const dispatch = useDispatch();
  const user = useSelector((s) => s.auth.user);
  const { data: q, isLoading, error } = useApi(id ? `/quotes/${id}` : null);
  const send = useAction(() => post(`/quotes/${id}/send`));
  const lost = useAction((body) => post(`/quotes/${id}/lost`, body));
  const can = hasPerm(user, 'commercial.manage');
  const label = ownShareLabel(user);

  return (
    <Drawer open={Boolean(id)} onClose={onClose} label="Quote" width="sm:w-[680px]">
      {isLoading || !q ? (error ? <ErrorBox error={error} /> : <Loading />) : (
        <div>
          <div className="flex flex-wrap items-center gap-2 pr-10"><Code>{q.code}</Code><Status value={q.status} /><span className="text-xs text-muted">from {q.feasibility_code}</span></div>
          <h2 className="mt-2 text-xl font-semibold text-ink">{q.site_name}<LinkTags role={q.link_role} ips={q.static_ip_count} /></h2>
          <p className="text-sm text-muted">{q.customer_name} · {formatMbps(q.bandwidth_mbps)} · {q.contract_months} months{needsStaticIp(q) ? ` · static IP: ${staticIpLabel(q.static_ip_count)}` : ''}</p>
          <div className="mt-3"><Stepper steps={['Quote-1/2/3', 'Sent', 'Bid win', 'Budget']} current={{ DRAFT: 0, SENT: 1, WON: 4, LOST: 1 }[q.status]} /></div>

          {q.status === 'WON' && (
            <>
              <Section title="Finalized quote value & budgeting">
                <KV cols={3} items={[
                  ['Winning quote', `Quote-${q.won_option_no} · ${q.final_vendor_name}`], ['Client OTC / MRC', `${formatCurrency(q.final_client_otc)} / ${formatCurrency(q.final_client_mrc)}${needsStaticIp(q) ? ` + static IP ${formatCurrency(q.final_client_ip_mrc)}` : ''}`], ['Finalized value', <b key="v" className="tnum">{formatCurrency(q.finalized_value)}</b>]
                ]} />
                <div className="mt-4 space-y-3">
                  {[['A → Vendor', q.vendor_pct, q.vendor_amount, q.final_vendor_name], [`B → ${label}`, q.partner_pct, q.partner_amount, 'Kept by the company'], ['C → Site implementation', q.capex_pct, q.capex_amount, 'CPE, cabling, field work']].map(([k, pct, amt, who]) => (
                    <div key={k}>
                      <div className="mb-1 flex justify-between text-sm"><span className="font-medium text-ink">{k} <span className="text-xs text-muted">{who || ''}</span></span><span className="tnum">{pct}% · <b>{formatCurrency(amt)}</b></span></div>
                      <ProgressBar value={pct} />
                    </div>
                  ))}
                </div>
              </Section>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button size="sm" onClick={() => { onClose(); dispatch(openRecord({ module: 'implementation', id: q.site_id })); }}>Open site {q.site_code} <ArrowRight className="h-3.5 w-3.5" /></Button>
                <Site360Button id={q.id} />
              </div>
            </>
          )}
          {q.status === 'LOST' && <div className="mt-4"><NextStep tone="warn">Bid lost — {q.lost_reason}</NextStep></div>}

          <Section title="Quote comparison">
            {['DRAFT', 'SENT'].includes(q.status) && can ? <OptionsEditor key={q.updated_at} q={q} /> : (
              <Table rows={q.options} rowKey="option_no" columns={[
                { key: 'n', label: 'Quote', render: (o) => <b>Quote-{o.option_no}{o.option_no === q.won_option_no ? ' ★' : ''}</b> },
                { key: 'vendor_name', label: 'ISP' },
                { key: 'v', label: 'ISP OTC / MRC', render: (o) => <span className="tnum">{formatCurrency(o.vendor_otc)} / {formatCurrency(o.vendor_mrc)}{needsStaticIp(q) ? ` + IP ${formatCurrency(o.vendor_ip_mrc)}` : ''}</span> },
                { key: 'c', label: 'Client OTC / MRC', render: (o) => <span className="tnum">{formatCurrency(o.client_otc)} / {formatCurrency(o.client_mrc)}{needsStaticIp(q) ? ` + IP ${formatCurrency(o.client_ip_mrc)}` : ''}</span> },
                { key: 'm', label: 'Margin', render: (o) => <span className="tnum">{formatCurrency(o.margin)} ({o.margin_pct}%)</span> }
              ]} />
            )}
          </Section>

          {q.status === 'DRAFT' && can && (
            <div className="mt-4 flex justify-end"><Button disabled={send.isPending || !q.options.length} onClick={() => send.mutate()}><Send className="h-4 w-4" /> Mark as sent to client</Button></div>
          )}
          {q.status === 'SENT' && can && <Section title="Bid win"><BidWinForm key={q.updated_at} q={q} settings={user.settings} /></Section>}
          {['DRAFT', 'SENT'].includes(q.status) && can && (
            <Section title="Bid lost">
              <FormikForm initialValues={{ reason: '' }} schema={lostSchema} busy={lost.isPending} inline submitLabel="Mark as lost"
                onSubmit={(v) => (window.confirm('Mark this bid as lost?') ? lost.mutateAsync(v) : undefined)}>
                <TextField name="reason" aria-label="Lost reason" placeholder="Reason (price, competitor, client dropped…)" hint="At least 3 characters; helps price the next bid" />
              </FormikForm>
            </Section>
          )}
          <Section title="Documents"><DocumentsPanel entityType="QUOTE" entityId={q.id} types={['QUOTE_PDF', 'OTHER']} canEdit={can} /></Section>
          <RecordActivity entityId={q.id} />
        </div>
      )}
    </Drawer>
  );
};

export const CommercialPage = () => {
  const [tab, setTab] = useState('ALL');
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState(null);
  const open = useCallback((id) => setSelected(id), []);
  useFocusRecord('commercial', open);
  const list = useApi('/quotes');
  const rows = useMemo(() => {
    const t = TABS.find((x) => x.id === tab);
    return filterBy((list.data || []).filter((r) => !t.statuses || t.statuses.includes(r.status)), q, ['code', 'site_name', 'customer_name', 'feasibility_code', 'final_vendor_name']);
  }, [list.data, tab, q]);

  return (
    <motion.div variants={page} initial="hidden" animate="visible" exit="exit" className="space-y-4">
      <PageHeader title="Commercial Pricing / Quote" subtitle="Quote-1 · Quote-2 · Quote-3 → Bid win → finalized quote value → budget A % vendor · B % own share · C % site implementation" />
      <div className="flex flex-wrap items-center gap-3">
        <PillTabs value={tab} onChange={setTab} options={TABS.map((t) => ({ id: t.id, label: t.label, count: (list.data || []).filter((r) => !t.statuses || t.statuses.includes(r.status)).length }))} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter…" className={`${inputClass} max-w-[220px]`} aria-label="Filter" />
      </div>
      {list.isLoading ? <Loading /> : list.error ? <ErrorBox error={list.error} /> : (
        <motion.div variants={rise}>
          <Table rows={rows} onRowClick={(r) => setSelected(r.id)} empty="Quotes appear here automatically when a feasibility is marked complete."
            columns={[
              { key: 'code', label: 'Quote', render: (r) => <div className="space-y-1"><Code>{r.code}</Code><p className="text-[10px] text-muted">{r.feasibility_code}</p></div> },
              { key: 'site', label: 'Site / customer', render: (r) => <div><p className="font-semibold text-ink">{r.site_name}<LinkTags role={r.link_role} ips={r.static_ip_count} /></p><p className="text-[11px] text-muted">{r.customer_name}</p></div> },
              { key: 'opts', label: 'Quote-1 / 2 / 3', render: (r) => <span className="text-xs">{r.options.map((o) => `${o.vendor_name} ${formatCurrency(o.client_mrc)}`).join(' · ') || '—'}</span> },
              { key: 'value', label: 'Finalized value', render: (r) => <span className="tnum">{r.finalized_value ? formatCurrency(r.finalized_value) : '—'}</span> },
              { key: 'status', label: 'Status', render: (r) => <Status value={r.status} /> },
              { key: 'd', label: 'Created', render: (r) => <span className="text-xs">{formatDate(r.created_at)}</span> }
            ]} />
        </motion.div>
      )}
      <QuoteDrawer id={selected} onClose={() => setSelected(null)} />
    </motion.div>
  );
};

export default CommercialPage;
