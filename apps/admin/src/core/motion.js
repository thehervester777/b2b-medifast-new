import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { ScrollToPlugin } from 'gsap/ScrollToPlugin';

gsap.registerPlugin(ScrollTrigger, ScrollToPlugin);

/*
 * Motion engine.
 *
 *  - Everything animates transform / opacity, so it stays on the compositor. The two
 *    exceptions are tiny SVG stroke draws (chart lines, donut) which are cheap.
 *  - Smooth scrolling is GSAP (ScrollToPlugin) easing the real page scroll position, so
 *    ScrollTrigger, the sticky top bar and the fixed sidebar all keep working exactly as
 *    they do with native scrolling. Nothing is wrapped in a transformed container.
 *    It only applies to a mouse wheel; touch screens keep their own native momentum,
 *    and it is off for reduced motion and for weak devices (LITE).
 *  - ScrollTrigger reads the scroll position and drives every scroll effect below.
 *  - LITE trims durations, staggers and scrubbed effects on weak hardware / data saver.
 *  - prefers-reduced-motion switches every animation off.
 */
const nav = typeof navigator !== 'undefined' ? navigator : {};

export const RM = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
export const LITE = !!(
  nav.connection?.saveData ||
  (nav.deviceMemory && nav.deviceMemory <= 4) ||
  (nav.hardwareConcurrency && nav.hardwareConcurrency <= 4)
);
export const ANIM = !RM;

export { gsap, ScrollTrigger };

export function initMotion() {
  gsap.config({ nullTargetWarn: false });
  gsap.defaults({ ease: 'power3.out', duration: 0.5 });
  /* After a long frame (page swap, first paint) carry on from where tweens were instead of jumping to the end. */
  gsap.ticker.lagSmoothing(500, 33);
  /* The mobile URL bar collapsing resizes the viewport; do not rebuild every trigger for it. */
  ScrollTrigger.config({ ignoreMobileResize: true, autoRefreshEvents: 'visibilitychange,DOMContentLoaded,load' });
  const root = document.documentElement;
  root.classList.toggle('anim', ANIM);
  root.classList.toggle('lite', LITE);
  smoothWheel();
}

/* ---------- smooth scrolling ---------- */
const maxScroll = () => Math.max(0, document.documentElement.scrollHeight - window.innerHeight);

/** Glide the page to a position. Instant when motion is reduced. */
export function scrollToY(y, { duration } = {}) {
  const to = Math.max(0, Math.min(y, maxScroll()));
  const dist = Math.abs(to - window.scrollY);
  if (!ANIM || dist < 2) {
    gsap.killTweensOf(window);
    window.scrollTo(0, to);
    return;
  }
  gsap.to(window, { scrollTo: { y: to, autoKill: true }, duration: duration ?? Math.min(0.85, 0.35 + dist / 4500), ease: 'power3.out', overwrite: true });
}

/** Jump to the top without animation (used when a new page replaces the old one). */
export function jumpTop() {
  gsap.killTweensOf(window);
  window.scrollTo(0, 0);
}

/**
 * Ease mouse-wheel scrolling. Each wheel tick moves a target; GSAP eases the real scroll
 * position toward it. Skipped over any element that scrolls on its own (drawers, lists).
 */
