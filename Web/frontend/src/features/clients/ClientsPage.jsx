import React, { useCallback, useMemo, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { motion } from 'framer-motion';
import { Plus, Pencil, Trash2, MessageSquare, ChevronDown } from 'lucide-react';
import { page, rise } from '../../utils/motion';
import { Button, Status } from '../../components/common/ui';
import PageHeader from '../../components/common/PageHeader';
import PillTabs from '../../components/common/PillTabs';
import { Modal, Drawer, inputClass } from '../../components/common/Overlay';
import { Table, Loading, ErrorBox, KV, Section, NextStep, DocumentsPanel, EmptyState } from '../../components/common/kit';
import { FormikForm, TextField, NumberField, DateField, SelectField, CheckboxField } from '../../components/form/FormKit';
import { R, MSG, yup } from '../../validation/rules';
import { useApi, useAction } from '../../api/hooks';
import { post, put, patch, del } from '../../api/client';
import { hasPerm } from '../../store/slices/authSlice';
import { openLifecycle } from '../../store/slices/uiSlice';
import { formatCurrency, formatMbps, formatDate, todayIso } from '../../utils/formatters';
import { useFocusRecord, RecordActivity, Code, filterBy, LINK_ROLES, STATIC_IP_OPTIONS, LinkTags, MEDIUMS } from '../shared';

/* ------------------------------- STAGES ------------------------------- */
export const STAGES = [
  { id: 'FEASIBILITY', label: 'Feasibility', bar: 'bg-brand-200' },
  { id: 'QUOTE', label: 'Quote', bar: 'bg-brand-400' },
  { id: 'AWAITING_PO', label: 'Awaiting PO', bar: 'bg-[#E8A317]' },
  { id: 'DELIVERY', label: 'In delivery', bar: 'bg-brand-600' },
  { id: 'LIVE', label: 'Live', bar: 'bg-brand-800' },
  { id: 'STOPPED', label: 'Stopped', bar: 'bg-[#E0566A]/70' },
  { id: 'LOST', label: 'Bid lost', bar: 'bg-[#E0566A]/40' },
  { id: 'TERMINATED', label: 'Terminated', bar: 'bg-line-strong' }
];
const STAGE_LABEL = Object.fromEntries(STAGES.map((s) => [s.id, s.label]));
const STAGE_BAR = Object.fromEntries(STAGES.map((s) => [s.id, s.bar]));
const StageChip = ({ stage }) => (
  <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs font-medium text-ink-2"><span className={`h-2 w-2 rounded-full ${STAGE_BAR[stage]}`} />{STAGE_LABEL[stage]}</span>
);

/** Segmented bar: how many sites of an order / client are at each stage */
export const StageBar = ({ stages = {}, legend = false }) => {
  const total = STAGES.reduce((a, s) => a + (stages[s.id] || 0), 0);
  if (!total) return <span className="text-xs text-subtle">No sites yet</span>;
  return (
    <div className="min-w-[160px]">
      <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-line" role="img" aria-label={STAGES.filter((s) => stages[s.id]).map((s) => `${stages[s.id]} ${s.label}`).join(', ')}>
        {STAGES.filter((s) => stages[s.id]).map((s) => <span key={s.id} className={`${s.bar} h-full`} style={{ width: `${(stages[s.id] / total) * 100}%` }} title={`${s.label}: ${stages[s.id]}`} />)}
      </div>
      <p className={`mt-1 text-[11px] text-muted ${legend ? 'flex flex-wrap gap-x-3 gap-y-0.5' : ''}`}>
        {STAGES.filter((s) => stages[s.id]).map((s) => (
          <span key={s.id} className="mr-2 inline-flex items-center gap-1 whitespace-nowrap"><span className={`inline-block h-2 w-2 rounded-full ${s.bar}`} />{stages[s.id]} {s.label.toLowerCase()}</span>
        ))}
      </p>
    </div>
  );
};

const CLIENT_TYPES = { PSU_GOVT: 'PSU / Government', TELECOM: 'Telecom / Aggregator', BFSI: 'Bank / BFSI', ENTERPRISE: 'Enterprise', OTHER: 'Other' };
const VIA = { WHATSAPP: 'WhatsApp', EMAIL: 'Email', PORTAL: 'Client portal', LETTER: 'Letter / LOI', PHONE: 'Phone' };
const VIA_OPTIONS = Object.entries(VIA).map(([value, label]) => ({ value, label }));
const ENGINEER_ROLES = { role: 'FIELD_ENGINEER,OPERATIONS' };
const engineerOptions = (list) => (list || []).map((u) => ({ value: u.id, label: `${u.name}${u.zone ? ` · ${u.zone}` : ''}` }));

/* ------------------------------- ONE SITE ------------------------------- */
const BLANK_SITE = { siteName: '', bandwidthMbps: '', linkRole: 'PRIMARY', staticIpCount: '0', address: '', city: '', pincode: '', medium: 'FIBER', mapsUrl: '', latitude: '', longitude: '', clientSiteRef: '', siteContactName: '', siteContactPhone: '' };
const SITE_KEYS = Object.keys(BLANK_SITE);
const pickSite = (v) => Object.fromEntries(SITE_KEYS.map((k) => [k, v[k]]));

/** One site — mirrors the API's siteFields (Joi) */
const siteShape = {
  siteName: R.name(255).required(MSG.required),
  bandwidthMbps: R.int(1, 100000).required(MSG.required),
  linkRole: R.select(LINK_ROLES.map((x) => x.value)),
  staticIpCount: R.int(0, 256),
  address: R.text(1000).required(MSG.required),
  city: R.text(64),
  pincode: R.pincode(),
  medium: R.select(MEDIUMS.map((x) => x.value)),
  mapsUrl: R.url(),
  latitude: R.number().min(-90, 'Latitude must be between -90 and 90').max(90, 'Latitude must be between -90 and 90'),
  longitude: R.number().min(-180, 'Longitude must be between -180 and 180').max(180, 'Longitude must be between -180 and 180'),
  clientSiteRef: R.text(64),
  siteContactName: R.name(128),
  siteContactPhone: R.phone(),
  assignedTo: yup.string()
};
export const siteSchema = yup.object(siteShape);

/** The API reports site errors as "sites.0.address" — show them on the single-site form's own fields */
const siteErrors = (err) => {
  if (err?.errors) err.errors = err.errors.map((x) => ({ ...x, field: x.field ? x.field.replace(/^sites\.\d+\./, '') : x.field }));
  throw err;
};

/** The fields of one site, laid out like the single-site request form */
const SiteFields = () => (
  <>
    <div className="grid gap-3 sm:grid-cols-2">
      <TextField name="siteName" label="Site name *" placeholder="Branch / ATM / office" hint="Short name the team will recognise" />
      <NumberField name="bandwidthMbps" min="1" label="Bandwidth (Mbps) *" hint="Whole number, 1–100000" />
      <SelectField name="linkRole" label="Link type" hint="Secondary = a backup link at a location that has (or will have) a primary link" options={LINK_ROLES} />
      <SelectField name="staticIpCount" label="Static IP" hint="Static IPs the client wants with this link; priced monthly in the survey and quote" options={STATIC_IP_OPTIONS} />
    </div>
    <TextField name="address" rows={2} label="Address *" hint="Full address the engineer will visit" />
    <div className="grid gap-3 sm:grid-cols-3">
      <TextField name="city" label="City" hint="Optional" />
      <TextField name="pincode" maxLength={6} inputMode="numeric" label="Pincode" hint="6 digits, e.g. 560001" />
      <SelectField name="medium" label="Medium" hint="How the client wants the link" options={MEDIUMS} />
    </div>
    <TextField name="mapsUrl" label="Google Maps link" placeholder="https://maps.google.com/…" hint="Coordinates are read from the link automatically" />
    <div className="grid gap-3 sm:grid-cols-2">
      <NumberField name="latitude" label="Latitude" hint="−90 to 90, e.g. 12.9716 (optional)" />
      <NumberField name="longitude" label="Longitude" hint="−180 to 180, e.g. 77.5946 (optional)" />
    </div>
    <div className="grid gap-3 sm:grid-cols-3">
      <TextField name="clientSiteRef" label="Client's site ID" placeholder="e.g. S-014" hint="The client's own code, printed on the bill" />
      <TextField name="siteContactName" label="Contact at site" hint="Person to meet (optional)" />
      <TextField name="siteContactPhone" type="tel" label="Site contact phone" hint="10–15 digits (optional)" />
    </div>
  </>
);

/** Optional order details, folded away so the form stays short */
const MoreDetails = ({ title, children }) => {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-xl border border-line">
      <button type="button" aria-expanded={open} onClick={() => setOpen((x) => !x)}
        className="flex w-full items-center justify-between px-3.5 py-2.5 text-left text-[13px] font-semibold text-ink-2 hover:bg-panel">
        {title}<ChevronDown className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && <div className="space-y-3.5 border-t border-line p-3.5">{children}</div>}
    </div>
  );
};

