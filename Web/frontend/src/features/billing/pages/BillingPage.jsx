import React, { useCallback, useMemo, useState } from 'react';
import { useSelector } from 'react-redux';
import { motion } from 'framer-motion';
import { RefreshCw, Printer, Send, IndianRupee, Ban, FilePlus2 } from 'lucide-react';
import { page, rise, list } from '../../../utils/motion';
import { Button, Status, Card } from '../../../components/common/ui';
import PageHeader from '../../../components/common/PageHeader';
import PillTabs from '../../../components/common/PillTabs';
import { Drawer, inputClass } from '../../../components/common/Overlay';
import { Table, Loading, ErrorBox, KV, Section, NextStep, DocumentsPanel } from '../../../components/common/kit';
import { FormikForm, TextField, NumberField, DateField, SelectField } from '../../../components/form/FormKit';
import { R, MSG, yup } from '../../../validation/rules';
import { useApi, useAction } from '../../../api/hooks';
import { post } from '../../../api/client';
import { hasPerm } from '../../../store/slices/authSlice';
import { formatCurrency, formatDate, todayIso } from '../../../utils/formatters';
import { useFocusRecord, RecordActivity, Site360Button, Code, filterBy, mediumLabel } from '../../shared';
import { printInvoice, printCreditNote } from '../printInvoice';
import { useToast } from '../../../components/common/Toast';

const TABS = [
  { id: 'PENDING', label: 'Not submitted', test: (i) => i.status === 'PENDING_SUBMISSION' },
  { id: 'SUBMITTED', label: 'Submitted', test: (i) => i.status === 'SUBMITTED' && !i.is_overdue },
  { id: 'OVERDUE', label: 'Overdue', test: (i) => i.is_overdue },
  { id: 'PART', label: 'Part paid', test: (i) => i.status === 'PARTIALLY_PAID' },
  { id: 'PAID', label: 'Paid', test: (i) => i.status === 'PAID' },
  { id: 'ALL', label: 'All', test: () => true }
];

const MODES = [{ value: 'PHYSICAL', label: 'Physical (stamp & sign)' }, { value: 'COURIER', label: 'Courier' }, { value: 'PORTAL', label: 'Customer portal' }, { value: 'EMAIL', label: 'Email (acknowledged)' }];

/** Mirrors POST /invoices/:id/submission (Joi) */
const submissionSchema = (inv) => yup.object({
  submissionMode: R.select(MODES.map((m) => m.value)).required(MSG.required),
  submissionDate: R.pastDate().required(MSG.required).test('afterInvoice', 'Cannot be before the invoice date', (v) => !v || v >= String(inv.invoice_date).slice(0, 10)),
  courierAwb: R.text(128).when('submissionMode', { is: 'COURIER', then: (x) => x.required('Enter the courier AWB number') }),
  acknowledgedBy: R.text(128).when('submissionMode', { is: 'PHYSICAL', then: (x) => x.required('Enter who stamped / received the bill') }),
  remarks: R.text(1000)
});

const SubmissionForm = ({ inv }) => {
  const save = useAction((b) => post(`/invoices/${inv.id}/submission`, b));
  const init = { submissionMode: inv.submission_mode || 'PHYSICAL', submissionDate: inv.submission_date || todayIso(), courierAwb: inv.courier_awb || '', acknowledgedBy: inv.acknowledged_by || '', remarks: inv.submission_remarks || '' };
  return (
    <FormikForm initialValues={init} schema={submissionSchema(inv)} busy={save.isPending} submitLabel={inv.status === 'SUBMITTED' ? 'Update submission' : 'Record bill submission'} onSubmit={(v) => save.mutateAsync(v)}>
      {({ values }) => (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <SelectField name="submissionMode" label="Submission mode" hint="How the bill reached the client" options={MODES} />
            <DateField name="submissionDate" min={inv.invoice_date} max={todayIso()} label="Date of submission *" hint="Payment clock starts on this date" />
            {values.submissionMode === 'COURIER' && <TextField name="courierAwb" label="Courier AWB no. *" hint="Tracking number on the courier receipt" />}
            <TextField name="acknowledgedBy" label={`Acknowledged by${values.submissionMode === 'PHYSICAL' ? ' *' : ''}`} placeholder="Name / desk that stamped" hint={values.submissionMode === 'PHYSICAL' ? 'Required for physical submission' : 'Optional'} />
          </div>
          <TextField name="remarks" label="Remarks" hint="Optional" />
          <NextStep>Payment due date = submission date + {inv.credit_days} credit days. Upload the stamped copy / courier receipt below as proof.</NextStep>
        </>
      )}
    </FormikForm>
  );
};

