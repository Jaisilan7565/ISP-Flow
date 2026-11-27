import React from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { motion } from 'framer-motion';
import {
  LayoutDashboard, Briefcase, Compass, FileSpreadsheet, Network, Receipt, Landmark, Settings, Radio, Building2, Users, Database, History, Wifi
} from 'lucide-react';
import { setActiveTab } from '../../store/slices/uiSlice';
import { hasPerm } from '../../store/slices/authSlice';
import { spring } from '../../utils/motion';
import TopographicCard from '../common/TopographicCard';

export const TENANT_NAV = [
  { group: 'Overview', items: [{ id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard }, { id: 'live', label: 'Live Sites', icon: Wifi, perm: 'implementation.view' }] },
  {
    group: 'Workflow',
    items: [
      { id: 'orders', label: 'Clients & Orders', icon: Briefcase, perm: 'orders.view' },
      { id: 'feasibility', label: '1 · Feasibility', icon: Compass, perm: 'feasibility.view' },
      { id: 'commercial', label: '2 · Quote & Budget', icon: FileSpreadsheet, perm: 'commercial.view' },
      { id: 'implementation', label: '3 · Implementation', icon: Network, perm: 'implementation.view' },
      { id: 'billing', label: '4 · Billing', icon: Receipt, perm: 'billing.view' },
      { id: 'treasury', label: '5 · Payments', icon: Landmark, perm: 'treasury.view' }
    ]
  },
  {
    group: 'Setup',
    items: [
      { id: 'masters', label: 'ISPs & Vendors', icon: Database, perm: 'masters.view' },
      { id: 'team', label: 'Team & Roles', icon: Users, perm: 'users.manage' },
      { id: 'settings', label: 'Company Settings', icon: Settings, perm: 'settings.manage' },
      { id: 'activity', label: 'Activity Log', icon: History }
    ]
  }
];

export const PLATFORM_NAV = [{ group: 'Platform', items: [{ id: 'platform', label: 'Companies', icon: Building2 }] }];

export const allowedTabs = (user) => {
  if (!user) return [];
  const nav = user.role === 'PLATFORM_OWNER' ? PLATFORM_NAV : TENANT_NAV;
  return nav.flatMap((g) => g.items).filter((i) => !i.perm || hasPerm(user, i.perm)).map((i) => i.id);
};

export const Sidebar = () => {
  const dispatch = useDispatch();
  const activeTab = useSelector((s) => s.ui.activeTab);
  const user = useSelector((s) => s.auth.user);
  const nav = user?.role === 'PLATFORM_OWNER' ? PLATFORM_NAV : TENANT_NAV;

  return (
    <aside className="relative hidden h-full w-[248px] shrink-0 flex-col overflow-y-auto rounded-panel bg-panel p-4 shadow-card lg:flex">
      <div className="flex items-center gap-3 px-3 py-3">
        <div className="grid h-10 w-10 place-items-center rounded-2xl bg-brand-800 text-white shadow-hero">
          <Radio className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <span className="text-base font-semibold tracking-tight text-ink">ISP-Flow</span>
          <span className="block truncate text-[11px] font-medium uppercase tracking-wider text-muted">
            {user?.tenant_name || 'Platform Console'}
          </span>
        </div>
      </div>

      {nav.map((g) => {
        const items = g.items.filter((i) => !i.perm || hasPerm(user, i.perm));
        if (!items.length) return null;
        return (
          <div key={g.group} className="mt-5">
            <span className="px-3 text-[11px] font-semibold uppercase tracking-wider text-subtle">{g.group}</span>
            <nav className="mt-1.5 space-y-0.5">
              {items.map((item) => {
                const Icon = item.icon;
                const active = activeTab === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => dispatch(setActiveTab(item.id))}
                    className={`relative flex w-full items-center gap-3 rounded-full px-3.5 py-2.5 text-sm font-medium transition-colors ${active ? 'font-semibold text-white' : 'text-muted hover:bg-card/50 hover:text-ink'}`}
                  >
                    {active && <motion.div layoutId="sidebar-active-pill" transition={spring.layout} className="btn-primary absolute inset-0 rounded-full" />}
                    <Icon className="relative z-10 h-4 w-4 shrink-0" />
                    <span className="relative z-10 truncate">{item.label}</span>
                  </button>
                );
              })}
            </nav>
          </div>
        );
      })}

      <div className="mt-auto pt-5">
        <TopographicCard pattern="rings" className="rounded-card p-4">
          <p className="text-xs font-semibold text-white/90">{user?.role_label}</p>
          <p className="mt-1 text-[11px] leading-relaxed text-white/75">
            {user?.role === 'PLATFORM_OWNER'
              ? 'Onboard ISP companies and their admins.'
              : 'Client order → Feasibility → Quote → PO → Live → Bill → Payment, all linked.'}
          </p>
        </TopographicCard>
      </div>
    </aside>
  );
};

export default Sidebar;
