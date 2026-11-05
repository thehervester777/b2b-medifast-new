import { buildRequests, seedUser, seedQuotes, seedNotifications, DEMO_ACCOUNT } from '../data/seed.js';
import { clamp } from './dom.js';

/* ---------- tiny pub/sub ---------- */
const listeners = {};
export const on = (event, fn) => {
  (listeners[event] = listeners[event] || new Set()).add(fn);
  return () => listeners[event].delete(fn);
};
export const emit = (event, data) => {
  if (listeners[event]) listeners[event].forEach((fn) => fn(data));
};

/* ---------- state ---------- */
const KEY = 'medifast-supplier:v1';

const fresh = () => ({
  authed: false,
  remember: true,
  user: seedUser(),
  quotes: seedQuotes(),
  cart: [],
  qty: {},
  batches: [],
  batchSeq: 1001,
  lastBatch: null,
  pending: [],
  signupSeq: 2041,
  unread: true,
});

function load() {
  const base = fresh();
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (saved && typeof saved === 'object') return { ...base, ...saved, user: { ...base.user, ...(saved.user || {}) } };
  } catch (e) {
    /* storage can be blocked or corrupt; start clean */
  }
  return base;
}

/** The request list is deterministic and rebuilt on every load. It is not persisted. */
export const requests = buildRequests();
const byId = new Map(requests.map((r) => [r.id, r]));

/** Persisted session state: account, quotes, cart, submissions. */
export const state = load();

/* Quotes you sent earlier count as bids on their request again after a reload. */
state.quotes.filter((q) => q.live).forEach((q) => {
  const r = byId.get(q.req);
  if (r) r.bids += 1;
});

/** Screen state that should reset on reload: search, filters, sort, tabs. */
export const ui = {
  search: '',
  co: 'All',
  status: 'Active',
  sort: { k: '', dir: 1 },
  limit: 12,
  filters: { min: '', max: '', end: 'any', bids: 'any', qty: 'any' },
  quoteFilter: 'All',
  openBatches: new Set(),
};

export const notifications = seedNotifications();

let saveTimer = 0;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, 180);
}
export function flush() {
  try {
    const copy = { ...state, authed: state.authed && state.remember };
    localStorage.setItem(KEY, JSON.stringify(copy));
  } catch (e) {
    /* ignore quota / privacy-mode errors */
  }
}
window.addEventListener('pagehide', flush);

/* ---------- selectors ---------- */
export const findReq = (id) => byId.get(Number(id));
export const quoteFor = (id) => state.quotes.find((q) => q.req === id && q.live);
export const rankFor = (r, price) => 1 + r.rivals.filter((x) => x < price).length;
export const countStatus = (s) => requests.reduce((n, r) => n + (r.status === s ? 1 : 0), 0);
export const inCart = (id) => state.cart.includes(id);

export const lineQty = (id) => {
  const r = findReq(id);
  if (!r) return 1;
  const n = Math.floor(Number(state.qty[id] ?? r.qty));
  return clamp(Number.isFinite(n) ? n : r.qty, 1, r.qty);
};

export const cartTotal = () =>
  state.cart.reduce((sum, id) => {
    const r = findReq(id);
    return r ? sum + r.ask * lineQty(id) : sum;
  }, 0);

export function stats() {
  const q = state.quotes;
  return {
    active: countStatus('Active'),
    quotes: q.length,
    pending: q.filter((x) => x.status === 'PENDING').length,
    won: q.filter((x) => x.status === 'WON').length,
    rejected: q.filter((x) => x.status === 'REJECTED').length,
    subs: state.batches.length,
    subq: state.batches.reduce((t, b) => t + b.items.length, 0),
    value: state.batches.reduce((t, b) => t + b.total, 0),
  };
}

/* ---------- cart ---------- */
export function setQty(id, value) {
  const r = findReq(id);
  if (!r) return 1;
  const n = clamp(Math.floor(Number(value)) || 1, 1, r.qty);
  state.qty[id] = n;
  save();
  emit('qty', id);
  if (inCart(id)) emit('cart', { id });
  return n;
}

