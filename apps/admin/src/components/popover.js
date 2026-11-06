import { $, el } from '../core/dom.js';
import { gsap, ANIM, LITE } from '../core/motion.js';

/*
 * A small floating panel anchored under a button: the bell, the account menu.
 * Closes on outside click, Escape, or after you pick something.
 */
let current = null;

export function closePopover(immediate = false) {
  if (current) current.close(immediate);
}

export function openPopover(anchor, html, { className = '', onMount } = {}) {
  const same = current && current.anchor === anchor;
  closePopover(true);
  if (same) return null; /* tapping the same button again toggles it shut */

  const node = el(`<div class="popover ${className}" role="dialog" tabindex="-1">${html}</div>`);
  $('#layer').appendChild(node);
  anchor.setAttribute('aria-expanded', 'true');

  let flipped = false;
  const place = () => {
    const a = anchor.getBoundingClientRect();
    node.style.right = Math.max(12, innerWidth - a.right) + 'px';
    node.style.top = a.bottom + 10 + 'px';
    node.style.bottom = 'auto';
    /* near the bottom of the screen, open upward so the menu is never cut off */
    const h = node.offsetHeight;
    flipped = a.bottom + 10 + h > innerHeight - 12 && a.top - 10 - h > 12;
    if (flipped) {
      node.style.top = 'auto';
      node.style.bottom = innerHeight - a.top + 10 + 'px';
    }
    node.classList.toggle('is-up', flipped);
  };
  place();

  let closed = false;
  const api = {
    anchor,
    node,
    close(immediate = false) {
      if (closed) return;
      closed = true;
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', place);
      anchor.setAttribute('aria-expanded', 'false');
      if (current === api) current = null;
      if (immediate || !ANIM) return node.remove();
      gsap.to(node, { opacity: 0, y: flipped ? 6 : -6, scale: 0.98, duration: 0.15, ease: 'power2.in', onComplete: () => node.remove() });
    },
  };
  const onDown = (e) => {
    if (!node.contains(e.target) && !anchor.contains(e.target)) api.close();
  };
  const onKey = (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      api.close();
      anchor.focus({ preventScroll: true });
    }
  };
  document.addEventListener('pointerdown', onDown, true);
  document.addEventListener('keydown', onKey, true);
  window.addEventListener('resize', place);
  current = api;

  if (ANIM) gsap.fromTo(node, { opacity: 0, y: flipped ? 10 : -10, scale: 0.97, transformOrigin: flipped ? 'bottom right' : 'top right' }, { opacity: 1, y: 0, scale: 1, duration: LITE ? 0.22 : 0.35, ease: 'power3.out' });
  node.focus({ preventScroll: true });
  if (onMount) onMount(api);
  return api;
}
