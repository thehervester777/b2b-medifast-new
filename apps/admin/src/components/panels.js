import { $, esc, delegate } from '../core/dom.js';
import { ic } from '../core/icons.js';
import { state, on, can } from '../core/store.js';
import { toast } from '../core/toast.js';
import { shake } from '../core/motion.js';
import { openSheet, confirmDialog } from './sheet.js';
import { pill, tag, avatar, field, selectField, setError, toggle, statusSnap, flashChanged } from './ui.js';
import { ladderHTML, animateLadder } from './ladder.js';
import * as A from '../services/admin.js';
import { REJECT_REASONS } from '../data/constants.js';
import { companies } from '../services/catalog.js';
import { money2, fmtShort, fmtDateTime, ago, reqSub, closeLabel, plural, signedPct } from '../core/format.js';
import { saveText, stamp } from '../services/files.js';
import { orderOfQuote, orderCode } from '../services/orders.js';
import { openOrderSheet } from './orderpanels.js';
import { showPassword } from './tempPassword.js';

/*
 * The drawers and dialogs shared by every page: request detail, quote review, supplier
 * detail, the request form, and the review actions (approve / reject / award).
 * Anything that changes data goes through services/admin.js and comes back with an
 * undo function, which every action here hands to a toast.
 */

/* ============================== review actions ============================== */
export async function doApprove(id) {
  const q = A.quoteById(id);
  if (!q) return;
  const res = await A.approveQuote(id);
  if (res) toast(`${A.quoteCode(q)} approved`, { undo: res.undo });
}

function askReason(count) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => {
      if (done) return;
      done = true;
      resolve(v);
    };
    const s = openSheet({
      title: count > 1 ? `Reject ${count} quotes` : 'Reject this quote',
      kind: 'dialog',
      className: 'is-confirm',
      body: `
        <p class="confirm-text">Pick the closest reason. It is saved with the quote and shows in the activity log.</p>
        <div class="opt-list" role="radiogroup" aria-label="Reason">
          ${REJECT_REASONS.map((r, i) => `<label class="opt"><input type="radio" name="rr" value="${esc(r)}" ${i === 0 ? 'checked' : ''} /><span>${esc(r)}</span></label>`).join('')}
        </div>
        <div class="field" id="f-note"><label for="note">Note <span class="opt-tag">optional</span></label><div class="input ta"><textarea id="note" rows="2" maxlength="200" placeholder="Anything the next reviewer should know"></textarea></div><small class="err" id="e-note" role="alert"></small></div>`,
      footer: `<button type="button" class="btn btn-ghost" data-close>Cancel</button><button type="button" class="btn btn-danger" id="rjOk">${count > 1 ? 'Reject quotes' : 'Reject quote'}</button>`,
      onClose: () => finish(null),
    });
    $('#rjOk', s.wrap).addEventListener('click', () => {
      const reason = ($('input[name=rr]:checked', s.wrap) || {}).value || 'Other';
      const note = $('#note', s.wrap).value.trim();
      if (reason === 'Other' && !note) {
        setError(s.wrap, 'note', 'Add a short note when the reason is Other.');
        $('#note', s.wrap).focus();
        return;
      }
      finish({ reason, note });
      s.close();
    });
  });
}

export async function doReject(ids) {
  ids = [].concat(ids).map(Number);
  const picked = state.settings.requireReason ? await askReason(ids.length) : { reason: 'Other', note: '' };
  if (!picked) return false;
  const code = ids.length === 1 ? A.quoteCode(A.quoteById(ids[0])) : '';
  const res = ids.length === 1 ? await A.rejectQuote(ids[0], picked.reason, picked.note) : await A.decideMany(ids, 'reject', picked.reason);
  if (!res) return false;
  toast(ids.length === 1 ? `${code} rejected` : `${plural(res.changed, 'quote')} rejected`, { undo: res.undo });
  return true;
}

