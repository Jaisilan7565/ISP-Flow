import React, { useState } from 'react';
import { useSelector } from 'react-redux';
import { motion } from 'framer-motion';
import { AlertTriangle, Loader2, Trash2 } from 'lucide-react';
import { Button } from '../../../components/common/ui';
import { Modal, Field, inputClass } from '../../../components/common/Overlay';
import { page, rise } from '../../../utils/motion';
import { Card, CardTitle } from '../../../components/common/ui';
import PageHeader from '../../../components/common/PageHeader';
import { Loading, ErrorBox, NextStep } from '../../../components/common/kit';
import { FormikForm, TextField, NumberField, FormError } from '../../../components/form/FormKit';
import { R, MSG, yup, totals100 } from '../../../validation/rules';
import { useApi, useAction } from '../../../api/hooks';
import { put, post } from '../../../api/client';
import { formatCurrency } from '../../../utils/formatters';
import { shortName } from '../../../utils/names';

const toForm = (s) => ({
  gstPct: s.gst_pct, defaultVendorPct: s.default_vendor_pct, defaultPartnerPct: s.default_partner_pct, defaultCapexPct: s.default_capex_pct,
  defaultContractMonths: s.default_contract_months, defaultCreditDays: s.default_credit_days, defaultSlaDays: s.default_sla_days,
  monthlySalaryBurn: s.monthly_salary_burn, salaryReserveMonths: s.salary_reserve_months, loanEmiMonthly: s.loan_emi_monthly, loanAccountRef: s.loan_account_ref || '',
  authorityLabel: s.authority_label, invoicePrefix: s.invoice_prefix,
  companyGstin: s.company_gstin || '', companyAddress: s.company_address || '', companyState: s.company_state || ''
});

/** Mirrors PUT /admin/settings (Joi) */
const schema = yup.object({
  companyGstin: R.gstin(),
  companyState: R.text(64),
  companyAddress: R.text(1000),
  gstPct: R.number().min(0, 'Must be 0–40').max(40, 'Must be 0–40').required(MSG.required),
  invoicePrefix: R.invoicePrefix().required(MSG.required),
  defaultCreditDays: R.int(0, 365).required(MSG.required),
  defaultVendorPct: R.pct().required(MSG.required),
  defaultPartnerPct: R.pct().required(MSG.required),
  defaultCapexPct: totals100('defaultVendorPct', 'defaultPartnerPct', 'defaultCapexPct')(R.pct().required(MSG.required)),
  defaultContractMonths: R.int(1, 120).required(MSG.required),
  defaultSlaDays: R.int(1, 365).required(MSG.required),
  authorityLabel: R.name(64).required(MSG.required),
  monthlySalaryBurn: R.money().required(MSG.required),
  salaryReserveMonths: R.int(0, 24).required(MSG.required),
  loanEmiMonthly: R.money().required(MSG.required),
  loanAccountRef: R.text(128)
});

