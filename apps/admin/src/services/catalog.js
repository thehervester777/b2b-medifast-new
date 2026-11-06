import { state } from '../core/store.js';
import { COMPANIES } from '../data/constants.js';
import { act } from './act.js';

/*
 * Our own products. Sending a product to the supplier app posts a request for it, so
 * suppliers can quote. A product with an open request is not sent twice.
 */
export const productById = (id) => state.products.find((p) => p.id === Number(id));
export const brands = () => [...new Set(state.products.map((p) => p.brand))].sort((a, b) => a.localeCompare(b));

/** The request suppliers can quote on right now, if there is one. */
export const openRequestOf = (p) => state.requests.find((r) => r.productId === p.id && r.status === 'Active') || null;

/** out (0), low (1 to 5), warn (6 to 10), ok (more). */
export const level = (p) => (p.stock <= 0 ? 'out' : p.stock <= 5 ? 'low' : p.stock <= 10 ? 'warn' : 'ok');

/** A sensible first quantity: enough to get back to twice the reorder level, in steps of 5. */
export const suggestQty = (p) => Math.max(5, Math.ceil((p.reorder * 2 - p.stock) / 5) * 5);

export const margin = (p) => (p.sale > 0 ? ((p.sale - p.buy) / p.sale) * 100 : 0);

const has = (v, q) => v != null && String(v).toLowerCase().includes(q);

/** max is a stock ceiling ('' = no limit): products with that many boxes or fewer. */
export function filterProducts({ q = '', brand = 'All', max = '', sort = 'new' } = {}) {
  const term = q.trim().toLowerCase();
  const limit = max === '' || max == null ? null : Number(max);
  const list = state.products.filter((p) => {
    if (brand !== 'All' && p.brand !== brand) return false;
    if (limit != null && !Number.isNaN(limit) && p.stock > limit) return false;
    return !term || has(p.name, term) || has(p.generic, term) || has(p.brand, term) || has(p.code, term);
  });
  const by = {
    new: (a, b) => b.addedAt - a.addedAt,
    low: (a, b) => a.stock - b.stock || a.name.localeCompare(b.name),
    high: (a, b) => b.stock - a.stock || a.name.localeCompare(b.name),
    name: (a, b) => a.name.localeCompare(b.name),
  };
  return list.sort(by[sort] || by.new);
}

/** Products at 5 boxes or fewer with no open request: what the dashboard asks you to restock. */
export const needsRestock = () => state.products.filter((p) => p.status === 'Active' && p.stock <= 5 && !openRequestOf(p)).sort((a, b) => a.stock - b.stock || a.name.localeCompare(b.name));

/**
 * items: [{ id, qty, ask }]. Posts one request per product and returns { undo, ids } or null.
 * opts:  { noEnd, deadlineAt, note }
 */
export function sendProducts(items, { noEnd = false, deadlineAt = null, note = '' } = {}) {
  return act('post', '/admin/products/send', { items, noEnd, deadlineAt: noEnd ? null : deadlineAt, note });
}

/** data: { name, generic, brand, stock, reorder, buy, sale, status }. */
export const addProduct = (data) => act('post', '/admin/products', data);
export const updateProduct = (id, data) => act('patch', `/admin/products/${Number(id)}`, data);

/** Company names for pickers: the built-in list plus any already used by a request or product. */
export const companies = () =>
  [...new Set([...COMPANIES, ...state.requests.map((r) => r.co), ...state.products.map((p) => p.brand)].filter(Boolean))].sort((a, b) => a.localeCompare(b));