export async function doApproveMany(ids) {
  const res = await A.decideMany(ids, 'approve');
  if (res) toast(`${plural(res.changed, 'quote')} approved`, { undo: res.undo });
}

export async function doAward(id) {
  const q = A.quoteById(id);
  const r = A.reqById(q.reqId);
  const sup = A.supById(q.supplierId);
  const others = A.quotesOf(r.id).filter((o) => o.id !== q.id && (o.status === 'Pending' || o.status === 'Approved')).length;
  const tail = others && state.settings.rejectOthersOnAward ? ` and ${plural(others, 'other open quote')} will be turned down` : '';
  const ok = await confirmDialog({
    title: 'Award this quote?',
    body: `<b>${esc(sup.name)}</b> gets <b>${esc(r.name)}</b> at ${money2(q.price)} per box, ${money2(A.quoteTotal(q))} in all. The request is completed${tail}. You can undo this right after.`,
    confirm: 'Award quote',
  });
  if (!ok) return false;
  const res = await A.awardQuote(id);
  if (!res) return false;
  const o = orderOfQuote(id);
  toast(`${A.quoteCode(q)} awarded to ${sup.name}${o ? `. ${orderCode(o)} created` : ''}`, { undo: res.undo });
  return true;
}

/** Award many approved quotes at once: the cheapest approved quote on each open request, each becoming an order. */
export async function doAwardMany(ids) {
  ids = [].concat(ids).map(Number);
  const picks = ids.map((id) => A.quoteById(id)).filter((q) => q && q.status === 'Approved');
  const reqs = new Set(picks.map((q) => q.reqId));
  const ok = await confirmDialog({
    title: `Award ${plural(reqs.size, 'request')}?`,
    body: `Each approved quote you picked becomes an order${picks.length > reqs.size ? '. Where two quotes are for the same request, only the cheaper one is awarded' : ''}. Requests are completed${state.settings.rejectOthersOnAward ? ' and their other open quotes are turned down' : ''}. You can undo this right after.`,
    confirm: 'Award and create orders',
  });
  if (!ok) return false;
  const res = await A.awardMany(ids);
  if (!res) return false;
  toast(`${plural(res.n, 'quote')} awarded, ${plural(res.n, 'order')} created`, { undo: res.undo });
  return true;
}

export async function doCloseRequest(id) {
  const r = A.reqById(id);
  const open = A.quotesOf(id).filter((q) => q.status === 'Pending' || q.status === 'Approved').length;
  const ok = await confirmDialog({
    title: 'Close this request?',
    body: `Suppliers can no longer quote on <b>${esc(r.name)}</b>.${open ? ` ${plural(open, 'open quote')} will be turned down.` : ''} You can reopen it later.`,
    confirm: 'Close request',
  });
  if (!ok) return false;
  const res = await A.closeRequest(id);
  if (res) toast(`${A.reqCode(r)} closed`, { undo: res.undo });
  return !!res;
}

export async function doReopenRequest(id) {
  const r = A.reqById(id);
  const res = await A.reopenRequest(id);
  if (res) toast(`${A.reqCode(r)} reopened for 7 days`, { undo: res.undo });
}

export async function doDeleteRequest(id) {
  const r = A.reqById(id);
  const n = A.quotesOf(id).length;
  const ok = await confirmDialog({
    title: 'Delete this request?',
    body: `<b>${esc(r.name)}</b>${n ? ` and its ${plural(n, 'quote')}` : ''} will be removed. You can undo this right after.`,
    confirm: 'Delete request',
    tone: 'danger',
  });
  if (!ok) return false;
  const res = await A.deleteRequest(id);
  if (res) toast(`${A.reqCode(r)} deleted`, { undo: res.undo });
  return !!res;
}

