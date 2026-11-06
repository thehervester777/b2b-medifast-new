import { $, $$, esc, delegate } from '../core/dom.js';
import { ic } from '../core/icons.js';
import { ui, countStatus, findReq, quoteFor, lineQty, inCart, setQty, toggleCart, addQuote, undoQuote, on } from '../core/store.js';
import { money, money2, closeLabel, plural, reqSub } from '../core/format.js';
import { gsap, ANIM, reveal, flyTo } from '../core/motion.js';
import { toast } from '../core/toast.js';
import { openSheet, closeSheet } from '../components/sheet.js';
import { segHtml, moveSeg, selectSeg } from '../components/seg.js';
import { filtered, activeFilterCount, companyCounts, companyList, SORTS, currentSort } from '../services/requests.js';

const STATUSES = ['Active', 'Completed', 'Expired'];
const PILL = { Completed: 'mute', Expired: 'bad' };

/* ---------- request card ---------- */
function rowHtml(r) {
  const q = quoteFor(r.id);
  const active = r.status === 'Active';
  const qty = lineQty(r.id);
  const cart = inCart(r.id);

  let foot = '';
  if (active && q) {
    foot = `
      <div class="req-quoted">
        <span class="rq-ic">${ic('check')}</span>
        <div><b>Quote sent</b><small>${money2(q.price)} × ${q.qty} Box · Rank #${q.rank}</small></div>
      </div>`;
  } else if (active) {
    foot = `
      <div class="req-act">
        <div class="qrow">
          <div class="stepper" role="group" aria-label="Boxes to quote">
            <button type="button" data-act="dec" data-id="${r.id}" aria-label="Fewer boxes" ${qty <= 1 ? 'disabled' : ''}>${ic('minus')}</button>
            <input class="qty-in" type="number" inputmode="numeric" enterkeyhint="done" min="1" max="${r.qty}" step="1" value="${qty}" data-id="${r.id}" aria-label="Boxes to quote, 1 to ${r.qty}" />
            <button type="button" data-act="inc" data-id="${r.id}" aria-label="More boxes" ${qty >= r.qty ? 'disabled' : ''}>${ic('plus')}</button>
          </div>
          <p class="qsum"><b class="num">${money2(qty * r.ask)}</b><small>${qty} Box × ${money2(r.ask)}</small></p>
        </div>
        <div class="btn-pair">
          <button type="button" class="btn btn-soft cartbtn${cart ? ' on' : ''}" data-act="cart" data-id="${r.id}" aria-pressed="${cart}">${ic(cart ? 'check' : 'cart')}<span>${cart ? 'In cart' : 'Add to cart'}</span></button>
          <button type="button" class="btn btn-primary" data-act="quick" data-id="${r.id}">${ic('bolt')}<span>Quick submit</span></button>
        </div>
      </div>`;
  }

  return `
    <article class="req" data-id="${r.id}">
      <a class="req-main" href="#request-${r.id}" aria-label="Open ${esc(r.name)}">
        <div class="req-title"><b>${esc(r.name)}</b><small>${esc(reqSub(r))}</small></div>
        <div class="req-price"><b class="num">${money(r.ask)}</b><small>per box</small></div>
      </a>
      <ul class="req-meta">
        <li>${ic('box')}${r.qty} ${r.qty === 1 ? 'box' : 'boxes'}</li>
        <li>${ic('timer')}${closeLabel(r)}</li>
        <li>${ic('trophy')}${plural(r.bids, 'bid')}</li>
        ${active ? '' : `<li class="end"><span class="pill ${PILL[r.status] || 'soft'}">${r.status}</span></li>`}
      </ul>
      ${foot}
    </article>`;
}

const chipsHtml = () => {
  const companies = companyList();
  const counts = companyCounts(companies);
  return ['All', ...companies]
    .map((c) => `<button type="button" class="chip${ui.co === c ? ' on' : ''}" data-act="co" data-co="${esc(c)}" aria-pressed="${ui.co === c}">${esc(c)}<small>${counts[c]}</small></button>`)
    .join('');
};

