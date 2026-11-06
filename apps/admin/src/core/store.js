import { api, ApiError, setSignedOutHandler } from './api.js';

/*
 * One small store. The server is the source of truth: the panel loads everything for the signed-in role in one
 * call (loadAll), keeps it in `state`, and reloads when the server's data version changes (see startSync).
 * Changes are made by calling the server (services/*.js) and then reloading; nothing here edits data directly.
 */
const bus = new Map();
export const on = (event, fn) => {
  if (!bus.has(event)) bus.set(event, new Set());
  bus.get(event).add(fn);
  return () => bus.get(event).delete(fn);
};
export const emit = (event, payload) => bus.get(event) && bus.get(event).forEach((fn) => fn(payload));

const blank = () => ({
  authed: false,
  version: 0,
  adminId: null,
  mustChange: false,
  requests: [],
  suppliers: [],
  quotes: [],
  orders: [],
  products: [],
  activity: [],
  team: [],
  roles: {},
  settings: { requireReason: true, flagLowPrice: true, lowPricePct: 25, reviewHours: 48, leadDays: 4, rejectOthersOnAward: true, notifyPending: true, notifyDigest: false, notifySuppliers: false },
  site: { notice: { on: false, tone: 'info', title: '', body: '', audience: 'suppliers', dismissible: true, scheduled: false, startAt: null, endAt: null }, maintenance: { mode: 'off', message: '', startAt: null, endAt: null } },
});

export const state = blank();
const DATA_KEYS = ['requests', 'suppliers', 'quotes', 'orders', 'products', 'activity', 'team', 'roles', 'settings', 'site'];

/*
 * Filters each page remembers while you move around (not saved between visits).
 * Other parts of the panel set these before navigating, e.g. the bell opens
 * Requests already filtered to "To review".
 */
export const ui = {
  dash: { range: '30d' },
  requests: { status: 'All', q: '', co: 'All', sort: 'new' },
  orders: { status: 'All', q: '', supplier: 'All', quick: 'all', from: '', to: '', per: 10, page: 1 },
  products: { q: '', brand: 'All', max: '', sort: 'new', per: 25, page: 1 },
  suppliers: { status: 'All', q: '', city: 'All', sort: 'status' },
  audit: { type: 'All', user: 'All', q: '', quick: 'all', from: '', to: '', per: 25, page: 1 },
  reports: { quick: 'month', from: '', to: '' },
};

/* ---------- helpers ---------- */
export const me = () => state.team.find((t) => t.id === state.adminId) || { id: state.adminId, name: '', email: '', role: '', active: true };

/** Can the signed-in admin do this? The server checks again on every request; this only hides buttons. */
export const can = (key) => {
  const who = me();
  return !!who && who.active !== false && (state.roles[who.role] || []).includes(key);
};

/* ---------- loading ---------- */
let loading = null;
/** Fetch everything for this role and replace the data. Overlapping calls share one request. */
export function loadAll() {
  if (loading) return loading;
  loading = api
    .get('/admin/bootstrap')
    .then((b) => {
      DATA_KEYS.forEach((k) => {
        state[k] = b[k];
      });
      state.version = b.version;
      state.adminId = b.me.id;
      emit('data', { type: 'sync' });
      return b;
    })
    .finally(() => {
      loading = null;
    });
  return loading;
}

/* ---------- session ---------- */
function ended(message) {
  if (!state.authed) return;
  state.authed = false;
  stopSync();
  Object.assign(state, blank());
  emit('auth', false);
  if (message) emit('notice', message);
}
setSignedOutHandler(() => ended('Your session ended. Please sign in again.'));

/** Resume a session that is still open (a page reload). Returns true when signed in. */
export async function restore() {
  try {
    const { me: m } = await api.get('/admin/auth/session');
    if (!m) return false;
    state.mustChange = m.mustChange;
    state.adminId = m.id;
    if (m.mustChange) {
      state.authed = true;
      return true;
    }
    await loadAll();
    state.authed = true;
    startSync();
    return true;
  } catch (e) {
    return false;
  }
}

/** Returns true, 'must-change' (temporary password), or an error string for the form. */
export async function signIn(email, password) {
  try {
    const res = await api.post('/admin/auth/login', { email: email.trim(), password });
    state.mustChange = !!res.mustChange;
    if (res.mustChange) {
      state.authed = true;
      emit('auth', true);
      return 'must-change';
    }
    await loadAll();
    state.authed = true;
    startSync();
    emit('auth', true);
    return true;
  } catch (e) {
    return e instanceof ApiError ? e.message : 'Something went wrong. Please try again.';
  }
}

export async function changePassword(current, next) {
  await api.post('/admin/auth/password', { current, next });
  state.mustChange = false;
  await loadAll();
  startSync();
  emit('auth', true);
}

export async function signOut() {
  try {
    await api.post('/admin/auth/logout');
  } catch (e) {
    /* already signed out */
  }
  state.authed = false;
  stopSync();
  Object.assign(state, blank());
  emit('auth', false);
}

/* ---------- keeping the screen current ---------- */
let timer = 0;
let polling = false;
async function tick() {
  if (!state.authed || state.mustChange || polling || document.hidden) return;
  polling = true;
  try {
    const { version } = await api.get('/admin/version');
    if (version !== state.version) await loadAll();
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
