import { state, can, ui } from './store.js';
import { homePath, pageOf } from './nav.js';
import { killPage, pageOut, pageIn, refresh, scrollToY, jumpTop } from './motion.js';

/*
 * Hash router. Views are loaded on demand (one small chunk each) and prefetched
 * when the browser is idle, so the first screen stays light.
 *
 * A view module's default export looks like:
 *   { title, render() -> html, mount(root) -> cleanup? }
 *
 * Only plain names are used in the hash (#quotes, not #/quotes), so links also work
 * when the panel is embedded in a page that reserves the rest of the hash. The settings
 * page is #preferences because a host page may reserve #settings for itself.
 */
const routes = [
  { re: /^sign-in$/, layout: 'auth', load: () => import('../views/login.js') },
  { re: /^overview$/, layout: 'app', tab: 'overview', load: () => import('../views/overview.js') },
  /* Quotes no longer has a page of its own: old links land on Requests, filtered to what needs a decision. */
  { re: /^quotes?(?:-[A-Za-z0-9-]+)?$/, layout: 'app', redirect: () => { ui.requests.status = 'To review'; ui.requests.q = ''; ui.requests.co = 'All'; return 'requests'; } },
  { re: /^order-([A-Za-z0-9-]+)$/, layout: 'app', tab: 'orders', kind: 'order', load: () => import('../views/cartdetail.js') },
  { re: /^requests$/, layout: 'app', tab: 'requests', load: () => import('../views/requests.js') },
  { re: /^orders$/, layout: 'app', tab: 'orders', load: () => import('../views/orders.js') },
  { re: /^products$/, layout: 'app', tab: 'products', load: () => import('../views/products.js') },
  { re: /^suppliers$/, layout: 'app', tab: 'suppliers', load: () => import('../views/suppliers.js') },
  { re: /^reports$/, layout: 'app', tab: 'reports', load: () => import('../views/reports.js') },
  { re: /^(?:audit|activity)$/, layout: 'app', tab: 'audit', load: () => import('../views/audit.js') },
  { re: /^access$/, layout: 'app', tab: 'access', load: () => import('../views/access.js') },
  { re: /^site$/, layout: 'app', tab: 'site', load: () => import('../views/site.js') },
  { re: /^preferences$/, layout: 'app', tab: 'preferences', load: () => import('../views/settings.js') },
];

let ctx;
let current = null;
let ticket = 0;
let ready = false;

export const navigate = (path) => {
  if (currentPath() === path) {
    scrollToY(0);
    return;
  }
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

  const inside = state.authed && !state.mustChange; /* a temporary password must be replaced before anything else opens */
  if (!match) return redirect(inside ? homePath() : 'sign-in');
  const { route, params } = match;
  if (route.redirect) return redirect(inside ? route.redirect(params) : 'sign-in');
  if (route.layout === 'app' && !inside) return redirect('sign-in');
  if (route.layout === 'auth' && inside) return redirect(homePath());

  /* A page the signed-in admin has no permission for shows a plain "no access" screen. */
  const denied = route.layout === 'app' && route.tab && !can(pageOf(route.tab).perm);
  const mod = await (denied ? import('../views/noaccess.js') : route.load());
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
  const outer = route.layout === 'auth' ? ctx.authRoot : ctx.pageRoot;
  jumpTop();
  /* Each view gets its own host element. Listeners a view puts on its root go away with
     the host, so nothing from a page you have left can react on the next one.
     `display: contents` keeps the layout exactly as if the view were in the page itself. */
  const root = document.createElement('div');
  root.className = 'view-host';
  root.style.display = 'contents';
  outer.replaceChildren(root);
  root.innerHTML = view.render(params, route);
  const cleanup = view.mount ? view.mount(root, params, route) : null;
  const tab = denied ? null : route.tab || null;
  current = { layout: route.layout, tab, cleanup };

  document.title = (view.title ? view.title + ' · ' : '') + 'MediFast Admin';
  if (ctx.setTab) ctx.setTab(tab);
  if (route.layout === 'app' && ctx.onPage) ctx.onPage(view.title || '', root);
  if (layoutChanged && route.layout === 'app' && ctx.playEntrance) ctx.playEntrance();
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
  idle(() => routes.forEach((r) => r.load && r.load().catch(() => {})));
}

export function initRouter(options) {
  ctx = options;
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  window.addEventListener('hashchange', go);
  go();
}
