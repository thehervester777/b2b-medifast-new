'use strict';
const express = require('express');
const { parse, z, email, password } = require('../lib/validate');
const { HttpError, bad } = require('../lib/errors');
const { requireAdmin, clientCtx } = require('../http/middleware');
const { audit, bump } = require('../rules/audit');
const { sha256 } = require('../lib/security');

function adminAuth({ db, sessions, hasher, guard }) {
  const r = express.Router();
  const open = requireAdmin({ db, sessions }, { allowMustChange: true });

  const meOf = (a) => ({ id: a.id, name: a.name, email: a.email, role: a.role, perms: [...a.perms], mustChange: a.mustChange });

  r.post('/login', async (req, res) => {
    const body = parse(z.object({ email: z.string().trim().toLowerCase().max(190), password: z.string().max(200) }), req.body);
    const { ip, device } = clientCtx(req);
    await guard.assertOpen('admin', body.email, ip);
    const a = body.email ? await db.one('SELECT a.*, r.name AS role_name FROM admins a JOIN roles r ON r.id = a.role_id WHERE a.email = ?', [body.email]) : null;
    const ok = await hasher.check(body.password, a && a.password_hash);
    if (!ok) {
      await guard.fail('admin', body.email, ip);
      await audit(db, { actorType: 'system', actorId: null, actorName: 'Unknown user', ip, device }, { type: 'auth', text: `failed to sign in as ${body.email || 'an empty email'}` });
      throw new HttpError(401, 'bad_login', 'The email or password is not right.');
    }
    const ctx = { actorType: 'admin', actorId: a.id, actorName: a.name, ip, device };
    if (!a.active) {
      await audit(db, ctx, { type: 'auth', text: 'was blocked from signing in (account suspended)' });
      throw new HttpError(403, 'suspended', 'This account has been suspended. Ask the owner to switch it back on.');
    }
    await guard.clear('admin', body.email);
    await sessions.create(res, 'admin', a.id, { ip, ua: req.get('user-agent') });
    await db.run('UPDATE admins SET last_seen_at = ?, last_ip = ?, last_device = ? WHERE id = ?', [new Date(), ip, device, a.id]);
    await audit(db, ctx, { type: 'auth', text: 'signed in' });
    res.json({ ok: true, mustChange: !!a.must_change_password });
  });

  r.post('/logout', open, async (req, res) => {
    await audit(db, req.ctx, { type: 'auth', text: 'signed out' });
    await sessions.destroyCurrent(req, res, 'admin');
    res.json({ ok: true });
  });

  r.get('/me', open, (req, res) => res.json({ me: meOf(req.admin) }));

  /* The same, but "nobody is signed in" is a normal answer (200, me: null), so opening the panel does not log an error. */
  r.get('/session', (req, res, next) =>
    open(req, res, (err) => {
      if (!err) return res.json({ me: meOf(req.admin) });
      if (err.status === 401) return res.json({ me: null });
      next(err);
    })
  );

  r.post('/password', open, async (req, res) => {
    const body = parse(z.object({ current: z.string().max(200), next: password(10) }), req.body);
    const a = await db.one('SELECT password_hash FROM admins WHERE id = ?', [req.admin.id]);
    if (!(await hasher.check(body.current, a.password_hash))) throw bad('Your current password is not right.', 'bad_password');
    if (body.current === body.next) throw bad('Choose a password that is different from the current one.');
    const hash = await hasher.hash(body.next);
    await db.tx(async (c) => {
      await c.run('UPDATE admins SET password_hash = ?, must_change_password = 0 WHERE id = ?', [hash, req.admin.id]);
      await sessions.destroyAll(c, 'admin', req.admin.id, req.admin.sessionHash);
      await audit(c, req.ctx, { type: 'auth', text: 'changed their password' });
      await bump(c);
    });
    res.json({ ok: true });
  });

  return r;
}
module.exports = { adminAuth, sha256 };
