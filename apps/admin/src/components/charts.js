import { $, $$, clamp } from '../core/dom.js';
import { gsap, ANIM, LITE, drawPath, onView } from '../core/motion.js';

/*
 * Charts are plain SVG, drawn here, with no chart library. Lines and areas stretch with
 * the container (non-scaling strokes); every label, dot and tooltip is HTML so text stays crisp.
 */
const W = 600;
const H = 200;
const SHORT = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });

const niceStep = (raw) => {
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
};

/** A smooth line through the points (Catmull-Rom turned into Béziers). */
function smooth(pts) {
  if (pts.length < 2) return '';
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] || p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, clamp(p1[1] + (p2[1] - p0[1]) / 6, 0, H)];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, clamp(p2[1] - (p3[1] - p1[1]) / 6, 0, H)];
    d += ` C${c1[0].toFixed(1)},${c1[1].toFixed(1)} ${c2[0].toFixed(1)},${c2[1].toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  return d;
}

export function lineChartHTML({ id }) {
  return `
    <div class="chart" id="${id}">
      <div class="ch-body">
        <div class="ch-y" aria-hidden="true"></div>
        <div class="ch-plot">
          <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true"></svg>
          <i class="ch-guide" aria-hidden="true"></i>
          <i class="ch-dot d1" aria-hidden="true"></i>
          <i class="ch-dot d2" aria-hidden="true"></i>
          <div class="ch-tip" role="status"></div>
          <div class="ch-hit" tabindex="0" role="img"></div>
        </div>
      </div>
      <div class="ch-x" aria-hidden="true"></div>
    </div>`;
}

/**
 * series[0] is drawn as the filled main line, series[1] as a thinner line.
 * labels are Date objects, one per point.
 */
export function mountLineChart(root, { labels, series, fmt = (v) => String(v), axis = (v) => String(v), label = (d) => SHORT.format(d) }) {
  const n = labels.length;
  const all = series.flatMap((s) => s.values);
  const step = niceStep(Math.max(2, Math.max(...all)) / 4);
  const top = step * 4;
  const x = (i) => (i / (n - 1)) * W;
  const y = (v) => H - (v / top) * (H - 8) - 4;
  const pts = series.map((s) => s.values.map((v, i) => [x(i), y(v)]));

  /* grid + y labels */
  const grid = [0, 1, 2, 3, 4].map((k) => `<line x1="0" x2="${W}" y1="${y(k * step).toFixed(1)}" y2="${y(k * step).toFixed(1)}" class="g"/>`).join('');
  const area = `${smooth(pts[0])} L${W},${H} L0,${H} Z`;
  $('svg', root).innerHTML =
    `${grid}<path class="area" d="${area}"/>` +
    (pts[1] ? `<path class="line l2" d="${smooth(pts[1])}"/>` : '') +
    `<path class="line l1" d="${smooth(pts[0])}"/>`;
  $('.ch-y', root).innerHTML = [4, 3, 2, 1, 0].map((k) => `<span style="top:${(y(k * step) / H) * 100}%">${axis(k * step)}</span>`).join('');
  const every = n > 10 ? 3 : 1;
  $('.ch-x', root).innerHTML = labels
    .map((d, i) => ((i % every === 0 && n - 1 - i >= every) || i === n - 1 ? `<span style="left:${(i / (n - 1)) * 100}%">${SHORT.format(d)}</span>` : ''))
    .join('');

  /* hover / touch / keyboard */
  const plot = $('.ch-plot', root);
  const hit = $('.ch-hit', root);
  const guide = $('.ch-guide', root);
  const tip = $('.ch-tip', root);
  const dots = [$('.ch-dot.d1', root), $('.ch-dot.d2', root)];
  let cur = -1;
  hit.setAttribute('aria-label', `${series.map((s) => s.name).join(' and ')} over time. Use the arrow keys to read each point.`);

  const show = (i) => {
    cur = clamp(i, 0, n - 1);
    const left = (cur / (n - 1)) * 100;
    plot.classList.add('is-on');
    guide.style.left = left + '%';
    series.forEach((s, k) => {
      if (dots[k]) {
        dots[k].style.left = left + '%';
        dots[k].style.top = (y(s.values[cur]) / H) * 100 + '%';
      }
    });
    tip.innerHTML = `<b>${label(labels[cur])}</b>` + series.map((s, k) => `<span class="k${k}"><i></i>${s.name} <em>${fmt(s.values[cur])}</em></span>`).join('');
    tip.style.left = clamp(left, 14, 86) + '%';
  };
  const hide = () => {
    cur = -1;
    plot.classList.remove('is-on');
  };
  const fromEvent = (e) => {
    const r = plot.getBoundingClientRect();
    show(Math.round(((e.clientX - r.left) / r.width) * (n - 1)));
  };
  hit.addEventListener('pointermove', fromEvent);
  hit.addEventListener('pointerdown', fromEvent);
  hit.addEventListener('pointerleave', (e) => e.pointerType === 'mouse' && hide());
  hit.addEventListener('blur', hide);
  hit.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight') show(cur < 0 ? 0 : cur + 1);
    else if (e.key === 'ArrowLeft') show(cur < 0 ? n - 1 : cur - 1);
    else return;
    e.preventDefault();
  });

  /* draw-in when it scrolls into view */
  if (ANIM) {
    const l1 = $('.line.l1', root);
    const l2 = $('.line.l2', root);
    const a = $('.area', root);
    gsap.set(a, { opacity: 0 });
    gsap.set($$('.line', root), { opacity: 0 });
    onView(root, () => {
      gsap.set($$('.line', root), { opacity: 1 });
      drawPath(l1, { duration: 1.5 });
      if (l2) drawPath(l2, { duration: 1.5, delay: 0.15 });
      gsap.to(a, { opacity: 1, duration: 1.2, delay: 0.5, ease: 'power2.out' });
    });
  }
}

/* ---------- donut ---------- */
const R = 46;
const C = 2 * Math.PI * R;

export function donutHTML(segments, centerLabel) {
  const total = segments.reduce((s, x) => s + x.value, 0) || 1;
  let offset = 0;
  const gap = segments.filter((s) => s.value > 0).length > 1 ? 3 : 0;
  const arcs = segments
    .map((s) => {
      const len = Math.max(0, (s.value / total) * C - gap);
      const html = `<circle class="dn-seg" data-len="${len.toFixed(2)}" cx="60" cy="60" r="${R}" style="stroke:${s.color};stroke-dasharray:${len.toFixed(2)} ${(C - len).toFixed(2)};stroke-dashoffset:${(-offset).toFixed(2)}"/>`;
      offset += (s.value / total) * C;
      return html;
    })
    .join('');
  return `
    <div class="donut">
      <svg viewBox="0 0 120 120" aria-hidden="true"><circle class="dn-bg" cx="60" cy="60" r="${R}"/><g transform="rotate(-90 60 60)">${arcs}</g></svg>
      <div class="dn-center"><b data-count="${segments.reduce((s, x) => s + x.value, 0)}">0</b><span>${centerLabel}</span></div>
    </div>`;
}

/** Sweep each arc in, one after another. */
export function mountDonut(root) {
  if (!ANIM) return;
  const arcs = $$('.dn-seg', root);
  arcs.forEach((c) => (c.style.strokeDasharray = `0 ${C}`));
  onView(root, () => {
    arcs.forEach((c, i) => {
      const len = Number(c.dataset.len);
      const o = { p: 0 };
      gsap.to(o, {
        p: 1,
        duration: LITE ? 0.5 : 1,
        delay: i * 0.12,
        ease: 'power3.out',
        onUpdate: () => (c.style.strokeDasharray = `${(len * o.p).toFixed(2)} ${C}`),
        onComplete: () => (c.style.strokeDasharray = `${len} ${C - len}`),
      });
    });
  });
}
