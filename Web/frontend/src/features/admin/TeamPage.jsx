import React, { useState } from 'react';
import { useSelector } from 'react-redux';
import { motion } from 'framer-motion';
import { Plus, Pencil, KeyRound } from 'lucide-react';
import { page, rise } from '../../utils/motion';
import { Button, Status, Card } from '../../components/common/ui';
import PageHeader from '../../components/common/PageHeader';
import { Modal } from '../../components/common/Overlay';
import { Table, Loading, ErrorBox } from '../../components/common/kit';
import { FormikForm, TextField, SelectField, CheckboxField } from '../../components/form/FormKit';
import { R, MSG, yup } from '../../validation/rules';
import { useApi, useAction } from '../../api/hooks';
import { post, patch } from '../../api/client';
import { formatDateTime } from '../../utils/formatters';
import { CredentialsNotice } from '../platform/PlatformPage';

const ROLE_HELP = {
  TENANT_ADMIN: 'Everything, including team, masters & settings',
  COMMERCIAL_MANAGER: 'Clients, assign field engineers, finalize price, quotes, bid win & budget',
  FIELD_ENGINEER: 'Your field team: paste client orders from WhatsApp / email, survey ISPs, and deliver their own sites — work start, pending items, go-live',
  OPERATIONS: 'Assign field engineers, record client POs (one PO for many sites), hand sites over, run any delivery step',
  BILLING_EXEC: 'Bill submission, cycles, record client payments',
  FINANCE_HEAD: 'Billing + payment waterfall + vendor/loan/salary payouts'
};

const BLANK = { name: '', email: '', phone: '', zone: '', role: 'FIELD_ENGINEER', password: '', isActive: true };
const userSchema = (isNew) => yup.object({
  name: R.name(128).required(MSG.required),
  email: R.email().required(MSG.required),
  phone: R.phone(),
  zone: R.text(64),
  role: yup.string().required(MSG.required),
  password: isNew ? R.password() : yup.string().strip(),
  isActive: yup.boolean()
});

