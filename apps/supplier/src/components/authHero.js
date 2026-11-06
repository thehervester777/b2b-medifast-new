import { logo } from '../core/icons.js';
import { gsap, ANIM, LITE, drawPath } from '../core/motion.js';

/*
 * The brand moment on the sign-in screens: a heartbeat trace draws across the blue
 * header, then settles on one red point. It plays once. Nothing loops afterwards.
 */
const TRACE = 'M0 50H100l12-6 12 6h26l12-36 16 68 14-50 10 18h58l12-10 12 10H480';

export function authHero({ lines, sub, compact = false }) {
  return `
    <div class="auth-hero${compact ? ' is-compact' : ''}">
      <i class="glow glow-a" aria-hidden="true"></i>
      <i class="glow glow-b" aria-hidden="true"></i>
      <div class="hero-brand">${logo()}</div>
      <div class="hero-copy">
        <h1 class="hero-title">${lines.map((l) => `<span class="ln"><span>${l}</span></span>`).join('')}</h1>
        <p class="hero-sub">${sub}</p>
      </div>
      <svg class="hero-trace" viewBox="0 0 480 90" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        <path class="trace-base" d="${TRACE}" />
        <path class="trace-line" d="${TRACE}" />
        <circle class="trace-dot" cx="162" cy="14" r="6" />
      </svg>
    </div>`;
}

/** One orchestrated entrance: brand, headline, trace, then the form card rises. */
export function playAuthIntro(root) {
  if (!ANIM) return;
  const line = root.querySelector('.trace-line');
  const dot = root.querySelector('.trace-dot');
  gsap.set(dot, { scale: 0, transformOrigin: '50% 50%' });

  const tl = gsap.timeline({ defaults: { ease: 'power3.out' } });
  tl.from(root.querySelector('.hero-brand'), { y: -14, opacity: 0, duration: 0.5 })
    .from(root.querySelectorAll('.hero-title .ln > span'), { yPercent: 115, duration: 0.8, stagger: 0.09 }, '-=0.25')
    .from(root.querySelector('.hero-sub'), { y: 12, opacity: 0, duration: 0.5 }, '-=0.45')
    .from(root.querySelector('.auth-card'), { y: LITE ? 40 : 70, opacity: 0, duration: LITE ? 0.5 : 0.8 }, '-=0.7')
    .from(root.querySelectorAll('.auth-card .rise'), { y: 14, opacity: 0, duration: 0.45, stagger: 0.045, clearProps: 'transform,opacity' }, '-=0.45');

  const draw = drawPath(line, { duration: 1.5, delay: 0.25 });
  if (draw) draw.eventCallback('onComplete', () => gsap.to(dot, { scale: 1, duration: 0.55, ease: 'back.out(3)' }));
  else gsap.set(dot, { scale: 1 });
}
