import { createSlice } from '@reduxjs/toolkit';

const safeGet = (k, d) => {
  try { return localStorage.getItem(k) || d; } catch { return d; }
};
const initialTab = () => (typeof window !== 'undefined' && window.location.hash.slice(1)) || 'dashboard';

const initialState = {
  activeTab: initialTab(),
  theme: safeGet('isp_theme', 'cobalt'),
  /** Open a specific record when landing on a page: { module, id } */
  focus: null,
  /** Site 360 drawer target (feasibility / quote / site / invoice id) */
  lifecycleId: null
};

const uiSlice = createSlice({
  name: 'ui',
  initialState,
  reducers: {
    setActiveTab: (state, action) => {
      state.activeTab = action.payload;
      if (typeof window !== 'undefined') window.history.replaceState(null, '', `#${action.payload}`);
    },
    openRecord: (state, action) => {
      const { module, id } = action.payload;
      state.activeTab = module;
      state.focus = { module, id, at: Date.now() };
      if (typeof window !== 'undefined') window.history.replaceState(null, '', `#${module}`);
    },
    clearFocus: (state) => { state.focus = null; },
    openLifecycle: (state, action) => { state.lifecycleId = action.payload; },
    setTheme: (state, action) => {
      state.theme = action.payload;
      try { localStorage.setItem('isp_theme', action.payload); } catch { /* ignore */ }
      if (typeof document !== 'undefined') {
        document.documentElement.dataset.theme = action.payload;
        document.documentElement.classList.add('theme-transition');
        setTimeout(() => document.documentElement.classList.remove('theme-transition'), 500);
      }
    }
  }
});

export const { setActiveTab, openRecord, clearFocus, openLifecycle, setTheme } = uiSlice.actions;
export default uiSlice.reducer;
