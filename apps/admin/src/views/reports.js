import { $, $$, esc, delegate } from '../core/dom.js';
import { ic } from '../core/icons.js';
import { on, ui, can } from '../core/store.js';
import { reveal, countUp, tweenNumber, growBars } from '../core/motion.js';
import { rangeOf, rangeLabel, ymd, fromYmd } from '../core/range.js';
import { buildReport, FORMULAS, reportCsv } from '../services/reports.js';
import { saveText, stamp } from '../services/files.js';
import { toast } from '../core/toast.js';
import { taka, money2, plural, signedPct } from '../core/format.js';
import { mountSeg, empty } from '../components/ui.js';
import { lineChartHTML, mountLineChart, donutHTML, mountDonut } from '../components/charts.js';
import { openSupplierSheet } from '../components/panels.js';

const S = () => ui.reports;
const QUICKS = [
  ['today', 'Today'],
  ['7d', 'Last 7 days'],
  ['month', 'This month'],
  ['last-month', 'Last month'],
  ['30d', 'Last 30 days'],
  ['90d', 'Last 90 days'],
  ['custom', 'Custom'],
];
const STATUS_COLOR = { Pending: 'var(--blue-200)', Approved: 'var(--blue-400)', 'In transit': 'var(--blue-600)', Delivered: 'var(--ink)', Cancelled: 'var(--red-500)' };

const compact = (n) => {
  n = Math.round(n);
  if (n >= 10_000_000) return '৳' + (n / 10_000_000).toFixed(1).replace(/\.0$/, '') + 'Cr';
  if (n >= 100_000) return '৳' + (n / 100_000).toFixed(1).replace(/\.0$/, '') + 'L';
  if (n >= 1000) return '৳' + (n / 1000).toFixed(n >= 10_000 ? 0 : 1).replace(/\.0$/, '') + 'k';
  return '৳' + n;
};
const dash = (f) => (n) => (Number.isFinite(n) ? f(n) : '—');
const FMT = {
  money: dash(taka),
  int: dash((n) => String(Math.round(n))),
  pct: dash((n) => (Math.round(n * 10) / 10).toFixed(1).replace(/\.0$/, '') + '%'),
  days: dash((n) => (Math.round(n * 10) / 10).toFixed(1) + ' days'),
  hours: dash((n) => (Math.round(n * 10) / 10).toFixed(1) + ' hours'),
};

/** The window the Reports page is showing. Custom dates fall back to this month until both are set. */
function windowOf() {
  const s = S();
  if (s.quick === 'custom') {
    let from = fromYmd(s.from, false);
    let to = fromYmd(s.to, true);
    if (from != null && to != null) {
      if (from > to) [from, to] = [fromYmd(s.to, false), fromYmd(s.from, true)];
      return { from, to };
    }
  }
  return rangeOf(s.quick === 'custom' ? 'month' : s.quick) || rangeOf('month');
}

const word = (rep) => `the ${rep.days} ${rep.days === 1 ? 'day' : 'days'} before`;

/** tone: 'up' means a higher number is better, 'down' a lower one is, null leaves the colour neutral. */
function delta(rep, d, tone, unit = '%') {
  if (d == null) return { text: `Nothing in ${word(rep)}`, cls: '' };
  const flat = Math.abs(d) < 0.05;
  const cls = tone == null || flat ? '' : (d > 0) === (tone === 'up') ? 'pos' : 'neg';
  const sign = d > 0 ? '+' : d < 0 ? '−' : '';
  return { text: `${unit === '%' ? signedPct(d) : sign + Math.abs(Math.round(d * 10) / 10) + ' ' + unit} vs ${word(rep)}`, cls };
}

