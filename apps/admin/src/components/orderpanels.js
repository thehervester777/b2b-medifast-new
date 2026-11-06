import { $, esc, delegate } from '../core/dom.js';
import { ic } from '../core/icons.js';
import { on, can } from '../core/store.js';
import { toast } from '../core/toast.js';
import { openSheet, confirmDialog } from './sheet.js';
import { openPopover } from './popover.js';
import { pill, tag } from './ui.js';
import { money2, fmtDate, fmtDateTime, plural, signedPct } from '../core/format.js';
import { saveText, stamp } from '../services/files.js';
import { orderById, orderCode, invoiceCode, orderTotal, supplierOf, nextStatus, isLate, setOrderStatus, logPrinted, FLOW, STATUSES } from '../services/orders.js';
import { invoicesHTML, listInvoicesHTML, warehouseHTML, supplierCount, docFile, DOC_CSS } from '../services/docs.js';
import { openQuoteSheet, openRequestSheet, openSupplierSheet } from './panels.js';

/*
 * Everything about one order or a group of orders: the detail drawer, the row menu,
 * status changes (with undo), and the three printable documents.
 */

/* ============================== status changes ============================== */
export async function doSetStatus(ids, status) {
  ids = [].concat(ids).map(Number);
  if (!can('orders.manage')) return false;
  if (status === 'Cancelled') {
    const ok = await confirmDialog({
      title: ids.length > 1 ? `Cancel ${ids.length} orders?` : 'Cancel this order?',
      body: `Cancelled orders are left out of spend in the reports. The supplier is not told automatically, so let them know. You can undo this right after.`,
      confirm: ids.length > 1 ? 'Cancel orders' : 'Cancel order',
      cancel: 'Keep order',
      tone: 'danger',
    });
    if (!ok) return false;
  }
  const res = await setOrderStatus(ids, status);
  if (!res) {
    if (res === null && ids.every((id) => (orderById(id) || {}).status === status)) toast(ids.length > 1 ? `Those orders are already ${status}` : `Already ${status}`, { type: 'err' });
    return false;
  }
  toast(`${res.n === 1 ? orderCode(orderById(ids[0])) : plural(res.n, 'order')} moved to ${status}`, { undo: res.undo });
  return true;
}

/* ============================== documents ============================== */
const DOCS = {
  invoice: (orders) => ({
    title: orders.length === 1 ? `Invoice ${invoiceCode(orders[0])}` : `${orders.length} invoices`,
    sub: orders.length === 1 ? orderCode(orders[0]) : 'One page per order',
    body: invoicesHTML(orders),
    file: orders.length === 1 ? `invoice-${invoiceCode(orders[0])}.html` : `invoices-${orders.length}-orders-${stamp()}.html`,
  }),
  list: (orders) => {
    const n = supplierCount(orders);
    return {
      title: 'Invoice list',
      sub: `${plural(n, 'invoice')} · ${plural(orders.length, 'item')}${n > 1 ? ' · one per supplier' : ''}`,
      body: listInvoicesHTML(orders),
      file: `invoice-list-${plural(n, 'supplier')}-${stamp()}.html`.replace(/\s+/g, '-'),
    };
  },
  warehouse: (orders) => ({
    title: 'Warehouse paper',
    sub: `${plural(orders.length, 'order')} · ${orders.reduce((n, o) => n + o.qty, 0)} boxes`,
    body: warehouseHTML(orders),
    file: `warehouse-paper-${orders.length}-orders-${stamp()}.html`,
  }),
};

