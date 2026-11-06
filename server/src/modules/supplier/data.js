'use strict';
const express = require('express');
const { parse, z, text, qty, id } = require('../../lib/validate');
const { HttpError, conflict, notFound, bad } = require('../../lib/errors');
const { audit, bump, version } = require('../../rules/audit');
const { loadSite, noticeLive, maintenanceLive } = require('../../rules/site');
const { expireRequests } = require('../../rules/sweep');
const { ms, DAY } = require('../../lib/time');
const { num } = require('../shape');
const { requireSupplier } = require('./middleware');

const STATUS = { Pending: 'PENDING', Approved: 'PENDING', Awarded: 'WON', Rejected: 'REJECTED' };
const money2 = z.number({ error: 'Enter a price.' }).positive('Enter a price above zero.').max(10_000_000).refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6, 'Use at most two decimals.');
const cleanDate = z.string().trim().max(10).regex(/^(\d{4}-\d\d-\d\d)?$/, 'Pick a valid date.').optional().default('');

const subCode = (id) => 'CT-' + id;

/** A request as the supplier sees it: no other supplier's name or price, only a bid count. */
const requestOf = (r, bids, now) => {
  const closed = r.status === 'Active' && !r.no_end && r.deadline_at && r.deadline_at.getTime() <= now;
  return {
    id: r.id,
    name: r.name,
    generic: r.generic,
    co: r.company,
    qty: r.qty,
    ask: num(r.ask_price),
    status: closed ? 'Expired' : r.status,
    noEnd: !!r.no_end,
    deadlineAt: ms(r.deadline_at),
    postedAt: ms(r.posted_at),
    note: r.note,
    bids: bids.get(r.id) || 0,
  };
};

const quoteOf = (q, rank) => ({
  id: q.id,
  req: q.request_id,
  med: q.req_name,
  price: num(q.price),
  qty: q.qty,
  status: STATUS[q.status],
  at: ms(q.submitted_at),
  rank,
  live: true,
  delivery: q.delivery,
  note: q.supplier_note,
  batch: q.submission_id ? subCode(q.submission_id) : null,
});

async function loadMine(c, supplierId) {
  const rows = await c.all(
    `SELECT q.*, r.name AS req_name, r.generic AS req_generic, r.company AS req_company,
            (SELECT COUNT(*) FROM quotes o WHERE o.request_id = q.request_id AND o.price < q.price) + 1 AS rnk
       FROM quotes q JOIN requests r ON r.id = q.request_id
      WHERE q.supplier_id = ? ORDER BY q.submitted_at DESC, q.id DESC`,
    [supplierId]
  );
  return rows;
}

function batchesOf(rows) {
  const by = new Map();
  rows.forEach((q) => {
    if (!q.submission_id) return;
    if (!by.has(q.submission_id)) by.set(q.submission_id, { id: subCode(q.submission_id), at: ms(q.submitted_at), items: [], qty: 0, total: 0 });
    const b = by.get(q.submission_id);
    const total = Math.round(num(q.price) * q.qty * 100) / 100;
    b.items.push({ req: q.request_id, name: q.req_name, generic: q.req_generic, co: q.req_company, qty: q.qty, price: num(q.price), total });
    b.qty += q.qty;
    b.total = Math.round((b.total + total) * 100) / 100;
    b.at = Math.min(b.at, ms(q.submitted_at));
  });
  return [...by.values()].sort((a, b) => b.at - a.at);
}

