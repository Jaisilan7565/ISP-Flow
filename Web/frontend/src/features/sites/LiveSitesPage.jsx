import React, { useCallback, useMemo, useState } from 'react';
import { useSelector } from 'react-redux';
import { motion } from 'framer-motion';
import { Wifi, Gauge, IndianRupee, CalendarClock, Download, Radio } from 'lucide-react';
import { page, rise, list } from '../../utils/motion';
import { Button, Card, Status } from '../../components/common/ui';
import PageHeader from '../../components/common/PageHeader';
import PillTabs from '../../components/common/PillTabs';
import { inputClass } from '../../components/common/Overlay';
import { Table, Loading, ErrorBox, selectClass } from '../../components/common/kit';
import { useApi } from '../../api/hooks';
import { hasPerm } from '../../store/slices/authSlice';
import { formatCurrency, formatMbps, formatDate, todayIso } from '../../utils/formatters';
import { useFocusRecord, Code, filterBy, LinkTags, mediumLabel, MEDIUMS } from '../shared';
import { SiteDrawer } from '../implementation/pages/ImplementationPage';
import { VendorDrawer } from '../admin/VendorDrawer';

const SOON = 60; // days before contract end that a site counts as "ending soon"
const TABS = [
  { id: 'LIVE', label: 'Live', test: (r) => r.status === 'LIVE' },
  { id: 'DOWN', label: 'Down now', test: (r) => r.status === 'LIVE' && Boolean(r.open_fault) },
  { id: 'SOON', label: `Contract ending (${SOON} days)`, test: (r) => r.status === 'LIVE' && r.contract_days_left <= SOON },
  { id: 'TERMINATED', label: 'Disconnected', test: (r) => r.status === 'TERMINATED' }
];

const ContractCell = ({ r }) => {
  if (r.status === 'TERMINATED') return <span className="text-xs text-muted">Disconnected {formatDate(r.terminated_on)}</span>;
  const left = r.contract_days_left;
  const tone = left < 0 ? 'font-semibold text-[#C0283C]' : left <= SOON ? 'font-semibold text-[#B26B00]' : 'text-ink-2';
  return <div className="text-xs"><p className={tone}>{formatDate(r.contract_end)}</p><p className="text-muted">{left < 0 ? `ended ${-left} d ago` : `${left} d left`}</p></div>;
};