/** kind: 'invoice' | 'list' | 'warehouse'. Shows a preview; the footer saves a printable file. */
export function openDocSheet(kind, orders) {
  if (!can('orders.documents') || !orders.length) return null;
  const doc = DOCS[kind](orders);
  return openSheet({
    title: doc.title,
    subtitle: doc.sub,
    className: 'is-doc',
    body: `
      <p class="callout">${ic('info')}<span>Save the file, then open it. Your browser's print dialog appears by itself, ready for paper or PDF.</span></p>
      <style>${DOC_CSS}</style>
      <div class="doc doc-preview">${doc.body}</div>`,
    footer: `<button type="button" class="btn btn-ghost" data-close>Close</button><button type="button" class="btn btn-primary" id="docSave">${ic('download')}Save to print</button>`,
    onMount: (api) => {
      const btn = $('#docSave', api.wrap);
      btn.addEventListener('click', async () => {
        const result = await saveText(doc.file, docFile(doc.title, doc.body), 'text/html;charset=utf-8');
        if (result === 'saved') {
          logPrinted(kind, orders.map((o) => o.id));
          toast('Saved. Open the file to print it.');
          api.close();
        }
      });
    },
  });
}

/* ============================== order detail ============================== */
const stepper = (o) => {
  const cancelled = o.status === 'Cancelled';
  const last = (st) => [...o.history].reverse().find((h) => h.status === st);
  const reached = (st) => (cancelled ? !!last(st) : FLOW.indexOf(st) <= FLOW.indexOf(o.status));
  const items = FLOW.map((st) => {
    const h = last(st);
    const done = reached(st);
    return `<li class="${done ? 'done' : ''} ${o.status === st ? 'cur' : ''}"><i>${done ? ic('check') : ''}</i><span><b>${st}</b><small>${done && h ? `${fmtDateTime(h.at)} · ${esc(h.by)}` : 'Not yet'}</small></span></li>`;
  });
  if (cancelled) {
    const h = last('Cancelled');
    items.push(`<li class="done cur is-cancel"><i>${ic('x')}</i><span><b>Cancelled</b><small>${h ? `${fmtDateTime(h.at)} · ${esc(h.by)}` : ''}</small></span></li>`);
  }
  return `<ol class="steps">${items.join('')}</ol>`;
};