export const TeamPage = () => {
  const me = useSelector((s) => s.auth.user);
  const users = useApi('/admin/users');
  const workload = useApi('/admin/team/workload');
  const roles = useApi('/admin/roles');
  const [edit, setEdit] = useState(null);
  const [creds, setCreds] = useState(null);

  const save = useAction(({ id, form }) => (id ? patch(`/admin/users/${id}`, { name: form.name, email: form.email, phone: form.phone, zone: form.zone, role: form.role, isActive: form.isActive }) : post('/admin/users', { name: form.name, email: form.email, phone: form.phone, zone: form.zone, role: form.role, password: form.password })), {
    onSuccess: (res, vars) => {
      setEdit(null);
      if (!vars.id) setCreds({ email: res.data.user.email, password: res.data.temporaryPassword });
    }
  });
  const reset = useAction((id) => post(`/admin/users/${id}/reset-password`), { onSuccess: (res) => setCreds({ email: res.data.email, password: res.data.temporaryPassword }) });
  const roleLabel = (r) => roles.data?.find((x) => x.id === r)?.label || r;

  return (
    <motion.div variants={page} initial="hidden" animate="visible" exit="exit" className="space-y-4">
      <PageHeader title="Team & Roles" subtitle="Add each person once — field engineers appear in the assign lists and own their sites from order to delivery."
        actions={<Button onClick={() => setEdit({ form: BLANK })}><Plus className="h-4 w-4" /> Add user</Button>} />

      <motion.div variants={rise}>
        <Card className="grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-3">
          {Object.entries(ROLE_HELP).map(([r, h]) => (
            <div key={r}><span className="font-semibold text-ink">{roleLabel(r)}</span><span className="text-muted"> — {h}</span></div>
          ))}
        </Card>
      </motion.div>

      {workload.data?.length > 0 && (
        <motion.div variants={rise}>
          <h3 className="mb-2 text-sm font-semibold text-ink">Field team workload</h3>
          <Table rows={workload.data} columns={[
            { key: 'name', label: 'Engineer', render: (u) => <div><p className="font-semibold text-ink">{u.name}</p><p className="text-[11px] text-muted">{roleLabel(u.role)}{u.zone ? ` · ${u.zone}` : ''}</p></div> },
            { key: 'surveys_open', label: 'Surveys open', render: (u) => <span className="tnum">{u.surveys_open}</span> },
            { key: 'awaiting', label: 'With commercial', render: (u) => <span className="tnum">{u.awaiting_completion}</span> },
            { key: 'sites', label: 'Sites in delivery', render: (u) => <span className="tnum">{u.sites_in_delivery}{u.sites_blocked ? <span className="ml-1 text-[11px] text-[#C0283C]">({u.sites_blocked} pending)</span> : null}</span> },
            { key: 'sla', label: 'SLA overdue', render: (u) => <span className={`tnum ${u.sla_overdue ? 'font-semibold text-[#C0283C]' : ''}`}>{u.sla_overdue}</span> },
            { key: 'delivered', label: 'Delivered (live)', render: (u) => <span className="tnum">{u.delivered}</span> }
          ]} />
        </motion.div>
      )}

      {users.isLoading ? <Loading /> : users.error ? <ErrorBox error={users.error} /> : (
        <motion.div variants={rise}>
          <Table rows={users.data} columns={[
            { key: 'name', label: 'Name', render: (u) => <div><p className="font-semibold text-ink">{u.name}{u.id === me.id && <span className="ml-1.5 text-[10px] text-muted">(you)</span>}</p><p className="text-[11px] text-muted">{u.email}</p></div> },
            { key: 'role', label: 'Role', render: (u) => roleLabel(u.role) },
            { key: 'zone', label: 'Zone', render: (u) => u.zone || '—' },
            { key: 'login', label: 'Last sign-in', render: (u) => <span className="text-xs">{u.last_login_at ? formatDateTime(u.last_login_at) : 'Never'}{u.must_change_password && <span className="ml-1 text-[#B26B00]">· temp password</span>}</span> },
            { key: 'st', label: 'Status', render: (u) => <Status value={u.is_active ? 'ACTIVE' : 'SUSPENDED'} /> },
            { key: 'a', label: '', render: (u) => (
              <div className="flex justify-end gap-1">
                <Button size="sm" variant="ghost" title="Reset password" onClick={() => window.confirm(`Reset password for ${u.name}?`) && reset.mutate(u.id)}><KeyRound className="h-3.5 w-3.5" /></Button>
                <Button size="sm" variant="ghost" title="Edit" onClick={() => setEdit({ id: u.id, form: { name: u.name, email: u.email, phone: u.phone || '', zone: u.zone || '', role: u.role, isActive: u.is_active } })}><Pencil className="h-3.5 w-3.5" /></Button>
              </div>
            ) }
          ]} />
        </motion.div>
      )}

      <Modal open={Boolean(edit)} onClose={() => setEdit(null)} title={edit?.id ? 'Edit user' : 'Add user'}>
        {edit && (
          <FormikForm initialValues={{ ...BLANK, ...edit.form }} schema={userSchema(!edit.id)} busy={save.isPending}
            onSubmit={(v) => save.mutateAsync({ id: edit.id, form: v })} submitLabel={edit.id ? 'Save' : 'Create login'}>
            {({ values }) => (
              <>
                <TextField name="name" label="Full name *" hint="As it should appear on screens and in the activity log" />
                <TextField name="email" type="email" label="Email (login) *" hint="They sign in with this email; must be unique" />
                <div className="grid gap-3 sm:grid-cols-2">
                  <TextField name="phone" type="tel" label="Phone" hint="10–15 digits (optional)" />
                  <TextField name="zone" label="Zone / area" placeholder="South, North…" hint="Area they cover (optional)" />
                </div>
                <SelectField name="role" label="Role *" hint={ROLE_HELP[values.role] || 'Decides which menus and actions they get'}
                  options={(roles.data || []).map((r) => ({ value: r.id, label: r.label }))} />
                {!edit.id && <TextField name="password" label="Temporary password" hint="Leave blank to auto-generate. If set: 8+ characters with a letter and a number" />}
                {edit.id && <CheckboxField name="isActive" label="Active" hint="Untick to stop this person signing in (their history is kept)" />}
              </>
            )}
          </FormikForm>
        )}
      </Modal>
      <CredentialsNotice creds={creds} onClose={() => setCreds(null)} />
    </motion.div>
  );
};

export default TeamPage;
