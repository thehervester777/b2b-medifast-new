import { $, $$, esc, delegate } from '../core/dom.js';
import { ic } from '../core/icons.js';
import { findReq, quoteFor, fetchRank, addQuote, on } from '../core/store.js';
import { money, money2, fmtDateTime, reqSub } from '../core/format.js';
import { gsap, ANIM, pop } from '../core/motion.js';
import { toast } from '../core/toast.js';
import { field } from '../components/forms.js';

const PILL = { Active: 'solid', Completed: 'mute', Expired: 'bad' };

const row = (label, value, num = false) => `<div><dt>${label}</dt><dd${num ? ' class="num"' : ''}>${value}</dd></div>`;

/* A sent quotation is final, so it is shown read-only. */
function lockedHtml(q) {
  return `
    <div class="qf-h"><h2>Your quotation</h2><span class="pill solid">Submitted</span></div>
    <div class="qstate">${ic('check')}<span>Quote sent · <b class="qs-${q.status}">${q.status}</b></span><span class="num">Rank #${q.rank}</span></div>
    <dl class="ql">
      ${row('Price per unit', money2(q.price), true)}
      ${row('Quantity', `${q.qty} Box`, true)}
      ${row('Total amount', money2(q.price * q.qty), true)}
      ${row('Expected delivery', q.delivery ? esc(q.delivery) : 'Not specified')}
      ${row('Remarks', q.note ? esc(q.note) : 'None')}
      ${row('Submitted', esc(fmtDateTime(q.at)) + (q.batch ? ` · via ${esc(q.batch)}` : ''))}
    </dl>
    <div class="locked-note">${ic('lock')}<div><b>This quotation is final</b><p>Submitted quotations cannot be edited or updated.</p></div></div>`;
}

function formHtml(r) {
  const q = quoteFor(r.id);
  if (q) return lockedHtml(q);
  if (r.status !== 'Active') {
    return `
      <div class="qf-h"><h2>Your quotation</h2><span class="pill ${PILL[r.status]}">${r.status}</span></div>
      <div class="closed-note">${ic('info')}<b>This request is ${r.status.toLowerCase()}</b><span>New prices are no longer accepted.</span></div>`;
  }
  const today = new Date().toISOString().slice(0, 10);
  return `
    <div class="qf-h"><h2>Send your price</h2><span class="pill mute">No quote yet</span></div>
    <div class="qf-body">
      ${field({
        id: 'fQty',
        label: 'Offer quantity (Box)',
        icon: 'box',
        type: 'number',
        inputmode: 'numeric',
        value: r.qty,
        attrs: `min="1" max="${r.qty}" step="1"`,
        hint: `Requested <b>${r.qty} Box</b>. Same or less.`,
      })}
      ${field({
        id: 'fPrice',
        label: 'Price per unit',
        prefix: '৳',
        type: 'number',
        inputmode: 'decimal',
        placeholder: `Max ${money2(r.ask)}`,
        attrs: 'min="0" step="0.01"',
        hint: `Asking <b>${money2(r.ask)}</b> per box. Same or less.`,
      })}
      <div class="live-tot">
        <div><small>Total amount</small><small id="fCalc">৳0.00 × 0</small></div>
        <b class="num" id="fTot">৳0.00</b>
      </div>
      <p class="rank-hint" id="fRank" aria-live="polite"></p>
      ${field({ id: 'fDate', label: 'Expected delivery date (optional)', icon: 'cal', type: 'date', attrs: `min="${today}"` })}
      ${field({ id: 'fNote', label: 'Additional remarks', icon: 'edit', textarea: true, placeholder: 'Brand, expiry, etc.' })}
      <div class="tip">${ic('bulb')}<div><b>Pro tip</b><p>Competitive pricing increases your chances of winning. The lowest price is shown first to buyers.</p></div></div>
      <p class="final-note">${ic('lock')}Quotations are final once sent. They cannot be edited afterwards.</p>
      <button type="button" class="btn btn-primary btn-lg btn-block" id="fSubmit" data-act="send" disabled>${ic('send')}<span>Send quotation</span></button>
    </div>`;
}

