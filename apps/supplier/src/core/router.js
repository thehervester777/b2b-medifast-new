import { state } from './store.js';
import { killPage, pageOut, pageIn, refresh } from './motion.js';

/*
 * Hash router. Views are loaded on demand (one small chunk each) and prefetched
 * when the browser is idle, so the first screen stays light.
 *
 * A view module's default export looks like:
 *   { title, render(params) -> html, mount(root, params) -> cleanup? }
 */
const routes = [
  { re: /^sign-in$/, layout: 'auth', load: () => import('../views/signin.js') },
  { re: /^sign-up$/, layout: 'auth', load: () => import('../views/signup.js') },
  { re: /^change-password$/, layout: 'auth', forced: true, load: () => import('../views/password.js') },
  { re: /^board$/, layout: 'app', tab: 'board', load: () => import('../views/board.js') },
  { re: /^request[-/](\d+)$/, layout: 'app', tab: 'board', load: () => import('../views/detail.js') },
  { re: /^quotes$/, layout: 'app', tab: 'quotes', load: () => import('../views/quotes.js') },
  { re: /^submissions$/, layout: 'app', tab: 'submissions', load: () => import('../views/submissions.js') },
  { re: /^account$/, layout: 'app', tab: 'account', load: () => import('../views/account.js') },
];

let ctx;
let current = null;
let ticket = 0;
let ready = false;

export const navigate = (path) => {
  location.hash = '#' + path;
};
const redirect = (path) => location.replace('#' + path);

const currentPath = () => location.hash.replace(/^#\/?/, '').replace(/\/+$/, '');

function resolve(path) {
  for (const route of routes) {
    const m = path.match(route.re);
    if (m) return { route, params: m.slice(1) };
  }
  return null;
}

function applyLayout(layout) {
  const auth = layout === 'auth';
  ctx.authRoot.hidden = !auth;
  ctx.shellRoot.hidden = auth;
  document.documentElement.dataset.layout = layout;
}

async function go() {
  const mine = ++ticket;
  const path = currentPath();
  const match = resolve(path);

  /* A supplier who signed in with a temporary password may only choose a new one; nothing else opens before that. */
  const inside = state.authed && !state.mustChange;
  const home = inside ? 'board' : state.authed ? 'change-password' : 'sign-in';
  if (!match) return redirect(home);
  const { route, params } = match;
  if (route.layout === 'app' && !inside) return redirect(home);
  if (route.forced ? !(state.authed && state.mustChange) : route.layout === 'auth' && state.authed) return redirect(home);

  const mod = await route.load();
  if (mine !== ticket) return;
  const view = mod.default;

  const layoutChanged = !current || current.layout !== route.layout;
  const outNode = !current ? null : current.layout === 'auth' ? ctx.authRoot : layoutChanged ? ctx.shellRoot : ctx.pageRoot;
  const inNode = route.layout === 'auth' ? ctx.authRoot : layoutChanged ? ctx.shellRoot : ctx.pageRoot;

  if (outNode) await pageOut(outNode);
  if (mine !== ticket) return;

  if (current && current.cleanup) current.cleanup();
  killPage();

  applyLayout(route.layout);
  const root = route.layout === 'auth' ? ctx.authRoot : ctx.pageRoot;
  window.scrollTo(0, 0);
  root.innerHTML = view.render(params);
  const cleanup = view.mount ? view.mount(root, params) : null;
  current = { layout: route.layout, tab: route.tab || null, cleanup };

  document.title = (view.title ? view.title + ' · ' : '') + 'MediFast Supplier';
  if (ctx.setTab) ctx.setTab(route.tab || null);
  pageIn(inNode);
  refresh();

  if (!ready) {
    ready = true;
    if (ctx.onReady) ctx.onReady();
    prefetch();
  }
}

/** Warm the other view chunks once the first screen is up. Skipped on data saver. */
function prefetch() {
  if (navigator.connection && navigator.connection.saveData) return;
  const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 1500));
  idle(() => routes.forEach((r) => r.load().catch(() => {})));
}

export function initRouter(options) {
  ctx = options;
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  window.addEventListener('hashchange', go);
  go();
}