/** Returns true when the request was added, false when it was removed. */
export function toggleCart(id) {
  const adding = !inCart(id);
  if (adding) state.cart.push(id);
  else state.cart = state.cart.filter((x) => x !== id);
  save();
  emit('cart', { id, adding });
  return adding;
}

export function removeFromCart(id) {
  state.cart = state.cart.filter((x) => x !== id);
  save();
  emit('cart', { id, adding: false });
}

export function clearCart() {
  const ids = state.cart.slice();
  state.cart = [];
  save();
  emit('cart', { ids, adding: false });
}

/* ---------- quotes ---------- */
export function addQuote(r, price, qty, delivery = '', note = '', batch = null) {
  const q = {
    req: r.id,
    med: r.name,
    price,
    qty,
    status: 'PENDING',
    at: Date.now(),
    rank: rankFor(r, price),
    live: true,
    delivery,
    note,
    batch,
  };
  state.quotes.unshift(q);
  r.bids += 1;
  state.cart = state.cart.filter((x) => x !== r.id);
  save();
  emit('quotes', { id: r.id });
  emit('cart', { id: r.id, adding: false });
  return q;
}

/** Take a just-sent quote back (the undo toast). */
export function undoQuote(q, restoreToCart) {
  const i = state.quotes.indexOf(q);
  if (i < 0) return false;
  state.quotes.splice(i, 1);
  const r = findReq(q.req);
  if (r) r.bids = Math.max(0, r.bids - 1);
  if (restoreToCart && !inCart(q.req)) state.cart.push(q.req);
  save();
  emit('quotes', { id: q.req });
  emit('cart', { id: q.req, adding: true });
  return true;
}

/** Send everything in the cart as one submission at the asking prices. */
export function sendCart() {
  const items = [];
  state.cart.slice().forEach((id) => {
    const r = findReq(id);
    if (!r || r.status !== 'Active' || quoteFor(id)) return;
    const qty = lineQty(id);
    items.push({ req: id, name: r.name, generic: r.generic, co: r.co, qty, price: r.ask, total: r.ask * qty });
  });
  if (!items.length) {
    clearCart();
    return null;
  }
  const batch = {
    id: 'CS-' + state.batchSeq++,
    at: Date.now(),
    items,
    qty: items.reduce((t, i) => t + i.qty, 0),
    total: items.reduce((t, i) => t + i.total, 0),
  };
  state.batches.unshift(batch);
  state.lastBatch = batch.id;
  ui.openBatches.clear();
  ui.openBatches.add(batch.id);
  items.forEach((i) => addQuote(findReq(i.req), i.price, i.qty, '', '', batch.id));
  state.cart = [];
  save();
  emit('cart', { adding: false });
  emit('quotes', {});
  return batch;
}

/* ---------- account ---------- */
export function signIn(email, password, keep) {
  const mail = email.trim().toLowerCase();
  if (state.pending.some((p) => p.email.toLowerCase() === mail)) {
    return { ok: false, field: 'email', error: 'This provider account is still awaiting approval. We will email you once it is verified.' };
  }
  if (mail === DEMO_ACCOUNT.email && password === DEMO_ACCOUNT.password) {
    state.authed = true;
    state.remember = !!keep;
    save();
    emit('auth', true);
    return { ok: true };
  }
  return { ok: false, field: 'pass', error: 'The email or password is not right. Please check them and try again.' };
}

export function signOut() {
  state.authed = false;
  save();
  emit('auth', false);
}

export function registerProvider(data) {
  const request = { id: 'PR-' + state.signupSeq++, at: Date.now(), ...data };
  state.pending.push(request);
  save();
  return request;
}

export function updateUser(patch) {
  Object.assign(state.user, patch);
  save();
  emit('user', state.user);
}

export function markNotificationsRead() {
  if (!state.unread) return;
  state.unread = false;
  save();
  emit('notifications');
}
