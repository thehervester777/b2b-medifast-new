import { state } from '../core/store.js';
import { act } from './act.js';
import { plural } from '../core/format.js';
import { ymd } from '../core/range.js';
import { orderCode, orderTotal, lateOrderCount, openOrderCount, supplierOf } from './orders.js';
import { needsRestock, level } from './catalog.js';

const DAY = 86_400_000;
const HOUR = 3_600_000;
const round2 = (n) => Math.round(n * 100) / 100;

/* ============================== lookups ============================== */
export const reqById = (id) => state.requests.find((r) => r.id === Number(id));
export const supById = (id) => state.suppliers.find((s) => s.id === id);
export const quoteById = (id) => state.quotes.find((q) => q.id === Number(id));
export const quotesOf = (reqId) => state.quotes.filter((q) => q.reqId === reqId);
export const reqCode = (r) => 'RQ-' + r.id;
export const quoteCode = (q) => 'QT-' + q.id;
export const quoteTotal = (q) => round2(q.price * q.qty);

/* ============================== rule checks ============================== */
/**
 * What an admin should look at before approving a quote. "red" flags break a rule
 * (the supplier app blocks these, but old clients and manual entries can still send them);
 * "info" flags are worth a second look.
 */
export function flagsOf(q) {
  const r = reqById(q.reqId);
  const s = supById(q.supplierId);
  const out = [];
  if (!r) return out;
  if (q.price > r.ask) out.push({ code: 'price', tone: 'red', label: 'Above asking price', detail: `Quoted ${q.price}, asking ${r.ask}.` });
  if (q.qty > r.qty) out.push({ code: 'qty', tone: 'red', label: 'Above requested quantity', detail: `Quoted ${q.qty} boxes, requested ${r.qty}.` });
  if (s && s.status === 'Suspended') out.push({ code: 'sup', tone: 'red', label: 'Supplier suspended', detail: `${s.name} is suspended.` });
  if (state.settings.flagLowPrice && q.price < r.ask * (1 - state.settings.lowPricePct / 100)) {
    out.push({ code: 'low', tone: 'info', label: 'Unusually low price', detail: `More than ${state.settings.lowPricePct}% below the asking price.` });
  }
  return out;
}
export const hasBreach = (q) => flagsOf(q).some((f) => f.tone === 'red');
export const isOverdue = (q) => q.status === 'Pending' && Date.now() - q.at > state.settings.reviewHours * HOUR;

/** How far a quote sits from the asking price, in percent (negative = cheaper). */
export const priceDelta = (q) => {
  const r = reqById(q.reqId);
  return r ? ((q.price - r.ask) / r.ask) * 100 : 0;
};

/* ============================== numbers for the dashboard ============================== */
export function stats(now = Date.now()) {
  const { requests, quotes, suppliers } = state;
  const active = requests.filter((r) => r.status === 'Active');
  const pending = quotes.filter((q) => q.status === 'Pending');
  const oldest = pending.length ? Math.min(...pending.map((q) => q.at)) : null;
  const awarded = quotes.filter((q) => q.status === 'Awarded' && now - (q.decidedAt || q.at) < 30 * DAY);
  return {
    active: active.length,
    activeNoQuotes: active.filter((r) => !quotes.some((q) => q.reqId === r.id)).length,
    newRequests7: requests.filter((r) => now - r.postedAt < 7 * DAY).length,
    pending: pending.length,
    pendingFlagged: pending.filter(hasBreach).length,
    pendingOverdue: pending.filter(isOverdue).length,
    oldestPending: oldest,
    verified: suppliers.filter((s) => s.status === 'Verified').length,
    awaiting: suppliers.filter((s) => s.status === 'Pending').length,
    awardedValue: awarded.reduce((sum, q) => sum + quoteTotal(q), 0),
    awardedCount: awarded.length,
    openOrders: openOrderCount(),
    lateOrders: lateOrderCount(now),
    restock: needsRestock().length,
    reqByStatus: {
      Active: active.length,
      Completed: requests.filter((r) => r.status === 'Completed').length,
      Expired: requests.filter((r) => r.status === 'Expired').length,
    },
  };
}

