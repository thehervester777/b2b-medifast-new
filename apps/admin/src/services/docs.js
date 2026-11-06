import { esc } from '../core/dom.js';
import { money2, fmtDate, fmtShort } from '../core/format.js';
import { me } from '../core/store.js';
import { ymd } from '../core/range.js';
import { orderCode, invoiceCode, orderTotal, supplierOf } from './orders.js';

/*
 * Printable documents: an invoice for one order, an invoice list (one invoice per supplier with
 * every selected medicine on it), and the warehouse receiving list. Each builder returns markup for the pages; docFile() wraps it into a
 * standalone HTML file that opens the print dialog when it is opened.
 * (An Artifact cannot open the print dialog itself, so the person saves the file and prints it.)
 */
const COMPANY = { name: 'MediFast', line: 'Central warehouse, Dhaka, Bangladesh' };

export const DOC_CSS = `
.doc{font-family:system-ui,-apple-system,"Segoe UI",Roboto,"Noto Sans","Noto Sans Bengali",sans-serif;color:#0c1a3d;font-size:13px;line-height:1.5;font-variant-numeric:tabular-nums}
.doc *{box-sizing:border-box}
.doc-page{max-width:794px;margin:0 auto 18px;padding:34px 38px 30px;background:#fff;border:1px solid #dfe6f4;border-radius:8px}
.d-head{display:flex;justify-content:space-between;align-items:flex-start;gap:24px;padding-bottom:16px;border-bottom:2px solid #0c1a3d}
.d-brand{font-size:24px;font-weight:800;letter-spacing:-.03em;line-height:1.1}
.d-brand b{margin-left:.25em;color:#2358e6;font-weight:600}
.d-sub{margin-top:4px;color:#66739a;font-weight:600}
.d-meta{display:grid;grid-template-columns:auto auto;gap:3px 16px;margin:0;font-size:12.5px}
.d-meta dt{color:#66739a}
.d-meta dd{margin:0;font-weight:700;text-align:right}
.d-parties{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin:20px 0 6px}
.d-parties h4{margin:0 0 4px;color:#66739a;font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase}
.d-parties b{display:block;font-size:14.5px}
.d-parties p{margin:1px 0 0;color:#38466b}
.d-sec{margin:22px 0 0}
.d-sec>h3{display:flex;justify-content:space-between;gap:12px;margin:0 0 8px;font-size:14px}
.d-sec>h3 small{color:#66739a;font-weight:600}
.d-table{width:100%;border-collapse:collapse;margin-top:10px}
.d-table th{padding:8px 10px;background:#f1f5fc;color:#38466b;font-size:11.5px;font-weight:700;text-align:left;border-bottom:1px solid #dfe6f4}
.d-table td{padding:9px 10px;border-bottom:1px solid #edf1f9;vertical-align:top}
.d-table .r{text-align:right;white-space:nowrap}
.d-table td small{display:block;color:#66739a;font-size:11.5px}
.d-table tfoot td{padding-top:10px;border-bottom:0;font-weight:700}
.d-table tfoot .grand td{font-size:15px;border-top:2px solid #0c1a3d}
.d-table .box{width:18px;height:18px;display:inline-block;border:1.5px solid #66739a;border-radius:3px;vertical-align:middle}
.d-table .line{display:inline-block;width:110px;border-bottom:1px solid #97a1bd}
.d-note{margin:16px 0 0;color:#38466b}
.d-sign{display:grid;grid-template-columns:1fr 1fr;gap:48px;margin-top:54px}
.d-sign div{padding-top:6px;border-top:1px solid #97a1bd;color:#66739a;font-size:12px}
.d-sign b{display:block;color:#0c1a3d;font-size:13px}
.d-chips{display:flex;flex-wrap:wrap;gap:8px;margin-top:14px}
.d-chips span{padding:4px 10px;background:#f1f5fc;border-radius:99px;font-weight:700;font-size:12px}
@page{size:A4;margin:14mm}
@media print{
.doc-page{max-width:none;margin:0;padding:0;border:0;border-radius:0;break-after:page}
.doc-page:last-child{break-after:auto}
.d-table tr{break-inside:avoid}
.d-table thead{display:table-header-group}
}
`;

