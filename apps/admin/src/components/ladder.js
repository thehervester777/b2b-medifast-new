import { $$, esc } from '../core/dom.js';
import { gsap, ANIM, LITE, onView } from '../core/motion.js';
import { money } from '../core/format.js';

/*
 * The price ladder: one request's asking price and every supplier quote on a single
 * price scale. It shows at a glance who is cheapest, who is above the asking price,
 * and where the quote under review sits among the others.
 */
const KIND = { Pending: 'wait', Approved: 'ok', Awarded: 'won', Rejected: 'off' };

export function ladderHTML(request, items, highlightId = null) {
  const ask = request.ask;
  if (!items.length) {
    return `<div class="ladder is-empty"><div class="ld-track"></div><span class="ld-ask" style="left:50%"><i></i><b>Asking ${money(ask)}</b></span><p class="ld-note">No quotes yet</p></div>`;
  }
  const prices = items.map((x) => x.q.price);
  let lo = Math.min(ask, ...prices);
  let hi = Math.max(ask, ...prices);
  const pad = Math.max((hi - lo) * 0.14, ask * 0.03);
  lo -= pad;
  hi += pad;
  const at = (v) => Math.min(95, Math.max(5, ((v - lo) / (hi - lo)) * 100));
  const live = items.filter((x) => x.q.status !== 'Rejected');
  const cheapest = (live.length ? live : items).reduce((m, x) => (x.q.price < m.q.price ? x : m));

  const dots = items
    .slice()
    .sort((a, b) => a.q.price - b.q.price)
    .map(({ q, sup }) => {
      const breach = q.price > ask;
      const cls = [
        'ld-dot',
        'k-' + KIND[q.status],
        breach ? 'is-breach' : '',
        q.id === highlightId ? 'is-hl' : '',
        q.id === cheapest.q.id ? 'is-low' : '',
      ]
        .filter(Boolean)
        .join(' ');
      const label = q.id === highlightId || q.id === cheapest.q.id ? `<em>${money(q.price)}</em>` : '';
      return `<span class="${cls}" style="left:${at(q.price).toFixed(2)}%" title="${esc((sup ? sup.name : 'Supplier') + ' · ' + money(q.price) + ' · ' + q.status)}"><i></i>${label}</span>`;
    })
    .join('');

  const askAt = at(ask);
  const lowAt = at(cheapest.q.price);
  const fillLeft = Math.min(askAt, lowAt);
  const fillW = Math.abs(askAt - lowAt);

  return `
    <div class="ladder" role="img" aria-label="Quotes from ${money(Math.min(...prices))} to ${money(Math.max(...prices))} against an asking price of ${money(ask)}">
      <div class="ld-track"><i class="ld-fill" style="left:${fillLeft.toFixed(2)}%;width:${fillW.toFixed(2)}%"></i></div>
      <span class="ld-ask" style="left:${askAt.toFixed(2)}%"><i></i><b>Asking ${money(ask)}</b></span>
      ${dots}
    </div>`;
}

/** Dots pop in from the track, left to right. */
export function animateLadder(root, { scroll = false } = {}) {
  const run = () => {
    if (!ANIM) return;
    $$('.ld-dot i', root).forEach((d) => gsap.set(d, { scale: 0 }));
    gsap.to($$('.ld-dot i', root), { scale: 1, duration: LITE ? 0.3 : 0.55, stagger: 0.06, ease: 'back.out(2.4)', clearProps: 'transform', delay: 0.1 });
    gsap.fromTo($$('.ld-fill', root), { scaleX: 0, transformOrigin: 'left center' }, { scaleX: 1, duration: 0.7, ease: 'power3.out', clearProps: 'transform', delay: 0.05 });
  };
  if (scroll) onView(root, run);
  else run();
}