const statusItems = () => STATUSES.map((s) => ({ key: s, label: s, count: countStatus(s) }));

/* ---------- filter + sort sheets ---------- */
const chip = (k, v, label) => {
  const on = String(ui.filters[k]) === String(v);
  return `<button type="button" class="chip${on ? ' on' : ''}" data-act="fchip" data-k="${k}" data-v="${v}" aria-pressed="${on}">${label}</button>`;
};
const chipGroup = (k, options) => `<div class="chips-wrap" role="group">${options.map(([v, l]) => chip(k, v, l)).join('')}</div>`;

function filterBody() {
  const f = ui.filters;
  const price = (id, ph, v, label) =>
    `<div class="input"><span class="pre">৳</span><input id="${id}" type="number" inputmode="decimal" min="0" step="any" placeholder="${ph}" value="${esc(v)}" aria-label="${label}" /></div>`;
  return `
    <div class="fg"><h3>Asking price per box</h3>
      <div class="range">${price('flMin', 'Min', f.min, 'Minimum asking price')}<i aria-hidden="true">to</i>${price('flMax', 'Max', f.max, 'Maximum asking price')}</div></div>
    <div class="fg"><h3>Boxes wanted</h3>${chipGroup('qty', [['any', 'Any'], ['s', 'Up to 5'], ['m', '6 to 10'], ['l', '11 or more']])}</div>
    <div class="fg"><h3>Deadline</h3>${chipGroup('end', [['any', 'Any'], ['set', 'Has deadline'], ['none', 'No end date']])}</div>
    <div class="fg"><h3>Bids</h3>${chipGroup('bids', [['any', 'Any'], ['none', 'No bids yet'], ['some', 'Has bids']])}</div>`;
}

const filterFoot = () => `
  <div class="foot-actions">
    <button type="button" class="btn btn-soft" data-act="freset" id="fReset">Reset</button>
    <button type="button" class="btn btn-primary" data-close id="fDone"><span id="fCount">Show requests</span></button>
  </div>`;