export default {
  title: 'Request',

  render([id]) {
    const r = findReq(id);
    if (!r) {
      return `
        <div class="empty page-empty">
          <span class="empty-ic">${ic('search')}</span>
          <b>Request not found</b>
          <span>It may have been removed. Head back to the board to see what is open.</span>
          <a class="btn btn-primary" href="#board">Go to the board</a>
        </div>`;
    }
    return `
      <nav class="crumb intro" aria-label="Breadcrumb"><a href="#board">${ic('chl')}Board</a><span>Request #${r.id}</span></nav>
      <header class="d-head intro">
        <div><h1>${esc(r.name)}</h1><p>${esc(reqSub(r))}</p></div>
        <div class="d-tools"><span class="pill ${PILL[r.status]}">${r.status}</span><button type="button" class="icon-btn" data-act="share" aria-label="Copy link">${ic('share')}</button></div>
      </header>
      <div class="detail">
        <div class="d-info">
          <div class="summ intro">
            <div><small>Quantity</small><b class="num">${r.qty} Box</b></div>
            <div><small>Asking / Box</small><b class="num">${money(r.ask)}</b></div>
            <div><small>Total ask</small><b class="num">${money(r.ask * r.qty)}</b></div>
          </div>
          <section class="card intro">
            <h2 class="sec-t">Request details</h2>
            <dl class="dl">
              ${row('Company', esc(r.co))}${row('Generic name', r.generic && r.generic !== 'N/A' ? esc(r.generic) : 'Not listed')}
              ${row('Deadline', r.deadlineAt ? esc(fmtDateTime(r.deadlineAt)) : 'No end date')}
              ${row('Posted', esc(fmtDateTime(r.postedAt)))}
              <div><dt>Bids so far</dt><dd class="num" id="dBids">${r.bids}</dd></div>
            </dl>
            ${r.note ? `<div class="desc"><small>Note from MediFast</small><p>${esc(r.note)}</p></div>` : ''}
          </section>
        </div>
        <aside class="qform card intro" id="qform" aria-label="Your quotation">${formHtml(r)}</aside>
      </div>`;
  },

  mount(root, [id]) {
    if (!findReq(id)) return null;
    const form = $('#qform', root);
    const cur = () => findReq(id); /* the request object is replaced on every refresh from the server */
    let rankTimer = 0;
    let rankSeq = 0;

    /* Validation and the live total, recalculated on every keystroke. */
    const update = () => {
      const r = cur();
      if (!r) return;
      const qtyEl = $('#fQty');
      const priceEl = $('#fPrice');
      if (!qtyEl || !priceEl) return;
      let capped = false;
      if (qtyEl.value !== '' && Number(qtyEl.value) > r.qty) {
        qtyEl.value = r.qty;
        capped = true; /* never more than the buyer asked for */
      }
      const qty = Number(qtyEl.value);
      const price = Number(priceEl.value);
      const qMsg = qtyEl.value === '' ? '' : !Number.isInteger(qty) || qty < 1 ? 'Enter a whole number of boxes.' : '';
      const pMsg =
        priceEl.value === ''
          ? ''
          : !/^\d+(\.\d{1,2})?$/.test(priceEl.value)
            ? 'Use up to two decimal places.'
            : !(price > 0)
              ? 'Enter a price above zero.'
              : price > r.ask
                ? `Price cannot be above ${money2(r.ask)}.`
                : '';
      $('#fQtyErr').textContent = capped ? `The request is for ${r.qty} Box, so that is the most you can offer.` : qMsg;
      $('#fPriceErr').textContent = pMsg;
      qtyEl.closest('.input').classList.toggle('err', !!qMsg);
      priceEl.closest('.input').classList.toggle('err', !!pMsg);

      const valid = qtyEl.value !== '' && priceEl.value !== '' && !qMsg && !pMsg;
      $('#fCalc').textContent = `${money2(valid ? price : 0)} × ${valid ? qty : 0}`;
      $('#fTot').textContent = money2(valid ? price * qty : 0);
      /* where this price would rank: asked of the server (it never sends anyone's price), a moment after typing stops */
      clearTimeout(rankTimer);
      const seq = ++rankSeq;
      if (!valid) $('#fRank').textContent = '';
      else
        rankTimer = setTimeout(async () => {
          const res = await fetchRank(r.id, price);
          const out = $('#fRank');
          if (!out || seq !== rankSeq) return;
          out.textContent = res ? `You would rank #${res.rank}${res.bids ? ` of ${res.bids + 1}` : ''}.` : '';
        }, 260);
      $('#fSubmit').disabled = !valid;
      if (valid) pop($('#fTot'), 1.06);
    };
    form.addEventListener('input', (e) => {
      if (e.target.id === 'fQty' || e.target.id === 'fPrice') update();
    });

    const stop = delegate(root, {
      share: async () => {
        try {
          await navigator.clipboard.writeText(location.href);
          toast('Link copied.');
        } catch (e) {
          toast('Copy this page address from the browser bar.', { type: 'err' });
        }
      },
      send: async () => {
        const r = cur();
        update();
        const btn = $('#fSubmit');
        if (!r || !btn || btn.disabled || quoteFor(r.id) || r.status !== 'Active') return;
        btn.disabled = true;
        const res = await addQuote(r, Number($('#fPrice').value), Number($('#fQty').value), $('#fDate').value, $('#fNote').value.trim());
        if (!res.ok) {
          toast(res.error, { type: 'err' });
          btn.disabled = false;
          repaint(); /* e.g. the request closed while the form was open */
          return;
        }
        repaint(true);
        toast('Quotation sent. It is final and cannot be edited.');
        if (ANIM) gsap.from($$('.qstate, .ql, .locked-note', form), { y: 16, opacity: 0, duration: 0.55, stagger: 0.08, ease: 'power3.out', clearProps: 'transform,opacity' });
        window.scrollTo({ top: form.getBoundingClientRect().top + window.scrollY - 90, behavior: ANIM ? 'smooth' : 'auto' });
      },
    });

    /* Show what the server now says (a closed request, a decision on the quote, a new bid) without wiping what is being typed. */
    let shown = '';
    const signature = () => {
      const r = cur();
      const q = r && quoteFor(r.id);
      return r ? `${r.status}|${q ? q.id + q.status : ''}` : 'gone';
    };
    shown = signature();
    const repaint = (force = false) => {
      const r = cur();
      if (!r) return;
      const bids = $('#dBids');
      if (bids) bids.textContent = r.bids;
      const sig = signature();
      if (!force && (sig === shown || form.contains(document.activeElement))) return;
      shown = sig;
      form.innerHTML = formHtml(r);
    };
    const offData = on('data', (e) => {
      if (e && e.source === 'self') return;
      repaint();
    });

    if (ANIM) gsap.from($$('.intro', root), { y: 18, opacity: 0, duration: 0.6, stagger: 0.08, ease: 'power3.out', clearProps: 'transform,opacity' });
    return () => {
      stop();
      offData();
      clearTimeout(rankTimer);
    };
  },
};
