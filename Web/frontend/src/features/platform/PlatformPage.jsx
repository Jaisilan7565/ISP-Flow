import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Plus, Building2, KeyRound, Power, Copy, Pencil } from 'lucide-react';
import { page, rise, list } from '../../utils/motion';
import { Card, Button, Status } from '../../components/common/ui';
import PageHeader from '../../components/common/PageHeader';
import { Modal } from '../../components/common/Overlay';
import { Table, Loading, ErrorBox, NextStep } from '../../components/common/kit';
import { FormikForm, TextField } from '../../components/form/FormKit';
import { R, MSG, yup } from '../../validation/rules';
import { useApi, useAction } from '../../api/hooks';
import { post, patch } from '../../api/client';
import { formatCurrency, formatDateTime } from '../../utils/formatters';
import AnimatedNumber from '../../components/common/AnimatedNumber';

const Stat = ({ label, value, money }) => (
  <Card>
    <p className="text-xs font-medium text-muted">{label}</p>
    <p className="mt-1.5 text-2xl font-semibold text-ink tnum">{money ? formatCurrency(value) : <AnimatedNumber value={value} />}</p>
  </Card>
);

export const CredentialsNotice = ({ creds, onClose }) => (
  <Modal open={Boolean(creds)} onClose={onClose} title="Login created">
    {creds && (
      <div className="space-y-3">
        <NextStep tone="warn">Share these details privately. The temporary password is shown only once; the user must set their own password at first sign-in.</NextStep>
        <div className="rounded-xl border border-line bg-panel p-3 font-mono text-sm">
          <div>Email: <b>{creds.email}</b></div>
          <div>Temporary password: <b>{creds.password}</b></div>
          <div className="mt-1 text-xs text-muted">Sign-in page: {window.location.origin}</div>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => navigator.clipboard?.writeText(`Email: ${creds.email}\nTemporary password: ${creds.password}\nSign in: ${window.location.origin}`)}>
            <Copy className="h-4 w-4" /> Copy
          </Button>
          <Button onClick={onClose}>Done</Button>
        </div>
      </div>
    )}
  </Modal>
);

/** Company details — shared by "Onboard company" and "Edit company". */
const companySchema = {
  name: R.name(255).required(MSG.required),
  code: R.companyCode().required(MSG.required),
  gstin: R.gstin(),
  state: R.text(64),
  address: R.text(1000),
  contactEmail: R.email(),
  contactPhone: R.phone()
};

const CompanyFields = () => (
  <>
    <div className="grid gap-3 sm:grid-cols-[1fr_160px]">
      <TextField name="name" label="Company name *" hint="Registered name of the ISP company, as printed on its invoices" />
      <TextField name="code" label="Short code *" hint="2–16 letters/digits, e.g. ACME" transform={(v) => v.toUpperCase()} maxLength={16} />
    </div>
    <div className="grid gap-3 sm:grid-cols-2">
      <TextField name="gstin" label="GSTIN" hint="15 characters, e.g. 29ABCDE1234F1Z5 (optional)" transform={(v) => v.toUpperCase()} maxLength={15} />
      <TextField name="state" label="State" hint="Used for CGST + SGST vs IGST on invoices" />
      <TextField name="contactEmail" type="email" label="Contact email" hint="Company's general email (optional)" />
      <TextField name="contactPhone" type="tel" label="Contact phone" hint="10–15 digits, e.g. 9800000000 (optional)" />
    </div>
    <TextField name="address" rows={2} label="Address" hint="Registered address, printed on invoices" />
  </>
);

const fromTenant = (t) => ({
  name: t.name || '', code: t.code || '', gstin: t.gstin || '', state: t.state || '', address: t.address || '',
  contactEmail: t.contact_email || '', contactPhone: t.contact_phone || '',
  admin: t.admin ? { name: t.admin.name || '', email: t.admin.email || '', phone: t.admin.phone || '' } : null
});

const editSchema = yup.object({
  ...companySchema,
  admin: yup.object({
    name: R.name(255).required(MSG.required),
    email: R.email().required(MSG.required),
    phone: R.phone()
  }).nullable().default(null)
});

const EditCompanyModal = ({ tenant, onClose }) => {
  const save = useAction((body) => patch(`/platform/tenants/${tenant.id}`, body), { onSuccess: onClose });
  return (
    <Modal open onClose={onClose} title={`Edit company · ${tenant.name}`} width="max-w-[620px]">
      <FormikForm initialValues={fromTenant(tenant)} schema={editSchema} busy={save.isPending} submitLabel="Save changes"
        onSubmit={(v) => {
          const { admin, ...company } = v;
          return save.mutateAsync(admin ? { ...company, admin } : company);
        }}>
        {({ values }) => (
          <>
            <CompanyFields />
            {values.admin && (
              <>
                <p className="pt-2 text-[13px] font-semibold uppercase tracking-wide text-muted">Company admin login</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <TextField name="admin.name" label="Admin name *" hint="Person who will manage this company" />
                  <TextField name="admin.email" type="email" label="Admin email (sign-in) *" hint="They sign in with this email" />
                  <TextField name="admin.phone" type="tel" label="Admin phone" hint="10–15 digits (optional)" />
                </div>
                {tenant.admin && values.admin.email.trim().toLowerCase() !== tenant.admin.email && (
                  <NextStep tone="warn">The admin will sign in with the new email from now on. The password stays the same. To issue a new password, use the key button.</NextStep>
                )}
              </>
            )}
            <p className="text-xs text-muted">To suspend or activate the company, use the button on its row. The company admin manages users, clients and settings inside the company.</p>
          </>
        )}
      </FormikForm>
    </Modal>
  );
};