export const SettingsPage = () => {
  const user = useSelector((s) => s.auth.user);
  const q = useApi('/admin/settings');
  const save = useAction((body) => put('/admin/settings', body));

  if (q.isLoading || !q.data) return q.error ? <ErrorBox error={q.error} /> : <Loading />;
  const company = shortName(q.data.company_name) || 'Own';

  return (
    <motion.div variants={page} initial="hidden" animate="visible" exit="exit" className="space-y-4">
      <PageHeader title="Company Settings" subtitle={`${q.data.company_name} · these values drive pricing, billing and the payment waterfall`} />
      <motion.div variants={rise}>
        <FormikForm initialValues={toForm(q.data)} schema={schema} enableReinitialize onSubmit={(v) => save.mutateAsync(v)} busy={save.isPending} submitLabel="Save settings">
          {({ values }) => {
            const n = (k) => Number(values[k]) || 0;
            const abc = n('defaultVendorPct') + n('defaultPartnerPct') + n('defaultCapexPct');
            return (
              <div className="grid gap-4 lg:grid-cols-2">
                <Card className="space-y-3">
                  <CardTitle>Company & invoices</CardTitle>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <TextField name="companyGstin" label="Company GSTIN (printed on invoices)" hint="15 characters, e.g. 29ABCDE1234F1Z5" transform={(v) => v.toUpperCase()} maxLength={15} />
                    <TextField name="companyState" label="State" hint="Same state as the client → CGST + SGST, otherwise IGST" />
                  </div>
                  <TextField name="companyAddress" rows={2} label="Registered address" hint="Printed in the invoice header" />
                  <div className="grid gap-3 sm:grid-cols-3">
                    <NumberField name="gstPct" min="0" max="40" label="GST %" hint="Usually 18 for telecom services" />
                    <TextField name="invoicePrefix" label="Invoice prefix" hint="1–16 letters/digits, e.g. ACME" transform={(v) => v.toUpperCase()} maxLength={16} />
                    <NumberField name="defaultCreditDays" min="0" max="365" label="Default credit days" hint="Due date = bill submission + these days" />
                  </div>
                </Card>
                <Card className="space-y-3">
                  <CardTitle>Quote & budget defaults</CardTitle>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <NumberField name="defaultVendorPct" min="0" max="100" label="A % to vendor" hint="Share of the deal for the ISP" />
                    <NumberField name="defaultPartnerPct" min="0" max="100" label={`B % ${company} share`} hint="Kept by your company" />
                    <NumberField name="defaultCapexPct" min="0" max="100" label="C % site implementation" hint="CPE, cabling, field work" />
                  </div>
                  <p className={`text-xs ${Math.abs(abc - 100) > 0.01 ? 'font-semibold text-[#C0283C]' : 'text-muted'}`}>A + B + C = {abc}% {Math.abs(abc - 100) > 0.01 && '(must be 100%)'}</p>
                  <FormError name="defaultCapexPct" />
                  <div className="grid gap-3 sm:grid-cols-2">
                    <NumberField name="defaultContractMonths" min="1" max="120" label="Default contract months" hint="Used for the quote value: OTC + MRC × months (1–120)" />
                    <NumberField name="defaultSlaDays" min="1" max="365" label="Default delivery SLA days" hint="Days from work start to go-live (1–365)" />
                  </div>
                  <TextField name="authorityLabel" label="Label for “Pending with ROW / authority”" hint="Clients and your own company are shown by their own names" />
                </Card>
                <Card className="space-y-3 lg:col-span-2">
                  <CardTitle>Payment waterfall (Vendor → Loan → Salary)</CardTitle>
                  <NextStep>Every customer payment first covers that site's vendor cost, then this month's loan EMI, then tops up the salary reserve to <b>{values.salaryReserveMonths} months × {formatCurrency(n('monthlySalaryBurn'))} = {formatCurrency(n('salaryReserveMonths') * n('monthlySalaryBurn'))}</b>. Anything left is surplus.</NextStep>
                  <div className="grid gap-3 sm:grid-cols-4">
                    <NumberField name="monthlySalaryBurn" min="0" label="Monthly salary & overheads (₹)" hint="Total monthly payroll and fixed costs" />
                    <NumberField name="salaryReserveMonths" min="0" max="24" label="Reserve months" hint="Months of salary to keep in reserve (sketch: 3)" />
                    <NumberField name="loanEmiMonthly" min="0" label="Loan EMI per month (₹)" hint="0 if there is no loan" />
                    <TextField name="loanAccountRef" label="Loan account ref" hint="Shown on loan payouts (optional)" />
                  </div>
                </Card>
              </div>
            );
          }}
        </FormikForm>
      </motion.div>
      {user?.role === 'TENANT_ADMIN' && <DangerZone companyName={q.data.company_name} />}
    </motion.div>
  );
};