const WHEEL_SPEED = 1.7; /* one wheel notch travels this many times further than native */
function smoothWheel() {
  if (!ANIM || LITE || !window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
  const html = document.documentElement;
  let target = window.scrollY;
  let tween = null;

  const scrollsItself = (node) => {
    for (let n = node; n && n !== document.body && n !== html; n = n.parentElement) {
      const oy = getComputedStyle(n).overflowY;
      if ((oy === 'auto' || oy === 'scroll') && n.scrollHeight > n.clientHeight + 1) return true;
    }
    return false;
  };

  window.addEventListener('scroll', () => {
    if (!tween || !tween.isActive()) target = window.scrollY;
  }, { passive: true });

  window.addEventListener(
    'wheel',
    (e) => {
      if (e.ctrlKey || e.metaKey || e.defaultPrevented || html.classList.contains('is-locked')) return;
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      if (scrollsItself(e.target)) return;
      /* Trackpads send many tiny deltas and already have their own momentum. Easing those
         only adds lag, so leave them native and ease real mouse-wheel notches. */
      if (e.deltaMode === 0 && Math.abs(e.deltaY) < 50) return;
      const dy = e.deltaMode === 1 ? e.deltaY * 34 : e.deltaMode === 2 ? e.deltaY * window.innerHeight : e.deltaY;
      e.preventDefault();
      if (!tween || !tween.isActive()) target = window.scrollY;
      target = Math.max(0, Math.min(target + dy * WHEEL_SPEED, maxScroll()));
      tween = gsap.to(window, {
        scrollTo: { y: target, autoKill: false },
        duration: 0.55,
        ease: 'power2.out',
        overwrite: true,
        onComplete: () => (target = window.scrollY),
      });
    },
    { passive: false }
  );
}

/* ---------- per-page trigger tracking ---------- */
let tracked = [];
export const track = (t) => {
  if (t) tracked.push(t);
  return t;
};
/** Called by the router before a page is replaced. */
export function killPage() {
  tracked.forEach((t) => t.kill());
  tracked = [];
}

let refreshQueued = false;
/** Re-measure triggers once per frame, however many callers ask. */
export function refresh() {
  if (refreshQueued) return;
  refreshQueued = true;
  requestAnimationFrame(() => {
    refreshQueued = false;
    ScrollTrigger.refresh();
  });
}

/* ---------- entrances ---------- */

/**
 * Fade + rise elements as they scroll into view, in small batches so a long table
 * costs a handful of tweens rather than one trigger per row.
 */
export function reveal(elements, { y = 22, start = 'top 94%', stagger } = {}) {
  const list = Array.from(elements || []);
  if (!ANIM || !list.length) return [];
  gsap.set(list, { opacity: 0, y });
  const triggers = ScrollTrigger.batch(list, {
    start,
    once: true,
    batchMax: LITE ? 4 : 8,
    onEnter: (batch) =>
      gsap.to(batch, {
        opacity: 1,
        y: 0,
        duration: LITE ? 0.35 : 0.65,
        stagger: stagger ?? (LITE ? 0.025 : 0.06),
        ease: 'power3.out',
        overwrite: true,
        clearProps: 'transform,opacity',
      }),
  });
  triggers.forEach(track);
  /* Safety net: anything on screen that never got triggered (rapid navigation, odd layouts) is shown. */
  gsap.delayedCall(2.4, () =>
    list.forEach((node) => {
      if (node.isConnected && parseFloat(getComputedStyle(node).opacity) < 0.05 && node.getBoundingClientRect().top < innerHeight) {
        gsap.to(node, { opacity: 1, y: 0, duration: 0.3, clearProps: 'transform,opacity' });
      }
    })
  );
  return triggers;
}

/** Run a function once, the first time an element scrolls into view. */
export function onView(node, fn, { start = 'top 92%' } = {}) {
  if (!node) return null;
  if (!ANIM) {
    fn();
    return null;
  }
  return track(ScrollTrigger.create({ trigger: node, start, once: true, onEnter: fn }));
}

/** Tween a number inside a node. Used for first-view count-ups and for live updates. */
export function tweenNumber(node, to, format = (n) => String(Math.round(n)), { from, duration } = {}) {
  if (!node) return;
  const start = from ?? (Number(node.dataset.value) || 0);
  node.dataset.value = String(to);
  /* A figure with nothing behind it (NaN) is shown as the format function decides, not counted to. */
  if (!ANIM || start === to || !Number.isFinite(to)) {
    node.textContent = format(to);
    return;
  }
  const o = { v: start };
  gsap.killTweensOf(o);
  gsap.to(o, {
    v: to,
    duration: duration ?? (LITE ? 0.5 : 0.9),
    ease: 'power2.out',
    onUpdate: () => {
      node.textContent = format(o.v);
    },
    onComplete: () => {
      node.textContent = format(to);
    },
  });
}

/** Count numbers up once, the first time they are seen. Nodes carry data-count. */
export function countUp(nodes, format = (n) => String(Math.round(n))) {
  Array.from(nodes || []).forEach((node) => {
    const to = Number(node.dataset.count);
    node.dataset.value = '0';
    node.textContent = format(ANIM && Number.isFinite(to) ? 0 : to);
    if (!ANIM || !Number.isFinite(to)) {
      node.dataset.value = String(to);
      return;
    }
    onView(node, () => tweenNumber(node, to, format, { from: 0, duration: LITE ? 0.6 : 1.1 }), { start: 'top 98%' });
  });
}

/** Draw an SVG path from nothing. */
export function drawPath(path, { duration = 1.4, delay = 0, ease = 'power2.inOut' } = {}) {
  if (!path || !ANIM) return null;
  const length = path.getTotalLength ? path.getTotalLength() : 0;
  if (!length) return null;
  gsap.set(path, { strokeDasharray: length, strokeDashoffset: length });
  return gsap.to(path, {
    strokeDashoffset: 0,
    duration: LITE ? duration * 0.7 : duration,
    delay,
    ease,
    clearProps: 'strokeDasharray,strokeDashoffset',
  });
}

/** Grow horizontal bars from the left, once, when they scroll into view. */
export function growBars(bars) {
  const list = Array.from(bars || []);
  if (!ANIM || !list.length) return;
  gsap.set(list, { scaleX: 0, transformOrigin: 'left center' });
  list.forEach((bar, i) =>
    onView(bar, () => gsap.to(bar, { scaleX: 1, duration: LITE ? 0.4 : 0.9, delay: i * 0.05, ease: 'power3.out', clearProps: 'transform' }), { start: 'top 96%' })
  );
}

/* ---------- page swap ---------- */
export function pageOut(node) {
  if (!ANIM) return Promise.resolve();
  return new Promise((resolve) =>
    gsap.to(node, { opacity: 0, y: -6, duration: LITE ? 0.1 : 0.16, ease: 'power1.in', onComplete: resolve })
  );
}

export function pageIn(node) {
  if (!ANIM) return;
  gsap.fromTo(
    node,
    { opacity: 0, y: 10 },
    { opacity: 1, y: 0, duration: LITE ? 0.28 : 0.5, ease: 'power3.out', clearProps: 'transform,opacity' }
  );
}

/** A quick staggered entrance for things already on screen (sidebar links, login form). */
export function enter(nodes, { y = 14, x = 0, stagger = 0.06, delay = 0, duration } = {}) {
  const list = Array.from(nodes || []);
  if (!ANIM || !list.length) return;
  gsap.fromTo(
    list,
    { opacity: 0, y, x },
    { opacity: 1, y: 0, x: 0, duration: duration ?? (LITE ? 0.3 : 0.6), stagger: LITE ? stagger / 2 : stagger, delay, ease: 'power3.out', clearProps: 'transform,opacity' }
  );
}

/* ---------- micro-interactions ---------- */
export function pop(node, from = 1.25) {
  if (!ANIM || !node) return;
  gsap.fromTo(node, { scale: from }, { scale: 1, duration: 0.5, ease: 'back.out(3)', clearProps: 'transform' });
}

/** A soft blue wash that fades out, to show which row just changed. */
export function flash(node) {
  if (!ANIM || !node) return;
  gsap.fromTo(node, { backgroundColor: 'rgba(35, 88, 230, 0.14)' }, { backgroundColor: 'rgba(35, 88, 230, 0)', duration: 1.4, ease: 'power2.out', clearProps: 'backgroundColor' });
}

export function shake(node) {
  if (!ANIM || !node) return;
  gsap.to(node, {
    keyframes: [
      { x: -8, duration: 0.06 },
      { x: 8, duration: 0.08 },
      { x: -5, duration: 0.08 },
      { x: 5, duration: 0.08 },
      { x: 0, duration: 0.06 },
    ],
    clearProps: 'transform',
  });
}

/* ---------- persistent chrome: runs once for the whole session ---------- */
export function setupScrollChrome({ topbar, toTop }) {
  ScrollTrigger.create({
    start: 8,
    end: 'max',
    onToggle: (self) => topbar.classList.toggle('is-scrolled', self.isActive),
  });
  if (toTop) {
    ScrollTrigger.create({
      start: 640,
      end: 'max',
      onToggle: (self) => toTop.classList.toggle('on', self.isActive),
    });
  }
}

/**
 * Show the page title in the top bar once the big heading has scrolled away.
 * Returns the trigger so the router can drop it with the page.
 */
export function bindPageTitle(heading, topbar) {
  topbar.classList.remove('title-on');
  if (!heading) return null;
  return track(
    ScrollTrigger.create({
      trigger: heading,
      start: 'bottom top+=72',
      end: 'max',
      onToggle: (self) => topbar.classList.toggle('title-on', self.isActive),
    })
  );
}
