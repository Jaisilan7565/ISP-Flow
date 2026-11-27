/**
 * Frontend (Yup) and backend (Joi) validation parity.
 * The same sample values must be accepted / rejected by both rule sets:
 *   Web/frontend/src/validation/rules.js  (Yup, used by every Formik form)
 *   Web/backend/src/validation/rules.js   (Joi, used by every API route)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { pathToFileURL } = require('url');
const { R: J } = require('../src/validation/rules');
const { today, addDays } = require('../src/utils/helpers');

const FRONT = pathToFileURL(path.join(__dirname, '..', '..', 'frontend', 'src', 'validation', 'rules.js')).href;

const CASES = {
  email: { ok: ['a@b.co', 'admin@tgt.local', 'x.y@sub.domain.in', 'Name@Company.COM'], bad: ['a@b', 'a b@c.com', '@x.com', 'a@.com', 'plain', 'a@b..com'] },
  phone: { ok: ['9845012345', '+91 98450 12345', '080-41234567', '+919800000000'], bad: ['12345', 'abcdefghij', '98450123456789012345', '98450-', '+-9845012345'] },
  gstin: { ok: ['29ABCDE1234F1Z5', '29aabcr7176c1zb', '07AAACH2702H1Z1'], bad: ['29ABCDE1234F1Z', 'ABCDE1234F1Z529', '29ABCDE1234F0Z5', '29ABCDE1234F1X5', '29-ABCDE1234F1Z'] },
  pincode: { ok: ['560001', '110011'], bad: ['060001', '56001', '5600011', 'ABCDEF'] },
  password: { ok: ['Demo@1234', 'abcdefg1', 'User@12345'], bad: ['short1', 'abcdefgh', '12345678', 'a1'] },
  companyCode: { ok: ['TGT', 'ab12', 'ACME2026'], bad: ['A', 'THIS-IS', 'ABCDEFGHIJKLMNOPQ'] },
  invoicePrefix: { ok: ['T', 'tgt', 'INV2026'], bad: ['INV-', 'ABCDEFGHIJKLMNOPQ'] },
  ipv4: { ok: ['103.24.120.46', '0.0.0.0', '255.255.255.255'], bad: ['256.1.1.1', '1.2.3', '103.24.120.45/30', 'abc'] },
  ipv4Cidr: { ok: ['103.24.120.45/30', '10.0.0.1', '10.0.0.0/8'], bad: ['10.0.0.1/33', '10.0.0/24', 'abc'] },
  url: { ok: ['https://maps.app.goo.gl/x', 'http://a.b/c?q=1'], bad: ['maps.google.com', 'ftp://x', 'https://a b'] },
  name: { ok: ['Al', 'Field Engineer'], bad: ['A', ' ', 'x'.repeat(129)] }
};

const NUMBER_CASES = {
  money: { ok: ['0', '1500.50', 42], bad: ['-1', 'abc', 1e13] },
  positiveMoney: { ok: ['0.01', 100], bad: ['0', '-5', 'x'] },
  pct: { ok: ['0', '55.5', 100], bad: ['-0.1', '100.1'] }
};

let Y;
test.before(async () => { ({ R: Y } = await import(FRONT)); });

const joiOk = (schema, v) => !schema.validate(v).error;
const yupOk = (schema, v) => schema.isValid(v);

for (const [rule, { ok, bad }] of Object.entries(CASES)) {
  test(`parity: ${rule}`, async () => {
    for (const v of ok) {
      assert.equal(joiOk(J[rule](), v), true, `Joi should accept ${rule} "${v}"`);
      assert.equal(await yupOk(Y[rule](), v), true, `Yup should accept ${rule} "${v}"`);
    }
    for (const v of bad) {
      assert.equal(joiOk(J[rule](), v), false, `Joi should reject ${rule} "${v}"`);
      assert.equal(await yupOk(Y[rule]().required(), v), false, `Yup should reject ${rule} "${v}"`);
    }
  });
}

for (const [rule, { ok, bad }] of Object.entries(NUMBER_CASES)) {
  test(`parity: ${rule}`, async () => {
    for (const v of ok) {
      assert.equal(joiOk(J[rule](), v), true, `Joi should accept ${rule} ${v}`);
      assert.equal(await yupOk(Y[rule](), v), true, `Yup should accept ${rule} ${v}`);
    }
    for (const v of bad) {
      assert.equal(joiOk(J[rule](), v), false, `Joi should reject ${rule} ${v}`);
      assert.equal(await yupOk(Y[rule]().required(), v), false, `Yup should reject ${rule} ${v}`);
    }
  });
}

test('parity: dates cannot be in the future (business day, India time)', async () => {
  const t = today();
  const tomorrow = addDays(t, 1);
  assert.equal(joiOk(J.pastDate(), t), true);
  assert.equal(await yupOk(Y.pastDate(), t), true);
  assert.equal(joiOk(J.pastDate(), tomorrow), false);
  assert.equal(await yupOk(Y.pastDate(), tomorrow), false);
});

test('parity: whole numbers and limits', async () => {
  for (const [v, expected] of [['5', true], ['0', true], ['5.5', false], ['-1', false], ['366', false]]) {
    assert.equal(joiOk(J.int(0, 365), v), expected, `Joi int ${v}`);
    assert.equal(await yupOk(Y.int(0, 365).required(), v), expected, `Yup int ${v}`);
  }
});