/* ---------- the view ---------- */
export default {
  title: 'Board',

  render() {
    const n = activeFilterCount();
    return `
      <h1 class="sr-only">Request board</h1>

      <div class="toolbar intro" id="toolbar">
        <label class="search">${ic('search')}<input id="q" type="search" placeholder="Search medicines" value="${esc(ui.search)}" autocomplete="off" enterkeyhint="search" /></label>
        <button type="button" class="btn btn-soft fbtn${n ? ' has' : ''}" id="fBtn" data-act="filters" aria-label="Filters${n ? `, ${n} active` : ''}">${ic('filter')}<span>Filters</span><b class="fn" id="fN" ${n ? '' : 'hidden'}>${n}</b></button>
      </div>

      <div class="chips-row scroller intro" id="coList">${chipsHtml()}</div>

      <div class="intro">${segHtml('statusSeg', statusItems(), ui.status, { act: 'status' })}</div>

      <div class="list-meta intro">
        <p id="tbCount" aria-live="polite"></p>
        <button type="button" class="link-btn" data-act="sort">${ic('sort')}<span id="sortLabel">${currentSort().short}</span></button>
      </div>

      <div class="req-list" id="rows"></div>`;
  },

  mount(root) {
    let rowTriggers = [];
    let filterSheet = null;
    let searchTimer = 0;
    let filterTimer = 0;
    const offs = [];

    /* ----- list ----- */
    const syncFilterUi = (total) => {
      const n = activeFilterCount();
      const badge = $('#fN');
      badge.hidden = !n;
      badge.textContent = n;
      $('#fBtn').classList.toggle('has', n > 0);
      $('#fBtn').setAttribute('aria-label', `Filters${n ? `, ${n} active` : ''}`);
      if (filterSheet) {
        const c = $('#fCount', filterSheet.wrap);
        if (c) c.textContent = total ? `Show ${plural(total, 'request')}` : 'No requests match';
        const reset = $('#fReset', filterSheet.wrap);
        if (reset) reset.disabled = !n;
      }
    };

    const fillRows = (prev = 0) => {
      const arr = filtered();
      const shown = arr.slice(0, ui.limit);
      const box = $('#rows');
      syncFilterUi(arr.length);
      rowTriggers.forEach((t) => t.kill());
      rowTriggers = [];
      if (!arr.length) {
        box.innerHTML = `
          <div class="empty">
            <span class="empty-ic">${ic('search')}</span>
            <b>No requests found</b>
            <span>Try another company, or loosen the search and filters.</span>
            ${activeFilterCount() ? `<button type="button" class="btn btn-soft" data-act="freset">Reset filters</button>` : ''}
          </div>`;
        $('#tbCount').textContent = '';
        return;
      }
      box.innerHTML =
        shown.map(rowHtml).join('') +
        (arr.length > shown.length ? `<div class="more"><button type="button" class="btn btn-soft" data-act="more"><span>Show more requests</span>${ic('chd')}</button></div>` : '');
      $('#tbCount').textContent = `Showing ${shown.length} of ${plural(arr.length, 'request')}`;
      rowTriggers = reveal($$('.req', box).slice(prev));
    };

    const refreshRow = (id) => {
      const old = $(`.req[data-id="${id}"]`, root);
      const r = findReq(id);
      if (!old || !r) return;
      const tpl = document.createElement('template');
      tpl.innerHTML = rowHtml(r).trim();
      const node = tpl.content.firstElementChild;
      old.replaceWith(node);
      const sent = $('.req-quoted', node);
      if (ANIM && sent) gsap.from(sent, { y: 14, opacity: 0, duration: 0.55, ease: 'back.out(1.6)' });
    };

    const syncQty = (id) => {
      const row = $(`.req[data-id="${id}"]`, root);
      const r = findReq(id);
      if (!row || !r) return;
      const n = lineQty(id);
      const input = $('.qty-in', row);
      if (!input) return;
      if (document.activeElement !== input) input.value = n;
      $('[data-act="dec"]', row).disabled = n <= 1;
      $('[data-act="inc"]', row).disabled = n >= r.qty;
      $('.qsum b', row).textContent = money2(n * r.ask);
      $('.qsum small', row).textContent = `${n} Box × ${money2(r.ask)}`;
    };

    const renderChips = () => {
      $('#coList').innerHTML = chipsHtml();
    };

    /* ----- sheets ----- */
    const openFilters = () => {
      filterSheet = openSheet({
        title: 'Filters',
        className: 'filter-sheet',
        body: filterBody(),
        footer: filterFoot(),
        onClose: () => {
          filterSheet = null;
        },
      });
      syncFilterUi(filtered().length);

      const apply = () => {
        ui.limit = 12;
        fillRows(0);
      };
      const priceInput = () => {
        ui.filters.min = $('#flMin', filterSheet.wrap).value;
        ui.filters.max = $('#flMax', filterSheet.wrap).value;
        clearTimeout(filterTimer);
        filterTimer = setTimeout(apply, 220);
      };
      filterSheet.body.addEventListener('input', priceInput);

      delegate(filterSheet.wrap, {
        fchip: (btn) => {
          ui.filters[btn.dataset.k] = btn.dataset.v;
          $$(`[data-k="${btn.dataset.k}"]`, filterSheet.wrap).forEach((c) => {
            const on = c === btn;
            c.classList.toggle('on', on);
            c.setAttribute('aria-pressed', String(on));
          });
          apply();
        },
        freset: () => {
          ui.filters = { min: '', max: '', end: 'any', bids: 'any', qty: 'any' };
          filterSheet.body.innerHTML = filterBody();
          apply();
        },
      });
    };

    const openSort = () => {
      const current = currentSort().id;
      const api = openSheet({
        title: 'Sort requests',
        className: 'sort-sheet',
        body: `<div class="opt-list" role="radiogroup">${SORTS.map(
          (s) => `<button type="button" role="radio" class="opt${s.id === current ? ' on' : ''}" aria-checked="${s.id === current}" data-act="pick" data-id="${s.id}"><span>${s.label}</span>${ic('check')}</button>`
        ).join('')}</div>`,
      });
      delegate(api.wrap, {
        pick: (btn) => {
          const s = SORTS.find((x) => x.id === btn.dataset.id);
          ui.sort = { k: s.k, dir: s.dir };
          $('#sortLabel', root).textContent = s.short;
          ui.limit = 12;
          fillRows(0);
          setTimeout(() => api.close(), 140);
        },
      });
    };

    /* ----- events ----- */
    const stopClicks = delegate(root, {
      dec: (b) => setQty(Number(b.dataset.id), lineQty(Number(b.dataset.id)) - 1),
      inc: (b) => setQty(Number(b.dataset.id), lineQty(Number(b.dataset.id)) + 1),
      cart: (b) => {
        const rect = b.getBoundingClientRect();
        if (toggleCart(Number(b.dataset.id))) flyTo(rect, $('#cartBtn'));
      },
      quick: async (b) => {
        const id = Number(b.dataset.id);
        const r = findReq(id);
        if (!r || r.status !== 'Active' || quoteFor(id) || b.disabled) return;
        const wasInCart = inCart(id);
        const qty = lineQty(id);
        b.disabled = true;
        const res = await addQuote(r, r.ask, qty);
        if (!res.ok) {
          b.disabled = false;
          return toast(res.error, { type: 'err' });
        }
        toast(`Sent ${qty} Box of ${r.name} at ${money2(r.ask)}`, {
          duration: 5200,
          action: {
            label: 'Undo',
            fn: async () => {
              if (!(await undoQuote(res.quote, wasInCart))) toast('That quotation was already changed.', { type: 'err' });
            },
          },
        });
      },
      more: () => {
        const before = Math.min(ui.limit, filtered().length);
        ui.limit += 12;
        fillRows(before);
      },
      co: (b) => {
        ui.co = b.dataset.co;
        ui.limit = 12;
        renderChips();
        const on = $('#coList .chip.on', root);
        if (on) on.scrollIntoView({ inline: 'center', block: 'nearest', behavior: ANIM ? 'smooth' : 'auto' });
        fillRows(0);
      },
      status: (b) => {
        ui.status = b.dataset.key;
        ui.limit = 12;
        selectSeg($('#statusSeg', root), b.dataset.key);
        renderChips();
        fillRows(0);
      },
      filters: openFilters,
      sort: openSort,
      freset: () => {
        ui.filters = { min: '', max: '', end: 'any', bids: 'any', qty: 'any' };
        ui.limit = 12;
        fillRows(0);
      },
    });

    root.addEventListener('change', (e) => {
      const input = e.target.closest('.qty-in');
      if (!input) return;
      input.value = setQty(Number(input.dataset.id), input.value);
    });
    root.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target.classList.contains('qty-in')) e.target.blur();
    });
    $('#q', root).addEventListener('input', (e) => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        ui.search = e.target.value;
        ui.limit = 12;
        fillRows(0);
      }, 160);
    });

    offs.push(
      on('cart', (e) => (e && e.ids ? e.ids : [e && e.id]).filter(Boolean).forEach(refreshRow)),
      on('quotes', (e) => {
        if (e && e.id) refreshRow(e.id);
      }),
      on('qty', syncQty),
      on('data', (e) => {
        /* a change from the server (not this supplier's own action): redraw, unless they are typing a quantity */
        if (e && e.source === 'self') return;
        if (document.activeElement && document.activeElement.classList.contains('qty-in')) return;
        renderChips();
        fillRows(0);
      })
    );

    /* ----- entrance + scroll effects ----- */
    moveSeg($('#statusSeg', root), false);
    fillRows(0);
    if (ANIM) {
      gsap.from($$('.intro', root), { y: 18, opacity: 0, duration: 0.6, stagger: 0.07, ease: 'power3.out', clearProps: 'transform,opacity' });
    }

    return () => {
      offs.forEach((off) => off());
      stopClicks();
      clearTimeout(searchTimer);
      clearTimeout(filterTimer);
      rowTriggers.forEach((t) => t.kill());
      closeSheet(true);
    };
  },
};
