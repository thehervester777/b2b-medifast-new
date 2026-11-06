import { $, $$, esc, delegate, debounce } from '../core/dom.js';
import { ic } from '../core/icons.js';
import { state, on, ui, can } from '../core/store.js';
import { reveal, gsap, ANIM, LITE } from '../core/motion.js';
import { QUICK, rangeOf, ymd, fromYmd } from '../core/range.js';
import { money2, plural } from '../core/format.js';
import { STATUSES, filterOrders, countByStatus, orderTotal, openOrderCount, lateOrderCount } from '../services/orders.js';
import { ordersCsv } from '../services/admin.js';
import { cartIndex, cartOfOrder, groupCarts, statusMix } from '../services/carts.js';
import { cartRowHTML, cartHeadHTML, cartMoreHTML, mixSig } from '../components/carts.js';
import { saveText, stamp } from '../services/files.js';
import { toast } from '../core/toast.js';
import { navigate } from '../core/router.js';
import { empty, swapList, mountSeg, flashChanged, pagerHTML, clampPage, selectHTML } from '../components/ui.js';
import { openDocSheet } from '../components/orderpanels.js';
import { openOrderCartMenu, setCartStatus, liveOf } from '../components/cartpanels.js';

/*
 * Orders, one row per supplier cart: the supplier's name, phone, total and status, like an order
 * table. A row opens in place to list its products; the full invoice is on the details page.
 */
const S = () => ui.orders;
const PER = [5, 10, 25, 50];

/** The date window from the two date boxes. A reversed pair is swapped rather than showing nothing. */
function windowOf() {
  let from = fromYmd(S().from, false);
  let to = fromYmd(S().to, true);
  if (from != null && to != null && from > to) [from, to] = [fromYmd(S().to, false), fromYmd(S().from, true)];
  return { from, to };
}
const baseList = () => filterOrders({ q: S().q, supplier: S().supplier, ...windowOf() });

/** Orders as supplier carts: the supplier an order's quote came from. Newest first. */
function cartsOf(items) {
  const idx = cartIndex();
  const carts = groupCarts(items, (o) => cartOfOrder(o, idx));
  carts.forEach((c) => {
    c.recent = Math.max(...c.items.map((o) => o.createdAt));
    c.sum = c.items.reduce((n, o) => n + (o.status === 'Cancelled' ? 0 : orderTotal(o)), 0);
  });
  return carts.sort((a, b) => b.recent - a.recent);
}

