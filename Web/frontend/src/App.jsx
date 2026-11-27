import { useLiveSync } from './api/realtime';
import React, { useEffect, useState } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { AnimatePresence } from 'framer-motion';
import { useQueryClient } from '@tanstack/react-query';
import Sidebar, { allowedTabs } from './components/layout/Sidebar';
import Header from './components/layout/Header';
import { ToastProvider } from './components/common/Toast';
import { Loading } from './components/common/kit';
import { setActiveTab } from './store/slices/uiSlice';
import { profileLoaded, signedOut } from './store/slices/authSlice';
import { get, setUnauthorizedHandler } from './api/client';
import LoginPage from './features/auth/LoginPage';
import ChangePasswordModal from './features/auth/ChangePasswordModal';
import PlatformPage from './features/platform/PlatformPage';
import DashboardPage from './features/dashboard/pages/DashboardPage';
import ClientsPage from './features/clients/ClientsPage';
import FeasibilityPage from './features/feasibility/pages/FeasibilityPage';
import CommercialPage from './features/commercial/pages/CommercialPage';
import ImplementationPage from './features/implementation/pages/ImplementationPage';
import BillingPage from './features/billing/pages/BillingPage';
import TreasuryPage from './features/treasury/pages/TreasuryPage';
import MastersPage from './features/admin/MastersPage';
import LiveSitesPage from './features/sites/LiveSitesPage';
import TeamPage from './features/admin/TeamPage';
import SettingsPage from './features/settings/pages/SettingsPage';
import ActivityPage from './features/admin/ActivityPage';
import Site360Drawer from './features/lifecycle/Site360Drawer';

const PAGES = {
  platform: PlatformPage,
  dashboard: DashboardPage,
  live: LiveSitesPage,
  orders: ClientsPage,
  feasibility: FeasibilityPage,
  commercial: CommercialPage,
  implementation: ImplementationPage,
  billing: BillingPage,
  treasury: TreasuryPage,
  masters: MastersPage,
  team: TeamPage,
  settings: SettingsPage,
  activity: ActivityPage
};

const Shell = () => {
  const dispatch = useDispatch();
  const activeTab = useSelector((s) => s.ui.activeTab);
  const user = useSelector((s) => s.auth.user);
  const [pwOpen, setPwOpen] = useState(false);
  const tabs = allowedTabs(user);
  const tab = tabs.includes(activeTab) ? activeTab : tabs[0];

  useEffect(() => {
    if (tab !== activeTab) dispatch(setActiveTab(tab));
  }, [tab, activeTab, dispatch]);

  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        document.getElementById('global-search')?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const CurrentPage = PAGES[tab] || DashboardPage;
  return (
    <div className="flex h-dvh w-full overflow-hidden bg-canvas p-2 font-sans text-ink sm:p-3">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden lg:ml-3">
        <Header onChangePassword={() => setPwOpen(true)} />
        <main className="mt-3 flex-1 overflow-y-auto rounded-panel bg-panel p-4 shadow-card sm:p-6">
          <AnimatePresence mode="wait">
            <CurrentPage key={tab} />
          </AnimatePresence>
        </main>
      </div>
      <Site360Drawer />
      <ChangePasswordModal open={pwOpen || Boolean(user?.must_change_password)} forced={Boolean(user?.must_change_password)} onClose={() => setPwOpen(false)} />
    </div>
  );
};

export const App = () => {
  const dispatch = useDispatch();
  const qc = useQueryClient();
  const { token, user, checked } = useSelector((s) => s.auth);
  const theme = useSelector((s) => s.ui.theme);

  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);

  useEffect(() => {
    setUnauthorizedHandler((reason) => dispatch(signedOut(reason)));
  }, [dispatch]);

  // Restore session on reload
  useEffect(() => {
    if (token && !user) {
      get('/auth/me').then((u) => dispatch(profileLoaded(u))).catch(() => dispatch(signedOut()));
    }
  }, [token, user, dispatch]);

  // Drop cached data from the previous user on sign-out
  useEffect(() => { if (!token) qc.clear(); }, [token, qc]);

  // Live sync: refresh when someone else in the company changes something (Socket.io)
  useLiveSync(user ? token : null);

  let body;
  if (!token) body = <LoginPage />;
  else if (!user || !checked) body = <div className="grid h-dvh place-items-center bg-canvas"><Loading label="Signing in…" /></div>;
  else body = <Shell />;

  return <ToastProvider>{body}</ToastProvider>;
};

export default App;
