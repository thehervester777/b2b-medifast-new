import { $, $$, esc, delegate } from '../core/dom.js';
import { ic } from '../core/icons.js';
import { state, ui, stats } from '../core/store.js';
import { money2, fmtWhen, plural } from '../core/format.js';
import { gsap, ANIM, reveal, countUp } from '../core/motion.js';
import { toast } from '../core/toast.js';
import { downloadSubmission } from '../services/pdf.js';

function cardHtml(b) {
  const open = ui.openBatches.has(b.id);
  const boxes = plural(b.qty, 'box', 'boxes');
  const items = b.items
    .map(
      (i) => `
      <li class="sub-row">
        <div><b>${esc(i.name)}</b><small>${esc(i.co)} • Request #${i.req}</small></div>
        <div class="sr-nums"><span class="num">${i.qty} Box × ${money2(i.price)}</span><b class="num">${money2(i.total)}</b></div>
      </li>`
    )
    .join('');

  return `
    <article class="sub-card${state.lastBatch === b.id ? ' is-new' : ''}${open ? ' open' : ''}" data-batch="${b.id}">
      <header class="sub-h">
        <button type="button" class="sub-toggle" data-act="toggle" data-id="${b.id}" aria-expanded="${open}" aria-controls="sb-${b.id}">
          <span class="sub-chev">${ic('chd')}</span>
          <span class="sub-ids"><b class="num">${b.id}</b><small>${esc(fmtWhen(b.at))} • ${plural(b.items.length, 'quotation')}</small></span>
          <span class="sub-tot"><b class="num">${money2(b.total)}</b><small>${boxes}</small></span>
        </button>
        <div class="sub-bar">
          <span class="pill soft">Pending</span>
          <button type="button" class="btn btn-soft sm" data-act="pdf" data-id="${b.id}">${ic('download')}<span>Download PDF</span></button>
        </div>
      </header>
      <div class="sub-body" id="sb-${b.id}"><div class="sub-inner">
        <ul class="sub-rows">${items}</ul>
        <footer class="sub-foot"><span>${boxes} in total</span><b class="num">${money2(b.total)}</b></footer>
      </div></div>
    </article>`;
}

export default {
  title: 'Submissions',

  render() {
    const s = stats();
    return `
      <header class="p-head intro">
        <h1>Submissions</h1>
        <p>Every cart you have sent, kept together as one list you can download.</p>
      </header>
      <dl class="kpis k3 intro">
        <div class="kpi"><dt>Submissions</dt><dd class="num" data-count="${s.subs}">0</dd></div>
        <div class="kpi blue"><dt>Quotations sent</dt><dd class="num" data-count="${s.subq}">0</dd></div>
        <div class="kpi solid wide"><dt>Total value</dt><dd class="num">${money2(s.value)}</dd></div>
      </dl>
      ${
        state.batches.length
          ? `<div class="subs" id="subList">${state.batches.map(cardHtml).join('')}</div>`
          : `<div class="empty intro">
               <span class="empty-ic">${ic('cart')}</span>
               <b>No submissions yet</b>
               <span>Add requests to your cart and press Send. The whole cart lands here as one list with a PDF.</span>
               <a class="btn btn-primary" href="#board">Go to the board</a>
             </div>`
      }`;
  },

  mount(root) {
    let busy = false;
    const stop = delegate(root, {
      toggle: (btn) => {
        const card = btn.closest('.sub-card');
        const open = !card.classList.contains('open');
        card.classList.toggle('open', open);
        btn.setAttribute('aria-expanded', String(open));
        if (open) ui.openBatches.add(btn.dataset.id);
        else ui.openBatches.delete(btn.dataset.id);
      },
      pdf: async (btn) => {
        const batch = state.batches.find((b) => b.id === btn.dataset.id);
        if (!batch || busy) return;
        busy = true;
        const label = $('span', btn);
        const original = label.textContent;
        btn.disabled = true;
        label.textContent = 'Preparing';
        try {
          const result = await downloadSubmission(batch);
          if (result !== 'declined') toast(`PDF ready: MediFast-${batch.id}.pdf`);
        } catch (e) {
          toast('The PDF could not be created. Check your connection and try again.', { type: 'err' });
        } finally {
          busy = false;
          btn.disabled = false;
          label.textContent = original;
        }
      },
    });

    countUp($$('[data-count]', root));
    reveal($$('.sub-card', root));
    if (ANIM) {
      gsap.from($$('.intro', root), { y: 18, opacity: 0, duration: 0.6, stagger: 0.07, ease: 'power3.out', clearProps: 'transform,opacity' });
      const fresh = $('.sub-card.is-new', root);
      if (fresh) gsap.fromTo(fresh, { scale: 0.96 }, { scale: 1, duration: 0.8, ease: 'elastic.out(1,0.55)', delay: 0.3, clearProps: 'transform' });
    }
    return stop;
  },
};
