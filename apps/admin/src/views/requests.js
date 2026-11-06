import { $, $$, esc, delegate, debounce } from '../core/dom.js';
import { ic } from '../core/icons.js';
import { state, on, ui, can } from '../core/store.js';
import { reveal, gsap, ANIM } from '../core/motion.js';
import * as A from '../services/admin.js';
import { money, money2, plural, closeLabel, reqSub, fmtShort } from '../core/format.js';
import { pill, tag, empty, swapList, mountSeg, flashChanged, statusSnap } from '../components/ui.js';
import { companies } from '../services/catalog.js';
import { openRequestSheet, openRequestForm, exportFile } from '../components/panels.js';

const PAGE = 20;
const STATUSES = ['All', 'To review', 'Active', 'Completed', 'Expired'];
const hasPending = (r) => A.quotesOf(r.id).some((q) => q.status === 'Pending');
const SORTS = [
  ['new', 'Newest first'],
  ['soon', 'Closing soon'],
  ['quotes', 'Most quotes'],
  ['value', 'Highest value'],
];

const counts = () => {
  const c = { All: state.requests.length };
  STATUSES.slice(1).forEach((s) => (c[s] = state.requests.filter((r) => (s === 'To review' ? hasPending(r) : r.status === s)).length));
  return c;
};

function filtered() {
  const { status, q, co, sort } = ui.requests;
  const term = q.trim().toLowerCase();
  let list = state.requests.filter((r) => (status === 'All' || (status === 'To review' ? hasPending(r) : r.status === status)) && (co === 'All' || r.co === co));
  if (term) list = list.filter((r) => [r.name, r.generic, r.co, A.reqCode(r)].some((v) => String(v).toLowerCase().includes(term)));
  const n = (r) => A.quotesOf(r.id).length;
  const by = {
    new: (a, b) => b.postedAt - a.postedAt,
    soon: (a, b) => (a.status === 'Active' ? 0 : 1) - (b.status === 'Active' ? 0 : 1) || (a.deadlineAt || 9e15) - (b.deadlineAt || 9e15),
    quotes: (a, b) => n(b) - n(a) || b.postedAt - a.postedAt,
    value: (a, b) => b.ask * b.qty - a.ask * a.qty,
  };
  return list.sort(by[sort] || by.new);
}

function rowHTML(r) {
  const qs = A.quotesOf(r.id);
  const live = qs.filter((q) => q.status !== 'Rejected');
  const lowest = live.length ? Math.min(...live.map((q) => q.price)) : null;
  const pending = qs.filter((q) => q.status === 'Pending').length;
  return `
    <article class="row rqw" data-id="${r.id}" data-status="${r.status}">
      <button type="button" class="c-main" data-act="open" data-id="${r.id}">
        <b>${esc(r.name)}</b>
        <small>${esc(reqSub(r))}</small>
      </button>
      <div class="c-qty"><b>${r.qty}</b><small>boxes</small></div>
      <div class="c-price"><b>${money2(r.ask)}</b><small>${money2(r.ask * r.qty)} total</small></div>
      <div class="c-quotes"><b>${qs.length}</b><small>${qs.length ? (lowest != null ? `from ${money(lowest)}` : 'all rejected') : 'no quotes'}</small>${pending ? `<span class="tags">${tag(`${pending} to review`, 'info')}</span>` : ''}</div>
      <div class="c-when"><span>${esc(closeLabel(r))}</span><small>Posted ${fmtShort(r.postedAt)}</small></div>
      <div class="c-status">${pill(r.status)}</div>
      <div class="c-acts"><button type="button" class="icon-btn" data-act="open" data-id="${r.id}" aria-label="Open ${esc(r.name)}">${ic('chr')}</button></div>
    </article>`;
}

