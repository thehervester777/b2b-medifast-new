import { $, $$, esc, delegate } from '../core/dom.js';
import { ic } from '../core/icons.js';
import { state, on, me, ui, can } from '../core/store.js';
import { reveal, countUp, tweenNumber, growBars } from '../core/motion.js';
import { navigate } from '../core/router.js';
import { rangeOf, rangeLabel } from '../core/range.js';
import * as A from '../services/admin.js';
import { buildReport } from '../services/reports.js';
import { pipeline, isLate, orderCode, supplierOf } from '../services/orders.js';
import { needsRestock, level } from '../services/catalog.js';
import { money2, taka, plural, ago, fmtLong, greeting, signedPct, daysBetween } from '../core/format.js';
import { avatar, tag, swapList, empty, flashChanged, statusSnap, mountSeg } from '../components/ui.js';
import { lineChartHTML, mountLineChart, donutHTML, mountDonut } from '../components/charts.js';
import { doApprove, doReject, openQuoteSheet, openSupplierSheet, openRequestForm } from '../components/panels.js';
import { openOrderSheet } from '../components/orderpanels.js';
import { openSendSheet } from '../components/sendsheet.js';

const RANGES = [
  ['7d', 'Last 7 days'],
  ['30d', 'Last 30 days'],
  ['90d', 'Last 90 days'],
  ['month', 'This month'],
];
const PERIOD_TEXT = { '7d': 'previous 7 days', '30d': 'previous 30 days', '90d': 'previous 90 days', month: 'the period before' };
const STATUS_COLOR = { Pending: 'var(--blue-200)', Approved: 'var(--blue-400)', 'In transit': 'var(--blue-600)', Delivered: 'var(--ink)', Cancelled: 'var(--red-500)' };
const PIPE = ['Pending', 'Approved', 'In transit', 'Delivered'];

const compact = (n) => {
  n = Math.round(n);
  if (n >= 10_000_000) return '৳' + (n / 10_000_000).toFixed(1).replace(/\.0$/, '') + 'Cr';
  if (n >= 100_000) return '৳' + (n / 100_000).toFixed(1).replace(/\.0$/, '') + 'L';
  if (n >= 1000) return '৳' + (n / 1000).toFixed(n >= 10_000 ? 0 : 1).replace(/\.0$/, '') + 'k';
  return '৳' + n;
};
const report = () => {
  const r = rangeOf(ui.dash.range) || rangeOf('30d');
  return buildReport(r);
};

/* ---------- pieces that redraw when data changes ---------- */
function bandHTML(s) {
  if (!can('quotes.view')) return '';
  if (!s.pending) {
    return `<div class="band-l"><span class="band-ok">${ic('check')}</span><div><b>Nothing waiting for review</b><small>Every quote has a decision. New ones will show up here.</small></div></div>`;
  }
  const age = daysBetween(s.oldestPending);
  const bits = [age >= 1 ? `The oldest has waited ${plural(age, 'day')}` : 'The oldest arrived today'];
  if (s.pendingFlagged) bits.push(`${s.pendingFlagged} broke a rule`);
  if (s.pendingOverdue) bits.push(`${s.pendingOverdue} past the ${state.settings.reviewHours}-hour limit`);
  return `
    <div class="band-l">
      <span class="band-num" id="bandNum" data-value="${s.pending}">${s.pending}</span>
      <div><b>${s.pending === 1 ? 'quote is' : 'quotes are'} waiting for review</b><small>${esc(bits.join(' · '))}</small></div>
    </div>
    ${can('requests.view') ? `<div class="band-r"><button type="button" class="btn btn-primary" data-act="review">Start reviewing${ic('arrow')}</button></div>` : ''}`;
}

const deltaText = (d, word, goodUp = null) => {
  if (d == null) return { text: 'Nothing in the period before', cls: '' };
  const cls = goodUp == null || Math.abs(d) < 0.05 ? '' : d > 0 === goodUp ? 'pos' : 'neg';
  return { text: `${signedPct(d)} vs ${word}`, cls };
};

