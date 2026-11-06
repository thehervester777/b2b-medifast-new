import { esc } from '../core/dom.js';
import { ic } from '../core/icons.js';
import { state } from '../core/store.js';
import { money2, plural, fmtDate, fmtTime } from '../core/format.js';
import { orderCode, orderTotal, isLate } from '../services/orders.js';
import { pill } from './ui.js';

/*
 * The row for one supplier cart, shared by Quotes and Orders. It reads like an order table:
 * serial, track id, SUPPLIER name, phone, total, time, status, and an Actions button at the right.
 * The medicines themselves are on the details page, behind View details.
 */
export const supplierOfCart = (cart) => state.suppliers.find((s) => s.id === cart.supplierId);

/** The small text that says what is in a row's status cell, also used to notice changes. */
export const mixSig = (mix) => mix.map(([s, n]) => `${s}:${n}`).join(',');

/**
 * The product list that opens under a supplier's row: every medicine in the cart with boxes,
 * price per box, amount and status, and a link to the full invoice. Orders only.
 */
export function cartMoreHTML(cart) {
  const rows = [...cart.items].sort((a, b) => b.createdAt - a.createdAt);
  const live = rows.filter((o) => o.status !== 'Cancelled');
  const boxes = live.reduce((n, o) => n + o.qty, 0);
  const sum = live.reduce((n, o) => n + orderTotal(o), 0);
  const key = esc(cart.key);
  return `
    <div class="mp-head"><b>${esc(plural(rows.length, 'product'))}</b><span>${esc(plural(boxes, 'box', 'boxes'))} · ${money2(sum)}${live.length < rows.length ? ' excluding cancelled' : ''}</span><button type="button" class="link" data-act="open" data-cart="${key}">Full invoice${ic('chr')}</button></div>
    <ol class="mp-list">
      ${rows
        .map(
          (o, i) => `
        <li class="mp-line ${o.status === 'Cancelled' ? 'is-void' : ''}">
          <span class="mp-n">${i + 1}</span>
          <span class="mp-name"><b>${esc(o.name)}</b><small>${esc(o.co)} · ${orderCode(o)}${isLate(o) ? ' · late' : ''}</small></span>
          <span class="mp-qty"><b>${o.qty}</b><small>${o.qty === 1 ? 'box' : 'boxes'} × ${money2(o.price)}</small></span>
          <span class="mp-amt"><b>${money2(orderTotal(o))}</b></span>
          <span class="mp-st">${pill(o.status)}</span>
        </li>`
        )
        .join('')}
    </ol>`;
}

export function cartRowHTML({ cart, sl, selected, canSelect, total, count, at, mix, noun = 'products', open = false, more = '' }) {
  const s = supplierOfCart(cart);
  const key = esc(cart.key);
  const name = s ? s.name : 'Removed supplier';
  return `
    <article class="row crw ${selected ? 'is-sel' : ''} ${open ? 'is-open' : ''}" data-id="${key}" data-status="${esc(mixSig(mix))}">
      <label class="chk c-chk ${canSelect ? '' : 'is-off'}"><input type="checkbox" data-sel="${key}" ${selected ? 'checked' : ''} ${canSelect ? '' : 'disabled tabindex="-1"'} aria-label="Select ${esc(name)}" /><i aria-hidden="true"></i></label>
      <span class="c-sl">${sl}</span>
      <span class="c-track">${esc(cart.code)}</span>
      <button type="button" class="c-main" data-act="open" data-cart="${key}">
        <b>${esc(name)}</b>
        <small><span class="narrow-only">${esc(cart.code)} · </span>${esc(s ? s.id : '')}${cart.part > 1 ? ` · list ${cart.part}` : ''}</small>
      </button>
      <div class="c-phone">${esc(s ? s.phone : '—')}</div>
      <div class="c-price"><b>${money2(total)}</b><small>${esc(count)} ${esc(count === 1 ? noun.replace(/s$/, '') : noun)}</small></div>
      <div class="c-when"><span>${fmtDate(at)}</span><small>${fmtTime(at)}</small></div>
      <div class="c-status">${mix.map(([st, n]) => pill(st, `${n} ${st}`)).join('')}</div>
      <div class="c-acts">
        ${more !== null ? `<button type="button" class="icon-btn c-exp" data-act="toggle" data-cart="${key}" aria-expanded="${open}" aria-controls="more-${key}" aria-label="${open ? 'Hide' : 'Show'} the ${count === 1 ? 'product' : 'products'} for ${esc(name)}" title="${open ? 'Hide products' : 'Show products'}">${ic('chd')}</button>` : ''}
        <button type="button" class="btn btn-sm btn-primary btn-actions" data-act="menu" data-cart="${key}" aria-haspopup="dialog" aria-expanded="false" aria-label="Actions for ${esc(name)}">${ic('menu')}Actions${ic('chd')}</button>
      </div>
      ${more !== null ? `<div class="c-more" id="more-${key}" ${open ? '' : 'hidden'}>${open ? more : ''}</div>` : ''}
    </article>`;
}

/** The column header that lines up with cartRowHTML (shown on wide screens). */
export const cartHeadHTML = ({ when = 'Order time' } = {}) => `
  <div class="thead row-h crw" aria-hidden="true">
    <label class="chk c-chk"><input type="checkbox" id="selAll" aria-label="Select every cart on this page" /><i></i></label>
    <span class="c-sl">Sl</span><span class="c-track">Track ID</span><span class="c-main">Supplier name</span><span class="c-phone">Supplier phone</span><span class="c-price">Total price</span><span class="c-when">${esc(when)}</span><span class="c-status">Status</span><span class="c-acts"></span>
  </div>`;

export { plural };
