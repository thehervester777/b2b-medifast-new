'use strict';
const express = require('express');
const { parse, z, text, email, password } = require('../../lib/validate');
const { HttpError, bad, conflict } = require('../../lib/errors');
const { clientCtx } = require('../../http/middleware');
const { audit, bump } = require('../../rules/audit');
const { loadSite, maintenanceLive } = require('../../rules/site');
const { requireSupplier } = require('./middleware');

const phone = z.string().trim().refine((v) => /^(\+?88)?01[3-9]\d{8}$/.test(v.replace(/[\s-]/g, '')), 'Use +8801XXXXXXXXX or 01XXXXXXXXX.');

function supplierAuth({ db, sessions, hasher, guard }) {
  const r = express.Router();

  const gateMaintenance = async () => {
    const site = await loadSite(db);
    if (maintenanceLive(site.maintenance)) throw new HttpError(503, 'maintenance', site.maintenance.message || 'We are updating the app. Please check back soon.');
  };

  r.post('/signup', async (req, res) => {
    await gateMaintenance();
    const b = parse(
      z.object({
        biz: text(120, 'Business name'),
        owner: text(80, 'Owner name'),
        addr: text(200, 'Address'),
        city: text(60, 'City'),
        lic: text(40, 'Drug licence number'),
        tin: text(40, 'TIN/BIN number'),
        email,
        phone,
        password: password(8),
      }),
      req.body
    );
    const { ip, device } = clientCtx(req);
    await guard.assertSignupRoom(ip);
    const hash = await hasher.hash(b.password);
    const code = await db.tx(async (c) => {
      if (await c.one('SELECT id FROM suppliers WHERE email = ?', [b.email])) throw conflict('An account with this email already exists. Try signing in.', 'email_taken');
      const ins = await c.run('INSERT INTO suppliers (name, owner_name, city, address, email, phone, password_hash, licence, tin, status, docs, joined_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [
        b.biz,
        b.owner,
        b.city,
        b.addr,
        b.email,
        b.phone.replace(/[\s-]/g, ''),
        hash,
        b.lic,
        b.tin,
        'Pending',
        JSON.stringify({ licence: false, tin: false, trade: false }),
        new Date(),
      ]);
      const code = `PR-${1000 + ins.insertId}`;
      await c.run('UPDATE suppliers SET code = ? WHERE id = ?', [code, ins.insertId]);
      await c.run('INSERT INTO login_attempts (kind, email, ip, at) VALUES (?, ?, ?, ?)', ['signup', b.email, ip || '', new Date()]);
      await audit(c, { actorType: 'supplier', actorId: ins.insertId, actorName: b.biz, ip, device }, { type: 'supplier', text: 'registered and is waiting for verification', ref: { kind: 'supplier', id: code } });
      await bump(c);
      return code;
    });
    res.json({ ok: true, id: code });
  });

  r.post('/login', async (req, res) => {
    await gateMaintenance();
    const b = parse(z.object({ email: z.string().trim().toLowerCase().max(190), password: z.string().max(200), keep: z.boolean().optional().default(false) }), req.body);
    const { ip } = clientCtx(req);
    await guard.assertOpen('supplier', b.email, ip);
    const s = b.email ? await db.one('SELECT * FROM suppliers WHERE email = ?', [b.email]) : null;
    const ok = await hasher.check(b.password, s && s.password_hash);
    if (!ok) {
      await guard.fail('supplier', b.email, ip);
      throw new HttpError(401, 'bad_login', 'The email or password is not right. Please check them and try again.');
    }
    if (s.status === 'Pending') throw new HttpError(403, 'pending', 'This provider account is still awaiting approval. You can sign in once it is verified.');
    if (s.status === 'Suspended') throw new HttpError(403, 'suspended', 'This account has been suspended. Please contact MediFast.');
    await guard.clear('supplier', b.email);
    await sessions.create(res, 'supplier', s.id, { remember: b.keep, ip, ua: req.get('user-agent') });
    await db.run('UPDATE suppliers SET last_login_at = ? WHERE id = ?', [new Date(), s.id]);
    res.json({ ok: true, mustChange: !!s.must_change_password });
  });

  r.post('/logout', async (req, res) => {
    await sessions.destroyCurrent(req, res, 'supplier');
    res.json({ ok: true });
  });

  /* Who is signed in? "Nobody" is a normal answer (200, me: null), so opening the app does not log an error. */
  const lenient = requireSupplier({ db, sessions }, { allowMaintenance: true, allowMustChange: true });
  r.get('/session', (req, res, next) =>
    lenient(req, res, (err) => {
      if (!err) {
        const s = req.supplier;
        return res.json({ me: { code: s.code, name: s.owner_name, biz: s.name, email: s.email, mustChange: !!s.must_change_password } });
      }
      if (err.status === 401 || err.code === 'not_active') return res.json({ me: null });
      next(err);
    })
  );

  r.post('/password', lenient, async (req, res) => {
    const b = parse(z.object({ current: z.string().max(200), next: password(8) }), req.body);
    if (!(await hasher.check(b.current, req.supplier.password_hash))) throw bad('Your current password is not right.', 'bad_password');
    if (b.current === b.next) throw bad('Choose a password that is different from the current one.');
    const hash = await hasher.hash(b.next);
    await db.tx(async (c) => {
      await c.run('UPDATE suppliers SET password_hash = ?, must_change_password = 0 WHERE id = ?', [hash, req.supplier.id]);
      await sessions.destroyAll(c, 'supplier', req.supplier.id, req.sessionHash);
    });
    res.json({ ok: true });
  });

  return r;
}
module.exports = { supplierAuth };