export async function doSupplier(id, status) {
  const s = A.supById(id);
  if (status === 'Suspended') {
    const ok = await confirmDialog({
      title: 'Suspend this supplier?',
      body: `<b>${esc(s.name)}</b> will not be able to quote until you reinstate them. Quotes already sent stay in the queue, flagged.`,
      confirm: 'Suspend supplier',
      tone: 'danger',
    });
    if (!ok) return false;
  }
  const was = s.status;
  const res = await A.setSupplierStatus(id, status);
  if (!res) return false;
  toast(`${s.name} ${status === 'Suspended' ? 'suspended' : was === 'Suspended' ? 'reinstated' : 'verified'}`, { undo: res.undo });
  return true;
}

/* ============================== shared bits ============================== */
const flagTags = (q) => A.flagsOf(q).map((f) => tag(f.label, f.tone === 'red' ? 'red' : 'info')).join('');

const quoteActions = (q, r) => {
  if (!can('quotes.decide')) return '';
  if (q.status === 'Pending') {
    return `<button type="button" class="btn btn-sm btn-ghost" data-act="reject" data-id="${q.id}">${ic('x')}Reject</button><button type="button" class="btn btn-sm btn-primary" data-act="approve" data-id="${q.id}">${ic('check')}Approve</button>`;
  }
  if (q.status === 'Approved' && r && r.status === 'Active') {
    return `<button type="button" class="btn btn-sm btn-ghost" data-act="reject" data-id="${q.id}">${ic('x')}Reject</button><button type="button" class="btn btn-sm btn-primary" data-act="award" data-id="${q.id}">${ic('trophy')}Award</button>`;
  }
  return '';
};

/** Wires approve / reject / award / open buttons inside any drawer. */
const wireActions = (root, extra = {}) =>
  delegate(root, {
    approve: (t) => doApprove(t.dataset.id),
    reject: (t) => doReject(t.dataset.id),
    award: (t) => doAward(t.dataset.id),
    'open-quote': (t) => openQuoteSheet(t.dataset.id),
    'open-supplier': (t) => openSupplierSheet(t.dataset.id),
    'open-request': (t) => openRequestSheet(t.dataset.id),
    'open-order': (t) => openOrderSheet(t.dataset.id),
    ...extra,
  });

