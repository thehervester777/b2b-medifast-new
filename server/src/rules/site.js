'use strict';
const { json } = require('../modules/shape');

const DEFAULT_SETTINGS = { requireReason: true, flagLowPrice: true, lowPricePct: 25, reviewHours: 48, leadDays: 4, rejectOthersOnAward: true, notifyPending: true, notifyDigest: false, notifySuppliers: false };
const DEFAULT_NOTICE = { on: false, tone: 'info', title: '', body: '', audience: 'suppliers', dismissible: true, scheduled: false, startAt: null, endAt: null };
const DEFAULT_MAINTENANCE = { mode: 'off', message: '', startAt: null, endAt: null };

async function loadSite(c) {
  const rows = await c.all('SELECT name, value FROM site_settings');
  const by = Object.fromEntries(rows.map((r) => [r.name, r.value]));
  return {
    settings: { ...DEFAULT_SETTINGS, ...json(by.settings, {}) },
    notice: { ...DEFAULT_NOTICE, ...json(by.notice, {}) },
    maintenance: { ...DEFAULT_MAINTENANCE, ...json(by.maintenance, {}) },
  };
}

async function saveSite(c, name, value) {
  await c.run('INSERT INTO site_settings (name, value, updated_at) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value), updated_at = VALUES(updated_at)', [name, JSON.stringify(value), new Date()]);
}

const noticeLive = (n, now = Date.now()) => {
  if (!n.on) return false;
  if (!n.scheduled) return true;
  return (!n.startAt || now >= n.startAt) && (!n.endAt || now <= n.endAt);
};
const maintenanceLive = (m, now = Date.now()) => {
  if (m.mode === 'now') return true;
  if (m.mode === 'scheduled') return !!m.startAt && now >= m.startAt && (!m.endAt || now <= m.endAt);
  return false;
};

module.exports = { loadSite, saveSite, noticeLive, maintenanceLive, DEFAULT_SETTINGS };