export function openOrderSheet(id) {
  id = Number(id);
  if (!orderById(id)) return null;
  let off = () => {};
  let unwire = () => {};

  const bodyHTML = (o) => {
    const s = supplierOf(o);
    const asked = o.ask * o.qty;
    const saved = asked - o.price * o.qty;
    const late = isLate(o);
    return `
      <div class="rs-head">
        <div class="rs-title">${pill(o.status)}<span class="code">${orderCode(o)}</span>${late ? tag('Late', 'red') : ''}</div>
        <h3 class="big-price">${money2(orderTotal(o))}</h3>
        <p>${esc(o.name)} · ${esc(o.co)}</p>
      </div>
      <dl class="facts">
        <div><dt>Supplier</dt><dd>${s ? `<button type="button" class="link" data-act="open-supplier" data-id="${esc(s.id)}">${esc(s.name)}</button>` : 'Removed'}</dd></div>
        <div><dt>Boxes</dt><dd>${o.qty}<small> at ${money2(o.price)}</small></dd></div>
        <div><dt>Against asking</dt><dd class="${saved < 0 ? 'neg' : ''}">${saved === 0 ? 'Equal' : `${saved > 0 ? 'Saved ' : 'Over by '}${money2(Math.abs(saved))}`}<small> ${signedPct(((o.price - o.ask) / o.ask) * 100)}</small></dd></div>
        <div><dt>Ordered</dt><dd>${fmtDate(o.createdAt)}</dd></div>
        <div><dt>Expected</dt><dd class="${late ? 'neg' : ''}">${fmtDate(o.expectedAt)}</dd></div>
        <div><dt>Delivered</dt><dd>${o.deliveredAt ? fmtDate(o.deliveredAt) : '—'}</dd></div>
      </dl>
      <section class="rs-sec"><h4>Progress</h4>${stepper(o)}</section>
      <section class="rs-sec">
        <h4>Where it came from</h4>
        <p class="note-text">Awarded from <button type="button" class="link" data-act="open-quote" data-id="${o.quoteId}">QT-${o.quoteId}</button> on request <button type="button" class="link" data-act="open-request" data-id="${o.reqId}">RQ-${o.reqId}</button>.</p>
      </section>
      ${
        can('orders.documents')
          ? `<section class="rs-sec"><h4>Documents</h4><div class="doc-btns">
              <button type="button" class="btn btn-ghost" data-act="doc-invoice">${ic('printer')}Invoice</button>
              <button type="button" class="btn btn-ghost" data-act="doc-warehouse">${ic('clip')}Warehouse paper</button>
            </div></section>`
          : ''
      }`;
  };

  const footHTML = (o) => {
    if (!can('orders.manage')) return `<button type="button" class="btn btn-ghost" data-close>Close</button>`;
    const next = nextStatus(o);
    const cancel = o.status !== 'Delivered' && o.status !== 'Cancelled' ? `<button type="button" class="btn btn-ghost danger-text" data-act="to-Cancelled">Cancel order</button>` : '';
    const reopen = o.status === 'Cancelled' ? `<button type="button" class="btn btn-ghost" data-act="to-Pending">Reopen as Pending</button>` : '';
    const primary = next ? `<button type="button" class="btn btn-primary" data-act="to-${next}">${ic('arrow')}Move to ${next}</button>` : '';
    return `${cancel}${reopen}${primary}` || `<button type="button" class="btn btn-ghost" data-close>Close</button>`;
  };

  return openSheet({
    title: 'Order',
    subtitle: orderCode(orderById(id)),
    body: bodyHTML(orderById(id)),
    footer: footHTML(orderById(id)),
    onClose: () => {
      off();
      unwire();
    },
    onMount: (api) => {
      const repaint = () => {
        const o = orderById(id);
        if (!o) return api.close();
        $('.sheet-body', api.wrap).innerHTML = bodyHTML(o);
        api.setFooter(footHTML(o));
      };
      off = on('data', repaint);
      const handlers = {
        'open-supplier': (t) => openSupplierSheet(t.dataset.id),
        'open-quote': (t) => openQuoteSheet(t.dataset.id),
        'open-request': (t) => openRequestSheet(t.dataset.id),
        'doc-invoice': () => openDocSheet('invoice', [orderById(id)]),
        'doc-warehouse': () => openDocSheet('warehouse', [orderById(id)]),
      };
      STATUSES.forEach((st) => (handlers['to-' + st] = () => doSetStatus(id, st)));
      unwire = delegate(api.wrap, handlers);
    },
  });
}

/* ============================== row menu ============================== */
export function openOrderMenu(anchor, id) {
  const o = orderById(id);
  if (!o) return null;
  const canStatus = can('orders.manage');
  const canDocs = can('orders.documents');
  return openPopover(
    anchor,
    `
    <div class="pop-menu">
      <button type="button" data-act="view">${ic('eye')}View details</button>
      ${canDocs ? `<button type="button" data-act="invoice">${ic('printer')}Print invoice</button><button type="button" data-act="warehouse">${ic('clip')}Warehouse paper</button>` : ''}
    </div>
    ${
      canStatus
        ? `<div class="pop-sub">Change status</div>
           <div class="pop-menu">${STATUSES.map((st) => `<button type="button" data-act="to" data-st="${st}" class="${o.status === st ? 'is-cur' : ''}" ${o.status === st ? 'disabled' : ''}>${o.status === st ? ic('check') : ic('chr')}${st}${o.status === st ? '<em>current</em>' : ''}</button>`).join('')}</div>`
        : ''
    }`,
    {
      className: 'pop-order',
      onMount: (api) =>
        delegate(api.node, {
          view: () => {
            api.close();
            openOrderSheet(id);
          },
          invoice: () => {
            api.close();
            openDocSheet('invoice', [orderById(id)]);
          },
          warehouse: () => {
            api.close();
            openDocSheet('warehouse', [orderById(id)]);
          },
          to: (t) => {
            api.close();
            doSetStatus(id, t.dataset.st);
          },
        }),
    }
  );
}
