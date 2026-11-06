import { $, $$, esc, delegate, debounce } from '../core/dom.js';
import { ic } from '../core/icons.js';
import { state, on, ui, can } from '../core/store.js';
import { reveal, ANIM } from '../core/motion.js';
import { money2, plural, ago, signedPct } from '../core/format.js';
import { brands, filterProducts, level, margin, openRequestOf, needsRestock } from '../services/catalog.js';
import { productsCsv } from '../services/admin.js';
import { saveText, stamp } from '../services/files.js';
import { toast } from '../core/toast.js';
import { empty, swapList, pagerHTML, clampPage, selectHTML, PER_OPTIONS } from '../components/ui.js';
import { openSendSheet } from '../components/sendsheet.js';
import { openRequestSheet } from '../components/panels.js';
import { openProductSheet } from '../components/productsheet.js';

const S = () => ui.products;

const STOCK = [
  ['', 'All stock levels'],
  ['0', 'Out of stock'],
  ['5', '5 boxes or fewer'],
  ['10', '10 boxes or fewer'],
  ['20', '20 boxes or fewer'],
  ['50', '50 boxes or fewer'],
  ['100', '100 boxes or fewer'],
];
const SORTS = [
  ['new', 'Newest first'],
  ['low', 'Boxes: low to high'],
  ['high', 'Boxes: high to low'],
  ['name', 'Name A to Z'],
];
const LEVEL_TEXT = { out: 'Out of stock', low: 'Low stock', warn: 'Getting low', ok: 'In stock' };

const query = () => ({ q: S().q, brand: S().brand, max: S().max, sort: S().sort });

function sentCell(p) {
  const r = openRequestOf(p);
  if (r) {
    const n = state.quotes.filter((q) => q.reqId === r.id).length;
    return `<button type="button" class="sent-link" data-act="open-request" data-id="${r.id}"><span class="pill p-blue" data-status="Active">With suppliers</span><small>RQ-${r.id} · ${plural(n, 'quote')}</small></button>`;
  }
  return p.lastSentAt ? `<b class="muted">Not open</b><small>last sent ${ago(p.lastSentAt)}</small>` : `<b class="muted">Never sent</b><small>not in supplier app</small>`;
}

function rowHTML(p, selected, canSend, canEdit) {
  const lv = level(p);
  const open = !!openRequestOf(p);
  const selectable = canSend && !open;
  const m = margin(p);
  return `
    <article class="row qrw prw ${selected ? 'is-sel' : ''}" data-id="${p.id}" data-status="${p.status}">
      <label class="chk c-chk ${selectable ? '' : 'is-off'}"><input type="checkbox" data-sel="${p.id}" ${selected ? 'checked' : ''} ${selectable ? '' : 'disabled tabindex="-1"'} aria-label="Select ${esc(p.name)}" /><i aria-hidden="true"></i></label>
      <div class="c-main as-text">
        <b>${esc(p.name)}</b>
        <small>${esc(p.code)}${p.generic && p.generic !== 'N/A' ? ' · ' + esc(p.generic) : ''}</small>
      </div>
      <div class="c-brand"><span>${esc(p.brand)}</span></div>
      <div class="c-stock"><b class="lv-${lv}">${p.stock}<em> ${p.stock === 1 ? 'box' : 'boxes'}</em></b><small class="lv-${lv}">${LEVEL_TEXT[lv]}</small></div>
      <div class="c-price"><b>${money2(p.sale)}</b><small>buy ${money2(p.buy)} · ${signedPct(m)}</small></div>
      <div class="c-sent">${sentCell(p)}</div>
      <div class="c-acts">${canEdit ? `<button type="button" class="icon-btn" data-act="edit" data-id="${p.id}" aria-label="Edit ${esc(p.name)}" title="Edit">${ic('edit')}</button>` : ''}${
        canSend
          ? open
            ? `<button type="button" class="btn btn-sm btn-ghost" data-act="open-request" data-id="${openRequestOf(p).id}">View</button>`
            : `<button type="button" class="btn btn-sm btn-soft" data-act="send" data-id="${p.id}">${ic('send')}Send</button>`
          : ''
      }</div>
    </article>`;
}

