import { state } from '../core/store.js';
import { startOfDay, endOfDay, ymd } from '../core/range.js';

/*
 * Report numbers. Every figure is computed here, in one place, from the orders and quotes
 * in the store, and every definition is written out in FORMULAS so the page can show it.
 *
 *   period      the chosen range; "previous" is the same number of days straight before it
 *   order date  an order belongs to the period its createdAt falls in (the day it was awarded)
 *   spend       cancelled orders are left out everywhere
 */
const DAY = 86_400_000;
const HOUR = 3_600_000;

const sum = (arr, f) => arr.reduce((s, x) => s + f(x), 0);
const mean = (arr) => (arr.length ? sum(arr, (x) => x) / arr.length : 0);
const pct = (a, b) => (b ? (a / b) * 100 : 0);
const total = (o) => o.price * o.qty;
const addDays = (t, n) => {
  const d = new Date(t);
  d.setDate(d.getDate() + n);
  return d.getTime();
};

export const FORMULAS = [
  { name: 'Spend', rule: 'Sum of price × boxes over every order created in the period.', note: 'Cancelled orders are not counted.' },
  { name: 'Orders', rule: 'Number of orders created in the period.', note: 'Cancelled orders are not counted.' },
  { name: 'Average order', rule: 'Spend ÷ Orders.', note: '' },
  { name: 'Savings against asking', rule: 'Sum of (asking price − awarded price) × boxes, for the same orders as Spend.', note: 'Shown as a share of what we would have paid at the asking price.' },
  { name: 'On-time delivery', rule: 'Orders delivered on or before their expected date ÷ orders delivered, by delivery date.', note: 'Only orders delivered inside the period are counted.' },
  { name: 'Days to deliver', rule: 'Average of (delivered − created) in days, for orders delivered in the period.', note: '' },
  { name: 'Award rate', rule: 'Quotes awarded ÷ (quotes awarded + quotes rejected), by decision date.', note: 'Rejections made by the system when a request closes are not counted.' },
  { name: 'Time to decision', rule: 'Average of (decided − submitted) in hours, for quotes a person approved, rejected or awarded in the period.', note: '' },
];

/** All figures for one window [a, b]. */
function metrics(a, b) {
  const created = state.orders.filter((o) => o.createdAt >= a && o.createdAt <= b);
  const live = created.filter((o) => o.status !== 'Cancelled');
  const spend = sum(live, total);
  const asked = sum(live, (o) => o.ask * o.qty);
  const delivered = state.orders.filter((o) => o.status === 'Delivered' && o.deliveredAt != null && o.deliveredAt >= a && o.deliveredAt <= b);
  const onTime = delivered.filter((o) => o.deliveredAt <= o.expectedAt).length;
  const received = state.quotes.filter((q) => q.at >= a && q.at <= b);
  const decided = state.quotes.filter((q) => q.decidedAt != null && q.decidedAt >= a && q.decidedAt <= b && q.by && q.by !== 'System');
  const wins = decided.filter((q) => q.status === 'Awarded').length;
  const lost = decided.filter((q) => q.status === 'Rejected').length;
  return {
    created,
    live,
    delivered,
    decided,
    spend,
    orders: live.length,
    cancelled: created.length - live.length,
    avg: live.length ? spend / live.length : 0,
    asked,
    saved: asked - spend,
    savedPct: pct(asked - spend, asked),
    deliveredN: delivered.length,
    onTime,
    onTimePct: pct(onTime, delivered.length),
    days: mean(delivered.map((o) => (o.deliveredAt - o.createdAt) / DAY)),
    quotes: received.length,
    wins,
    lost,
    awardPct: pct(wins, wins + lost),
    decideHours: mean(decided.map((q) => (q.decidedAt - q.at) / HOUR)),
  };
}

const change = (cur, prev) => (prev ? ((cur - prev) / prev) * 100 : null);

