import axios from 'axios';

const TOKEN_KEY = 'ispflow_token';

export const tokenStore = {
  get: () => {
    try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
  },
  set: (t) => {
    try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch { /* storage blocked */ }
  }
};

export const api = axios.create({ baseURL: '/api/v1', timeout: 30000 });

api.interceptors.request.use((config) => {
  const t = tokenStore.get();
  if (t) config.headers.Authorization = `Bearer ${t}`;
  return config;
});

let onUnauthorized = () => {};
export const setUnauthorizedHandler = (fn) => { onUnauthorized = fn; };

api.interceptors.response.use(
  (res) => res.data, // { success, message, data }
  (err) => {
    const status = err.response?.status;
    const body = err.response?.data || {};
    const message = body.message || (err.code === 'ECONNABORTED' ? 'Server took too long to respond' : err.response ? `Request failed (${status})` : 'Cannot reach the server — is the API running?');
    const isLogin = String(err.config?.url).includes('/auth/login');
    // Expired session, deactivated user, or company suspended by the platform admin → back to sign-in
    if (!isLogin && (status === 401 || (status === 403 && /suspended/i.test(message)))) onUnauthorized(message);
    const e = new Error(message);
    e.status = status;
    e.errors = body.errors;
    return Promise.reject(e);
  }
);

export const get = (url, params) => api.get(url, { params }).then((r) => r.data);
export const post = (url, body) => api.post(url, body);
export const put = (url, body) => api.put(url, body);
export const patch = (url, body) => api.patch(url, body);
export const del = (url) => api.delete(url);

export const downloadUrl = (docId, inline = false) => `/api/v1/documents/${docId}/download?token=${encodeURIComponent(tokenStore.get() || '')}${inline ? '&inline=1' : ''}`;
