import { $, $$, esc, delegate, debounce } from '../core/dom.js';
import { ic } from '../core/icons.js';
import { state, on, ui, can } from '../core/store.js';
import { reveal } from '../core/motion.js';
import { plural, fmtShort, taka } from '../core/format.js';
import { suppliersCsv } from '../services/admin.js';
import { saveText, stamp } from '../services/files.js';
import { toast } from '../core/toast.js';
import { pill, avatar, empty, swapList, mountSeg, flashChanged, statusSnap, selectHTML } from '../components/ui.js';
import { openSupplierSheet, doSupplier } from '../components/panels.js';

const STATUSES = ['All', 'Verified', 'Pending', 'Suspended'];
const SORTS = [
  ['status', 'Needs attention first'],
  ['name', 'Name A to Z'],
  ['spend', 'Highest spend'],
  ['win', 'Best win rate'],
  ['new', 'Newest first'],
];
const S = () => ui.suppliers;

/** Numbers shown for one supplier, worked out from their quotes and orders. */
function figures(s) {
  const mine = state.quotes.filter((q) => q.supplierId === s.id);
  const wins = mine.filter((q) => q.status === 'Awarded').length;
  const decided = mine.filter((q) => q.status === 'Awarded' || q.status === 'Rejected').length;
  const orders = state.orders.filter((o) => o.supplierId === s.id && o.status !== 'Cancelled');
  const spend = orders.reduce((n, o) => n + o.price * o.qty, 0);
  return { quotes: mine.length, wins, decided, rate: decided ? Math.round((wins / decided) * 100) : null, orders: orders.length, spend };
}

const counts = () => {
  const c = { All: state.suppliers.length };
  STATUSES.slice(1).forEach((s) => (c[s] = state.suppliers.filter((p) => p.status === s).length));
  return c;
};
const cities = () => [...new Set(state.suppliers.map((s) => s.city))].sort();

function filtered() {
  const { status, q, city, sort } = S();
  const term = q.trim().toLowerCase();
  let list = state.suppliers.filter((s) => (status === 'All' || s.status === status) && (city === 'All' || s.city === city));
  if (term) list = list.filter((s) => [s.name, s.owner, s.city, s.id, s.lic, s.phone, s.email].some((v) => String(v).toLowerCase().includes(term)));
  const order = { Pending: 0, Verified: 1, Suspended: 2 };
  const fig = new Map(list.map((s) => [s.id, figures(s)]));
  const by = {
    status: (a, b) => order[a.status] - order[b.status] || a.name.localeCompare(b.name),
    name: (a, b) => a.name.localeCompare(b.name),
    spend: (a, b) => fig.get(b.id).spend - fig.get(a.id).spend,
    win: (a, b) => (fig.get(b.id).rate ?? -1) - (fig.get(a.id).rate ?? -1),
    new: (a, b) => b.joinedAt - a.joinedAt,
  };
  return list.sort(by[sort] || by.status);
}

function rowHTML(s, canManage) {
  const f = figures(s);
  const missing = Object.values(s.docs).filter((v) => !v).length;
  const act = !canManage
    ? ''
    : s.status === 'Verified'
      ? `<button type="button" class="btn btn-sm btn-ghost" data-act="suspend" data-id="${esc(s.id)}">${ic('ban')}Suspend</button>`
      : s.status === 'Suspended'
        ? `<button type="button" class="btn btn-sm btn-soft" data-act="verify" data-id="${esc(s.id)}">${ic('shield')}Reinstate</button>`
        : `<button type="button" class="btn btn-sm btn-primary" data-act="verify" data-id="${esc(s.id)}" ${missing ? 'disabled title="Documents are missing"' : ''}>${ic('shield')}Verify</button>`;
  return `
    <article class="row qrw srw" data-id="${esc(s.id)}" data-status="${s.status}">
      <button type="button" class="c-main with-av-row" data-act="open" data-id="${esc(s.id)}">
        ${avatar(s.name)}
        <span class="wa-t"><b>${esc(s.name)}</b><small>${esc(s.id)} · ${esc(s.owner)} · ${esc(s.city)}</small></span>
      </button>
      <div class="c-contact"><b>${esc(s.phone)}</b><small>${esc(s.email)}</small></div>
      <div class="c-quotes"><b>${f.wins} won of ${f.quotes}</b><small>${f.rate == null ? 'No decided quotes' : `${f.rate}% win rate`}</small></div>
      <div class="c-spend"><b>${f.orders ? taka(f.spend) : '—'}</b><small>${plural(f.orders, 'order')}</small></div>
      <div class="c-when"><span>${fmtShort(s.joinedAt)}</span>${s.status === 'Pending' && missing ? `<small class="late">${plural(missing, 'doc')} missing</small>` : '<small>joined</small>'}</div>
      <div class="c-status">${pill(s.status)}</div>
      <div class="c-acts">${act}</div>
    </article>`;
}