function tiles(rep) {
  const { cur, prev } = rep;
  const dOnTime = prev.deliveredN && cur.deliveredN ? cur.onTimePct - prev.onTimePct : null;
  const dAward = prev.wins + prev.lost && cur.wins + cur.lost ? cur.awardPct - prev.awardPct : null;
  const dDays = prev.deliveredN && cur.deliveredN ? cur.days - prev.days : null;
  const dHours = prev.decided.length && cur.decided.length ? cur.decideHours - prev.decideHours : null;
  return [
    { key: 'spend', label: 'Spend', value: cur.spend, fmt: 'money', ...delta(rep, rep.delta.spend, null), note: `${plural(cur.orders, 'order')}${cur.cancelled ? `, ${cur.cancelled} cancelled left out` : ''}` },
    { key: 'orders', label: 'Orders', value: cur.orders, fmt: 'int', ...delta(rep, rep.delta.orders, null), note: 'Created in the period' },
    { key: 'avg', label: 'Average order', value: cur.avg, fmt: 'money', ...delta(rep, rep.delta.avg, null), note: 'Spend ÷ orders' },
    { key: 'saved', label: 'Saved against asking', value: cur.orders ? cur.savedPct : NaN, fmt: 'pct', ...delta(rep, cur.orders && prev.orders ? cur.savedPct - prev.savedPct : null, 'up', 'pts'), note: cur.orders ? `${money2(cur.saved)} below what we asked` : 'No orders in the period' },
    { key: 'ontime', label: 'On-time delivery', value: cur.deliveredN ? cur.onTimePct : NaN, fmt: 'pct', ...delta(rep, dOnTime, 'up', 'pts'), note: cur.deliveredN ? `${cur.onTime} of ${plural(cur.deliveredN, 'delivered order')}` : 'Nothing delivered in the period' },
    { key: 'days', label: 'Days to deliver', value: cur.deliveredN ? cur.days : NaN, fmt: 'days', ...delta(rep, dDays, 'down', 'days'), note: 'Ordered to delivered, on average' },
    { key: 'award', label: 'Award rate', value: cur.wins + cur.lost ? cur.awardPct : NaN, fmt: 'pct', ...delta(rep, dAward, 'up', 'pts'), note: `${cur.wins} awarded, ${cur.lost} rejected` },
    { key: 'decide', label: 'Time to decision', value: cur.decided.length ? cur.decideHours : NaN, fmt: 'hours', ...delta(rep, dHours, 'down', 'hours'), note: `${plural(cur.decided.length, 'quote')} decided` },
  ];
}

const tileHTML = (t) => `<div class="kpi" data-k="${t.key}"><span class="k-l">${t.label}</span><b class="k-v" id="rv-${t.key}" data-count="${t.value}" data-f="${t.fmt}">0</b><small id="rd-${t.key}" class="${t.cls}">${esc(t.text)}</small><small class="k-note" id="rn-${t.key}">${esc(t.note)}</small></div>`;

function barsHTML(rows, empty_) {
  if (!rows.length) return empty(empty_);
  const max = Math.max(...rows.map((r) => r.value), 1);
  const total = rows.reduce((n, r) => n + r.value, 0) || 1;
  return `<ul class="hbars">${rows
    .map(
      (r) => `
      <li><span class="hb-t"><b>${esc(r.label)}</b><small>${r.sub ? esc(r.sub) : ''}</small></span>
        <span class="hb-v"><b>${taka(r.value)}</b><small>${Math.round((r.value / total) * 100)}%</small></span>
        <span class="hb-bar"><i data-bar style="width:${Math.max(3, (r.value / max) * 100)}%"></i></span></li>`
    )
    .join('')}</ul>`;
}

function tableHTML(rep) {
  const rows = rep.suppliers;
  if (!rows.length) return empty({ icon: 'building', title: 'No supplier activity', body: 'Nothing was quoted or ordered in this period.' });
  const tot = rows.reduce(
    (t, r) => ({ quotes: t.quotes + r.quotes, wins: t.wins + r.wins, decided: t.decided + r.decided, orders: t.orders + r.orders, spend: t.spend + r.spend }),
    { quotes: 0, wins: 0, decided: 0, orders: 0, spend: 0 }
  );
  const pct = (n) => (Math.round(n * 10) / 10).toFixed(1).replace(/\.0$/, '') + '%';
  return `
    <div class="rtable-wrap" tabindex="0" role="region" aria-label="Supplier performance">
      <table class="rtable">
        <thead><tr><th scope="col">Supplier</th><th scope="col" class="r">Quotes</th><th scope="col" class="r">Awarded</th><th scope="col" class="r">Award rate</th><th scope="col" class="r">Orders</th><th scope="col" class="r">Spend</th><th scope="col" class="r">Saved vs asking</th><th scope="col" class="r">On time</th></tr></thead>
        <tbody>${rows
          .map(
            (r) => `<tr><th scope="row"><button type="button" class="link" data-act="open-supplier" data-id="${esc(r.s.id)}">${esc(r.s.name)}</button><small>${esc(r.s.id)} · ${esc(r.s.city)}</small></th>
              <td class="r">${r.quotes}</td><td class="r">${r.wins}</td><td class="r">${r.decided ? pct(r.awardPct) : '—'}</td><td class="r">${r.orders}</td><td class="r"><b>${taka(r.spend)}</b></td><td class="r">${r.orders ? pct(r.savedPct) : '—'}</td><td class="r">${r.delivered ? pct(r.onTimePct) : '—'}</td></tr>`
          )
          .join('')}</tbody>
        <tfoot><tr><th scope="row">All suppliers</th><td class="r">${tot.quotes}</td><td class="r">${tot.wins}</td><td class="r">${tot.decided ? pct((tot.wins / tot.decided) * 100) : '—'}</td><td class="r">${tot.orders}</td><td class="r"><b id="tSpend">${taka(tot.spend)}</b></td><td class="r">${rep.cur.orders ? pct(rep.cur.savedPct) : '—'}</td><td class="r">${rep.cur.deliveredN ? pct(rep.cur.onTimePct) : '—'}</td></tr></tfoot>
      </table>
    </div>`;
}

