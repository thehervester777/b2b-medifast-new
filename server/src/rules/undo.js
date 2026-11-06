'use strict';
const crypto = require('node:crypto');
const { ms, MIN } = require('../lib/time');
const { conflict, notFound, forbidden } = require('../lib/errors');
const { audit, bump } = require('./audit');

/*
 * Undo for admin actions. Before an action changes rows, the recorder keeps a copy of them;
 * rows the action creates are listed so undo can delete them. The copy is saved with a random
 * token and expires after one minute. Undo refuses if any touched row was changed again in the
 * meantime (by this admin or another), because putting the old copy back would erase that change.
 * Undo never deletes audit lines: it adds one more that says what was undone.
 */
const TABLES = new Set(['requests', 'quotes', 'orders', 'order_history', 'notifications', 'products', 'suppliers']);
const HAS_UPDATED = new Set(['requests', 'quotes', 'orders', 'products', 'suppliers']);
const TTL = MIN;
const ISO = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z$/;

const check = (t) => {
  if (!TABLES.has(t)) throw new Error('undo: unknown table ' + t);
  return t;
};

class UndoRecorder {
  constructor(c) {
    this.c = c;
    this.restore = [];
    this.remove = [];
    this.touched = [];
  }

  /** Call BEFORE changing rows that already exist. */
  async snap(table, ids) {
    const list = [].concat(ids).filter((x) => x != null);
    if (!list.length) return;
    const rows = await this.c.all(`SELECT * FROM ${check(table)} WHERE id IN (?)`, [list]);
    this.restore.push({ table, rows });
    if (HAS_UPDATED.has(table)) this.touched.push({ table, ids: rows.map((r) => r.id) });
  }

  /** Call for rows the action INSERTS. */
  created(table, ids) {
    const list = [].concat(ids);
    this.remove.push({ table: check(table), ids: list });
    if (HAS_UPDATED.has(table)) this.touched.push({ table, ids: list });
  }

  /** Call AFTER the changes, inside the same transaction. */
  async save(adminId, label) {
    const guard = [];
    for (const t of this.touched) {
      if (!t.ids.length) continue;
      const rows = await this.c.all(`SELECT id, updated_at FROM ${t.table} WHERE id IN (?)`, [t.ids]);
      guard.push({ table: t.table, sig: Object.fromEntries(rows.map((r) => [r.id, ms(r.updated_at)])) });
    }
    const token = crypto.randomBytes(16).toString('hex');
    const expires = new Date(Date.now() + TTL);
    await this.c.run('DELETE FROM undo_log WHERE expires_at < ?', [new Date()]);
    await this.c.run('INSERT INTO undo_log (token, admin_id, label, payload, expires_at) VALUES (?, ?, ?, ?, ?)', [
      token,
      adminId,
      label.slice(0, 200),
      JSON.stringify({ restore: this.restore, remove: this.remove, guard }),
      expires,
    ]);
    return { token, expiresAt: expires.getTime() };
  }
}

const revive = (v) => (typeof v === 'string' && ISO.test(v) ? new Date(v) : v);

async function upsert(c, table, row) {
  const cols = Object.keys(row);
  const vals = cols.map((k) => revive(row[k]));
  const set = cols.filter((k) => k !== 'id').map((k) => `\`${k}\` = VALUES(\`${k}\`)`);
  await c.run(`INSERT INTO ${check(table)} (${cols.map((k) => `\`${k}\``).join(', ')}) VALUES (?) ON DUPLICATE KEY UPDATE ${set.join(', ')}`, [vals]);
}

/** Put a recorded change back. Throws a friendly 409 when it can no longer be done safely. */
async function applyUndo(db, ctx, token) {
  return db.tx(async (c) => {
    const row = await c.one('SELECT * FROM undo_log WHERE token = ? FOR UPDATE', [token]);
    if (!row) throw notFound('Undo is no longer available.');
    if (row.admin_id !== ctx.actorId) throw forbidden('Only the person who made the change can undo it.');
    if (ms(row.expires_at) < Date.now()) {
      await c.run('DELETE FROM undo_log WHERE token = ?', [token]);
      throw conflict('Undo is no longer available. It lasts one minute.', 'undo_expired');
    }
    const p = JSON.parse(row.payload);
    for (const g of p.guard) {
      const ids = Object.keys(g.sig).map(Number);
      if (!ids.length) continue; // rows the action deleted: nothing to compare
      const now = await c.all(`SELECT id, updated_at FROM ${check(g.table)} WHERE id IN (?) FOR UPDATE`, [ids]);
      const same = now.length === ids.length && now.every((r) => ms(r.updated_at) === g.sig[r.id]);
      if (!same) throw conflict('Something changed after that action, so it cannot be undone safely.', 'undo_conflict');
    }
    for (const r of p.remove) {
      if (r.ids.length) await c.run(`DELETE FROM ${check(r.table)} WHERE id IN (?)`, [r.ids]);
    }
    for (const r of p.restore) {
      for (const rowData of r.rows) await upsert(c, r.table, rowData);
    }
    await c.run('DELETE FROM undo_log WHERE token = ?', [token]);
    await audit(c, ctx, { type: 'undo', text: `undid: ${row.label}` });
    await bump(c);
    return { label: row.label };
  });
}

module.exports = { UndoRecorder, applyUndo };
