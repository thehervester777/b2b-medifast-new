'use strict';
const express = require('express');
const { parse, z, text, optText, money, qty } = require('../../lib/validate');
const { conflict, notFound, bad } = require('../../lib/errors');
const { need } = require('../../http/middleware');
const { UndoRecorder } = require('../../rules/undo');
const { notify } = require('../../rules/audit');
const { at, DAY } = require('../../lib/time');
const { finish, done, reqCode } = require('./helpers');

const fields = {
  name: text(120, 'Medicine name'),
  generic: optText(120),
  co: optText(80),
  qty,
  ask: money,
  noEnd: z.boolean(),
  deadlineAt: z.number().int().positive().nullable(),
  note: optText(500),
};
const createSchema = z.object({
  ...fields,
  generic: fields.generic.default(''),
  co: fields.co.default(''),
  noEnd: fields.noEnd.default(false),
  deadlineAt: fields.deadlineAt.default(null),
  note: fields.note.default(''),
  productId: z.number().int().positive().nullable().optional().default(null),
});
const editSchema = z.object(fields).partial();
const idParam = z.coerce.number().int().positive();

function requests({ db }) {
  const r = express.Router();
  const gate = need('requests.manage');

  r.post('/', gate, async (req, res) => {
    const b = parse(createSchema, req.body);
    if (!b.noEnd && !(b.deadlineAt > Date.now())) throw bad('Pick an end date in the future, or choose “No end date”.');
    const out = await db.tx(async (c) => {
      if (b.productId && !(await c.one('SELECT id FROM products WHERE id = ?', [b.productId]))) throw bad('That product no longer exists.');
      const undo = new UndoRecorder(c);
      const ins = await c.run('INSERT INTO requests (name, generic, company, qty, ask_price, status, no_end, deadline_at, posted_at, note, product_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [
        b.name,
        b.generic,
        b.co,
        b.qty,
        b.ask,
        'Active',
        b.noEnd ? 1 : 0,
        b.noEnd ? null : at(b.deadlineAt),
        new Date(),
        b.note,
        b.productId,
      ]);
      undo.created('requests', [ins.insertId]);
      const info = await finish(c, req, undo, { type: 'request', text: `posted request ${reqCode(ins.insertId)}, ${b.name}`, ref: { kind: 'request', id: ins.insertId } });
      return { id: ins.insertId, undo: info };
    });
    await done(db, res, out);
  });

  r.patch('/:id', gate, async (req, res) => {
    const id = parse(idParam, req.params.id);
    const b = parse(editSchema, req.body);
    const out = await db.tx(async (c) => {
      const old = await c.one('SELECT * FROM requests WHERE id = ? FOR UPDATE', [id]);
      if (!old) throw notFound('That request no longer exists.');
      const sets = [];
      const vals = [];
      const put = (col, v) => {
        sets.push(`${col} = ?`);
        vals.push(v);
      };
      if (b.name !== undefined) put('name', b.name);
      if (b.generic !== undefined) put('generic', b.generic);
      if (b.co !== undefined) put('company', b.co);
      if (b.qty !== undefined) put('qty', b.qty);
      if (b.ask !== undefined) put('ask_price', b.ask);
      if (b.note !== undefined) put('note', b.note);
      if (b.noEnd !== undefined || b.deadlineAt !== undefined) {
        const noEnd = b.noEnd ?? !!old.no_end;
        const dl = b.deadlineAt !== undefined ? b.deadlineAt : old.deadline_at && old.deadline_at.getTime();
        if (!noEnd && !dl) throw bad('Pick an end date, or choose “No end date”.');
        put('no_end', noEnd ? 1 : 0);
        put('deadline_at', noEnd ? null : at(dl));
      }
      if (!sets.length) throw bad('Nothing was changed.', 'no_change');
      const undo = new UndoRecorder(c);
      await undo.snap('requests', [id]);
      await c.run(`UPDATE requests SET ${sets.join(', ')} WHERE id = ?`, [...vals, id]);
      const info = await finish(c, req, undo, { type: 'request', text: `edited request ${reqCode(id)}, ${b.name ?? old.name}`, ref: { kind: 'request', id } });
      return { id, undo: info };
    });
    await done(db, res, out);
  });

  /* Stop a request early. Quotes still waiting are turned down. */
  r.post('/:id/close', gate, async (req, res) => {
    const id = parse(idParam, req.params.id);
    const out = await db.tx(async (c) => {
      const r0 = await c.one('SELECT * FROM requests WHERE id = ? FOR UPDATE', [id]);
      if (!r0) throw notFound('That request no longer exists.');
      if (r0.status !== 'Active') throw conflict(`This request is already ${r0.status.toLowerCase()}.`, 'already');
      const open = await c.all("SELECT id, supplier_id FROM quotes WHERE request_id = ? AND status IN ('Pending','Approved') FOR UPDATE", [id]);
      const undo = new UndoRecorder(c);
      await undo.snap('requests', [id]);
      await undo.snap('quotes', open.map((q) => q.id));
      const now = new Date();
      await c.run("UPDATE requests SET status = 'Expired', no_end = 0, deadline_at = ? WHERE id = ?", [now, id]);
      const made = [];
      if (open.length) {
        await c.run("UPDATE quotes SET status = 'Rejected', decided_at = ?, decided_by = ?, reason = 'Request closed' WHERE id IN (?)", [now, req.admin.name, open.map((q) => q.id)]);
        for (const q of open) made.push(await notify(c, q.supplier_id, { icon: 'receipt', title: 'Request closed', body: `The request for ${r0.name} was closed before a quote was chosen.` }));
      }
      undo.created('notifications', made);
      const info = await finish(c, req, undo, { type: 'request', text: `closed request ${reqCode(id)}, ${r0.name}`, ref: { kind: 'request', id } });
      return { undo: info };
    });
    await done(db, res, out);
  });

  r.post('/:id/reopen', gate, async (req, res) => {
    const id = parse(idParam, req.params.id);
    const out = await db.tx(async (c) => {
      const r0 = await c.one('SELECT * FROM requests WHERE id = ? FOR UPDATE', [id]);
      if (!r0) throw notFound('That request no longer exists.');
      if (r0.status !== 'Expired') throw conflict('Only a closed request can be reopened.', 'not_expired');
      const undo = new UndoRecorder(c);
      await undo.snap('requests', [id]);
      await c.run("UPDATE requests SET status = 'Active', no_end = 0, deadline_at = ? WHERE id = ?", [new Date(Date.now() + 7 * DAY), id]);
      const info = await finish(c, req, undo, { type: 'request', text: `reopened request ${reqCode(id)}, ${r0.name}`, ref: { kind: 'request', id } });
      return { undo: info };
    });
    await done(db, res, out);
  });

  /* Deleting removes the request and its quotes. A request that has an order is a record and stays. */
  r.delete('/:id', gate, async (req, res) => {
    const id = parse(idParam, req.params.id);
    const out = await db.tx(async (c) => {
      const r0 = await c.one('SELECT * FROM requests WHERE id = ? FOR UPDATE', [id]);
      if (!r0) throw notFound('That request no longer exists.');
      if (await c.one('SELECT id FROM orders WHERE request_id = ? LIMIT 1', [id])) throw conflict('This request has an order, so it is kept as a record. Close it instead.', 'has_order');
      const qs = await c.all('SELECT id FROM quotes WHERE request_id = ? FOR UPDATE', [id]);
      const undo = new UndoRecorder(c);
      await undo.snap('requests', [id]);
      await undo.snap('quotes', qs.map((q) => q.id));
      await c.run('DELETE FROM requests WHERE id = ?', [id]);
      const info = await finish(c, req, undo, { type: 'request', text: `deleted request ${reqCode(id)}, ${r0.name}` });
      return { undo: info };
    });
    await done(db, res, out);
  });

  return r;
}
module.exports = { requests };
