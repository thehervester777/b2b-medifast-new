import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

/*
 * Motion engine.
 *
 *  - Everything animates transform / opacity only, so it stays on the compositor.
 *  - Scrolling itself is native. A scroll-hijacking smoother has to run JS on every
 *    frame, which is exactly what a low-end phone cannot afford. ScrollTrigger just
 *    reads the native scroll position and drives the effects below.
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
}

/* ---------- per-page trigger tracking ---------- */
let tracked = [];
const track = (t) => {
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
 * Fade + rise elements as they scroll into view, in small batches so a long list
 * costs a handful of tweens rather than one trigger per row.
 */
export function reveal(elements, { y = 22, start = 'top 95%' } = {}) {
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
        stagger: LITE ? 0.025 : 0.06,
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

/** Count numbers up once, the first time they are seen. Nodes carry data-count. */
export function countUp(nodes, format = (n) => String(n)) {
  const list = Array.from(nodes || []);
  list.forEach((node) => {
    const to = Number(node.dataset.count);
    node.textContent = format(ANIM ? 0 : to);
    if (!ANIM) return;
    const o = { v: 0 };
    track(
      ScrollTrigger.create({
        trigger: node,
        start: 'top 98%',
        once: true,
        onEnter: () =>
          gsap.to(o, {
            v: to,
            duration: LITE ? 0.6 : 1.1,
            ease: 'power2.out',
            onUpdate: () => {
              node.textContent = format(Math.round(o.v * 100) / 100 === Math.round(o.v) ? Math.round(o.v) : o.v);
            },
            onComplete: () => {
              node.textContent = format(to);
            },
          }),
      })
    );
  });
}

/** Draw an SVG path from nothing, like a heartbeat trace. */
export function drawPath(path, { duration = 1.6, delay = 0, ease = 'power2.inOut' } = {}) {
  if (!path || !ANIM) return null;
  const length = path.getTotalLength();
  gsap.set(path, { strokeDasharray: length, strokeDashoffset: length });
  return gsap.to(path, { strokeDashoffset: 0, duration: LITE ? duration * 0.7 : duration, delay, ease });
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

/* ---------- micro-interactions ---------- */
export function pop(node, from = 1.35) {
  if (!ANIM || !node) return;
  gsap.fromTo(node, { scale: from }, { scale: 1, duration: 0.5, ease: 'back.out(3)', clearProps: 'transform' });
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

/** Slide new content in from a side (wizard steps). */
export function slideIn(node, dir = 1) {
  if (!ANIM) return;
  gsap.fromTo(
    node,
    { opacity: 0, x: 26 * dir },
    { opacity: 1, x: 0, duration: LITE ? 0.25 : 0.45, ease: 'power3.out', clearProps: 'transform,opacity' }
  );
}

/** A small dot that flies from a button to the cart pill. */
export function flyTo(fromRect, toNode) {
  if (!ANIM || LITE || !fromRect || !toNode || !fromRect.width) return;
  const to = toNode.getBoundingClientRect();
  if (!to.width) return;
  const dot = document.createElement('i');
  dot.className = 'fly-dot';
  document.body.appendChild(dot);
  const sx = fromRect.left + fromRect.width / 2;
  const sy = fromRect.top + fromRect.height / 2;
  const tx = to.left + to.width / 2;
  const ty = to.top + to.height / 2;
  gsap.set(dot, { x: sx, y: sy, scale: 0.5, opacity: 0 });
  gsap.to(dot, { opacity: 1, scale: 1, duration: 0.16 });
  gsap.to(dot, { x: tx, duration: 0.7, ease: 'power2.inOut' });
  gsap.to(dot, {
    y: ty,
    duration: 0.7,
    ease: 'power3.in',
    onComplete: () => {
      gsap.to(dot, { scale: 0.3, opacity: 0, duration: 0.18, onComplete: () => dot.remove() });
      pop(toNode, 1.18);
    },
  });
}

/* ---------- persistent chrome: runs once for the whole session ---------- */
export function setupScrollChrome({ topbar, toTop }) {
  ScrollTrigger.create({
    start: 8,
    end: 'max',
    onToggle: (self) => topbar.classList.toggle('is-scrolled', self.isActive),
  });
  ScrollTrigger.create({
    start: 640,
    end: 'max',
    onToggle: (self) => toTop.classList.toggle('on', self.isActive),
  });
}