/* ------------------------------- NEW ORDER ------------------------------- */
const ORDER_HEADER = { customerId: '', receivedVia: 'WHATSAPP', receivedDate: todayIso(), clientRef: '', clientContactName: '', clientContactPhone: '', clientContactEmail: '', expectedBy: '', notes: '' };
const orderHeaderShape = {
  customerId: yup.string().required('Choose the client who sent the order'),
  receivedVia: R.select(Object.keys(VIA)),
  receivedDate: R.pastDate(),
  clientRef: R.text(128),
  clientContactName: R.name(128),
  clientContactPhone: R.phone(),
  clientContactEmail: R.email(),
  expectedBy: R.date(),
  notes: R.text(2000)
};
/** Mirrors POST /orders (Joi) for an order with its first site */
const newOrderSchema = yup.object({ ...orderHeaderShape, ...siteShape });

const OrderDetailFields = () => (
  <>
    <div className="grid gap-3 sm:grid-cols-3">
      <DateField name="receivedDate" max={todayIso()} label="Received date" hint="Cannot be in the future" />
      <TextField name="clientRef" label="Client's order / ref no." placeholder="e.g. ORD/2026/118" hint="Their reference, to quote back" />
      <DateField name="expectedBy" label="Client wants it by" hint="Target date, if they gave one" />
      <TextField name="clientContactName" label="Requested by (client contact)" hint="Who sent the order (optional)" />
      <TextField name="clientContactPhone" type="tel" label="Their phone" hint="10–15 digits (optional)" />
      <TextField name="clientContactEmail" type="email" label="Their email" hint="Optional" />
    </div>
    <TextField name="notes" rows={2} label="Notes" hint="Anything else the client said about this order (optional)" />
  </>
);

