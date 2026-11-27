import React, { useCallback, useMemo, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { motion } from 'framer-motion';
import { CheckCircle2, ArrowRight, Radio, FileStack } from 'lucide-react';
import { page, rise } from '../../../utils/motion';
import { Button, Status } from '../../../components/common/ui';
import PageHeader from '../../../components/common/PageHeader';
import PillTabs from '../../../components/common/PillTabs';
import { Drawer, Modal, inputClass } from '../../../components/common/Overlay';
import { Table, Loading, ErrorBox, KV, Section, NextStep, Stepper, DocumentsPanel, EmptyState } from '../../../components/common/kit';
import { FormikForm, TextField, NumberField, DateField, SelectField, CheckboxField, FormError } from '../../../components/form/FormKit';
import { R, MSG, yup } from '../../../validation/rules';
import { useApi, useAction } from '../../../api/hooks';
import { post } from '../../../api/client';
import { hasPerm } from '../../../store/slices/authSlice';
import { setActiveTab, openRecord } from '../../../store/slices/uiSlice';
import { formatCurrency, formatMbps, formatDate, formatDateTime, todayIso } from '../../../utils/formatters';
import { useFocusRecord, RecordActivity, Site360Button, Code, filterBy, LinkTags, staticIpLabel, needsStaticIp, mediumLabel } from '../../shared';
import { shortName } from '../../../utils/names';

const TABS = [
  { id: 'ALL', label: 'All', statuses: null },
  { id: 'AWAITING_PO', label: 'Awaiting PO', statuses: ['AWAITING_PO'] },
  { id: 'PO_RECEIVED', label: 'PO received', statuses: ['PO_RECEIVED'] },
  { id: 'WORK', label: 'ISP work', statuses: ['WORK_STARTED'] },
  { id: 'BLOCKED', label: 'Pending with…', statuses: ['BLOCKED'] },
  { id: 'LIVE', label: 'Live', statuses: ['LIVE'] },
  { id: 'TERMINATED', label: 'Disconnected', statuses: ['TERMINATED'] }
];
const STEP = { AWAITING_PO: 0, PO_RECEIVED: 1, WORK_STARTED: 2, BLOCKED: 2, LIVE: 4, TERMINATED: 4 };
const DELIVERY_ROLES = { role: 'FIELD_ENGINEER,OPERATIONS,TENANT_ADMIN' };

/** "Pending with …" parties. The client and our own company are shown by their names. */
export const usePartyLabels = () => {
  const user = useSelector((st) => st.auth.user);
  const s = user?.settings;
  return (clientName) => ({
    CLIENT: clientName ? `${clientName} (client)` : 'Client',
    VENDOR: 'ISP / Vendor',
    COMPANY: `${shortName(user?.tenant_name) || 'Our company'} (internal)`,
    CUSTOMER: 'Customer at site',
    AUTHORITY: s?.authority_label || 'ROW / Authority',
    OTHER: 'Other'
  });
};
const shortClient = shortName;

/** Managers act on every site; a field engineer only on the sites they own */
const useSiteRights = (s) => {
  const user = useSelector((st) => st.auth.user);
  const manage = hasPerm(user, 'implementation.manage');
  const deliver = manage || (hasPerm(user, 'implementation.execute') && s?.owner_id === user.id);
  return { manage, deliver, user };
};

/** A date field that must not be before another date (e.g. work start ≥ PO date) */
const notBefore = (schema, min, msg) => (min ? schema.test('notBefore', msg, (v) => !v || v >= String(min).slice(0, 10)) : schema);

const poSchema = yup.object({
  poNumber: R.text(64).required(MSG.required),
  poDate: R.pastDate().required(MSG.required),
  poValue: R.positiveMoney().required(MSG.required)
});

const PoForm = ({ s }) => {
  const save = useAction((b) => post(`/sites/${s.id}/po`, b));
  return (
    <FormikForm initialValues={{ poNumber: s.po_number || '', poDate: s.po_date || todayIso(), poValue: s.po_value || Math.round(s.client_otc + (s.client_mrc + (s.client_ip_mrc || 0)) * s.contract_months) }}
      schema={poSchema} busy={save.isPending} submitLabel={s.po_number ? 'Update PO' : 'Record PO received'} onSubmit={(v) => save.mutateAsync(v)}>
      <div className="grid gap-3 sm:grid-cols-3">
        <TextField name="poNumber" label="Client PO number *" hint="Exactly as on the client's PO; printed on bills" />
        <DateField name="poDate" max={todayIso()} label="PO date *" hint="Date on the PO; not in the future" />
        <NumberField name="poValue" min="1" label="PO value ₹ *" hint="Total value on the PO for this site" />
      </div>
      <p className="text-[11px] text-muted">One PO for several sites of {s.customer_name}? Use <b>One PO for several sites</b> on the Implementation page.</p>
    </FormikForm>
  );
};

/** Mirrors POST /sites/po-bulk (Joi) */
const bulkSchema = yup.object({
  client: yup.string().required('Choose the client'),
  poNumber: R.text(64).required(MSG.required),
  poDate: R.pastDate().required(MSG.required),
  items: yup.array().of(yup.object({
    on: yup.boolean(),
    poValue: R.number().when('on', { is: true, then: (x) => x.moreThan(0, 'Must be more than 0').required(MSG.required) })
  })).test('one', 'Tick at least one site', (arr) => (arr || []).some((i) => i.on))
});

/** One client PO covering many sites (e.g. one PO for 5 sites) */
const BulkPoModal = ({ open, onClose, sites }) => {
  const pending = sites.filter((x) => ['AWAITING_PO', 'PO_RECEIVED'].includes(x.status));
  const clients = [...new Map(pending.map((x) => [x.customer_id, x.customer_name])).entries()];
  const save = useAction((b) => post('/sites/po-bulk', b), { onSuccess: onClose });
  const defaultValue = (x) => Math.round(x.finalized_value || x.client_otc + (x.client_mrc + (x.client_ip_mrc || 0)) * x.contract_months);
  return (
    <Modal open={open} onClose={onClose} title="One PO for several sites" width="max-w-[720px]">
      {pending.length === 0 ? <EmptyState title="No site is waiting for a PO" hint="Sites appear here after Bid Win." /> : (
        <FormikForm initialValues={{ client: '', poNumber: '', poDate: todayIso(), items: [] }} schema={bulkSchema} busy={save.isPending}
          submitLabel="Record PO"
          onSubmit={(v) => {
            const rows = pending.filter((x) => x.customer_id === v.client);
            return save.mutateAsync({ poNumber: v.poNumber, poDate: v.poDate, items: v.items.map((it, i) => ({ ...it, siteId: rows[i].id })).filter((it) => it.on).map((it) => ({ siteId: it.siteId, poValue: it.poValue })) });
          }}>
          {({ values, setValues }) => {
            const rows = pending.filter((x) => x.customer_id === values.client);
            const total = values.items.reduce((t, it) => t + (it.on ? Number(it.poValue) || 0 : 0), 0);
            const count = values.items.filter((it) => it.on).length;
            return (
              <>
                <div className="grid gap-3 sm:grid-cols-3">
                  <SelectField name="client" label="Client *" hint="Only sites of one client can share a PO" placeholder="Select client…"
                    options={clients.map(([id, name]) => ({ value: id, label: name }))}
                    onValueChange={(id) => setValues({ ...values, client: id, items: pending.filter((x) => x.customer_id === id).map((x) => ({ on: false, poValue: defaultValue(x) })) })} />
                  <TextField name="poNumber" label="Client PO number *" hint="Exactly as on the client's PO" />
                  <DateField name="poDate" max={todayIso()} label="PO date *" hint="Not in the future" />
                </div>
                {values.client && (
                  <div className="overflow-hidden rounded-xl border border-line">
                    {rows.map((x, i) => {
                      const on = values.items[i]?.on;
                      return (
                        <div key={x.id} className={`grid items-start gap-2 border-b border-line px-3 py-2 text-sm last:border-0 sm:grid-cols-[auto_1fr_170px] ${on ? 'bg-brand-50' : ''}`}>
                          <CheckboxField name={`items.${i}.on`} label={<span className="sr-only">{`Include ${x.site_name}`}</span>} className="pt-2" />
                          <span className="pt-1.5"><b>{x.site_name}</b> <span className="text-xs text-muted">{x.code}{x.client_site_ref ? ` · ${x.client_site_ref}` : ''}{x.po_number ? ` · current PO ${x.po_number}` : ''}</span></span>
                          <NumberField name={`items.${i}.poValue`} aria-label={`PO value for ${x.site_name}`} min="1" disabled={!on} hint="Value for this site ₹" />
                        </div>
                      );
                    })}
                  </div>
                )}
                <FormError name="items" />
                {count > 0 && <p className="text-right text-sm">{count} site(s) · PO total <b className="tnum">{formatCurrency(total)}</b></p>}
              </>
            );
          }}
        </FormikForm>
      )}
    </Modal>
  );
};

const WorkStartForm = ({ s, defaultSla, manage }) => {
  const owners = useApi(manage ? '/admin/users/lookup' : null, DELIVERY_ROLES);
  const save = useAction((b) => post(`/sites/${s.id}/work-start`, b));
  const schema = yup.object({
    workOrderNo: R.text(64).required(MSG.required),
    workStartDate: notBefore(R.pastDate().required(MSG.required), s.po_date, 'Cannot be before the PO date'),
    slaDays: R.int(1, 365).required(MSG.required),
    ownerId: yup.string()
  });
  return (
    <FormikForm initialValues={{ workOrderNo: '', workStartDate: todayIso(), slaDays: defaultSla || 30, ownerId: s.owner_id || '' }} schema={schema}
      busy={save.isPending} submitLabel="Start ISP work" onSubmit={(v) => save.mutateAsync({ ...v, ownerId: manage ? v.ownerId || null : null })}>
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField name="workOrderNo" label={`Work order no. to ${s.vendor_name} *`} hint="The work order / PO you gave the ISP" />
        <DateField name="workStartDate" min={s.po_date} max={todayIso()} label="Work start date *" hint="On or after the PO date, not in the future" />
        <NumberField name="slaDays" min="1" max="365" label="Delivery SLA (days) *" hint="Days to go live; the target date is counted from work start" />
        {manage && (
          <SelectField name="ownerId" label="Delivery owner" hint="Field engineer who delivers this site" placeholder="—"
            options={(owners.data || []).map((u) => ({ value: u.id, label: `${u.name}${u.zone ? ` · ${u.zone}` : ''}` }))} />
        )}
      </div>
    </FormikForm>
  );
};

const ownerSchema = yup.object({ ownerId: yup.string().required('Choose who takes over') });

const OwnerControl = ({ s }) => {
  const owners = useApi('/admin/users/lookup', DELIVERY_ROLES);
  const save = useAction((b) => post(`/sites/${s.id}/owner`, b));
  return (
    <FormikForm initialValues={{ ownerId: '' }} schema={ownerSchema} busy={save.isPending} inline submitLabel="Change owner"
      onSubmit={async (v, raw, h) => { await save.mutateAsync(v); h.resetForm(); }}>
      <SelectField name="ownerId" aria-label="New owner" placeholder="Hand over to…" hint="The new owner can act on this site; the old owner no longer can"
        options={(owners.data || []).filter((u) => u.id !== s.owner_id).map((u) => ({ value: u.id, label: `${u.name}${u.zone ? ` · ${u.zone}` : ''}` }))} />
    </FormikForm>
  );
};

const raiseSchema = (parties) => yup.object({ party: R.select(parties).required(MSG.required), reason: R.reason(2000).required(MSG.required) });
const resolveSchema = yup.object({ resolution: R.reason(2000).required(MSG.required) });

const Blockers = ({ s, can }) => {
  const labels = usePartyLabels()(shortClient(s.customer_name));
  const raise = useAction((b) => post(`/sites/${s.id}/blockers`, b));
  const resolve = useAction(({ id, resolution }) => post(`/sites/${s.id}/blockers/${id}/resolve`, { resolution }));
  return (
    <div className="space-y-2.5">
      {s.blockers.length === 0 && <p className="text-xs text-subtle">Nothing pending.</p>}
      {s.blockers.map((b) => (
        <div key={b.id} className={`rounded-xl border p-3 text-sm ${b.resolved_at ? 'border-line bg-card' : 'border-[#E0566A]/60 bg-[#FDF0F1]'}`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-semibold text-ink">Pending with {labels[b.party]}</span>
            <span className="text-[11px] text-muted">{b.raised_by_name} · {formatDateTime(b.raised_at)} · {b.days_pending} day(s){b.resolved_at ? ' · resolved' : ' open'}</span>
          </div>
          <p className="mt-1 text-ink-2">{b.reason}</p>
          {b.resolved_at ? <p className="mt-1 text-xs text-brand-700">✓ {b.resolution} — {b.resolved_by_name}</p> : can && (
            <FormikForm className="mt-2" initialValues={{ resolution: '' }} schema={resolveSchema} busy={resolve.isPending} inline submitLabel="Resolve"
              onSubmit={(v) => resolve.mutateAsync({ id: b.id, resolution: v.resolution })}>
              <TextField name="resolution" aria-label="Resolution" placeholder="How was it resolved?" hint="At least 3 characters; kept in the site history" />
            </FormikForm>
          )}
        </div>
      ))}
      {can && ['WORK_STARTED', 'BLOCKED'].includes(s.status) && (
        <div className="rounded-xl border border-dashed border-line-strong p-2.5">
          <FormikForm initialValues={{ party: 'CLIENT', reason: '' }} schema={raiseSchema(Object.keys(labels))} busy={raise.isPending} inline submitLabel="Raise"
            onSubmit={async (v, raw, h) => { await raise.mutateAsync(v); h.resetForm(); }}>
            <div className="grid gap-2 sm:grid-cols-[250px_1fr]">
              <SelectField name="party" aria-label="Pending with" hint="Who must act next" options={Object.entries(labels).map(([value, v]) => ({ value, label: `Pending with ${v}` }))} />
              <TextField name="reason" aria-label="Reason" placeholder="What is pending? (approval, splicing, rack power, crossing permission…)" hint="At least 3 characters; the site cannot go live until it is resolved" />
            </div>
          </FormikForm>
        </div>
      )}
    </div>
  );
};

const LiveForm = ({ s }) => {
  const live = useAction((b) => post(`/sites/${s.id}/live`, b));
  const schema = yup.object({
    liveDate: notBefore(R.pastDate().required(MSG.required), s.work_start_date, 'Cannot be before the work start date'),
    circuitId: R.text(64).required(MSG.required),
    wanIp: R.ipv4Cidr().required(MSG.required),
    gatewayIp: R.ipv4(),
    primaryDns: R.ipv4(),
    secondaryDns: R.ipv4(),
    latencyMs: R.number().min(0, 'Must be 0 or more').max(10000, 'Must be 10000 or less'),
    packetLossPct: R.pct(),
    mrtgUrl: R.url(),
    staticIpBlock: needsStaticIp(s) ? R.ipv4Cidr().required(`Enter the static IPs allotted (${staticIpLabel(s.static_ip_count)})`) : R.ipv4Cidr(),
    atSignoffDate: notBefore(R.pastDate().required(MSG.required), s.work_start_date, 'Cannot be before the work start date'),
    atSignedBy: R.name(128).required(MSG.required),
    remarks: R.text(2000)
  });
  const init = { liveDate: todayIso(), circuitId: '', wanIp: '', gatewayIp: '', primaryDns: '', secondaryDns: '', latencyMs: '', packetLossPct: '', mrtgUrl: '', staticIpBlock: '', atSignoffDate: todayIso(), atSignedBy: '', remarks: '' };
  return (
    <FormikForm initialValues={init} schema={schema} busy={live.isPending} submitLabel="Mark site live & start billing" onSubmit={(v) => live.mutateAsync(v)}>
      <div className="grid gap-3 sm:grid-cols-3">
        <DateField name="liveDate" min={s.work_start_date} max={todayIso()} label="Live date *" hint="Billing starts from this date" />
        <TextField name="circuitId" label="Circuit ID *" hint="ISP's circuit / link ID" />
        <TextField name="wanIp" label="WAN IP / subnet *" placeholder="103.24.120.45/30" hint="IPv4, optionally with /prefix" />
        <TextField name="gatewayIp" label="Gateway" hint="IPv4, e.g. 103.24.120.46" />
        <TextField name="primaryDns" label="Primary DNS" hint="IPv4 (optional)" />
        <TextField name="secondaryDns" label="Secondary DNS" hint="IPv4 (optional)" />
        <NumberField name="latencyMs" min="0" label="Latency (ms)" hint="Measured at acceptance test" />
        <NumberField name="packetLossPct" min="0" max="100" label="Packet loss %" hint="0–100" />
        <TextField name="mrtgUrl" type="url" label="MRTG / PRTG URL" hint="https://… graph link (optional)" />
        {needsStaticIp(s) && <TextField name="staticIpBlock" label="Static IPs allotted *" placeholder="103.21.4.8/29" hint={`Needed: ${staticIpLabel(s.static_ip_count)}. IPv4 block, e.g. 103.21.4.8/29`} />}
        <DateField name="atSignoffDate" max={todayIso()} label="AT sign-off date *" hint="Date the client signed the acceptance test" />
        <TextField name="atSignedBy" className="sm:col-span-2" label={`AT signed by (${shortClient(s.customer_name)}) *`} hint="Name / designation of the client person who signed" />
      </div>
      <TextField name="remarks" label="Remarks" hint="Optional" />
      <NextStep>On save: the 1st bill to {s.customer_name} is created in Billing automatically, with the OTC and the 1st cycle together{s.client_mrc !== undefined ? ` (${formatCurrency(s.client_otc)} OTC + ${formatCurrency(s.client_mrc)} MRC${needsStaticIp(s) ? ` + static IP ${formatCurrency(s.client_ip_mrc)}` : ''} + GST)` : ''}. Upload the AT sign-off copy below.</NextStep>
    </FormikForm>
  );
};

/** Disconnect a live link: bills the cycle running on that date, then stops billing and the ISP cost */
const DisconnectForm = ({ s, onDone }) => {
  const go = useAction((body) => post(`/sites/${s.id}/disconnect`, body), { onSuccess: onDone });
  const schema = yup.object({
    disconnectDate: R.pastDate().required(MSG.required).test('after-live', `Cannot be before the live date (${formatDate(s.live_date)})`, (v) => !v || v >= s.live_date),
    reason: R.text(1000).min(3, 'Enter at least 3 characters').required('Say why the link is disconnected')
  });
  return (
    <FormikForm initialValues={{ disconnectDate: todayIso(), reason: '' }} schema={schema} busy={go.isPending} submitLabel="Disconnect & stop billing"
      onSubmit={(v) => window.confirm(`Disconnect ${s.code} (${s.site_name}) on ${formatDate(v.disconnectDate)}? Billing stops after the cycle running on that date. This cannot be undone.`) && go.mutateAsync(v)}
      extra={<Button type="button" variant="ghost" onClick={onDone}>Cancel</Button>}>
      <div className="grid gap-3 sm:grid-cols-3">
        <DateField name="disconnectDate" min={s.live_date} max={todayIso()} label="Disconnection date *" hint="Day the link was switched off (today or earlier)" />
        <TextField name="reason" className="sm:col-span-2" label="Reason *" placeholder="e.g. Client closed the branch; contract not renewed" hint="Kept in the site record and the Activity Log" />
      </div>
      <NextStep tone="warn">Every billing cycle that started on or before this date is billed now (if not yet billed), in full — there is no pro-rata. No bill is raised after it, and the ISP cost stops. A whole period already billed in advance after this date is credited automatically. Tell the ISP to switch off the link too.</NextStep>
    </FormikForm>
  );
};

/** Extend the contract of a live site (renewal PO from the client) */
const RenewForm = ({ s, onDone }) => {
  const go = useAction((body) => post(`/sites/${s.id}/renew`, body), { onSuccess: onDone });
  const schema = yup.object({
    extendMonths: R.int(1, 60).required(MSG.required),
    poNumber: R.text(64),
    poDate: R.pastDate(),
    remarks: R.text(1000)
  });
  return (
    <FormikForm initialValues={{ extendMonths: 12, poNumber: '', poDate: todayIso(), remarks: '' }} schema={schema} busy={go.isPending} submitLabel="Extend contract"
      onSubmit={(v) => go.mutateAsync(v)} extra={<Button type="button" variant="ghost" onClick={onDone}>Cancel</Button>}>
      <div className="grid gap-3 sm:grid-cols-3">
        <NumberField name="extendMonths" min="1" max="60" label="Extend by (months) *" hint={`Now ${s.contract_months} months, ending ${formatDate(s.contract_end)}`} />
        <TextField name="poNumber" label="Renewal PO no." hint="Optional — replaces the PO shown on new bills" />
        <DateField name="poDate" max={todayIso()} label="PO date" hint="Used only with a PO number" />
      </div>
      <TextField name="remarks" label="Remarks" hint="Optional, e.g. renewed at the same price" />
    </FormikForm>
  );
};

/** Renew or disconnect a live link */
const ContractActions = ({ s }) => {
  const [mode, setMode] = useState(null);
  if (mode === 'renew') return <RenewForm s={s} onDone={() => setMode(null)} />;
  if (mode === 'disconnect') return <DisconnectForm s={s} onDone={() => setMode(null)} />;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-xs text-muted">Contract ends {formatDate(s.contract_end)}. Renew when the client extends; disconnect when the link is switched off (billing and the ISP cost stop).</p>
      <div className="flex gap-2">
        <Button size="sm" variant="outline" onClick={() => setMode('renew')}>Renew contract</Button>
        <Button size="sm" variant="outline" className="text-[#C0283C]! border-[#F3C5CB]!" onClick={() => setMode('disconnect')}>Disconnect site</Button>
      </div>
    </div>
  );
};

/* ---------- date-time inputs (faults) ---------- */
const nowLocal = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };
const pastTime = (msg = 'Cannot be in the future') => yup.string().required(MSG.required).test('past', msg, (v) => !v || new Date(v) <= new Date(Date.now() + 5 * 60000));
const fmtMins = (m) => (m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`);

/** Link faults: log the link down (with the ISP's docket), then restored — downtime and uptime are worked out from these */
const FaultsPanel = ({ s, can }) => {
  const [open, setOpen] = useState(false);
  const report = useAction((v) => post(`/sites/${s.id}/faults`, { ...v, reportedAt: new Date(v.reportedAt).toISOString() }), { onSuccess: () => setOpen(false) });
  const restore = useAction((v) => post(`/sites/${s.id}/faults/${s.open_fault.id}/restore`, { ...v, restoredAt: new Date(v.restoredAt).toISOString() }));
  const openRow = s.open_fault;
  return (
    <div className="space-y-3">
      {openRow ? (
        <div className="rounded-xl border border-[#F3C5CB] bg-[#FDF0F1] p-3">
          <p className="text-sm font-semibold text-[#C0283C]">Link down since {formatDateTime(openRow.reported_at)}{openRow.docket_no ? ` · ${s.vendor_name} docket ${openRow.docket_no}` : ''}</p>
          <p className="text-xs text-ink-2">{openRow.description}</p>
          {can && (
            <div className="mt-3">
              <FormikForm initialValues={{ restoredAt: nowLocal(), cause: '' }} busy={restore.isPending} submitLabel="Mark restored"
                schema={yup.object({ restoredAt: pastTime().test('after', 'Cannot be before the fault time', (v) => !v || new Date(v) >= new Date(openRow.reported_at)), cause: R.reason(2000).required('Say what the cause / fix was') })}
                onSubmit={(v) => restore.mutateAsync(v)}>
                <div className="grid gap-3 sm:grid-cols-3">
                  <TextField name="restoredAt" type="datetime-local" label="Restored at *" hint="When the link came back" />
                  <TextField name="cause" className="sm:col-span-2" label="Cause / fix *" placeholder="e.g. Fibre cut — ISP spliced it" hint="From the ISP's closure note" />
                </div>
              </FormikForm>
            </div>
          )}
        </div>
      ) : s.status === 'LIVE' && can && (open ? (
        <FormikForm initialValues={{ reportedAt: nowLocal(), docketNo: '', description: '' }} busy={report.isPending} submitLabel="Log link down"
          schema={yup.object({ reportedAt: pastTime(), docketNo: R.text(64), description: R.reason(2000).required('Describe the problem') })}
          onSubmit={(v) => report.mutateAsync(v)} extra={<Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>}>
          <div className="grid gap-3 sm:grid-cols-3">
            <TextField name="reportedAt" type="datetime-local" label="Down since *" hint="When the link went down" />
            <TextField name="docketNo" label={`${s.vendor_name} docket no.`} hint="Complaint number from the ISP (optional)" />
            <TextField name="description" label="Problem *" placeholder="e.g. No link, high latency" hint="What the client reports" />
          </div>
        </FormikForm>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-muted">Link working. Log a fault when it goes down, with the ISP's docket number, and mark it restored when it is back.</p>
          <Button size="sm" variant="outline" onClick={() => setOpen(true)}>Log link down</Button>
        </div>
      ))}
      {s.faults?.length > 0 && (
        <Table rows={s.faults} columns={[
          { key: 'd', label: 'Down', render: (f) => <div className="text-xs"><p>{formatDateTime(f.reported_at)}</p><p className="text-muted">{f.docket_no ? `Docket ${f.docket_no}` : 'No docket'}</p></div> },
          { key: 'p', label: 'Problem / cause', render: (f) => <div className="text-xs"><p>{f.description}</p><p className="text-muted">{f.cause || '—'}</p></div> },
          { key: 'r', label: 'Restored', render: (f) => <span className="text-xs">{f.restored_at ? formatDateTime(f.restored_at) : <b className="text-[#C0283C]">Still down</b>}</span> },
          { key: 'm', label: 'Downtime', render: (f) => <span className="text-xs tnum">{fmtMins(f.down_minutes)}</span> }
        ]} />
      )}
    </div>
  );
};

/** Bandwidth / price change on a live link, from the next billing cycle (history kept; earlier bills keep their price) */
const RevisionsPanel = ({ s, canChange }) => {
  const [open, setOpen] = useState(false);
  const save = useAction((v) => post(`/sites/${s.id}/revisions`, v), { onSuccess: () => setOpen(false) });
  const ip = needsStaticIp(s);
  const money = s.client_mrc !== undefined;
  const schema = yup.object({
    bandwidthMbps: R.int(1, 100000).required(MSG.required),
    clientMrc: R.money().required(MSG.required), vendorMrc: R.money().required(MSG.required),
    clientIpMrc: R.money(), vendorIpMrc: R.money(),
    reason: R.reason(1000).required('Say why (upgrade, re-pricing at renewal …)'), poNumber: R.text(64)
  });
  return (
    <div className="space-y-3">
      {canChange && (open ? (
        <FormikForm initialValues={{ bandwidthMbps: s.bandwidth_mbps, clientMrc: s.client_mrc, clientIpMrc: s.client_ip_mrc || 0, vendorMrc: s.vendor_mrc, vendorIpMrc: s.vendor_ip_mrc || 0, reason: '', poNumber: '' }}
          schema={schema} busy={save.isPending} submitLabel="Save change" onSubmit={(v) => save.mutateAsync(v)}
          extra={<Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>}>
          <div className="grid gap-3 sm:grid-cols-3">
            <NumberField name="bandwidthMbps" min="1" label="New bandwidth (Mbps) *" hint={`Now ${formatMbps(s.bandwidth_mbps)}`} />
            <NumberField name="clientMrc" min="0" label="New client MRC (₹) *" hint={`Now ${formatCurrency(s.client_mrc)} / month`} />
            <NumberField name="vendorMrc" min="0" label={`New ${s.vendor_name} MRC (₹) *`} hint={`Now ${formatCurrency(s.vendor_mrc)} / month`} />
            {ip && <NumberField name="clientIpMrc" min="0" label="Client static IP / month (₹)" hint={`Now ${formatCurrency(s.client_ip_mrc)}`} />}
            {ip && <NumberField name="vendorIpMrc" min="0" label="ISP static IP / month (₹)" hint={`Now ${formatCurrency(s.vendor_ip_mrc)}`} />}
            <TextField name="poNumber" label="Client PO for the change" hint="Optional — printed on new bills" />
          </div>
          <TextField name="reason" label="Reason *" placeholder="e.g. Upgrade to 200 Mbps; renewal at a new price" hint="Kept in the change history" />
          <NextStep>Applies from cycle {Number(s.last_cycle_no) + 1}, the next bill not yet raised. Bills already raised keep the old price (and keep it if re-issued). Tell the ISP to change the link too.</NextStep>
        </FormikForm>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-muted">Upgrade / downgrade the bandwidth or change the price; it applies from the next bill.</p>
          <Button size="sm" variant="outline" onClick={() => setOpen(true)}>Change bandwidth / price</Button>
        </div>
      ))}
      {s.revisions?.length > 0 ? (
        <Table rows={s.revisions} columns={[
          { key: 'c', label: 'From', render: (r) => <div className="text-xs"><p>Cycle {r.from_cycle}</p><p className="text-muted">{formatDate(r.effective_from)}</p></div> },
          { key: 'b', label: 'Bandwidth', render: (r) => <span className="text-xs">{formatMbps(r.old_bandwidth_mbps)} → <b>{formatMbps(r.new_bandwidth_mbps)}</b></span> },
          ...(money ? [{ key: 'p', label: 'Client / ISP MRC', render: (r) => <div className="text-xs tnum"><p>{formatCurrency(r.old_client_mrc)} → <b>{formatCurrency(r.new_client_mrc)}</b></p><p className="text-muted">{formatCurrency(r.old_vendor_mrc)} → {formatCurrency(r.new_vendor_mrc)}</p></div> }] : []),
          { key: 'r', label: 'Reason', render: (r) => <div className="text-xs"><p>{r.reason}</p><p className="text-muted">{r.created_by_name}{r.po_number ? ` · PO ${r.po_number}` : ''}</p></div> }
        ]} />
      ) : !canChange && <p className="text-xs text-muted">No changes since go-live.</p>}
    </div>
  );
};

/** Reconnect a disconnected link: billing restarts from the reconnection date (the gap is not billed) */
const ReconnectForm = ({ s }) => {
  const [open, setOpen] = useState(false);
  const go = useAction((v) => post(`/sites/${s.id}/reconnect`, v), { onSuccess: () => setOpen(false) });
  const money = s.client_mrc !== undefined;
  const schema = yup.object({
    reconnectDate: R.pastDate().required(MSG.required).test('after', `Cannot be before the disconnection (${formatDate(s.terminated_on)})`, (v) => !v || v >= s.terminated_on),
    reason: R.reason(1000).required('Say why the link is back'),
    reconnectCharge: R.money(), reconnectVendorCharge: R.money(),
    contractMonths: R.int(1, 120), circuitId: R.text(64)
  });
  if (!open) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-muted">Client wants the link back? Reconnecting makes it live again; billing restarts from that date.</p>
        <Button size="sm" variant="outline" onClick={() => setOpen(true)}>Reconnect site</Button>
      </div>
    );
  }
  return (
    <FormikForm initialValues={{ reconnectDate: todayIso(), reason: '', reconnectCharge: '', reconnectVendorCharge: '', contractMonths: '', circuitId: '' }} schema={schema} busy={go.isPending}
      submitLabel="Reconnect & restart billing" onSubmit={(v) => go.mutateAsync(v)} extra={<Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>}>
      <div className="grid gap-3 sm:grid-cols-3">
        <DateField name="reconnectDate" min={s.terminated_on} max={todayIso()} label="Reconnection date *" hint="Billing restarts from this day" />
        <TextField name="reason" className="sm:col-span-2" label="Reason *" placeholder="e.g. Client reopened the branch" hint="Kept in the Activity Log" />
        {money && <NumberField name="reconnectCharge" min="0" label="Reconnection charge to client (₹)" hint="One-time, before GST, on the first bill (optional)" />}
        {money && <NumberField name="reconnectVendorCharge" min="0" label={`${s.vendor_name} reconnection charge (₹)`} hint="One-time ISP cost (optional)" />}
        <NumberField name="contractMonths" min="1" max="120" label="New contract (months)" hint={`Blank = keep the contract end ${formatDate(s.contract_end)}`} />
        <TextField name="circuitId" label="New circuit ID" hint={`Blank = keep ${s.circuit_id || '—'}`} />
      </div>
      <NextStep>The days between disconnection and reconnection are not billed, and no day is billed twice: billing restarts from the reconnection date, or from the day after the period already billed if that is later. The first bill runs a full cycle{money ? ' plus the reconnection charge' : ''}. Prices stay as before — use “Change bandwidth / price” after reconnecting if they change.</NextStep>
    </FormikForm>
  );
};

const contractText = (s) => {
  if (!s.contract_end) return '—';
  const left = s.contract_days_left;
  const tail = left === null || left === undefined ? '' : left < 0 ? ` · ended ${-left} days ago` : ` · ${left} days left`;
  return <span className={left !== null && left !== undefined && left <= 60 ? 'font-semibold text-[#B26B00]' : ''}>{formatDate(s.contract_end)} ({s.contract_months} months){tail}</span>;
};

export const SiteDrawer = ({ id, onClose }) => {
  const dispatch = useDispatch();
  const { data: s, isLoading, error } = useApi(id ? `/sites/${id}` : null);
  const { manage, deliver, user } = useSiteRights(s);
  const company = shortName(user.tenant_name) || 'us';
  return (
    <Drawer open={Boolean(id)} onClose={onClose} label="Site" width="sm:w-[680px]">
      {isLoading || !s ? (error ? <ErrorBox error={error} /> : <Loading />) : (
        <div>
          <div className="flex flex-wrap items-center gap-2 pr-10"><Code>{s.code}</Code><Status value={s.status} />{s.sla_overdue && <span className="rounded bg-[#FDF0F1] px-2 py-0.5 text-[11px] font-semibold text-[#C0283C]">SLA overdue</span>}</div>
          <h2 className="mt-2 text-xl font-semibold text-ink">{s.site_name}<LinkTags role={s.link_role} ips={s.static_ip_count} /></h2>
          <p className="text-sm text-muted">{s.customer_name}{s.client_site_ref ? ` · site ${s.client_site_ref}` : ''} · {formatMbps(s.bandwidth_mbps)} via {s.vendor_name} · {s.quote_code}</p>
          <div className="mt-3"><Stepper steps={['Awaiting PO', 'PO received', 'ISP work start', 'Site live']} current={STEP[s.status]} /></div>
          <div className="mt-3 flex flex-wrap gap-2"><Site360Button id={s.id} />
            {s.order_id && <Button size="sm" variant="outline" onClick={() => { onClose(); dispatch(openRecord({ module: 'orders', id: s.order_id })); }}>Order {s.order_code}</Button>}
            {s.status === 'LIVE' && hasPerm(user, 'billing.view') && <Button size="sm" onClick={() => { onClose(); dispatch(setActiveTab('billing')); }}>Go to billing <ArrowRight className="h-3.5 w-3.5" /></Button>}
          </div>

          <Section title="Who & where">
            <KV cols={3} items={[
              ['Delivery owner', s.owner_name || <span key="o" className="text-[#B26B00]">Not set</span>],
              ["Client's site ID", s.client_site_ref || '—'],
              ['Medium', mediumLabel(s.medium)], ['Link type', s.link_role === 'SECONDARY' ? 'Secondary (backup) link' : 'Primary link'], ['Static IP', staticIpLabel(s.static_ip_count)],
              ['Contact at site', [s.site_contact_name, s.site_contact_phone].filter(Boolean).join(' · ') || '—'],
              ['Address', s.address || '—']
            ]} />
            {manage && !['LIVE', 'TERMINATED'].includes(s.status) && <div className="mt-3"><OwnerControl s={s} /></div>}
            {!deliver && hasPerm(user, 'implementation.execute') && <div className="mt-3"><NextStep>This site is owned by {s.owner_name || 'someone else'}. Ask Operations to hand it over if you are taking it forward.</NextStep></div>}
          </Section>

          {hasPerm(user, 'commercial.view') && (
            <Section title="Commercials (from bid win)">
              <KV cols={3} items={[['Client OTC / MRC', `${formatCurrency(s.client_otc)} / ${formatCurrency(s.client_mrc)}${needsStaticIp(s) ? ` + static IP ${formatCurrency(s.client_ip_mrc)}` : ''}`], ['ISP OTC / MRC', `${formatCurrency(s.vendor_otc)} / ${formatCurrency(s.vendor_mrc)}${needsStaticIp(s) ? ` + static IP ${formatCurrency(s.vendor_ip_mrc)}` : ''}`], ['Billing', `${s.billing_frequency.toLowerCase()} · ${s.credit_days}d credit`]]} />
            </Section>
          )}

          {s.po_number && (
            <Section title="PO & work">
              <KV cols={3} items={[
                ['PO', `${s.po_number}`], ['PO date', `${formatDate(s.po_date)}${s.po_value !== undefined ? ` · ${formatCurrency(s.po_value)}` : ''}`], ['PO copy', s.po_docs ? '✓ uploaded' : <span key="p" className="text-[#B26B00]">Not uploaded</span>],
                s.work_order_no && ['Work order', s.work_order_no], s.work_start_date && ['Work start', formatDate(s.work_start_date)],
                s.target_live_date && ['SLA', <span key="sla" className={s.sla_overdue ? 'font-semibold text-[#C0283C]' : ''}>{s.days_elapsed} / {s.sla_days} days · target {formatDate(s.target_live_date)}</span>]
              ]} />
            </Section>
          )}

          {s.status === 'AWAITING_PO' && !manage && <div className="mt-4"><NextStep>Waiting for the client PO — Operations records it when {shortClient(s.customer_name)} sends it.</NextStep></div>}
          {['AWAITING_PO', 'PO_RECEIVED'].includes(s.status) && manage && <Section title={s.status === 'AWAITING_PO' ? 'Step 1 · PO received' : 'Edit PO'}><PoForm key={s.updated_at} s={s} /></Section>}
          {s.status === 'PO_RECEIVED' && deliver && <Section title="Step 2 · ISP work start"><WorkStartForm s={s} manage={manage} defaultSla={user.settings?.default_sla_days} /></Section>}
          {['WORK_STARTED', 'BLOCKED', 'LIVE'].includes(s.status) && <Section title={`Pending with — ${shortClient(s.customer_name)} · ISP · ${company} · customer at site`}><Blockers s={s} can={deliver && s.status !== 'LIVE'} /></Section>}
          {s.status === 'BLOCKED' && <div className="mt-3"><NextStep tone="warn">Resolve every pending item before the site can go live.</NextStep></div>}
          {s.status === 'WORK_STARTED' && deliver && <Section title="Step 3 · Details of site live"><LiveForm s={s} /></Section>}

          {['LIVE', 'TERMINATED'].includes(s.status) && (
            <Section title="Site live details">
              <KV cols={3} items={[
                ['Live date', formatDate(s.live_date)], ['Contract ends', contractText(s)],
                Number(s.cycle_base) > 0 && ['Reconnected / billing from', formatDate(s.billing_start)],
                s.status === 'LIVE' && ['Uptime (30 days)', <span key="u" className={s.sla_pct && s.uptime_30d < Number(s.sla_pct) ? 'font-semibold text-[#C0283C]' : ''}>{s.uptime_30d}%{s.sla_pct ? ` · SLA ${s.sla_pct}%` : ''}</span>], ['Circuit ID', s.circuit_id], ['WAN IP', s.wan_ip], s.static_ip_block && ['Static IPs', s.static_ip_block], ['Gateway', s.gateway_ip], ['DNS', [s.primary_dns, s.secondary_dns].filter(Boolean).join(', ') || '—'],
                ['Latency / loss', `${s.latency_ms ?? '—'} ms / ${s.packet_loss_pct ?? '—'} %`], ['AT sign-off', `${formatDate(s.at_signoff_date)} · ${s.at_signed_by}`],
                ['AT document', s.at_docs ? '✓ uploaded' : <span key="a" className="text-[#B26B00]">Not uploaded</span>],
                ['MRTG', s.mrtg_url ? <a key="m" href={s.mrtg_url} target="_blank" rel="noreferrer" className="text-brand-700 underline">Open</a> : '—']
              ]} />
            </Section>
          )}

          {s.status === 'TERMINATED' && (
            <Section title="Disconnected">
              <KV cols={3} items={[['Disconnected on', formatDate(s.terminated_on)], ['By', s.terminated_by_name || '—'], ['Reason', s.termination_reason || '—']]} />
              <div className="mt-3"><NextStep>Billing and the ISP cost stopped on {formatDate(s.terminated_on)}. Earlier bills stay in Billing until they are paid.</NextStep></div>
              {manage && <div className="mt-3"><ReconnectForm key={s.updated_at} s={s} /></div>}
            </Section>
          )}
          {(s.status === 'LIVE' || s.faults?.length > 0) && <Section title={s.open_fault ? 'Link faults · DOWN NOW' : 'Link faults'}><FaultsPanel key={`${s.updated_at}-${s.faults?.length}-${s.open_fault?.id}`} s={s} can={deliver} /></Section>}
          {(s.status === 'LIVE' || s.revisions?.length > 0) && <Section title="Bandwidth / price changes"><RevisionsPanel key={s.updated_at} s={s} canChange={s.status === 'LIVE' && hasPerm(user, 'commercial.manage')} /></Section>}
          {s.status === 'LIVE' && manage && <Section title="Contract · renew or disconnect"><ContractActions key={s.updated_at} s={s} /></Section>}

          <Section title="Documents"><DocumentsPanel entityType="SITE" entityId={s.id} types={['PO_COPY', 'WORK_ORDER', 'AT_SIGNOFF', 'COMMISSIONING_REPORT', 'OTHER']} canEdit={deliver} /></Section>
          <RecordActivity entityId={s.id} />
        </div>
      )}
    </Drawer>
  );
};

export const ImplementationPage = () => {
  const user = useSelector((st) => st.auth.user);
  const labelsFor = usePartyLabels();
  const isEngineer = user.role === 'FIELD_ENGINEER';
  const [tab, setTab] = useState('ALL');
  const [q, setQ] = useState('');
  const [mine, setMine] = useState(isEngineer);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [selected, setSelected] = useState(null);
  const open = useCallback((id) => setSelected(id), []);
  useFocusRecord('implementation', open);
  const list = useApi('/sites', mine ? { mine: '1' } : undefined);
  const rows = useMemo(() => {
    const t = TABS.find((x) => x.id === tab);
    return filterBy((list.data || []).filter((r) => !t.statuses || t.statuses.includes(r.status)), q, ['code', 'site_name', 'customer_name', 'vendor_name', 'po_number', 'circuit_id', 'client_site_ref', 'owner_name', 'order_code']);
  }, [list.data, tab, q]);

  return (
    <motion.div variants={page} initial="hidden" animate="visible" exit="exit" className="space-y-4">
      <PageHeader title="Implementation Tracker" subtitle="Client PO received → ISP work start → pending with client / ISP / our team / customer → details of site live"
        actions={hasPerm(user, 'implementation.manage') && <Button variant="outline" onClick={() => setBulkOpen(true)}><FileStack className="h-4 w-4" /> One PO for several sites</Button>} />
      <div className="flex flex-wrap items-center gap-3">
        <PillTabs value={tab} onChange={setTab} options={TABS.map((t) => ({ id: t.id, label: t.label, count: (list.data || []).filter((r) => !t.statuses || t.statuses.includes(r.status)).length }))} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter…" className={`${inputClass} max-w-[220px]`} aria-label="Filter" />
        <label className="flex items-center gap-1.5 text-xs font-medium text-ink-2"><input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} /> Only my sites</label>
      </div>
      {list.isLoading ? <Loading /> : list.error ? <ErrorBox error={list.error} /> : (
        <motion.div variants={rise}>
          <Table rows={rows} onRowClick={(r) => setSelected(r.id)} empty={mine ? 'No sites owned by you yet. Sites you surveyed arrive here on Bid Win.' : 'Sites appear here automatically on Bid Win.'}
            columns={[
              { key: 'code', label: 'Site', render: (r) => <Code>{r.code}</Code> },
              { key: 'name', label: 'Site / client', render: (r) => <div><p className="font-semibold text-ink">{r.site_name}{r.client_site_ref && <span className="ml-1.5 text-[11px] font-medium text-muted">[{r.client_site_ref}]</span>}<LinkTags role={r.link_role} ips={r.static_ip_count} /></p><p className="text-[11px] text-muted">{r.customer_name}{r.order_code ? ` · ${r.order_code}` : ''}</p></div> },
              { key: 'owner_name', label: 'Owner', render: (r) => r.owner_name || <span className="text-[#B26B00]">—</span> },
              { key: 'vendor_name', label: 'ISP', render: (r) => <span className="inline-flex items-center gap-1"><Radio className="h-3.5 w-3.5 text-brand-600" />{r.vendor_name}</span> },
              { key: 'po', label: 'PO', render: (r) => <span className="text-xs">{r.po_number || '—'}</span> },
              { key: 'sla', label: 'SLA', render: (r) => r.target_live_date ? <span className={`text-xs tnum ${r.sla_overdue ? 'font-semibold text-[#C0283C]' : ''}`}>{r.days_elapsed}/{r.sla_days} d</span> : '—' },
              { key: 'blk', label: 'Pending with', render: (r) => r.current_blocker ? <span className="text-xs text-[#C0283C]">{labelsFor(shortClient(r.customer_name))[r.current_blocker.party]}{r.open_blockers > 1 ? ` +${r.open_blockers - 1}` : ''}</span> : r.status === 'LIVE' ? <CheckCircle2 className="h-4 w-4 text-brand-600" /> : '—' },
              { key: 'status', label: 'Status', render: (r) => <Status value={r.status} /> }
            ]} />
        </motion.div>
      )}
      <BulkPoModal open={bulkOpen} onClose={() => setBulkOpen(false)} sites={list.data || []} />
      <SiteDrawer id={selected} onClose={() => setSelected(null)} />
    </motion.div>
  );
};

export default ImplementationPage;
