/**
 * Formatting helpers for ISP-Flow (Indian locale).
 */
export const formatCurrency = (amount) => {
  if (amount === undefined || amount === null || amount === '' || Number.isNaN(Number(amount))) return '₹0';
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(Number(amount));
};

export const formatMoney2 = (amount) =>
  new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(amount) || 0);

export const formatMbps = (mbps) => {
  if (!mbps) return '—';
  return mbps >= 1000 ? `${(mbps / 1000).toFixed(1)} Gbps` : `${mbps} Mbps`;
};

export const formatDate = (v) => {
  if (!v) return '—';
  const d = typeof v === 'string' && v.length === 10 ? new Date(`${v}T00:00:00`) : new Date(v);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
};

export const formatDateTime = (v) => {
  if (!v) return '—';
  return new Date(v).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
};

export const todayIso = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};

export const daysAgo = (v) => {
  if (!v) return null;
  return Math.max(0, Math.floor((Date.now() - new Date(v).getTime()) / 86400000));
};

/** Convert an empty string to null and numeric strings to numbers for API payloads */
export const num = (v) => (v === '' || v === null || v === undefined ? null : Number(v));