export default {
  title: 'Suppliers',

  render() {
    const s = S();
    return `
      <header class="page-head">
        <div><h1>Suppliers</h1><p id="sSub"></p></div>
        <div class="ph-actions"><button type="button" class="btn btn-ghost" data-act="export">${ic('download')}Export</button></div>
      </header>

      <div class="seg-row"><div id="sSeg" class="seg-wrap"></div></div>

      <section class="filters f-suppliers" aria-label="Filter suppliers">
        <label class="fl f-search"><span>Search</span><div class="search">${ic('search')}<input id="sSearch" type="search" placeholder="Name, owner, city, ID or phone" value="${esc(s.q)}" autocomplete="off" enterkeyhint="search" aria-label="Search suppliers" /></div></label>
        <label class="fl"><span>City</span>${selectHTML({ id: 'sCity', label: 'City', options: [['All', 'All cities'], ...cities().map((c) => [c, c])], value: s.city })}</label>
        <label class="fl"><span>Sort by</span>${selectHTML({ id: 'sSort', label: 'Sort suppliers', options: SORTS, value: s.sort })}</label>
      </section>

      <section class="table" aria-label="Suppliers">
        <div class="thead row-h qrw srw" aria-hidden="true">
          <span class="c-main">Supplier</span><span class="c-contact">Contact</span><span class="c-quotes">Quotes</span><span class="c-spend">Spend</span><span class="c-when">Joined</span><span class="c-status">Status</span><span class="c-acts"></span>
        </div>
        <div id="rows" class="rows"></div>
      </section>`;
  },

  mount(root) {
    const canManage = can('suppliers.manage');
    let before = new Map();
    let list = [];
    const box = $('#rows', root);
    const seg = mountSeg($('#sSeg', root), {
      label: 'Supplier status',
      active: S().status,
      items: STATUSES.map((s) => ({ key: s, label: s, count: counts()[s] })),
      onChange: (key) => {
        S().status = key;
        paint(true);
      },
    });

    function paint(fresh = false) {
      list = filtered();
      const html = list.length ? list.map((s) => rowHTML(s, canManage)).join('') : empty({ icon: 'building', title: 'No suppliers match', body: 'Try a different word, city or status.' });
      if (fresh) {
        box.innerHTML = html;
        if (list.length) reveal($$('.row', box).slice(0, 14), { y: 14, start: 'top 98%', stagger: 0.035 });
      } else {
        swapList(box, html, { rows: '.row' });
        flashChanged(box, before, '.row');
      }
      before = statusSnap(state.suppliers);
      const c = counts();
      seg.counts(c);
      const spend = state.orders.filter((o) => o.status !== 'Cancelled').reduce((n, o) => n + o.price * o.qty, 0);
      $('#sSub', root).textContent = `${plural(c.All, 'supplier')} · ${c.Pending} waiting for verification · ${taka(spend)} ordered in total`;
    }
    paint(true);

    $('#sSearch', root).addEventListener(
      'input',
      debounce((e) => {
        S().q = e.target.value;
        paint(true);
      }, 180)
    );
    $('#sCity', root).addEventListener('change', (e) => {
      S().city = e.target.value;
      paint(true);
    });
    $('#sSort', root).addEventListener('change', (e) => {
      S().sort = e.target.value;
      paint(true);
    });

    const offClicks = delegate(root, {
      export: async () => {
        const result = await saveText(`medifast-suppliers-${stamp()}.csv`, suppliersCsv(list));
        if (result === 'saved') toast(`${plural(list.length, 'supplier')} exported to CSV`);
      },
      open: (t) => openSupplierSheet(t.dataset.id),
      verify: (t) => doSupplier(t.dataset.id, 'Verified'),
      suspend: (t) => doSupplier(t.dataset.id, 'Suspended'),
    });
    const offData = on('data', () => paint(false));
    return () => {
      offClicks();
      offData();
      seg.destroy();
    };
  },
};