const supplierBlock = (s) =>
  s
    ? `<b>${esc(s.name)}</b><p>${esc(s.owner)}, ${esc(s.city)}</p><p>${esc(s.phone)} · ${esc(s.email)}</p><p>Drug licence ${esc(s.lic)} · TIN ${esc(s.tin)}</p>`
    : '<b>Supplier record removed</b>';

const meta = (rows) => `<dl class="d-meta">${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>`;
const head = (title, rows) => `<header class="d-head"><div><div class="d-brand">${COMPANY.name}<b>${esc(title)}</b></div><div class="d-sub">${esc(COMPANY.line)}</div></div>${meta(rows)}</header>`;
const sign = (left, right) => `<div class="d-sign"><div><b>${esc(left[0])}</b>${esc(left[1])}</div><div><b>${esc(right[0])}</b>${esc(right[1])}</div></div>`;

/* ---------- one invoice per order ---------- */
function invoicePage(o) {
  const s = supplierOf(o);
  return `
  <section class="doc-page">
    ${head('Invoice', [
      ['Invoice no.', invoiceCode(o)],
      ['Order', orderCode(o)],
      ['Date', fmtDate(o.createdAt)],
      ['Status', o.status],
    ])}
    <div class="d-parties">
      <div><h4>Supplier</h4>${supplierBlock(s)}</div>
      <div><h4>Deliver to</h4><b>${COMPANY.name}</b><p>${esc(COMPANY.line)}</p><p>Expected by ${fmtDate(o.expectedAt)}</p></div>
    </div>
    <table class="d-table">
      <thead><tr><th>Medicine</th><th>Company</th><th class="r">Boxes</th><th class="r">Price per box</th><th class="r">Amount</th></tr></thead>
      <tbody><tr><td>${esc(o.name)}${o.generic && o.generic !== 'N/A' ? `<small>${esc(o.generic)}</small>` : ''}</td><td>${esc(o.co)}</td><td class="r">${o.qty}</td><td class="r">${money2(o.price)}</td><td class="r">${money2(orderTotal(o))}</td></tr></tbody>
      <tfoot><tr class="grand"><td colspan="4" class="r">Total</td><td class="r">${money2(orderTotal(o))}</td></tr></tfoot>
    </table>
    <p class="d-note">Awarded from quote QT-${o.quoteId} on request RQ-${o.reqId}. Prices are per box in Bangladeshi taka.</p>
    ${sign(['Prepared by', me().name], ['Supplier signature', s ? s.name : ''])}
  </section>`;
}
export const invoicesHTML = (orders) => orders.map(invoicePage).join('');

/* ---------- invoice list: one invoice per supplier, every selected medicine on it ---------- */
const bySupplier = (orders) => {
  const groups = new Map();
  orders.forEach((o) => {
    if (!groups.has(o.supplierId)) groups.set(o.supplierId, []);
    groups.get(o.supplierId).push(o);
  });
  return [...groups.values()];
};
export const supplierCount = (orders) => new Set(orders.map((o) => o.supplierId)).size;
/** Same supplier, same day and same number of lines always give the same invoice number. */
export const listNo = (list) => `INV-${String(list[0].supplierId).replace(/\D/g, '') || 'X'}-${ymd(Date.now()).replace(/-/g, '')}-${list.length}`;

