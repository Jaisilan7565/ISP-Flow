/**
 * Shared Yup field rules: the same patterns and limits as the API's Joi rules
 * (Web/backend/src/validation/rules.js). Web/backend/tests/validation.parity.test.js checks both
 * accept and reject the same sample values, so a form never lets through what the API would refuse.
 */
import * as yup from 'yup';

export const PATTERNS = {
  email: /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/,
  phone: /^\+?[0-9][0-9 -]{8,16}[0-9]$/,
  gstin: /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/,
  pincode: /^[1-9][0-9]{5}$/,
  password: /^(?=.*[A-Za-z])(?=.*[0-9]).{8,72}$/,
  companyCode: /^[A-Z0-9]{2,16}$/,
  invoicePrefix: /^[A-Z0-9]{1,16}$/,
  ipv4: /^((25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])\.){3}(25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])$/,
  ipv4Cidr: /^((25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])\.){3}(25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])(\/(3[0-2]|[12]?[0-9]))?$/,
  url: /^https?:\/\/[^\s]+$/
};

export const MSG = {
  required: 'Required',
  email: 'Enter a valid email address, e.g. name@company.com',
  phone: 'Enter a valid phone number (10–15 digits, spaces or dashes allowed)',
  gstin: 'Enter a valid 15-character GSTIN, e.g. 29ABCDE1234F1Z5',
  pincode: 'Enter a 6-digit pincode',
  password: 'Use 8–72 characters with at least one letter and one number',
  companyCode: 'Use 2–16 letters or digits',
  invoicePrefix: 'Use 1–16 letters or digits',
  ipv4: 'Enter an IPv4 address, e.g. 103.24.120.46',
  ipv4Cidr: 'Enter an IPv4 address, optionally with /prefix, e.g. 103.24.120.45/30',
  url: 'Enter a full link starting with http:// or https://',
  notFuture: 'Date cannot be in the future',
  number: 'Enter a number',
  integer: 'Enter a whole number',
  date: 'Enter a valid date'
};

/** Today's date in India time (yyyy-mm-dd) — same business day the API uses */
export const todayIST = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());

const blankToUndefined = (v, original) => (original === '' || original === null ? undefined : v);
const trimmed = () => yup.string().transform((v) => (typeof v === 'string' ? v.trim() : v));
const upper = () => yup.string().transform((v) => (typeof v === 'string' ? v.trim().toUpperCase() : v));
const matching = (base, key) => base.test(key, MSG[key], (v) => v === undefined || v === null || v === '' || PATTERNS[key].test(v));

/** Required-ness is added by the caller with .required(MSG.required) */
export const R = {
  name: (max = 128) => trimmed().min(2, 'Enter at least 2 characters').max(max, `Keep it under ${max} characters`),
  text: (max = 1000) => trimmed().max(max, `Keep it under ${max} characters`),
  reason: (max = 1000) => trimmed().min(3, 'Enter at least 3 characters').max(max, `Keep it under ${max} characters`),
  email: () => matching(trimmed().lowercase().max(255), 'email'),
  phone: () => matching(trimmed().max(32), 'phone'),
  gstin: () => matching(upper(), 'gstin'),
  pincode: () => matching(trimmed(), 'pincode'),
  password: () => matching(yup.string(), 'password'),
  companyCode: () => matching(upper(), 'companyCode'),
  invoicePrefix: () => matching(upper(), 'invoicePrefix'),
  ipv4: () => matching(trimmed(), 'ipv4'),
  ipv4Cidr: () => matching(trimmed(), 'ipv4Cidr'),
  url: () => matching(trimmed().max(2000), 'url'),
  date: () => yup.string().test('date', MSG.date, (v) => !v || !Number.isNaN(Date.parse(v))),
  pastDate: () => R.date().test('notFuture', MSG.notFuture, (v) => !v || v.slice(0, 10) <= todayIST()),
  number: () => yup.number().transform(blankToUndefined).typeError(MSG.number),
  int: (min = 0, max = 1e9) => R.number().integer(MSG.integer).min(min, `Must be ${min} or more`).max(max, `Must be ${max} or less`),
  money: () => R.number().min(0, 'Must be 0 or more').max(1e12, 'Amount is too large'),
  positiveMoney: () => R.number().moreThan(0, 'Must be more than 0').max(1e12, 'Amount is too large'),
  pct: () => R.number().min(0, 'Must be 0–100').max(100, 'Must be 0–100'),
  select: (values) => yup.string().oneOf(values, 'Choose one of the options'),
  id: () => yup.string()
};

/** A + B + C budget must total 100 % (same check as the API) */
export const totals100 = (a, b, c) => (schema) =>
  schema.test('abc', 'A + B + C must equal 100%', function check() {
    const p = this.parent;
    const t = Number(p[a] || 0) + Number(p[b] || 0) + Number(p[c] || 0);
    return Math.abs(t - 100) <= 0.01;
  });

export { yup };