/** A client order starts with one site; more sites are added from the order */
const NewOrderModal = ({ open, onClose, onCreated }) => {
  const user = useSelector((s) => s.auth.user);
  const canAssign = hasPerm(user, 'feasibility.assign');
  const clients = useApi(open ? '/admin/customers' : null);
  const engineers = useApi(open && canAssign ? '/admin/users/lookup' : null, ENGINEER_ROLES);
  const create = useAction((body) => post('/orders', body), { onSuccess: (res) => { onClose(); onCreated(res.data.id); } });

  const active = (clients.data || []).filter((c) => c.is_active);
  return (
    <Modal open={open} onClose={onClose} title="New client order" width="max-w-[680px]">
      {clients.data && active.length === 0 ? (
        <EmptyState title="Add a client first" hint="Add the client who sent this order in the Clients tab first." />
      ) : (
        <FormikForm initialValues={{ ...ORDER_HEADER, ...BLANK_SITE, assignedTo: '' }} schema={newOrderSchema} busy={create.isPending} submitLabel="Log order"
          onSubmit={(v) => create.mutateAsync({
            ...Object.fromEntries(Object.keys(ORDER_HEADER).map((k) => [k, v[k]])),
            expectedBy: v.expectedBy || null,
            ownerId: v.assignedTo || null,
            sites: [pickSite(v)]
          }).catch(siteErrors)}>
          <div className="grid gap-3 sm:grid-cols-3">
            <SelectField name="receivedVia" label="Received on" hint="How the order reached you" options={VIA_OPTIONS} />
            <SelectField name="customerId" className="sm:col-span-2" label="Client *" hint="The company asking for this link" placeholder="Select client…"
              options={active.map((c) => ({ value: c.id, label: c.name }))} />
          </div>
          <SiteFields />
          {canAssign ? (
            <SelectField name="assignedTo" label="Field engineer who takes it forward (optional)" hint="They survey it and, after Bid Win, deliver it"
              placeholder="Assign later" options={engineerOptions(engineers.data)} />
          ) : <NextStep>You will own this order — survey now, and delivery after Bid Win.</NextStep>}
          <MoreDetails title="More order details (optional): client ref, wanted-by date, contact, notes"><OrderDetailFields /></MoreDetails>
          <p className="text-xs text-muted">More locations in the same order? Log this one, then use <b>Add a site</b> on the order.</p>
        </FormikForm>
      )}
    </Modal>
  );
};

