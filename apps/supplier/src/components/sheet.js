import { $, el, esc, lockScroll } from '../core/dom.js';
import { ic } from '../core/icons.js';
import { gsap, ANIM, LITE } from '../core/motion.js';

/*
 * One bottom sheet used for cart, filters, sort, notifications and account editing.
 * On phones it rises from the bottom and can be dragged down to dismiss.
 * On wider screens the same markup becomes a centred dialog.
 */
let active = null;
const wide = () => window.matchMedia('(min-width: 720px)').matches;

export function openSheet({ title, body, footer = '', className = '', onMount, onClose }) {
  if (active) active.close(true);

  const wrap = el(`
    <div class="sheet-wrap ${className}">
      <div class="scrim" data-close></div>
      <section class="sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}" tabindex="-1">
        <div class="sheet-top">
          <div class="sheet-grip" aria-hidden="true"><i></i></div>
          <header class="sheet-head">
            <h2>${esc(title)}</h2>
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
    if (e.key === 'Escape') api.close();
  };

  const api = {
    wrap,
    sheet,
    body: $('.sheet-body', wrap),
    foot: $('.sheet-foot', wrap),
    close(immediate = false) {
      if (closing) return;
      closing = true;
      document.removeEventListener('keydown', onKey);
      const done = () => {
        wrap.remove();
        if (active === api) {
          active = null;
          lockScroll(false);
        }
        if (opener && opener.focus) opener.focus({ preventScroll: true });
        if (onClose) onClose();
      };
      if (immediate || !ANIM) return done();
      gsap.to(scrim, { opacity: 0, duration: 0.22, ease: 'none' });
      gsap.to(
        sheet,
        wide()
          ? { opacity: 0, y: 14, scale: 0.98, duration: 0.2, ease: 'power2.in', onComplete: done }
          : { yPercent: 100, duration: LITE ? 0.22 : 0.3, ease: 'power3.in', onComplete: done }
      );
    },
  };
  active = api;

  wrap.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) api.close();
  });
  document.addEventListener('keydown', onKey);

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
    gsap.fromTo(
      sheet,
      wide() ? { opacity: 0, y: 22, scale: 0.97 } : { yPercent: 100 },
      wide()
        ? { opacity: 1, y: 0, scale: 1, duration: 0.4, ease: 'power3.out' }
        : { yPercent: 0, duration: LITE ? 0.34 : 0.55, ease: 'power4.out' }
    );
  }
  sheet.focus({ preventScroll: true });
  if (onMount) onMount(api);
  return api;
}

export const closeSheet = (immediate = false) => active && active.close(immediate);