/** Spreadsheet of what is on screen (Excel opens it directly) */
const exportCsv = (rows, money, billing) => {
  const head = ['Site code', 'Site', "Client's site ID", 'Client', 'ISP', 'Medium', 'Bandwidth (Mbps)', 'Link type', 'Static IPs', 'Circuit ID', 'WAN IP', 'Live date', 'Contract end', 'Status', 'Disconnected on', 'Uptime 30 days %', 'Down now',
    ...(money ? ['Monthly price', 'Monthly ISP cost', 'Monthly margin'] : []), ...(billing ? ['Next bill', 'Billed', 'Received', 'Outstanding'] : [])];
  const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = rows.map((r) => [r.code, r.site_name, r.client_site_ref, r.customer_name, r.vendor_name, mediumLabel(r.medium), r.bandwidth_mbps, r.link_role, r.static_ip_block || (r.static_ip_count || ''), r.circuit_id, r.wan_ip, r.live_date, r.contract_end, r.status, r.terminated_on, r.uptime_30d, r.open_fault ? 'yes' : '',
    ...(money ? [r.monthly_price, r.monthly_cost, r.monthly_margin] : []), ...(billing ? [r.next_bill_date, r.billed, r.received, r.outstanding] : [])].map(cell).join(','));
  const blob = new Blob([`﻿${[head.map(cell).join(','), ...lines].join('\r\n')}`], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `live-sites-${todayIso()}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
};

/** Every running link in one place: client, ISP, circuit, contract end, monthly money and what is outstanding */
export const LiveSitesPage = () => {
  const user = useSelector((s) => s.auth.user);
  const money = hasPerm(user, 'commercial.view');
  const billing = hasPerm(user, 'billing.view');
  const reg = useApi('/sites/register');
  const [tab, setTab] = useState('LIVE');
  const [q, setQ] = useState('');
  const [client, setClient] = useState('');
  const [isp, setIsp] = useState('');
  const [medium, setMedium] = useState('');
  const [siteId, setSiteId] = useState(null);
  const [vendorId, setVendorId] = useState(null);
  const open = useCallback((id) => setSiteId(id), []);
  useFocusRecord('live', open);

  const all = useMemo(() => reg.data || [], [reg.data]);
  const pick = (key, label) => [...new Map(all.map((r) => [r[key], r[label]])).entries()].sort((a, b) => String(a[1]).localeCompare(String(b[1])));
  const clients = useMemo(() => pick('customer_id', 'customer_name'), [all]); // eslint-disable-line react-hooks/exhaustive-deps
  const isps = useMemo(() => pick('vendor_id', 'vendor_name'), [all]); // eslint-disable-line react-hooks/exhaustive-deps
  const filtered = useMemo(() => filterBy(all, q, ['code', 'site_name', 'client_site_ref', 'customer_name', 'vendor_name', 'circuit_id', 'wan_ip', 'static_ip_block', 'po_number', 'address'])
    .filter((r) => (!client || r.customer_id === client) && (!isp || r.vendor_id === isp) && (!medium || r.medium === medium)), [all, q, client, isp, medium]);
  const rows = filtered.filter(TABS.find((t) => t.id === tab).test);
  const live = filtered.filter((r) => r.status === 'LIVE');
  const sum = (k) => live.reduce((a, r) => a + Number(r[k] || 0), 0);

  const tiles = [
    ['Live links', live.length, `${formatMbps(sum('bandwidth_mbps'))} in total`, Wifi],
    money && ['Monthly billing', formatCurrency(sum('monthly_price')), 'link + static IP, before GST', IndianRupee],
    money && ['Monthly ISP cost', formatCurrency(sum('monthly_cost')), `margin ${formatCurrency(sum('monthly_margin'))} / month`, Gauge],
    ['Contracts ending', live.filter((r) => r.contract_days_left <= SOON).length, `within ${SOON} days or already ended`, CalendarClock],
    !money && ['Down now', live.filter((r) => r.open_fault).length, 'links with an open fault', Radio],
    billing && !money && ['Outstanding', formatCurrency(filtered.reduce((a, r) => a + Number(r.outstanding || 0), 0)), 'billed, not yet received', IndianRupee]
  ].filter(Boolean);

  return (
    <motion.div variants={page} initial="hidden" animate="visible" exit="exit" className="space-y-4">
      <PageHeader title="Live Sites" subtitle="Every running link in one place: client, ISP, circuit, contract end, monthly billing and ISP cost. Click a site to open it, or an ISP to see all its links."
        actions={<Button variant="outline" disabled={!rows.length} onClick={() => exportCsv(rows, money, billing)}><Download className="h-4 w-4" /> Export to Excel (CSV)</Button>} />
      <motion.div variants={list} className={`grid grid-cols-2 gap-3 ${tiles.length > 3 ? 'lg:grid-cols-4' : 'lg:grid-cols-3'}`}>
        {tiles.map(([label, value, sub, Icon]) => (
          <Card key={label}>
            <p className="flex items-center gap-1.5 text-xs font-medium text-muted"><Icon className="h-3.5 w-3.5" />{label}</p>
            <p className="mt-1.5 text-xl font-semibold text-ink tnum">{value}</p>
            <p className="text-[11px] text-muted">{sub}</p>
          </Card>
        ))}
      </motion.div>
      <div className="flex flex-wrap items-center gap-3">
        <PillTabs value={tab} onChange={setTab} options={TABS.map((t) => ({ id: t.id, label: t.label, count: filtered.filter(t.test).length }))} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Site, circuit, IP, PO…" className={`${inputClass} max-w-[220px]`} aria-label="Filter" />
        <select value={client} onChange={(e) => setClient(e.target.value)} className={`${selectClass} max-w-[220px]`} aria-label="Client">
          <option value="">All clients</option>{clients.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select>
        <select value={isp} onChange={(e) => setIsp(e.target.value)} className={`${selectClass} max-w-[200px]`} aria-label="ISP">
          <option value="">All ISPs</option>{isps.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select>
        <select value={medium} onChange={(e) => setMedium(e.target.value)} className={`${selectClass} max-w-[170px]`} aria-label="Medium">
          <option value="">All mediums</option>{MEDIUMS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
        </select>
      </div>
      {reg.isLoading ? <Loading /> : reg.error ? <ErrorBox error={reg.error} /> : (
        <motion.div variants={rise}>
          <Table rows={rows} onRowClick={(r) => setSiteId(r.id)}
            empty={tab === 'LIVE' ? (all.length ? 'No live site matches these filters.' : 'No live sites yet. A site appears here when it is marked live in Implementation.') : tab === 'DOWN' ? 'No link is down.' : tab === 'SOON' ? 'No contract ends in the next 60 days.' : 'No disconnected sites.'}
            columns={[
              { key: 'site', label: 'Site / client', render: (r) => <div><p className="font-semibold text-ink"><Code>{r.code}</Code> {r.site_name}{r.client_site_ref && <span className="ml-1 text-[11px] font-medium text-muted">[{r.client_site_ref}]</span>}<LinkTags role={r.link_role} ips={r.static_ip_count} /></p><p className="text-[11px] text-muted">{r.customer_name}{r.order_code ? ` · ${r.order_code}` : ''}</p></div> },
              { key: 'isp', label: 'ISP · link', render: (r) => <div className="text-xs"><button type="button" onClick={(e) => { e.stopPropagation(); setVendorId(r.vendor_id); }} className="inline-flex items-center gap-1 font-semibold text-brand-700 hover:underline" title={`All links with ${r.vendor_name}`}><Radio className="h-3.5 w-3.5" />{r.vendor_name}</button><p className="text-muted">{mediumLabel(r.medium)} · {formatMbps(r.bandwidth_mbps)}</p></div> },
              { key: 'circuit', label: 'Circuit / IP', render: (r) => <div className="text-xs"><p>{r.circuit_id || '—'}</p><p className="text-muted">{r.static_ip_block || r.wan_ip || ''}</p></div> },
              { key: 'live', label: 'Live since · uptime', render: (r) => <div className="text-xs"><p>{formatDate(r.live_date)}</p>{r.status === 'LIVE' && <p className={r.sla_pct && r.uptime_30d < Number(r.sla_pct) ? 'font-semibold text-[#C0283C]' : 'text-muted'}>{r.uptime_30d}% (30 d)</p>}</div> },
              { key: 'contract', label: 'Contract ends', render: (r) => <ContractCell r={r} /> },
              ...(money ? [{ key: 'm', label: 'MRC / ISP cost', render: (r) => <div className="text-xs tnum"><p className="font-semibold text-ink">{formatCurrency(r.monthly_price)}</p><p className="text-muted">{formatCurrency(r.monthly_cost)} · margin {formatCurrency(r.monthly_margin)}</p></div> }] : []),
              ...(billing ? [{ key: 'b', label: 'Next bill · outstanding', render: (r) => <div className="text-xs tnum"><p>{r.status === 'LIVE' ? formatDate(r.next_bill_date) : '—'}</p><p className={r.overdue_bills ? 'font-semibold text-[#C0283C]' : 'text-muted'}>{formatCurrency(r.outstanding)}{r.overdue_bills ? ` · ${r.overdue_bills} overdue` : ''}</p></div> }] : []),
              { key: 'st', label: 'Status', render: (r) => (r.open_fault ? <span className="inline-flex items-center gap-1 rounded-[5px] border border-[#F3C5CB] bg-[#FDF0F1] px-2 py-0.5 text-[11px] font-semibold uppercase text-[#C0283C]" title={r.open_fault.description}>Down</span> : <Status value={r.status} />) }
            ]} />
        </motion.div>
      )}
      <SiteDrawer id={siteId} onClose={() => setSiteId(null)} />
      <VendorDrawer id={vendorId} onClose={() => setVendorId(null)} />
    </motion.div>
  );
};

export default LiveSitesPage;
