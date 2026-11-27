import React, { useEffect, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Search, Palette, LogOut, KeyRound, ChevronDown, Menu } from 'lucide-react';
import { setTheme, openRecord, setActiveTab } from '../../store/slices/uiSlice';
import { signedOut } from '../../store/slices/authSlice';
import { useApi } from '../../api/hooks';
import { Status } from '../common/ui';
import { PLATFORM_NAV, TENANT_NAV, allowedTabs } from './Sidebar';

const THEMES = [
  { id: 'cobalt', label: 'Cobalt', color: '#143D75' },
  { id: 'emerald', label: 'Emerald', color: '#145534' },
  { id: 'amber', label: 'Amber', color: '#663207' },
  { id: 'titanium', label: 'Titanium', color: '#23272E' }
];

const GlobalSearch = () => {
  const dispatch = useDispatch();
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);
  const { data = [], isFetching } = useApi(debounced.length >= 2 ? '/dashboard/search' : null, { q: debounced });

  return (
    <div className="relative w-full max-w-md">
      <Search className="pointer-events-none absolute left-3.5 top-3 h-4 w-4 text-muted" />
      <input
        id="global-search"
        value={q}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder="Search code, site, PO, invoice, AWB… (Ctrl K)"
        className="h-10 w-full rounded-full border border-line-strong bg-card pl-10 pr-4 text-sm text-ink placeholder:text-subtle focus:border-brand-600 focus:outline-none"
      />
      {open && debounced.length >= 2 && (
        <div className="absolute left-0 right-0 top-12 z-40 max-h-80 overflow-y-auto rounded-2xl border border-line bg-card p-1.5 shadow-lift">
          {isFetching && !data.length ? <p className="px-3 py-2 text-xs text-muted">Searching…</p> : !data.length ? (
            <p className="px-3 py-2 text-xs text-muted">No matches for “{debounced}”</p>
          ) : data.map((r) => (
            <button
              key={`${r.module}-${r.id}`}
              onMouseDown={() => { dispatch(openRecord({ module: r.module, id: r.id })); setQ(''); }}
              className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left hover:bg-brand-50"
            >
              <span className="w-24 shrink-0 text-[10px] font-semibold uppercase tracking-wide text-subtle">{r.module}</span>
              <span className="min-w-0 flex-1">
                <span className="block font-mono text-xs font-semibold text-brand-700">{r.ref}</span>
                <span className="block truncate text-xs text-muted">{r.detail}</span>
              </span>
              <Status value={r.status} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export const Header = ({ onChangePassword }) => {
  const dispatch = useDispatch();
  const theme = useSelector((s) => s.ui.theme);
  const activeTab = useSelector((s) => s.ui.activeTab);
  const user = useSelector((s) => s.auth.user);
  const [menu, setMenu] = useState(false);
  const menuRef = useRef();
  const isPlatform = user?.role === 'PLATFORM_OWNER';
  const tabs = allowedTabs(user);
  const nav = (isPlatform ? PLATFORM_NAV : TENANT_NAV).flatMap((g) => g.items).filter((i) => tabs.includes(i.id));

  useEffect(() => {
    const close = (e) => menuRef.current && !menuRef.current.contains(e.target) && setMenu(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const initials = (user?.name || '?').split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();

  return (
    <header className="flex min-h-16 w-full flex-wrap items-center justify-between gap-3 rounded-panel bg-panel px-4 py-3 shadow-card sm:px-6">
      {/* Mobile navigation */}
      <label className="relative flex items-center lg:hidden">
        <Menu className="pointer-events-none absolute left-3 h-4 w-4 text-muted" />
        <select value={activeTab} onChange={(e) => dispatch(setActiveTab(e.target.value))} aria-label="Navigate"
          className="h-10 rounded-full border border-line-strong bg-card pl-9 pr-4 text-sm font-medium text-ink">
          {nav.map((i) => <option key={i.id} value={i.id}>{i.label}</option>)}
        </select>
      </label>

      {!isPlatform ? <GlobalSearch /> : <div className="text-sm font-medium text-muted">Platform administration</div>}

      <div className="flex items-center gap-3">
        <div className="hidden items-center gap-1.5 rounded-full border border-line bg-card p-1 shadow-sm md:flex">
          <Palette className="ml-2 mr-1 h-3.5 w-3.5 text-muted" />
          {THEMES.map((t) => (
            <button key={t.id} onClick={() => dispatch(setTheme(t.id))} title={`${t.label} theme`} aria-label={`${t.label} theme`}
              className={`h-5 w-5 rounded-full transition-transform ${theme === t.id ? 'scale-110 ring-2 ring-brand-600' : 'opacity-70 hover:opacity-100'}`}
              style={{ backgroundColor: t.color }} />
          ))}
        </div>

        <div className="relative" ref={menuRef}>
          <button onClick={() => setMenu((m) => !m)} className="flex items-center gap-2.5 rounded-full border border-line bg-card px-2.5 py-1.5 shadow-sm">
            <span className="grid h-7 w-7 place-items-center rounded-full bg-brand-800 text-xs font-semibold text-white">{initials}</span>
            <span className="hidden text-left text-xs sm:block">
              <span className="block font-semibold leading-tight text-ink">{user?.name}</span>
              <span className="text-[10px] text-muted">{user?.role_label}</span>
            </span>
            <ChevronDown className="h-3.5 w-3.5 text-muted" />
          </button>
          {menu && (
            <div className="absolute right-0 top-12 z-40 w-56 rounded-2xl border border-line bg-card p-1.5 shadow-lift">
              <div className="border-b border-line px-3 py-2 text-xs">
                <p className="font-semibold text-ink">{user?.email}</p>
                <p className="text-muted">{user?.tenant_name || 'Platform'}</p>
              </div>
              <button onClick={() => { setMenu(false); onChangePassword(); }} className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm text-ink-2 hover:bg-panel">
                <KeyRound className="h-4 w-4" /> Change password
              </button>
              <button onClick={() => dispatch(signedOut())} className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm text-[#C0283C] hover:bg-[#FDF0F1]">
                <LogOut className="h-4 w-4" /> Sign out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};

export default Header;
