import { $, esc, delegate } from '../core/dom.js';
import { ic } from '../core/icons.js';
import { state, on, can } from '../core/store.js';
import { toast } from '../core/toast.js';
import { navigate } from '../core/router.js';
import { money2, plural, fmtDate, fmtDateTime, fmtTime, signedPct } from '../core/format.js';
import { pill, empty } from '../components/ui.js';
import { findCart, statusMix } from '../services/carts.js';
import { STATUSES, orderCode, orderTotal, nextStatus, isOpen, isLate, updateOrderLine } from '../services/orders.js';
import { supplierOfCart, mixSig } from '../components/carts.js';
import { openOrderSheet, openOrderMenu, openDocSheet, doSetStatus } from '../components/orderpanels.js';
import { openOrderCartMenu, liveOf } from '../components/cartpanels.js';

/*
 * The details page of one supplier cart: the supplier on top, then the product list the way an
 * invoice reads (product, company, boxes, asking price, discount, price per box, amount, total),
 * and under it the change history. `order-<key>` shows the orders made from a supplier's quotes, where boxes and
 * price per box can be edited.
 */
const pct = (price, ask) => (ask ? ((price - ask) / ask) * 100 : 0);

/* ---------- the product lines ---------- */
function orderLines(cart, canEdit) {
  const rows = [...cart.items].sort((a, b) => b.createdAt - a.createdAt);
  return rows
    .map((o, i) => {
      const edit = canEdit && isOpen(o);
      const d = pct(o.price, o.ask);
      const next = nextStatus(o);
      return `
      <tr class="${o.status === 'Cancelled' ? 'is-void' : ''}" data-id="${o.id}">
        <td class="n">${i + 1}</td>
        <td><button type="button" class="cd-name" data-act="open-order" data-id="${o.id}"><b>${esc(o.name)}</b><small>${orderCode(o)}${isLate(o) ? ' · late' : ''}</small></button></td>
        <td>${esc(o.co)}</td>
        <td class="num">${edit ? `<input class="cd-in" type="number" inputmode="numeric" min="1" step="1" value="${o.qty}" data-edit="qty" data-id="${o.id}" aria-label="Boxes for ${esc(o.name)}" />` : o.qty}</td>
        <td class="num">${money2(o.ask)}</td>
        <td class="num ${d > 0 ? 'neg' : d < 0 ? 'pos' : ''}">${d === 0 ? '0%' : signedPct(d)}</td>
        <td class="num">${edit ? `<input class="cd-in wide" type="number" inputmode="decimal" min="0.01" step="0.01" value="${o.price}" data-edit="price" data-id="${o.id}" aria-label="Price per box for ${esc(o.name)}" />` : money2(o.price)}</td>
        <td class="num"><b>${money2(orderTotal(o))}</b></td>
        <td>${pill(o.status)}</td>
        <td class="acts">${can('orders.manage') && next ? `<button type="button" class="icon-btn ok" data-act="advance" data-id="${o.id}" aria-label="Move ${orderCode(o)} to ${next}" title="Move to ${next}">${ic('arrow')}</button>` : ''}<button type="button" class="icon-btn" data-act="item-menu" data-id="${o.id}" aria-label="Actions for ${orderCode(o)}" aria-haspopup="dialog" aria-expanded="false">${ic('dots')}</button></td>
      </tr>`;
    })
    .join('');
}

/* ---------- the change history ---------- */
function orderTrail(cart) {
  const out = [];
  cart.items.forEach((o) => {
    o.history.forEach((h, i) => {
      const text = h.note ? `${orderCode(o)} ${esc(o.name)}: ${esc(h.note)}` : i === 0 ? `${orderCode(o)} ${esc(o.name)} was ordered` : `${orderCode(o)} ${esc(o.name)} moved to <b>${esc(h.status)}</b>`;
      out.push({ at: h.at, by: h.by, text });
    });
  });
  return out;
}
const trailHTML = (entries) => {
  const list = entries.sort((a, b) => b.at - a.at).slice(0, 40);
  return list.length
    ? `<ol class="cd-log">${list.map((e) => `<li><span class="when"><b>${fmtDate(e.at)}</b><small>${fmtTime(e.at)}</small></span><span class="what">${e.text}</span><span class="by">${esc(e.by || "")}</span></li>`).join('')}</ol>`
    : `<p class="cd-none">No changes recorded for this cart yet.</p>`;
};