/* ============================== request detail ============================== */
export function openRequestSheet(id) {
  id = Number(id);
  const first = A.reqById(id);
  if (!first) return;
  let off = () => {};
  let unwire = () => {};

  const bodyHTML = (r) => {
    const items = A.quotesOf(r.id)
      .slice()
      .sort((a, b) => a.price - b.price)
      .map((q) => ({ q, sup: A.supById(q.supplierId) }));
    return `
      <div class="rs-head">
        <div class="rs-title">${pill(r.status)}<span class="code">${A.reqCode(r)}</span></div>
        <h3>${esc(r.name)}</h3>
        <p>${esc(reqSub(r))}</p>
      </div>
      <dl class="facts">
        <div><dt>Quantity</dt><dd>${r.qty} boxes</dd></div>
        <div><dt>Asking price</dt><dd>${money2(r.ask)}<small> per box</small></dd></div>
        <div><dt>Order value</dt><dd>${money2(r.ask * r.qty)}</dd></div>
        <div><dt>Posted</dt><dd>${fmtShort(r.postedAt)}</dd></div>
        <div><dt>Closes</dt><dd>${closeLabel(r)}</dd></div>
        <div><dt>Quotes</dt><dd>${items.length}</dd></div>
      </dl>
      <section class="rs-sec"><h4>Price ladder</h4><div id="rsLadder">${ladderHTML(r, items)}</div></section>
      <section class="rs-sec">
        <h4>Quotes <span class="h4-n">${items.length}</span></h4>
        ${
          items.length
            ? `<ul class="qlist">${items
                .map(
                  ({ q, sup }) => `
              <li class="qi" data-id="${q.id}" data-status="${q.status}">
                <button type="button" class="qi-main" data-act="open-quote" data-id="${q.id}">
                  ${avatar(sup ? sup.name : '?')}
                  <span class="qi-who"><b>${esc(sup ? sup.name : 'Unknown supplier')}</b><small>${A.quoteCode(q)} · ${ago(q.at)}</small></span>
                  <span class="qi-price"><b>${money2(q.price)}</b><small>${q.qty} boxes</small></span>
                  ${pill(q.status)}
                </button>
                ${flagTags(q) ? `<div class="qi-flags">${flagTags(q)}</div>` : ''}
                ${quoteActions(q, r) ? `<div class="qi-acts">${quoteActions(q, r)}</div>` : ''}
              </li>`
                )
                .join('')}</ul>`
            : `<p class="muted">No supplier has quoted on this request yet.</p>`
        }
      </section>
      ${r.note ? `<section class="rs-sec"><h4>Notes</h4><p class="note-text">${esc(r.note)}</p></section>` : ''}`;
  };

  const footHTML = (r) => !can('requests.manage') ? `<button type="button" class="btn btn-ghost" data-close>Close</button>` : `
    <button type="button" class="btn btn-ghost btn-icon-only danger-text" data-act="delete" aria-label="Delete request">${ic('trash')}</button>
    ${r.status === 'Active' ? `<button type="button" class="btn btn-ghost" data-act="close">Close request</button>` : r.status === 'Expired' ? `<button type="button" class="btn btn-ghost" data-act="reopen">Reopen</button>` : ''}
    <button type="button" class="btn btn-primary" data-act="edit">${ic('edit')}Edit</button>`;

  let before = new Map();
  const sheet = openSheet({
    title: 'Request',
    subtitle: A.reqCode(first),
    body: bodyHTML(first),
    footer: footHTML(first),
    onClose: () => {
      off();
      unwire();
    },
    onMount: (api) => {
      animateLadder($('#rsLadder', api.wrap));
      before = statusSnap(A.quotesOf(id));
      const repaint = () => {
        const r = A.reqById(id);
        if (!r) return api.close();
        $('.sheet-body', api.wrap).innerHTML = bodyHTML(r);
        api.setFooter(footHTML(r));
        flashChanged(api.wrap, before, '.qi');
        before = statusSnap(A.quotesOf(id));
      };
      off = on('data', repaint);
      unwire = wireActions(api.wrap, {
        edit: () => openRequestForm(id),
        close: () => doCloseRequest(id),
        reopen: () => doReopenRequest(id),
        delete: async () => {
          if (await doDeleteRequest(id)) api.close();
        },
      });
    },
  });
  return sheet;
}