/* ------------------------------- EDIT ORDER ------------------------------- */
const editOrderSchema = yup.object({ ...orderHeaderShape, ownerId: yup.string() });
const fromOrder = (o) => ({
  customerId: o.customer_id, receivedVia: o.received_via, receivedDate: String(o.received_date || '').slice(0, 10), clientRef: o.client_ref || '',
  clientContactName: o.client_contact_name || '', clientContactPhone: o.client_contact_phone || '', clientContactEmail: o.client_contact_email || '',
  expectedBy: o.expected_by ? String(o.expected_by).slice(0, 10) : '', notes: o.notes || '', ownerId: o.owner_id || ''
});

const EditOrderModal = ({ order, onClose }) => {
  const user = useSelector((s) => s.auth.user);
  const canAssign = hasPerm(user, 'feasibility.assign');
  const clients = useApi('/admin/customers');
  const engineers = useApi(canAssign ? '/admin/users/lookup' : null, ENGINEER_ROLES);
  const quoted = order.sites.some((s) => s.quote_code);
  const save = useAction((b) => patch(`/orders/${order.id}`, b), { onSuccess: onClose });
  const clientOptions = (clients.data || []).filter((c) => c.is_active || c.id === order.customer_id).map((c) => ({ value: c.id, label: c.name }));
  return (
    <Modal open onClose={onClose} title={`Edit order ${order.code}`} width="max-w-[680px]">
      <FormikForm initialValues={fromOrder(order)} schema={editOrderSchema} busy={save.isPending} submitLabel="Save changes"
        onSubmit={(v) => save.mutateAsync({ ...v, expectedBy: v.expectedBy || null, ownerId: canAssign ? v.ownerId || null : undefined, customerId: quoted ? undefined : v.customerId })}>
        <div className="grid gap-3 sm:grid-cols-3">
          <SelectField name="receivedVia" label="Received on" hint="How the order reached you" options={VIA_OPTIONS} />
          <SelectField name="customerId" className="sm:col-span-2" label="Client *" disabled={quoted} options={clientOptions}
            hint={quoted ? 'Locked: a site of this order already has a quote' : 'Changing it moves all sites of this order to that client'} />
        </div>
        <OrderDetailFields />
        {canAssign && (
          <SelectField name="ownerId" label="Order owner" hint="Owns sites added to this order later; each site keeps its own engineer"
            placeholder="Not set" options={engineerOptions(engineers.data)} />
        )}
      </FormikForm>
    </Modal>
  );
};

/* ------------------------------- ORDER DRAWER ------------------------------- */
/** The client sent one more location for the same order. Closed until asked for. */
const AddSite = ({ order }) => {
  const user = useSelector((s) => s.auth.user);
  const canAssign = hasPerm(user, 'feasibility.assign');
  const [open, setOpen] = useState(false);
  const engineers = useApi(open && canAssign ? '/admin/users/lookup' : null, ENGINEER_ROLES);
  const save = useAction((sites) => post(`/orders/${order.id}/sites`, { sites }));
  if (!open) {
    return <Button size="sm" variant="outline" onClick={() => setOpen(true)}><Plus className="h-3.5 w-3.5" /> Add a site to this order</Button>;
  }
  return (
    <div className="rounded-2xl border border-line p-4">
      <p className="mb-3 text-[13px] font-semibold text-ink">New site for {order.code}</p>
      <FormikForm initialValues={{ ...BLANK_SITE, assignedTo: '' }} schema={siteSchema} busy={save.isPending} submitLabel="Add site"
        extra={<Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>}
        onSubmit={async (v) => { await save.mutateAsync([{ ...pickSite(v), assignedTo: v.assignedTo || null }]).catch(siteErrors); setOpen(false); }}>
        <SiteFields />
        {canAssign && (
          <SelectField name="assignedTo" label="Field engineer" hint={`Blank = the order owner${order.owner_name ? ` (${order.owner_name})` : ''}`}
            placeholder="Order owner" options={engineerOptions(engineers.data)} />
        )}
      </FormikForm>
    </div>
  );
};

