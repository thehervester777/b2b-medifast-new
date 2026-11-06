import { $, $$, esc } from '../core/dom.js';
import { ic } from '../core/icons.js';
import { gsap, ANIM, LITE, flash, pop } from '../core/motion.js';
import { initials } from '../core/format.js';

/* ---------- status pills: one look for every status in the panel ---------- */
const KIND = {
  Active: 'blue',
  Completed: 'solid',
  Expired: 'mute',
  Pending: 'wait',
  Approved: 'blue',
  Awarded: 'solid',
  Rejected: 'red',
  Verified: 'blue',
  Suspended: 'redsolid',
  'In transit': 'transit',
  Delivered: 'solid',
  Cancelled: 'red',
  Inactive: 'mute',
  Owner: 'solid',
};
export const pill = (status, label = status) => `<span class="pill p-${KIND[status] || 'mute'}" data-status="${esc(status)}">${esc(label)}</span>`;

export const tag = (text, tone = 'red') => `<span class="tag t-${tone}">${esc(text)}</span>`;

export const avatar = (name, cls = '') => `<span class="av ${cls}" aria-hidden="true">${esc(initials(name))}</span>`;

export const empty = ({ icon = 'search', title, body = '', action = '' }) => `
  <div class="empty">
    <span class="empty-ic">${ic(icon)}</span>
    <b>${esc(title)}</b>
    ${body ? `<p>${esc(body)}</p>` : ''}
    ${action}
  </div>`;

/**
 * After a list is redrawn, show which rows changed status: a soft wash and a popping pill.
 *   const before = statusSnap(list); ...redraw...; flashChanged(root, before);
 * Rows need data-id and data-status.
 */
export const statusSnap = (arr) => new Map(arr.map((x) => [String(x.id), x.status]));
export function flashChanged(root, before, selector = '[data-id]') {
  $$(selector, root).forEach((n) => {
    const was = before.get(n.dataset.id);
    if (was !== undefined && was !== n.dataset.status) {
      flash(n);
      pop($('.pill', n), 1.3);
    }
  });
}

/**
 * Replace the rows of a list, letting rows that disappear leave first (slide out and
 * collapse) and new rows ease in. Rows need a data-id.
 *   swapList(listNode, newHTML, { rows: '.qrow' })
 */
let swapToken = 0;
export function swapList(list, html, { rows = '[data-id]' } = {}) {
  const token = ++swapToken;
  list._swap = token;
  const incoming = document.createElement('div');
  incoming.innerHTML = html;
  const nextIds = new Set($$(rows, incoming).map((n) => n.dataset.id));
  const oldNodes = $$(rows, list);
  const oldIds = new Set(oldNodes.map((n) => n.dataset.id));
  const leaving = oldNodes.filter((n) => !nextIds.has(n.dataset.id));

  const commit = () => {
    if (list._swap !== token) return;
    list.innerHTML = html;
    if (ANIM && oldNodes.length) {
      const fresh = $$(rows, list).filter((n) => !oldIds.has(n.dataset.id)).slice(0, 12);
      if (fresh.length) gsap.fromTo(fresh, { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: LITE ? 0.25 : 0.45, stagger: 0.04, ease: 'power3.out', clearProps: 'transform,opacity' });
    }
  };
  if (!ANIM || !leaving.length) return commit();
  gsap.to(leaving, {
    opacity: 0,
    x: 36,
    height: 0,
    paddingTop: 0,
    paddingBottom: 0,
    marginTop: 0,
    marginBottom: 0,
    duration: LITE ? 0.22 : 0.34,
    ease: 'power2.in',
    overwrite: true,
    onComplete: commit,
  });
}

/* ---------- segmented tabs with a sliding highlight ---------- */
export function mountSeg(root, { items, active, onChange, label = 'Filter' }) {
  root.classList.add('seg');
  root.setAttribute('role', 'tablist');
  root.setAttribute('aria-label', label);
  root.innerHTML =
    '<i class="seg-ink" aria-hidden="true"></i>' +
    items
      .map(
        (i) =>
          `<button type="button" role="tab" data-key="${esc(i.key)}" aria-selected="false" tabindex="-1">${esc(i.label)}${i.count != null ? `<b class="seg-n" data-n="${esc(i.key)}">${i.count}</b>` : ''}</button>`
      )
      .join('');
  const ink = $('.seg-ink', root);
  let cur = active;

  const place = (animate = true) => {
    const btn = $(`[data-key="${cur}"]`, root);
    if (!btn) return;
    $$('button', root).forEach((b) => {
      const on = b === btn;
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
    });
    const vars = { x: btn.offsetLeft, width: btn.offsetWidth };
    if (ANIM && animate) gsap.to(ink, { ...vars, duration: LITE ? 0.25 : 0.5, ease: 'expo.out', overwrite: true });
    else gsap.set(ink, vars);
    if (animate && btn.scrollIntoView) btn.scrollIntoView({ inline: 'nearest', block: 'nearest', behavior: ANIM ? 'smooth' : 'auto' });
  };
  const choose = (key, focus) => {
    if (key === cur) return;
    cur = key;
    place();
    if (focus) $(`[data-key="${key}"]`, root).focus();
    onChange(key);
  };

  root.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-key]');
    if (b) choose(b.dataset.key, false);
  });
  root.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const keys = items.map((i) => i.key);
    const next = keys[(keys.indexOf(cur) + (e.key === 'ArrowRight' ? 1 : keys.length - 1)) % keys.length];
    e.preventDefault();
    choose(next, true);
  });

  place(false);
  requestAnimationFrame(() => place(false));
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => place(false));
  const onResize = () => place(false);
  window.addEventListener('resize', onResize);

  return {
    set(key) {
      cur = key;
      place();
    },
    counts(map) {
      Object.entries(map).forEach(([k, v]) => {
        const n = $(`[data-n="${k}"]`, root);
        if (n) n.textContent = v;
      });
      place(false);
    },
    destroy: () => window.removeEventListener('resize', onResize),
  };
}

