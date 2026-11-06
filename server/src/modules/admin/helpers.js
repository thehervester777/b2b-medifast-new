'use strict';
const { audit, bump, version } = require('../../rules/audit');

/** The end of every write: audit line + data version, both inside the caller's transaction, then the undo token. */
async function finish(c, req, undo, { type, text, ref = null }) {
  await audit(c, req.ctx, { type, text, ref });
  await bump(c);
  return undo ? undo.save(req.admin.id, text) : null;
}

/** Standard success answer. */
async function done(db, res, extra = {}) {
  res.json({ ok: true, version: await version(db), ...extra });
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const round2 = (n) => Math.round(n * 100) / 100;
const reqCode = (id) => 'RQ-' + id;
const quoteCode = (id) => 'QT-' + id;
const orderCode = (id) => 'ORD-' + id;

module.exports = { finish, done, plural, round2, reqCode, quoteCode, orderCode };