const SitesTable = ({ sites, showMoney, showOrder }) => {
  const dispatch = useDispatch();
  return (
    <Table rows={sites} rowKey="feasibility_id" onRowClick={(r) => dispatch(openLifecycle(r.feasibility_id))} empty="No sites yet."
      columns={[
        { key: 'site', label: 'Site', render: (r) => <div><p className="font-semibold text-ink">{r.site_name}{r.client_site_ref && <span className="ml-1.5 text-[11px] font-medium text-muted">[{r.client_site_ref}]</span>}<LinkTags role={r.link_role} ips={r.static_ip_count} /></p><p className="text-[11px] text-muted">{r.site_code || r.feasibility_code}{showOrder && r.order_code ? ` · ${r.order_code}` : ''} · {formatMbps(r.bandwidth_mbps)}</p></div> },
        { key: 'owner', label: 'Owner', render: (r) => r.site_owner_name || r.owner_name || <span className="text-[#B26B00]">Unassigned</span> },
        { key: 'stage', label: 'Stage', render: (r) => <StageChip stage={r.stage} /> },
        { key: 'detail', label: 'Detail', render: (r) => <span className="text-xs text-muted">{r.stage === 'STOPPED' ? r.stop_reason : r.pending_with ? 'Pending item open' : r.live_date ? `Live ${formatDate(r.live_date)}` : r.po_number ? `PO ${r.po_number}` : r.quote_code || '—'}</span> },
        ...(showMoney ? [{ key: 'money', label: 'Billed / received', render: (r) => <span className="text-xs tnum">{r.billed ? `${formatCurrency(r.billed)} / ${formatCurrency(r.received)}` : '—'}</span> }] : [])
      ]} />
  );
};

const MoneyKV = ({ m }) => m && (
  <KV cols={3} items={[
    ['Billed', formatCurrency(m.billed)], ['Received', formatCurrency(m.received)], ['Outstanding', formatCurrency(m.outstanding)],
    m.live_mrc !== undefined && ['Live MRC', formatCurrency(m.live_mrc)],
    m.overdue_count !== undefined && ['Overdue bills', m.overdue_count ? <span key="o" className="font-semibold text-[#C0283C]">{m.overdue_count} · {formatCurrency(m.overdue_amount)}</span> : 'None']
  ]} />
);

const OrderDrawer = ({ id, onClose }) => {
  const user = useSelector((s) => s.auth.user);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(null);
  // Stop loading an order while it is being deleted, so neither the refresh nor live sync asks for it again
  const { data: o, isLoading, error } = useApi(id && deleting !== id ? `/orders/${id}` : null);
  const canChange = o && hasPerm(user, 'orders.create') && (user.role !== 'FIELD_ENGINEER' || !o.owner_id || o.owner_id === user.id);
  const quoted = o ? o.sites.filter((s) => s.quote_code) : [];
  const remove = useAction(async (order) => {
    setDeleting(order.id);
    try { const r = await del(`/orders/${order.id}`); onClose(); return r; } finally { setDeleting(null); }
  });
  const confirmDelete = () => {
    const n = o.sites.length;
    if (window.confirm(`Delete ${o.code} from ${o.customer_name}${n ? ` and its ${n} site request(s)` : ''}? Use this only for an order logged by mistake. It cannot be undone.`)) remove.mutate(o);
  };
  return (
    <Drawer open={Boolean(id)} onClose={onClose} label="Client order" width="sm:w-[760px]">
      {isLoading || !o ? (error ? <ErrorBox error={error} /> : <Loading />) : (
        <div>
          <div className="flex flex-wrap items-center gap-2 pr-10"><Code>{o.code}</Code><span className="text-xs text-muted">{VIA[o.received_via]} · {formatDate(o.received_date)}</span></div>
          <h2 className="mt-2 text-xl font-semibold text-ink">{o.customer_name}</h2>
          <p className="text-sm text-muted">{o.client_ref ? `Client ref ${o.client_ref} · ` : ''}{o.sites.length} site(s) · owner {o.owner_name || 'not set'}</p>
          {canChange && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button size="sm" variant="outline" onClick={() => setEditing(true)}><Pencil className="h-3.5 w-3.5" /> Edit order</Button>
              <Button size="sm" variant="ghost" className="text-[#C0283C]! hover:bg-[#FDF0F1]!" disabled={quoted.length > 0 || remove.isPending}
                title={quoted.length ? `${quoted.map((s) => s.feasibility_code).join(', ')} already has a quote — stop the site instead` : 'Delete an order logged by mistake'}
                onClick={confirmDelete}><Trash2 className="h-3.5 w-3.5" /> Delete order</Button>
              {quoted.length > 0 && <span className="text-[11px] text-muted">Delete is off once a site has a quote.</span>}
            </div>
          )}
          <div className="mt-3"><StageBar stages={o.stages} legend /></div>
          <Section title="Order">
            <KV cols={3} items={[
              ['Client contact', [o.client_contact_name, o.client_contact_phone, o.client_contact_email].filter(Boolean).join(' · ') || '—'],
              ['Wanted by', o.expected_by ? formatDate(o.expected_by) : '—'], ['Logged by', o.created_by_name || '—']
            ]} />
            {o.notes && <p className="mt-3 whitespace-pre-line rounded-xl bg-panel p-3 text-xs text-ink-2">{o.notes}</p>}
            {o.raw_message && <p className="mt-3 flex gap-2 whitespace-pre-line rounded-xl bg-panel p-3 text-xs italic text-ink-2"><MessageSquare className="h-4 w-4 shrink-0 text-brand-600" />{o.raw_message}</p>}
          </Section>
          {o.money && <Section title="Money from this order"><MoneyKV m={o.money} /></Section>}
          <Section title="Sites — click a row for its full journey (Site 360)"><SitesTable sites={o.sites} showMoney={Boolean(o.money)} /></Section>
          <Section title="Documents"><DocumentsPanel entityType="ORDER" entityId={o.id} types={['CLIENT_ORDER', 'OTHER']} canEdit={hasPerm(user, 'orders.create')} /></Section>
          {canChange && <Section title="Add more sites to this order"><AddSite key={o.id} order={o} /></Section>}
          <RecordActivity entityId={o.id} />
          {editing && <EditOrderModal order={o} onClose={() => setEditing(false)} />}
        </div>
      )}
    </Drawer>
  );
};

