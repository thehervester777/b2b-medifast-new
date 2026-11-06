import { $, esc } from './dom.js';
import { ic } from './icons.js';
import { gsap, ANIM, LITE } from './motion.js';

const MAX_VISIBLE = 3;

/**
 * Toasts stack in the bottom corner (bottom centre on phones).
 *
 *   toast('Saved')
 *   toast('Quote approved', { undo: fn })
 *   toast('Nope', { type: 'err' })
 */
export function toast(message, { type = 'ok', undo = null, duration = 5200 } = {}) {
  const host = $('#toasts');
  while (host.children.length >= MAX_VISIBLE) host.firstElementChild.remove();

  const node = document.createElement('div');
  node.className = `toast toast-${type}`;
  node.setAttribute('role', type === 'err' ? 'alert' : 'status');
  node.innerHTML =
    `<span class="toast-ic">${ic(type === 'err' ? 'alert' : 'check')}</span>` +
    `<span class="toast-msg">${esc(message)}</span>` +
    (undo ? `<button type="button" class="toast-act">${ic('undo')}Undo</button>` : '') +
    `<i class="toast-bar" aria-hidden="true"></i>`;
  host.appendChild(node);

  /* On phones the stack sits at the top, so toasts drop in from above instead of rising. */
  const dir = window.matchMedia('(max-width: 719px)').matches ? -1 : 1;
  let closed = false;
  const dismiss = () => {
    if (closed) return;
    closed = true;
    if (!ANIM) return node.remove();
    gsap.to(node, { opacity: 0, y: 14 * dir, scale: 0.97, duration: 0.25, ease: 'power2.in', onComplete: () => node.remove() });
  };

  if (ANIM) {
    gsap.fromTo(node, { opacity: 0, y: 26 * dir, scale: 0.96 }, { opacity: 1, y: 0, scale: 1, duration: LITE ? 0.3 : 0.5, ease: 'back.out(1.6)' });
    const bar = $('.toast-bar', node);
    gsap.fromTo(bar, { scaleX: 1 }, { scaleX: 0, duration: duration / 1000, ease: 'none', transformOrigin: 'left center' });
  }

  if (undo) {
    $('.toast-act', node).addEventListener('click', () => {
      undo();
      dismiss();
    });
  }
  setTimeout(dismiss, duration);
  return { dismiss };
}
