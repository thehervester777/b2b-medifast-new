'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { start, ownerClient, adminWithRole, PASSWORD } = require('./helpers');

let srv;
before(async () => {
  srv = await start();
});
after(async () => {
  await srv.close();
});

test('health answers and the schema has no demo accounts', async () => {
  const r = await srv.client().get('/api/health');
  assert.equal(r.status, 200);
  assert.equal(r.body.database, true);
  assert.equal(Number((await srv.db.one('SELECT COUNT(*) AS n FROM admins')).n), 0);
  assert.equal(Number((await srv.db.one('SELECT COUNT(*) AS n FROM suppliers')).n), 0);
  assert.equal(Number((await srv.db.one('SELECT COUNT(*) AS n FROM requests')).n), 0);
});

test('setup page is open while there is no admin, creates the Owner once, then disappears', async () => {
  const c = srv.client();
  assert.equal((await c.get('/setup')).status, 200);
  assert.equal((await c.get('/api/setup/status')).body.open, true);
  const bad = await c.post('/api/setup', { name: 'A', email: 'a@example.com', password: 'short' });
  assert.equal(bad.status, 422);
  const ok = await c.post('/api/setup', { name: 'Nusrat', email: 'Owner@Example.com', password: PASSWORD });
  assert.equal(ok.status, 200);
  assert.equal((await c.post('/api/setup', { name: 'Eve', email: 'eve@example.com', password: PASSWORD })).status, 404);
  assert.equal((await c.get('/setup')).status, 404);
  assert.equal((await c.get('/api/setup/status')).body.open, false);
  const row = await srv.db.one('SELECT email, password_hash FROM admins');
  assert.equal(row.email, 'owner@example.com');
  assert.notEqual(row.password_hash, PASSWORD);
  assert.match(row.password_hash, /^\$2[aby]\$/);
});

test('CSRF: writes without the X-MF header or from another origin are refused', async () => {
  const c = srv.client();
  const noHeader = await fetch(srv.base + '/api/admin/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"email":"owner@example.com","password":"x"}' });
  assert.equal(noHeader.status, 403);
  const cross = await c.post('/api/admin/auth/login', { email: 'owner@example.com', password: PASSWORD }, { origin: 'https://evil.example' });
  assert.equal(cross.status, 403);
  const same = await c.post('/api/admin/auth/login', { email: 'owner@example.com', password: PASSWORD }, { origin: 'http://localhost' });
  assert.equal(same.status, 200);
});

test('sign-in sets a secure-style cookie, stores only a hash, and me/logout work', async () => {
  const c = srv.client();
  const l = await c.post('/api/admin/auth/login', { email: 'owner@example.com', password: PASSWORD });
  assert.equal(l.status, 200);
  const cookie = l.setCookie.find((x) => x.startsWith('mf_admin='));
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
  const token = decodeURIComponent(cookie.split(';')[0].split('=')[1]);
  const rows = await srv.db.all('SELECT token_hash FROM sessions');
  assert.ok(rows.length >= 1);
  assert.ok(rows.every((r) => r.token_hash !== token && r.token_hash.length === 64));
  const me = await c.get('/api/admin/auth/me');
  assert.equal(me.body.me.role, 'Owner');
  assert.equal((await c.get('/api/admin/auth/session')).body.me.email, 'owner@example.com');
  assert.ok(me.body.me.perms.includes('access.manage'));
  assert.equal((await c.post('/api/admin/auth/logout')).status, 200);
  assert.equal((await c.get('/api/admin/auth/me')).status, 401);
  const none = await c.get('/api/admin/auth/session');
  assert.equal(none.status, 200);
  assert.equal(none.body.me, null);
});

test('wrong email and wrong password give the same answer', async () => {
  const c = srv.client();
  const a = await c.post('/api/admin/auth/login', { email: 'nobody@example.com', password: PASSWORD });
  const b = await c.post('/api/admin/auth/login', { email: 'owner@example.com', password: 'wrong-password-1' });
  assert.equal(a.status, 401);
  assert.equal(b.status, 401);
  assert.deepEqual(a.body, b.body);
});

