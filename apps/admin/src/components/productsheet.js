import { $, esc } from '../core/dom.js';
import { toast } from '../core/toast.js';
import { shake } from '../core/motion.js';
import { addProduct, updateProduct, companies } from '../services/catalog.js';
import { field, selectField, setError } from './ui.js';
import { openSheet } from './sheet.js';

const num = (v) => (v === '' || v == null ? NaN : Number(v));

/** Add a product (no argument) or edit one. Resolves to the saved result, or null when closed without saving. */
export function openProductSheet(p = null) {
  return new Promise((resolve) => {
    let saved = null;
    openSheet({
      title: p ? 'Edit product' : 'Add a product',
      subtitle: p ? p.code : 'It appears in the product list straight away. Send it to suppliers when you want quotes.',
      kind: 'dialog',
      body: `<form id="pf" novalidate autocomplete="off">
        ${field({ id: 'pname', label: 'Product name', value: p ? p.name : '', placeholder: 'e.g. Napril 40 tablet', attrs: 'maxlength="120"' })}
        ${field({ id: 'pgeneric', label: 'Generic name', value: p && p.generic !== 'N/A' ? p.generic : '', placeholder: 'e.g. Enalapril', attrs: 'maxlength="120"' })}
        ${field({ id: 'pbrand', label: 'Company', value: p ? p.brand : '', placeholder: 'e.g. Square Pharma', attrs: 'maxlength="80" list="pcos"' })}
        <datalist id="pcos">${companies().map((c) => `<option value="${esc(c)}"></option>`).join('')}</datalist>
        <div class="field-row">
          ${field({ id: 'pstock', label: 'Boxes in stock', type: 'number', value: p ? p.stock : 0, attrs: 'min="0" step="1" inputmode="numeric"' })}
          ${field({ id: 'preorder', label: 'Reorder at', type: 'number', value: p ? p.reorder : 10, hint: 'Boxes left when it counts as low.', attrs: 'min="0" step="1" inputmode="numeric"' })}
        </div>
        <div class="field-row">
          ${field({ id: 'pbuy', label: 'Buying price', type: 'number', value: p ? p.buy : '', attrs: 'min="0" step="0.01" inputmode="decimal"' })}
          ${field({ id: 'psale', label: 'Sale price', type: 'number', value: p ? p.sale : '', attrs: 'min="0" step="0.01" inputmode="decimal"' })}
        </div>
        ${selectField({ id: 'pstatus', label: 'Status', options: ['Active', 'Inactive'], value: p ? p.status : 'Active' })}
      </form>`,
      footer: `<button type="button" class="btn btn-ghost" data-close>Cancel</button><button type="submit" form="pf" class="btn btn-primary">${p ? 'Save changes' : 'Add product'}</button>`,
      onMount: (api) => {
        const r = api.wrap;
        $('#pname', r).focus();
        $('#pf', r).addEventListener('submit', async (e) => {
          e.preventDefault();
          const v = {
            name: $('#pname', r).value.trim(),
            generic: $('#pgeneric', r).value.trim(),
            brand: $('#pbrand', r).value.trim(),
            stock: num($('#pstock', r).value),
            reorder: num($('#preorder', r).value),
            buy: num($('#pbuy', r).value),
            sale: num($('#psale', r).value),
            status: $('#pstatus', r).value,
          };
          const errs = {};
          if (v.name.length < 2) errs.pname = 'Enter the product name.';
          if (!Number.isInteger(v.stock) || v.stock < 0) errs.pstock = 'Use a whole number, 0 or more.';
          if (!Number.isInteger(v.reorder) || v.reorder < 0) errs.preorder = 'Use a whole number, 0 or more.';
          if (!(v.buy >= 0)) errs.pbuy = 'Enter the buying price.';
          if (!(v.sale >= 0)) errs.psale = 'Enter the sale price.';
          ['pname', 'pstock', 'preorder', 'pbuy', 'psale'].forEach((k) => setError(r, k, errs[k]));
          const bad = Object.keys(errs)[0];
          if (bad) {
            shake($('#f-' + bad, r));
            $('#' + bad, r).focus();
            return;
          }
          const btn = $('button[type=submit]', r);
          btn.disabled = true;
          const res = p ? await updateProduct(p.id, v) : await addProduct(v);
          btn.disabled = false;
          if (!res) return;
          saved = res;
          api.close();
          toast(p ? `${v.name} updated` : `${v.name} added`, { undo: res.undo });
        });
      },
      onClose: () => resolve(saved),
    });
  });
}