const blank = { name: '', code: '', gstin: '', state: '', address: '', contactEmail: '', contactPhone: '', admin: { name: '', email: '', phone: '', password: '' } };
const onboardSchema = yup.object({
  ...companySchema,
  admin: yup.object({
    name: R.name(255).required(MSG.required),
    email: R.email().required(MSG.required),
    phone: R.phone(),
    password: R.password()
  })
});

export const PlatformPage = () => {
  const stats = useApi('/platform/stats');
  const tenants = useApi('/platform/tenants');
  const [open, setOpen] = useState(false);
  const [creds, setCreds] = useState(null);
  const [editing, setEditing] = useState(null);

  const create = useAction((body) => post('/platform/tenants', body), {
    onSuccess: (res) => {
      setOpen(false);
      setCreds({ email: res.data.admin.email, password: res.data.temporaryPassword });
    }
  });
  const setStatus = useAction(({ id, status }) => patch(`/platform/tenants/${id}/status`, { status }));
  const reset = useAction((id) => post(`/platform/tenants/${id}/reset-admin-password`), {
    onSuccess: (res) => setCreds({ email: res.data.email, password: res.data.temporaryPassword })
  });

  const s = stats.data || {};
  return (
    <motion.div variants={page} initial="hidden" animate="visible" exit="exit" className="space-y-4">
      <PageHeader title="ISP Companies" subtitle="Platform Admin · onboard each ISP company and its Company Admin. Everything else is set up by that admin."
        actions={<Button onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> Onboard company</Button>} />

      <motion.div variants={list} className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Companies (active)" value={s.active_tenants || 0} />
        <Stat label="Users" value={s.users || 0} />
        <Stat label="Live sites" value={s.live_sites || 0} />
        <Stat label="Billed across platform" value={s.billed_total || 0} money />
      </motion.div>

      {tenants.isLoading ? <Loading /> : tenants.error ? <ErrorBox error={tenants.error} /> : (
        <motion.div variants={rise}>
          <Table
            rows={tenants.data}
            empty="No companies yet — click “Onboard company” to add the first ISP."
            columns={[
              { key: 'name', label: 'Company', render: (t) => (
                <div className="flex items-center gap-2.5">
                  <span className="grid h-8 w-8 place-items-center rounded-xl bg-brand-100 text-brand-800"><Building2 className="h-4 w-4" /></span>
                  <div><p className="font-semibold text-ink">{t.name}</p><p className="font-mono text-[11px] text-muted">{t.code} {t.gstin ? `· ${t.gstin}` : ''}</p></div>
                </div>
              ) },
              { key: 'admin', label: 'Company admin', render: (t) => t.admin ? (
                <div><p className="text-ink">{t.admin.name}</p><p className="text-[11px] text-muted">{t.admin.email} · last login {t.admin.last_login_at ? formatDateTime(t.admin.last_login_at) : 'never'}</p></div>
              ) : '—' },
              { key: 'usage', label: 'Usage', render: (t) => <span className="text-xs tnum">{t.user_count} users · {t.feasibility_count} requests · {t.live_sites} live</span> },
              { key: 'billed_total', label: 'Billed', render: (t) => <span className="tnum">{formatCurrency(t.billed_total)}</span> },
              { key: 'status', label: 'Status', render: (t) => <Status value={t.status} /> },
              { key: 'actions', label: '', render: (t) => (
                <div className="flex justify-end gap-1.5">
                  <Button size="sm" variant="ghost" title="Edit company" aria-label={`Edit ${t.name}`} onClick={() => setEditing(t)}><Pencil className="h-3.5 w-3.5" /></Button>
                  <Button size="sm" variant="ghost" title="Reset admin password" onClick={() => window.confirm(`Reset the admin password for ${t.name}?`) && reset.mutate(t.id)}><KeyRound className="h-3.5 w-3.5" /></Button>
                  <Button size="sm" variant="outline" onClick={() => {
                    const next = t.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE';
                    if (window.confirm(`${next === 'SUSPENDED' ? 'Suspend' : 'Activate'} ${t.name}? ${next === 'SUSPENDED' ? 'All its users will be signed out immediately.' : ''}`)) setStatus.mutate({ id: t.id, status: next });
                  }}>
                    <Power className="h-3.5 w-3.5" /> {t.status === 'ACTIVE' ? 'Suspend' : 'Activate'}
                  </Button>
                </div>
              ) }
            ]}
          />
        </motion.div>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title="Onboard ISP company" width="max-w-[620px]">
        <FormikForm initialValues={blank} schema={onboardSchema} busy={create.isPending} submitLabel="Create company & admin login"
          onSubmit={(v) => create.mutateAsync(v)}>
          <CompanyFields />
          <p className="pt-2 text-[13px] font-semibold uppercase tracking-wide text-muted">Company admin login</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField name="admin.name" label="Admin name *" hint="Person who will set up and manage this company" />
            <TextField name="admin.email" type="email" label="Admin email *" hint="They sign in with this email" />
            <TextField name="admin.phone" type="tel" label="Admin phone" hint="10–15 digits (optional)" />
            <TextField name="admin.password" label="Temporary password" hint="Leave blank to auto-generate. If set: 8+ characters with a letter and a number" />
          </div>
        </FormikForm>
      </Modal>

      {editing && <EditCompanyModal key={editing.id} tenant={editing} onClose={() => setEditing(null)} />}
      <CredentialsNotice creds={creds} onClose={() => setCreds(null)} />
    </motion.div>
  );
};

export default PlatformPage;
