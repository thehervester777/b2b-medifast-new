'use strict';
const { at } = require('../lib/time');

/**
 * Who is acting, for the audit log. Built once per request (see http/context.js).
 * actorType: 'admin' | 'supplier' | 'system'
 */
const systemCtx = { actorType: 'system', actorId: null, actorName: 'System', ip: null, device: null };

/** Add one audit line. Always called with the same connection as the change, so both succeed or neither does. */
async function audit(c, ctx, { type, text, ref = null, when = new Date() }) {
  await c.run('INSERT INTO audit_log (type, actor_type, actor_id, actor_name, text, ref_kind, ref_id, ip, device, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [
    type,
    ctx.actorType,
    ctx.actorId,
    String(ctx.actorName || '').slice(0, 120),
    String(text).slice(0, 400),
    ref ? ref.kind : null,
    ref ? String(ref.id) : null,
    ctx.ip ? String(ctx.ip).slice(0, 64) : null,
    ctx.device ? String(ctx.device).slice(0, 120) : null,
    when,
  ]);
}

/** Tells polling screens that something changed. */
async function bump(c) {
  await c.run("UPDATE meta SET v = v + 1 WHERE k = 'data_version'");
}

async function version(db) {
  const row = await db.one("SELECT v FROM meta WHERE k = 'data_version'");
  return row ? Number(row.v) : 0;
}

/** Message for a supplier. Returns the new row id (needed if the change is undone). */
async function notify(c, supplierId, { icon = 'bolt', title, body = '' }) {
  const res = await c.run('INSERT INTO notifications (supplier_id, icon, title, body, created_at) VALUES (?, ?, ?, ?, ?)', [supplierId, icon, title.slice(0, 120), body.slice(0, 400), new Date()]);
  return res.insertId;
}

module.exports = { audit, bump, version, notify, systemCtx, at };
