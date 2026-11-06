import { state } from '../core/store.js';
import { act } from './act.js';
import { cartIndex, cartOfOrder } from './carts.js';

/*
 * Orders. An order is created the moment a quote is awarded, then moves through
 *   Pending -> Approved -> In transit -> Delivered      (or Cancelled at any point before delivery)
 * Each move is written to the order's own history and to the audit log.
 */
const round2 = (n) => Math.round(n * 100) / 100;

export const STATUSES = ['Pending', 'Approved', 'In transit', 'Delivered', 'Cancelled'];
export const FLOW = ['Pending', 'Approved', 'In transit', 'Delivered'];

export const orderById = (id) => state.orders.find((o) => o.id === Number(id));
export const orderOfQuote = (quoteId) => state.orders.find((o) => o.quoteId === Number(quoteId));
export const orderCode = (o) => 'ORD-' + o.id;
export const invoiceCode = (o) => 'INV-' + o.id;
export const orderTotal = (o) => round2(o.price * o.qty);
export const supplierOf = (o) => state.suppliers.find((s) => s.id === o.supplierId);

/** The next step in the normal flow, or null once delivered or cancelled. */
export const nextStatus = (o) => (o.status === 'Cancelled' ? null : FLOW[FLOW.indexOf(o.status) + 1] || null);
export const isOpen = (o) => o.status !== 'Delivered' && o.status !== 'Cancelled';
export const isLate = (o, now = Date.now()) => isOpen(o) && now > o.expectedAt;

/**
 * Move one or many orders to a status. Returns { undo, n } or null when nothing would change.
 * The server stamps the delivery time when an order becomes Delivered and clears it when it leaves Delivered.
 */
export async function setOrderStatus(ids, status) {
  const todo = [].concat(ids).map(Number).filter((id) => {
    const o = orderById(id);
    return o && o.status !== status;
  });
  if (!todo.length) return null;
  const res = await act('post', '/admin/orders/status', { ids: todo, status });
  return res && { ...res, n: res.changed };
}

/**
 * Change the boxes or the price per box of an open order (the invoice lines on the details page).
 * Returns { undo } or null when nothing changed. The server writes the change to the order's history.
 */
export function updateOrderLine(id, { qty, price }) {
  const o = orderById(id);
  if (!o || !isOpen(o)) return null;
  const body = {};
  if (qty != null) body.qty = Math.round(Number(qty));
  if (price != null) body.price = round2(Number(price));
  if ((body.qty === undefined || body.qty === o.qty) && (body.price === undefined || body.price === o.price)) return null;
  return act('patch', `/admin/orders/${o.id}`, body);
}

/** Printing leaves a line in the audit log, because invoices are records. kind: 'invoice' | 'list' | 'warehouse'. */
export const logPrinted = (kind, ids) => act('post', '/admin/orders/printed', { kind, ids: ids.map(Number) });

/* ---------- filtering shared by the orders page and its exports ---------- */
const has = (v, q) => v != null && String(v).toLowerCase().includes(q);

/** status 'All' keeps every status. from / to are timestamps or null. */
export function filterOrders({ status = 'All', q = '', supplier = 'All', from = null, to = null } = {}) {
  const term = q.trim().toLowerCase();
  const idx = term ? cartIndex() : null;
  return state.orders
    .filter((o) => {
      if (status !== 'All' && o.status !== status) return false;
      if (supplier !== 'All' && o.supplierId !== supplier) return false;
      if (from != null && o.createdAt < from) return false;
      if (to != null && o.createdAt > to) return false;
      if (!term) return true;
      const s = supplierOf(o);
      return has(orderCode(o), term) || has(o.id, term) || has(invoiceCode(o), term) || has(o.name, term) || has(o.generic, term) || has(o.co, term) || has(cartOfOrder(o, idx).code, term) || (s && (has(s.name, term) || has(s.id, term)));
    })
    .sort((a, b) => b.createdAt - a.createdAt);
}

export function countByStatus(list) {
  const c = { All: list.length };
  STATUSES.forEach((s) => (c[s] = 0));
  list.forEach((o) => c[o.status]++);
  return c;
}

/** Totals for the open pipeline, used by the dashboard and the sidebar badge. */
export function pipeline() {
  const out = {};
  FLOW.forEach((s) => (out[s] = { n: 0, value: 0 }));
  state.orders.forEach((o) => {
    if (out[o.status]) {
      out[o.status].n++;
      out[o.status].value += o.price * o.qty;
    }
  });
  return out;
}
export const openOrderCount = () => state.orders.filter(isOpen).length;
export const lateOrderCount = (now = Date.now()) => state.orders.filter((o) => isLate(o, now)).length;
