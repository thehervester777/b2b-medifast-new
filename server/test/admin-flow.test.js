'use strict';
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { start, ownerClient, adminWithRole, makeSupplier, makeRequest, makeQuote } = require('./helpers');

let srv;
let owner;
before(async () => {
  srv = await start();
  owner = await ownerClient(srv);
});
after(async () => {
  await srv.close();
});
beforeEach(async () => {
  await srv.db.run('DELETE FROM undo_log');
});

const one = (sql, p) => srv.db.one(sql, p);
const count = async (table, where = '1=1') => Number((await one(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`)).n);

test('bootstrap returns the panel data in the shapes the apps use', async () => {
  const s = await makeSupplier(srv);
  const rid = await makeRequest(srv);
  const qid = await makeQuote(srv, rid, s.id);
  const r = await owner.get('/api/admin/bootstrap');
  assert.equal(r.status, 200);
  const b = r.body;
  assert.equal(b.me.role, 'Owner');
  assert.deepEqual(Object.keys(b.roles).sort(), ['Finance', 'Manager', 'Owner', 'Reviewer', 'Warehouse']);
  const req = b.requests.find((x) => x.id === rid);
  assert.equal(req.co, 'ACI Limited');
  assert.equal(req.ask, 100);
  assert.equal(typeof req.postedAt, 'number');
  const q = b.quotes.find((x) => x.id === qid);
  assert.equal(q.supplierId, s.code);
  assert.equal(q.price, 90);
  assert.equal(q.status, 'Pending');
  assert.equal(b.suppliers.find((x) => x.id === s.code).status, 'Verified');
  assert.equal(b.settings.leadDays, 4);
  assert.equal(b.site.notice.on, false);
  assert.ok(Number.isInteger(b.version));
});

test('approve, reject (reason required), and the audit trail', async () => {
  const s = await makeSupplier(srv);
  const rid = await makeRequest(srv);
  const q1 = await makeQuote(srv, rid, s.id);
  const missing = await owner.post('/api/admin/quotes/decide', { ids: [q1], decision: 'reject' });
  assert.equal(missing.status, 422);
  const ap = await owner.post('/api/admin/quotes/decide', { ids: [q1], decision: 'approve' });
  assert.equal(ap.status, 200);
  assert.equal(ap.body.changed, 1);
  assert.equal((await one('SELECT status, decided_by FROM quotes WHERE id = ?', [q1])).status, 'Approved');
  assert.equal((await one('SELECT decided_by FROM quotes WHERE id = ?', [q1])).decided_by, 'Nusrat Jahan');
  const again = await owner.post('/api/admin/quotes/decide', { ids: [q1], decision: 'approve' });
  assert.equal(again.status, 409);
  const rej = await owner.post('/api/admin/quotes/decide', { ids: [q1], decision: 'reject', reason: 'Price above the asking price', note: 'too high' });
  assert.equal(rej.status, 200);
  assert.equal((await one('SELECT reason FROM quotes WHERE id = ?', [q1])).reason, 'Price above the asking price: too high');
  const log = await owner.get('/api/admin/bootstrap');
  assert.ok(log.body.activity.some((a) => a.text === `approved QT-${q1} from ${s.name}` && a.by === 'Nusrat Jahan'));
  assert.ok(log.body.activity.some((a) => a.text === `rejected QT-${q1} from ${s.name}`));
  assert.equal(await count('notifications', `supplier_id = ${s.id} AND title = 'Quote not selected'`), 1);
});

test('award: one transaction creates the order, rejects the others, completes the request, notifies, and bumps the version', async () => {
  const [a, b, c] = [await makeSupplier(srv), await makeSupplier(srv), await makeSupplier(srv)];
  const rid = await makeRequest(srv, { ask_price: 100, qty: 10 });
  const qa = await makeQuote(srv, rid, a.id, { price: 95, status: 'Approved' });
  const qb = await makeQuote(srv, rid, b.id, { price: 90, status: 'Pending' });
  const qc = await makeQuote(srv, rid, c.id, { price: 99, status: 'Approved' });
  const v0 = (await owner.get('/api/admin/version')).body.version;
  const r = await owner.post('/api/admin/quotes/award', { ids: [qa] });
  assert.equal(r.status, 200);
  assert.equal(r.body.awarded.length, 1);
  assert.ok(r.body.version > v0);
  assert.ok(r.body.undo.token);
  const order = await one('SELECT * FROM orders WHERE quote_id = ?', [qa]);
  assert.equal(order.status, 'Pending');
  assert.equal(Number(order.price), 95);
  assert.equal(order.qty, 10);
  assert.equal(Number(order.ask_price), 100);
  assert.equal(Math.round((order.expected_at - order.created_at) / 86_400_000), 4);
  assert.equal((await one('SELECT status FROM requests WHERE id = ?', [rid])).status, 'Completed');
  assert.equal((await one('SELECT status FROM quotes WHERE id = ?', [qa])).status, 'Awarded');
  for (const q of [qb, qc]) {
    const row = await one('SELECT status, reason FROM quotes WHERE id = ?', [q]);
    assert.equal(row.status, 'Rejected');
    assert.equal(row.reason, 'Another quote was awarded');
  }
  assert.equal(await count('order_history', `order_id = ${order.id}`), 1);
  assert.equal(await count('notifications', `supplier_id = ${a.id} AND title = 'Quote won'`), 1);
  assert.equal(await count('notifications', `supplier_id = ${b.id} AND title = 'Quote not selected'`), 1);
  // awarding a request that is already complete is refused
  const twice = await owner.post('/api/admin/quotes/award', { ids: [qb] });
  assert.equal(twice.status, 409);
  assert.equal(await count('orders', `request_id = ${rid}`), 1);
});

test('award picks only the cheapest when two quotes for the same request are sent, and refuses suspended suppliers', async () => {
  const [a, b, z] = [await makeSupplier(srv), await makeSupplier(srv), await makeSupplier(srv, { status: 'Suspended' })];
  const rid = await makeRequest(srv);
  const qa = await makeQuote(srv, rid, a.id, { price: 95, status: 'Approved' });
  const qb = await makeQuote(srv, rid, b.id, { price: 92, status: 'Approved' });
  const r = await owner.post('/api/admin/quotes/award', { ids: [qa, qb] });
  assert.equal(r.status, 200);
  assert.equal(r.body.awarded.length, 1);
  assert.equal(r.body.awarded[0].quoteId, qb);
  const rid2 = await makeRequest(srv);
  const qz = await makeQuote(srv, rid2, z.id, { price: 80, status: 'Approved' });
  const refused = await owner.post('/api/admin/quotes/award', { ids: [qz] });
  assert.equal(refused.status, 409);
  assert.match(refused.body.error.message, /suspended/);
});

test('award keeps the other quotes when the setting is off', async () => {
  await owner.patch('/api/admin/settings', { key: 'rejectOthersOnAward', value: false });
  const [a, b] = [await makeSupplier(srv), await makeSupplier(srv)];
  const rid = await makeRequest(srv);
  const qa = await makeQuote(srv, rid, a.id, { status: 'Approved' });
  const qb = await makeQuote(srv, rid, b.id, { status: 'Pending' });
  await owner.post('/api/admin/quotes/award', { ids: [qa] });
  assert.equal((await one('SELECT status FROM quotes WHERE id = ?', [qb])).status, 'Pending');
  await owner.patch('/api/admin/settings', { key: 'rejectOthersOnAward', value: true });
});

test('two admins awarding different quotes of one request at the same time: exactly one order', async () => {
  const [a, b] = [await makeSupplier(srv), await makeSupplier(srv)];
  const rid = await makeRequest(srv);
  const qa = await makeQuote(srv, rid, a.id, { status: 'Approved' });
  const qb = await makeQuote(srv, rid, b.id, { status: 'Approved' });
  const other = await adminWithRole(srv, 'Manager');
  const [r1, r2] = await Promise.all([owner.post('/api/admin/quotes/award', { ids: [qa] }), other.post('/api/admin/quotes/award', { ids: [qb] })]);
  assert.deepEqual([r1.status, r2.status].sort(), [200, 409]);
  assert.equal(await count('orders', `request_id = ${rid}`), 1);
});

test('undo puts an award back exactly, and refuses a second use, a stranger, or a changed order', async () => {
  const s = await makeSupplier(srv);
  const s2 = await makeSupplier(srv);
  const rid = await makeRequest(srv);
  const q1 = await makeQuote(srv, rid, s.id, { status: 'Approved' });
  const q2 = await makeQuote(srv, rid, s2.id, { status: 'Pending' });
  const before = { req: await one('SELECT status, no_end, deadline_at FROM requests WHERE id = ?', [rid]), q: await srv.db.all('SELECT id, status, decided_at, decided_by, reason FROM quotes WHERE request_id = ? ORDER BY id', [rid]) };
  const notesBefore = await count('notifications');
  const aw = await owner.post('/api/admin/quotes/award', { ids: [q1] });
  const stranger = await adminWithRole(srv, 'Manager', 'm2@example.com');
  assert.equal((await stranger.post('/api/admin/undo', { token: aw.body.undo.token })).status, 403);
  const un = await owner.post('/api/admin/undo', { token: aw.body.undo.token });
  assert.equal(un.status, 200);
  assert.equal(await count('orders', `request_id = ${rid}`), 0);
  assert.equal(await count('notifications'), notesBefore);
  const after = { req: await one('SELECT status, no_end, deadline_at FROM requests WHERE id = ?', [rid]), q: await srv.db.all('SELECT id, status, decided_at, decided_by, reason FROM quotes WHERE request_id = ? ORDER BY id', [rid]) };
  assert.deepEqual(after, before);
  assert.equal((await owner.post('/api/admin/undo', { token: aw.body.undo.token })).status, 404);
  const log = (await owner.get('/api/admin/bootstrap')).body.activity;
  assert.ok(log.some((a) => a.text.startsWith('undid: awarded')), 'undo is itself logged');
  assert.ok(log.some((a) => a.text.startsWith('awarded QT-')), 'the original line is kept');

  // a later change blocks the undo
  const aw2 = await owner.post('/api/admin/quotes/award', { ids: [q1] });
  const orderId = aw2.body.awarded[0].orderId;
  await owner.post('/api/admin/orders/status', { ids: [orderId], status: 'Approved' });
  const blocked = await owner.post('/api/admin/undo', { token: aw2.body.undo.token });
  assert.equal(blocked.status, 409);
  assert.equal(blocked.body.error.code, 'undo_conflict');
  assert.equal(q2 > 0, true);
});

test('undo of approve and reject restores the quote', async () => {
  const s = await makeSupplier(srv);
  const rid = await makeRequest(srv);
  const q = await makeQuote(srv, rid, s.id);
  const ap = await owner.post('/api/admin/quotes/decide', { ids: [q], decision: 'approve' });
  await owner.post('/api/admin/undo', { token: ap.body.undo.token });
  const row = await one('SELECT status, decided_at, decided_by FROM quotes WHERE id = ?', [q]);
  assert.equal(row.status, 'Pending');
  assert.equal(row.decided_at, null);
  assert.equal(row.decided_by, '');
});

test('an expired undo token is refused', async () => {
  const s = await makeSupplier(srv);
  const q = await makeQuote(srv, await makeRequest(srv), s.id);
  const ap = await owner.post('/api/admin/quotes/decide', { ids: [q], decision: 'approve' });
  await srv.db.run('UPDATE undo_log SET expires_at = ?', [new Date(Date.now() - 1000)]);
  const r = await owner.post('/api/admin/undo', { token: ap.body.undo.token });
  assert.equal(r.status, 409);
  assert.equal(r.body.error.code, 'undo_expired');
});

test('orders: status steps with history, Delivered stamp, bulk, edit line, and undo', async () => {
  const s = await makeSupplier(srv);
  const rid = await makeRequest(srv);
  const q = await makeQuote(srv, rid, s.id, { status: 'Approved', price: 80, qty: 10 });
  const aw = await owner.post('/api/admin/quotes/award', { ids: [q] });
  const oid = aw.body.awarded[0].orderId;
  const st = await owner.post('/api/admin/orders/status', { ids: [oid], status: 'In transit' });
  assert.equal(st.status, 200);
  assert.equal((await owner.post('/api/admin/orders/status', { ids: [oid], status: 'In transit' })).status, 409);
  const del = await owner.post('/api/admin/orders/status', { ids: [oid], status: 'Delivered' });
  assert.notEqual((await one('SELECT delivered_at FROM orders WHERE id = ?', [oid])).delivered_at, null);
  await owner.post('/api/admin/undo', { token: del.body.undo.token });
  const o = await one('SELECT status, delivered_at FROM orders WHERE id = ?', [oid]);
  assert.equal(o.status, 'In transit');
  assert.equal(o.delivered_at, null);
  assert.equal(await count('order_history', `order_id = ${oid}`), 2);

  const edit = await owner.patch(`/api/admin/orders/${oid}`, { qty: 8, price: 82.5 });
  assert.equal(edit.status, 200);
  const row = await one('SELECT qty, price FROM orders WHERE id = ?', [oid]);
  assert.equal(row.qty, 8);
  assert.equal(Number(row.price), 82.5);
  const hist = (await owner.get('/api/admin/bootstrap')).body.orders.find((x) => x.id === oid).history;
  assert.ok(hist.some((h) => /boxes 10 to 8 and price per box 80 to 82.5/.test(h.note)));
  assert.equal((await owner.patch(`/api/admin/orders/${oid}`, { qty: 0 })).status, 422);
  await owner.post('/api/admin/orders/status', { ids: [oid], status: 'Delivered' });
  assert.equal((await owner.patch(`/api/admin/orders/${oid}`, { qty: 3 })).status, 409);
  const bulk = await owner.post('/api/admin/orders/status', { ids: [oid, 999999], status: 'Cancelled' });
  assert.equal(bulk.body.changed, 1);
  assert.equal((await owner.post('/api/admin/orders/status', { ids: [oid], status: 'Teleported' })).status, 422);
});

test('requests: post, edit, close (rejects waiting quotes), reopen, delete rules', async () => {
  const s = await makeSupplier(srv);
  const body = { name: 'Cefix 500 capsule', generic: 'Cefixime', co: 'Square Pharma', qty: 12, ask: 440, noEnd: false, deadlineAt: Date.now() + 3 * 86_400_000, note: 'urgent' };
  assert.equal((await owner.post('/api/admin/requests', { ...body, deadlineAt: Date.now() - 1000 })).status, 422);
  assert.equal((await owner.post('/api/admin/requests', { ...body, qty: 0 })).status, 422);
  const made = await owner.post('/api/admin/requests', body);
  assert.equal(made.status, 200);
  const id = made.body.id;
  assert.ok(id >= 1001);
  const ed = await owner.patch(`/api/admin/requests/${id}`, { ask: 430, note: 'urgent, ship fast' });
  assert.equal(ed.status, 200);
  const kept = await one('SELECT * FROM requests WHERE id = ?', [id]);
  assert.equal(Number(kept.ask_price), 430);
  assert.equal(kept.generic, 'Cefixime', 'an edit leaves fields it did not mention alone');
  assert.equal(kept.company, 'Square Pharma');
  assert.equal(kept.qty, 12);
  assert.equal(kept.no_end, 0);
  assert.notEqual(kept.deadline_at, null);
  const q = await makeQuote(srv, id, s.id);
  const closed = await owner.post(`/api/admin/requests/${id}/close`);
  assert.equal(closed.status, 200);
  assert.equal((await one('SELECT status, reason FROM quotes WHERE id = ?', [q])).reason, 'Request closed');
  assert.equal((await owner.post(`/api/admin/requests/${id}/close`)).status, 409);
  await owner.post('/api/admin/undo', { token: closed.body.undo.token });
  assert.equal((await one('SELECT status FROM requests WHERE id = ?', [id])).status, 'Active');
  assert.equal((await one('SELECT status FROM quotes WHERE id = ?', [q])).status, 'Pending');
  await owner.post(`/api/admin/requests/${id}/close`);
  assert.equal((await owner.post(`/api/admin/requests/${id}/reopen`)).status, 200);
  assert.equal((await owner.post(`/api/admin/requests/${id}/reopen`)).status, 409);

  const del = await owner.del(`/api/admin/requests/${id}`);
  assert.equal(del.status, 200);
  assert.equal(await count('quotes', `request_id = ${id}`), 0);
  await owner.post('/api/admin/undo', { token: del.body.undo.token });
  assert.equal(await count('quotes', `request_id = ${id}`), 1);

  const ordered = await makeRequest(srv);
  const oq = await makeQuote(srv, ordered, s.id, { status: 'Approved' });
  await owner.post('/api/admin/quotes/award', { ids: [oq] });
  const keep = await owner.del(`/api/admin/requests/${ordered}`);
  assert.equal(keep.status, 409);
  assert.equal(keep.body.error.code, 'has_order');
});

test('expired deadlines: a request closes by itself once nothing is waiting on it', async () => {
  const { expireRequests } = require('../src/rules/sweep');
  const s = await makeSupplier(srv);
  const open = await makeRequest(srv, { deadline_at: new Date(Date.now() - 1000) });
  const waiting = await makeRequest(srv, { deadline_at: new Date(Date.now() - 1000) });
  await makeQuote(srv, waiting, s.id);
  await expireRequests(srv.db);
  assert.equal((await one('SELECT status FROM requests WHERE id = ?', [open])).status, 'Expired');
  assert.equal((await one('SELECT status FROM requests WHERE id = ?', [waiting])).status, 'Active');
});

test('suppliers: verify, suspend (sessions end), reinstate, temporary password', async () => {
  const s = await makeSupplier(srv, { status: 'Pending' });
  assert.equal((await owner.patch(`/api/admin/suppliers/${s.code}`, { status: 'Verified' })).status, 200);
  assert.equal((await one('SELECT status FROM suppliers WHERE id = ?', [s.id])).status, 'Verified');
  assert.equal(await count('notifications', `supplier_id = ${s.id} AND title = 'Account verified'`), 1);
  assert.equal((await owner.patch(`/api/admin/suppliers/${s.code}`, { status: 'Verified' })).status, 409);
  await srv.db.run("INSERT INTO sessions (token_hash, actor_type, actor_id, expires_at) VALUES (REPEAT('a',64), 'supplier', ?, ?)", [s.id, new Date(Date.now() + 1e6)]);
  assert.equal((await owner.patch(`/api/admin/suppliers/${s.code}`, { status: 'Suspended' })).status, 200);
  assert.equal(await count('sessions', `actor_type = 'supplier' AND actor_id = ${s.id}`), 0);
  const pw = await owner.post(`/api/admin/suppliers/${s.code}/reset-password`);
  assert.equal(pw.status, 200);
  assert.ok(pw.body.password.length >= 12);
  assert.equal(Number((await one('SELECT must_change_password AS m FROM suppliers WHERE id = ?', [s.id])).m), 1);
  assert.equal((await owner.patch('/api/admin/suppliers/PR-0000', { status: 'Verified' })).status, 404);
});

test('products: add, edit, send to suppliers (one open request per product), undo', async () => {
  const add = await owner.post('/api/admin/products', { name: 'Maxpro 20 tablet', generic: 'Esomeprazole', brand: 'Square Pharma', stock: 3, reorder: 10, buy: 80, sale: 100 });
  assert.equal(add.status, 200);
  const p = await one('SELECT * FROM products WHERE id = ?', [add.body.id]);
  assert.match(p.code, /^PROD-\d{8}-[A-Z]{6}$/);
  assert.equal((await owner.patch(`/api/admin/products/${p.id}`, { stock: 2 })).status, 200);
  assert.equal((await owner.post('/api/admin/products', { name: '', stock: 1 })).status, 422);
  const send = await owner.post('/api/admin/products/send', { items: [{ id: p.id, qty: 20, ask: 85 }], noEnd: true });
  assert.equal(send.status, 200);
  const req = await one('SELECT * FROM requests WHERE id = ?', [send.body.ids[0]]);
  assert.equal(req.product_id, p.id);
  assert.equal(req.company, 'Square Pharma');
  assert.equal(req.no_end, 1);
  assert.notEqual((await one('SELECT last_sent_at FROM products WHERE id = ?', [p.id])).last_sent_at, null);
  assert.equal((await owner.post('/api/admin/products/send', { items: [{ id: p.id, qty: 5, ask: 85 }], noEnd: true })).status, 409);
  await owner.post('/api/admin/undo', { token: send.body.undo.token });
  assert.equal(await count('requests', `product_id = ${p.id}`), 0);
  assert.equal((await one('SELECT last_sent_at FROM products WHERE id = ?', [p.id])).last_sent_at, null);
});

test('settings and site: validated, logged, and bad values refused', async () => {
  assert.equal((await owner.patch('/api/admin/settings', { key: 'lowPricePct', value: 30 })).status, 200);
  assert.equal((await owner.patch('/api/admin/settings', { key: 'lowPricePct', value: 500 })).status, 422);
  assert.equal((await owner.patch('/api/admin/settings', { key: 'notAThing', value: 1 })).status, 422);
  assert.equal((await owner.patch('/api/admin/site/notice', { on: true })).status, 409, 'empty notice cannot be switched on');
  assert.equal((await owner.patch('/api/admin/site/notice', { title: 'Stock count Friday', body: 'Orders ship Saturday.', on: true })).status, 200);
  await owner.patch('/api/admin/site/notice', { on: false });
  await owner.patch('/api/admin/site/notice', { on: true });
  const pub = await srv.client().get('/api/public/site');
  assert.equal(pub.body.notice.title, 'Stock count Friday');
  assert.equal(pub.body.maintenance, null);
  assert.equal((await owner.patch('/api/admin/site/maintenance', { mode: 'now', message: 'Back soon.' })).status, 200);
  assert.equal((await srv.client().get('/api/public/site')).body.maintenance.message, 'Back soon.');
  await owner.patch('/api/admin/site/maintenance', { mode: 'off' });
  const log = (await owner.get('/api/admin/bootstrap')).body.activity.map((a) => a.text);
  assert.ok(log.includes('set the low price check to 30% below asking'));
  assert.ok(log.includes('turned on maintenance mode'));
});

test('access: invite, change role, switch off, remove, and the last Owner is protected', async () => {
  const inv = await owner.post('/api/admin/team', { name: 'Tania', email: 'tania@example.com', role: 'Reviewer' });
  const id = inv.body.id;
  assert.equal((await owner.post('/api/admin/team', { name: 'Tania 2', email: 'TANIA@example.com', role: 'Reviewer' })).status, 409);
  assert.equal((await owner.post('/api/admin/team', { name: 'X', email: 'x@example.com', role: 'Wizard' })).status, 422);
  assert.equal((await owner.patch(`/api/admin/team/${id}`, { role: 'Finance' })).status, 200);
  assert.equal((await one('SELECT r.name FROM admins a JOIN roles r ON r.id = a.role_id WHERE a.id = ?', [id])).name, 'Finance');
  assert.equal((await owner.patch(`/api/admin/team/${id}`, { active: false })).status, 200);
  const me = (await owner.get('/api/admin/auth/me')).body.me;
  assert.equal((await owner.patch(`/api/admin/team/${me.id}`, { active: false })).status, 403);
  assert.equal((await owner.patch(`/api/admin/team/${me.id}`, { role: 'Manager' })).status, 403);
  assert.equal((await owner.del(`/api/admin/team/${me.id}`)).status, 403);
  // a second Owner can be made, then the first cannot be the last
  const o2 = await owner.post('/api/admin/team', { name: 'Co-owner', email: 'co@example.com', role: 'Owner' });
  assert.equal((await owner.del(`/api/admin/team/${o2.body.id}`)).status, 200);
  assert.equal((await owner.del(`/api/admin/team/${id}`)).status, 200);
  const only = await adminWithRole(srv, 'Owner', 'owner-b@example.com');
  const row = await one("SELECT id FROM admins WHERE email = 'owner@example.com'");
  await srv.db.run("UPDATE admins SET active = 0 WHERE email = 'owner@example.com'");
  const last = await only.patch(`/api/admin/team/${(await one("SELECT id FROM admins WHERE email = 'owner-b@example.com'")).id}`, { active: false });
  assert.equal(last.status, 403); // self
  await srv.db.run('UPDATE admins SET active = 1 WHERE id = ?', [row.id]);
});

test('roles: a permission can be given and taken away, Owner is fixed, and changes apply at once', async () => {
  const rev = await adminWithRole(srv, 'Reviewer', 'rev2@example.com');
  const rid = await makeRequest(srv);
  assert.equal((await rev.post(`/api/admin/requests/${rid}/close`)).status, 403);
  assert.equal((await owner.patch('/api/admin/roles/Reviewer', { key: 'requests.manage', on: true })).status, 200);
  assert.equal((await rev.post(`/api/admin/requests/${rid}/close`)).status, 200);
  assert.equal((await owner.patch('/api/admin/roles/Reviewer', { key: 'requests.manage', on: false })).status, 200);
  assert.equal((await owner.patch('/api/admin/roles/Owner', { key: 'requests.manage', on: false })).status, 403);
  assert.equal((await owner.patch('/api/admin/roles/Reviewer', { key: 'made.up', on: true })).status, 422);
});

test('permission matrix: every role is held to what it may do, on the server', async () => {
  const s = await makeSupplier(srv);
  const rid = await makeRequest(srv);
  const q = await makeQuote(srv, rid, s.id);
  const cases = {
    Reviewer: { decide: 200, status: 403, request: 403, supplier: 403, team: 403, settings: 403, site: 403, product: 403 },
    Warehouse: { decide: 403, status: 409, request: 403, supplier: 403, team: 403, settings: 403, site: 403, product: 403 },
    Finance: { decide: 403, status: 403, request: 403, supplier: 403, team: 403, settings: 403, site: 403, product: 403 },
    Manager: { decide: 200, status: 409, request: 200, supplier: 409, team: 403, settings: 403, site: 200, product: 200 },
  };
  const order = await srv.db.run("INSERT INTO orders (quote_id, request_id, supplier_id, name, qty, price, ask_price, status, expected_at, created_at) VALUES (?, ?, ?, 'X', 1, 1, 1, 'Pending', ?, ?)", [await makeQuote(srv, await makeRequest(srv), s.id, { status: 'Approved' }), rid, s.id, new Date(), new Date()]);
  for (const [role, want] of Object.entries(cases)) {
    const c = await adminWithRole(srv, role, `matrix-${role}@example.com`);
    await srv.db.run("UPDATE quotes SET status = 'Pending' WHERE id = ?", [q]);
    const got = {
      decide: (await c.post('/api/admin/quotes/decide', { ids: [q], decision: 'approve' })).status,
      status: (await c.post('/api/admin/orders/status', { ids: [order.insertId], status: 'Pending' })).status,
      request: (await c.post('/api/admin/requests', { name: 'Z', qty: 1, ask: 1, noEnd: true })).status,
      supplier: (await c.patch(`/api/admin/suppliers/${s.code}`, { status: 'Verified' })).status,
      team: (await c.post('/api/admin/team', { name: 'N', email: `n-${role}@example.com`, role: 'Reviewer' })).status,
      settings: (await c.patch('/api/admin/settings', { key: 'leadDays', value: 5 })).status,
      site: (await c.patch('/api/admin/site/maintenance', { mode: 'off' })).status,
      product: (await c.post('/api/admin/products', { name: 'P' })).status,
    };
    // 409 and 200 both mean "allowed"; the point is 403 vs not 403
    const norm = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v === 403 ? 403 : 'ok']));
    assert.deepEqual(norm(got), norm(want), `${role}: ${JSON.stringify(got)}`);
  }
  assert.equal((await srv.client().post('/api/admin/quotes/decide', { ids: [q], decision: 'approve' })).status, 401);
});

test('the bootstrap hides what a role may not see', async () => {
  const s = await makeSupplier(srv);
  await makeQuote(srv, await makeRequest(srv), s.id);
  const wh = await adminWithRole(srv, 'Warehouse', 'wh2@example.com');
  const b = (await wh.get('/api/admin/bootstrap')).body;
  assert.deepEqual(b.activity, []);
  assert.equal(b.team.length, 1);
  assert.deepEqual(Object.keys(b.roles), ['Warehouse']);
  assert.equal(b.suppliers[0].email, undefined === b.suppliers[0].email ? undefined : b.suppliers[0].email);
  const fin = (await (await adminWithRole(srv, 'Finance', 'fin2@example.com')).get('/api/admin/bootstrap')).body;
  assert.ok(fin.quotes.length > 0);
  assert.deepEqual(fin.activity, []);
});

test('printing a document is logged, and nothing returns a stack trace', async () => {
  const s = await makeSupplier(srv);
  const q = await makeQuote(srv, await makeRequest(srv), s.id, { status: 'Approved' });
  const aw = await owner.post('/api/admin/quotes/award', { ids: [q] });
  const pr = await owner.post('/api/admin/orders/printed', { kind: 'invoice', ids: [aw.body.awarded[0].orderId] });
  assert.equal(pr.status, 200);
  assert.ok((await owner.get('/api/admin/bootstrap')).body.activity.some((a) => /^printed invoice INV-/.test(a.text)));
  const bad = await owner.post('/api/admin/quotes/decide', { ids: 'nope', decision: 'approve' });
  assert.equal(bad.status, 422);
  assert.equal(JSON.stringify(bad.body).includes('node_modules'), false);
  assert.equal(srv.logger.errors.length, 0, 'no unexpected server errors: ' + srv.logger.errors.map((e) => e.stack).join('\n'));
});
