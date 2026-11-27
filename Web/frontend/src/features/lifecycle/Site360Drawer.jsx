import React from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Compass, FileSpreadsheet, Network, Receipt, Landmark, ArrowRight } from 'lucide-react';
import { Drawer } from '../../components/common/Overlay';
import { Status } from '../../components/common/ui';
import { Loading, ErrorBox, Section, Timeline, KV } from '../../components/common/kit';
import { useApi } from '../../api/hooks';
import { openLifecycle, openRecord } from '../../store/slices/uiSlice';
import { hasPerm } from '../../store/slices/authSlice';
import { formatCurrency, formatDate, formatMbps } from '../../utils/formatters';
import { downloadUrl } from '../../api/client';
import { Code, LinkTags, needsStaticIp, billLabel } from '../shared';

const ORDER = ['FEASIBILITY', 'COMMERCIAL', 'IMPLEMENTATION', 'BILLING', 'PAYMENT'];

const Block = ({ icon: Icon, title, status, onOpen, children, done }) => (
  <div className={`relative rounded-card border p-4 ${done ? 'border-line bg-card' : 'border-dashed border-line-strong bg-panel'}`}>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <span className="flex items-center gap-2 text-sm font-semibold text-ink"><Icon className="h-4 w-4 text-brand-600" />{title}</span>
      <span className="flex items-center gap-2">{status}{onOpen && <button onClick={onOpen} className="inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline">Open <ArrowRight className="h-3 w-3" /></button>}</span>
    </div>
    {children && <div className="mt-3">{children}</div>}
  </div>
);