/** Quotes received and requests posted per day, oldest first. */
export function series(days = 14, now = Date.now()) {
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
  const labels = [];
  const quotes = [];
  const requests = [];
  for (let i = days - 1; i >= 0; i--) {
    const to = end.getTime() - i * DAY;
    const from = to - DAY;
    labels.push(new Date(to - 12 * HOUR));
    quotes.push(state.quotes.filter((q) => q.at > from && q.at <= to).length);
    requests.push(state.requests.filter((r) => r.postedAt > from && r.postedAt <= to).length);
  }
  return { labels, quotes, requests };
}

export function closingSoon(limit = 5, now = Date.now()) {
  return state.requests
    .filter((r) => r.status === 'Active' && r.deadlineAt && r.deadlineAt > now)
    .sort((a, b) => a.deadlineAt - b.deadlineAt)
    .slice(0, limit);
}

/** Things that need a person, for the bell. */
export function alerts(now = Date.now()) {
  const s = stats(now);
  const out = [];
  if (s.pendingOverdue) out.push({ id: 'overdue', icon: 'clock', tone: 'red', title: `${plural(s.pendingOverdue, 'quote')} waiting past the ${state.settings.reviewHours}-hour limit`, go: 'requests', filter: 'To review' });
  if (s.pendingFlagged) out.push({ id: 'flagged', icon: 'flag', tone: 'red', title: `${plural(s.pendingFlagged, 'pending quote')} broke a rule`, go: 'requests', filter: 'To review' });
  if (s.lateOrders) out.push({ id: 'late', icon: 'truck', tone: 'red', title: `${plural(s.lateOrders, 'order')} past the expected delivery date`, go: 'orders', filter: 'All' });
  if (s.awaiting) out.push({ id: 'suppliers', icon: 'shield', tone: 'blue', title: `${plural(s.awaiting, 'supplier')} waiting for verification`, go: 'suppliers', filter: 'Pending' });
  if (s.restock) out.push({ id: 'restock', icon: 'box', tone: 'blue', title: `${plural(s.restock, 'product')} at 5 boxes or fewer, not yet sent to suppliers`, go: 'products', filter: '5' });
  const soon = closingSoon(20, now).filter((r) => r.deadlineAt - now < 2 * DAY);
  if (soon.length) out.push({ id: 'closing', icon: 'timer', tone: 'blue', title: `${plural(soon.length, 'request')} closing within 2 days`, go: 'requests', filter: 'Active' });
  if (s.activeNoQuotes) out.push({ id: 'noquotes', icon: 'info', tone: 'blue', title: `${plural(s.activeNoQuotes, 'active request')} still without a quote`, go: 'requests', filter: 'Active' });
  return out;
}

/* ============================== actions (each asks the server; they return { undo, ... } or null) ============================== */
const quoteJob = (path, body) => act('post', path, body);

export const approveQuote = (id) => act('post', '/admin/quotes/decide', { ids: [Number(id)], decision: 'approve' });

export const rejectQuote = (id, reason = 'Other', note = '') => act('post', '/admin/quotes/decide', { ids: [Number(id)], decision: 'reject', reason, note });

/** Award a quote: the request is completed, the other open quotes are turned down, and an order is created. */
export const awardQuote = (id) => quoteJob('/admin/quotes/award', { ids: [Number(id)] });

/** Award many approved quotes at once. When two are for the same request, only the cheaper one is awarded. Returns { undo, n } or null. */
export async function awardMany(ids) {
  const res = await quoteJob('/admin/quotes/award', { ids: ids.map(Number) });
  return res && { ...res, n: res.awarded.length };
}

export const decideMany = (ids, decision, reason = 'Other') => act('post', '/admin/quotes/decide', { ids: ids.map(Number), decision, reason });

/** data: { name, generic, co, qty, ask, noEnd, deadlineAt, note }. Returns { id, undo } or null. */
export const saveRequest = (data, id = null) => (id ? act('patch', `/admin/requests/${Number(id)}`, data) : act('post', '/admin/requests', data));

/** Stop a request early. Quotes still waiting are turned down. */
export const closeRequest = (id) => act('post', `/admin/requests/${Number(id)}/close`);
export const reopenRequest = (id) => act('post', `/admin/requests/${Number(id)}/reopen`);
export const deleteRequest = (id) => act('del', `/admin/requests/${Number(id)}`);

export const setSupplierStatus = (id, status) => act('patch', `/admin/suppliers/${encodeURIComponent(id)}`, { status });

