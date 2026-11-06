import { gsap, ANIM, LITE } from '../core/motion.js';
import { esc } from '../core/dom.js';

/*
 * Segmented control with a sliding thumb. The thumb is a fixed fraction of the track,
 * so moving it is a pure xPercent transform: no measuring, no layout, resize-proof.
 *   items: [{ key, label, count? }]
 */
export function segHtml(id, items, active, { act = 'seg', attr = 'key' } = {}) {
  return `
    <div class="seg" id="${id}" role="tablist" style="--n:${items.length}">
      <i class="seg-thumb" aria-hidden="true"></i>
      ${items
        .map(
          (it) =>
            `<button type="button" role="tab" class="seg-btn${it.key === active ? ' on' : ''}" aria-selected="${it.key === active}" data-act="${act}" data-${attr}="${esc(it.key)}">${esc(it.label)}${it.count != null ? `<small>${it.count}</small>` : ''}</button>`
        )
        .join('')}
    </div>`;
}

/** Slide the thumb under whichever button currently has the .on class. */
export function moveSeg(seg, animate = true) {
  if (!seg) return;
  const buttons = Array.from(seg.querySelectorAll('.seg-btn'));
  const index = Math.max(0, buttons.findIndex((b) => b.classList.contains('on')));
  const thumb = seg.querySelector('.seg-thumb');
  if (ANIM) gsap.to(thumb, { xPercent: index * 100, duration: animate ? (LITE ? 0.3 : 0.55) : 0, ease: 'expo.out', overwrite: true });
  else thumb.style.transform = `translateX(${index * 100}%)`;
}

/** Mark one button active without re-rendering the control. */
export function selectSeg(seg, key, attr = 'key') {
  seg.querySelectorAll('.seg-btn').forEach((b) => {
    const on = b.dataset[attr] === key;
    b.classList.toggle('on', on);
    b.setAttribute('aria-selected', String(on));
  });
  moveSeg(seg, true);
}