function listInvoicePage(list) {
  const s = supplierOf(list[0]);
  const boxes = list.reduce((n, o) => n + o.qty, 0);
  const total = list.reduce((n, o) => n + o.price * o.qty, 0);
  const rows = list
    .map(
      (o, i) =>
        `<tr><td>${i + 1}</td><td>${esc(o.name)}${o.generic && o.generic !== 'N/A' ? `<small>${esc(o.generic)}</small>` : ''}</td><td>${esc(o.co)}</td><td>${orderCode(o)}<small>${fmtShort(o.createdAt)}</small></td><td class="r">${o.qty}</td><td class="r">${money2(o.price)}</td><td class="r">${money2(o.price * o.qty)}</td></tr>`
    )
    .join('');
  return `
  <section class="doc-page">
    ${head('Invoice', [
      ['Invoice no.', listNo(list)],
      ['Date', fmtDate(Date.now())],
      ['Items', String(list.length)],
      ['Boxes', String(boxes)],
    ])}
    <div class="d-parties">
      <div><h4>Supplier</h4>${supplierBlock(s)}</div>
      <div><h4>Deliver to</h4><b>${COMPANY.name}</b><p>${esc(COMPANY.line)}</p></div>
    </div>
    <table class="d-table">
      <thead><tr><th>#</th><th>Medicine</th><th>Company</th><th>Order</th><th class="r">Boxes</th><th class="r">Price per box</th><th class="r">Amount</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot>
        <tr><td colspan="4" class="r">${list.length} ${list.length === 1 ? 'item' : 'items'}</td><td class="r">${boxes}</td><td></td><td></td></tr>
        <tr class="grand"><td colspan="6" class="r">Total</td><td class="r">${money2(total)}</td></tr>
      </tfoot>
    </table>
    <p class="d-note">One invoice for every item listed above. Prices are per box in Bangladeshi taka.</p>
    ${sign(['Prepared by', me().name], ['Supplier signature', s ? s.name : ''])}
  </section>`;
}
export const listInvoicesHTML = (orders) => bySupplier(orders).map(listInvoicePage).join('');

/* ---------- warehouse receiving list ---------- */
export function warehouseHTML(orders) {
  const groups = new Map();
  orders.forEach((o) => {
    if (!groups.has(o.supplierId)) groups.set(o.supplierId, []);
    groups.get(o.supplierId).push(o);
  });
  const boxes = orders.reduce((n, o) => n + o.qty, 0);
  const sections = [...groups.values()]
    .map((list) => {
      const s = supplierOf(list[0]);
      const b = list.reduce((n, o) => n + o.qty, 0);
      return `
      <div class="d-sec">
        <h3><span>${esc(s ? s.name : 'Supplier record removed')}</span><small>${b} boxes</small></h3>
        <table class="d-table">
          <thead><tr><th>Order</th><th>Medicine</th><th>Company</th><th class="r">Boxes</th><th>Expected</th><th>Received</th><th>Batch and expiry</th></tr></thead>
          <tbody>${list.map((o) => `<tr><td>${orderCode(o)}</td><td>${esc(o.name)}</td><td>${esc(o.co)}</td><td class="r"><b>${o.qty}</b></td><td>${fmtShort(o.expectedAt)}</td><td><span class="box"></span></td><td><span class="line"></span></td></tr>`).join('')}</tbody>
        </table>
      </div>`;
    })
    .join('');
  return `
  <section class="doc-page">
    ${head('Warehouse paper', [
      ['Printed', fmtDate(Date.now())],
      ['Orders', String(orders.length)],
      ['Boxes to receive', String(boxes)],
      ['Prepared by', me().name],
    ])}
    <div class="d-chips"><span>${orders.length} ${orders.length === 1 ? 'order' : 'orders'}</span><span>${boxes} boxes</span><span>${groups.size} ${groups.size === 1 ? 'delivery' : 'deliveries'}</span></div>
    ${sections}
    <p class="d-note">Tick each line when the boxes arrive, and write the batch number and expiry date. Report any shortage or damage to the manager the same day.</p>
    ${sign(['Received by', 'Name and date'], ['Checked by', 'Name and date'])}
  </section>`;
}

/** A standalone HTML file that opens the print dialog on load. */
export function docFile(title, body) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<style>
body{margin:0;padding:22px 12px;background:#eef2fa}
.bar{max-width:794px;margin:0 auto 14px;display:flex;align-items:center;justify-content:space-between;gap:12px;font:600 14px system-ui,sans-serif;color:#0c1a3d}
.bar button{padding:9px 18px;border:0;border-radius:10px;background:#2358e6;color:#fff;font:700 14px system-ui,sans-serif;cursor:pointer}
@media print{body{padding:0;background:#fff}.bar{display:none}}
${DOC_CSS}
</style></head>
<body onload="setTimeout(function(){window.print()},500)">
<div class="bar"><span>${esc(title)}</span><button type="button" onclick="window.print()">Print</button></div>
<div class="doc">${body}</div>
</body></html>`;
}