const donutData = (rep) => Object.keys(STATUS_COLOR).map((k) => ({ label: k, value: rep.statusCounts[k] || 0, color: STATUS_COLOR[k] }));
const legendHTML = (segs) => segs.map((s) => `<li><i style="background:${s.color}"></i><span>${s.label}</span><b>${s.value}</b></li>`).join('');

export default {
  title: 'Reports',

  render() {
    const s = S();
    return `
      <header class="page-head">
        <div><h1>Reports</h1><p id="rSub"></p></div>
        <div class="ph-actions">${can('reports.export') ? `<button type="button" class="btn btn-ghost" data-act="export">${ic('download')}Export report</button>` : ''}</div>
      </header>

      <div class="seg-row"><div id="rSeg" class="seg-wrap"></div></div>
      <div class="r-custom" id="rCustom" ${s.quick === 'custom' ? '' : 'hidden'}>
        <label class="fl"><span>Start date</span><div class="date-in"><input type="date" id="rFrom" value="${esc(s.from)}" aria-label="Start date" /></div></label>
        <label class="fl"><span>End date</span><div class="date-in"><input type="date" id="rTo" value="${esc(s.to)}" aria-label="End date" /></div></label>
        <p class="r-hint" id="rHint"></p>
      </div>

      <section class="kpis k8" id="kpis" data-reveal></section>

      <div class="grid g-chart">
        <section class="panel" data-reveal>
          <header class="panel-h"><div><h3>Spend over time</h3><p id="rTrendSub"></p></div>
            <ul class="legend"><li class="lg1"><i></i>This period</li><li class="lg2"><i></i>Before</li></ul></header>
          <div id="rChart"></div>
        </section>
        <section class="panel" data-reveal>
          <header class="panel-h"><div><h3>Orders by status</h3><p>Created in the period</p></div></header>
          <div class="donut-wrap"><div id="rDonut"></div><ul class="dn-legend" id="rLegend"></ul></div>
        </section>
      </div>

      <div class="grid g-bottom">
        <section class="panel" data-reveal><header class="panel-h"><div><h3>Spend by supplier</h3><p>Cancelled orders left out</p></div></header><div id="rSup"></div></section>
        <section class="panel" data-reveal><header class="panel-h"><div><h3>Spend by company</h3><p>Who makes what we buy</p></div></header><div id="rCo"></div></section>
      </div>

      <section class="panel" data-reveal>
        <header class="panel-h"><div><h3>Supplier performance</h3><p>Quotes, orders and delivery for the period</p></div></header>
        <div id="rTable"></div>
      </section>

      <section class="panel formulas" data-reveal>
        <details>
          <summary class="panel-h"><div><h3>How these numbers are worked out</h3><p>Every figure above follows one of these rules.</p></div>${ic('chd', 'sum-ic')}</summary>
          <dl class="fm-list">${FORMULAS.map((f) => `<div><dt>${esc(f.name)}</dt><dd>${esc(f.rule)}${f.note ? `<small>${esc(f.note)}</small>` : ''}</dd></div>`).join('')}</dl>
          <p class="fm-foot">The previous period is the same number of days straight before the one you chose. A day runs from 00:00 to 23:59 in your local time.</p>
        </details>
      </section>`;
  },

  mount(root) {
    let rep = null;
    let lastChart = '';
    let first = true;

    const seg = mountSeg($('#rSeg', root), {
      label: 'Report period',
      active: S().quick,
      items: QUICKS.map(([key, label]) => ({ key, label })),
      onChange: (key) => {
        S().quick = key;
        if (key === 'custom' && !S().from) {
          const w = rangeOf('month');
          S().from = ymd(w.from);
          S().to = ymd(w.to);
        } else if (key !== 'custom') {
          const w = rangeOf(key);
          S().from = ymd(w.from);
          S().to = ymd(w.to);
        }
        $('#rFrom', root).value = S().from;
        $('#rTo', root).value = S().to;
        paint(true);
      },
    });

    function drawChart() {
      const box = $('#rChart', root);
      const key = JSON.stringify([rep.from, rep.to, rep.series.spend, rep.series.before]);
      if (key === lastChart) return;
      lastChart = key;
      const has = rep.series.spend.some((v) => v > 0) || rep.series.before.some((v) => v > 0);
      if (!has) {
        box.innerHTML = empty({ icon: 'chart', title: 'No spend in this period', body: 'Pick a longer period or another range.' });
        return;
      }
      box.innerHTML = lineChartHTML({ id: 'rLine' });
      const weekly = rep.days > 45;
      mountLineChart($('#rLine', root), {
        labels: rep.series.labels,
        series: [
          { name: 'This period', values: rep.series.spend },
          { name: 'Before', values: rep.series.before },
        ],
        fmt: (v) => taka(v),
        axis: compact,
        label: (d) => (weekly ? 'Week of ' : '') + new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(d),
      });
      $('#rLine', root).classList.add('is-money');
    }

    function paint(fresh = false) {
      const w = windowOf();
      rep = buildReport(w);
      $('#rCustom', root).hidden = S().quick !== 'custom';
      $('#rSub', root).textContent = `${rangeLabel(rep.from, rep.to)} · compared with ${rangeLabel(rep.prevFrom, rep.prevTo)}`;
      $('#rHint', root).textContent = S().quick === 'custom' && !(S().from && S().to) ? 'Pick both dates. This month is shown meanwhile.' : `${plural(rep.days, 'day')} selected`;
      $('#rTrendSub', root).textContent = rep.series.note || (rep.days > 45 ? 'One point per week' : 'One point per day');

      const t = tiles(rep);
      const kp = $('#kpis', root);
      if (!$('.kpi', kp)) {
        kp.innerHTML = t.map(tileHTML).join('');
        ['money', 'int', 'pct', 'days', 'hours'].forEach((f) => countUp($$(`.k-v[data-f="${f}"]`, kp), FMT[f]));
      } else {
        t.forEach((k) => {
          $('#rd-' + k.key, kp).textContent = k.text;
          $('#rd-' + k.key, kp).className = k.cls;
          $('#rn-' + k.key, kp).textContent = k.note;
          tweenNumber($('#rv-' + k.key, kp), k.value, FMT[k.fmt]);
        });
      }

      drawChart();
      const segs = donutData(rep);
      $('#rDonut', root).innerHTML = donutHTML(segs, 'orders');
      const c = $('.dn-center b', $('#rDonut', root));
      c.textContent = c.dataset.count;
      $('#rLegend', root).innerHTML = legendHTML(segs);
      if (fresh) mountDonut($('#rDonut', root));

      const sup = rep.suppliers.filter((r) => r.spend > 0).slice(0, 8).map((r) => ({ label: r.s.name, sub: plural(r.orders, 'order'), value: r.spend }));
      $('#rSup', root).innerHTML = barsHTML(sup, { icon: 'building', title: 'No orders', body: 'Spend by supplier appears once an order is placed.' });
      $('#rCo', root).innerHTML = barsHTML(
        rep.companies.slice(0, 8).map((x) => ({ label: x.co, sub: '', value: x.value })),
        { icon: 'box', title: 'No orders', body: 'Spend by company appears once an order is placed.' }
      );
      $('#rTable', root).innerHTML = tableHTML(rep);
      if (fresh || first) growBars($$('[data-bar]', root));
    }
    paint(true);
    first = false;
    reveal($$('[data-reveal]', root), { y: 26 });

    const onDate = () => {
      S().from = $('#rFrom', root).value;
      S().to = $('#rTo', root).value;
      paint(true);
    };
    $('#rFrom', root).addEventListener('change', onDate);
    $('#rTo', root).addEventListener('change', onDate);

    const offClicks = delegate(root, {
      export: async () => {
        const result = await saveText(`medifast-report-${stamp()}.csv`, reportCsv(rep));
        if (result === 'saved') toast('Report exported to CSV');
      },
      'open-supplier': (t) => openSupplierSheet(t.dataset.id),
    });
    const offData = on('data', () => paint(false));
    return () => {
      offClicks();
      offData();
      seg.destroy();
    };
  },
};
