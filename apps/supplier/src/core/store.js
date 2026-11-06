import { api, ApiError, setHandlers } from './api.js';
import { clamp } from './dom.js';
import { fmtWhen } from './format.js';

/*
 * One small store. The server is the source of truth: the app loads everything for the signed-in supplier in
 * one call (loadAll) and reloads when the server's data version changes (see startSync). Sending a price is a
 * call to the server followed by a reload. Only the cart is kept on this device, because it is not a quote yet.
 */

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
const blankUser = () => ({ code: '', name: '', biz: '', email: '', phone: '', addr: '', city: '', lic: '', tin: '' });

export const state = {
  authed: false,
  mustChange: false,
  version: 0,
  user: blankUser(),
  quotes: [],
  batches: [],
  cart: [],
  qty: {},
  lastBatch: null,
  unread: false,
  site: { notice: null, maintenance: null },
};

/** Live lists. They are refilled in place on every load, so importers always see the current data. */
export const requests = [];
export const notifications = [];
let byId = new Map();

/** Screen state that resets on reload: search, filters, sort, tabs. */
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

/* ---------- the cart lives on this device ---------- */
const cartKey = () => `medifast-supplier:cart:${state.user.code}`;
function loadCart() {
  try {
    const saved = JSON.parse(localStorage.getItem(cartKey()) || 'null');
    if (saved && Array.isArray(saved.cart)) {
      state.cart = saved.cart.filter(Number.isInteger);
      state.qty = saved.qty && typeof saved.qty === 'object' ? saved.qty : {};
      return;
    }
  } catch (e) {
    /* storage can be blocked or corrupt; start with an empty cart */
  }
  state.cart = [];
  state.qty = {};
}
function saveCart() {
  try {
    localStorage.setItem(cartKey(), JSON.stringify({ cart: state.cart, qty: state.qty }));
  } catch (e) {
    /* ignore quota / privacy-mode errors */
  }
}

/* ---------- selectors ---------- */
export const findReq = (id) => byId.get(Number(id));
export const quoteFor = (id) => state.quotes.find((q) => q.req === id);
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

/* ---------- loading ---------- */
let loading = null;
/**
 * Fetch everything for this supplier and replace the data. Overlapping calls share one request.
 * `source` is 'self' after this supplier's own action (the screen already shows it) and 'poll' otherwise.
 */
export function loadAll(source = 'poll') {
  if (loading) return loading;
  loading = api
    .get('/bootstrap')
    .then((b) => {
      state.version = b.version;
      Object.assign(state.user, blankUser(), b.user);
      state.quotes = b.quotes;
      state.batches = b.batches;
      state.site = b.site;
      requests.length = 0;
      requests.push(...b.requests);
      byId = new Map(requests.map((r) => [r.id, r]));
      state.quotes.forEach((q) => {
        q.live = byId.has(q.req); /* only quotes whose request is still on the board can be opened */
      });
      notifications.length = 0;
      notifications.push(...b.notifications.map((n) => ({ ...n, when: fmtWhen(n.at) })));
      state.unread = notifications.some((n) => !n.read);
      /* the cart only keeps requests that are still open and not yet quoted */
      loadCart();
      state.cart = state.cart.filter((id) => {
        const r = byId.get(id);
        return r && r.status === 'Active' && !quoteFor(id);
      });
      emit('user', state.user);
      emit('quotes', {});
      emit('cart', { adding: false });
      emit('notifications');
      emit('site', state.site);
      emit('data', { type: 'sync', source });
      return b;
    })
    .finally(() => {
      loading = null;
    });
  return loading;
}

/* ---------- session ---------- */
function reset() {
  state.authed = false;
  state.mustChange = false;
  state.user = blankUser();
  state.quotes = [];
  state.batches = [];
  state.cart = [];
  state.qty = {};
  state.lastBatch = null;
  state.unread = false;
  state.site = { notice: null, maintenance: null };
  requests.length = 0;
  notifications.length = 0;
  byId = new Map();
}

function ended(message) {
  if (!state.authed) return;
  stopSync();
  reset();
  emit('auth', false);
  if (message) emit('notice', message);
}

setHandlers({
  signedOut: () => ended('Your session ended. Please sign in again.'),
  maintenance: (e) => {
    state.site = { ...state.site, maintenance: { message: e.message } };
    emit('site', state.site);
  },
});

const message = (e) => (e instanceof ApiError ? e.message : 'Something went wrong. Please try again.');

/** Resume a session that is still open (a page reload). Returns true when signed in. */
export async function restore() {
  try {
    const { me } = await api.get('/auth/session');
    if (!me) return false;
    state.user.code = me.code;
    state.mustChange = me.mustChange;
    if (me.mustChange) {
      state.authed = true;
      return true;
    }
    await loadAll();
    state.authed = true;
    startSync();
    return true;
  } catch (e) {
    reset();
    return false;
  }
}

/** Resolves { ok: true, mustChange } or { ok: false, field, error }. */
export async function signIn(email, password, keep) {
  try {
    const res = await api.post('/auth/login', { email: email.trim(), password, keep: !!keep });
    state.mustChange = !!res.mustChange;
    if (res.mustChange) {
      state.authed = true;
      emit('auth', true);
      return { ok: true, mustChange: true };
    }
    await loadAll();
    state.authed = true;
    startSync();
    emit('auth', true);
    return { ok: true, mustChange: false };
  } catch (e) {
    const code = e instanceof ApiError ? e.code : '';
    return { ok: false, field: code === 'pending' || code === 'suspended' ? 'email' : 'pass', error: message(e) };
  }
}

