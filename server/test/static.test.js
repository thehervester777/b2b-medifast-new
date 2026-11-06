'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { start } = require('./helpers');

function fakeApps() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mf-apps-'));
  for (const [app, title] of [['admin', 'ADMIN PAGE'], ['supplier', 'SUPPLIER PAGE']]) {
    fs.mkdirSync(path.join(dir, app, 'dist', 'assets'), { recursive: true });
    fs.writeFileSync(path.join(dir, app, 'dist', 'index.html'), `<!doctype html><title>${title}</title>`);
    fs.writeFileSync(path.join(dir, app, 'dist', 'assets', 'x-123.js'), 'console.log(1)');
  }
  return dir;
}

test('static apps: supplier app at /, admin app at /admin/', async (t) => {
  const apps = fakeApps();
  const s = await start({ APPS_DIR: apps });
  t.after(async () => {
    await s.close();
    fs.rmSync(apps, { recursive: true, force: true });
  });
  const get = (u) => fetch(s.base + u, { redirect: 'manual' });

  let r = await get('/admin');
  assert.equal(r.status, 301);
  assert.equal(r.headers.get('location'), '/admin/');

  r = await get('/admin/');
  assert.equal(r.status, 200);
  assert.match(await r.text(), /ADMIN PAGE/);
  assert.equal(r.headers.get('cache-control'), 'no-cache');

  r = await get('/');
  assert.equal(r.status, 200);
  assert.match(await r.text(), /SUPPLIER PAGE/);

  r = await get('/admin/assets/x-123.js');
  assert.match(r.headers.get('cache-control'), /immutable/);
  r = await get('/assets/x-123.js');
  assert.equal(r.status, 200);

  r = await fetch(s.base + '/api/nope', { headers: { accept: 'application/json' } });
  assert.equal(r.status, 404);
  assert.equal((await r.json()).error.code, 'not_found');

  r = await get('/api/health');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-security-policy'), /script-src 'self'/);
  assert.equal(r.headers.get('x-powered-by'), null);
});