export default {
  title: 'Orders',

  render() {
    if (!PER.includes(S().per)) S().per = 10;
    const s = S();
    const canExport = can('orders.view');
    const quickOptions = QUICK.concat([['custom', 'Custom dates']]);
    const withOrders = new Set(state.orders.map((o) => o.supplierId));
    const supplierOptions = [['All', 'All suppliers'], ...state.suppliers.filter((x) => withOrders.has(x.id)).sort((a, b) => a.name.localeCompare(b.name)).map((x) => [x.id, x.name])];
    return `
      <header class="page-head">
        <div><h1>Orders</h1><p id="oSub"></p></div>
        <div class="ph-actions">${canExport ? `<button type="button" class="btn btn-ghost" data-act="export">${ic('download')}Export</button>` : ''}</div>
      </header>

      <div class="seg-row"><div id="oSeg" class="seg-wrap"></div></div>

      <section class="filters f-orders" aria-label="Filter orders">
        <label class="fl f-search"><span>Search</span><div class="search">${ic('search')}<input id="oSearch" type="search" placeholder="Track ID, supplier, phone or medicine" value="${esc(s.q)}" autocomplete="off" enterkeyhint="search" aria-label="Search orders" /></div></label>
        <label class="fl"><span>Supplier</span>${selectHTML({ id: 'oSup', label: 'Supplier', options: supplierOptions, value: s.supplier })}</label>
        <label class="fl"><span>Quick filter</span>${selectHTML({ id: 'oQuick', label: 'Quick date filter', options: quickOptions, value: s.quick })}</label>
        <label class="fl"><span>Start date</span><div class="date-in"><input type="date" id="oFrom" value="${esc(s.from)}" aria-label="Start date" /></div></label>
        <label class="fl"><span>End date</span><div class="date-in"><input type="date" id="oTo" value="${esc(s.to)}" aria-label="End date" /></div></label>
        <label class="fl"><span>Per page</span>${selectHTML({ id: 'oPer', label: 'Suppliers per page', options: PER, value: s.per })}</label>
        <div class="fl f-act"><span aria-hidden="true">&nbsp;</span><button type="button" class="btn btn-ghost" data-act="reset" id="oReset">${ic('refresh')}Reset</button></div>
      </section>

      <div class="tbl-tools" id="tools">
        <span id="oHint"></span>
        <span class="tt-btns">
          <button type="button" class="btn btn-ghost btn-sm" data-act="expand-all" id="expAll">${ic('chd')}Expand all</button>
          ${can('orders.manage') || can('orders.documents') ? `<button type="button" class="btn btn-ghost btn-sm" data-act="select-all" id="selListed">${ic('check')}Select all listed</button><button type="button" class="btn btn-ghost btn-sm" data-act="select-pending">${ic('check')}Select all pending</button>` : ''}
        </span>
      </div>

      <section class="table cart-table" aria-label="Orders, one row per supplier">
        ${cartHeadHTML({ when: 'Order time' })}
        <div id="rows" class="rows"></div>
      </section>
      <div class="more-row pager" id="pager"></div>

      <div class="bulk bulk-orders" id="bulk" hidden>
        <div class="bulk-in">
          <span class="bulk-n"><b id="bulkN">0</b> <span id="bulkWhat">selected</span></span>
          <button type="button" class="btn btn-ghost btn-sm" data-act="bulk-clear">Clear</button>
          ${
            can('orders.documents')
              ? `<button type="button" class="btn btn-ghost btn-sm" data-act="bulk-list" title="One invoice per supplier, with every product listed on it">${ic('printer')}Print invoice</button>
                 <button type="button" class="btn btn-ghost btn-sm" data-act="bulk-warehouse">${ic('clip')}Warehouse paper</button>`
              : ''
          }
          ${
            can('orders.manage')
              ? `<span class="bulk-set">${selectHTML({ id: 'bStatus', label: 'New status', options: STATUSES, value: 'Approved' })}<button type="button" class="btn btn-primary btn-sm" data-act="bulk-status">Update status</button></span>`
              : ''
          }
        </div>
      </div>`;
  },

  mount(root) {
    const canSelect = can('orders.manage') || can('orders.documents');
    const selected = new Set(); /* cart keys */
    const expanded = new Set(); /* cart keys whose product list is open */
    let list = []; /* every order that matches, across pages */
    let carts = []; /* the same orders as supplier carts */
    let shown = []; /* the carts on the current page */
    let before = new Map();

    const rowsBox = $('#rows', root);
    const counts = () => countByStatus(baseList());

    const seg = mountSeg($('#oSeg', root), {
      label: 'Order status',
      active: S().status,
      items: ['All', ...STATUSES].map((k) => ({ key: k, label: k, count: counts()[k] })),
      onChange: (key) => {
        S().status = key;
        S().page = 1;
        paint(true);
      },
    });

    const cartByKey = (key) => carts.find((c) => c.key === key);
    const picked = () => carts.filter((c) => selected.has(c.key));
    const pickedItems = () => picked().flatMap((c) => c.items);

    const syncRows = () => {
      $$('.row', rowsBox).forEach((r) => {
        const on = selected.has(r.dataset.id);
        r.classList.toggle('is-sel', on);
        const box = $('input[data-sel]', r);
        if (box) box.checked = on;
      });
    };

    const paintBulk = () => {
      const bulk = $('#bulk', root);
      const n = selected.size;
      const was = !bulk.hidden;
      bulk.hidden = n === 0;
      $('#bulkN', root).textContent = String(n);
      $('#bulkWhat', root).textContent = `${n === 1 ? 'supplier' : 'suppliers'} selected · ${plural(pickedItems().length, 'order')}`;
      if (n && !was && ANIM) gsap.fromTo(bulk, { y: 70, opacity: 0 }, { y: 0, opacity: 1, duration: LITE ? 0.25 : 0.5, ease: 'back.out(1.5)', clearProps: 'transform,opacity' });
      const all = $('#selAll', root);
      all.checked = shown.length > 0 && shown.every((c) => selected.has(c.key));
      all.indeterminate = !all.checked && shown.some((c) => selected.has(c.key));
      all.disabled = !canSelect || shown.length === 0;
    };

    /* ---------- opening a supplier's product list in place ---------- */
    const rowOf = (key) => $$('.row', rowsBox).find((r) => r.dataset.id === key);
    const paintExpandAll = () => {
      const btn = $('#expAll', root);
      const some = shown.length > 0;
      const all = some && shown.every((c) => expanded.has(c.key));
      btn.disabled = !some;
      btn.classList.toggle('is-open', all);
      btn.innerHTML = `${ic('chd')}${all ? 'Collapse all' : 'Expand all'}`;
    };
    function setOpen(key, open, { animate = true } = {}) {
      const row = rowOf(key);
      const cart = cartByKey(key);
      if (!row || !cart) return;
      const panel = $('.c-more', row);
      const btn = $('.c-exp', row);
      if (!panel) return;
      open ? expanded.add(key) : expanded.delete(key);
      row.classList.toggle('is-open', open);
      const name = (row.querySelector('.c-main b') || {}).textContent || 'supplier';
      if (btn) {
        btn.setAttribute('aria-expanded', String(open));
        btn.setAttribute('aria-label', `${open ? 'Hide' : 'Show'} the ${cart.items.length === 1 ? 'product' : 'products'} for ${name}`);
        btn.title = open ? 'Hide products' : 'Show products';
      }
      gsap.killTweensOf(panel);
      if (open) {
        panel.innerHTML = cartMoreHTML(cart);
        panel.hidden = false;
        if (animate && ANIM) gsap.fromTo(panel, { height: 0, opacity: 0 }, { height: 'auto', opacity: 1, duration: LITE ? 0.2 : 0.34, ease: 'power3.out', clearProps: 'height,opacity' });
      } else if (animate && ANIM) {
        gsap.to(panel, { height: 0, opacity: 0, duration: LITE ? 0.16 : 0.26, ease: 'power2.in', onComplete: () => { panel.hidden = true; panel.innerHTML = ''; gsap.set(panel, { clearProps: 'height,opacity' }); } });
      } else {
        panel.hidden = true;
        panel.innerHTML = '';
      }
    }

    const syncControls = () => {
      const s = S();
      $('#oSup', root).value = s.supplier;
      $('#oQuick', root).value = s.quick;
      $('#oFrom', root).value = s.from;
      $('#oTo', root).value = s.to;
      $('#oPer', root).value = String(s.per);
      const pristine = s.status === 'All' && !s.q && s.supplier === 'All' && s.quick === 'all' && !s.from && !s.to;
      $('#oReset', root).disabled = pristine;
    };

    function paint(fresh = false) {
      const s = S();
      const base = baseList();
      list = s.status === 'All' ? base : base.filter((o) => o.status === s.status);
      carts = cartsOf(list);
      /* selection only keeps carts that are still listed */
      const live = new Set(carts.map((c) => c.key));
      [...selected].forEach((k) => !live.has(k) && selected.delete(k));

      s.page = clampPage(s.page, carts.length, s.per);
      const from = (s.page - 1) * s.per;
      shown = carts.slice(from, from + s.per);

      const filtered = !!(s.q || s.supplier !== 'All' || s.from || s.to || s.status !== 'All');
      const html = shown.length
        ? shown
            .map((c, i) =>
              cartRowHTML({
                cart: c,
                sl: from + i + 1,
                selected: selected.has(c.key),
                canSelect,
                total: c.sum,
                count: c.items.length,
                at: c.recent,
                mix: statusMix(c.items, STATUSES),
                open: expanded.has(c.key),
                more: expanded.has(c.key) ? cartMoreHTML(c) : '',
              })
            )
            .join('')
        : empty({
            icon: 'truck',
            title: state.orders.length ? 'No orders match' : 'No orders yet',
            body: state.orders.length ? 'Try another status, widen the dates, or clear the search.' : 'An order is created when you award an approved quote.',
            action: filtered ? `<button type="button" class="btn btn-soft" data-act="reset">${ic('refresh')}Clear filters</button>` : '',
          });
      if (fresh) {
        rowsBox.innerHTML = html;
        if (shown.length) reveal($$('.row', rowsBox).slice(0, 14), { y: 14, start: 'top 98%', stagger: 0.035 });
      } else {
        swapList(rowsBox, html, { rows: '.row' });
        flashChanged(rowsBox, before, '.row');
      }
      before = new Map(carts.map((c) => [c.key, mixSig(statusMix(c.items, STATUSES))]));

      seg.counts(countByStatus(base));
      const open = openOrderCount();
      const late = lateOrderCount();
      $('#oSub', root).textContent = `${plural(state.orders.length, 'order')} · ${open} open${late ? ` · ${late} late` : ''}`;
      const total = list.reduce((n, o) => n + (o.status === 'Cancelled' ? 0 : orderTotal(o)), 0);
      $('#oHint', root).textContent = list.length ? `${plural(carts.length, 'supplier')} · ${plural(list.length, 'order')} listed · ${money2(total)} excluding cancelled` : '';
      $('#pager', root).innerHTML = pagerHTML({ page: s.page, per: s.per, total: carts.length, unit: carts.length === 1 ? 'supplier' : 'suppliers' });
      syncControls();
      paintBulk();
      paintExpandAll();
    }
    paint(true);

    /* ---------- filters (applied as you change them) ---------- */
    const refilter = () => {
      S().page = 1;
      paint(true);
    };
    $('#oSearch', root).addEventListener(
      'input',
      debounce((e) => {
        S().q = e.target.value;
        refilter();
      }, 180)
    );
    $('#oSup', root).addEventListener('change', (e) => {
      S().supplier = e.target.value;
      refilter();
    });
    $('#oQuick', root).addEventListener('change', (e) => {
      const key = e.target.value;
      S().quick = key;
      const r = rangeOf(key);
      S().from = r ? ymd(r.from) : '';
      S().to = r ? ymd(r.to) : '';
      refilter();
    });
    const dateChange = () => {
      S().from = $('#oFrom', root).value;
      S().to = $('#oTo', root).value;
      S().quick = S().from || S().to ? 'custom' : 'all';
      refilter();
    };
    $('#oFrom', root).addEventListener('change', dateChange);
    $('#oTo', root).addEventListener('change', dateChange);
    $('#oPer', root).addEventListener('change', (e) => {
      S().per = Number(e.target.value);
      refilter();
    });

    /* ---------- selection ---------- */
    root.addEventListener('change', (e) => {
      const cb = e.target;
      if (cb.id === 'selAll') {
        shown.forEach((c) => (cb.checked ? selected.add(c.key) : selected.delete(c.key)));
        syncRows();
        paintBulk();
      } else if (cb.dataset && cb.dataset.sel) {
        cb.checked ? selected.add(cb.dataset.sel) : selected.delete(cb.dataset.sel);
        cb.closest('.row').classList.toggle('is-sel', cb.checked);
        paintBulk();
      }
    });

    /* a click on the empty part of a row opens or closes it; buttons, the checkbox and the list itself keep their own job */
    rowsBox.addEventListener('click', (e) => {
      if (e.target.closest('button, a, label, input, select, .c-more')) return;
      const row = e.target.closest('.row.crw');
      if (!row) return;
      setOpen(row.dataset.id, !expanded.has(row.dataset.id));
      paintExpandAll();
    });

    root.addEventListener('click', (e) => {
      const b = e.target.closest('[data-pg]');
      if (!b || b.disabled) return;
      S().page = Number(b.dataset.pg);
      paint(true);
      $('#oSeg', root).scrollIntoView({ block: 'start', behavior: ANIM ? 'smooth' : 'auto' });
    });

    const reset = () => {
      Object.assign(S(), { status: 'All', q: '', supplier: 'All', quick: 'all', from: '', to: '', page: 1 });
      $('#oSearch', root).value = '';
      seg.set('All');
      paint(true);
    };

    const view = (key) => navigate('order-' + key);
    const offClicks = delegate(root, {
      export: async () => {
        const result = await saveText(`medifast-orders-${stamp()}.csv`, ordersCsv(list));
        if (result === 'saved') toast(`${plural(list.length, 'order')} exported to CSV`);
      },
      open: (t) => view(t.dataset.cart),
      toggle: (t) => {
        setOpen(t.dataset.cart, !expanded.has(t.dataset.cart));
        paintExpandAll();
      },
      'expand-all': () => {
        const open = !shown.every((c) => expanded.has(c.key));
        shown.forEach((c) => setOpen(c.key, open, { animate: false }));
        paintExpandAll();
      },
      menu: (t) => {
        const cart = cartByKey(t.dataset.cart);
        if (cart) openOrderCartMenu(t, cart, { onView: () => view(cart.key) });
      },
      reset,
      'select-all': () => {
        const all = carts.filter((c) => liveOf(c.items).length);
        if (!all.length) return toast('No orders to select in this list', { type: 'err' });
        all.forEach((c) => selected.add(c.key));
        paint(false);
        toast(`${plural(all.length, 'supplier')} selected`);
      },
      'select-pending': () => {
        const pend = carts.filter((c) => c.items.some((o) => o.status === 'Pending'));
        if (!pend.length) return toast('No pending orders in this list', { type: 'err' });
        pend.forEach((c) => selected.add(c.key));
        paint(false);
        toast(`${plural(pend.length, 'supplier')} with pending orders selected`);
      },
      'bulk-clear': () => {
        selected.clear();
        paint(false);
      },
      'bulk-list': () => {
        const live = liveOf(pickedItems());
        if (!live.length) return toast('Every selected order is cancelled', { type: 'err' });
        openDocSheet('list', live);
      },
      'bulk-warehouse': () => {
        const live = liveOf(pickedItems());
        if (!live.length) return toast('Every selected order is cancelled', { type: 'err' });
        openDocSheet('warehouse', live);
      },
      'bulk-status': async () => {
        const status = $('#bStatus', root).value;
        if (await setCartStatus(pickedItems(), status)) {
          selected.clear();
          paint(false);
        }
      },
    });

    const offData = on('data', () => {
      seg.counts(counts());
      paint(false);
    });
    return () => {
      offClicks();
      offData();
      seg.destroy();
    };
  },
};