/** data: { biz, owner, addr, city, lic, tin, email, phone, password }. Resolves { ok: true, id } or { ok: false, error }. */
export async function signUp(data) {
  try {
    const res = await api.post('/auth/signup', data);
    return { ok: true, id: res.id };
  } catch (e) {
    return { ok: false, error: message(e), code: e instanceof ApiError ? e.code : '' };
  }
}

export async function changePassword(current, next) {
  const forced = state.mustChange;
  await api.post('/auth/password', { current, next });
  state.mustChange = false;
  if (!forced) return;
  /* the server signs out other devices, not this one */
  await loadAll();
  startSync();
  emit('auth', true);
}

export async function signOut() {
  try {
    await api.post('/auth/logout');
  } catch (e) {
    /* already signed out */
  }
  stopSync();
  reset();
  emit('auth', false);
}

/* ---------- keeping the screen current ---------- */
let timer = 0;
let polling = false;
async function tick() {
  if (!state.authed || state.mustChange || polling || document.hidden) return;
  polling = true;
  try {
    const v = await api.get('/version');
    const maintenance = !!v.maintenance;
    if (v.version !== state.version || maintenance !== !!state.site.maintenance) await loadAll();
  } catch (e) {
    /* a dropped connection or an ended session is handled by the next real action */
  } finally {
    polling = false;
  }
}
export function startSync() {
  stopSync();
  timer = setInterval(tick, 20000);
  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('focus', tick);
}
function stopSync() {
  clearInterval(timer);
  document.removeEventListener('visibilitychange', onVisible);
  window.removeEventListener('focus', tick);
}
function onVisible() {
  if (!document.hidden) tick();
}

/* ---------- cart ---------- */
export function setQty(id, value) {
  const r = findReq(id);
  if (!r) return 1;
  const n = clamp(Math.floor(Number(value)) || 1, 1, r.qty);
  state.qty[id] = n;
  saveCart();
  emit('qty', id);
  if (inCart(id)) emit('cart', { id });
  return n;
}

/** Returns true when the request was added, false when it was removed. */
export function toggleCart(id) {
  const adding = !inCart(id);
  if (adding) state.cart.push(id);
  else state.cart = state.cart.filter((x) => x !== id);
  saveCart();
  emit('cart', { id, adding });
  return adding;
}

export function removeFromCart(id) {
  state.cart = state.cart.filter((x) => x !== id);
  saveCart();
  emit('cart', { id, adding: false });
}

export function clearCart() {
  const ids = state.cart.slice();
  state.cart = [];
  saveCart();
  emit('cart', { ids, adding: false });
}

/* ---------- quotes ---------- */
/** Send one price. Resolves { ok: true, quote } or { ok: false, error }. */
export async function addQuote(r, price, qty, delivery = '', note = '') {
  try {
    await api.post('/quotes', { reqId: r.id, price, qty, delivery, note });
  } catch (e) {
    if (e instanceof ApiError && e.status !== 0 && e.status < 500) await loadAll().catch(() => {});
    return { ok: false, error: message(e) };
  }
  state.cart = state.cart.filter((x) => x !== r.id);
  saveCart();
  await loadAll('self').catch(() => {});
  emit('quotes', { id: r.id });
  emit('cart', { id: r.id, adding: false });
  return { ok: true, quote: quoteFor(r.id) };
}

/** Take a just-sent quote back (the undo toast). Resolves true or false. */
export async function undoQuote(q, restoreToCart) {
  try {
    await api.del(`/quotes/${q.id}`);
  } catch (e) {
    await loadAll().catch(() => {});
    return false;
  }
  if (restoreToCart && !inCart(q.req)) state.cart.push(q.req);
  saveCart();
  await loadAll('self').catch(() => {});
  emit('quotes', { id: q.req });
  emit('cart', { id: q.req, adding: restoreToCart });
  return true;
}

/** Send everything in the cart as one submission at the asking prices. Resolves { ok, batch, skipped } or { ok: false, error }. */
export async function sendCart() {
  const items = state.cart
    .slice()
    .map((id) => ({ r: findReq(id), id }))
    .filter(({ r, id }) => r && r.status === 'Active' && !quoteFor(id))
    .map(({ r, id }) => ({ reqId: id, qty: lineQty(id), price: r.ask }));
  if (!items.length) {
    clearCart();
    return { ok: false, error: 'Nothing to send. Those requests are no longer open.' };
  }
  let res;
  try {
    res = await api.post('/submissions', { items });
  } catch (e) {
    await loadAll().catch(() => {});
    return { ok: false, error: message(e) };
  }
  const sent = new Set(items.map((i) => i.reqId));
  (res.skipped || []).forEach((s) => sent.delete(s.reqId));
  state.cart = state.cart.filter((id) => !sent.has(id));
  saveCart();
  await loadAll('self').catch(() => {});
  const batch = state.batches.find((b) => b.id === res.batch) || null;
  if (batch) {
    state.lastBatch = batch.id;
    ui.openBatches.clear();
    ui.openBatches.add(batch.id);
  }
  return { ok: true, batch, skipped: res.skipped || [] };
}

/** Where a price would rank, without showing anyone's price. Resolves { rank, bids } or null. */
export async function fetchRank(id, price) {
  try {
    return await api.get(`/requests/${Number(id)}/rank?price=${encodeURIComponent(price)}`);
  } catch (e) {
    return null;
  }
}

/* ---------- account ---------- */
export async function updateUser(patch) {
  try {
    await api.patch('/account', patch);
  } catch (e) {
    return { ok: false, error: message(e) };
  }
  await loadAll('self').catch(() => {});
  return { ok: true };
}

export function markNotificationsRead() {
  if (!state.unread) return;
  state.unread = false;
  notifications.forEach((n) => (n.read = true));
  emit('notifications');
  api.post('/notifications/read').catch(() => {});
}