/* ------------------------------- CLIENTS ------------------------------- */
const CLIENT = { name: '', clientType: 'ENTERPRISE', gstin: '', billingAddress: '', state: '', contactName: '', contactPhone: '', contactEmail: '', creditDays: 30, billingFrequency: 'MONTHLY', notes: '', isActive: true };
const fromClient = (c) => ({ name: c.name, clientType: c.client_type, gstin: c.gstin || '', billingAddress: c.billing_address || '', state: c.state || '', contactName: c.contact_name || '', contactPhone: c.contact_phone || '', contactEmail: c.contact_email || '', creditDays: c.credit_days, billingFrequency: c.billing_frequency, notes: c.notes || '', isActive: c.is_active });

/** Mirrors POST/PUT /admin/customers (Joi) */
const clientSchema = yup.object({
  name: R.name(255).required(MSG.required),
  clientType: R.select(Object.keys(CLIENT_TYPES)),
  gstin: R.gstin(),
  billingAddress: R.text(1000),
  state: R.text(64),
  contactName: R.name(128),
  contactPhone: R.phone(),
  contactEmail: R.email(),
  creditDays: R.int(0, 365).required(MSG.required),
  billingFrequency: R.select(['MONTHLY', 'QUARTERLY']),
  notes: R.text(2000),
  isActive: yup.boolean()
});

const ClientModal = ({ edit, onClose }) => {
  const save = useAction((b) => (edit.id ? put(`/admin/customers/${edit.id}`, b) : post('/admin/customers', b)), { onSuccess: onClose });
  return (
    <Modal open onClose={onClose} title={edit.id ? 'Edit client' : 'Add client'} width="max-w-[560px]">
      <FormikForm initialValues={edit?.form || CLIENT} schema={clientSchema} busy={save.isPending} onSubmit={(v) => save.mutateAsync(v)}>
        <TextField name="name" label="Client name *" placeholder="Registered name of the client" hint="Printed in “Bill to” on invoices" />
        <div className="grid gap-3 sm:grid-cols-2">
          <SelectField name="clientType" label="Type of client" hint="Used to group clients in reports" options={Object.entries(CLIENT_TYPES).map(([value, label]) => ({ value, label }))} />
          <TextField name="gstin" label="GSTIN" hint="15 characters, e.g. 29ABCDE1234F1Z5" transform={(v) => v.toUpperCase()} maxLength={15} />
          <TextField name="state" label="State" hint="Same state as yours → CGST + SGST, else IGST" />
          <TextField name="contactName" label="Contact person" hint="Who you deal with for orders (optional)" />
          <TextField name="contactPhone" type="tel" label="Phone" hint="10–15 digits (optional)" />
          <TextField name="contactEmail" type="email" label="Email" hint="Where bills can be emailed (optional)" />
          <NumberField name="creditDays" min="0" max="365" label="Credit days" hint="Payment due = bill submission + credit days" />
          <SelectField name="billingFrequency" label="Billing cycle" hint="How often recurring bills are raised" options={[{ value: 'MONTHLY', label: 'Monthly' }, { value: 'QUARTERLY', label: 'Quarterly' }]} />
        </div>
        <TextField name="billingAddress" rows={2} label="Billing address (printed on the invoice)" hint="Address the bills are sent to" />
        <TextField name="notes" rows={2} label="Notes" hint="Anything useful about this client (optional)" />
        <CheckboxField name="isActive" label="Active" hint="Inactive clients cannot place new orders" />
      </FormikForm>
    </Modal>
  );
};