test('five failed sign-ins lock the email, even for the right password', async () => {
  await srv.db.run('DELETE FROM login_attempts');
  const c = srv.client();
  for (let i = 0; i < 5; i++) assert.equal((await c.post('/api/admin/auth/login', { email: 'owner@example.com', password: 'bad-bad-bad-1' })).status, 401);
  const locked = await c.post('/api/admin/auth/login', { email: 'owner@example.com', password: PASSWORD });
  assert.equal(locked.status, 429);
  assert.equal(locked.body.error.code, 'locked');
  await srv.db.run('DELETE FROM login_attempts');
  assert.equal((await c.post('/api/admin/auth/login', { email: 'owner@example.com', password: PASSWORD })).status, 200);
});

test('failed and successful sign-ins are written to the audit log', async () => {
  const rows = await srv.db.all("SELECT text FROM audit_log WHERE type = 'auth'");
  assert.ok(rows.some((r) => /failed to sign in as owner@example.com/.test(r.text)));
  assert.ok(rows.some((r) => r.text === 'signed in'));
});

test('a suspended admin cannot sign in and an existing session stops working', async () => {
  const c = await adminWithRole(srv, 'Reviewer');
  assert.equal((await c.get('/api/admin/bootstrap')).status, 200);
  await srv.db.run("UPDATE admins SET active = 0 WHERE email = 'reviewer@example.com'");
  assert.equal((await c.get('/api/admin/bootstrap')).status, 401);
  const again = await srv.client().post('/api/admin/auth/login', { email: 'reviewer@example.com', password: PASSWORD });
  assert.equal(again.status, 403);
  assert.equal(again.body.error.code, 'suspended');
});

test('a temporary password forces a change before anything else', async () => {
  const owner = await ownerClient2();
  const inv = await owner.post('/api/admin/team', { name: 'Rafi', email: 'rafi@example.com', role: 'Manager' });
  assert.equal(inv.status, 200);
  assert.ok(inv.body.password.length >= 12);
  const c = srv.client();
  assert.equal((await c.post('/api/admin/auth/login', { email: 'rafi@example.com', password: inv.body.password })).body.mustChange, true);
  const blocked = await c.get('/api/admin/bootstrap');
  assert.equal(blocked.status, 403);
  assert.equal(blocked.body.error.code, 'must_change_password');
  assert.equal((await c.post('/api/admin/auth/password', { current: inv.body.password, next: 'short' })).status, 422);
  assert.equal((await c.post('/api/admin/auth/password', { current: 'nope-nope-nope', next: 'a-brand-new-password' })).status, 422);
  assert.equal((await c.post('/api/admin/auth/password', { current: inv.body.password, next: 'a-brand-new-password' })).status, 200);
  assert.equal((await c.get('/api/admin/bootstrap')).status, 200);
});

async function ownerClient2() {
  const c = srv.client();
  await c.post('/api/admin/auth/login', { email: 'owner@example.com', password: PASSWORD });
  return c;
}

test('security headers are present and nothing leaks the framework', async () => {
  const r = await srv.client().get('/api/health');
  assert.match(r.headers.get('content-security-policy'), /default-src 'self'/);
  assert.match(r.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.equal(r.headers.get('x-powered-by'), null);
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(r.headers.get('cache-control'), 'no-store');
});

test('unknown API paths answer 404 JSON and bad JSON answers 400', async () => {
  const c = srv.client();
  const r = await c.get('/api/nothing-here');
  assert.equal(r.status, 404);
  assert.equal(r.body.error.code, 'not_found');
  const bad = await fetch(srv.base + '/api/setup', { method: 'POST', headers: { 'content-type': 'application/json', 'x-mf': '1' }, body: '{oops' });
  assert.equal(bad.status, 400);
});
