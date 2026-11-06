import { $, esc } from '../core/dom.js';
import { ic } from '../core/icons.js';
import { can } from '../core/store.js';
import { toast } from '../core/toast.js';
import { shake } from '../core/motion.js';
import { openSheet } from './sheet.js';
import { field, toggle, setError } from './ui.js';
import { ymd, fromYmd } from '../core/range.js';
import { plural } from '../core/format.js';
import { productById, openRequestOf, level, suggestQty, sendProducts } from '../services/catalog.js';

/*
 * "Send to supplier app": pick how many boxes of each product you want and the price you
 * would like to pay. Each product becomes a request that suppliers can quote on.
 * A product that already has an open request is left out so it is never posted twice.
 */
const LEVEL_TEXT = { out: 'Out of stock', low: 'Low stock', warn: 'Getting low', ok: 'In stock' };

/** ids: product ids. Resolves to true when something was sent. */
export function openSendSheet(ids) {
  if (!can('products.send')) return null;
  const all = [...new Set([].concat(ids).map(Number))].map(productById).filter(Boolean);
  const items = all.filter((p) => !openRequestOf(p));
  const skipped = all.length - items.length;
  if (!items.length) {
    toast(all.length > 1 ? 'Those products are already with suppliers' : 'Already with suppliers', { type: 'err' });
    return null;
  }
  const today = ymd(Date.now());

  return new Promise((resolve) => {
    let sent = false;
    const sheet = openSheet({
      title: items.length === 1 ? 'Send to supplier app' : `Send ${items.length} products`,
      subtitle: 'Suppliers can quote as soon as it is posted.',
      className: 'is-send',
      body: `
        <form id="sf" novalidate autocomplete="off">
          ${skipped ? `<p class="callout info">${ic('info')}<span>${plural(skipped, 'selected product')} already ${skipped === 1 ? 'has' : 'have'} an open request and ${skipped === 1 ? 'was' : 'were'} left out.</span></p>` : ''}
          <ul class="send-list">
            ${items
              .map((p) => {
                const lv = level(p);
                return `
              <li class="send-item" data-pid="${p.id}">
                <div class="si-head">
                  <b>${esc(p.name)}</b>
                  <small>${esc(p.brand)} · <span class="lv-${lv}">${LEVEL_TEXT[lv]}, ${p.stock} ${p.stock === 1 ? 'box' : 'boxes'}</span> · reorder at ${p.reorder}</small>
                </div>
                <div class="two-col">
                  ${field({ id: 'q' + p.id, label: 'Boxes wanted', type: 'number', value: suggestQty(p), attrs: 'inputmode="numeric" min="1" max="1000" step="1"' })}
                  ${field({ id: 'a' + p.id, label: 'Price you would pay per box', type: 'number', value: p.buy, prefix: '৳', attrs: 'inputmode="decimal" min="0" step="0.01"' })}
                </div>
              </li>`;
              })
              .join('')}
          </ul>
          ${toggle({ id: 'noEnd', label: 'No end date', hint: 'Stays open until you close it.', on: false })}
          ${field({ id: 'deadline', label: 'Quotes close on', type: 'date', value: ymd(Date.now() + 7 * 86_400_000), attrs: `min="${today}"` })}
          <div class="field" id="f-note"><label for="note">Note for suppliers <span class="opt-tag">optional</span></label><div class="input ta"><textarea id="note" rows="2" maxlength="240" placeholder="Anything suppliers should know"></textarea></div></div>
        </form>`,
      footer: `<button type="button" class="btn btn-ghost" data-close>Cancel</button><button type="submit" form="sf" class="btn btn-primary" id="sfGo">${ic('send')}Send ${items.length === 1 ? 'to suppliers' : `${items.length} to suppliers`}</button>`,
      onClose: () => resolve(sent),
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

        $('#sf', root).addEventListener('submit', async (e) => {
          e.preventDefault();
          const rows = [];
          let firstBad = null;
          items.forEach((p) => {
            const qty = Number($('#q' + p.id, root).value);
            const ask = Number($('#a' + p.id, root).value);
            const eq = !Number.isInteger(qty) || qty < 1 || qty > 1000 ? 'Whole boxes, 1 to 1,000.' : '';
            const ea = !(ask > 0) || ask > 100000 || Math.round(ask * 100) / 100 !== ask ? 'A price above 0, up to 2 decimals.' : '';
            setError(root, 'q' + p.id, eq);
            setError(root, 'a' + p.id, ea);
            if ((eq || ea) && !firstBad) firstBad = eq ? 'q' + p.id : 'a' + p.id;
            rows.push({ id: p.id, qty, ask });
          });
          const date = dl.value;
          const eDate = !noEnd.checked && (!date || date < today) ? 'Pick today or a later date.' : '';
          setError(root, 'deadline', eDate);
          if (eDate && !firstBad) firstBad = 'deadline';
          if (firstBad) {
            shake($('#f-' + firstBad, root));
            $('#' + firstBad, root).focus();
            return;
          }
          const res = await sendProducts(rows, { noEnd: noEnd.checked, deadlineAt: noEnd.checked ? null : fromYmd(date, true), note: $('#note', root).value.trim() });
          if (!res) return;
          sent = true;
          toast(items.length === 1 ? `${items[0].name} sent to the supplier app` : `${plural(items.length, 'product')} sent to the supplier app`, { undo: res.undo });
          api.close();
        });
        const first = $('input[type=number]', root);
        if (first) first.focus({ preventScroll: true });
      },
    });
    if (!sheet) resolve(false);
  });
}
