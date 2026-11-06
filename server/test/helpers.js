'use strict';
/*
 * Test helpers. The tests need a real MySQL or MariaDB (set TEST_DB_HOST, TEST_DB_PORT, TEST_DB_USER,
 * TEST_DB_PASSWORD, TEST_DB_NAME; the default is root without a password on 127.0.0.1:3306, database
 * "medifast_test"). The database is emptied and rebuilt from database/schema.sql, so never point it at real data.
 */
const fs = require('node:fs');
const path = require('node:path');
const mysql = require('mysql2/promise');
const { createDb } = require('../src/db');
const { createApp } = require('../src/http/app');
const { load } = require('../src/config');
const { makeHasher } = require('../src/lib/security');

const env = process.env;
const T = {
  host: env.TEST_DB_HOST || '127.0.0.1',
  port: Number(env.TEST_DB_PORT) || 3306,
  user: env.TEST_DB_USER || 'root',
  password: env.TEST_DB_PASSWORD || '',
  database: env.TEST_DB_NAME || 'medifast_test',
};
if (!/test/i.test(T.database)) throw new Error('Refusing to run tests on a database whose name does not contain "test".');

const SCHEMA = fs.readFileSync(path.join(__dirname, '..', '..', 'database', 'schema.sql'), 'utf8');
const statements = SCHEMA.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n').split(/;\s*\n/).map((s) => s.trim()).filter(Boolean);

async function resetDatabase() {
  const root = await mysql.createConnection({ host: T.host, port: T.port, user: T.user, password: T.password });
  await root.query(`DROP DATABASE IF EXISTS \`${T.database}\``);
  await root.query(`CREATE DATABASE \`${T.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await root.query(`USE \`${T.database}\``);
  for (const s of statements) await root.query(s);
  await root.end();
}

const config = (extra = {}) =>
  load({ DB_HOST: T.host, DB_PORT: String(T.port), DB_NAME: T.database, DB_USER: T.user, DB_PASSWORD: T.password, NODE_ENV: 'test', APP_URL: 'http://localhost', BCRYPT_COST: '4', ...extra });

const hasher = makeHasher(4);

/** A running app on a random port, with the database rebuilt. */
async function start(extra) {
  await resetDatabase();
  const cfg = config(extra);
  const db = createDb(cfg.db);
  const logger = { errors: [], error(e) { this.errors.push(e); } };
  const app = createApp({ db, cfg, logger });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    base,
    db,
    cfg,
    logger,
    client: () => client(base),
    async close() {
      await new Promise((r) => server.close(r));
      await db.close();
    },
  };
}

/** Tiny HTTP client with its own cookie jar. */
function client(base) {
  const jar = new Map();
  const api = async (method, url, body, headers = {}) => {
    const cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
    const res = await fetch(base + url, {
      method,
      redirect: 'manual',
      headers: { 'content-type': 'application/json', ...(method !== 'GET' ? { 'x-mf': '1' } : {}), ...(cookie ? { cookie } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    for (const sc of res.headers.getSetCookie()) {
      const [pair] = sc.split(';');
      const i = pair.indexOf('=');
      const name = pair.slice(0, i);
      const val = pair.slice(i + 1);
      if (/Max-Age=0/i.test(sc) || val === '') jar.delete(name);
      else jar.set(name, val);
    }
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch (e) {
      /* not JSON */
    }
    return { status: res.status, body: json, text, headers: res.headers, setCookie: res.headers.getSetCookie() };
  };
  return {
    jar,
    get: (u, h) => api('GET', u, undefined, h),
    post: (u, b = {}, h) => api('POST', u, b, h),
    patch: (u, b = {}, h) => api('PATCH', u, b, h),
    put: (u, b = {}, h) => api('PUT', u, b, h),
    del: (u, h) => api('DELETE', u, undefined, h),
  };
}

const PASSWORD = 'correct-horse-battery';

/** Create the Owner through /setup and sign in. Returns the signed-in client. */
async function ownerClient(srv) {
  const c = srv.client();
  const r = await c.post('/api/setup', { name: 'Nusrat Jahan', email: 'owner@example.com', password: PASSWORD });
  if (r.status !== 200) throw new Error('setup failed: ' + r.text);
  const l = await c.post('/api/admin/auth/login', { email: 'owner@example.com', password: PASSWORD });
  if (l.status !== 200) throw new Error('login failed: ' + l.text);
  return c;
}

/** Add an admin with a role directly in the database and sign in as them. */
async function adminWithRole(srv, role, email = `${role.toLowerCase()}@example.com`) {
  const r = await srv.db.one('SELECT id FROM roles WHERE name = ?', [role]);
  await srv.db.run('INSERT INTO admins (name, email, password_hash, role_id, active, created_at) VALUES (?, ?, ?, ?, 1, ?)', [`${role} Person`, email, await hasher.hash(PASSWORD), r.id, new Date()]);
  const c = srv.client();
  const l = await c.post('/api/admin/auth/login', { email, password: PASSWORD });
  if (l.status !== 200) throw new Error('login failed: ' + l.text);
  return c;
}

let supplierSeq = 0;
/** A verified supplier created straight in the database. */
async function makeSupplier(srv, over = {}) {
  const n = ++supplierSeq;
  const row = {
    name: `Supplier ${n}`,
    owner_name: `Owner ${n}`,
    city: 'Dhaka',
    address: 'Road 1',
    email: `supplier${n}@example.com`,
    phone: '+8801700000000',
    password_hash: await hasher.hash(PASSWORD),
    licence: `LIC${n}`,
    tin: `TIN${n}`,
    status: 'Verified',
    docs: JSON.stringify({ licence: true, tin: true, trade: true }),
    joined_at: new Date(),
    ...over,
  };
  const ins = await srv.db.run('INSERT INTO suppliers SET ?', [row]);
  const code = `PR-${1000 + ins.insertId}`;
  await srv.db.run('UPDATE suppliers SET code = ? WHERE id = ?', [code, ins.insertId]);
  return { id: ins.insertId, code, email: row.email, password: PASSWORD, name: row.name };
}

async function makeRequest(srv, over = {}) {
  const row = { name: 'Napril 40 tablet', generic: 'Enalapril', company: 'ACI Limited', qty: 10, ask_price: 100, status: 'Active', no_end: 0, deadline_at: new Date(Date.now() + 5 * 86_400_000), posted_at: new Date(), note: '', ...over };
  const ins = await srv.db.run('INSERT INTO requests SET ?', [row]);
  return ins.insertId;
}

async function makeQuote(srv, requestId, supplierId, over = {}) {
  const row = { request_id: requestId, supplier_id: supplierId, qty: 10, price: 90, status: 'Pending', submitted_at: new Date(), ...over };
  const ins = await srv.db.run('INSERT INTO quotes SET ?', [row]);
  return ins.insertId;
}

module.exports = { start, client, ownerClient, adminWithRole, makeSupplier, makeRequest, makeQuote, PASSWORD, resetDatabase, T };
