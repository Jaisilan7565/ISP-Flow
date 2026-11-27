import React from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { motion } from 'framer-motion';
import { Compass, FileSpreadsheet, Network, Receipt, Landmark, ChevronRight, CheckCircle2, Circle, AlertTriangle, Info, OctagonAlert, Plus } from 'lucide-react';
import { page, rise, list, listItem } from '../../../utils/motion';
import { Card, CardTitle, Button } from '../../../components/common/ui';
import PageHeader from '../../../components/common/PageHeader';
import TopographicCard from '../../../components/common/TopographicCard';
import AnimatedNumber from '../../../components/common/AnimatedNumber';
import { Loading, ErrorBox, Timeline } from '../../../components/common/kit';
import { useApi } from '../../../api/hooks';
import { hasPerm } from '../../../store/slices/authSlice';
import { openRecord, setActiveTab } from '../../../store/slices/uiSlice';
import { formatCurrency, daysAgo } from '../../../utils/formatters';

const sumOf = (obj, keys) => keys.reduce((a, k) => a + (obj?.[k] || 0), 0);

const STAGES = (p) => [
  { id: 'feasibility', title: '1 · Feasibility', icon: Compass, perm: 'feasibility.view', main: sumOf(p.feasibility, ['NEW', 'ASSIGNED', 'SURVEY_DONE', 'PRICE_FINALIZED']), mainLabel: 'open',
    rows: [['To assign', p.feasibility.NEW], ['Survey / pricing', sumOf(p.feasibility, ['ASSIGNED', 'SURVEY_DONE', 'PRICE_FINALIZED'])], ['Complete', p.feasibility.COMPLETED], ['Stopped', sumOf(p.feasibility, ['NOT_FEASIBLE', 'CANCELLED'])]] },
  { id: 'commercial', title: '2 · Quote', icon: FileSpreadsheet, perm: 'commercial.view', main: sumOf(p.quotes, ['DRAFT', 'SENT']), mainLabel: 'in negotiation',
    rows: [['Draft', p.quotes.DRAFT], ['Sent', p.quotes.SENT], ['Bid won', p.quotes.WON], ['Lost', p.quotes.LOST]] },
  { id: 'implementation', title: '3 · Implementation', icon: Network, perm: 'implementation.view', main: sumOf(p.sites, ['AWAITING_PO', 'PO_RECEIVED', 'WORK_STARTED', 'BLOCKED']), mainLabel: 'in delivery',
    rows: [['Awaiting PO', p.sites.AWAITING_PO], ['PO / ISP work', sumOf(p.sites, ['PO_RECEIVED', 'WORK_STARTED'])], ['Pending with…', p.sites.BLOCKED], ['Live', p.sites.LIVE]] },
  { id: 'billing', title: '4 · Billing', icon: Receipt, perm: 'billing.view', main: p.invoices.PENDING_SUBMISSION || 0, mainLabel: 'not submitted',
    rows: [['Submitted', p.invoices.SUBMITTED], ['Part paid', p.invoices.PARTIALLY_PAID], ['Paid', p.invoices.PAID]] },
  { id: 'treasury', title: '5 · Payment', icon: Landmark, perm: 'treasury.view', main: null }
];

const SEV = { bad: [OctagonAlert, 'text-[#C0283C] bg-[#FDF0F1]'], warn: [AlertTriangle, 'text-[#B26B00] bg-[#FEF7EC]'], info: [Info, 'text-brand-700 bg-brand-50'] };

