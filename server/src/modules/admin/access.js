'use strict';
const express = require('express');
const { parse, z, text, email } = require('../../lib/validate');
const { conflict, notFound, bad, forbidden } = require('../../lib/errors');
const { need } = require('../../http/middleware');
const { audit, bump } = require('../../rules/audit');
const { tempPassword } = require('../../lib/security');
const { ALL_PERMS, PERM_LABEL } = require('../../rules/perms');
const { done } = require('./helpers');

const idParam = z.coerce.number().int().positive();

function access({ db, hasher, sessions }) {
  const r = express.Router();
  const gate = need('access.manage');

  const roleId = async (c, name) => {
    const row = await c.one('SELECT id FROM roles WHERE name = ?', [name]);
    if (!row) throw bad('That role does not exist.');
    return row.id;
  };
  const activeOwners = async (c, exceptId) => Number((await c.one("SELECT COUNT(*) AS n FROM admins a JOIN roles r ON r.id = a.role_id WHERE r.name = 'Owner' AND a.active = 1 AND a.id <> ?", [exceptId])).n);

  /* A new admin gets a temporary password, shown once. They must choose their own at the first sign-in. */
  r.post('/team', gate, async (req, res) => {
    const b = parse(z.object({ name: text(80, 'Name'), email, role: z.string().max(40) }), req.body);
    const pw = tempPassword();
    const hash = await hasher.hash(pw);
    const id = await db.tx(async (c) => {
      const rid = await roleId(c, b.role);
      if (await c.one('SELECT id FROM admins WHERE email = ?', [b.email])) throw conflict('An admin with this email already exists.', 'email_taken');
      const ins = await c.run('INSERT INTO admins (name, email, password_hash, role_id, active, must_change_password, created_at) VALUES (?, ?, ?, ?, 1, 1, ?)', [b.name, b.email, hash, rid, new Date()]);
      await audit(c, req.ctx, { type: 'access', text: `invited ${b.name} as ${b.role}` });
      await bump(c);
      return ins.insertId;
    });
    await done(db, res, { id, password: pw });
  });

  r.patch('/team/:id', gate, async (req, res) => {
    const id = parse(idParam, req.params.id);
    const b = parse(z.object({ role: z.string().max(40).optional(), active: z.boolean().optional() }), req.body);
    await db.tx(async (c) => {
      const t = await c.one('SELECT a.*, r.name AS role_name FROM admins a JOIN roles r ON r.id = a.role_id WHERE a.id = ? FOR UPDATE', [id]);
      if (!t) throw notFound('That admin no longer exists.');
      if (b.role !== undefined && b.role !== t.role_name) {
        if (t.id === req.admin.id) throw forbidden('You cannot change your own role.');
        if (t.role_name === 'Owner' && t.active && (await activeOwners(c, t.id)) < 1) throw conflict('There must always be one active Owner.', 'last_owner');
        await c.run('UPDATE admins SET role_id = ? WHERE id = ?', [await roleId(c, b.role), id]);
        await audit(c, req.ctx, { type: 'access', text: `made ${t.name} a ${b.role}` });
      }
      if (b.active !== undefined && !!t.active !== b.active) {
        if (t.id === req.admin.id) throw forbidden('You cannot switch off your own account.');
        if (!b.active && t.role_name === 'Owner' && (await activeOwners(c, t.id)) < 1) throw conflict('There must always be one active Owner.', 'last_owner');
        await c.run('UPDATE admins SET active = ? WHERE id = ?', [b.active ? 1 : 0, id]);
        if (!b.active) await sessions.destroyAll(c, 'admin', id);
        await audit(c, req.ctx, { type: 'access', text: `${b.active ? 'reactivated' : 'suspended'} the account of ${t.name}` });
      }
      await bump(c);
    });
    await done(db, res);
  });

  r.delete('/team/:id', gate, async (req, res) => {
    const id = parse(idParam, req.params.id);
    await db.tx(async (c) => {
      const t = await c.one('SELECT a.*, r.name AS role_name FROM admins a JOIN roles r ON r.id = a.role_id WHERE a.id = ? FOR UPDATE', [id]);
      if (!t) throw notFound('That admin no longer exists.');
      if (t.id === req.admin.id) throw forbidden('You cannot remove your own account.');
      if (t.role_name === 'Owner' && t.active && (await activeOwners(c, t.id)) < 1) throw conflict('There must always be one active Owner.', 'last_owner');
      await sessions.destroyAll(c, 'admin', id);
      await c.run('DELETE FROM admins WHERE id = ?', [id]);
      await audit(c, req.ctx, { type: 'access', text: `removed ${t.name} from the admin team` });
      await bump(c);
    });
    await done(db, res);
  });

  r.post('/team/:id/reset-password', gate, async (req, res) => {
    const id = parse(idParam, req.params.id);
    const pw = tempPassword();
    const hash = await hasher.hash(pw);
    await db.tx(async (c) => {
      const t = await c.one('SELECT * FROM admins WHERE id = ? FOR UPDATE', [id]);
      if (!t) throw notFound('That admin no longer exists.');
      await c.run('UPDATE admins SET password_hash = ?, must_change_password = 1 WHERE id = ?', [hash, id]);
      await sessions.destroyAll(c, 'admin', id);
      await audit(c, req.ctx, { type: 'access', text: `set a temporary password for ${t.name}` });
      await bump(c);
    });
    await done(db, res, { password: pw });
  });

  /* Give a role one permission, or take it away. The Owner role always keeps everything. */
  r.patch('/roles/:name', gate, async (req, res) => {
    const name = parse(z.string().max(40), req.params.name);
    const b = parse(z.object({ key: z.enum(ALL_PERMS), on: z.boolean() }), req.body);
    if (name === 'Owner') throw forbidden('The Owner role always has every permission.');
    await db.tx(async (c) => {
      const role = await c.one('SELECT * FROM roles WHERE name = ? FOR UPDATE', [name]);
      if (!role) throw notFound('That role does not exist.');
      const list = JSON.parse(role.permissions);
      const has = list.includes(b.key);
      if (has === b.on) throw conflict('Already set.', 'already');
      const next = b.on ? [...list, b.key] : list.filter((k) => k !== b.key);
      await c.run('UPDATE roles SET permissions = ? WHERE id = ?', [JSON.stringify(next), role.id]);
      await audit(c, req.ctx, { type: 'access', text: `${b.on ? 'gave' : 'removed'} ${name} access to "${PERM_LABEL[b.key]}"` });
      await bump(c);
    });
    await done(db, res);
  });

  return r;
}
module.exports = { access };