/* ============================== quote review ============================== */
export function openQuoteSheet(id) {
  id = Number(id);
  if (!A.quoteById(id)) return;
  let off = () => {};
  let unwire = () => {};

  const checks = (q, r, s) => {
    const rows = [
      { ok: q.price <= r.ask, text: q.price <= r.ask ? 'Price is at or below the asking price' : `Price is ${money2(q.price - r.ask)} above the asking price` },
      { ok: q.qty <= r.qty, text: q.qty <= r.qty ? `Quantity is within the ${r.qty} boxes requested` : `Quantity is ${q.qty - r.qty} over the ${r.qty} boxes requested` },
      { ok: s && s.status === 'Verified', text: s && s.status === 'Verified' ? 'Supplier is verified' : `Supplier is ${s ? s.status.toLowerCase() : 'unknown'}` },
    ];
    const low = A.flagsOf(q).find((f) => f.code === 'low');
    rows.push({ ok: !low, warn: !!low, text: low ? `Price is more than ${state.settings.lowPricePct}% below asking, double-check it` : 'Price is in the expected range' });
    if (q.status === 'Pending') {
      const over = A.isOverdue(q);
      rows.push({ ok: !over, text: over ? `Waiting longer than the ${state.settings.reviewHours}-hour review limit` : `Inside the ${state.settings.reviewHours}-hour review limit` });
    }
    return `<ul class="checks">${rows.map((c) => `<li class="${c.ok ? 'ok' : c.warn ? 'warn' : 'bad'}">${ic(c.ok ? 'check' : c.warn ? 'info' : 'x')}<span>${esc(c.text)}</span></li>`).join('')}</ul>`;
  };

  const bodyHTML = (q) => {
    const r = A.reqById(q.reqId);
    const s = A.supById(q.supplierId);
    const d = A.priceDelta(q);
    const items = A.quotesOf(r.id).map((x) => ({ q: x, sup: A.supById(x.supplierId) }));
    return `
      <div class="rs-head">
        <div class="rs-title">${pill(q.status)}<span class="code">${A.quoteCode(q)}</span>${A.isOverdue(q) ? tag('Overdue', 'red') : ''}</div>
        <h3 class="big-price">${money2(q.price)}<small> per box</small></h3>
        <p>${q.qty} boxes, ${money2(A.quoteTotal(q))} in all</p>
      </div>
      <dl class="facts">
        <div><dt>Supplier</dt><dd><button type="button" class="link" data-act="open-supplier" data-id="${esc(q.supplierId)}">${esc(s ? s.name : 'Unknown')}</button></dd></div>
        <div><dt>Request</dt><dd><button type="button" class="link" data-act="open-request" data-id="${r.id}">${esc(r.name)}</button></dd></div>
        <div><dt>Asking price</dt><dd>${money2(r.ask)}<small> per box</small></dd></div>
        <div><dt>Against asking</dt><dd class="${d > 0 ? 'neg' : ''}">${d === 0 ? 'Equal' : signedPct(d)}</dd></div>
        <div><dt>Submitted</dt><dd>${fmtDateTime(q.at)}</dd></div>
        <div><dt>Request status</dt><dd>${pill(r.status)}</dd></div>
      </dl>
      <section class="rs-sec"><h4>Rule checks</h4>${checks(q, r, s)}</section>
      <section class="rs-sec"><h4>Where it sits</h4><div id="rsLadder">${ladderHTML(r, items, q.id)}</div></section>
      ${
        q.decidedAt
          ? `<section class="rs-sec"><h4>Decision</h4><p class="note-text"><b>${esc(q.status)}</b> by ${esc(q.by || 'System')}, ${ago(q.decidedAt)}.${q.reason ? ` Reason: ${esc(q.reason)}` : ''}</p></section>`
          : ''
      }
      ${(() => {
        const o = orderOfQuote(q.id);
        return o && can('orders.view') ? `<section class="rs-sec"><h4>Order</h4><button type="button" class="order-link" data-act="open-order" data-id="${o.id}"><span><b>${orderCode(o)}</b><small>${o.qty} boxes · ${money2(o.price * o.qty)}</small></span>${pill(o.status)}${ic('chr')}</button></section>` : '';
      })()}`;
  };

  const footHTML = (q) => {
    const r = A.reqById(q.reqId);
    const acts = quoteActions(q, r).replace(/btn-sm /g, '');
    return acts || `<button type="button" class="btn btn-ghost" data-close>Close</button>`;
  };

  const first = A.quoteById(id);
  let before = new Map();
  return openSheet({
    title: 'Quote review',
    subtitle: A.quoteCode(first),
    body: bodyHTML(first),
    footer: footHTML(first),
    onClose: () => {
      off();
      unwire();
    },
    onMount: (api) => {
      animateLadder($('#rsLadder', api.wrap));
      before = statusSnap([A.quoteById(id)]);
      const repaint = () => {
        const q = A.quoteById(id);
        if (!q) return api.close();
        $('.sheet-body', api.wrap).innerHTML = bodyHTML(q);
        api.setFooter(footHTML(q));
        const pillNode = $('.rs-title .pill', api.wrap);
        if (before.get(String(id)) !== q.status && pillNode) pillNode.animate && pillNode.animate([{ transform: 'scale(1.3)' }, { transform: 'scale(1)' }], { duration: 400, easing: 'cubic-bezier(.34,1.56,.64,1)' });
        before = statusSnap([q]);
        animateLadder($('#rsLadder', api.wrap));
      };
      off = on('data', repaint);
      unwire = wireActions(api.wrap);
    },
  });
}