/** from / to are timestamps (whole days). Returns everything the Reports page and the dashboard draw. */
export function buildReport({ from, to }) {
  const a = startOfDay(from);
  const b = endOfDay(to);
  const days = Math.round((startOfDay(b) - a) / DAY) + 1;
  const pFrom = addDays(a, -days);
  const pTo = a - 1;
  const cur = metrics(a, b);
  const prev = metrics(pFrom, pTo);

  /* trend: one point per day, or per week once the period is long */
  const chartDays = Math.max(days, 3);
  const chartFrom = days < 3 ? addDays(startOfDay(b), -(chartDays - 1)) : a;
  const step = chartDays > 45 ? 7 : 1;
  const n = Math.ceil(chartDays / step);
  const labels = [];
  const spend = [];
  const before = [];
  for (let i = 0; i < n; i++) {
    const s = addDays(chartFrom, i * step);
    const e = Math.min(addDays(chartFrom, (i + 1) * step) - 1, b);
    const ps = addDays(s, -chartDays);
    const pe = addDays(e, -chartDays);
    labels.push(new Date(s));
    spend.push(Math.round(sum(state.orders.filter((o) => o.status !== 'Cancelled' && o.createdAt >= s && o.createdAt <= e), total)));
    before.push(Math.round(sum(state.orders.filter((o) => o.status !== 'Cancelled' && o.createdAt >= ps && o.createdAt <= pe), total)));
  }

  /* orders by status, all statuses */
  const statusCounts = {};
  cur.created.forEach((o) => (statusCounts[o.status] = (statusCounts[o.status] || 0) + 1));

  /* one row per supplier that quoted or sold in the period */
  const suppliers = state.suppliers
    .map((s) => {
      const live = cur.live.filter((o) => o.supplierId === s.id);
      const dec = cur.decided.filter((q) => q.supplierId === s.id);
      const wins = dec.filter((q) => q.status === 'Awarded').length;
      const lost = dec.filter((q) => q.status === 'Rejected').length;
      const del = cur.delivered.filter((o) => o.supplierId === s.id);
      const spendS = sum(live, total);
      const askedS = sum(live, (o) => o.ask * o.qty);
      return {
        s,
        quotes: state.quotes.filter((q) => q.supplierId === s.id && q.at >= a && q.at <= b).length,
        wins,
        awardPct: pct(wins, wins + lost),
        decided: wins + lost,
        orders: live.length,
        spend: spendS,
        savedPct: pct(askedS - spendS, askedS),
        delivered: del.length,
        onTimePct: pct(del.filter((o) => o.deliveredAt <= o.expectedAt).length, del.length),
      };
    })
    .filter((r) => r.quotes || r.orders)
    .sort((x, y) => y.spend - x.spend || y.quotes - x.quotes);

  /* spend by manufacturer */
  const byCo = new Map();
  cur.live.forEach((o) => byCo.set(o.co, (byCo.get(o.co) || 0) + total(o)));
  const companies = [...byCo.entries()].map(([co, value]) => ({ co, value })).sort((x, y) => y.value - x.value);

  return {
    from: a,
    to: b,
    days,
    prevFrom: pFrom,
    prevTo: pTo,
    cur,
    prev,
    delta: {
      spend: change(cur.spend, prev.spend),
      orders: change(cur.orders, prev.orders),
      avg: change(cur.avg, prev.avg),
      saved: change(cur.saved, prev.saved),
      onTime: prev.deliveredN ? cur.onTimePct - prev.onTimePct : null,
    },
    series: { labels, spend, before, note: days < 3 ? 'Showing the last 3 days' : '' },
    statusCounts,
    suppliers,
    companies,
  };
}

/* ---------- CSV of everything on the Reports page ---------- */
const cell = (v) => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};
const day = (t) => ymd(t);
const r2 = (n) => Math.round(n * 100) / 100;

export function reportCsv(rep) {
  const { cur, prev } = rep;
  const rows = [
    ['MediFast report', `${day(rep.from)} to ${day(rep.to)}`, `compared with ${day(rep.prevFrom)} to ${day(rep.prevTo)}`],
    [],
    ['Figure', 'This period', 'Previous period'],
    ['Spend (BDT)', r2(cur.spend), r2(prev.spend)],
    ['Orders', cur.orders, prev.orders],
    ['Cancelled orders (not counted)', cur.cancelled, prev.cancelled],
    ['Average order (BDT)', r2(cur.avg), r2(prev.avg)],
    ['Saved against asking (BDT)', r2(cur.saved), r2(prev.saved)],
    ['Saved against asking (%)', r2(cur.savedPct), r2(prev.savedPct)],
    ['Delivered orders', cur.deliveredN, prev.deliveredN],
    ['On-time delivery (%)', r2(cur.onTimePct), r2(prev.onTimePct)],
    ['Days to deliver (average)', r2(cur.days), r2(prev.days)],
    ['Quotes received', cur.quotes, prev.quotes],
    ['Quotes awarded', cur.wins, prev.wins],
    ['Quotes rejected by a person', cur.lost, prev.lost],
    ['Award rate (%)', r2(cur.awardPct), r2(prev.awardPct)],
    ['Time to decision (hours, average)', r2(cur.decideHours), r2(prev.decideHours)],
    [],
    ['Supplier', 'Supplier ID', 'Quotes', 'Awarded', 'Award rate (%)', 'Orders', 'Spend (BDT)', 'Saved against asking (%)', 'Delivered', 'On time (%)'],
    ...rep.suppliers.map((r) => [r.s.name, r.s.id, r.quotes, r.wins, r2(r.awardPct), r.orders, r2(r.spend), r2(r.savedPct), r.delivered, r2(r.onTimePct)]),
    [],
    ['Company', 'Spend (BDT)'],
    ...rep.companies.map((c) => [c.co, r2(c.value)]),
  ];
  return '﻿' + rows.map((r) => r.map(cell).join(',')).join('\r\n');
}