const SetupChecklist = ({ setup, go }) => {
  const items = [
    ['Add the clients who send you orders', setup.customers > 0, 'orders'],
    ['Add the ISPs you buy links from (Airtel, Jio, Tata, BSNL…)', setup.isp_vendors > 0, 'masters'],
    ['Add your field engineers & team', setup.surveyors > 0 && setup.users > 1, 'team'],
    ['Company GSTIN, salary burn & loan EMI in Settings', setup.gstin_set && setup.treasury_set, 'settings']
  ];
  const done = items.filter((i) => i[1]).length;
  if (done === items.length) return null;
  return (
    <motion.div variants={rise}>
      <Card>
        <div className="flex items-center justify-between"><CardTitle>Getting started · {done}/{items.length}</CardTitle><span className="text-xs text-muted">Finish setup before pasting the first client order</span></div>
        <ul className="mt-3 grid gap-1.5 sm:grid-cols-2">
          {items.map(([label, ok, tab]) => (
            <li key={label}>
              <button onClick={() => go(tab)} className="flex w-full items-center gap-2 rounded-xl px-2 py-1.5 text-left text-sm hover:bg-panel">
                {ok ? <CheckCircle2 className="h-4 w-4 text-brand-600" /> : <Circle className="h-4 w-4 text-subtle" />}
                <span className={ok ? 'text-muted line-through' : 'text-ink'}>{label}</span>
              </button>
            </li>
          ))}
        </ul>
      </Card>
    </motion.div>
  );
};

/** Field engineer's own queue: from pasted order to delivered site */
const MyWork = ({ mine, go, onPaste }) => {
  const items = [
    ['Surveys to do', mine.survey_pending, 'feasibility', 'warn'],
    ['With commercial (pricing / quote)', mine.with_commercial, 'feasibility'],
    ['Won — waiting for client PO', mine.awaiting_po, 'implementation'],
    ['PO received — start ISP work', mine.ready_to_start, 'implementation', 'warn'],
    ['In delivery', mine.in_delivery, 'implementation'],
    ['Pending with someone', mine.blocked, 'implementation', 'bad'],
    ['Delivered (live)', mine.delivered, 'implementation']
  ];
  return (
    <motion.div variants={rise}>
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>My work</CardTitle>
          <Button size="sm" onClick={onPaste}><Plus className="h-3.5 w-3.5" /> New client order</Button>
        </div>
        <ul className="mt-3 grid gap-1.5 sm:grid-cols-2 lg:grid-cols-4">
          {items.map(([label, n, tab, tone]) => (
            <li key={label}>
              <button onClick={() => go(tab)} className="flex w-full items-center justify-between gap-2 rounded-xl border border-line px-3 py-2 text-left text-sm hover:bg-panel">
                <span className="text-ink-2">{label}</span>
                <span className={`text-lg font-semibold tnum ${n && tone === 'bad' ? 'text-[#C0283C]' : n && tone === 'warn' ? 'text-[#B26B00]' : 'text-ink'}`}>{n || 0}</span>
              </button>
            </li>
          ))}
        </ul>
      </Card>
    </motion.div>
  );
};