/* ============================== supplier detail ============================== */
export function openSupplierSheet(id) {
  const first = A.supById(id);
  if (!first) return;
  let off = () => {};
  let unwire = () => {};

  const bodyHTML = (s) => {
    const mine = state.quotes.filter((q) => q.supplierId === s.id).sort((a, b) => b.at - a.at);
    const wins = mine.filter((q) => q.status === 'Awarded').length;
    const decided = mine.filter((q) => q.status === 'Awarded' || q.status === 'Rejected').length;
    const rate = decided ? Math.round((wins / decided) * 100) : 0;
    const orders = state.orders.filter((o) => o.supplierId === s.id && o.status !== 'Cancelled');
    const spend = orders.reduce((n, o) => n + o.price * o.qty, 0);
    const docs = [
      ['licence', 'Drug licence', s.lic],
      ['tin', 'TIN / BIN', s.tin],
      ['trade', 'Trade licence', ''],
    ];
    return `
      <div class="rs-head with-av">
        ${avatar(s.name, 'av-lg')}
        <div>
          <div class="rs-title">${pill(s.status)}<span class="code">${esc(s.id)}</span></div>
          <h3>${esc(s.name)}</h3>
          <p>${esc(s.owner)} · ${esc(s.city)}</p>
        </div>
      </div>
      ${s.status === 'Suspended' && s.note ? `<p class="callout red">${ic('ban')}<span>${esc(s.note)}</span></p>` : ''}
      <dl class="facts two">
        <div><dt>Phone</dt><dd>${esc(s.phone)}</dd></div>
        <div><dt>Email</dt><dd class="wrap">${esc(s.email)}</dd></div>
        <div><dt>Drug licence</dt><dd>${esc(s.lic)}</dd></div>
        <div><dt>TIN / BIN</dt><dd>${esc(s.tin)}</dd></div>
        <div><dt>Joined</dt><dd>${fmtShort(s.joinedAt)}</dd></div>
        <div><dt>Quotes sent</dt><dd>${mine.length}</dd></div>
        <div><dt>Orders</dt><dd>${orders.length}</dd></div>
        <div><dt>Spend</dt><dd>${money2(spend)}</dd></div>
      </dl>
      <section class="rs-sec">
        <h4>Documents</h4>
        <ul class="checks">${docs.map(([k, label]) => `<li class="${s.docs[k] ? 'ok' : 'bad'}">${ic(s.docs[k] ? 'check' : 'x')}<span>${label} ${s.docs[k] ? 'received' : 'missing'}</span></li>`).join('')}</ul>
      </section>
      <section class="rs-sec">
        <h4>Track record</h4>
        <div class="rate"><div class="rate-top"><b>${rate}%</b><span>${wins} won of ${decided} decided</span></div><div class="rate-bar"><i style="width:${rate}%"></i></div></div>
      </section>
      <section class="rs-sec">
        <h4>Recent quotes <span class="h4-n">${mine.length}</span></h4>
        ${
          mine.length
            ? `<ul class="qlist">${mine
                .slice(0, 6)
                .map((q) => {
                  const r = A.reqById(q.reqId);
                  return `<li class="qi" data-id="${q.id}" data-status="${q.status}"><button type="button" class="qi-main" data-act="open-quote" data-id="${q.id}"><span class="qi-who"><b>${esc(r ? r.name : 'Removed request')}</b><small>${A.quoteCode(q)} · ${ago(q.at)}</small></span><span class="qi-price"><b>${money2(q.price)}</b><small>${q.qty} boxes</small></span>${pill(q.status)}</button></li>`;
                })
                .join('')}</ul>`
            : `<p class="muted">No quotes yet.</p>`
        }
      </section>`;
  };

  const footHTML = (s) => {
    if (!can('suppliers.manage')) return `<button type="button" class="btn btn-ghost" data-close>Close</button>`;
    const pw = `<button type="button" class="btn btn-ghost" data-act="newpw">${ic('lock')}New password</button>`;
    if (s.status === 'Verified') return `<button type="button" class="btn btn-ghost" data-close>Close</button>${pw}<button type="button" class="btn btn-danger-soft" data-act="suspend">${ic('ban')}Suspend supplier</button>`;
    if (s.status === 'Suspended') return `<button type="button" class="btn btn-ghost" data-close>Close</button>${pw}<button type="button" class="btn btn-primary" data-act="verify">${ic('shield')}Reinstate supplier</button>`;
    const missing = Object.entries(s.docs).filter(([, v]) => !v).map(([k]) => ({ licence: 'drug licence', tin: 'TIN / BIN', trade: 'trade licence' }[k]));
    return `${missing.length ? `<span class="foot-note">Missing: ${esc(missing.join(', '))}</span>` : ''}<button type="button" class="btn btn-ghost" data-act="suspend">Reject</button><button type="button" class="btn btn-primary" data-act="verify" ${missing.length ? 'disabled' : ''}>${ic('shield')}Verify supplier</button>`;
  };

  let before = new Map();
  return openSheet({
    title: 'Supplier',
    subtitle: first.id,
    body: bodyHTML(first),
    footer: footHTML(first),
    onClose: () => {
      off();
      unwire();
    },
    onMount: (api) => {
      before = statusSnap(state.quotes.filter((q) => q.supplierId === id));
      const repaint = () => {
        const s = A.supById(id);
        if (!s) return api.close();
        $('.sheet-body', api.wrap).innerHTML = bodyHTML(s);
        api.setFooter(footHTML(s));
        flashChanged(api.wrap, before, '.qi');
        before = statusSnap(state.quotes.filter((q) => q.supplierId === id));
      };
      off = on('data', repaint);
      unwire = wireActions(api.wrap, {
        verify: () => doSupplier(id, 'Verified'),
        suspend: () => doSupplier(id, 'Suspended'),
        newpw: async () => {
          const sup = A.supById(id);
          const ok = await confirmDialog({ title: `Set a new password for ${sup.name}?`, body: `${esc(sup.name)} is signed out everywhere and must choose their own password at the next sign-in.`, confirm: 'Set temporary password' });
          if (!ok) return;
          const res = await A.resetSupplierPassword(id);
          if (res) showPassword(sup.name, res.password, `Temporary password for ${sup.name}`);
        },
      });
    },
  });
}

