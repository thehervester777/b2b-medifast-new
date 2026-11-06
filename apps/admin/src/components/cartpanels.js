import { delegate } from '../core/dom.js';
import { ic } from '../core/icons.js';
import { can } from '../core/store.js';
import { toast } from '../core/toast.js';
import { STATUSES, isOpen } from '../services/orders.js';
import { openPopover } from './popover.js';
import { doSetStatus, openDocSheet } from './orderpanels.js';

/*
 * What you can do to a whole supplier cart at once, from its Actions menu on the list or from its
 * details page. A cart is just a group of quotes or orders, so every action here works on the
 * items inside it.
 */

/* ---------- orders ---------- */
/** Delivered and cancelled orders are finished, so a cart-wide change leaves them as they are. */
export const movableOf = (items, status) => items.filter((o) => isOpen(o) && o.status !== status);
export const liveOf = (items) => items.filter((o) => o.status !== 'Cancelled');

export async function setCartStatus(items, status) {
  const todo = movableOf(items, status);
  if (!todo.length) {
    toast(`Nothing in this cart can move to ${status}. Delivered and cancelled orders stay as they are.`, { type: 'err' });
    return false;
  }
  return doSetStatus(todo.map((o) => o.id), status);
}

export function openOrderCartMenu(anchor, cart, { onView }) {
  const canStatus = can('orders.manage');
  const canDocs = can('orders.documents');
  const live = liveOf(cart.items);
  return openPopover(
    anchor,
    `
    <div class="pop-menu">
      <button type="button" data-act="view">${ic('eye')}View details</button>
      ${canDocs && live.length ? `<button type="button" data-act="invoice">${ic('printer')}Print invoice</button><button type="button" data-act="warehouse">${ic('clip')}Warehouse paper</button>` : ''}
    </div>
    ${
      canStatus
        ? `<div class="pop-sub">Change status</div>
           <div class="pop-menu">${STATUSES.map((st) => {
             const n = movableOf(cart.items, st).length;
             const here = cart.items.length > 0 && cart.items.every((o) => o.status === st);
             return `<button type="button" data-act="to" data-st="${st}" class="${here ? 'is-cur' : ''}" ${n ? '' : 'disabled'}>${here ? ic('check') : ic('chr')}${st}${here ? '<em>current</em>' : n ? `<em>${n}</em>` : ''}</button>`;
           }).join('')}</div>`
        : ''
    }`,
    {
      className: 'pop-order',
      onMount: (api) =>
        delegate(api.node, {
          view: () => {
            api.close();
            onView();
          },
          invoice: () => {
            api.close();
            openDocSheet('list', live);
          },
          warehouse: () => {
            api.close();
            openDocSheet('warehouse', live);
          },
          to: (t) => {
            api.close();
            setCartStatus(cart.items, t.dataset.st);
          },
        }),
    }
  );
}