/** Mirrors POST /treasury/receipts (Joi) */
const paymentSchema = (inv) => yup.object({
  amount: R.positiveMoney().required(MSG.required).max(Number(inv.outstanding) || 1e12, `Cannot be more than the outstanding ${formatCurrency(inv.outstanding)}`),
  tdsAmount: R.money(),
  receivedDate: R.pastDate().required(MSG.required),
  utrRef: R.text(128).min(4, 'Enter at least 4 characters').required(MSG.required),
  mode: R.select(['NEFT', 'RTGS', 'IMPS', 'UPI', 'CHEQUE', 'OTHER']),
  remarks: R.text(1000)
});

const PaymentForm = ({ inv }) => {
  const toast = useToast();
  const save = useAction((b) => post('/treasury/receipts', b), {
    success: () => null,
    onSuccess: (res) => {
      const a = res.data.allocation;
      toast(`Payment recorded → Vendor ${formatCurrency(a.vendor_amount)} · Loan ${formatCurrency(a.loan_amount)} · Salary ${formatCurrency(a.salary_amount)} · Surplus ${formatCurrency(a.surplus_amount)}`);
    }
  });
  const init = { amount: inv.outstanding, tdsAmount: 0, receivedDate: todayIso(), utrRef: '', mode: 'NEFT', remarks: '' };
  return (
    <FormikForm initialValues={init} schema={paymentSchema(inv)} busy={save.isPending} submitLabel="Record payment received"
      onSubmit={(v) => save.mutateAsync({ ...v, invoiceId: inv.id, tdsAmount: v.tdsAmount ?? 0 })}>
      <div className="grid gap-3 sm:grid-cols-3">
        <NumberField name="amount" min="1" label="Amount received ₹ *" hint={`Outstanding ${formatCurrency(inv.outstanding)}`} />
        <NumberField name="tdsAmount" min="0" label="TDS deducted ₹" hint="Tax the client withheld (0 if none)" />
        <DateField name="receivedDate" max={todayIso()} label="Received on *" hint="Date the money reached your bank" />
        <TextField name="utrRef" label="UTR / cheque no. *" hint="Bank reference; each can be used once" />
        <SelectField name="mode" label="Mode" hint="How it was paid" options={['NEFT', 'RTGS', 'IMPS', 'UPI', 'CHEQUE', 'OTHER']} />
        <TextField name="remarks" label="Remarks" hint="Optional" />
      </div>
      <NextStep>The amount is split automatically: ① this site's vendor cost → ② loan EMI → ③ salary reserve for the next 3 months → surplus.</NextStep>
    </FormikForm>
  );
};

const cancelSchema = yup.object({ reason: R.reason(1000).required(MSG.required) });

