import { createSlice } from '@reduxjs/toolkit';
import { tokenStore } from '../../api/client';

const authSlice = createSlice({
  name: 'auth',
  initialState: { token: tokenStore.get(), user: null, checked: false },
  reducers: {
    signedIn: (state, action) => {
      state.token = action.payload.token;
      state.user = action.payload.user;
      state.checked = true;
      tokenStore.set(action.payload.token);
    },
    profileLoaded: (state, action) => {
      state.user = action.payload;
      state.checked = true;
    },
    signedOut: (state, action) => {
      state.token = null;
      state.user = null;
      state.checked = true;
      state.notice = typeof action.payload === 'string' ? action.payload : null;
      tokenStore.set(null);
    }
  }
});

export const { signedIn, profileLoaded, signedOut } = authSlice.actions;
export default authSlice.reducer;

/** permission check mirroring backend constants/roles.js */
export const hasPerm = (user, perm) => {
  if (!user) return false;
  const p = user.permissions || [];
  return p.includes('*') || p.includes(perm);
};