function kpiData(rep, s) {
  const word = PERIOD_TEXT[ui.dash.range] || 'the period before';
  const spend = deltaText(rep.delta.spend, word);
  const orders = deltaText(rep.delta.orders, word);
  const ontime = rep.delta.onTime == null ? { text: rep.cur.deliveredN ? 'No deliveries before' : 'Nothing delivered yet', cls: '' } : { text: `${rep.delta.onTime > 0 ? '+' : rep.delta.onTime < 0 ? '−' : ''}${Math.abs(Math.round(rep.delta.onTime))} pts vs ${word}`, cls: rep.delta.onTime > 0 ? 'pos' : rep.delta.onTime < 0 ? 'neg' : '' };
  return [
    { key: 'spend', label: 'Spend', value: Math.round(rep.cur.spend), fmt: 'money', sub: spend.text, cls: spend.cls },
    { key: 'orders', label: 'Orders', value: rep.cur.orders, fmt: 'int', sub: orders.text, cls: orders.cls },
    { key: 'review', label: 'Quotes to review', value: s.pending, fmt: 'int', sub: s.pendingFlagged ? `${s.pendingFlagged} broke a rule` : 'None broke a rule', cls: s.pendingFlagged ? 'neg' : '' },
    { key: 'open', label: 'Open requests', value: s.active, fmt: 'int', sub: s.newRequests7 ? `${s.newRequests7} posted this week` : 'None posted this week', cls: '' },
    { key: 'saved', label: 'Saved against asking', value: rep.cur.orders ? Math.round(rep.cur.savedPct) : NaN, fmt: 'pct', sub: rep.cur.orders ? `${money2(rep.cur.saved)} on ${plural(rep.cur.orders, 'order')}` : 'No orders in the period', cls: rep.cur.saved > 0 ? 'pos' : '' },
    { key: 'ontime', label: 'On-time delivery', value: rep.cur.deliveredN ? Math.round(rep.cur.onTimePct) : NaN, fmt: 'pct', sub: ontime.text, cls: ontime.cls },
  ];
}
const dash = (f) => (n) => (Number.isFinite(n) ? f(n) : '—');
const FMT = { money: dash(taka), int: dash((n) => String(Math.round(n))), pct: dash((n) => Math.round(n) + '%') };

const kpiHTML = (k) => `<div class="kpi" data-k="${k.key}"><span class="k-l">${k.label}</span><b class="k-v" id="kv-${k.key}" data-count="${k.value}" data-f="${k.fmt}">0</b><small id="ks-${k.key}" class="${k.cls}">${esc(k.sub)}</small></div>`;

function pipeHTML(rep) {
  const open = pipeline();
  const late = state.orders.filter(isLate);
  const stages = PIPE.map((st) => {
    const n = st === 'Delivered' ? rep.cur.deliveredN : open[st].n;
    const value = st === 'Delivered' ? rep.cur.delivered.reduce((t, o) => t + o.price * o.qty, 0) : open[st].value;
    const lateN = st === 'Delivered' ? 0 : late.filter((o) => o.status === st).length;
    return `
      <li class="pp pp-${st.replace(' ', '-').toLowerCase()}">
        <button type="button" data-act="orders-status" data-st="${st}" ${can('orders.view') ? '' : 'disabled'}>
          <span class="pp-top"><b class="pp-n">${n}</b>${lateN ? tag(`${lateN} late`, 'red') : ''}</span>
          <span class="pp-l">${st}</span>
          <small>${n ? money2(value) : 'Nothing here'}</small>
        </button>
      </li>`;
  });
  return `<ol class="pipe" aria-label="Order pipeline">${stages.join('')}</ol>`;
}

function queueItems() {
  return state.quotes
    .filter((q) => q.status === 'Pending')
    .sort((a, b) => Number(A.hasBreach(b)) - Number(A.hasBreach(a)) || a.at - b.at)
    .slice(0, 5);
}

function queueRow(q, canDecide) {
  const r = A.reqById(q.reqId);
  const s = A.supById(q.supplierId);
  const d = A.priceDelta(q);
  const flags = A.flagsOf(q);
  return `
    <li class="qrow" data-id="${q.id}" data-status="${q.status}">
      <button type="button" class="qrow-main" data-act="open-quote" data-id="${q.id}">
        ${avatar(s ? s.name : '?')}
        <span class="qr-t"><b>${esc(r ? r.name : 'Removed request')}</b><small>${esc(s ? s.name : '')} · <span class="${A.isOverdue(q) ? 'late' : ''}">${ago(q.at)}</span></small></span>
        <span class="qr-p"><b>${money2(q.price)}</b><small class="${d > 0 ? 'neg' : ''}">${d === 0 ? 'at asking' : signedPct(d) + ' vs asking'}</small></span>
      </button>
      ${
        canDecide
          ? `<div class="qr-acts">
        <button type="button" class="icon-btn ok" data-act="approve" data-id="${q.id}" aria-label="Approve ${A.quoteCode(q)}" title="Approve">${ic('check')}</button>
        <button type="button" class="icon-btn no" data-act="reject" data-id="${q.id}" aria-label="Reject ${A.quoteCode(q)}" title="Reject">${ic('x')}</button>
      </div>`
          : ''
      }
      ${flags.length ? `<div class="qr-flags">${flags.map((f) => tag(f.label, f.tone === 'red' ? 'red' : 'info')).join('')}</div>` : ''}
    </li>`;
}
const queueHTML = () => {
  const items = queueItems();
  const canDecide = can('quotes.decide');
  return items.length ? items.map((q) => queueRow(q, canDecide)).join('') : `<li class="q-none">${ic('check')}<span>The queue is clear.</span></li>`;
};

