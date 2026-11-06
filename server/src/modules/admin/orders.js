'use strict';
const express = require('express');
const { parse, z } = require('../../lib/validate');
const { conflict, notFound, bad } = require('../../lib/errors');
const { need } = require('../../http/middleware');
const { UndoRecorder } = require('../../rules/undo');
const { finish, done, plural, round2, orderCode } = require('./helpers');

const STATUSES = ['Pending', 'Approved', 'In transit', 'Delivered', 'Cancelled'];
const idList = z.array(z.coerce.number().int().positive()).min(1).max(500);

function orders({ db }) {
  const r = express.Router();

  /* Move one or many orders to a status. Delivered stamps the delivery time; leaving Delivered clears it. */
  r.post('/status', need('orders.manage'), async (req, res) => {
    const body = parse(z.object({ ids: idList, status: z.enum(STATUSES) }), req.body);
    const out = await db.tx(async (c) => {
      const rows = await c.all('SELECT * FROM orders WHERE id IN (?) FOR UPDATE', [body.ids]);
      if (!rows.length) throw notFound('Those orders no longer exist.');
      const todo = rows.filter((o) => o.status !== body.status);
      if (!todo.length) throw conflict(rows.length > 1 ? `Those orders are already ${body.status}.` : `Already ${body.status}.`, 'already');
      const undo = new UndoRecorder(c);
      await undo.snap('orders', todo.map((o) => o.id));
      const now = new Date();
      await c.run('UPDATE orders SET status = ?, delivered_at = ? WHERE id IN (?)', [body.status, body.status === 'Delivered' ? now : null, todo.map((o) => o.id)]);
      const made = [];
      for (const o of todo) made.push((await c.run('INSERT INTO order_history (order_id, status, at, by_name) VALUES (?, ?, ?, ?)', [o.id, body.status, now, req.admin.name])).insertId);
      undo.created('order_history', made);
      const info = await finish(c, req, undo, {
        type: 'order',
        text: todo.length === 1 ? `moved ${orderCode(todo[0].id)} to ${body.status}` : `moved ${plural(todo.length, 'order')} to ${body.status}`,
        ref: todo.length === 1 ? { kind: 'order', id: todo[0].id } : null,
      });
      return { changed: todo.length, undo: info };
    });
    await done(db, res, out);
  });

  /* Change boxes or price per box of an open order, or its note. Boxes and price are recorded in the order's history. */
  r.patch('/:id', need('orders.manage'), async (req, res) => {
    const id = parse(z.coerce.number().int().positive(), req.params.id);
    const body = parse(z.object({ qty: z.number().int().min(1).max(1_000_000).optional(), price: z.number().positive().max(10_000_000).optional(), note: z.string().trim().max(500).optional() }), req.body);
    const out = await db.tx(async (c) => {
      const o = await c.one('SELECT * FROM orders WHERE id = ? FOR UPDATE', [id]);
      if (!o) throw notFound('That order no longer exists.');
      const open = o.status !== 'Delivered' && o.status !== 'Cancelled';
      const nextQty = body.qty ?? o.qty;
      const nextPrice = body.price == null ? Number(o.price) : round2(body.price);
      const changedLine = nextQty !== o.qty || nextPrice !== Number(o.price);
      if (changedLine && !open) throw conflict('Delivered and cancelled orders cannot be edited.', 'closed');
      const nextNote = body.note ?? o.note;
      if (!changedLine && nextNote === o.note) throw bad('Nothing was changed.', 'no_change');

      const undo = new UndoRecorder(c);
      await undo.snap('orders', [id]);
      await c.run('UPDATE orders SET qty = ?, price = ?, note = ? WHERE id = ?', [nextQty, nextPrice, nextNote, id]);
      const parts = [];
      if (nextQty !== o.qty) parts.push(`boxes ${o.qty} to ${nextQty}`);
      if (nextPrice !== Number(o.price)) parts.push(`price per box ${round2(Number(o.price))} to ${nextPrice}`);
      if (parts.length) {
        const h = await c.run('INSERT INTO order_history (order_id, note, at, by_name) VALUES (?, ?, ?, ?)', [id, `Changed ${parts.join(' and ')}`, new Date(), req.admin.name]);
        undo.created('order_history', [h.insertId]);
      }
      const info = await finish(c, req, undo, {
        type: 'order',
        text: parts.length ? `edited ${orderCode(id)}: ${parts.join(', ')}` : `edited the note of ${orderCode(id)}`,
        ref: { kind: 'order', id },
      });
      return { undo: info };
    });
    await done(db, res, out);
  });

  /* Printing an invoice or warehouse paper leaves a line in the audit log, because invoices are records. */
  r.post('/printed', need('orders.documents'), async (req, res) => {
    const body = parse(z.object({ kind: z.enum(['invoice', 'list', 'warehouse']), ids: idList }), req.body);
    const rows = await db.all('SELECT id FROM orders WHERE id IN (?)', [body.ids]);
    if (!rows.length) throw notFound('Those orders no longer exist.');
    const n = rows.length;
    const text =
      body.kind === 'invoice' ? (n === 1 ? `printed invoice INV-${rows[0].id}` : `printed ${plural(n, 'invoice')}`) : body.kind === 'list' ? `printed an invoice list for ${plural(n, 'order')}` : `printed the warehouse paper for ${plural(n, 'order')}`;
    await db.tx((c) => finish(c, req, null, { type: 'order', text, ref: n === 1 ? { kind: 'order', id: rows[0].id } : null }));
    await done(db, res);
  });

  return r;
}
module.exports = { orders, STATUSES };
