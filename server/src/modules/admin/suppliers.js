'use strict';
const express = require('express');
const { parse, z } = require('../../lib/validate');
const { conflict, notFound, bad } = require('../../lib/errors');
const { need } = require('../../http/middleware');
const { UndoRecorder } = require('../../rules/undo');
const { notify, audit, bump } = require('../../rules/audit');
const { tempPassword } = require('../../lib/security');
const { finish, done } = require('./helpers');

function suppliers({ db, hasher, sessions }) {
  const r = express.Router();
  const gate = need('suppliers.manage');
  const find = (c, code) => c.one('SELECT * FROM suppliers WHERE code = ? FOR UPDATE', [code]);

  r.patch('/:code', gate, async (req, res) => {
    const code = parse(z.string().max(16), req.params.code);
    const b = parse(z.object({ status: z.enum(['Verified', 'Suspended']) }), req.body);
    const out = await db.tx(async (c) => {
      const s0 = await find(c, code);
      if (!s0) throw notFound('That supplier no longer exists.');
      if (s0.status === b.status) throw conflict(`${s0.name} is already ${b.status.toLowerCase()}.`, 'already');
      const verb = b.status === 'Verified' ? (s0.status === 'Suspended' ? 'reinstated' : 'verified') : 'suspended';
      const undo = new UndoRecorder(c);
      await undo.snap('suppliers', [s0.id]);
      if (b.status === 'Verified') await c.run("UPDATE suppliers SET status = 'Verified', note = '', docs = ? WHERE id = ?", [JSON.stringify({ licence: true, tin: true, trade: true }), s0.id]);
      else await c.run("UPDATE suppliers SET status = 'Suspended', note = CASE WHEN note = '' THEN 'Suspended by an admin.' ELSE note END WHERE id = ?", [s0.id]);
      if (b.status === 'Suspended') await sessions.destroyAll(c, 'supplier', s0.id);
      const made = [];
      if (b.status === 'Verified') made.push(await notify(c, s0.id, { icon: 'shield', title: 'Account verified', body: 'Your drug licence and TIN/BIN were checked. You can quote on every request.' }));
      undo.created('notifications', made);
      const info = await finish(c, req, undo, { type: 'supplier', text: `${verb} ${s0.name}`, ref: { kind: 'supplier', id: s0.code } });
      return { undo: info };
    });
    await done(db, res, out);
  });

  /* A forgotten password: set a temporary one and hand it over once. The supplier must change it at the next sign-in. */
  r.post('/:code/reset-password', gate, async (req, res) => {
    const code = parse(z.string().max(16), req.params.code);
    const pw = tempPassword();
    const hash = await hasher.hash(pw);
    await db.tx(async (c) => {
      const s0 = await find(c, code);
      if (!s0) throw notFound('That supplier no longer exists.');
      await c.run('UPDATE suppliers SET password_hash = ?, must_change_password = 1 WHERE id = ?', [hash, s0.id]);
      await sessions.destroyAll(c, 'supplier', s0.id);
      await audit(c, req.ctx, { type: 'supplier', text: `set a temporary password for ${s0.name}`, ref: { kind: 'supplier', id: s0.code } });
      await bump(c);
    });
    await done(db, res, { password: pw });
  });

  return r;
}
module.exports = { suppliers, bad };