/** Set a temporary password the supplier must change at their next sign-in. Returns { password } or null. */
export const resetSupplierPassword = (id) => act('post', `/admin/suppliers/${encodeURIComponent(id)}/reset-password`);

export const updateSetting = (key, value) => act('patch', '/admin/settings', { key, value });

/* ============================== CSV ============================== */
const cell = (v) => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};
const csv = (rows) => '﻿' + rows.map((r) => r.map(cell).join(',')).join('\r\n');
const iso = (t) => (t ? `${ymd(t)} ${String(new Date(t).getHours()).padStart(2, '0')}:${String(new Date(t).getMinutes()).padStart(2, '0')}` : '');

export function quotesCsv(list) {
  return csv([
    ['Quote', 'Request', 'Medicine', 'Company', 'Supplier', 'Supplier ID', 'Boxes', 'Price per box (BDT)', 'Asking price (BDT)', 'Total (BDT)', 'Status', 'Flags', 'Submitted', 'Decided', 'Decided by', 'Reason'],
    ...list.map((q) => {
      const r = reqById(q.reqId) || {};
      const s = supById(q.supplierId) || {};
      return [quoteCode(q), 'RQ-' + q.reqId, r.name, r.co, s.name, q.supplierId, q.qty, q.price, r.ask, quoteTotal(q), q.status, flagsOf(q).map((f) => f.label).join('; '), iso(q.at), iso(q.decidedAt), q.by || '', q.reason || ''];
    }),
  ]);
}

export function requestsCsv(list) {
  return csv([
    ['Request', 'Medicine', 'Generic', 'Company', 'Boxes', 'Asking price (BDT)', 'Status', 'Quotes', 'Posted', 'Closes'],
    ...list.map((r) => [reqCode(r), r.name, r.generic, r.co, r.qty, r.ask, r.status, quotesOf(r.id).length, iso(r.postedAt), r.noEnd ? 'No end date' : iso(r.deadlineAt)]),
  ]);
}

export function activityCsv(list) {
  const role = (a) => (state.team.find((t) => t.id === a.byId) || {}).role || '';
  return csv([['When', 'Who', 'Role', 'Type', 'What', 'IP address', 'Device'], ...list.map((a) => [iso(a.at), a.by, role(a), a.type, a.text, a.ip || '', a.device || ''])]);
}

export function ordersCsv(list) {
  return csv([
    ['Order', 'Invoice', 'Medicine', 'Company', 'Supplier', 'Supplier ID', 'Boxes', 'Price per box (BDT)', 'Total (BDT)', 'Status', 'Ordered', 'Expected', 'Delivered', 'Quote', 'Request'],
    ...list.map((o) => {
      const s = supplierOf(o) || {};
      return [orderCode(o), 'INV-' + o.id, o.name, o.co, s.name || '', o.supplierId, o.qty, o.price, orderTotal(o), o.status, iso(o.createdAt), iso(o.expectedAt), iso(o.deliveredAt), 'QT-' + o.quoteId, 'RQ-' + o.reqId];
    }),
  ]);
}

export function suppliersCsv(list) {
  return csv([
    ['Supplier ID', 'Name', 'Owner', 'City', 'Status', 'Phone', 'Email', 'Drug licence', 'TIN', 'Joined', 'Quotes', 'Awarded', 'Orders', 'Spend (BDT)'],
    ...list.map((s) => {
      const qs = state.quotes.filter((q) => q.supplierId === s.id);
      const os = state.orders.filter((o) => o.supplierId === s.id && o.status !== 'Cancelled');
      return [s.id, s.name, s.owner, s.city, s.status, s.phone, s.email, s.lic, s.tin, iso(s.joinedAt), qs.length, qs.filter((q) => q.status === 'Awarded').length, os.length, round2(os.reduce((n, o) => n + o.price * o.qty, 0))];
    }),
  ]);
}

export function productsCsv(list) {
  return csv([
    ['Product ID', 'Name', 'Generic', 'Company', 'Boxes in stock', 'Stock level', 'Reorder level', 'Buy price (BDT)', 'Sale price (BDT)', 'Status', 'Last sent to suppliers'],
    ...list.map((p) => [p.code, p.name, p.generic, p.brand, p.stock, level(p), p.reorder, p.buy, p.sale, p.status, iso(p.lastSentAt)]),
  ]);
}