/* ------------------------------ DANGER ZONE ------------------------------ */
const WIPED = ['Client orders and every site request (feasibility, surveys)', 'Quotes, sites in delivery and live sites', 'Bills, credit notes, payments received, payouts and ISP bills', 'Uploaded documents and the activity history', 'Record numbers restart (ORD-…-0001, FEAS-…-0001, invoices …)'];
const KEPT = ['Your company, users and their logins', 'These company settings'];

const ClearDataModal = ({ companyName, onClose }) => {
  const [form, setForm] = useState({ confirmName: '', password: '', keepMasters: false });
  const [errors, setErrors] = useState({});
  const clear = useAction((b) => post('/admin/data/clear', b), { onSuccess: onClose });
  const nameOk = form.confirmName.trim().toLowerCase() === companyName.trim().toLowerCase();
  const submit = async (e) => {
    e.preventDefault();
    setErrors({});
    try { await clear.mutateAsync(form); } catch (err) {
      setErrors(Object.fromEntries((err.errors || []).map((x) => [x.field, x.message])));
    }
  };
  return (
    <Modal open onClose={onClose} title="Clear all company data" width="max-w-[560px]">
      <form onSubmit={submit} className="space-y-4">
        <div className="rounded-xl border border-[#E0566A] bg-[#FDF0F1] p-3.5 text-[13px] text-[#8E1B2C]">
          <p className="flex items-center gap-1.5 font-semibold"><AlertTriangle className="h-4 w-4" /> This permanently deletes {companyName}'s data. It cannot be undone.</p>
          <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs">
            {WIPED.map((x) => <li key={x}>{x}</li>)}
            {!form.keepMasters && <li>Clients and ISPs / vendors</li>}
          </ul>
          <p className="mt-2 text-xs"><b>Kept:</b> {[...KEPT, ...(form.keepMasters ? ['Clients and ISPs / vendors'] : [])].join(' · ')}</p>
          <p className="mt-2 text-xs">Download any bills or reports you need first. If real invoices were already sent to clients, numbering restarting can clash with them.</p>
        </div>
        <label className="flex items-start gap-2 text-[13px] text-ink-2">
          <input type="checkbox" className="mt-0.5" checked={form.keepMasters} onChange={(e) => setForm((f) => ({ ...f, keepMasters: e.target.checked }))} />
          <span>Keep clients and ISPs / vendors <span className="block text-[11px] text-muted">Delete only orders and everything after them — useful after a test run or a wrong import</span></span>
        </label>
        <Field label={<>Type <b className="text-ink">{companyName}</b> to confirm</>} hint={errors.confirmName}>
          <input value={form.confirmName} onChange={(e) => setForm((f) => ({ ...f, confirmName: e.target.value }))} className={inputClass} autoComplete="off" />
        </Field>
        <Field label="Your password" hint={errors.password}>
          <input type="password" value={form.password} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} className={inputClass} autoComplete="current-password" />
        </Field>
        <div className="flex justify-end gap-2 border-t border-line pt-4">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={!nameOk || !form.password || clear.isPending} className="bg-[#C0283C]! text-white! shadow-none! hover:bg-[#A11F31]!">
            {clear.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />} Delete all data
          </Button>
        </div>
      </form>
    </Modal>
  );
};

const DangerZone = ({ companyName }) => {
  const [open, setOpen] = useState(false);
  return (
    <motion.div variants={rise}>
      <Card className="border border-[#E0566A]/50">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle className="text-[#C0283C]">Danger zone</CardTitle>
            <p className="mt-1 text-xs text-muted">Clear all orders, sites, bills, payments and documents of {companyName} to start fresh — for example after testing or a wrong import. Users and settings are kept. Company Admin only.</p>
          </div>
          <Button variant="outline" className="border-[#C0283C]! text-[#C0283C]! hover:bg-[#FDF0F1]!" onClick={() => setOpen(true)}><Trash2 className="h-4 w-4" /> Clear all company data…</Button>
        </div>
      </Card>
      {open && <ClearDataModal companyName={companyName} onClose={() => setOpen(false)} />}
    </motion.div>
  );
};

export default SettingsPage;