export const Site360Drawer = () => {
  const dispatch = useDispatch();
  const id = useSelector((s) => s.ui.lifecycleId);
  const user = useSelector((s) => s.auth.user);
  const { data: l, isLoading, error } = useApi(id ? `/dashboard/lifecycle/${id}` : null);
  const close = () => dispatch(openLifecycle(null));
  const go = (module, rid, perm) => (hasPerm(user, perm) ? () => { close(); dispatch(openRecord({ module, id: rid })); } : undefined);
  const reached = l ? ORDER.indexOf(l.stage) : 0;

  return (
    <Drawer open={Boolean(id)} onClose={close} label="Site 360" width="sm:w-[720px]">
      {isLoading || !l ? (error ? <ErrorBox error={error} /> : <Loading />) : (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">Site 360 · start to end</p>
          <h2 className="mt-1 pr-10 text-xl font-semibold text-ink">{l.feasibility.site_name}<LinkTags role={l.feasibility.link_role} ips={l.feasibility.static_ip_count} /></h2>
          <p className="text-sm text-muted">{l.feasibility.customer_name}{l.feasibility.client_site_ref ? ` · site ${l.feasibility.client_site_ref}` : ''} · {formatMbps(l.feasibility.bandwidth_mbps)} · now at <b>{l.stage.toLowerCase()}</b></p>
          {l.feasibility.order_code && (
            <p className="mt-1 text-xs text-muted">Client order <button className="font-mono font-semibold text-brand-700 hover:underline" onClick={go('orders', l.feasibility.order_id, 'orders.view')}>{l.feasibility.order_code}</button>
              {l.feasibility.order_client_ref ? ` · ref ${l.feasibility.order_client_ref}` : ''}{l.feasibility.order_received_via ? ` · via ${l.feasibility.order_received_via.toLowerCase()}` : ''}</p>
          )}

          <div className="mt-4 space-y-2.5">
            <Block icon={Compass} title="1 · Feasibility" done status={<><Code>{l.feasibility.code}</Code><Status value={l.feasibility.status} /></>} onOpen={go('feasibility', l.feasibility.id, 'feasibility.view')}>
              <KV cols={3} items={[
                ['Source', l.feasibility.source_channel], ['Field engineer', l.feasibility.assigned_name || '—'],
                ['Feasible ISPs', l.feasibility.options.filter((o) => o.is_feasible).map((o) => o.vendor_name).join(', ') || '—'],
                ['Finalized price', l.feasibility.final_client_mrc ? `OTC ${formatCurrency(l.feasibility.final_client_otc)} · MRC ${formatCurrency(l.feasibility.final_client_mrc)}${needsStaticIp(l.feasibility) ? ` · static IP ${formatCurrency(l.feasibility.final_client_ip_mrc)}` : ''}` : '—']
              ]} />
            </Block>
            <Block icon={FileSpreadsheet} title="2 · Quote & budget" done={reached >= 1} status={l.quote ? <><Code>{l.quote.code}</Code><Status value={l.quote.status} /></> : <span className="text-xs text-subtle">Not yet</span>} onOpen={l.quote && go('commercial', l.quote.id, 'commercial.view')}>
              {l.quote?.status === 'WON' && !l.quote.restricted && <KV cols={3} items={[
                ['Won with', `Quote-${l.quote.won_option_no} · ${l.quote.final_vendor_name}`], ['Finalized value', formatCurrency(l.quote.finalized_value)],
                ['A / B / C', `${formatCurrency(l.quote.vendor_amount)} / ${formatCurrency(l.quote.partner_amount)} / ${formatCurrency(l.quote.capex_amount)}`]
              ]} />}
            </Block>
            <Block icon={Network} title="3 · Implementation" done={reached >= 2} status={l.site ? <><Code>{l.site.code}</Code><Status value={l.site.status} /></> : <span className="text-xs text-subtle">After bid win</span>} onOpen={l.site && go('implementation', l.site.id, 'implementation.view')}>
              {l.site && <KV cols={3} items={[
                ['PO', l.site.po_number ? `${l.site.po_number} · ${formatDate(l.site.po_date)}` : 'Awaiting'], ['ISP work start', l.site.work_start_date ? `${formatDate(l.site.work_start_date)} · ${l.site.vendor_name}` : '—'],
                ['Pending items', `${l.blockers.filter((b) => !b.resolved_at).length} open / ${l.blockers.length} total`], ['Live', l.site.live_date ? `${formatDate(l.site.live_date)} · ${l.site.circuit_id}` : '—'],
                ['Delivery owner', l.site.owner_name || '—']
              ]} />}
            </Block>
            <Block icon={Receipt} title="4 · Billing" done={reached >= 3} status={<span className="text-xs text-muted">{l.invoices.length} bill(s)</span>}>
              {l.invoices.length > 0 && (
                <ul className="divide-y divide-line text-sm">
                  {l.invoices.map((i) => (
                    <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                      <button className="font-mono text-xs font-semibold text-brand-700 hover:underline" onClick={go('billing', i.id, 'billing.view')}>{i.invoice_number}</button>
                      <span className="text-xs">{billLabel(i)} · {formatCurrency(i.total_amount)}</span>
                      <span className="text-xs text-muted">{i.submission_date ? `submitted ${formatDate(i.submission_date)}` : 'not submitted'}</span>
                      <Status value={i.status} />
                    </li>
                  ))}
                </ul>
              )}
            </Block>
            <Block icon={Landmark} title="5 · Payment & vendor" done={reached >= 4} status={<span className="text-xs text-muted">{l.receipts.length} receipt(s) · {l.payouts.length} payout(s)</span>}>
              {l.receipts.length > 0 && (
                <ul className="space-y-1 text-xs">
                  {l.receipts.map((r) => (
                    <li key={r.id} className="flex flex-wrap justify-between gap-2">
                      <span>{formatDate(r.received_date)} · {r.invoice_number} · <b>{formatCurrency(r.amount)}</b></span>
                      <span className="text-muted tnum">V {formatCurrency(r.vendor_amount)} · L {formatCurrency(r.loan_amount)} · S {formatCurrency(r.salary_amount)}</span>
                    </li>
                  ))}
                  {l.payouts.map((p) => <li key={p.id} className="text-brand-800">Vendor paid {formatCurrency(p.amount)} on {formatDate(p.paid_date)} (ref {p.reference})</li>)}
                </ul>
              )}
            </Block>
          </div>

          <Section title={`Documents (${l.documents.length})`}>
            {l.documents.length === 0 ? <p className="text-xs text-subtle">None uploaded.</p> : (
              <ul className="flex flex-wrap gap-2">
                {l.documents.map((d) => <li key={d.id}><a href={downloadUrl(d.id, true)} target="_blank" rel="noreferrer" className="inline-block rounded-full border border-line bg-card px-3 py-1 text-xs hover:border-brand-400">{d.doc_type.replace(/_/g, ' ').toLowerCase()} · {d.file_name}</a></li>)}
              </ul>
            )}
          </Section>
          <Section title="Complete timeline"><Timeline items={l.timeline} /></Section>
        </div>
      )}
    </Drawer>
  );
};

export default Site360Drawer;