function restockHTML() {
  const list = needsRestock();
  if (!list.length) return `<ul class="restock"><li class="q-none">${ic('check')}<span>Nothing is running low.</span></li></ul>`;
  const canSend = can('products.send');
  return `<ul class="restock">${list
    .slice(0, 5)
    .map((p) => {
      const lv = level(p);
      return `<li class="rs-row" data-id="${p.id}"><span class="rs-t"><b>${esc(p.name)}</b><small>${esc(p.brand)} · reorder at ${p.reorder}</small></span><span class="rs-n lv-${lv}"><b>${p.stock}</b><small>${p.stock === 1 ? 'box' : 'boxes'}</small></span>${canSend ? `<button type="button" class="btn btn-sm btn-soft" data-act="send" data-id="${p.id}">${ic('send')}Send</button>` : ''}</li>`;
    })
    .join('')}</ul>${list.length > 5 ? `<p class="rs-more">${list.length - 5} more need restocking.</p>` : ''}`;
}

function lateHTML() {
  const list = state.orders.filter(isLate).sort((a, b) => a.expectedAt - b.expectedAt).slice(0, 4);
  if (!list.length) return '';
  return `<ul class="late-list">${list
    .map((o) => {
      const s = supplierOf(o);
      return `<li><button type="button" class="cl" data-act="open-order" data-id="${o.id}"><span class="cl-t"><b>${esc(o.name)}</b><small>${orderCode(o)} · ${esc(s ? s.name : '')}</small></span><span class="cl-d soon"><b>${plural(Math.max(1, daysBetween(o.expectedAt)), 'day')} late</b><small>${o.status}</small></span></button></li>`;
    })
    .join('')}</ul>`;
}

function feedHTML() {
  const icons = { quote: 'quotes', request: 'requests', supplier: 'building', settings: 'tune', auth: 'user', order: 'truck', product: 'box', site: 'megaphone', access: 'key' };
  return state.activity
    .slice(0, 7)
    .map((a) => `<li class="fi" data-id="${a.id}"><span class="fi-ic">${ic(icons[a.type] || 'activity')}</span><div class="fi-t"><span><b>${esc(a.by)}</b> ${esc(a.text)}</span><small>${ago(a.at)}</small></div></li>`)
    .join('');
}

function suppliersHTML(rep) {
  const top = rep.suppliers.filter((r) => r.spend > 0).slice(0, 5);
  if (!top.length) return empty({ icon: 'building', title: 'No orders in this period', body: 'Suppliers appear here once an order is placed.' });
  const max = Math.max(...top.map((t) => t.spend), 1);
  return `<ul class="ranks">${top
    .map(
      (t, i) => `
      <li><button type="button" class="rk" data-act="open-supplier" data-id="${esc(t.s.id)}">
        <span class="rk-n">${i + 1}</span>
        <span class="rk-t"><b>${esc(t.s.name)}</b><small>${taka(t.spend)} · ${plural(t.orders, 'order')}${t.delivered ? ` · ${Math.round(t.onTimePct)}% on time` : ''}</small>
          <span class="rk-bar"><i data-bar style="width:${Math.max(6, (t.spend / max) * 100)}%"></i></span></span>
      </button></li>`
    )
    .join('')}</ul>`;
}

const donutData = (rep) =>
  Object.keys(STATUS_COLOR).map((k) => ({ label: k, value: rep.statusCounts[k] || 0, color: STATUS_COLOR[k] }));
const legendHTML = (segs) => segs.map((s) => `<li><i style="background:${s.color}"></i><span>${s.label}</span><b>${s.value}</b></li>`).join('');

const chartKey = (rep) => JSON.stringify([ui.dash.range, rep.series.spend, rep.series.before]);