export default {
  title: 'Details',

  render() {
    return `
      <nav class="cd-crumbs" aria-label="Breadcrumb"><button type="button" class="link" data-act="back">${ic('chl')}Orders</button><span aria-hidden="true">/</span><span id="cdCrumb">Details</span></nav>
      <header class="page-head">
        <div><h1 id="cdName">Details</h1><p id="cdSub"></p></div>
        <div class="ph-actions" id="cdActs"></div>
      </header>
      <div id="cdBody"></div>`;
  },

  mount(root, params) {
    const key = params[0];
    let cart = null;

    const body = $('#cdBody', root);

    function paint() {
      cart = findCart('order', key);
      const acts = $('#cdActs', root);
      if (!cart) {
        $('#cdName', root).textContent = 'Not found';
        $('#cdSub', root).textContent = '';
        acts.innerHTML = '';
        body.innerHTML = empty({
          icon: 'search',
          title: 'This supplier list is empty',
          body: 'There are no orders for this supplier any more.',
          action: `<button type="button" class="btn btn-soft" data-act="back">${ic('chl')}Back to orders</button>`,
        });
        return;
      }
      const sup = supplierOfCart(cart);
      const items = cart.items;
      const mix = statusMix(items, STATUSES);
      const last = Math.max(...items.map((x) => x.createdAt));
      const total = liveOf(items).reduce((n, o) => n + orderTotal(o), 0);
      const canEdit = can('orders.manage');
      const name = sup ? sup.name : 'Removed supplier';

      $('#cdName', root).textContent = name;
      $('#cdCrumb', root).textContent = cart.code;
      $('#cdSub', root).textContent = `${cart.code} · ${plural(items.length, 'product')} · ${money2(total)}`;
      document.title = `${name} · Order details · MediFast Admin`;

      acts.innerHTML = `${can('orders.documents') && liveOf(items).length ? `<button type="button" class="btn btn-success" data-act="print">${ic('printer')}Print</button><button type="button" class="btn btn-ghost" data-act="warehouse">${ic('clip')}Warehouse paper</button>` : ''}${can('orders.manage') ? `<button type="button" class="btn btn-primary" data-act="menu" aria-haspopup="dialog" aria-expanded="false">${ic('menu')}Actions${ic('chd')}</button>` : ''}`;

      const lines = orderLines(cart, canEdit);
      body.innerHTML = `
        ${canEdit ? `<p class="cd-hint">Change the boxes or the price per box right in the table. Changes are saved as you go and written to the history below.</p>` : ''}
        <section class="cd-paper" aria-label="Invoice for ${esc(name)}">
          <div class="cd-top">
            <div class="cd-brand"><b>Medi<span>Fast</span></b><small>Central warehouse, Dhaka, Bangladesh</small></div>
            <div class="cd-no"><small>INVOICE</small><b>#${esc(cart.code)}</b></div>
          </div>
          <div class="cd-meta">
            <div class="cd-sup">
              <small>SUPPLIER</small>
              <b>${esc(name)}</b>
              <span>${esc(sup ? `${sup.owner}, ${sup.city}` : '')}</span>
              <span>${esc(sup ? sup.phone : '')}${sup ? ` · ${esc(sup.email)}` : ''}</span>
            </div>
            <dl class="cd-facts">
              <div><dt>Track ID</dt><dd>${esc(cart.code)}</dd></div>
              <div><dt>Last order</dt><dd>${fmtDateTime(last)}</dd></div>
              <div><dt>Products</dt><dd>${items.length}</dd></div>
              <div><dt>Status</dt><dd class="cd-chips" data-sig="${esc(mixSig(mix))}">${mix.map(([s, n]) => pill(s, `${n} ${s}`)).join('')}</dd></div>
            </dl>
          </div>
          <div class="cd-scroll">
            <table class="cd-table">
              <thead><tr><th class="n">#</th><th>Product</th><th>Company</th><th class="num">Boxes</th><th class="num">Asking</th><th class="num">Disc.</th><th class="num">Per box</th><th class="num">Amount</th><th>Status</th><th></th></tr></thead>
              <tbody>${lines}</tbody>
            </table>
          </div>
          <div class="cd-total"><span>Total</span><b>${money2(total)}</b></div>
        </section>
        <section class="cd-trail" aria-label="Change history">
          <header>${ic('undo')}<b>Order change history and audit trail</b></header>
          ${trailHTML(orderTrail(cart))}
        </section>`;
      /* labels for the phone layout, where each line becomes a small card */
      const labels = ['', 'Product', 'Company', 'Boxes', 'Asking', 'Disc.', 'Per box', 'Amount', 'Status', ''];
      body.querySelectorAll('.cd-table tbody tr').forEach((tr) => [...tr.children].forEach((td, i) => (td.dataset.l = labels[i])));
    }
    paint();

    /* ---------- editing boxes and price per box ---------- */
    root.addEventListener('change', async (e) => {
      const input = e.target;
      if (!input.dataset || !input.dataset.edit) return;
      const id = Number(input.dataset.id);
      const field = input.dataset.edit;
      const res = await updateOrderLine(id, { [field]: input.value });
      if (!res) {
        const bad = !(Number(input.value) > 0);
        if (bad) toast(field === 'qty' ? 'Boxes must be 1 or more' : 'Price per box must be more than 0', { type: 'err' });
        paint(); /* put the saved value back */
        return;
      }
      toast('Saved', { undo: res.undo });
    });

    const offClicks = delegate(root, {
      back: () => navigate('orders'),
      menu: (t) => {
        if (!cart) return;
        openOrderCartMenu(t, cart, { onView: () => {} });
      },
      print: () => cart && openDocSheet('list', liveOf(cart.items)),
      warehouse: () => cart && openDocSheet('warehouse', liveOf(cart.items)),
      'open-order': (t) => openOrderSheet(t.dataset.id),
      'item-menu': (t) => openOrderMenu(t, t.dataset.id),
      advance: (t) => {
        const o = state.orders.find((x) => x.id === Number(t.dataset.id));
        const next = o && nextStatus(o);
        if (next) doSetStatus(o.id, next);
      },
    });

    const offData = on('data', paint);
    return () => {
      offClicks();
      offData();
    };
  },
};
