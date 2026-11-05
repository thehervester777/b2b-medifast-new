import { $, esc } from './dom.js';
import { ic } from './icons.js';
import { gsap, ANIM, LITE } from './motion.js';

const MAX_VISIBLE = 2;

/**
 * Toasts sit at the top, under the app bar, so they never fight the cart pill
 * or the bottom navigation for thumb space.
 *
 *   toast('Saved')
 *   toast('Quotation sent', { action: { label: 'Undo', fn } })
 *   toast('Nope', { type: 'err' })
 */
export function toast(message, { type = 'ok', action = null, duration = 3600 } = {}) {
  const host = $('#toasts');
  while (host.children.length >= MAX_VISIBLE) host.firstElementChild.remove();

  const node = document.createElement('div');
  node.className = `toast toast-${type}`;
  node.setAttribute('role', type === 'err' ? 'alert' : 'status');
  node.innerHTML =
    `<span class="toast-ic">${ic(type === 'err' ? 'info' : 'check')}</span>` +
    `<span class="toast-msg">${esc(message)}</span>` +
    (action ? `<button type="button" class="toast-act">${ic('undo')}${esc(action.label)}</button>` : '');
  host.appendChild(node);

  let closed = false;
  const dismiss = () => {
    if (closed) return;
    closed = true;
    if (!ANIM) return node.remove();
    gsap.to(node, { opacity: 0, y: -12, scale: 0.97, duration: 0.25, ease: 'power2.in', onComplete: () => node.remove() });
  };

  if (ANIM) gsap.fromTo(node, { opacity: 0, y: -22, scale: 0.96 }, { opacity: 1, y: 0, scale: 1, duration: LITE ? 0.3 : 0.5, ease: 'back.out(1.6)' });

  if (action) {
    $('.toast-act', node).addEventListener('click', () => {
      action.fn();
      dismiss();
    });
  }
  setTimeout(dismiss, duration);
  return { dismiss };
}
