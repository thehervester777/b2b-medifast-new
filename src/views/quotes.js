import { $, $$, esc, delegate } from '../core/dom.js';
import { ic } from '../core/icons.js';
import { state, ui, stats } from '../core/store.js';
import { money2, fmtShort } from '../core/format.js';
import { gsap, ANIM, reveal, countUp } from '../core/motion.js';
import { segHtml, moveSeg, selectSeg } from '../components/seg.js';

const LABEL = { PENDING: 'Pending', WON: 'Won', REJECTED: 'Rejected' };

const kpi = (label, key, value, tone = '') => `<div class="kpi ${tone}"><dt>${label}</dt><dd class="num" data-count="${value}">0</dd></div>`;

function cardHtml(q) {
  const inner = `
    <div class="qc-top">
      <div><b>${esc(q.med)}</b><small>Request #${q.req} · ${esc(fmtShort(q.at))}${q.batch ? ` · via ${esc(q.batch)}` : ''}</small></div>
      <span class="status st-${q.status}">${LABEL[q.status]}</span>
    </div>
    <dl class="qc-grid">
      <div><dt>Per unit</dt><dd class="num">${money2(q.price)}</dd></div>
      <div><dt>Qty</dt><dd class="num">${q.qty}</dd></div>
      <div><dt>Total</dt><dd class="num">${money2(q.price * q.qty)}</dd></div>
      <div><dt>Rank</dt><dd><span class="rank${q.rank === 1 ? '' : ' s'}">${ic('trophy')}#${q.rank}</span></dd></div>
    </dl>`;
  return q.live ? `<a class="qcard is-link" href="#request-${q.req}">${inner}</a>` : `<article class="qcard">${inner}</article>`;
}

const items = () => {
  const all = state.quotes;
  return [
    { key: 'All', label: 'All', count: all.length },
    { key: 'PENDING', label: 'Pending', count: all.filter((q) => q.status === 'PENDING').length },
    { key: 'WON', label: 'Won', count: all.filter((q) => q.status === 'WON').length },
    { key: 'REJECTED', label: 'Rejected', count: all.filter((q) => q.status === 'REJECTED').length },
  ];
};

export default {
  title: 'My quotes',

  render() {
    const s = stats();
    return `
      <header class="p-head intro">
        <h1>My quotes</h1>
        <p>Every price you have sent, with its rank and result.</p>
      </header>
      <dl class="kpis intro">
        ${kpi('Total quotes', 'quotes', s.quotes)}${kpi('Pending', 'pending', s.pending, 'blue')}${kpi('Won', 'won', s.won, 'solid')}${kpi('Rejected', 'rejected', s.rejected, 'red')}
      </dl>
      <div class="intro">${segHtml('qSeg', items(), ui.quoteFilter, { act: 'qf' })}</div>
      <div class="q-list" id="qRows"></div>`;
  },

  mount(root) {
    let triggers = [];
    const fill = () => {
      const list = state.quotes.filter((q) => ui.quoteFilter === 'All' || q.status === ui.quoteFilter);
      const box = $('#qRows', root);
      triggers.forEach((t) => t.kill());
      if (!list.length) {
        box.innerHTML = `
          <div class="empty">
            <span class="empty-ic">${ic('receipt')}</span>
            <b>No quotes here</b>
            <span>Send a price from the board and it shows up here.</span>
            <a class="btn btn-primary" href="#board">Go to the board</a>
          </div>`;
        return;
      }
      box.innerHTML = list.map(cardHtml).join('');
      triggers = reveal($$('.qcard', box));
    };

    const stop = delegate(root, {
      qf: (b) => {
        ui.quoteFilter = b.dataset.key;
        selectSeg($('#qSeg', root), b.dataset.key);
        fill();
      },
    });

    moveSeg($('#qSeg', root), false);
    fill();
    countUp($$('[data-count]', root));
    if (ANIM) gsap.from($$('.intro', root), { y: 18, opacity: 0, duration: 0.6, stagger: 0.07, ease: 'power3.out', clearProps: 'transform,opacity' });
    return () => {
      stop();
      triggers.forEach((t) => t.kill());
    };
  },
};
