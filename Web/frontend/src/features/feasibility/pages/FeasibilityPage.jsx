import React, { useCallback, useMemo, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { motion } from 'framer-motion';
import { Plus, MapPin, MessageSquare, Trash2, ExternalLink, OctagonX, CheckCircle2, ArrowRight, Pencil } from 'lucide-react';
import { page, rise } from '../../../utils/motion';
import { Button, Status } from '../../../components/common/ui';
import PageHeader from '../../../components/common/PageHeader';
import PillTabs from '../../../components/common/PillTabs';
import { FieldArray } from 'formik';
import { Drawer, inputClass } from '../../../components/common/Overlay';
import { Table, Loading, ErrorBox, KV, Section, NextStep, Stepper, DocumentsPanel } from '../../../components/common/kit';
import { FormikForm, TextField, NumberField, SelectField, CheckboxField, FormError } from '../../../components/form/FormKit';
import { R, MSG, yup } from '../../../validation/rules';
import { useApi, useAction } from '../../../api/hooks';
import { post, put } from '../../../api/client';
import { hasPerm } from '../../../store/slices/authSlice';
import { openRecord } from '../../../store/slices/uiSlice';
import { formatCurrency, formatMbps, formatDate, formatDateTime } from '../../../utils/formatters';
import NewIspModal from '../../admin/NewIspModal';
import { useFocusRecord, RecordActivity, Site360Button, Code, filterBy, LinkTags, staticIpLabel, needsStaticIp, mediumLabel } from '../../shared';

const TABS = [
  { id: 'ALL', label: 'All', statuses: null },
  { id: 'NEW', label: 'To assign', statuses: ['NEW'] },
  { id: 'SURVEY', label: 'In survey', statuses: ['ASSIGNED'] },
  { id: 'PRICE', label: 'Pricing', statuses: ['SURVEY_DONE', 'PRICE_FINALIZED'] },
  { id: 'DONE', label: 'Complete', statuses: ['COMPLETED'] },
  { id: 'STOP', label: 'Stopped', statuses: ['NOT_FEASIBLE', 'CANCELLED'] }
];
const STEPS = ['Logged', 'Assigned', 'Feasible ISPs', 'Price finalized', 'Complete'];
const STEP_OF = { NEW: 0, ASSIGNED: 1, SURVEY_DONE: 2, PRICE_FINALIZED: 3, COMPLETED: 4, NOT_FEASIBLE: 2, CANCELLED: 1 };
const mapsLink = (f) => f.maps_url || (f.latitude ? `https://www.google.com/maps?q=${f.latitude},${f.longitude}` : null);

/* ---------------------------- SURVEY (ISP OPTIONS) ---------------------------- */
const blankOption = (medium) => ({ vendorId: '', isFeasible: true, medium: medium || '', distanceM: '', vendorOtc: '', vendorMrc: '', vendorIpMrc: '', leadTimeDays: '', remarks: '' });

/** Mirrors PUT /feasibility/:id/survey (Joi) */
const surveySchema = yup.object({
  nearestPopM: R.int(0, 1e6),
  surveyNotes: R.text(5000),
  options: yup.array().of(yup.object({
    vendorId: yup.string().required('Choose the ISP'),
    isFeasible: yup.boolean(),
    medium: R.text(16),
    distanceM: R.int(0, 1e6),
    vendorOtc: R.money(),
    vendorMrc: R.money().when('isFeasible', { is: true, then: (x) => x.moreThan(0, 'Enter the ISP monthly charge').required('Enter the ISP monthly charge') }),
    vendorIpMrc: R.money(),
    leadTimeDays: R.int(0, 3650),
    remarks: R.text(1000).when('isFeasible', { is: false, then: (x) => x.min(3, 'Say why it is not feasible').required('Say why it is not feasible') })
  })).min(1, 'Add at least one ISP').max(12, 'At most 12 ISPs')
    .test('unique', 'Each ISP can be listed only once', (rows) => !rows || new Set(rows.map((r) => r.vendorId).filter(Boolean)).size === rows.filter((r) => r.vendorId).length)
});

const SurveyForm = ({ f, onSaved }) => {
  const vendors = useApi('/admin/vendors', { type: 'ISP' });
  const save = useAction((body) => put(`/feasibility/${f.id}/survey`, body), { onSuccess: onSaved });
  const [newIsp, setNewIsp] = useState(false);
  const rows = useRef(null); // the survey's ISP rows, so a newly added ISP can be picked in the form
  // Put the new ISP in the first row without an ISP, or in a new row
  const pickNewIsp = (v) => {
    const h = rows.current;
    if (!h) return;
    const empty = h.values.options.findIndex((o) => !o.vendorId);
    if (empty >= 0) h.arr.replace(empty, { ...h.values.options[empty], vendorId: v.id });
    else h.arr.push({ ...blankOption(f.medium), vendorId: v.id });
  };
  const init = {
    nearestPopM: f.nearest_pop_m ?? '',
    surveyNotes: f.survey_notes || '',
    options: f.options?.length
      ? f.options.map((o) => ({ vendorId: o.vendor_id, isFeasible: o.is_feasible, medium: o.medium || '', distanceM: o.distance_m ?? '', vendorOtc: o.vendor_otc, vendorMrc: o.vendor_mrc, vendorIpMrc: o.vendor_ip_mrc || '', leadTimeDays: o.lead_time_days ?? '', remarks: o.remarks || '' }))
      : [blankOption(f.medium)]
  };
  const ispOptions = (vendors.data || []).filter((v) => v.is_active).map((v) => ({ value: v.id, label: v.name }));
  const ip = needsStaticIp(f);
  return (
    <>
    {/* Outside the survey form: a submit inside a portal would otherwise bubble up to the survey form */}
    <NewIspModal open={newIsp} onClose={() => setNewIsp(false)} onCreated={pickNewIsp} />
    <FormikForm initialValues={init} schema={surveySchema} busy={save.isPending} submitLabel="Save survey"
      onSubmit={(v) => save.mutateAsync({ ...v, options: v.options.map((o) => ({ ...o, vendorOtc: o.vendorOtc ?? 0, vendorMrc: o.vendorMrc ?? 0, vendorIpMrc: ip ? o.vendorIpMrc ?? 0 : 0 })) })}>
      {({ values }) => (
        <>
          {ip && <NextStep>The client needs <b>static IP: {staticIpLabel(f.static_ip_count)}</b>. Enter each ISP's monthly static IP charge (0 if included).</NextStep>}
          {vendors.data && vendors.data.length === 0 && <NextStep tone="warn">No ISPs in ISPs & Vendors yet. Use <b>New ISP</b> below to add the ones you checked.</NextStep>}
          <FieldArray name="options">
            {(arr) => {
              rows.current = { arr, values };
              return (
              <div className="space-y-2">
                {values.options.map((r, i) => (
                  <div key={i} className={`rounded-xl border p-2.5 ${r.isFeasible ? 'border-line bg-panel' : 'border-dashed border-[#E0566A]/50 bg-[#FDF0F1]/40'}`}>
                    <div className="grid gap-2 sm:grid-cols-[1.4fr_auto_1fr_1fr_auto]">
                      <SelectField name={`options.${i}.vendorId`} aria-label="ISP" placeholder="ISP…" options={ispOptions} hint="ISP you checked" />
                      <CheckboxField name={`options.${i}.isFeasible`} label="Feasible" className="sm:pt-2" />
                      <NumberField name={`options.${i}.vendorOtc`} aria-label="OTC" min="0" placeholder="ISP OTC ₹" disabled={!r.isFeasible} hint="One-time charge" />
                      <NumberField name={`options.${i}.vendorMrc`} aria-label="MRC" min="0" placeholder="ISP MRC ₹/month" disabled={!r.isFeasible} hint="Monthly charge" />
                      <button type="button" aria-label="Remove ISP" onClick={() => arr.remove(i)} className="grid h-9 w-9 place-items-center rounded-full text-muted hover:bg-card"><Trash2 className="h-4 w-4" /></button>
                    </div>
                    <div className={`mt-2 grid gap-2 ${ip ? 'sm:grid-cols-4' : 'sm:grid-cols-3'}`}>
                      {ip && <NumberField name={`options.${i}.vendorIpMrc`} aria-label="Static IP charge" min="0" placeholder="Static IP ₹/month" disabled={!r.isFeasible} hint="ISP static IP charge per month" />}
                      <NumberField name={`options.${i}.distanceM`} aria-label="Distance" min="0" placeholder="Distance from POP (m)" hint="Metres from their POP" />
                      <NumberField name={`options.${i}.leadTimeDays`} aria-label="Lead time" min="0" placeholder="Lead time (days)" hint="Days they need to deliver" />
                      <TextField name={`options.${i}.remarks`} aria-label="Remarks" placeholder={r.isFeasible ? 'Remarks' : 'Why not feasible?'} hint={r.isFeasible ? 'Optional' : 'Required when not feasible'} />
                    </div>
                  </div>
                ))}
                <div className="flex flex-wrap items-center gap-2">
                  <Button type="button" size="sm" variant="ghost" onClick={() => arr.push(blankOption(f.medium))}><Plus className="h-3.5 w-3.5" /> Add ISP</Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => setNewIsp(true)}><Plus className="h-3.5 w-3.5" /> New ISP (not in the list)</Button>
                </div>
                <FormError name="options" />
              </div>
              );
            }}
          </FieldArray>
          <div className="grid gap-3 sm:grid-cols-[180px_1fr]">
            <NumberField name="nearestPopM" min="0" label="Nearest POP (m)" hint="Closest ISP point, in metres" />
            <TextField name="surveyNotes" label="Survey notes" placeholder="LOS, ROW, rack, power…" hint="Anything commercial or delivery should know" />
          </div>
        </>
      )}
    </FormikForm>
    </>
  );
};

/** A recorded survey stays read-only (the ISP list above) until "Edit survey" is clicked */
const EditSurvey = ({ f }) => {
  const [open, setOpen] = useState(false);
  return (
    <Section title="Edit survey">
      {open ? (
        <>
          <SurveyForm key={f.updated_at} f={f} onSaved={() => setOpen(false)} />
          <div className="mt-2"><Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>Close without saving</Button></div>
        </>
      ) : <Button size="sm" variant="outline" onClick={() => setOpen(true)}><Pencil className="h-3.5 w-3.5" /> Edit survey</Button>}
    </Section>
  );
};

/* ------------------------------ FINALIZE PRICE ------------------------------ */
const priceSchema = yup.object({
  selectedOptionId: yup.string().required('Choose the ISP to use'),
  clientOtc: R.money().required(MSG.required),
  clientMrc: R.positiveMoney().required(MSG.required),
  clientIpMrc: R.money()
});

const PriceForm = ({ f }) => {
  const feasible = f.options.filter((o) => o.is_feasible);
  const save = useAction((body) => post(`/feasibility/${f.id}/finalize-price`, body));
  if (!feasible.length) return <NextStep tone="warn">No ISP was feasible. Use STOP below to close this request as not feasible.</NextStep>;
  return (
    <FormikForm initialValues={{ selectedOptionId: f.selected_option_id || feasible[0]?.id || '', clientOtc: f.final_client_otc ?? '', clientMrc: f.final_client_mrc ?? '', clientIpMrc: f.final_client_ip_mrc ?? '' }}
      schema={priceSchema} busy={save.isPending} submitLabel="Finalize price" onSubmit={(v) => save.mutateAsync(v)}>
      {({ values, setFieldValue }) => {
        const opt = feasible.find((o) => o.id === values.selectedOptionId);
        const margin = opt && values.clientMrc !== '' ? Number(values.clientMrc) - opt.vendor_mrc : null;
        const ip = needsStaticIp(f);
        const ipMargin = opt && ip && values.clientIpMrc !== '' ? Number(values.clientIpMrc) - Number(opt.vendor_ip_mrc) : null;
        return (
          <>
            <div className="space-y-1.5" role="radiogroup" aria-label="ISP to use">
              {feasible.map((o) => (
                <label key={o.id} className={`flex cursor-pointer items-center justify-between gap-3 rounded-xl border px-3 py-2 text-sm ${values.selectedOptionId === o.id ? 'border-brand-600 bg-brand-50' : 'border-line bg-card'}`}>
                  <span className="flex items-center gap-2"><input type="radio" name="selectedOptionId" checked={values.selectedOptionId === o.id} onChange={() => setFieldValue('selectedOptionId', o.id)} /> <b>{o.vendor_name}</b> <span className="text-xs text-muted">{o.distance_m ? `${o.distance_m} m` : ''}</span></span>
                  <span className="text-xs tnum">ISP OTC {formatCurrency(o.vendor_otc)} · MRC {formatCurrency(o.vendor_mrc)}{ip ? ` · static IP ${formatCurrency(o.vendor_ip_mrc)}` : ''}</span>
                </label>
              ))}
              <FormError name="selectedOptionId" />
            </div>
            <div className={`grid gap-3 ${ip ? 'sm:grid-cols-3' : 'sm:grid-cols-2'}`}>
              <NumberField name="clientOtc" min="0" label="Client OTC (one-time) ₹" hint="One-time charge the client pays (0 if none)" />
              <NumberField name="clientMrc" min="1" label="Client MRC (monthly) ₹"
                hint={margin !== null ? `Monthly margin ${formatCurrency(margin)}${margin < 0 ? ' — below ISP cost!' : ''}` : 'Monthly charge the client pays'} />
              {ip && <NumberField name="clientIpMrc" min="0" label="Client static IP (monthly) ₹"
                hint={ipMargin !== null ? `Static IP margin ${formatCurrency(ipMargin)}${ipMargin < 0 ? ' — below ISP cost!' : ''}` : `${staticIpLabel(f.static_ip_count)}; billed each cycle as its own line`} />}
            </div>
          </>
        );
      }}
    </FormikForm>
  );
};

/* ---------------------------------- DRAWER ---------------------------------- */
const assignSchema = yup.object({ assignedTo: yup.string().required('Choose a field engineer') });
const stopSchema = yup.object({ outcome: R.select(['NOT_FEASIBLE', 'CANCELLED']).required(MSG.required), reason: R.reason(1000).required(MSG.required) });
const FeasibilityDrawer = ({ id, onClose }) => {
  const dispatch = useDispatch();
  const user = useSelector((s) => s.auth.user);
  const { data: f, isLoading, error } = useApi(id ? `/feasibility/${id}` : null);
  const surveyors = useApi(id && hasPerm(user, 'feasibility.assign') ? '/admin/users/lookup' : null, { role: 'FIELD_ENGINEER,OPERATIONS' });
  const assign = useAction((body) => post(`/feasibility/${id}/assign`, body));
  const complete = useAction(() => post(`/feasibility/${id}/complete`));
  const doStop = useAction((body) => post(`/feasibility/${id}/stop`, body));

  const canSurvey = f && hasPerm(user, 'feasibility.survey') && (user.role !== 'FIELD_ENGINEER' || f.assigned_to === user.id);
  const open = f && ['NEW', 'ASSIGNED', 'SURVEY_DONE', 'PRICE_FINALIZED'].includes(f.status);

  return (
    <Drawer open={Boolean(id)} onClose={onClose} label="Feasibility request" width="sm:w-[640px]">
      {isLoading || !f ? (error ? <ErrorBox error={error} /> : <Loading />) : (
        <div>
          <div className="flex flex-wrap items-center gap-2 pr-10"><Code>{f.code}</Code><Status value={f.status} /></div>
          <h2 className="mt-2 text-xl font-semibold text-ink">{f.site_name}<LinkTags role={f.link_role} ips={f.static_ip_count} /></h2>
          <p className="text-sm text-muted">{f.customer_name} · {formatMbps(f.bandwidth_mbps)} {mediumLabel(f.medium)}{f.client_site_ref ? ` · client site ${f.client_site_ref}` : ''}</p>
          <div className="mt-3"><Stepper steps={STEPS} current={f.status === 'COMPLETED' ? 5 : STEP_OF[f.status]} /></div>

          {f.status === 'COMPLETED' && (
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <NextStep>Feasibility complete. Quote <b>{f.quote_code}</b> is in Commercial ({f.quote_status?.toLowerCase()}).</NextStep>
              <Button size="sm" onClick={() => { onClose(); dispatch(openRecord({ module: 'commercial', id: f.quote_id })); }}>Open quote <ArrowRight className="h-3.5 w-3.5" /></Button>
              <Site360Button id={f.id} />
            </div>
          )}
          {['NOT_FEASIBLE', 'CANCELLED'].includes(f.status) && <div className="mt-4"><NextStep tone="warn"><b>STOP</b> — {f.stop_reason}</NextStep></div>}

          <Section title="Request">
            <KV items={[
              ['Address', <span key="a">{f.address}{f.pincode ? ` – ${f.pincode}` : ''}</span>],
              ['Location', mapsLink(f) ? <a key="m" href={mapsLink(f)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-brand-700 hover:underline"><MapPin className="h-3.5 w-3.5" />{f.latitude ? `${Number(f.latitude).toFixed(5)}, ${Number(f.longitude).toFixed(5)}` : 'Open map'} <ExternalLink className="h-3 w-3" /></a> : 'Not given'],
              ['Client order', f.order_code ? <button key="o" type="button" className="font-semibold text-brand-700 hover:underline" onClick={() => { onClose(); dispatch(openRecord({ module: 'orders', id: f.order_id })); }}>{f.order_code}{f.order_client_ref ? ` · ${f.order_client_ref}` : ''}</button> : 'Single request'],
              ["Client's site ID", f.client_site_ref || '—'],
              ['Link type', f.link_role === 'SECONDARY' ? 'Secondary (backup) link' : 'Primary link'], ['Static IP', staticIpLabel(f.static_ip_count)],
              ['Source', f.source_channel], ['Requested by', [f.requester_name, f.requester_phone].filter(Boolean).join(' · ') || '—'],
              ['Contact at site', [f.site_contact_name, f.site_contact_phone].filter(Boolean).join(' · ') || '—'],
              ['Logged by', `${f.created_by_name || '—'} · ${formatDateTime(f.created_at)}`], ['Owner (field engineer)', f.assigned_name || 'Not assigned']
            ]} />
            {f.raw_message && <p className="mt-3 flex gap-2 rounded-xl bg-panel p-3 text-xs italic text-ink-2"><MessageSquare className="h-4 w-4 shrink-0 text-brand-600" />{f.raw_message}</p>}
          </Section>
          <Section title="Documents"><DocumentsPanel entityType="FEASIBILITY" entityId={f.id} types={['SURVEY_PHOTO', 'OTHER']} canEdit={hasPerm(user, 'feasibility.survey') || hasPerm(user, 'feasibility.create')} /></Section>

          {open && f.status !== 'PRICE_FINALIZED' && hasPerm(user, 'feasibility.assign') && (
            <Section title={f.assigned_to ? 'Re-assign field engineer' : 'Assign field engineer'}>
              <FormikForm key={f.updated_at} initialValues={{ assignedTo: '' }} schema={assignSchema} busy={assign.isPending} inline submitLabel="Assign"
                onSubmit={(v) => assign.mutateAsync(v)}>
                <SelectField name="assignedTo" aria-label="Field engineer" placeholder="Select field engineer…" hint="They survey this site and, after Bid Win, deliver it"
                  options={(surveyors.data || []).map((u) => ({ value: u.id, label: `${u.name}${u.zone ? ` · ${u.zone}` : ''}` }))} />
              </FormikForm>
            </Section>
          )}

          {['SURVEY_DONE', 'PRICE_FINALIZED', 'COMPLETED', 'NOT_FEASIBLE'].includes(f.status) && f.options?.length > 0 && (
            <Section title={`Feasible ISPs (${f.feasible_count}/${f.option_count})`}>
              <div className="overflow-hidden rounded-xl border border-line">
                {f.options.map((o) => (
                  <div key={o.id} className={`flex items-center justify-between gap-3 border-b border-line px-3 py-2 text-sm last:border-0 ${o.id === f.selected_option_id ? 'bg-brand-50' : ''}`}>
                    <span className="flex items-center gap-2">{o.is_feasible ? <CheckCircle2 className="h-4 w-4 text-brand-600" /> : <OctagonX className="h-4 w-4 text-[#C0283C]" />}<b>{o.vendor_name}</b>{o.id === f.selected_option_id && <span className="text-[10px] font-semibold uppercase text-brand-700">selected</span>}</span>
                    <span className="text-xs text-muted tnum">{o.is_feasible ? `OTC ${formatCurrency(o.vendor_otc)} · MRC ${formatCurrency(o.vendor_mrc)}${needsStaticIp(f) ? ` · IP ${formatCurrency(o.vendor_ip_mrc)}` : ''}${o.distance_m ? ` · ${o.distance_m} m` : ''}` : o.remarks || 'Not feasible'}</span>
                  </div>
                ))}
              </div>
              {f.final_client_mrc && <p className="mt-2 text-sm">Finalized client price: <b className="tnum">OTC {formatCurrency(f.final_client_otc)} · MRC {formatCurrency(f.final_client_mrc)}{needsStaticIp(f) ? ` · static IP ${formatCurrency(f.final_client_ip_mrc)}/month` : ''}</b></p>}
            </Section>
          )}

          {['ASSIGNED', 'SURVEY_DONE'].includes(f.status) && canSurvey && (
            f.status === 'ASSIGNED'
              ? <Section title="Record survey — feasible ISPs & price"><SurveyForm key={f.updated_at} f={f} /></Section>
              : <EditSurvey key={f.id} f={f} />
          )}
          {f.status === 'ASSIGNED' && !canSurvey && <div className="mt-4"><NextStep>Waiting for {f.assigned_name} to record the survey.</NextStep></div>}
          {f.status === 'NEW' && !hasPerm(user, 'feasibility.assign') && <div className="mt-4"><NextStep>Waiting to be assigned to a field engineer.</NextStep></div>}

          {['SURVEY_DONE', 'PRICE_FINALIZED'].includes(f.status) && hasPerm(user, 'feasibility.finalize') && (
            <Section title="Price → finalized price"><PriceForm key={f.updated_at} f={f} /></Section>
          )}

          {f.status === 'PRICE_FINALIZED' && hasPerm(user, 'feasibility.finalize') && (
            <Section title="Feasibility complete">
              <NextStep>Completing locks this feasibility and creates the quote (Quote-1/2/3 pre-filled from the feasible ISPs) in Commercial.</NextStep>
              <div className="mt-2 flex justify-end"><Button disabled={complete.isPending} onClick={() => complete.mutate()}><CheckCircle2 className="h-4 w-4" /> Mark feasibility complete</Button></div>
            </Section>
          )}

          {open && (hasPerm(user, 'feasibility.finalize') || hasPerm(user, 'feasibility.assign')) && (
            <Section title="Stop">
              <FormikForm initialValues={{ outcome: 'NOT_FEASIBLE', reason: '' }} schema={stopSchema} busy={doStop.isPending} inline submitLabel="Stop"
                onSubmit={(v) => (window.confirm('Stop this request? It cannot continue afterwards.') ? doStop.mutateAsync(v) : undefined)}>
                <div className="grid gap-2 sm:grid-cols-[170px_1fr]">
                  <SelectField name="outcome" aria-label="Outcome" hint="Not feasible = no ISP can serve it" options={[{ value: 'NOT_FEASIBLE', label: 'Not feasible' }, { value: 'CANCELLED', label: 'Cancelled' }]} />
                  <TextField name="reason" aria-label="Reason" placeholder="Reason (required)" hint="At least 3 characters; shown on the order and to the client team" />
                </div>
              </FormikForm>
            </Section>
          )}

          <RecordActivity entityId={f.id} />
        </div>
      )}
    </Drawer>
  );
};

/* ----------------------------------- PAGE ----------------------------------- */
export const FeasibilityPage = () => {
  const user = useSelector((s) => s.auth.user);
  const dispatch = useDispatch();
  const isSurveyor = user.role === 'FIELD_ENGINEER';
  const [tab, setTab] = useState('ALL');
  const [mine, setMine] = useState(isSurveyor);
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState(null);
  const open = useCallback((id) => setSelected(id), []);
  useFocusRecord('feasibility', open);
  const list = useApi('/feasibility', mine ? { mine: '1' } : undefined);

  const rows = useMemo(() => {
    const t = TABS.find((x) => x.id === tab);
    const base = (list.data || []).filter((r) => !t.statuses || t.statuses.includes(r.status));
    return filterBy(base, q, ['code', 'site_name', 'customer_name', 'address', 'assigned_name', 'pincode', 'client_site_ref', 'order_code']);
  }, [list.data, tab, q]);

  return (
    <motion.div variants={page} initial="hidden" animate="visible" exit="exit" className="space-y-4">
      <PageHeader title="Feasibility Tracker" subtitle="Client order (WhatsApp / email) → field engineer → feasible ISPs → price → finalized price → complete (or STOP)"
        actions={(
          <div className="flex flex-wrap gap-2">
            {hasPerm(user, 'orders.create') && <Button onClick={() => dispatch(openRecord({ module: 'orders', id: 'new' }))}><Plus className="h-4 w-4" /> New client order</Button>}
          </div>
        )} />
      <div className="flex flex-wrap items-center gap-3">
        <PillTabs value={tab} onChange={setTab} options={TABS.map((t) => ({ id: t.id, label: t.label, count: (list.data || []).filter((r) => !t.statuses || t.statuses.includes(r.status)).length }))} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter…" className={`${inputClass} max-w-[220px]`} aria-label="Filter" />
        <label className="flex items-center gap-1.5 text-xs font-medium text-ink-2"><input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} /> Only mine</label>
      </div>
      {list.isLoading ? <Loading /> : list.error ? <ErrorBox error={list.error} /> : (
        <motion.div variants={rise}>
          <Table rows={rows} onRowClick={(r) => setSelected(r.id)}
            empty={mine ? 'Nothing of yours here. Log a client order to start.' : 'No feasibility requests yet — log the first client order with “New client order”.'}
            columns={[
              { key: 'code', label: 'Code', render: (r) => <Code>{r.code}</Code> },
              { key: 'site', label: 'Site / client', render: (r) => <div><p className="font-semibold text-ink">{r.site_name}{r.client_site_ref && <span className="ml-1.5 text-[11px] font-medium text-muted">[{r.client_site_ref}]</span>}<LinkTags role={r.link_role} ips={r.static_ip_count} /></p><p className="text-[11px] text-muted">{r.customer_name} · {formatMbps(r.bandwidth_mbps)}</p></div> },
              { key: 'src', label: 'Order', render: (r) => <span className="whitespace-nowrap text-xs">{r.order_code || r.source_channel}</span> },
              { key: 'assigned_name', label: 'Owner', render: (r) => r.assigned_name || <span className="text-[#B26B00]">Unassigned</span> },
              { key: 'isps', label: 'Feasible ISPs', render: (r) => <span className="text-xs">{r.feasible_isps || '—'}</span> },
              { key: 'price', label: 'Final MRC', render: (r) => <span className="tnum">{r.final_client_mrc ? formatCurrency(r.final_client_mrc) : '—'}</span> },
              { key: 'status', label: 'Status', render: (r) => <Status value={r.status} /> },
              { key: 'created_at', label: 'Logged', render: (r) => <span className="text-xs">{formatDate(r.created_at)}</span> }
            ]} />
        </motion.div>
      )}
      <FeasibilityDrawer id={selected} onClose={() => setSelected(null)} />
    </motion.div>
  );
};

export default FeasibilityPage;
