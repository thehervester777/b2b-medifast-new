'use strict';
const express = require('express');
const { parse, z, qty: _q } = require('../../lib/validate');
const { conflict, bad } = require('../../lib/errors');
const { need } = require('../../http/middleware');
const { UndoRecorder } = require('../../rules/undo');
const { notify } = require('../../rules/audit');
const { loadSite } = require('../../rules/site');
const { DAY } = require('../../lib/time');
const { finish, done, plural, quoteCode, orderCode } = require('./helpers');

const ids = z.array(z.coerce.number().int().positive()).min(1).max(500);

function quotes({ db }) {
  const r = express.Router();

  /* Approve or reject one or many quotes. Approve: Pending only. Reject: Pending or Approved. */
  r.post('/decide', need('quotes.decide'), async (req, res) => {
    const body = parse(z.object({ ids, decision: z.enum(['approve', 'reject']), reason: z.string().trim().max(120).optional().default(''), note: z.string().trim().max(200).optional().default('') }), req.body);
    const out = await db.tx(async (c) => {
      const site = await loadSite(c);
      const rows = await c.all(
        `SELECT q.*, s.name AS supplier_name, r.name AS req_name FROM quotes q
           JOIN suppliers s ON s.id = q.supplier_id JOIN requests r ON r.id = q.request_id WHERE q.id IN (?) FOR UPDATE`,
        [body.ids]
      );
      const from = body.decision === 'approve' ? ['Pending'] : ['Pending', 'Approved'];
      const todo = rows.filter((q) => from.includes(q.status));
      if (!todo.length) throw conflict(rows.length === 1 ? `That quote is already ${rows[0].status.toLowerCase()}.` : 'Those quotes were already decided.', 'already_decided');
      if (body.decision === 'reject' && site.settings.requireReason && !body.reason) throw bad('Choose a reason for rejecting.');

      const undo = new UndoRecorder(c);
      await undo.snap('quotes', todo.map((q) => q.id));
      const now = new Date();
      const reason = body.decision === 'approve' ? '' : body.note ? `${body.reason || 'Other'}: ${body.note}` : body.reason || 'Other';
      await c.run('UPDATE quotes SET status = ?, decided_at = ?, decided_by = ?, reason = ? WHERE id IN (?)', [body.decision === 'approve' ? 'Approved' : 'Rejected', now, req.admin.name, reason, todo.map((q) => q.id)]);

      if (body.decision === 'reject') {
        const made = [];
        for (const q of todo) made.push(await notify(c, q.supplier_id, { icon: 'receipt', title: 'Quote not selected', body: `Your price for ${q.req_name} was not chosen this time.` }));
        undo.created('notifications', made);
      }
      const verb = body.decision === 'approve' ? 'approved' : 'rejected';
      const one = todo[0];
      const info = await finish(c, req, undo, {
        type: 'quote',
        text: todo.length === 1 ? `${verb} ${quoteCode(one.id)} from ${one.supplier_name}` : `${verb} ${plural(todo.length, 'quote')} in one go`,
        ref: todo.length === 1 ? { kind: 'quote', id: one.id } : null,
      });
      return { changed: todo.length, skipped: rows.length - todo.length, undo: info };
    });
    await done(db, res, out);
  });

  /*
   * Award quotes: each award completes its request, opens an order, and (by setting) turns down the other open quotes.
   * When several quotes for the same request are sent, only the cheapest is awarded.
   */
  r.post('/award', need('quotes.decide'), async (req, res) => {
    const body = parse(z.object({ ids }), req.body);
    const out = await db.tx(async (c) => {
      const site = await loadSite(c);
      const rows = await c.all(
        `SELECT q.*, s.name AS supplier_name, s.status AS supplier_status, r.name AS req_name, r.generic AS req_generic, r.company AS req_company,
                r.ask_price AS req_ask, r.status AS req_status
           FROM quotes q JOIN suppliers s ON s.id = q.supplier_id JOIN requests r ON r.id = q.request_id
          WHERE q.id IN (?) ORDER BY q.id FOR UPDATE`,
        [body.ids]
      );
      if (!rows.length) throw conflict('Those quotes no longer exist.', 'not_found');

      const best = new Map();
      let why = null;
      for (const q of rows) {
        if (q.req_status !== 'Active') why = why || 'That request is no longer open, so it cannot be awarded.';
        else if (!['Pending', 'Approved'].includes(q.status)) why = why || `That quote is already ${q.status.toLowerCase()}.`;
        else if (q.supplier_status === 'Suspended') why = why || `${q.supplier_name} is suspended, so the quote cannot be awarded.`;
        else {
          const cur = best.get(q.request_id);
          if (!cur || Number(q.price) < Number(cur.price)) best.set(q.request_id, q);
        }
      }
      const list = [...best.values()];
      if (!list.length) throw conflict(why || 'Nothing could be awarded.', 'cannot_award');

      const undo = new UndoRecorder(c);
      const now = new Date();
      const expected = new Date(now.getTime() + (site.settings.leadDays || 4) * DAY);
      const notes = [];
      const created = [];
      const orderIds = [];

      for (const q of list) {
        // Lock the request, then re-read everything on it, so two admins awarding at once cannot both win.
        const lock = await c.one('SELECT status FROM requests WHERE id = ? FOR UPDATE', [q.request_id]);
        if (lock.status !== 'Active') throw conflict('That request was just closed by someone else.', 'cannot_award');
        const others = await c.all("SELECT q.id, q.supplier_id, q.status FROM quotes q WHERE q.request_id = ? AND q.id <> ? AND q.status IN ('Pending','Approved') FOR UPDATE", [q.request_id, q.id]);
        await undo.snap('quotes', [q.id, ...others.map((o) => o.id)]);
        await undo.snap('requests', [q.request_id]);

        await c.run("UPDATE quotes SET status = 'Awarded', decided_at = ?, decided_by = ?, reason = '' WHERE id = ?", [now, req.admin.name, q.id]);
        await c.run("UPDATE requests SET status = 'Completed', no_end = 0, deadline_at = ? WHERE id = ?", [now, q.request_id]);
        if (site.settings.rejectOthersOnAward && others.length) {
          await c.run("UPDATE quotes SET status = 'Rejected', decided_at = ?, decided_by = ?, reason = 'Another quote was awarded' WHERE id IN (?)", [now, req.admin.name, others.map((o) => o.id)]);
          for (const o of others) notes.push(await notify(c, o.supplier_id, { icon: 'receipt', title: 'Quote not selected', body: `Your price for ${q.req_name} was not chosen this time.` }));
        }
        const ins = await c.run(
          'INSERT INTO orders (quote_id, request_id, supplier_id, name, generic, company, qty, price, ask_price, status, expected_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [q.id, q.request_id, q.supplier_id, q.req_name, q.req_generic, q.req_company, q.qty, q.price, q.req_ask, 'Pending', expected, now]
        );
        const hist = await c.run('INSERT INTO order_history (order_id, status, at, by_name) VALUES (?, ?, ?, ?)', [ins.insertId, 'Pending', now, req.admin.name]);
        created.push(hist.insertId);
        undo.created('orders', [ins.insertId]);
        orderIds.push({ quoteId: q.id, orderId: ins.insertId });
        notes.push(await notify(c, q.supplier_id, { icon: 'shield', title: 'Quote won', body: `Your price for ${q.req_name} was selected. We will contact you about delivery.` }));
      }
      undo.created('order_history', created);
      undo.created('notifications', notes);

      const first = list[0];
      const info = await finish(c, req, undo, {
        type: 'quote',
        text:
          list.length === 1
            ? `awarded ${quoteCode(first.id)} to ${first.supplier_name}, order ${orderCode(orderIds[0].orderId)} created`
            : `awarded ${plural(list.length, 'quote')} and created ${plural(list.length, 'order')} (${orderIds.map((o) => orderCode(o.orderId)).join(', ')})`,
        ref: list.length === 1 ? { kind: 'quote', id: first.id } : null,
      });
      return { awarded: orderIds, skipped: rows.length - list.length, undo: info };
    });
    await done(db, res, out);
  });

  return r;
}
module.exports = { quotes };
