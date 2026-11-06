import { $, $$, el, esc, lockScroll } from '../core/dom.js';
import { ic } from '../core/icons.js';
import { state, ui, signOut, can } from '../core/store.js';
import { navigate } from '../core/router.js';
import { gsap, ANIM, LITE } from '../core/motion.js';
import { closeSheet } from './sheet.js';
import { closePopover } from './popover.js';
import { openRequestSheet, openQuoteSheet, openSupplierSheet, openRequestForm, exportFile } from './panels.js';
import * as A from '../services/admin.js';
import { reqSub, money } from '../core/format.js';
import { PAGES as NAV_PAGES } from '../core/nav.js';
import { orderCode, orderTotal, supplierOf } from '../services/orders.js';
import { openOrderSheet } from './orderpanels.js';
import { openSendSheet } from './sendsheet.js';
import { needsRestock } from '../services/catalog.js';

/*
 * Command palette (Ctrl/Cmd + K, or "/"): jump to a page, run a common action, or find a
 * request, supplier or quote by name or code. Built for keyboard use, works by touch too.
 */
let open = null;

/* Pages and actions follow the signed-in admin's role: nothing is offered that they cannot open. */
const pages = () => NAV_PAGES.filter((p) => can(p.perm));

const actions = () =>
  [
    can('quotes.decide') && can('requests.view') && { icon: 'quotes', label: 'Review pending quotes', hint: `${state.quotes.filter((q) => q.status === 'Pending').length} waiting`, run: () => { Object.assign(ui.requests, { status: 'To review', q: '', co: 'All' }); navigate('requests'); } },
    can('requests.manage') && { icon: 'plus', label: 'New request', hint: 'Post to suppliers', run: () => openRequestForm() },
    can('orders.view') && { icon: 'truck', label: 'Orders in transit', hint: `${state.orders.filter((o) => o.status === 'In transit').length} on the way`, run: () => { Object.assign(ui.orders, { status: 'In transit', q: '', supplier: 'All', quick: 'all', from: '', to: '', page: 1 }); navigate('orders'); } },
    can('products.send') && { icon: 'send', label: 'Send low stock to suppliers', hint: `${needsRestock().length} need restocking`, run: () => openSendSheet(needsRestock().map((p) => p.id)) },
    can('suppliers.manage') && { icon: 'building', label: 'Verify suppliers', hint: `${state.suppliers.filter((s) => s.status === 'Pending').length} waiting`, run: () => { ui.suppliers.status = 'Pending'; ui.suppliers.q = ''; navigate('suppliers'); } },
    can('quotes.view') && { icon: 'download', label: 'Export quotes to CSV', hint: 'All quotes', run: () => exportFile('quotes') },
    { icon: 'logout', label: 'Sign out', hint: '', run: () => signOut() },
  ].filter(Boolean);

const has = (s, q) => String(s).toLowerCase().includes(q);

function search(raw) {
  const q = raw.trim().toLowerCase();
  const groups = [];
  const pageItems = pages().filter((p) => !q || has(p.label, q)).map((p) => ({ icon: p.icon, label: p.label, hint: 'Go to page', run: () => navigate(p.key) }));
  const acts = actions().filter((a) => !q || has(a.label, q));
  if (pageItems.length) groups.push({ title: 'Go to', items: pageItems });
  if (acts.length) groups.push({ title: 'Do something', items: acts });
  if (q) {
    const reqs = (!can('requests.view') ? [] : state.requests)
      .filter((r) => has(r.name, q) || has(r.generic, q) || has(r.co, q) || has(A.reqCode(r), q))
      .slice(0, 5)
      .map((r) => ({ icon: 'requests', label: r.name, hint: `${A.reqCode(r)} · ${reqSub(r)}`, run: () => openRequestSheet(r.id) }));
    const sups = (!can('suppliers.view') ? [] : state.suppliers)
      .filter((s) => has(s.name, q) || has(s.owner, q) || has(s.id, q) || has(s.city, q))
      .slice(0, 4)
      .map((s) => ({ icon: 'building', label: s.name, hint: `${s.id} · ${s.city} · ${s.status}`, run: () => openSupplierSheet(s.id) }));
    const quotes = (!can('quotes.view') ? [] : state.quotes)
      .filter((x) => {
        const r = A.reqById(x.reqId);
        const s = A.supById(x.supplierId);
        return has(A.quoteCode(x), q) || (s && has(s.name, q)) || (r && has(r.name, q));
      })
      .slice(0, 5)
      .map((x) => {
        const r = A.reqById(x.reqId);
        const s = A.supById(x.supplierId);
        return { icon: 'quotes', label: `${A.quoteCode(x)} · ${s ? s.name : ''}`, hint: `${r ? r.name : ''} · ${money(x.price)} · ${x.status}`, run: () => openQuoteSheet(x.id) };
      });
    const orders = (!can('orders.view') ? [] : state.orders)
      .filter((o) => {
        const sup = supplierOf(o);
        return has(orderCode(o), q) || has('INV-' + o.id, q) || has(o.name, q) || has(o.co, q) || (sup && has(sup.name, q));
      })
      .slice(0, 5)
      .map((o) => ({ icon: 'truck', label: `${orderCode(o)} · ${o.name}`, hint: `${(supplierOf(o) || {}).name || ''} · ${money(orderTotal(o))} · ${o.status}`, run: () => openOrderSheet(o.id) }));
    const products = (!can('products.view') ? [] : state.products)
      .filter((pr) => has(pr.name, q) || has(pr.generic, q) || has(pr.brand, q) || has(pr.code, q))
      .slice(0, 4)
      .map((pr) => ({ icon: 'box', label: pr.name, hint: `${pr.code} · ${pr.stock} in stock`, run: () => { Object.assign(ui.products, { q: pr.name, brand: 'All', max: '', sort: 'new', page: 1 }); navigate('products'); } }));
    if (reqs.length) groups.push({ title: 'Requests', items: reqs });
    if (orders.length) groups.push({ title: 'Orders', items: orders });
    if (products.length) groups.push({ title: 'Products', items: products });
    if (sups.length) groups.push({ title: 'Suppliers', items: sups });
    if (quotes.length) groups.push({ title: 'Quotes', items: quotes });
  }
  return groups;
}