/* ---------- form helpers ---------- */
export const field = ({ id, label, type = 'text', value = '', placeholder = '', hint = '', attrs = '', prefix = '' }) => `
  <div class="field" id="f-${id}">
    <label for="${id}">${esc(label)}</label>
    <div class="input">${prefix ? `<span class="pre">${esc(prefix)}</span>` : ''}<input id="${id}" name="${id}" type="${type}" value="${esc(value)}" placeholder="${esc(placeholder)}" ${attrs} /></div>
    ${hint ? `<small class="hint">${esc(hint)}</small>` : ''}
    <small class="err" id="e-${id}" role="alert"></small>
  </div>`;

export const selectField = ({ id, label, options, value = '' }) => `
  <div class="field" id="f-${id}">
    <label for="${id}">${esc(label)}</label>
    <div class="input select"><select id="${id}" name="${id}">${options
      .map((o) => {
        const v = typeof o === 'string' ? o : o.value;
        const l = typeof o === 'string' ? o : o.label;
        return `<option value="${esc(v)}" ${v === value ? 'selected' : ''}>${esc(l)}</option>`;
      })
      .join('')}</select>${ic('chd', 'sel-ic')}</div>
    <small class="err" id="e-${id}" role="alert"></small>
  </div>`;

export function setError(root, id, message) {
  const box = $(`#f-${id}`, root);
  const err = $(`#e-${id}`, root);
  if (!box || !err) return;
  box.classList.toggle('bad', !!message);
  err.textContent = message || '';
}

export const toggle = ({ id, label, hint = '', on = false }) => `
  <label class="switch-row" for="${id}">
    <span class="sw-text"><b>${esc(label)}</b>${hint ? `<small>${esc(hint)}</small>` : ''}</span>
    <span class="switch"><input type="checkbox" id="${id}" ${on ? 'checked' : ''} /><i aria-hidden="true"></i></span>
  </label>`;

/* ---------- page numbers: "Showing 1–25 of 140" with a window of page links ---------- */
export const PER_OPTIONS = [10, 25, 50, 100];

export const pagesOf = (total, per) => Math.max(1, Math.ceil(total / per));

/** The numbers to show: first, last, and two either side of the current page. */
function windowOf(page, pages) {
  const keep = new Set([1, pages, page - 1, page, page + 1]);
  if (page <= 3) [2, 3, 4].forEach((n) => keep.add(n));
  if (page >= pages - 2) [pages - 1, pages - 2, pages - 3].forEach((n) => keep.add(n));
  const nums = [...keep].filter((n) => n >= 1 && n <= pages).sort((a, b) => a - b);
  const out = [];
  nums.forEach((n, i) => {
    if (i && n - nums[i - 1] > 1) out.push('gap');
    out.push(n);
  });
  return out;
}

/**
 * Markup for the bar under a table. Buttons carry data-pg="<page>"; wire them with one
 * delegated listener on the container: [data-pg] -> page = Number(dataset.pg).
 */
export function pagerHTML({ page, per, total, unit = '' }) {
  if (!total) return '';
  const pages = pagesOf(total, per);
  const from = (page - 1) * per + 1;
  const to = Math.min(total, page * per);
  const nums = windowOf(page, pages)
    .map((n) => (n === 'gap' ? '<i class="pg-gap" aria-hidden="true">…</i>' : `<button type="button" class="pg ${n === page ? 'is-cur' : ''}" data-pg="${n}" ${n === page ? 'aria-current="page"' : ''} aria-label="Page ${n}">${n}</button>`))
    .join('');
  return `
    <span class="pg-info">Showing <b>${from}–${to}</b> of <b>${total}</b>${unit ? ' ' + unit : ''}</span>
    ${
      pages > 1
        ? `<nav class="pg-nav" aria-label="Pages">
            <button type="button" class="pg pg-arrow" data-pg="${page - 1}" ${page === 1 ? 'disabled' : ''} aria-label="Previous page">${ic('chl')}</button>
            ${nums}
            <button type="button" class="pg pg-arrow" data-pg="${page + 1}" ${page === pages ? 'disabled' : ''} aria-label="Next page">${ic('chr')}</button>
          </nav>`
        : ''
    }`;
}

/** Keep a page number inside the pages that exist after a filter shrinks the list. */
export const clampPage = (page, total, per) => Math.min(Math.max(1, page), pagesOf(total, per));

/** A small <select> styled like the toolbar ones. */
export const selectHTML = ({ id, label, options, value, cls = '' }) => `
  <div class="select sel-inline ${cls}"><select id="${id}" aria-label="${esc(label)}">${options
    .map((o) => {
      const v = Array.isArray(o) ? o[0] : o;
      const l = Array.isArray(o) ? o[1] : o;
      return `<option value="${esc(v)}" ${String(v) === String(value) ? 'selected' : ''}>${esc(l)}</option>`;
    })
    .join('')}</select>${ic('chd', 'sel-ic')}</div>`;