/* ============================== request form ============================== */
const pad = (n) => String(n).padStart(2, '0');
const ymd = (t) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const fromYmd = (s) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d, 18, 0, 0).getTime();
};

export function openRequestForm(id = null) {
  const r = id ? A.reqById(id) : null;
  const today = ymd(Date.now());
  const sheet = openSheet({
    title: r ? 'Edit request' : 'New request',
    subtitle: r ? A.reqCode(r) : 'Suppliers can quote as soon as it is posted.',
    body: `
      <form id="rf" novalidate autocomplete="off">
        ${field({ id: 'name', label: 'Medicine name', value: r ? r.name : '', placeholder: 'e.g. Napril 40 tablet', attrs: 'maxlength="60"' })}
        <div class="two-col">
          ${field({ id: 'generic', label: 'Generic name', value: r && r.generic !== 'N/A' ? r.generic : '', placeholder: 'Optional', attrs: 'maxlength="40"' })}
          ${selectField({ id: 'co', label: 'Company', options: companies(), value: r ? r.co : companies()[0] })}
        </div>
        <div class="two-col">
          ${field({ id: 'qty', label: 'Quantity (boxes)', type: 'number', value: r ? r.qty : '', placeholder: '10', attrs: 'inputmode="numeric" min="1" max="1000" step="1"' })}
          ${field({ id: 'ask', label: 'Asking price per box', type: 'number', value: r ? r.ask : '', placeholder: '0.00', prefix: '৳', attrs: 'inputmode="decimal" min="0" step="0.01"' })}
        </div>
        ${toggle({ id: 'noEnd', label: 'No end date', hint: 'Stays open until you close it.', on: r ? r.noEnd : false })}
        ${field({ id: 'deadline', label: 'Closes on', type: 'date', value: r && r.deadlineAt ? ymd(r.deadlineAt) : ymd(Date.now() + 7 * 86400000), attrs: `min="${today}"` })}
        <div class="field" id="f-note"><label for="note">Notes <span class="opt-tag">optional</span></label><div class="input ta"><textarea id="note" rows="3" maxlength="240" placeholder="Anything suppliers should know">${esc(r ? r.note : '')}</textarea></div></div>
      </form>`,
    footer: `<button type="button" class="btn btn-ghost" data-close>Cancel</button><button type="submit" form="rf" class="btn btn-primary" id="rfSave">${r ? 'Save changes' : 'Post request'}</button>`,
    onMount: (api) => {
      const root = api.wrap;
      const noEnd = $('#noEnd', root);
      const dl = $('#deadline', root);
      const sync = () => {
        dl.disabled = noEnd.checked;
        $('#f-deadline', root).classList.toggle('is-off', noEnd.checked);
      };
      noEnd.addEventListener('change', sync);
      sync();
      $('input', root).focus({ preventScroll: true });

      $('#rf', root).addEventListener('submit', async (e) => {
        e.preventDefault();
        const v = (k) => $('#' + k, root).value.trim();
        const name = v('name');
        const qty = Number(v('qty'));
        const ask = Number(v('ask'));
        const errors = {};
        if (name.length < 3) errors.name = 'Enter the medicine name.';
        if (!Number.isInteger(qty) || qty < 1 || qty > 1000) errors.qty = 'Whole boxes, from 1 to 1,000.';
        if (!(ask > 0) || ask > 100000 || Math.round(ask * 100) / 100 !== ask) errors.ask = 'Enter a price above 0, with up to 2 decimals.';
        if (!noEnd.checked && (!v('deadline') || v('deadline') < today)) errors.deadline = 'Pick today or a later date.';
        ['name', 'qty', 'ask', 'deadline'].forEach((k) => setError(root, k, errors[k]));
        const bad = Object.keys(errors)[0];
        if (bad) {
          shake($('#f-' + bad, root));
          $('#' + bad, root).focus();
          return;
        }
        const data = {
          name,
          generic: v('generic') || 'N/A',
          co: $('#co', root).value,
          qty,
          ask,
          noEnd: noEnd.checked,
          deadlineAt: noEnd.checked ? null : fromYmd(v('deadline')),
          note: $('#note', root).value.trim(),
        };
        const save = $('#rfSave', root);
        save.disabled = true;
        const res = await A.saveRequest(data, id);
        save.disabled = false;
        if (!res) return;
        toast(r ? 'Request updated' : `${A.reqCode({ id: res.id })} posted`, { undo: res.undo });
        api.close();
      });
    },
  });
  return sheet;
}

/* ============================== exports ============================== */
export async function exportFile(kind, list) {
  const make = {
    quotes: [A.quotesCsv, state.quotes],
    requests: [A.requestsCsv, state.requests],
    activity: [A.activityCsv, state.activity],
    orders: [A.ordersCsv, state.orders],
    suppliers: [A.suppliersCsv, state.suppliers],
    products: [A.productsCsv, state.products],
  }[kind];
  const rows = list || make[1];
  const result = await saveText(`medifast-${kind}-${stamp()}.csv`, make[0](rows));
  if (result === 'saved') toast(`${plural(rows.length, 'row')} exported to CSV`);
  return result;
}