const ClientDrawer = ({ id, onClose, onOpenOrder, onEdit }) => {
  const user = useSelector((s) => s.auth.user);
  const { data: c, isLoading, error } = useApi(id ? `/clients/${id}` : null);
  return (
    <Drawer open={Boolean(id)} onClose={onClose} label="Client" width="sm:w-[760px]">
      {isLoading || !c ? (error ? <ErrorBox error={error} /> : <Loading />) : (
        <div>
          <div className="flex flex-wrap items-center gap-2 pr-10"><span className="rounded-md bg-panel px-2 py-0.5 text-[11px] font-semibold">{CLIENT_TYPES[c.client_type]}</span><Status value={c.is_active ? 'ACTIVE' : 'SUSPENDED'} /></div>
          <h2 className="mt-2 text-xl font-semibold text-ink">{c.name}</h2>
          <p className="text-sm text-muted">{c.gstin || 'No GSTIN'}{c.state ? ` · ${c.state}` : ''} · {c.billing_frequency.toLowerCase()} billing · {c.credit_days} days credit</p>
          {hasPerm(user, 'masters.manage') && <div className="mt-3"><Button size="sm" variant="outline" onClick={() => onEdit(c)}><Pencil className="h-3.5 w-3.5" /> Edit client</Button></div>}
          <div className="mt-3"><StageBar stages={c.stages} legend /></div>
          <Section title="Contact & billing"><KV cols={2} items={[['Contact', [c.contact_name, c.contact_phone, c.contact_email].filter(Boolean).join(' · ') || '—'], ['Billing address', c.billing_address || '—']]} />{c.notes && <p className="mt-3 whitespace-pre-line rounded-xl bg-panel p-3 text-xs text-ink-2">{c.notes}</p>}</Section>
          {c.money && <Section title="Account"><MoneyKV m={c.money} /></Section>}
          <Section title={`Orders (${c.orders.length})`}>
            <Table rows={c.orders} onRowClick={(o) => onOpenOrder(o.id)} empty="No orders from this client yet."
              columns={[
                { key: 'code', label: 'Order', render: (o) => <div><Code>{o.code}</Code><p className="mt-0.5 text-[11px] text-muted">{o.client_ref || VIA[o.received_via]}</p></div> },
                { key: 'date', label: 'Received', render: (o) => <span className="text-xs">{formatDate(o.received_date)}</span> },
                { key: 'owner', label: 'Owner', render: (o) => o.owner_name || '—' },
                { key: 'stages', label: `Sites`, render: (o) => <StageBar stages={o.stages} /> }
              ]} />
          </Section>
          <Section title={`All sites (${c.sites.length})`}><SitesTable sites={c.sites} showMoney={Boolean(c.money)} showOrder /></Section>
        </div>
      )}
    </Drawer>
  );
};