/** Credit notes on a bill, and a form to issue one (amount before GST; GST is added at the bill rate) */
const CreditNotes = ({ inv, canBill }) => {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const room = Math.round((Number(inv.base_amount) - (inv.credit_notes || []).reduce((a, n) => a + Number(n.base_amount), 0)) * 100) / 100;
  const issue = useAction((body) => post(`/invoices/${inv.id}/credit-notes`, body), { onSuccess: () => setOpen(false) });
  const schema = yup.object({
    amount: R.positiveMoney().max(room, `At most ${formatCurrency(room)} (bill before GST, less earlier credits)`).required(MSG.required),
    reason: R.reason(1000).required(MSG.required),
    reduceIspCost: R.money().max(Number(inv.vendor_cost), `At most the ISP cost on this bill (${formatCurrency(inv.vendor_cost)})`)
  });
  return (
    <div className="space-y-3">
      {inv.credit_notes?.length > 0 && (
        <Table rows={inv.credit_notes} columns={[
          { key: 'n', label: 'Credit note', render: (n) => <div><p className="font-mono text-xs">{n.credit_number}</p><p className="text-[11px] text-muted">{formatDate(n.credit_date)} · {n.created_by_name || 'system'}</p></div> },
          { key: 'r', label: 'Reason', render: (n) => <span className="text-xs">{n.reason}</span> },
          { key: 'a', label: 'Credit (incl. GST)', render: (n) => <span className="tnum">{formatCurrency(n.total_amount)}</span> },
          { key: 'p', label: '', render: (n) => <Button size="sm" variant="ghost" aria-label={`Print ${n.credit_number}`} onClick={() => printCreditNote(inv, n) || toast('Allow pop-ups to print the credit note')}><Printer className="h-3.5 w-3.5" /></Button> }
        ]} />
      )}
      {canBill && inv.status !== 'CANCELLED' && room > 0 && (open ? (
        <FormikForm initialValues={{ amount: '', reason: '', reduceIspCost: '' }} schema={schema} busy={issue.isPending} submitLabel="Issue credit note"
          onSubmit={(v) => issue.mutateAsync(v)} extra={<Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>}>
          <div className="grid gap-3 sm:grid-cols-3">
            <NumberField name="amount" min="0" label="Credit amount (₹, before GST) *" hint={`Up to ${formatCurrency(room)}; GST ${inv.gst_pct}% is added`} />
            <TextField name="reason" className="sm:col-span-2" label="Reason *" placeholder="e.g. Link down 3 days; goodwill" hint="Printed on the credit note" />
          </div>
          <NumberField name="reduceIspCost" min="0" label="Also reduce the ISP cost on this bill (₹)" hint="Only if the ISP gives you a credit too (optional)" />
        </FormikForm>
      ) : <Button size="sm" variant="outline" onClick={() => setOpen(true)}>Issue credit note</Button>)}
      {!inv.credit_notes?.length && !(canBill && room > 0) && <p className="text-xs text-muted">No credit notes.</p>}
    </div>
  );
};

