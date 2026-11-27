const ApiError = require('./apiError');

/** Wrap async route handlers so thrown errors reach the error middleware */
const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/** Next running number per tenant + key, inside the given transaction client */
const nextCode = async (c, tenantId, key, prefix) => {
  const row = await c.one(
    `INSERT INTO counters (tenant_id, key, value) VALUES ($1, $2, 1)
     ON CONFLICT (tenant_id, key) DO UPDATE SET value = counters.value + 1
     RETURNING value`,
    [tenantId, key]
  );
  const yy = String(new Date().getFullYear()).slice(-2);
  return `${prefix}-${yy}-${String(row.value).padStart(4, '0')}`;
};

/** Financial year label like 26-27 (April–March) */
const fyLabel = (d = new Date()) => {
  const y = d.getFullYear();
  const start = d.getMonth() >= 3 ? y : y - 1;
  return `${String(start).slice(-2)}-${String(start + 1).slice(-2)}`;
};

/** Business timezone (India by default) — "today" must match what users see on their calendar */
const TIMEZONE = process.env.APP_TIMEZONE || 'Asia/Kolkata';
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

/** Joi custom rule: date may not be after today (business timezone) */
const notFuture = (value, helpers) =>
  value.toISOString().slice(0, 10) > today() ? helpers.message('{{#label}} cannot be in the future') : value;

/** Add days / months to a YYYY-MM-DD string */
const addDays = (dateStr, n) => {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + Number(n));
  return d.toISOString().slice(0, 10);
};
const addMonths = (dateStr, n) => {
  const d = new Date(`${dateStr}T00:00:00Z`);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + Number(n));
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d.toISOString().slice(0, 10);
};
const daysBetween = (a, b) => Math.round((new Date(`${b}T00:00:00Z`) - new Date(`${a}T00:00:00Z`)) / 86400000);

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/** ₹1,23,456 — Indian grouping for human-readable activity messages */
const inr = (n) => `₹${new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(Number(n) || 0)}`;

/**
 * Extract coordinates from a Google Maps link or a raw "lat, long" in a WhatsApp message.
 * Handles: @12.97,77.59 · ?q=12.97,77.59 · !3d12.97!4d77.59 · ll=… · plain "12.9716, 77.5946"
 */
const parseCoordinates = (text = '') => {
  if (!text) return null;
  const patterns = [
    /@(-?\d{1,2}\.\d+),\s*(-?\d{1,3}\.\d+)/,
    /!3d(-?\d{1,2}\.\d+)!4d(-?\d{1,3}\.\d+)/,
    /[?&](?:q|ll|query|destination)=(-?\d{1,2}\.\d+),\s*(-?\d{1,3}\.\d+)/,
    /(-?\d{1,2}\.\d{3,})\s*[, ]\s*(-?\d{1,3}\.\d{3,})/
  ];
  for (const re of patterns) {
    const m = String(text).match(re);
    if (m) {
      const lat = Number(m[1]);
      const lng = Number(m[2]);
      if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) return { latitude: lat, longitude: lng };
    }
  }
  return null;
};

const extractMapsUrl = (text = '') => {
  const m = String(text).match(/https?:\/\/(?:maps\.app\.goo\.gl|goo\.gl\/maps|(?:www\.)?google\.[a-z.]+\/maps)[^\s]*/i);
  return m ? m[0] : null;
};

const extractPincode = (text = '') => {
  const m = String(text).match(/\b([1-9]\d{5})\b/);
  return m ? m[1] : null;
};

/** Guard a workflow transition */
const assertStatus = (record, allowed, action) => {
  if (!allowed.includes(record.status)) {
    throw ApiError.conflict(`Cannot ${action} while status is ${record.status.replace(/_/g, ' ')}. Allowed when: ${allowed.join(', ')}`);
  }
};

/** 2026-12-05 → 05 Dec 2026 (for messages shown to people) */
const dmy = (iso) => (iso ? new Date(`${String(iso).slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '');

module.exports = {
  dmy, ah, nextCode, fyLabel, today, notFuture, TIMEZONE, addDays, addMonths, daysBetween, round2, inr,
  parseCoordinates, extractMapsUrl, extractPincode, assertStatus
};