export function closePalette(immediate = false) {
  if (open) open.close(immediate);
}

export function openPalette() {
  if (open) return closePalette();
  closePopover(true);
  closeSheet(true);

  const wrap = el(`
    <div class="pal-wrap">
      <div class="scrim" data-close></div>
      <div class="pal" role="dialog" aria-modal="true" aria-label="Search and commands">
        <div class="pal-in">
          ${ic('search')}
          <input id="palQ" type="text" placeholder="Search requests, suppliers, quotes, or jump to a page" autocomplete="off" spellcheck="false" role="combobox" aria-expanded="true" aria-controls="palList" aria-autocomplete="list" />
          <kbd>Esc</kbd>
        </div>
        <ul class="pal-list" id="palList" role="listbox" aria-label="Results"></ul>
        <div class="pal-foot"><span><kbd>↑</kbd><kbd>↓</kbd>move</span><span><kbd>↵</kbd>open</span><span><kbd>Esc</kbd>close</span></div>
      </div>
    </div>`);
  $('#layer').appendChild(wrap);
  lockScroll(true);

  const input = $('#palQ', wrap);
  const list = $('#palList', wrap);
  const panel = $('.pal', wrap);
  const scrim = $('.scrim', wrap);
  const opener = document.activeElement;
  let flat = [];
  let idx = 0;
  let closed = false;

  const paint = () => {
    const groups = search(input.value);
    flat = [];
    list.innerHTML = groups.length
      ? groups
          .map(
            (g) =>
              `<li class="pal-group" role="presentation">${esc(g.title)}</li>` +
              g.items
                .map((it) => {
                  const i = flat.push(it) - 1;
                  return `<li class="pal-item" role="option" id="pal-${i}" data-i="${i}" aria-selected="false"><span class="pi-ic">${ic(it.icon)}</span><span class="pi-t"><b>${esc(it.label)}</b>${it.hint ? `<small>${esc(it.hint)}</small>` : ''}</span><span class="pi-go">${ic('chr')}</span></li>`;
                })
                .join('')
          )
          .join('')
      : `<li class="pal-none" role="presentation">Nothing matches “${esc(input.value.trim())}”. Try a medicine, supplier or quote code.</li>`;
    idx = 0;
    mark();
  };
  const mark = () => {
    $$('.pal-item', list).forEach((n) => n.setAttribute('aria-selected', String(Number(n.dataset.i) === idx)));
    const cur = $('#pal-' + idx, list);
    if (cur) {
      input.setAttribute('aria-activedescendant', 'pal-' + idx);
      cur.scrollIntoView({ block: 'nearest' });
    }
  };
  const run = (i) => {
    const it = flat[i];
    if (!it) return;
    api.close(true);
    setTimeout(it.run, 0);
  };

  const api = {
    close(immediate = false) {
      if (closed) return;
      closed = true;
      document.removeEventListener('keydown', onKey, true);
      open = null;
      const done = () => {
        wrap.remove();
        lockScroll(false);
        if (opener && opener.focus && document.contains(opener)) opener.focus({ preventScroll: true });
      };
      if (immediate || !ANIM) return done();
      gsap.to(scrim, { opacity: 0, duration: 0.18, ease: 'none' });
      gsap.to(panel, { opacity: 0, y: -10, scale: 0.98, duration: 0.18, ease: 'power2.in', onComplete: done });
    },
  };
  open = api;

  const onKey = (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      api.close();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      idx = flat.length ? (idx + 1) % flat.length : 0;
      mark();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      idx = flat.length ? (idx + flat.length - 1) % flat.length : 0;
      mark();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      run(idx);
    } else if (e.key === 'Tab') {
      e.preventDefault();
    }
  };
  document.addEventListener('keydown', onKey, true);
  input.addEventListener('input', paint);
  list.addEventListener('pointermove', (e) => {
    const it = e.target.closest('.pal-item');
    if (it && Number(it.dataset.i) !== idx) {
      idx = Number(it.dataset.i);
      mark();
    }
  });
  list.addEventListener('click', (e) => {
    const it = e.target.closest('.pal-item');
    if (it) run(Number(it.dataset.i));
  });
  wrap.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) api.close();
  });

  paint();
  if (ANIM) {
    gsap.fromTo(scrim, { opacity: 0 }, { opacity: 1, duration: 0.25, ease: 'none', clearProps: 'opacity' });
    gsap.fromTo(panel, { opacity: 0, y: -18, scale: 0.97 }, { opacity: 1, y: 0, scale: 1, duration: LITE ? 0.25 : 0.4, ease: 'power3.out' });
  }
  input.focus();
  return api;
}