export default {
  title: 'Requests',

  render() {
    return `
      <header class="page-head">
        <div><h1>Requests</h1><p id="rSub"></p></div>
        <div class="ph-actions">
          <button type="button" class="btn btn-ghost" data-act="export">${ic('download')}Export</button>
          ${can('requests.manage') ? `<button type="button" class="btn btn-primary" data-act="new">${ic('plus')}New request</button>` : ''}
        </div>
      </header>

      <div class="toolbar" id="toolbar">
        <label class="search">${ic('search')}<input id="rSearch" type="search" placeholder="Search medicine, company or RQ code" value="${esc(ui.requests.q)}" autocomplete="off" enterkeyhint="search" aria-label="Search requests" /></label>
        <div class="select sel-inline"><select id="rCo" aria-label="Company"><option value="All">All companies</option>${companies().map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('')}</select>${ic('chd', 'sel-ic')}</div>
        <div class="select sel-inline"><select id="rSort" aria-label="Sort requests">${SORTS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>${ic('chd', 'sel-ic')}</div>
      </div>
      <div class="seg-row"><div id="rSeg" class="seg-wrap"></div></div>

      <section class="table" aria-label="Requests">
        <div class="thead row-h rqw" aria-hidden="true">
          <span class="c-main">Medicine</span><span class="c-qty">Quantity</span><span class="c-price">Asking price</span><span class="c-quotes">Quotes</span><span class="c-when">Closes</span><span class="c-status">Status</span><span class="c-acts"></span>
        </div>
        <div id="rows" class="rows"></div>
      </section>
      <div class="more-row"><span id="shown"></span><button type="button" class="btn btn-ghost" id="more" hidden>Show more</button></div>`;
  },

  mount(root) {
    let limit = PAGE;
    let list = [];
    let before = new Map();
    const rowsBox = $('#rows', root);

    $('#rCo', root).value = ui.requests.co;
    $('#rSort', root).value = ui.requests.sort;

    const seg = mountSeg($('#rSeg', root), {
      label: 'Request status',
      active: ui.requests.status,
      items: STATUSES.map((s) => ({ key: s, label: s, count: counts()[s] })),
      onChange: (key) => {
        ui.requests.status = key;
        limit = PAGE;
        paint(true);
      },
    });

    function paint(fresh = false) {
      list = filtered();
      const shownList = list.slice(0, limit);
      const html = shownList.length
        ? shownList.map(rowHTML).join('')
        : empty({ icon: 'search', title: 'No requests match', body: 'Try a different word, or clear the company filter.' });
      if (fresh) {
        rowsBox.innerHTML = html;
        if (shownList.length) reveal($$('.row', rowsBox).slice(0, 14), { y: 14, start: 'top 98%', stagger: 0.035 });
      } else {
        swapList(rowsBox, html, { rows: '.row' });
        flashChanged(rowsBox, before, '.row');
      }
      before = statusSnap(state.requests);
      const c = counts();
      seg.counts(c);
      $('#rSub', root).textContent = `${plural(c.All, 'request')} · ${c.Active} active`;
      $('#shown', root).textContent = list.length ? `Showing ${Math.min(limit, list.length)} of ${list.length}` : '';
      const more = $('#more', root);
      more.hidden = list.length <= limit;
      more.textContent = `Show ${Math.min(PAGE, list.length - limit)} more`;
    }
    paint(true);

    $('#rCo', root).addEventListener('change', (e) => {
      ui.requests.co = e.target.value;
      limit = PAGE;
      paint(true);
    });
    $('#rSort', root).addEventListener('change', (e) => {
      ui.requests.sort = e.target.value;
      paint(true);
    });
    $('#rSearch', root).addEventListener(
      'input',
      debounce((e) => {
        ui.requests.q = e.target.value;
        limit = PAGE;
        paint(true);
      }, 180)
    );
    $('#more', root).addEventListener('click', () => {
      const from = limit;
      limit += PAGE;
      paint(false);
      const added = $$('.row', rowsBox).slice(from);
      if (ANIM && added.length) gsap.fromTo(added, { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: 0.4, stagger: 0.03, clearProps: 'transform,opacity' });
    });

    const offClicks = delegate(root, {
      new: () => openRequestForm(),
      export: () => exportFile('requests', list),
      open: (t) => openRequestSheet(t.dataset.id),
    });
    const offData = on('data', () => paint(false));
    return () => {
      offClicks();
      offData();
      seg.destroy();
    };
  },
};
