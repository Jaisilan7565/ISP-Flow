import React, { useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { GitBranch } from 'lucide-react';
import { useApi } from '../api/hooks';
import { clearFocus, openLifecycle } from '../store/slices/uiSlice';
import { Timeline, Loading, Section } from '../components/common/kit';
import { Button } from '../components/common/ui';

/** When another screen sends the user here for a record (alert, search, link), open it. */
export const useFocusRecord = (module, open) => {
  const dispatch = useDispatch();
  const focus = useSelector((s) => s.ui.focus);
  useEffect(() => {
    if (focus?.module === module) {
      open(focus.id);
      dispatch(clearFocus());
    }
  }, [focus, module, open, dispatch]);
};

export const RecordActivity = ({ entityId }) => {
  const { data, isLoading } = useApi('/admin/activity', { entityId, limit: 50 });
  return (
    <Section title="Activity">
      {isLoading ? <Loading /> : <Timeline items={[...(data || [])].reverse()} />}
    </Section>
  );
};

export const Site360Button = ({ id, label = 'Site 360 · full chain' }) => {
  const dispatch = useDispatch();
  return (
    <Button size="sm" variant="outline" onClick={() => dispatch(openLifecycle(id))}>
      <GitBranch className="h-3.5 w-3.5" /> {label}
    </Button>
  );
};

export const Code = ({ children }) => (
  <span className="whitespace-nowrap rounded border border-brand-200 bg-brand-50 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-brand-700">{children}</span>
);

export const filterBy = (rows, q, keys) => {
  if (!q) return rows;
  const s = q.toLowerCase();
  return rows.filter((r) => keys.some((k) => String(r[k] ?? '').toLowerCase().includes(s)));
};

/* ---------------- Link medium ---------------- */
export const MEDIUMS = [{ value: 'FIBER', label: 'Fiber' }, { value: 'BROADBAND', label: 'Broadband' }, { value: 'LEASED_LINE', label: 'Leased line' }, { value: 'RF', label: 'RF / Microwave' }, { value: '4G_5G', label: '4G / 5G' }];
export const mediumLabel = (m) => MEDIUMS.find((x) => x.value === m)?.label || m || '—';
/** How the service is described on the client's bill, by medium */
const SERVICE = { FIBER: 'Fiber internet service', BROADBAND: 'Broadband internet service', LEASED_LINE: 'Internet leased line service', RF: 'RF / microwave internet service', '4G_5G': '4G / 5G internet service' };
export const serviceName = (m) => SERVICE[m] || 'Internet service';
/** Bill label: the 1st bill carries the OTC with cycle 1 */
export const billLabel = (i) => (i.invoice_type === 'OTC' ? 'Site OTC' : `Cycle ${i.cycle_no}${Number(i.otc_amount) > 0 ? ' + OTC' : ''}`);

/* ---------------- Link type (primary / secondary) and static IP ---------------- */
export const LINK_ROLES = [{ value: 'PRIMARY', label: 'Primary link' }, { value: 'SECONDARY', label: 'Secondary (backup) link' }];
/** Usual static IP sizes sold with a link; the API accepts any count from 0 to 256 */
export const STATIC_IP_OPTIONS = [
  { value: '0', label: 'Not needed' },
  { value: '1', label: '1 IP' },
  { value: '4', label: '/30 block · 4 IPs' },
  { value: '8', label: '/29 block · 8 IPs' },
  { value: '16', label: '/28 block · 16 IPs' },
  { value: '32', label: '/27 block · 32 IPs' },
  { value: '64', label: '/26 block · 64 IPs' }
];
export const staticIpLabel = (n) => {
  const count = Number(n) || 0;
  if (!count) return 'Not needed';
  return STATIC_IP_OPTIONS.find((o) => Number(o.value) === count)?.label || `${count} IPs`;
};
export const needsStaticIp = (x) => Number(x?.static_ip_count) > 0;

/** Small tags after a site name: "Secondary" and "Static IP ×8" (nothing for a plain primary link) */
export const LinkTags = ({ role, ips }) => (
  <>
    {role === 'SECONDARY' && <span className="ml-1.5 inline-flex rounded-md bg-[#FFF4E0] px-1.5 py-0.5 align-middle text-[10px] font-semibold uppercase tracking-wide text-[#8A5A00]">Secondary</span>}
    {Number(ips) > 0 && <span className="ml-1.5 inline-flex rounded-md bg-brand-50 px-1.5 py-0.5 align-middle text-[10px] font-semibold uppercase tracking-wide text-brand-700">Static IP ×{ips}</span>}
  </>
);
