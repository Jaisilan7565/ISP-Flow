/**
 * Shared Joi field rules. The frontend has the same rules in Yup (Web/frontend/src/validation/rules.js):
 * same patterns, same limits. tests/validation.parity.test.js proves both accept and reject the same values.
 */
const Joi = require('joi');
const { today } = require('../utils/helpers');

const PATTERNS = {
  email: /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/,
  phone: /^\+?[0-9][0-9 -]{8,16}[0-9]$/,
  gstin: /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/,
  pincode: /^[1-9][0-9]{5}$/,
  password: /^(?=.*[A-Za-z])(?=.*[0-9]).{8,72}$/,
  companyCode: /^[A-Z0-9]{2,16}$/,
  invoicePrefix: /^[A-Z0-9]{1,16}$/,
  ipv4: /^((25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])\.){3}(25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])$/,
  ipv4Cidr: /^((25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])\.){3}(25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])(\/(3[0-2]|[12]?[0-9]))?$/,
  url: /^https?:\/\/[^\s]+$/,
  uuid: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
};

const MESSAGES = {
  email: 'must be a valid email address, e.g. name@company.com',
  phone: 'must be a valid phone number (10–15 digits, spaces or dashes allowed)',
  gstin: 'must be a valid 15-character GSTIN, e.g. 29ABCDE1234F1Z5',
  pincode: 'must be a 6-digit pincode',
  password: 'must be 8–72 characters with at least one letter and one number',
  companyCode: 'must be 2–16 letters or digits',
  invoicePrefix: 'must be 1–16 letters or digits',
  ipv4: 'must be an IPv4 address, e.g. 103.24.120.46',
  ipv4Cidr: 'must be an IPv4 address, optionally with /prefix, e.g. 103.24.120.45/30',
  url: 'must be a full link starting with http:// or https://',
  notFuture: 'cannot be in the future'
};

const pattern = (key) => Joi.string().trim().pattern(PATTERNS[key]).messages({ 'string.pattern.base': `{{#label}} ${MESSAGES[key]}` });
const optional = (schema) => schema.allow('', null);

/** ISO date that is not after today in the business timezone */
const notFuture = (value, helpers) => {
  const iso = value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
  return iso > today() ? helpers.message(`{{#label}} ${MESSAGES.notFuture}`) : value;
};

const R = {
  name: (max = 128) => Joi.string().trim().min(2).max(max),
  text: (max = 1000) => Joi.string().trim().max(max),
  reason: (max = 1000) => Joi.string().trim().min(3).max(max),
  email: () => pattern('email').lowercase().max(255),
  phone: () => pattern('phone').max(32),
  gstin: () => pattern('gstin').uppercase(),
  pincode: () => pattern('pincode'),
  password: () => Joi.string().pattern(PATTERNS.password).messages({ 'string.pattern.base': `{{#label}} ${MESSAGES.password}` }),
  companyCode: () => pattern('companyCode').uppercase(),
  invoicePrefix: () => pattern('invoicePrefix').uppercase(),
  ipv4: () => pattern('ipv4'),
  ipv4Cidr: () => pattern('ipv4Cidr'),
  url: () => pattern('url').max(2000),
  uuid: () => Joi.string().uuid(),
  date: () => Joi.date().iso(),
  pastDate: () => Joi.date().iso().custom(notFuture),
  money: () => Joi.number().min(0).max(1e12),
  positiveMoney: () => Joi.number().greater(0).max(1e12),
  int: (min = 0, max = 1e9) => Joi.number().integer().min(min).max(max),
  pct: () => Joi.number().min(0).max(100),
  optional
};

/** router.param guard: rejects malformed record IDs in the URL with a clear 400 before any query runs */
const ApiError = require('../utils/apiError');
const guardIds = (router, names = ['id']) => {
  for (const n of names) {
    router.param(n, (req, res, next, value) => (PATTERNS.uuid.test(value) ? next() : next(ApiError.badRequest(`Invalid ${n} in the URL`))));
  }
  return router;
};

module.exports = { R, PATTERNS, MESSAGES, notFuture, guardIds };