const InvoiceDrawer = ({ id, onClose }) => {
  const user = useSelector((s) => s.auth.user);
  const toast = useToast();
  const { data: inv, isLoading, error } = useApi(id ? `/invoices/${id}` : null);
  const cancel = useAction((body) => post(`/invoices/${id}/cancel`, { ...body, reissue: true }));
  const nextCycle = useAction(() => post(`/invoices/sites/${inv.site_id}/next-cycle`));
  const canBill = hasPerm(user, 'billing.manage');
  const canPay = canBill || hasPerm(user, 'treasury.manage');

  return (
    <Drawer open={Boolean(id)} onClose={onClose} label="Invoice" width="sm:w-[640px]">
      {isLoading || !inv ? (error ? <ErrorBox error={error} /> : <Loading />) : (
        <div>
          <div className="flex flex-wrap items-center gap-2 pr-10"><Code>{inv.invoice_number}</Code><Status value={inv.status} />{inv.is_overdue && <Status value="OVERDUE" />}</div>
          <h2 className="mt-2 text-xl font-semibold text-ink">{inv.label} · {formatCurrency(inv.total_amount)}</h2>
          <p className="text-sm text-muted">{inv.customer_name} · {inv.site_name} ({inv.site_code})</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => printInvoice(inv) || toast('Allow pop-ups to print the invoice')}><Printer className="h-3.5 w-3.5" /> Print GST invoice</Button>
            <Site360Button id={inv.site_id} />
            {canBill && <Button size="sm" variant="ghost" disabled={nextCycle.isPending} onClick={() => window.confirm('Raise the next billing cycle for this site now (advance billing)?') && nextCycle.mutate()}><FilePlus2 className="h-3.5 w-3.5" /> Next cycle</Button>}
          </div>

          <Section title="Bill">
            <KV cols={3} items={[
              ['Type', inv.label], ['Period', inv.invoice_type === 'OTC' ? 'On site live' : `${formatDate(inv.period_start)} – ${formatDate(inv.period_end)}`], ['Invoice date', formatDate(inv.invoice_date)],
              ['Link', `${mediumLabel(inv.medium)} · ${inv.bandwidth_mbps} Mbps`],
              Number(inv.otc_amount) > 0 && inv.invoice_type !== 'OTC' && ['Made up of', `OTC ${formatCurrency(inv.otc_amount)} + MRC ${formatCurrency(Number(inv.base_amount) - Number(inv.otc_amount) - Number(inv.ip_amount || 0))}${Number(inv.ip_amount) > 0 ? ` + static IP ${formatCurrency(inv.ip_amount)}` : ''}`],
              ['Amount value', formatCurrency(inv.base_amount)], [`GST ${inv.gst_pct}%`, formatCurrency(inv.gst_amount)], ['Total', <b key="t">{formatCurrency(inv.total_amount)}</b>],
              ['Submission', inv.submission_date ? `${formatDate(inv.submission_date)} · ${inv.submission_mode?.toLowerCase()}` : <span key="s" className="text-[#B26B00]">Not submitted ({inv.days_since_invoice} days)</span>],
              inv.courier_awb && ['AWB', inv.courier_awb], inv.acknowledged_by && ['Acknowledged by', inv.acknowledged_by],
              ['Due date', inv.due_date ? <span key="d" className={inv.is_overdue ? 'font-semibold text-[#C0283C]' : ''}>{formatDate(inv.due_date)}</span> : 'After submission'],
              ['Received / TDS', `${formatCurrency(inv.amount_received)} / ${formatCurrency(inv.tds_amount)}`],
              Number(inv.credit_amount) > 0 && ['Credited', <span key="c" className="text-brand-700">{formatCurrency(inv.credit_amount)}</span>],
              ['Outstanding', <b key="o">{formatCurrency(inv.outstanding)}</b>],
              inv.excess_received > 0.5 && ['Excess received', <span key="x" className="font-semibold text-[#B26B00]" title="Paid, then credited: refund it or adjust it on the next bill">{formatCurrency(inv.excess_received)} · refund or adjust</span>]
            ]} />
          </Section>

          {['PENDING_SUBMISSION', 'SUBMITTED'].includes(inv.status) && canBill && (
            <Section title={inv.status === 'PENDING_SUBMISSION' ? 'Bill submission' : 'Edit submission'}><SubmissionForm key={inv.updated_at} inv={inv} /></Section>
          )}
          {inv.status === 'PENDING_SUBMISSION' && <div className="mt-3"><NextStep tone="warn">Record the submission first — the customer's payment clock starts only after the bill is submitted.</NextStep></div>}
          {['SUBMITTED', 'PARTIALLY_PAID'].includes(inv.status) && canPay && <Section title="Sitewise amount received"><PaymentForm key={inv.updated_at} inv={inv} /></Section>}

          {inv.receipts?.length > 0 && (
            <Section title="Payments & split">
              <Table rows={inv.receipts} columns={[
                { key: 'd', label: 'Date / UTR', render: (r) => <div><p>{formatDate(r.received_date)}</p><p className="font-mono text-[11px] text-muted">{r.utr_ref}</p></div> },
                { key: 'a', label: 'Amount', render: (r) => <span className="tnum">{formatCurrency(r.amount)}{r.tds_amount > 0 ? ` + TDS ${formatCurrency(r.tds_amount)}` : ''}</span> },
                { key: 's', label: 'Vendor · Loan · Salary · Surplus', render: (r) => <span className="text-xs tnum">{formatCurrency(r.vendor_amount)} · {formatCurrency(r.loan_amount)} · {formatCurrency(r.salary_amount)} · {formatCurrency(r.surplus_amount)}</span> }
              ]} />
            </Section>
          )}

          {(canBill || inv.credit_notes?.length > 0) && inv.status !== 'CANCELLED' && <Section title="Credit notes"><CreditNotes key={inv.updated_at} inv={inv} canBill={canBill} /></Section>}

          <Section title="Documents"><DocumentsPanel entityType="INVOICE" entityId={inv.id} types={['SUBMISSION_PROOF', 'COURIER_RECEIPT', 'INVOICE_COPY', 'PAYMENT_PROOF', 'OTHER']} canEdit={canPay} /></Section>

          {canBill && inv.status !== 'CANCELLED' && Number(inv.amount_received) === 0 && Number(inv.tds_amount) === 0 && Number(inv.credit_amount) === 0 && (
            <Section title="Cancel & re-issue">
              <FormikForm initialValues={{ reason: '' }} schema={cancelSchema} busy={cancel.isPending} inline submitLabel="Cancel & re-issue"
                onSubmit={(v) => (window.confirm('Cancel this bill and issue a fresh one for the same cycle?') ? cancel.mutateAsync(v) : undefined)}>
                <TextField name="reason" aria-label="Cancel reason" placeholder="Reason (wrong amount, wrong period…)" hint="At least 3 characters; a fresh bill is issued for the same cycle" />
              </FormikForm>
            </Section>
          )}
          <RecordActivity entityId={inv.id} />
        </div>
      )}
    </Drawer>
  );
};