/** Put one quote in, inside the caller's transaction. Returns the new/updated quote id, or throws a friendly error. */
async function placeQuote(c, supplier, item, submissionId, now) {
  const r = await c.one('SELECT * FROM requests WHERE id = ? FOR UPDATE', [item.reqId]);
  if (!r) throw notFound('This request no longer exists.');
  const closed = r.status !== 'Active' || (!r.no_end && r.deadline_at && r.deadline_at.getTime() <= now.getTime());
  if (closed) throw conflict('This request is closed. New prices are no longer accepted.', 'closed');
  if (item.qty > r.qty) throw bad(`You can offer at most ${r.qty} boxes.`);
  if (item.price > Number(r.ask_price)) throw bad('Your price cannot be above the asking price.');
  const mine = await c.one('SELECT * FROM quotes WHERE request_id = ? AND supplier_id = ? FOR UPDATE', [r.id, supplier.id]);
  if (mine && mine.status !== 'Pending') throw conflict('You already have a decided quote on this request.', 'already_quoted');
  if (mine) {
    await c.run('UPDATE quotes SET qty = ?, price = ?, submission_id = ?, submitted_at = ?, delivery = ?, supplier_note = ? WHERE id = ?', [item.qty, item.price, submissionId, now, item.delivery || '', item.note || '', mine.id]);
    return { id: mine.id, name: r.name, replaced: true };
  }
  const ins = await c.run('INSERT INTO quotes (request_id, supplier_id, submission_id, qty, price, status, submitted_at, delivery, supplier_note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [r.id, supplier.id, submissionId, item.qty, item.price, 'Pending', now, item.delivery || '', item.note || '']);
  return { id: ins.insertId, name: r.name, replaced: false };
}

function supplierData({ db, sessions }) {
  const r = express.Router();
  r.use(requireSupplier({ db, sessions }, { allowMaintenance: true }));

  r.get('/version', async (req, res) => {
    const site = await loadSite(db);
    res.json({ version: await version(db), maintenance: maintenanceLive(site.maintenance) });
  });

  const gate = async (req, res, next) => {
    const site = await loadSite(db);
    if (maintenanceLive(site.maintenance)) return next(new HttpError(503, 'maintenance', site.maintenance.message || 'We are updating the app. Please check back soon.'));
    next();
  };

  /* Everything the app shows, in one call. */
  r.get('/bootstrap', async (req, res) => {
    await expireRequests(db);
    const s = req.supplier;
    const now = Date.now();
    const [reqs, mine, notes, site, ver] = await Promise.all([
      db.all("SELECT * FROM requests WHERE status = 'Active' OR posted_at > ? ORDER BY posted_at DESC, id DESC LIMIT 400", [new Date(now - 90 * DAY)]),
      loadMine(db, s.id),
      db.all('SELECT * FROM notifications WHERE supplier_id = ? ORDER BY created_at DESC, id DESC LIMIT 60', [s.id]),
      loadSite(db),
      version(db),
    ]);
    const bids = new Map();
    if (reqs.length) (await db.all('SELECT request_id, COUNT(*) AS n FROM quotes WHERE request_id IN (?) GROUP BY request_id', [reqs.map((x) => x.id)])).forEach((x) => bids.set(x.request_id, Number(x.n)));
    const showNotice = noticeLive(site.notice, now) && (site.notice.audience === 'suppliers' || site.notice.audience === 'all');
    res.json({
      version: ver,
      user: { code: s.code, name: s.owner_name, biz: s.name, email: s.email, phone: s.phone, addr: s.address, city: s.city, lic: s.licence, tin: s.tin, mustChange: !!s.must_change_password },
      requests: reqs.map((x) => requestOf(x, bids, now)),
      quotes: mine.map((q) => quoteOf(q, Number(q.rnk))),
      batches: batchesOf(mine),
      notifications: notes.map((n) => ({ id: n.id, icon: n.icon, title: n.title, body: n.body, at: ms(n.created_at), read: !!n.read_at })),
      site: {
        notice: showNotice ? { tone: site.notice.tone, title: site.notice.title, body: site.notice.body, dismissible: site.notice.dismissible } : null,
        maintenance: maintenanceLive(site.maintenance, now) ? { message: site.maintenance.message } : null,
      },
    });
  });

  /* What rank a price would get. Shows a position and a count, never anyone's price. */
  r.get('/requests/:id/rank', gate, async (req, res) => {
    const rid = parse(id, req.params.id);
    const price = parse(z.coerce.number().positive().max(10_000_000), req.query.price);
    const rows = await db.all('SELECT supplier_id, price FROM quotes WHERE request_id = ?', [rid]);
    const others = rows.filter((q) => q.supplier_id !== req.supplier.id);
    res.json({ rank: 1 + others.filter((q) => Number(q.price) < price).length, bids: rows.length, mine: rows.some((q) => q.supplier_id === req.supplier.id) });
  });

  /* One price from the request page. */
  r.post('/quotes', gate, async (req, res) => {
    const b = parse(z.object({ reqId: id, qty, price: money2, delivery: cleanDate, note: z.string().trim().max(500).optional().default('') }), req.body);
    const now = new Date();
    const out = await db.tx(async (c) => {
      const q = await placeQuote(c, req.supplier, b, null, now);
      await audit(c, req.ctx, { type: 'quote', text: `sent a quote for RQ-${b.reqId}, ${q.name}, at ${b.price}`, ref: { kind: 'request', id: b.reqId } });
      await bump(c);
      return q;
    });
    res.json({ ok: true, id: out.id });
  });

  /* A cart: several prices sent together as one submission. Each line is checked; lines that cannot be placed are reported back. */
  r.post('/submissions', gate, async (req, res) => {
    const b = parse(z.object({ items: z.array(z.object({ reqId: id, qty, price: money2 })).min(1).max(60) }), req.body);
    const ids = b.items.map((i) => i.reqId);
    if (new Set(ids).size !== ids.length) throw bad('A medicine appears twice in the cart.');
    const now = new Date();
    const out = await db.tx(async (c) => {
      const sub = await c.run('INSERT INTO submissions (supplier_id, submitted_at) VALUES (?, ?)', [req.supplier.id, now]);
      const placed = [];
      const skipped = [];
      for (const item of b.items.sort((x, y) => x.reqId - y.reqId)) {
        try {
          placed.push(await placeQuote(c, req.supplier, item, sub.insertId, now));
        } catch (e) {
          if (e instanceof HttpError) skipped.push({ reqId: item.reqId, code: e.code, message: e.message });
          else throw e;
        }
      }
      if (!placed.length) {
        const first = skipped[0];
        throw new HttpError(409, first ? first.code : 'nothing_sent', first ? first.message : 'Nothing could be sent.', { skipped });
      }
      await audit(c, req.ctx, { type: 'quote', text: `sent ${placed.length === 1 ? '1 quote' : placed.length + ' quotes'} in cart ${subCode(sub.insertId)}`, ref: { kind: 'supplier', id: req.supplier.code } });
      await bump(c);
      return { batch: subCode(sub.insertId), placed: placed.length, skipped };
    });
    res.json({ ok: true, ...out });
  });

  /* Take back a quote that nobody has reviewed yet (the undo after sending). */
  r.delete('/quotes/:id', gate, async (req, res) => {
    const qid = parse(id, req.params.id);
    await db.tx(async (c) => {
      const q = await c.one('SELECT * FROM quotes WHERE id = ? AND supplier_id = ? FOR UPDATE', [qid, req.supplier.id]);
      if (!q) throw notFound('This quote no longer exists.');
      if (q.status !== 'Pending') throw conflict('This quote has already been reviewed, so it cannot be taken back.', 'reviewed');
      await c.run('DELETE FROM quotes WHERE id = ?', [qid]);
      if (q.submission_id && !(await c.one('SELECT id FROM quotes WHERE submission_id = ? LIMIT 1', [q.submission_id]))) await c.run('DELETE FROM submissions WHERE id = ?', [q.submission_id]);
      await audit(c, req.ctx, { type: 'quote', text: `took back a quote for RQ-${q.request_id}`, ref: { kind: 'request', id: q.request_id } });
      await bump(c);
    });
    res.json({ ok: true });
  });

  r.post('/notifications/read', async (req, res) => {
    await db.run('UPDATE notifications SET read_at = ? WHERE supplier_id = ? AND read_at IS NULL', [new Date(), req.supplier.id]);
    res.json({ ok: true });
  });

  /* Contact details can be edited. The licence and TIN were verified, so only an admin changes those. */
  r.patch('/account', gate, async (req, res) => {
    const b = parse(z.object({ name: text(80, 'Owner name'), biz: text(120, 'Business name'), phone: z.string().trim().refine((v) => /^(\+?88)?01[3-9]\d{8}$/.test(v.replace(/[\s-]/g, '')), 'Use +8801XXXXXXXXX or 01XXXXXXXXX.'), addr: text(200, 'Address') }), req.body);
    await db.tx(async (c) => {
      await c.run('UPDATE suppliers SET owner_name = ?, name = ?, phone = ?, address = ? WHERE id = ?', [b.name, b.biz, b.phone.replace(/[\s-]/g, ''), b.addr, req.supplier.id]);
      await audit(c, req.ctx, { type: 'supplier', text: 'updated their account details', ref: { kind: 'supplier', id: req.supplier.code } });
      await bump(c);
    });
    res.json({ ok: true });
  });

  return r;
}
module.exports = { supplierData };