export default {
  title: 'Dashboard',

  render() {
    const first = me().name.split(' ')[0];
    const s = A.stats();
    const rep = report();
    const segs = donutData(rep);
    const hasChart = rep.series.spend.some((v) => v > 0) || rep.series.before.some((v) => v > 0);
    const orderPanels = can('orders.view');
    return `
      <header class="page-head">
        <div><h1>${greeting()}, ${esc(first)}</h1><p>${fmtLong()}</p></div>
        <div class="ph-actions">
          ${can('requests.manage') ? `<button type="button" class="btn btn-primary" data-act="new">${ic('plus')}New request</button>` : ''}
        </div>
      </header>

      <div class="dash-bar"><div id="dSeg" class="seg-wrap"></div><span class="dash-range" id="dRange"></span></div>

      ${can('quotes.view') ? `<section class="band ${s.pending ? '' : 'is-clear'}" id="band" data-reveal>${bandHTML(s)}</section>` : ''}

      <section class="kpis k6" id="kpis" data-reveal>${kpiData(rep, s).map(kpiHTML).join('')}</section>

      ${
        orderPanels
          ? `<section class="panel pipe-panel" data-reveal>
          <header class="panel-h"><div><h3>Order tracking</h3><p>Open orders right now. Delivered counts the selected period.</p></div><button type="button" class="link" data-act="orders">All orders</button></header>
          <div id="pipe">${pipeHTML(rep)}</div>
          <div id="lateBox">${lateHTML()}</div>
        </section>`
          : ''
      }

      <div class="grid g-chart">
        <section class="panel" data-reveal>
          <header class="panel-h"><div><h3>Spend</h3><p id="spendSub">${esc(rangeLabel(rep.from, rep.to))}</p></div>
            <ul class="legend"><li class="lg1"><i></i>This period</li><li class="lg2"><i></i>Before</li></ul></header>
          <div id="chartBox">${hasChart ? lineChartHTML({ id: 'ovChart' }) : empty({ icon: 'chart', title: 'No spend yet', body: 'Orders in this period will draw the line.' })}</div>
        </section>
        <section class="panel" data-reveal>
          <header class="panel-h"><div><h3>Orders by status</h3><p>Created in the period</p></div></header>
          <div class="donut-wrap">
            <div id="donutBox">${donutHTML(segs, 'orders')}</div>
            <ul class="dn-legend" id="dnLegend">${legendHTML(segs)}</ul>
          </div>
        </section>
      </div>

      <div class="grid g-queue dg-pair">
        ${
          can('quotes.view')
            ? `<section class="panel" data-reveal>
          <header class="panel-h"><div><h3>Review queue</h3><p>Flagged and oldest first</p></div>${can('requests.view') ? `<button type="button" class="link" data-act="review">View all</button>` : ''}</header>
          <ul class="queue" id="queue">${queueHTML()}</ul>
        </section>`
            : ''
        }
        ${
          can('products.view')
            ? `<section class="panel" data-reveal>
          <header class="panel-h"><div><h3>Running low</h3><p>5 boxes or fewer, not yet with suppliers</p></div><button type="button" class="link" data-act="products">Products</button></header>
          <div id="restock">${restockHTML()}</div>
        </section>`
            : ''
        }
      </div>

      <div class="grid g-bottom">
        ${
          can('suppliers.view')
            ? `<section class="panel" data-reveal>
          <header class="panel-h"><div><h3>Top suppliers</h3><p>By spend in the period</p></div><button type="button" class="link" data-act="suppliers">All suppliers</button></header>
          <div id="ranks">${suppliersHTML(rep)}</div>
        </section>`
            : ''
        }
        ${
          can('audit.view')
            ? `<section class="panel" data-reveal>
          <header class="panel-h"><div><h3>Latest activity</h3><p>Every change is logged</p></div><button type="button" class="link" data-act="audit">Open audit log</button></header>
          <ol class="feed" id="feed">${feedHTML()}</ol>
        </section>`
            : ''
        }
      </div>`;
  },

  mount(root) {
    let rep = report();
    let lastChart = '';

    const seg = mountSeg($('#dSeg', root), {
      label: 'Period',
      active: ui.dash.range,
      items: RANGES.map(([key, label]) => ({ key, label })),
      onChange: (key) => {
        ui.dash.range = key;
        paint(true);
      },
    });

    const drawChart = () => {
      const box = $('#chartBox', root);
      const key = chartKey(rep);
      if (key === lastChart) return;
      lastChart = key;
      const has = rep.series.spend.some((v) => v > 0) || rep.series.before.some((v) => v > 0);
      box.innerHTML = has ? lineChartHTML({ id: 'ovChart' }) : empty({ icon: 'chart', title: 'No spend yet', body: 'Orders in this period will draw the line.' });
      if (has) {
        const weekly = rep.days > 45;
        mountLineChart($('#ovChart', root), {
          labels: rep.series.labels,
          series: [
            { name: 'This period', values: rep.series.spend },
            { name: 'Before', values: rep.series.before },
          ],
          fmt: (v) => taka(v),
          axis: compact,
          label: (d) => (weekly ? 'Week of ' : '') + new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(d),
        });
      }
      $('.chart', root)?.classList.add('is-money');
    };

    const paintKpis = (animate) => {
      const s = A.stats();
      kpiData(rep, s).forEach((k) => {
        const v = $('#kv-' + k.key, root);
        const sub = $('#ks-' + k.key, root);
        sub.textContent = k.sub;
        sub.className = k.cls;
        if (animate) tweenNumber(v, k.value, FMT[k.fmt]);
        else {
          v.dataset.count = String(k.value);
          v.textContent = FMT[k.fmt](k.value);
        }
      });
    };

    let beforeQueue = statusSnap(queueItems());
    function paint(rangeChanged = false) {
      rep = report();
      const s = A.stats();
      $('#dRange', root).textContent = rangeLabel(rep.from, rep.to);
      paintKpis(true);

      const band = $('#band', root);
      if (band) {
        band.classList.toggle('is-clear', !s.pending);
        const was = Number(($('#bandNum', root) || {}).dataset?.value || 0);
        band.innerHTML = bandHTML(s);
        const num = $('#bandNum', root);
        if (num) tweenNumber(num, s.pending, undefined, { from: was, duration: 0.6 });
      }
      const pipe = $('#pipe', root);
      if (pipe) {
        pipe.innerHTML = pipeHTML(rep);
        $('#lateBox', root).innerHTML = lateHTML();
      }
      const segs = donutData(rep);
      $('#donutBox', root).innerHTML = donutHTML(segs, 'orders');
      $('#dnLegend', root).innerHTML = legendHTML(segs);
      const centre = $('.dn-center b', root);
      centre.textContent = centre.dataset.count;
      if (rangeChanged) mountDonut($('#donutBox', root));
      $('#spendSub', root).textContent = rangeLabel(rep.from, rep.to);
      drawChart();

      const queue = $('#queue', root);
      if (queue) {
        swapList(queue, queueHTML(), { rows: '.qrow' });
        flashChanged(queue, beforeQueue, '.qrow');
        beforeQueue = statusSnap(queueItems());
      }
      const restock = $('#restock', root);
      if (restock) restock.innerHTML = restockHTML();
      const feed = $('#feed', root);
      if (feed) feed.innerHTML = feedHTML();
      const ranks = $('#ranks', root);
      if (ranks) {
        ranks.innerHTML = suppliersHTML(rep);
        if (rangeChanged) growBars($$('[data-bar]', ranks));
      }
    }

    /* first paint: draw what render() produced, then animate it in */
    $('#dRange', root).textContent = rangeLabel(rep.from, rep.to);
    drawChart();
    mountDonut($('#donutBox', root));
    reveal($$('[data-reveal]', root), { y: 26 });
    ['money', 'int', 'pct'].forEach((f) => countUp($$(`.k-v[data-f="${f}"]`, root), FMT[f]));
    countUp($$('.dn-center b', root));
    growBars($$('[data-bar]', root));
    $$('.pp-n', root).forEach((n) => {
      n.dataset.count = n.textContent;
      n.textContent = '0';
    });
    countUp($$('.pp-n', root));

    const offData = on('data', () => paint(false));

    const go = (page, patch) => {
      if (patch) Object.assign(ui[page], patch);
      navigate(page);
    };
    const offClicks = delegate(root, {
      new: () => openRequestForm(),
      review: () => go('requests', { status: 'To review', q: '', co: 'All' }),
      orders: () => go('orders', { status: 'All', q: '', supplier: 'All', quick: 'all', from: '', to: '', page: 1 }),
      'orders-status': (t) => go('orders', { status: t.dataset.st, q: '', supplier: 'All', quick: 'all', from: '', to: '', page: 1 }),
      products: () => go('products', { max: '5', sort: 'low', q: '', brand: 'All', page: 1 }),
      suppliers: () => go('suppliers'),
      audit: () => go('audit'),
      approve: (t) => doApprove(t.dataset.id),
      reject: (t) => doReject(t.dataset.id),
      send: (t) => openSendSheet([Number(t.dataset.id)]),
      'open-quote': (t) => openQuoteSheet(t.dataset.id),
      'open-order': (t) => openOrderSheet(t.dataset.id),
      'open-supplier': (t) => openSupplierSheet(t.dataset.id),
    });

    return () => {
      offData();
      offClicks();
      seg.destroy();
    };
  },
};