export const BillingPage = () => {
  const user = useSelector((s) => s.auth.user);
  const [tab, setTab] = useState('PENDING');
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState(null);
  const open = useCallback((id) => id && setSelected(id), []);
  useFocusRecord('billing', open);
  const listQ = useApi('/invoices');
  const run = useAction(() => post('/invoices/run-billing'));
  const all = listQ.data || [];
  const rows = useMemo(() => filterBy(all.filter(TABS.find((t) => t.id === tab).test), q, ['invoice_number', 'site_code', 'site_name', 'customer_name', 'courier_awb']), [all, tab, q]);
  const sum = (test) => all.filter(test).reduce((a, i) => a + Number(i.outstanding), 0);

  return (
    <motion.div variants={page} initial="hidden" animate="visible" exit="exit" className="space-y-4">
      <PageHeader title="Billing Tracker" subtitle="Site OTC → 1st cycle → 2nd cycle … amount value · date of submission · bill submission & tracking"
        actions={hasPerm(user, 'billing.manage') && <Button variant="outline" disabled={run.isPending} onClick={() => run.mutate()}><RefreshCw className={`h-4 w-4 ${run.isPending ? 'animate-spin' : ''}`} /> Run billing (due cycles)</Button>} />
      <motion.div variants={list} className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          ['Not yet submitted', sum(TABS[0].test), all.filter(TABS[0].test).length, Send],
          ['Submitted, awaiting payment', sum((i) => ['SUBMITTED', 'PARTIALLY_PAID'].includes(i.status)), all.filter((i) => ['SUBMITTED', 'PARTIALLY_PAID'].includes(i.status)).length, IndianRupee],
          ['Overdue', sum(TABS[2].test), all.filter(TABS[2].test).length, Ban],
          ['Collected', all.reduce((a, i) => a + Number(i.amount_received), 0), all.filter((i) => i.status === 'PAID').length, IndianRupee]
        ].map(([label, amt, count, Icon]) => (
          <Card key={label}>
            <p className="flex items-center gap-1.5 text-xs font-medium text-muted"><Icon className="h-3.5 w-3.5" />{label}</p>
            <p className="mt-1.5 text-xl font-semibold text-ink tnum">{formatCurrency(amt)}</p>
            <p className="text-[11px] text-muted">{count} bill(s)</p>
          </Card>
        ))}
      </motion.div>
      <div className="flex flex-wrap items-center gap-3">
        <PillTabs value={tab} onChange={setTab} options={TABS.map((t) => ({ id: t.id, label: t.label, count: all.filter(t.test).length }))} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter…" className={`${inputClass} max-w-[220px]`} aria-label="Filter" />
      </div>
      {listQ.isLoading ? <Loading /> : listQ.error ? <ErrorBox error={listQ.error} /> : (
        <motion.div variants={rise}>
          <Table rows={rows} onRowClick={(r) => setSelected(r.id)} empty="Bills are created automatically when a site goes live."
            columns={[
              { key: 'n', label: 'Invoice', render: (r) => <Code>{r.invoice_number}</Code> },
              { key: 's', label: 'Site', render: (r) => <div><p className="font-semibold text-ink">{r.site_code}</p><p className="text-[11px] text-muted">{r.customer_name}</p></div> },
              { key: 'label', label: 'Bill', render: (r) => <div><p>{r.label}</p><p className="text-[11px] text-muted">{r.invoice_type === 'OTC' ? formatDate(r.invoice_date) : `${formatDate(r.period_start)} – ${formatDate(r.period_end)}`}</p></div> },
              { key: 'amt', label: 'Amount', render: (r) => <span className="tnum">{formatCurrency(r.total_amount)}</span> },
              { key: 'sub', label: 'Submitted', render: (r) => r.submission_date ? <span className="text-xs">{formatDate(r.submission_date)} · {r.submission_mode?.toLowerCase()}</span> : <span className="text-xs text-[#B26B00]">{r.days_since_invoice} days pending</span> },
              { key: 'due', label: 'Due', render: (r) => <span className={`text-xs ${r.is_overdue ? 'font-semibold text-[#C0283C]' : ''}`}>{formatDate(r.due_date)}</span> },
              { key: 'out', label: 'Outstanding', render: (r) => <span className="tnum">{formatCurrency(r.outstanding)}</span> },
              { key: 'st', label: 'Status', render: (r) => <Status value={r.status} /> }
            ]} />
        </motion.div>
      )}
      <InvoiceDrawer id={selected} onClose={() => setSelected(null)} />
    </motion.div>
  );
};

export default BillingPage;
