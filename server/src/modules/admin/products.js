'use strict';
const crypto = require('node:crypto');
const express = require('express');
const { parse, z, text, optText } = require('../../lib/validate');
const { conflict, notFound, bad } = require('../../lib/errors');
const { need } = require('../../http/middleware');
const { UndoRecorder } = require('../../rules/undo');
const { at } = require('../../lib/time');
const { finish, done, plural, reqCode } = require('./helpers');

const fields = {
  name: text(120, 'Product name'),
  generic: optText(120),
  brand: optText(80),
  stock: z.number().int().min(0).max(10_000_000),
  reorder: z.number().int().min(0).max(10_000_000),
  buy: z.number().min(0).max(10_000_000),
  sale: z.number().min(0).max(10_000_000),
  status: z.enum(['Active', 'Inactive']),
};
const idParam = z.coerce.number().int().positive();

const ymd = (d) => `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const newCode = () => `PROD-${ymd(new Date())}-${Array.from(crypto.randomBytes(6), (b) => LETTERS[b % LETTERS.length]).join('')}`;

function products({ db }) {
  const r = express.Router();

  r.post('/', need('products.manage'), async (req, res) => {
    const b = parse(z.object({ ...fields, generic: fields.generic.default(''), brand: fields.brand.default(''), stock: fields.stock.default(0), reorder: fields.reorder.default(5), buy: fields.buy.default(0), sale: fields.sale.default(0), status: fields.status.default('Active') }), req.body);
    const out = await db.tx(async (c) => {
      const undo = new UndoRecorder(c);
      let ins;
      for (let tries = 0; ; tries++) {
        try {
          ins = await c.run('INSERT INTO products (code, name, generic, brand, stock, reorder_level, buy_price, sale_price, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [newCode(), b.name, b.generic, b.brand, b.stock, b.reorder, b.buy, b.sale, b.status, new Date()]);
          break;
        } catch (e) {
          if (!(e && e.errno === 1062) || tries > 4) throw e;
        }
      }
      undo.created('products', [ins.insertId]);
      const info = await finish(c, req, undo, { type: 'product', text: `added product ${b.name}`, ref: { kind: 'product', id: ins.insertId } });
      return { id: ins.insertId, undo: info };
    });
    await done(db, res, out);
  });

  r.patch('/:id', need('products.manage'), async (req, res) => {
    const id = parse(idParam, req.params.id);
    const b = parse(z.object(fields).partial(), req.body);
    const map = { name: 'name', generic: 'generic', brand: 'brand', stock: 'stock', reorder: 'reorder_level', buy: 'buy_price', sale: 'sale_price', status: 'status' };
    const keys = Object.keys(b).filter((k) => map[k]);
    if (!keys.length) throw bad('Nothing was changed.', 'no_change');
    const out = await db.tx(async (c) => {
      const p0 = await c.one('SELECT * FROM products WHERE id = ? FOR UPDATE', [id]);
      if (!p0) throw notFound('That product no longer exists.');
      const undo = new UndoRecorder(c);
      await undo.snap('products', [id]);
      await c.run(`UPDATE products SET ${keys.map((k) => `${map[k]} = ?`).join(', ')} WHERE id = ?`, [...keys.map((k) => b[k]), id]);
      const info = await finish(c, req, undo, { type: 'product', text: `edited product ${b.name ?? p0.name}`, ref: { kind: 'product', id } });
      return { undo: info };
    });
    await done(db, res, out);
  });

  /* Post a request for each product so suppliers can quote. A product that already has an open request is not sent twice. */
  r.post('/send', need('products.send'), async (req, res) => {
    const b = parse(
      z.object({
        items: z.array(z.object({ id: idParam, qty: z.number().int().min(1).max(1_000_000), ask: z.number().positive().max(10_000_000) })).min(1).max(100),
        noEnd: z.boolean().optional().default(false),
        deadlineAt: z.number().int().positive().nullable().optional().default(null),
        note: optText(500).default(''),
      }),
      req.body
    );
    if (!b.noEnd && !(b.deadlineAt > Date.now())) throw bad('Pick an end date in the future, or choose “No end date”.');
    const out = await db.tx(async (c) => {
      const ids = b.items.map((i) => i.id);
      if (new Set(ids).size !== ids.length) throw bad('A product appears twice in the list.');
      const prods = await c.all('SELECT * FROM products WHERE id IN (?) FOR UPDATE', [ids]);
      if (prods.length !== ids.length) throw notFound('One of those products no longer exists.');
      const open = await c.all("SELECT product_id FROM requests WHERE product_id IN (?) AND status = 'Active'", [ids]);
      if (open.length) {
        const p = prods.find((x) => x.id === open[0].product_id);
        throw conflict(`${p.name} already has an open request.`, 'already_open');
      }
      const inactive = prods.find((p) => p.status !== 'Active');
      if (inactive) throw conflict(`${inactive.name} is inactive.`, 'inactive');

      const undo = new UndoRecorder(c);
      await undo.snap('products', ids);
      const now = new Date();
      const made = [];
      for (const it of b.items) {
        const p = prods.find((x) => x.id === it.id);
        const ins = await c.run('INSERT INTO requests (name, generic, company, qty, ask_price, status, no_end, deadline_at, posted_at, note, product_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [
          p.name,
          p.generic,
          p.brand,
          it.qty,
          it.ask,
          'Active',
          b.noEnd ? 1 : 0,
          b.noEnd ? null : at(b.deadlineAt),
          now,
          b.note || `Restock for ${p.name}.`,
          p.id,
        ]);
        made.push(ins.insertId);
      }
      await c.run('UPDATE products SET last_sent_at = ? WHERE id IN (?)', [now, ids]);
      undo.created('requests', made);
      const first = prods.find((p) => p.id === b.items[0].id);
      const info = await finish(c, req, undo, {
        type: 'product',
        text: made.length === 1 ? `sent ${first.name} to the supplier app, request ${reqCode(made[0])}` : `sent ${plural(made.length, 'product')} to the supplier app (${made.map(reqCode).join(', ')})`,
        ref: made.length === 1 ? { kind: 'request', id: made[0] } : null,
      });
      return { ids: made, undo: info };
    });
    await done(db, res, out);
  });

  return r;
}
module.exports = { products };
