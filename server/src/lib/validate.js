'use strict';
const { z } = require('zod');
const { bad } = require('./errors');

/** Parse with zod; the first problem becomes a 422 with a readable message. */
function parse(schema, data) {
  const res = schema.safeParse(data === undefined ? {} : data);
  if (res.success) return res.data;
  const issue = res.error.issues[0];
  const field = issue.path.length ? String(issue.path[issue.path.length - 1]) : '';
  const msg = issue.message && !/^Invalid input/i.test(issue.message) ? issue.message : field ? `Please check “${field}”.` : 'Please check the details and try again.';
  throw bad(msg);
}

const text = (max, label = 'This field') => z.string({ error: `${label} is required.` }).trim().min(1, `${label} is required.`).max(max, `${label} is too long.`);
/** Text that may be empty. Add .default('') where a missing value should become empty (never inside a .partial() edit schema). */
const optText = (max) => z.string().trim().max(max, 'That text is too long.');
const money = z.number({ error: 'Enter a number.' }).positive('Enter an amount above zero.').max(10_000_000, 'That amount is too large.');
const qty = z.number({ error: 'Enter a whole number.' }).int('Enter a whole number.').min(1, 'Enter at least 1.').max(1_000_000, 'That quantity is too large.');
const id = z.coerce.number().int().positive();
const email = z.string().trim().toLowerCase().max(190).pipe(z.email('Enter a valid email address.'));
const password = (min) => z.string({ error: 'Enter a password.' }).min(min, `Use at least ${min} characters.`).max(200, 'That password is too long.');

module.exports = { z, parse, text, optText, money, qty, id, email, password };
