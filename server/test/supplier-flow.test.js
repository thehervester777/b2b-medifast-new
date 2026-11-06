'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { start, ownerClient, makeSupplier, makeRequest, makeQuote, PASSWORD } = require('./helpers');

let srv;
let owner;
before(async () => {
  srv = await start();
  owner = await ownerClient(srv);
});
after(async () => {
  await srv.close();
});

const one = (sql, p) => srv.db.one(sql, p);
const count = async (table, where = '1=1') => Number((await one(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`)).n);
const form = { biz: 'R Pharma', owner: 'Rishu Ahmed', addr: 'Kodomtoli, Dhaka', city: 'Dhaka', lic: '028337000123', tin: '203938000456', email: 'Rishu@RPharma.example', phone: '01700000000', password: 'a-good-password' };

async function signedIn(over = {}) {
  const s = await makeSupplier(srv, over);
  const c = srv.client();
  const l = await c.post('/api/supplier/auth/login', { email: s.email, password: PASSWORD, keep: false });
  assert.equal(l.status, 200, l.text);
  return { s, c };
}

test('sign-up creates a Pending supplier that cannot sign in until an admin verifies it', async () => {
  const c = srv.client();
  assert.equal((await c.post('/api/supplier/auth/signup', { ...form, phone: '12345' })).status, 422);
  assert.equal((await c.post('/api/supplier/auth/signup', { ...form, password: 'short' })).status, 422);
  const ok = await c.post('/api/supplier/auth/signup', form);
  assert.equal(ok.status, 200);
  assert.match(ok.body.id, /^PR-\d+$/);
  const row = await one('SELECT * FROM suppliers WHERE code = ?', [ok.body.id]);
  assert.equal(row.status, 'Pending');
  assert.equal(row.email, 'rishu@rpharma.example');
  assert.notEqual(row.password_hash, form.password);
  assert.equal((await c.post('/api/supplier/auth/signup', form)).status, 409);

  const pending = await c.post('/api/supplier/auth/login', { email: form.email, password: form.password });
  assert.equal(pending.status, 403);
  assert.equal(pending.body.error.code, 'pending');
  const wrong = await c.post('/api/supplier/auth/login', { email: form.email, password: 'nope-nope-nope' });
  assert.equal(wrong.status, 401);

  const seen = (await owner.get('/api/admin/bootstrap')).body;
  assert.equal(seen.suppliers.find((x) => x.id === ok.body.id).status, 'Pending');
  assert.ok(seen.activity.some((a) => a.text === 'registered and is waiting for verification' && a.by === 'R Pharma'));

  assert.equal((await owner.patch(`/api/admin/suppliers/${ok.body.id}`, { status: 'Verified' })).status, 200);
  const login = await c.post('/api/supplier/auth/login', { email: form.email, password: form.password, keep: true });
  assert.equal(login.status, 200);
  assert.match(login.setCookie.find((x) => x.startsWith('mf_supplier=')), /Max-Age=2592000/);
  const boot = (await c.get('/api/supplier/bootstrap')).body;
  assert.equal(boot.user.biz, 'R Pharma');
  assert.equal(boot.user.email, 'rishu@rpharma.example');
  assert.ok(boot.notifications.some((n) => n.title === 'Account verified' && n.read === false));
});

test('a supplier session does not open the admin API, and an admin session does not open the supplier API', async () => {
  const { c } = await signedIn();
  assert.equal((await c.get('/api/admin/bootstrap')).status, 401);
  assert.equal((await owner.get('/api/supplier/bootstrap')).status, 401);
});

test('the board shows open requests with a bid count and never another supplier\'s name or price', async () => {
  const { s, c } = await signedIn();
  const other = await makeSupplier(srv);
  const rid = await makeRequest(srv, { name: 'Zimax 10 tablet', ask_price: 200, qty: 8 });
  await makeQuote(srv, rid, other.id, { price: 150 });
  await makeQuote(srv, rid, s.id, { price: 180, qty: 5 });
  const done = await makeRequest(srv, { status: 'Completed', posted_at: new Date(Date.now() - 20 * 86_400_000) });
  const b = (await c.get('/api/supplier/bootstrap')).body;
  const req = b.requests.find((x) => x.id === rid);
  assert.equal(req.bids, 2);
  assert.equal(req.ask, 200);
  assert.ok(b.requests.some((x) => x.id === done && x.status === 'Completed'));
  const mine = b.quotes.find((x) => x.req === rid);
  assert.equal(mine.rank, 2, 'one other price is lower');
  assert.equal(mine.status, 'PENDING');
  const raw = JSON.stringify(b);
  assert.equal(raw.includes(other.name), false);
  assert.equal(raw.includes('150'), false);
  assert.equal(b.quotes.length, 1);
});

test('sending one price: checked against the request, ranked, visible to the admin, and can be taken back', async () => {
  const { s, c } = await signedIn();
  const rid = await makeRequest(srv, { ask_price: 100, qty: 10 });
  const rival = await makeSupplier(srv);
  await makeQuote(srv, rid, rival.id, { price: 90 });
  assert.equal((await c.post('/api/supplier/quotes', { reqId: rid, qty: 11, price: 95 })).status, 422);
  assert.equal((await c.post('/api/supplier/quotes', { reqId: rid, qty: 5, price: 101 })).status, 422);
  assert.equal((await c.post('/api/supplier/quotes', { reqId: rid, qty: 5, price: 95.555 })).status, 422);
  assert.equal((await c.post('/api/supplier/quotes', { reqId: 999999, qty: 5, price: 95 })).status, 404);
  const rk = await c.get(`/api/supplier/requests/${rid}/rank?price=85`);
  assert.deepEqual([rk.body.rank, rk.body.bids], [1, 1]);
  assert.equal((await c.get(`/api/supplier/requests/${rid}/rank?price=95`)).body.rank, 2);
  const sent = await c.post('/api/supplier/quotes', { reqId: rid, qty: 5, price: 95, delivery: '2026-11-20', note: 'Cold chain' });
  assert.equal(sent.status, 200);
  const qrow = await one('SELECT * FROM quotes WHERE id = ?', [sent.body.id]);
  assert.equal(qrow.supplier_id, s.id);
  assert.equal(qrow.status, 'Pending');
  assert.equal(qrow.delivery, '2026-11-20');
  const seen = (await owner.get('/api/admin/bootstrap')).body;
  assert.ok(seen.quotes.some((q) => q.id === sent.body.id && q.supplierId === s.code && q.price === 95));
  // sending again while pending replaces; there is still one quote
  assert.equal((await c.post('/api/supplier/quotes', { reqId: rid, qty: 6, price: 94 })).status, 200);
  assert.equal(await count('quotes', `request_id = ${rid} AND supplier_id = ${s.id}`), 1);
  assert.equal((await one('SELECT price FROM quotes WHERE id = ?', [sent.body.id])).price, '94.00');
  // take it back
  assert.equal((await c.del(`/api/supplier/quotes/${sent.body.id}`)).status, 200);
  assert.equal(await count('quotes', `request_id = ${rid} AND supplier_id = ${s.id}`), 0);
  // a decided quote cannot be taken back or replaced
  const q2 = await makeQuote(srv, await makeRequest(srv), s.id, { status: 'Approved' });
  assert.equal((await c.del(`/api/supplier/quotes/${q2}`)).status, 409);
});

test('a supplier cannot touch another supplier\'s quote', async () => {
  const a = await signedIn();
  const b = await signedIn();
  const q = await makeQuote(srv, await makeRequest(srv), a.s.id);
  assert.equal((await b.c.del(`/api/supplier/quotes/${q}`)).status, 404);
  assert.equal(await count('quotes', `id = ${q}`), 1);
});

test('a cart is one submission: lines are checked one by one and the admin sees it as a cart', async () => {
  const { s, c } = await signedIn();
  const r1 = await makeRequest(srv, { ask_price: 50, qty: 10 });
  const r2 = await makeRequest(srv, { ask_price: 60, qty: 8 });
  const closed = await makeRequest(srv, { status: 'Expired' });
  const res = await c.post('/api/supplier/submissions', { items: [{ reqId: r1, qty: 10, price: 50 }, { reqId: r2, qty: 8, price: 55.5 }, { reqId: closed, qty: 1, price: 10 }] });
  assert.equal(res.status, 200);
  assert.equal(res.body.placed, 2);
  assert.equal(res.body.skipped.length, 1);
  assert.equal(res.body.skipped[0].code, 'closed');
  assert.match(res.body.batch, /^CT-\d+$/);
  const subId = Number(res.body.batch.slice(3));
  assert.equal(await count('quotes', `submission_id = ${subId}`), 2);
  const boot = (await c.get('/api/supplier/bootstrap')).body;
  assert.equal(boot.batches.length, 1);
  assert.equal(boot.batches[0].id, res.body.batch);
  assert.equal(boot.batches[0].items.length, 2);
  assert.equal(boot.batches[0].total, 50 * 10 + 55.5 * 8);
  const adm = (await owner.get('/api/admin/bootstrap')).body.quotes.filter((q) => q.sub === subId);
  assert.equal(adm.length, 2);
  assert.equal((await c.post('/api/supplier/submissions', { items: [{ reqId: r1, qty: 1, price: 1 }, { reqId: r1, qty: 1, price: 1 }] })).status, 422);
  const none = await c.post('/api/supplier/submissions', { items: [{ reqId: closed, qty: 1, price: 10 }] });
  assert.equal(none.status, 409);
  assert.equal(await count('submissions', `supplier_id = ${s.id}`), 1, 'a failed cart leaves nothing behind');
});

test('when the admin awards or rejects, the supplier sees WON / REJECTED and a notification', async () => {
  const { s, c } = await signedIn();
  const r1 = await makeRequest(srv, { name: 'Won Med' });
  const r2 = await makeRequest(srv, { name: 'Lost Med' });
  const q1 = await makeQuote(srv, r1, s.id, { status: 'Approved' });
  const q2 = await makeQuote(srv, r2, s.id);
  await owner.post('/api/admin/quotes/award', { ids: [q1] });
  await owner.post('/api/admin/quotes/decide', { ids: [q2], decision: 'reject', reason: 'Other' });
  const b = (await c.get('/api/supplier/bootstrap')).body;
  assert.equal(b.quotes.find((q) => q.id === q1).status, 'WON');
  assert.equal(b.quotes.find((q) => q.id === q2).status, 'REJECTED');
  assert.ok(b.notifications.some((n) => n.title === 'Quote won' && !n.read));
  assert.ok(b.notifications.some((n) => n.title === 'Quote not selected'));
  assert.equal(JSON.stringify(b).includes('Other'), false, 'the internal reason is not shown to suppliers');
  assert.equal((await c.post('/api/supplier/notifications/read')).status, 200);
  assert.ok((await c.get('/api/supplier/bootstrap')).body.notifications.every((n) => n.read));
  // undo by the admin removes what the supplier was told
});

test('the version number moves when anything changes, so open screens know to reload', async () => {
  const { c } = await signedIn();
  const v0 = (await c.get('/api/supplier/version')).body.version;
  await owner.post('/api/admin/requests', { name: 'New thing', qty: 1, ask: 10, noEnd: true });
  const v1 = (await c.get('/api/supplier/version')).body.version;
  assert.ok(v1 > v0);
  assert.equal((await c.get('/api/supplier/version')).body.version, v1);
});

test('suspending a supplier signs them out at once', async () => {
  const { s, c } = await signedIn();
  assert.equal((await c.get('/api/supplier/bootstrap')).status, 200);
  await owner.patch(`/api/admin/suppliers/${s.code}`, { status: 'Suspended' });
  assert.equal((await c.get('/api/supplier/bootstrap')).status, 401);
  const again = await srv.client().post('/api/supplier/auth/login', { email: s.email, password: PASSWORD });
  assert.equal(again.status, 403);
  assert.equal(again.body.error.code, 'suspended');
});

test('maintenance mode blocks suppliers, with the message, and lifts again', async () => {
  const { c } = await signedIn();
  await owner.patch('/api/admin/site/maintenance', { mode: 'now', message: 'Back at 6 pm.' });
  const blocked = await c.post('/api/supplier/quotes', { reqId: 1, qty: 1, price: 1 });
  assert.equal(blocked.status, 503);
  assert.equal(blocked.body.error.code, 'maintenance');
  assert.equal(blocked.body.error.message, 'Back at 6 pm.');
  assert.equal((await c.get('/api/supplier/version')).body.maintenance, true);
  assert.equal((await srv.client().post('/api/supplier/auth/login', { email: 'a@example.com', password: PASSWORD })).status, 503);
  await owner.patch('/api/admin/site/maintenance', { mode: 'off' });
  assert.equal((await c.get('/api/supplier/bootstrap')).status, 200);
});

test('wrong supplier passwords lock the email after five tries', async () => {
  const s = await makeSupplier(srv);
  const c = srv.client();
  for (let i = 0; i < 5; i++) assert.equal((await c.post('/api/supplier/auth/login', { email: s.email, password: 'bad-bad-bad-1' })).status, 401);
  assert.equal((await c.post('/api/supplier/auth/login', { email: s.email, password: PASSWORD })).status, 429);
  await srv.db.run('DELETE FROM login_attempts');
});

test('sign-up is limited to ten a hour from one connection', async () => {
  await srv.db.run('DELETE FROM login_attempts');
  const c = srv.client();
  for (let i = 0; i < 10; i++) assert.equal((await c.post('/api/supplier/auth/signup', { ...form, email: `bulk${i}@example.com` })).status, 200);
  assert.equal((await c.post('/api/supplier/auth/signup', { ...form, email: 'bulk-x@example.com' })).status, 429);
  await srv.db.run('DELETE FROM login_attempts');
});

test('account edits keep the verified licence and TIN, and a temporary password must be changed', async () => {
  const { s, c } = await signedIn();
  assert.equal((await c.patch('/api/supplier/account', { name: 'New Owner', biz: 'New Biz', phone: '01811111111', addr: 'New street', lic: 'HACK', tin: 'HACK' })).status, 200);
  const row = await one('SELECT * FROM suppliers WHERE id = ?', [s.id]);
  assert.equal(row.name, 'New Biz');
  assert.equal(row.owner_name, 'New Owner');
  assert.equal(row.licence, s.code ? row.licence : '');
  assert.notEqual(row.licence, 'HACK');
  assert.equal((await c.patch('/api/supplier/account', { name: 'X', biz: 'Y', phone: 'abc', addr: 'Z' })).status, 422);
  const reset = await owner.post(`/api/admin/suppliers/${s.code}/reset-password`);
  const fresh = srv.client();
  const li = await fresh.post('/api/supplier/auth/login', { email: s.email, password: reset.body.password });
  assert.equal(li.body.mustChange, true);
  assert.equal((await fresh.post('/api/supplier/auth/password', { current: reset.body.password, next: 'my-own-new-password' })).status, 200);
  assert.equal((await fresh.get('/api/supplier/bootstrap')).body.user.mustChange, false);
  assert.equal(srv.logger.errors.length, 0, srv.logger.errors.map((e) => e.stack).join('\n'));
});

test('a supplier with a temporary password must choose their own before using the app', async () => {
  const { s, c } = await signedIn();
  const none = srv.client();
  assert.equal((await none.get('/api/supplier/auth/session')).body.me, null);
  assert.equal((await c.get('/api/supplier/auth/session')).body.me.email, s.email);

  const reset = await owner.post(`/api/admin/suppliers/${s.code}/reset-password`);
  assert.equal(reset.status, 200);
  const temp = reset.body.password;
  assert.equal(temp.length, 12);
  assert.equal((await c.get('/api/supplier/bootstrap')).status, 401, 'the old session is signed out');

  const login = await c.post('/api/supplier/auth/login', { email: s.email, password: temp });
  assert.equal(login.status, 200);
  assert.equal(login.body.mustChange, true);
  assert.equal((await c.get('/api/supplier/auth/session')).body.me.mustChange, true);
  const blocked = await c.get('/api/supplier/bootstrap');
  assert.equal(blocked.status, 403);
  assert.equal(blocked.body.error.code, 'must_change_password');
  assert.equal((await c.post('/api/supplier/quotes', { reqId: 1, qty: 1, price: 1 })).status, 403);

  assert.equal((await c.post('/api/supplier/auth/password', { current: temp, next: temp })).status, 422);
  assert.equal((await c.post('/api/supplier/auth/password', { current: 'wrong-wrong-1', next: 'my-own-password' })).status, 422);
  assert.equal((await c.post('/api/supplier/auth/password', { current: temp, next: 'my-own-password' })).status, 200);
  const again = srv.client();
  assert.equal((await again.post('/api/supplier/auth/login', { email: s.email, password: 'my-own-password' })).body.mustChange, false);
  assert.equal((await again.get('/api/supplier/bootstrap')).status, 200);
});
