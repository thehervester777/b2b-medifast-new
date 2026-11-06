#!/usr/bin/env node
'use strict';
/*
 * Proves the release zip works on a clean machine:  node scripts/verify-release.js release/medifast-cpanel-1.0.0.zip
 *
 * Unzips it into a temp folder, installs production dependencies, creates a fresh database from the zip's own
 * schema.sql, starts the server and walks the first-run path: health, both apps, /setup, owner sign-in, supplier
 * sign-up. Needs a MySQL/MariaDB server you may create a scratch database on:
 *   VERIFY_DB_HOST (127.0.0.1)  VERIFY_DB_PORT (3306)  VERIFY_DB_USER (root)  VERIFY_DB_PASSWORD ("")
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, execSync } = require('node:child_process');
const { unzipSync } = require('fflate');

const zipPath = path.resolve(process.argv[2] || '');
if (!zipPath || !fs.existsSync(zipPath)) {
  console.error('Usage: node scripts/verify-release.js <release zip>');
  process.exit(2);
}
const dbCfg = {
  host: process.env.VERIFY_DB_HOST || '127.0.0.1',
  port: Number(process.env.VERIFY_DB_PORT || 3306),
  user: process.env.VERIFY_DB_USER || 'root',
  password: process.env.VERIFY_DB_PASSWORD || '',
};
const DB_NAME = 'medifast_release_check';
const PORT = 3190;
let failures = 0;
const check = (name, cond, extra = '') => {
  if (!cond) failures++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
};

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'medifast-release-'));
  console.log('Unzipping to', dir);
  const entries = unzipSync(new Uint8Array(fs.readFileSync(zipPath)));
  for (const [name, data] of Object.entries(entries)) {
    if (name.endsWith('/')) continue;
    const dest = path.join(dir, name);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, data);
  }
  check('zip has no node_modules, tests or .env', !Object.keys(entries).some((n) => /node_modules|\/test\/|(^|\/)\.env$/.test(n)));
  for (const need of ['server/app.js', 'package.json', 'database/schema.sql', 'apps/admin/dist/index.html', 'apps/supplier/dist/index.html', '.env.example', 'docs/INSTALL.md', 'docs/BACKUP.md', 'README.md']) {
    check(`zip contains ${need}`, !!entries[need]);
  }

  console.log('Installing production dependencies (npm install --omit=dev)...');
  execSync('npm install --omit=dev --no-audit --no-fund --silent', { cwd: dir, stdio: 'inherit' });

  const mysql = require(path.join(dir, 'node_modules', 'mysql2', 'promise'));
  const admin = await mysql.createConnection({ ...dbCfg, multipleStatements: true });
  await admin.query(`DROP DATABASE IF EXISTS \`${DB_NAME}\`; CREATE DATABASE \`${DB_NAME}\` CHARACTER SET utf8mb4;`);
  await admin.query(`USE \`${DB_NAME}\`;`);
  await admin.query(fs.readFileSync(path.join(dir, 'database', 'schema.sql'), 'utf8'));

  const base0 = `http://127.0.0.1:${PORT}`;
  const child = spawn('node', ['server/app.js'], {
    cwd: dir,
    env: { PATH: process.env.PATH, NODE_ENV: 'production', PORT: String(PORT), APP_URL: base0, TRUST_PROXY: '1', DB_HOST: dbCfg.host, DB_PORT: String(dbCfg.port), DB_NAME, DB_USER: dbCfg.user, DB_PASSWORD: dbCfg.password },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', (d) => (log += d));
  child.stderr.on('data', (d) => (log += d));
  const base = `http://127.0.0.1:${PORT}`;
  try {
    for (let i = 0; i < 40; i++) {
      try {
        if ((await fetch(base + '/api/health')).ok) break;
      } catch (e) {
        /* not up yet */
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    const jar = new Map();
    const call = async (method, url, body) => {
      const res = await fetch(base + url, {
        method,
        redirect: 'manual',
        headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(method !== 'GET' ? { 'X-MF': '1' } : {}), Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') },
        body: body ? JSON.stringify(body) : undefined,
      });
      (res.headers.getSetCookie ? res.headers.getSetCookie() : []).forEach((c) => {
        const [kv] = c.split(';');
        const i = kv.indexOf('=');
        jar.set(kv.slice(0, i), kv.slice(i + 1));
      });
      let json = null;
      try {
        json = await res.clone().json();
      } catch (e) {}
      return { status: res.status, json, res };
    };

    const health = await call('GET', '/api/health');
    check('health says the database is reachable', health.json && health.json.database === true);
    check('supplier app is served at /', (await (await call('GET', '/')).res.text()).includes('MediFast Supplier'));
    const adminPage = await call('GET', '/admin/');
    check('admin panel is served at /admin/', adminPage.status === 200 && (await adminPage.res.text()).includes('MediFast Admin'));
    check('/admin redirects to /admin/', (await call('GET', '/admin')).status === 301);
    const setup0 = await call('GET', '/api/setup/status');
    check('fresh install offers first-run setup', setup0.json && setup0.json.open === true);
    check('no accounts exist before setup', (await admin.query('SELECT COUNT(*) AS n FROM admins'))[0][0].n === 0 && (await admin.query('SELECT COUNT(*) AS n FROM suppliers'))[0][0].n === 0);
    const made = await call('POST', '/api/setup', { name: 'Release Check', email: 'owner@release.test', password: 'release-check-pass' });
    check('owner created through /setup', made.status === 200 || made.status === 201, String(made.status));
    check('setup closes afterwards', (await call('GET', '/api/setup/status')).json.open === false);
    check('/setup page is gone once the Owner exists', (await call('GET', '/setup')).status === 404);
    check('second /setup is refused', (await call('POST', '/api/setup', { name: 'Again', email: 'x@release.test', password: 'another-pass-123' })).status >= 400);
    const login = await call('POST', '/api/admin/auth/login', { email: 'owner@release.test', password: 'release-check-pass' });
    check('owner can sign in', login.status === 200);
    const boot = await call('GET', '/api/admin/bootstrap');
    check('admin data loads, and starts empty', boot.status === 200 && boot.json.suppliers.length === 0 && boot.json.requests.length === 0 && boot.json.products.length === 0);
    const signup = await call('POST', '/api/supplier/auth/signup', { biz: 'Release Pharma', owner: 'R Check', addr: '1 Test Road, Dhaka', city: 'Dhaka', lic: 'DL-000001', tin: '123456789', email: 'sup@release.test', phone: '01711111111', password: 'supplier-pass-1' });
    check('supplier can sign up (waits for approval)', signup.status === 200 || signup.status === 201, String(signup.status));
  } finally {
    child.kill();
    await admin.query(`DROP DATABASE IF EXISTS \`${DB_NAME}\``).catch(() => {});
    await admin.end().catch(() => {});
    fs.rmSync(dir, { recursive: true, force: true });
  }
  if (failures) console.log('\nServer log:\n' + log);
  console.log(failures ? `\n${failures} check(s) failed.` : '\nRelease check passed.');
  process.exit(failures ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(2);
});