export default {
  title: 'Products',

  render() {
    const s = S();
    const canSend = can('products.send');
    const canEdit = can('products.manage');
    const brandOptions = [['All', 'All companies'], ...brands().map((b) => [b, b])];
    return `
      <header class="page-head">
        <div><h1>Products</h1><p id="pSub"></p></div>
        <div class="ph-actions">
          <button type="button" class="btn btn-ghost" data-act="export">${ic('download')}Export</button>
          ${canEdit ? `<button type="button" class="btn btn-soft" data-act="add">${ic('plus')}Add product</button>` : ''}
          ${canSend ? `<button type="button" class="btn btn-primary" data-act="send-low" id="sendLow">${ic('send')}Send low stock</button>` : ''}
        </div>
      </header>

      <section class="filters f-products" aria-label="Filter products">
        <label class="fl f-search"><span>Search</span><div class="search">${ic('search')}<input id="pSearch" type="search" placeholder="Name, generic, company or product ID" value="${esc(s.q)}" autocomplete="off" enterkeyhint="search" aria-label="Search products" /></div></label>
        <label class="fl"><span>Stock filter</span>${selectHTML({ id: 'pStock', label: 'Stock filter', options: STOCK, value: s.max })}</label>
        <label class="fl"><span>Company</span>${selectHTML({ id: 'pBrand', label: 'Company', options: brandOptions, value: s.brand })}</label>
        <label class="fl"><span>Sort by</span>${selectHTML({ id: 'pSort', label: 'Sort products', options: SORTS, value: s.sort })}</label>
        <label class="fl"><span>Per page</span>${selectHTML({ id: 'pPer', label: 'Products per page', options: PER_OPTIONS, value: s.per })}</label>
        <div class="fl f-act"><span aria-hidden="true">&nbsp;</span><button type="button" class="btn btn-ghost" data-act="reset" id="pReset">${ic('refresh')}Reset</button></div>
      </section>

      ${canSend ? `<div class="send-strip" id="strip"><span class="ss-ic">${ic('send')}</span><p id="stripText"></p><button type="button" class="btn btn-sm btn-ghost" data-act="clear" id="stripClear" hidden>Clear</button><button type="button" class="btn btn-sm btn-primary" data-act="send-selected" id="stripGo" disabled>Send to supplier app</button></div>` : ''}

      <section class="table" aria-label="Products">
        <div class="thead row-h qrw prw" aria-hidden="true">
          <label class="chk c-chk"><input type="checkbox" id="selAll" aria-label="Select every product on this page" /><i></i></label>
          <span class="c-main">Product</span><span class="c-brand">Company</span><span class="c-stock">In stock</span><span class="c-price">Sale price</span><span class="c-sent">Supplier app</span><span class="c-acts"></span>
        </div>
        <div id="rows" class="rows"></div>
      </section>
      <div class="more-row pager" id="pager"></div>`;
  },

  mount(root) {
    const canSend = can('products.send');
    const canEdit = can('products.manage');
    const selected = new Set();
    let shown = [];
    let list = [];

    const rowsBox = $('#rows', root);

    const paintStrip = () => {
      if (!canSend) return;
      const n = selected.size;
      $('#stripText', root).innerHTML = n ? `<b>${plural(n, 'product')}</b> selected to send to the supplier app.` : 'Tick the products you want to buy, then send them to the supplier app. Suppliers quote on each one.';
      $('#stripGo', root).disabled = n === 0;
      $('#stripGo', root).textContent = n > 1 ? `Send ${n} to supplier app` : 'Send to supplier app';
      $('#stripClear', root).hidden = n === 0;
      root.querySelector('#strip').classList.toggle('is-on', n > 0);
      const all = $('#selAll', root);
      const pickable = shown.filter((p) => !openRequestOf(p));
      all.checked = pickable.length > 0 && pickable.every((p) => selected.has(p.id));
      all.indeterminate = !all.checked && pickable.some((p) => selected.has(p.id));
      all.disabled = !canSend || pickable.length === 0;
    };

    function paint(fresh = false) {
      const s = S();
      list = filterProducts(query());
      /* a product that now has an open request can no longer be selected */
      [...selected].forEach((id) => {
        const p = state.products.find((x) => x.id === id);
        if (!p || openRequestOf(p) || !list.includes(p)) selected.delete(id);
      });
      s.page = clampPage(s.page, list.length, s.per);
      shown = list.slice((s.page - 1) * s.per, s.page * s.per);

      const filtered = !!(s.q || s.max !== '' || s.brand !== 'All');
      const html = shown.length
        ? shown.map((p) => rowHTML(p, selected.has(p.id), canSend, canEdit)).join('')
        : state.products.length
          ? empty({ icon: 'box', title: 'No products match', body: 'Change the stock filter or company, or clear the search.', action: filtered ? `<button type="button" class="btn btn-soft" data-act="reset">${ic('refresh')}Clear filters</button>` : '' })
          : empty({ icon: 'box', title: 'No products yet', body: canEdit ? 'Add the products you buy. You can then send them to suppliers to get quotes.' : 'Products appear here once an admin adds them.', action: canEdit ? `<button type="button" class="btn btn-primary" data-act="add">${ic('plus')}Add product</button>` : '' });
      if (fresh) {
        rowsBox.innerHTML = html;
        if (shown.length) reveal($$('.row', rowsBox).slice(0, 14), { y: 14, start: 'top 98%', stagger: 0.035 });
      } else swapList(rowsBox, html, { rows: '.row' });

      const out = state.products.filter((p) => p.stock <= 0).length;
      const low = state.products.filter((p) => p.stock > 0 && p.stock <= 5).length;
      $('#pSub', root).textContent = `${plural(state.products.length, 'product')} · ${out} out of stock · ${low} low`;
      $('#pager', root).innerHTML = pagerHTML({ page: s.page, per: s.per, total: list.length });

      $('#pStock', root).value = s.max;
      $('#pBrand', root).value = s.brand;
      $('#pSort', root).value = s.sort;
      $('#pPer', root).value = String(s.per);
      $('#pReset', root).disabled = !filtered && s.sort === 'new';
      const restock = needsRestock().length;
      const lowBtn = $('#sendLow', root);
      if (lowBtn) {
        lowBtn.disabled = restock === 0;
        lowBtn.innerHTML = `${ic('send')}Send low stock${restock ? ` (${restock})` : ''}`;
      }
      paintStrip();
    }
    paint(true);

    const refilter = () => {
      S().page = 1;
      paint(true);
    };
    $('#pSearch', root).addEventListener(
      'input',
      debounce((e) => {
        S().q = e.target.value;
        refilter();
      }, 180)
    );
    [['pStock', 'max'], ['pBrand', 'brand'], ['pSort', 'sort']].forEach(([id, key]) => {
      $('#' + id, root).addEventListener('change', (e) => {
        S()[key] = e.target.value;
        refilter();
      });
    });
    $('#pPer', root).addEventListener('change', (e) => {
      S().per = Number(e.target.value);
      refilter();
    });

    root.addEventListener('change', (e) => {
      const cb = e.target;
      if (cb.id === 'selAll') {
        shown.filter((p) => !openRequestOf(p)).forEach((p) => (cb.checked ? selected.add(p.id) : selected.delete(p.id)));
        $$('.row', rowsBox).forEach((r) => {
          const box = $('input[data-sel]', r);
          if (!box || box.disabled) return;
          box.checked = selected.has(Number(r.dataset.id));
          r.classList.toggle('is-sel', box.checked);
        });
        paintStrip();
      } else if (cb.dataset && cb.dataset.sel) {
        const id = Number(cb.dataset.sel);
        cb.checked ? selected.add(id) : selected.delete(id);
        cb.closest('.row').classList.toggle('is-sel', cb.checked);
        paintStrip();
      }
    });
    root.addEventListener('click', (e) => {
      const b = e.target.closest('[data-pg]');
      if (!b || b.disabled) return;
      S().page = Number(b.dataset.pg);
      paint(true);
      $('.filters', root).scrollIntoView({ block: 'start', behavior: ANIM ? 'smooth' : 'auto' });
    });

    const sendIds = async (ids) => {
      if (await openSendSheet(ids)) {
        ids.forEach((id) => selected.delete(id));
        paint(false);
      }
    };

    const offClicks = delegate(root, {
      export: async () => {
        const result = await saveText(`medifast-products-${stamp()}.csv`, productsCsv(list));
        if (result === 'saved') toast(`${plural(list.length, 'product')} exported to CSV`);
      },
      reset: () => {
        Object.assign(S(), { q: '', brand: 'All', max: '', sort: 'new', page: 1 });
        $('#pSearch', root).value = '';
        paint(true);
      },
      clear: () => {
        selected.clear();
        paint(false);
      },
      add: () => openProductSheet(),
      edit: (t) => openProductSheet(state.products.find((p) => p.id === Number(t.dataset.id))),
      send: (t) => sendIds([Number(t.dataset.id)]),
      'send-selected': () => sendIds([...selected]),
      'send-low': () => sendIds(needsRestock().map((p) => p.id)),
      'open-request': (t) => openRequestSheet(t.dataset.id),
    });

    const offData = on('data', () => paint(false));
    return () => {
      offClicks();
      offData();
    };
  },
};