/* ----------------------------------- PAGE ----------------------------------- */
export const ClientsPage = () => {
  const user = useSelector((s) => s.auth.user);
  const isEngineer = user.role === 'FIELD_ENGINEER';
  const [tab, setTab] = useState('orders');
  const [q, setQ] = useState('');
  const [mine, setMine] = useState(isEngineer);
  const [newOpen, setNewOpen] = useState(false);
  const [orderId, setOrderId] = useState(null);
  const [clientId, setClientId] = useState(null);
  const [editClient, setEditClient] = useState(null);
  const focus = useCallback((id) => { if (id === 'new') setNewOpen(true); else { setTab('orders'); setOrderId(id); } }, []);
  useFocusRecord('orders', focus);
  const orders = useApi('/orders', mine ? { mine: '1' } : undefined);
  const clients = useApi('/clients');
  const showMoney = hasPerm(user, 'billing.view');

  const orderRows = useMemo(() => filterBy(orders.data || [], q, ['code', 'customer_name', 'client_ref', 'owner_name']), [orders.data, q]);
  const clientRows = useMemo(() => filterBy(clients.data || [], q, ['name', 'gstin', 'state', 'contact_name']), [clients.data, q]);

  return (
    <motion.div variants={page} initial="hidden" animate="visible" exit="exit" className="space-y-4">
      <PageHeader title="Clients & Orders" subtitle="Clients send orders on WhatsApp / email → your team logs them here → every site is tracked to delivery and billing"
        actions={(
          <div className="flex flex-wrap gap-2">
            {hasPerm(user, 'orders.create') && <Button onClick={() => setNewOpen(true)}><Plus className="h-4 w-4" /> New client order</Button>}
            {hasPerm(user, 'masters.manage') && <Button variant="outline" onClick={() => setEditClient({ form: CLIENT })}><Plus className="h-4 w-4" /> Add client</Button>}
          </div>
        )} />
      <div className="flex flex-wrap items-center gap-3">
        <PillTabs value={tab} onChange={setTab} options={[{ id: 'orders', label: 'Orders', count: orders.data?.length ?? 0 }, { id: 'clients', label: 'Clients', count: clients.data?.length ?? 0 }]} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter…" className={`${inputClass} max-w-[220px]`} aria-label="Filter" />
        {tab === 'orders' && <label className="flex items-center gap-1.5 text-xs font-medium text-ink-2"><input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} /> Only mine</label>}
      </div>

      {tab === 'orders' ? (orders.isLoading ? <Loading /> : orders.error ? <ErrorBox error={orders.error} /> : (
        <motion.div variants={rise}>
          <Table rows={orderRows} onRowClick={(o) => setOrderId(o.id)} empty={mine ? 'No orders of yours yet — log the client’s order with “New client order”.' : 'No client orders yet — log the first one with “New client order”.'}
            columns={[
              { key: 'code', label: 'Order', render: (o) => <Code>{o.code}</Code> },
              { key: 'client', label: 'Client / ref', render: (o) => <div><p className="font-semibold text-ink">{o.customer_name}</p><p className="text-[11px] text-muted">{o.client_ref || '—'}</p></div> },
              { key: 'via', label: 'Received', render: (o) => <span className="whitespace-nowrap text-xs">{VIA[o.received_via]} · {formatDate(o.received_date)}</span> },
              { key: 'owner_name', label: 'Owner', render: (o) => o.owner_name || <span className="text-[#B26B00]">Not set</span> },
              { key: 'sites', label: 'Sites', render: (o) => <span className="tnum font-semibold">{o.site_count}</span> },
              { key: 'progress', label: 'Progress', render: (o) => <StageBar stages={o.stages} /> },
              ...(showMoney ? [{ key: 'out', label: 'Outstanding', render: (o) => <span className="tnum text-xs">{o.money ? formatCurrency(o.money.outstanding) : '—'}</span> }] : [])
            ]} />
        </motion.div>
      )) : (clients.isLoading ? <Loading /> : clients.error ? <ErrorBox error={clients.error} /> : (
        <motion.div variants={rise}>
          <Table rows={clientRows} onRowClick={(c) => setClientId(c.id)} empty="No clients yet. Add the companies that send you orders."
            columns={[
              { key: 'name', label: 'Client', render: (c) => <div><p className="font-semibold text-ink">{c.name}</p><p className="text-[11px] text-muted">{CLIENT_TYPES[c.client_type]}{c.state ? ` · ${c.state}` : ''}</p></div> },
              { key: 'orders', label: 'Orders', render: (c) => <span className="tnum">{c.order_count}{c.last_order_date ? <span className="block text-[11px] text-muted">last {formatDate(c.last_order_date)}</span> : null}</span> },
              { key: 'sites', label: 'Sites', render: (c) => <StageBar stages={c.stages} /> },
              ...(showMoney ? [{ key: 'out', label: 'Outstanding', render: (c) => <span className="tnum text-xs">{c.money ? formatCurrency(c.money.outstanding) : '—'}</span> }] : []),
              { key: 'terms', label: 'Billing', render: (c) => <span className="text-xs">{c.billing_frequency.toLowerCase()} · {c.credit_days}d</span> },
              { key: 'st', label: 'Status', render: (c) => <Status value={c.is_active ? 'ACTIVE' : 'SUSPENDED'} /> }
            ]} />
        </motion.div>
      ))}

      <NewOrderModal open={newOpen} onClose={() => setNewOpen(false)} onCreated={(id) => { setTab('orders'); setOrderId(id); }} />
      <OrderDrawer id={orderId} onClose={() => setOrderId(null)} />
      <ClientDrawer id={clientId} onClose={() => setClientId(null)} onOpenOrder={(id) => { setClientId(null); setOrderId(id); }} onEdit={(c) => setEditClient({ id: c.id, form: fromClient(c) })} />
      {editClient && <ClientModal edit={editClient} onClose={() => setEditClient(null)} />}
    </motion.div>
  );
};

export default ClientsPage;