export const DashboardPage = () => {
  const dispatch = useDispatch();
  const user = useSelector((s) => s.auth.user);
  const { data, isLoading, error } = useApi('/dashboard/summary');
  if (isLoading) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  const { pipeline, money, alerts, recent, setup, mine } = data;
  const go = (tab) => dispatch(setActiveTab(tab));
  const stages = STAGES(pipeline).filter((s) => hasPerm(user, s.perm));

  return (
    <motion.div variants={page} initial="hidden" animate="visible" exit="exit" className="space-y-4">
      <PageHeader title={`Hello, ${user.name.split(' ')[0]}`} subtitle={`${user.tenant_name} · ${user.role_label}`} />

      {hasPerm(user, 'users.manage') && <SetupChecklist setup={setup} go={go} />}
      {mine && <MyWork mine={mine} go={go} onPaste={() => dispatch(openRecord({ module: 'orders', id: 'new' }))} />}

      <motion.div variants={list} className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {stages.map((s, i) => {
          const Icon = s.icon;
          return (
            <motion.button key={s.id} variants={listItem} onClick={() => go(s.id)} className="group relative flex flex-col justify-start rounded-card bg-card p-4 text-left shadow-card transition-shadow hover:shadow-lift">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 text-sm font-semibold text-ink"><Icon className="h-4 w-4 text-brand-600" />{s.title}</span>
                <ChevronRight className="h-4 w-4 text-subtle transition-transform group-hover:translate-x-0.5" />
              </div>
              {s.id === 'treasury' ? (
                <>
                  <p className="mt-3 text-2xl font-semibold text-ink tnum">{formatCurrency(money?.collected)}</p>
                  <p className="text-[11px] text-muted">collected · vendor paid {formatCurrency(money?.vendor_paid)}</p>
                </>
              ) : (
                <>
                  <p className="mt-3 text-2xl font-semibold text-ink tnum"><AnimatedNumber value={s.main} /></p>
                  <p className="text-[11px] text-muted">{s.mainLabel}</p>
                  <dl className="mt-3 space-y-1 border-t border-line pt-2 text-xs">
                    {s.rows.map(([k, v]) => <div key={k} className="flex justify-between"><dt className="text-muted">{k}</dt><dd className="font-semibold text-ink tnum">{v || 0}</dd></div>)}
                  </dl>
                </>
              )}
              {i < stages.length - 1 && <ChevronRight className="absolute -right-3 top-1/2 hidden h-5 w-5 -translate-y-1/2 text-brand-400 xl:block" />}
            </motion.button>
          );
        })}
      </motion.div>

      <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
        <motion.div variants={rise}>
          <Card>
            <div className="flex items-center justify-between"><CardTitle>Needs attention</CardTitle><span className="text-xs text-muted tnum">{alerts.length}</span></div>
            {alerts.length === 0 ? <p className="mt-3 text-sm text-muted">All clear — nothing pending.</p> : (
              <ul className="mt-3 max-h-[440px] space-y-1.5 overflow-y-auto pr-1">
                {alerts.map((a, i) => {
                  const [Icon, cls] = SEV[a.severity] || SEV.info;
                  return (
                    <li key={`${a.title}-${a.id}-${i}`}>
                      <button onClick={() => (a.id ? dispatch(openRecord({ module: a.link, id: a.id })) : go(a.link))} className="flex w-full items-start gap-3 rounded-xl px-2.5 py-2 text-left hover:bg-panel">
                        <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg ${cls}`}><Icon className="h-3.5 w-3.5" /></span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-[13px] font-semibold text-ink">{a.title} <span className="font-mono text-[11px] font-medium text-brand-700">{a.ref}</span></span>
                          <span className="block truncate text-xs text-muted">{a.detail}</span>
                        </span>
                        {a.since && <span className="shrink-0 text-[11px] text-subtle tnum">{daysAgo(a.since)}d</span>}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </motion.div>
        <div className="space-y-4">
          {hasPerm(user, 'billing.view') && money && (
            <motion.div variants={rise}>
              <TopographicCard className="p-5">
                <p className="text-xs font-semibold uppercase tracking-wide text-white/70">Money flow</p>
                <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
                  {[['Won contract value', money.won_value], ['Live MRC / month', money.live_mrc], ['Billed', money.billed], ['Collected', money.collected], ['Outstanding', money.outstanding], ['Paid to vendors', money.vendor_paid]].map(([k, v]) => (
                    <div key={k}><dt className="text-[11px] text-white/65">{k}</dt><dd className="text-lg font-semibold tnum">{formatCurrency(v)}</dd></div>
                  ))}
                </dl>
              </TopographicCard>
            </motion.div>
          )}
          <motion.div variants={rise}>
            <Card>
              <div className="flex items-center justify-between"><CardTitle>Recent activity</CardTitle><button className="text-xs text-brand-700 hover:underline" onClick={() => go('activity')}>View all</button></div>
              <div className="mt-3 max-h-[320px] overflow-y-auto pr-1"><Timeline items={recent} /></div>
            </Card>
          </motion.div>
        </div>
      </div>
    </motion.div>
  );
};

export default DashboardPage;
