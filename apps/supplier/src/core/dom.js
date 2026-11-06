export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

const ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
/** Escape any untrusted value before it goes into an HTML string. */
export const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ENTITIES[c]);

/** Turn an HTML string into a single element. */
export function el(markup) {
  const t = document.createElement('template');
  t.innerHTML = markup.trim();
  return t.content.firstElementChild;
}

/**
 * Click delegation by data-act. One listener per view instead of one per button,
 * which keeps long lists light on low-end phones.
 *   delegate(root, { open: (target, event) => ... })
 */
export function delegate(root, handlers, type = 'click') {
  const listener = (event) => {
    const target = event.target.closest('[data-act]');
    if (!target || !root.contains(target)) return;
    const fn = handlers[target.dataset.act];
    if (fn) fn(target, event);
  };
  root.addEventListener(type, listener);
  return () => root.removeEventListener(type, listener);
}

export const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

/** Lock or unlock page scroll while a sheet is open. */
export function lockScroll(on) {
  document.documentElement.classList.toggle('is-locked', on);
}
