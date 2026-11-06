import { $, el, esc, lockScroll } from '../core/dom.js';
import { ic } from '../core/icons.js';
import { gsap, ANIM, LITE } from '../core/motion.js';

/*
 * One panel component for every detail, form and confirmation.
 *   kind: 'drawer'  slides in from the right on wide screens
 *   kind: 'dialog'  a centred card on wide screens
 * On phones both become a bottom sheet that can be dragged down to dismiss.
 */
let active = null;
const wide = () => window.matchMedia('(min-width: 720px)').matches;

export function openSheet({ title, subtitle = '', body, footer = '', kind = 'drawer', className = '', onMount, onClose }) {
  if (active) active.close(true);

  const wrap = el(`
    <div class="sheet-wrap is-${kind} ${className}">
      <div class="scrim" data-close></div>
      <section class="sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}" tabindex="-1">
        <div class="sheet-top">
          <div class="sheet-grip" aria-hidden="true"><i></i></div>
          <header class="sheet-head">
            <div class="sh-text"><h2>${esc(title)}</h2>${subtitle ? `<p>${esc(subtitle)}</p>` : ''}</div>
            <button type="button" class="icon-btn" data-close aria-label="Close">${ic('x')}</button>
          </header>
        </div>
        <div class="sheet-body">${body}</div>
        ${footer ? `<footer class="sheet-foot">${footer}</footer>` : ''}
      </section>
    </div>`);

  $('#layer').appendChild(wrap);
  lockScroll(true);

  const sheet = $('.sheet', wrap);
  const scrim = $('.scrim', wrap);
  const top = $('.sheet-top', wrap);
  const opener = document.activeElement;
  let closing = false;

  const onKey = (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      api.close();
    }
  };

  /* The animation for each layout, in and out. */
  const motion = () => {
    if (!wide()) return { from: { yPercent: 100 }, to: { yPercent: 0, duration: LITE ? 0.34 : 0.55, ease: 'power4.out' }, out: { yPercent: 100, duration: LITE ? 0.22 : 0.3, ease: 'power3.in' } };
    if (kind === 'drawer') return { from: { xPercent: 100 }, to: { xPercent: 0, duration: LITE ? 0.34 : 0.55, ease: 'power4.out' }, out: { xPercent: 100, duration: 0.28, ease: 'power3.in' } };
    return { from: { opacity: 0, y: 22, scale: 0.97 }, to: { opacity: 1, y: 0, scale: 1, duration: 0.4, ease: 'power3.out' }, out: { opacity: 0, y: 14, scale: 0.98, duration: 0.2, ease: 'power2.in' } };
  };

  const api = {
    wrap,
    sheet,
    body: $('.sheet-body', wrap),
    foot: $('.sheet-foot', wrap),
    /** Swap the footer buttons without closing. */
    setFooter(html) {
      let foot = $('.sheet-foot', wrap);
      if (!foot) {
        foot = document.createElement('footer');
        foot.className = 'sheet-foot';
        sheet.appendChild(foot);
      }
      foot.innerHTML = html;
      api.foot = foot;
    },
    close(immediate = false) {
      if (closing) return;
      closing = true;
      document.removeEventListener('keydown', onKey, true);
      const done = () => {
        wrap.remove();
        if (active === api) {
          active = null;
          lockScroll(false);
        }
        if (opener && opener.focus && document.contains(opener)) opener.focus({ preventScroll: true });
        if (onClose) onClose();
      };
      if (immediate || !ANIM) return done();
      gsap.to(scrim, { opacity: 0, duration: 0.22, ease: 'none' });
      gsap.to(sheet, { ...motion().out, onComplete: done });
    },
  };
  active = api;

  wrap.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) api.close();
  });
  document.addEventListener('keydown', onKey, true);

  /* drag the header down to dismiss (phones) */
  let startY = 0;
  let dy = 0;
  let t0 = 0;
  let dragging = false;
  top.addEventListener('pointerdown', (e) => {
    if (wide() || e.target.closest('button')) return;
    dragging = true;
    startY = e.clientY;
    t0 = e.timeStamp;
    top.setPointerCapture(e.pointerId);
  });
  top.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    dy = Math.max(0, e.clientY - startY);
    gsap.set(sheet, { y: dy });
    scrim.style.opacity = String(1 - Math.min(1, dy / (sheet.offsetHeight || 1)));
  });
  const endDrag = (e) => {
    if (!dragging) return;
    dragging = false;
    const velocity = dy / Math.max(1, e.timeStamp - t0);
    if (dy > 110 || velocity > 0.6) api.close();
    else {
      gsap.to(sheet, { y: 0, duration: 0.35, ease: 'power3.out' });
      scrim.style.opacity = '';
    }
    dy = 0;
  };
  top.addEventListener('pointerup', endDrag);
  top.addEventListener('pointercancel', endDrag);

  /* entrance */
  if (ANIM) {
    gsap.fromTo(scrim, { opacity: 0 }, { opacity: 1, duration: 0.3, ease: 'none', clearProps: 'opacity' });
    const m = motion();
    gsap.fromTo(sheet, m.from, m.to);
    /* the content settles in a beat after the panel itself */
    const kids = Array.from($('.sheet-body', wrap).children).slice(0, 8);
    gsap.fromTo(kids, { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: LITE ? 0.25 : 0.5, stagger: LITE ? 0.02 : 0.05, delay: 0.12, ease: 'power3.out', clearProps: 'transform,opacity' });
  }
  sheet.focus({ preventScroll: true });
  if (onMount) onMount(api);
  return api;
}

export const closeSheet = (immediate = false) => active && active.close(immediate);

/**
 * Ask before something that is hard to take back.
 *   if (await confirmDialog({ title, body, confirm: 'Delete', tone: 'danger' })) ...
 */
export function confirmDialog({ title, body, confirm = 'Confirm', cancel = 'Cancel', tone = 'primary' }) {
  return new Promise((resolve) => {
    let answered = false;
    const finish = (v) => {
      if (answered) return;
      answered = true;
      resolve(v);
    };
    const s = openSheet({
      title,
      kind: 'dialog',
      className: 'is-confirm',
      body: `<p class="confirm-text">${body}</p>`,
      footer: `<button type="button" class="btn btn-ghost" data-close>${esc(cancel)}</button><button type="button" class="btn ${tone === 'danger' ? 'btn-danger' : 'btn-primary'}" id="cfOk">${esc(confirm)}</button>`,
      onClose: () => finish(false),
    });
    $('#cfOk', s.wrap).addEventListener('click', () => {
      finish(true);
      s.close();
    });
    $('#cfOk', s.wrap).focus();
  });
}
