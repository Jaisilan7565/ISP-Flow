import React, { useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { motion } from 'framer-motion';
import { Plus, Building, Landmark, Users, Sparkles } from 'lucide-react';
import { page, rise, list } from '../../../utils/motion';
import { Button, Card, ProgressBar } from '../../../components/common/ui';
import PageHeader from '../../../components/common/PageHeader';
import PillTabs from '../../../components/common/PillTabs';
import TopographicCard from '../../../components/common/TopographicCard';
import { Modal } from '../../../components/common/Overlay';
import { Table, Loading, ErrorBox, NextStep } from '../../../components/common/kit';
import { FormikForm, TextField, NumberField, DateField, SelectField } from '../../../components/form/FormKit';
import { R, MSG, yup } from '../../../validation/rules';
import { useApi, useAction } from '../../../api/hooks';
import { post } from '../../../api/client';
import { hasPerm } from '../../../store/slices/authSlice';
import { openRecord, setActiveTab } from '../../../store/slices/uiSlice';
import { formatCurrency, formatDate, todayIso } from '../../../utils/formatters';
import { Code, billLabel } from '../../shared';

/** Mirrors POST /treasury/payouts (Joi) */
const payoutSchema = yup.object({
  category: R.select(['VENDOR', 'LOAN', 'SALARY']).required(MSG.required),
  siteId: yup.string().when('category', { is: 'VENDOR', then: (x) => x.required('Choose the site whose vendor you are paying') }),
  amount: R.positiveMoney().required(MSG.required),
  paidDate: R.pastDate().required(MSG.required),
  reference: R.reason(128).required(MSG.required),
  periodLabel: R.text(32),
  remarks: R.text(1000)
});

const PayoutModal = ({ open, onClose, preset, payables }) => {
  const save = useAction((b) => post('/treasury/payouts', b), { onSuccess: onClose });
  const init = { category: preset?.category || 'VENDOR', siteId: preset?.siteId || '', amount: preset?.amount || '', paidDate: todayIso(), reference: '', periodLabel: '', remarks: '' };
  return (
    <Modal open={open} onClose={onClose} title="Record payment out">
      {open && (
        <FormikForm initialValues={init} schema={payoutSchema} busy={save.isPending} submitLabel="Record payout"
          onSubmit={(v) => save.mutateAsync({ ...v, siteId: v.category === 'VENDOR' ? v.siteId : null })}>
          {({ values }) => {
            const site = payables.find((p) => p.site_id === values.siteId);
            return (
              <>
                <SelectField name="category" label="Payment to" hint="Which pool the money comes from"
                  options={[{ value: 'VENDOR', label: 'Vendor / site payment' }, { value: 'LOAN', label: 'Loan payment (EMI)' }, { value: 'SALARY', label: 'Salary payment' }]} />
                {values.category === 'VENDOR' && (
                  <SelectField name="siteId" label="Site *" placeholder="Select site…"
                    hint={site ? `${site.vendor_name} payable ${formatCurrency(site.outstanding)} · funded by waterfall ${formatCurrency(site.ready_to_pay)}` : 'Only sites with an amount due are listed'}
                    options={payables.filter((p) => p.outstanding > 0).map((p) => ({ value: p.site_id, label: `${p.site_code} · ${p.vendor_name} · due ${formatCurrency(p.outstanding)}` }))} />
                )}
                <div className="grid gap-3 sm:grid-cols-2">
                  <NumberField name="amount" min="1" label="Amount ₹ *" hint="Cannot exceed what the pool holds" />
                  <DateField name="paidDate" max={todayIso()} label="Paid on *" hint="Not in the future" />
                  <TextField name="reference" label="UTR / reference *" hint="Bank reference, at least 3 characters" />
                  <TextField name="periodLabel" label="For period" placeholder="Nov 2026" hint="Month this payment covers (optional)" />
                </div>
                <TextField name="remarks" label="Remarks" hint="Optional" />
              </>
            );
          }}
        </FormikForm>
      )}
    </Modal>
  );
};

const Pool = ({ icon: Icon, title, value, sub, pct, children }) => (
  <Card className="flex flex-col">
    <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted"><Icon className="h-3.5 w-3.5" />{title}</p>
    <p className="mt-2 text-2xl font-semibold text-ink tnum">{formatCurrency(value)}</p>
    <p className="text-xs text-muted">{sub}</p>
    {pct !== undefined && <ProgressBar value={pct} className="mt-3" />}
    {children}
  </Card>
);

export const TreasuryPage = () => {
  const dispatch = useDispatch();
  const user = useSelector((s) => s.auth.user);
  const sum = useApi('/treasury/summary');
  const receipts = useApi('/treasury/receipts');
  const payouts = useApi('/treasury/payouts');
  const [tab, setTab] = useState('payables');
  const [payout, setPayout] = useState(null);
  const canPay = hasPerm(user, 'treasury.manage');

  if (sum.isLoading) return <Loading />;
  if (sum.error) return <ErrorBox error={sum.error} />;
  const s = sum.data;
  const p = s.pools;

  return (
    <motion.div variants={page} initial="hidden" animate="visible" exit="exit" className="space-y-4">
      <PageHeader title="Payment to Vendor" subtitle="Sitewise amount received → ① vendor / site payment → ② loan payment → ③ salary payment for the next 3 months"
        actions={canPay && <Button onClick={() => setPayout({})}><Plus className="h-4 w-4" /> Record payout</Button>} />

      {(Number(s.settings.monthly_salary_burn) === 0 || Number(s.settings.loan_emi_monthly) === 0) && (
        <NextStep tone="warn">Monthly salary and/or loan EMI are not set, so the waterfall cannot reserve them. {hasPerm(user, 'settings.manage') && <button className="underline" onClick={() => dispatch(setActiveTab('settings'))}>Open settings</button>}</NextStep>
      )}

      <motion.div variants={list} className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <motion.div variants={rise}>
          <TopographicCard className="h-full p-5">
            <p className="text-xs font-semibold uppercase tracking-wide text-white/70">Collected this month</p>
            <p className="mt-2 text-3xl font-semibold tnum">{formatCurrency(s.collected_this_month)}</p>
            <p className="mt-3 text-xs text-white/75">Receivable (submitted): {formatCurrency(s.receivables.receivable_submitted)}</p>
            <p className="text-xs text-white/75">Overdue: {formatCurrency(s.receivables.overdue)} · Not submitted: {formatCurrency(s.receivables.not_yet_submitted)}</p>
          </TopographicCard>
        </motion.div>
        <Pool icon={Building} title="① Vendor / site payment" value={p.vendor_payable_outstanding} sub={`Payable to ISPs · ${formatCurrency(p.vendor_pool)} funded & ready to pay`}
          pct={p.vendor_accrued ? ((p.vendor_paid / p.vendor_accrued) * 100) : 0} />
        <Pool icon={Landmark} title="② Loan payment" value={p.loan_pool} sub={`Reserved for EMI · this month ${formatCurrency(s.loan_emi_covered_this_month)} of ${formatCurrency(s.settings.loan_emi_monthly)}`} pct={s.loan_emi_coverage_pct} />
        <Pool icon={Users} title={`③ Salary · next ${s.settings.salary_reserve_months} months`} value={p.salary_reserve}
          sub={`Target ${formatCurrency(s.salary_target)} · runway ${s.runway_months ?? '—'} months`} pct={s.salary_coverage_pct} />
      </motion.div>
      <p className="flex items-center gap-1.5 text-xs text-muted"><Sparkles className="h-3.5 w-3.5" /> Surplus after all three priorities so far: <b className="tnum">{formatCurrency(p.surplus_total)}</b>. Customer payments are recorded on each bill in Billing.</p>

      <PillTabs value={tab} onChange={setTab} options={[
        { id: 'payables', label: 'Vendor payable by site', count: s.site_payables.length },
        { id: 'receipts', label: 'Amounts received', count: receipts.data?.length ?? 0 },
        { id: 'payouts', label: 'Payments out', count: payouts.data?.length ?? 0 }
      ]} />

      <motion.div variants={rise}>
        {tab === 'payables' && (
          <Table rows={s.site_payables} rowKey="site_id" empty="No live sites yet."
            columns={[
              { key: 'site', label: 'Site', render: (r) => <div><Code>{r.site_code}</Code><p className="mt-1 text-[11px] text-muted">{r.customer_name}</p></div> },
              { key: 'vendor_name', label: 'ISP vendor' },
              { key: 'rec', label: 'Received from customer', render: (r) => <span className="tnum">{formatCurrency(r.received)}</span> },
              { key: 'acc', label: 'Vendor cost accrued', render: (r) => <span className="tnum">{formatCurrency(r.accrued)}</span> },
              { key: 'alloc', label: 'Funded (P1)', render: (r) => <span className="tnum">{formatCurrency(r.allocated)}</span> },
              { key: 'paid', label: 'Paid', render: (r) => <span className="tnum">{formatCurrency(r.paid)}</span> },
              { key: 'out', label: 'Outstanding', render: (r) => <b className={`tnum ${r.outstanding > 0 ? 'text-ink' : 'text-muted'}`}>{formatCurrency(r.outstanding)}</b> },
              { key: 'a', label: '', render: (r) => canPay && r.outstanding > 0 && <Button size="sm" variant="outline" onClick={() => setPayout({ category: 'VENDOR', siteId: r.site_id, amount: Math.max(0, Math.min(r.outstanding, r.ready_to_pay)) || r.outstanding })}>Pay</Button> }
            ]} />
        )}
        {tab === 'receipts' && (receipts.isLoading ? <Loading /> : (
          <Table rows={receipts.data} onRowClick={(r) => dispatch(openRecord({ module: 'billing', id: r.invoice_id }))} empty="No customer payments recorded yet — record them on a submitted bill in Billing."
            columns={[
              { key: 'd', label: 'Received', render: (r) => <div><p>{formatDate(r.received_date)}</p><p className="font-mono text-[11px] text-muted">{r.utr_ref}</p></div> },
              { key: 'site', label: 'Site / bill', render: (r) => <div><p className="font-semibold text-ink">{r.site_code}</p><p className="text-[11px] text-muted">{r.invoice_number} · {billLabel(r)}</p></div> },
              { key: 'amt', label: 'Amount', render: (r) => <span className="tnum">{formatCurrency(r.amount)}</span> },
              { key: 'v', label: '① Vendor', render: (r) => <span className="tnum">{formatCurrency(r.vendor_amount)}</span> },
              { key: 'l', label: '② Loan', render: (r) => <span className="tnum">{formatCurrency(r.loan_amount)}</span> },
              { key: 's', label: '③ Salary', render: (r) => <span className="tnum">{formatCurrency(r.salary_amount)}</span> },
              { key: 'x', label: 'Surplus', render: (r) => <span className="tnum">{formatCurrency(r.surplus_amount)}</span> }
            ]} />
        ))}
        {tab === 'payouts' && (payouts.isLoading ? <Loading /> : (
          <Table rows={payouts.data} empty="No payouts yet."
            columns={[
              { key: 'd', label: 'Paid on', render: (r) => formatDate(r.paid_date) },
              { key: 'c', label: 'Type', render: (r) => ({ VENDOR: 'Vendor / site', LOAN: 'Loan', SALARY: 'Salary' }[r.category]) },
              { key: 'to', label: 'To', render: (r) => r.category === 'VENDOR' ? `${r.vendor_name} · ${r.site_code}` : r.period_label || '—' },
              { key: 'amount', label: 'Amount', render: (r) => <span className="tnum">{formatCurrency(r.amount)}</span> },
              { key: 'reference', label: 'Reference', render: (r) => <span className="font-mono text-xs">{r.reference}</span> },
              { key: 'by', label: 'By', render: (r) => <span className="text-xs">{r.created_by_name}</span> }
            ]} />
        ))}
      </motion.div>

      <PayoutModal key={JSON.stringify(payout)} open={Boolean(payout)} preset={payout} payables={s.site_payables} onClose={() => setPayout(null)} />
    </motion.div>
  );
};

export default TreasuryPage;
