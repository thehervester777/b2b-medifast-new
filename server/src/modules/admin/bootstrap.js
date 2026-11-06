'use strict';
const express = require('express');
const shape = require('../shape');
const { loadSite } = require('../../rules/site');
const { version } = require('../../rules/audit');
const { expireRequests } = require('../../rules/sweep');
const { ALL_PERMS } = require('../../rules/perms');

const LOG_LIMIT = 600;

function bootstrap({ db }) {
  const r = express.Router();

  r.get('/version', async (req, res) => {
    res.json({ version: await version(db) });
  });

  /** Everything the panel shows, limited to what this role may see. Lists are loaded in bulk. */
  r.get('/bootstrap', async (req, res) => {
    await expireRequests(db);
    const can = (...p) => p.some((k) => req.admin.perms.has(k));
    const empty = Promise.resolve([]);
    const seeQuotes = can('quotes.view', 'requests.view', 'orders.view');
    const [reqs, sups, quotes, orders, hist, products, team, roles, log, site, ver] = await Promise.all([
      db.all('SELECT * FROM requests ORDER BY posted_at DESC, id DESC'),
      db.all('SELECT * FROM suppliers ORDER BY joined_at DESC, id DESC'),
      seeQuotes ? db.all('SELECT q.*, s.code AS supplier_code FROM quotes q JOIN suppliers s ON s.id = q.supplier_id ORDER BY q.submitted_at DESC, q.id DESC') : empty,
      can('orders.view') ? db.all('SELECT o.*, s.code AS supplier_code FROM orders o JOIN suppliers s ON s.id = o.supplier_id ORDER BY o.created_at DESC, o.id DESC') : empty,
      can('orders.view') ? db.all('SELECT * FROM order_history ORDER BY at, id') : empty,
      can('products.view', 'dashboard.view') ? db.all('SELECT * FROM products ORDER BY created_at DESC, id DESC') : empty,
      can('access.manage') ? db.all('SELECT a.*, r.name AS role_name FROM admins a JOIN roles r ON r.id = a.role_id ORDER BY a.id') : db.all('SELECT a.*, r.name AS role_name FROM admins a JOIN roles r ON r.id = a.role_id WHERE a.id = ?', [req.admin.id]),
      db.all('SELECT name, permissions FROM roles ORDER BY id'),
      can('audit.view') ? db.all('SELECT * FROM audit_log ORDER BY id DESC LIMIT ?', [LOG_LIMIT]) : empty,
      loadSite(db),
      version(db),
    ]);

    const byOrder = new Map();
    hist.forEach((h) => {
      if (!byOrder.has(h.order_id)) byOrder.set(h.order_id, []);
      byOrder.get(h.order_id).push(h);
    });

    const roleMap = {};
    roles.forEach((row) => {
      if (!can('access.manage') && row.name !== req.admin.role) return;
      roleMap[row.name] = row.name === 'Owner' ? ALL_PERMS : shape.json(row.permissions, []);
    });

    const full = can('suppliers.view', 'suppliers.manage', 'access.manage');
    res.json({
      version: ver,
      me: { id: req.admin.id, name: req.admin.name, email: req.admin.email, role: req.admin.role },
      requests: reqs.map(shape.request),
      suppliers: full ? sups.map(shape.supplier) : sups.map((s) => ({ id: s.code, name: s.name, city: s.city, status: s.status })),
      quotes: quotes.map(shape.quote),
      orders: orders.map((o) => shape.order(o, byOrder.get(o.id) || [])),
      products: products.map(shape.product),
      team: team.map(shape.member),
      roles: roleMap,
      activity: log.map(shape.activity),
      settings: site.settings,
      site: { notice: site.notice, maintenance: site.maintenance },
    });
  });

  return r;
}
module.exports = { bootstrap };
