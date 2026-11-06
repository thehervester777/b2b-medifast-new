'use strict';
const { ms } = require('../lib/time');

/* Database rows -> the shapes both apps already use. Money is converted from DECIMAL strings to numbers here. */
const num = (v) => (v == null ? null : Number(v));
const json = (text, fallback) => {
  try {
    return text ? JSON.parse(text) : fallback;
  } catch (e) {
    return fallback;
  }
};

const request = (r) => ({
  id: r.id,
  name: r.name,
  generic: r.generic,
  co: r.company,
  qty: r.qty,
  ask: num(r.ask_price),
  status: r.status,
  noEnd: !!r.no_end,
  deadlineAt: ms(r.deadline_at),
  postedAt: ms(r.posted_at),
  note: r.note,
  productId: r.product_id,
});

const supplier = (s) => ({
  id: s.code,
  name: s.name,
  owner: s.owner_name,
  city: s.city,
  addr: s.address,
  status: s.status,
  email: s.email,
  phone: s.phone,
  lic: s.licence,
  tin: s.tin,
  joinedAt: ms(s.joined_at),
  docs: json(s.docs, { licence: false, tin: false, trade: false }),
  note: s.note,
  lastLoginAt: ms(s.last_login_at),
});

const quote = (q) => ({
  id: q.id,
  reqId: q.request_id,
  supplierId: q.supplier_code,
  sub: q.submission_id,
  qty: q.qty,
  price: num(q.price),
  status: q.status,
  at: ms(q.submitted_at),
  decidedAt: ms(q.decided_at),
  by: q.decided_by,
  reason: q.reason,
  delivery: q.delivery,
  note: q.supplier_note,
});

const historyLine = (h) => {
  const o = { at: ms(h.at), by: h.by_name };
  if (h.status) o.status = h.status;
  if (h.note) o.note = h.note;
  return o;
};

const order = (o, history = []) => ({
  id: o.id,
  quoteId: o.quote_id,
  reqId: o.request_id,
  supplierId: o.supplier_code,
  name: o.name,
  generic: o.generic,
  co: o.company,
  qty: o.qty,
  price: num(o.price),
  ask: num(o.ask_price),
  status: o.status,
  createdAt: ms(o.created_at),
  expectedAt: ms(o.expected_at),
  deliveredAt: ms(o.delivered_at),
  history: history.map(historyLine),
  note: o.note,
});

const product = (p) => ({
  id: p.id,
  code: p.code,
  name: p.name,
  generic: p.generic,
  brand: p.brand,
  stock: p.stock,
  reorder: p.reorder_level,
  buy: num(p.buy_price),
  sale: num(p.sale_price),
  status: p.status,
  addedAt: ms(p.created_at),
  lastSentAt: ms(p.last_sent_at),
});

const member = (a) => ({
  id: a.id,
  name: a.name,
  email: a.email,
  role: a.role_name,
  active: !!a.active,
  mustChange: !!a.must_change_password,
  ip: a.last_ip,
  device: a.last_device,
  lastSeenAt: ms(a.last_seen_at),
});

const activity = (a) => ({
  id: a.id,
  type: a.type,
  by: a.actor_name,
  byId: a.actor_type === 'admin' ? a.actor_id : null,
  text: a.text,
  ref: a.ref_kind ? { kind: a.ref_kind, id: /^\d+$/.test(a.ref_id) ? Number(a.ref_id) : a.ref_id } : null,
  at: ms(a.at),
  ip: a.ip,
  device: a.device,
});

module.exports = { request, supplier, quote, order, product, member, activity, historyLine, json, num };
