import { esc, delegate } from '../core/dom.js';
import { ic } from '../core/icons.js';
import { state, findReq, lineQty, cartTotal, removeFromCart, clearCart, sendCart, on } from '../core/store.js';
import { money2, plural } from '../core/format.js';
import { gsap, ANIM } from '../core/motion.js';
import { navigate } from '../core/router.js';
import { toast } from '../core/toast.js';
import { openSheet } from './sheet.js';

/* The cart sheet. It re-renders live while open, so removing an item never closes it. */

const itemsHtml = () =>
  state.cart
    .map((id) => {
      const r = findReq(id);
      if (!r) return '';
      const q = lineQty(id);
      return `
        <li class="ci" data-id="${id}">
          <div class="ci-main">
            <b>${esc(r.name)}</b>
            <small>${r.co ? esc(r.co) + ' · ' : ''}${q} Box × ${money2(r.ask)}</small>
          </div>
          <b class="num ci-sum">${money2(q * r.ask)}</b>
          <button type="button" class="icon-btn sm" data-act="rm" data-id="${id}" aria-label="Remove ${esc(r.name)} from cart">${ic('x')}</button>
        </li>`;
    })
    .join('');

const bodyHtml = () => `<ul class="ci-list">${itemsHtml()}</ul>`;

const footHtml = () => {
  const n = state.cart.length;
  return `
    <div class="cart-total"><span>Total at asking price</span><b class="num">${money2(cartTotal())}</b></div>
    <div class="foot-actions">
      <button type="button" class="btn btn-soft" data-act="clear">Clear</button>
      <button type="button" class="btn btn-primary" data-act="send">${ic('send')}<span>Send ${plural(n, 'quotation')}</span></button>
    </div>`;
};

export function openCart() {
  if (!state.cart.length) {
    toast('Your cart is empty. Tap Add to cart on a request.');
    return;
  }
  let off = () => {};
  let stop = () => {};

  const api = openSheet({
    title: 'Your cart',
    className: 'cart-sheet',
    body: bodyHtml(),
    footer: footHtml(),
    onClose: () => {
      off();
      stop();
    },
  });

  const rerender = () => {
    if (!state.cart.length) return api.close();
    api.body.innerHTML = bodyHtml();
    api.foot.innerHTML = footHtml();
  };
  const offCart = on('cart', rerender);
  const offQty = on('qty', rerender);
  off = () => {
    offCart();
    offQty();
  };

  stop = delegate(api.wrap, {
    rm: (btn) => {
      const row = btn.closest('.ci');
      const remove = () => removeFromCart(Number(btn.dataset.id));
      if (ANIM && row) gsap.to(row, { x: 40, opacity: 0, duration: 0.25, ease: 'power2.in', onComplete: remove });
      else remove();
    },
    clear: () => clearCart(),
    send: async (btn) => {
      if (btn.disabled) return;
      btn.disabled = true;
      const res = await sendCart();
      api.close();
      if (!res.ok) return toast(res.error, { type: 'err' });
      const { batch, skipped } = res;
      if (batch) toast(`${plural(batch.items.length, 'quotation')} sent as ${batch.id}, total ${money2(batch.total)}${skipped.length ? `. ${plural(skipped.length, 'request')} could not be sent.` : ''}`);
      navigate('submissions');
    },
  });
}
