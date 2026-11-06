'use strict';
const express = require('express');
const { parse, z, text, email, password } = require('../lib/validate');
const { HttpError, notFound } = require('../lib/errors');
const { audit, bump, version } = require('../rules/audit');
const { loadSite, noticeLive, maintenanceLive } = require('../rules/site');
const { clientCtx } = require('../http/middleware');

function publicRouter({ db, hasher, cfg }) {
  const r = express.Router();

  r.get('/health', async (req, res) => {
    try {
      await db.one('SELECT 1 AS ok');
      res.json({ ok: true, database: true, version: await version(db) });
    } catch (e) {
      res.status(503).json({ ok: false, database: false });
    }
  });

  /* What the supplier app may show before sign-in: the notice and whether maintenance is on. */
  r.get('/public/site', async (req, res) => {
    const s = await loadSite(db);
    const now = Date.now();
    const n = s.notice;
    const show = noticeLive(n, now) && (n.audience === 'suppliers' || n.audience === 'all');
    res.json({
      notice: show ? { tone: n.tone, title: n.title, body: n.body, dismissible: n.dismissible } : null,
      maintenance: maintenanceLive(s.maintenance, now) ? { message: s.maintenance.message } : null,
    });
  });

  /* First run: create the Owner account. Works only while there are no admins, then answers 404 forever. */
  r.get('/setup/status', async (req, res) => {
    const n = Number((await db.one('SELECT COUNT(*) AS n FROM admins')).n);
    res.json({ open: n === 0 });
  });

  r.post('/setup', async (req, res) => {
    const b = parse(z.object({ name: text(80, 'Your name'), email, password: password(10) }), req.body);
    const hash = await hasher.hash(b.password);
    const { ip, device } = clientCtx(req);
    await db.tx(async (c) => {
      await c.one("SELECT v FROM meta WHERE k = 'data_version' FOR UPDATE"); // one setup at a time
      if (Number((await c.one('SELECT COUNT(*) AS n FROM admins')).n) > 0) throw notFound('Setup is already done.');
      const role = await c.one("SELECT id FROM roles WHERE name = 'Owner'");
      if (!role) throw new HttpError(500, 'not_installed', 'The database is not set up yet. Import database/schema.sql first.');
      const ins = await c.run('INSERT INTO admins (name, email, password_hash, role_id, active, must_change_password, created_at) VALUES (?, ?, ?, ?, 1, 0, ?)', [b.name, b.email, hash, role.id, new Date()]);
      await audit(c, { actorType: 'admin', actorId: ins.insertId, actorName: b.name, ip, device }, { type: 'access', text: 'created the Owner account' });
      await bump(c);
    });
    res.json({ ok: true });
  });

  return r;
}
module.exports = { publicRouter };
