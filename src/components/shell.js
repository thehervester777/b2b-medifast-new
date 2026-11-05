import { $, $$, lockScroll } from '../core/dom.js';
import { ic, logo } from '../core/icons.js';
import { state, stats, cartTotal, on } from '../core/store.js';
import { money2, plural } from '../core/format.js';
import { gsap, ANIM, LITE, setupScrollChrome, pop } from '../core/motion.js';
import { toast } from '../core/toast.js';
import { openCart } from './cart.js';
import { openNotifications } from './notifications.js';

/*
 * The signed-in frame: app bar, a side navigation drawer (phones) / top navigation (desktop),
 * the floating cart pill, back-to-top, and the scroll progress hairline.
 * It is built once and stays in the DOM; only <main> changes between pages.
 */
const TABS = [
  { key: 'board', label: 'Board', icon: 'board', count: 'active' },
  { key: 'quotes', label: 'My quotes', icon: 'receipt', count: 'quotes' },
  { key: 'submissions', label: 'Submissions', icon: 'send', count: 'subs' },
  { key: 'account', label: 'Account', icon: 'user' },
];

export function mountShell(root) {
  root.innerHTML = `
    <aside class="sidenav" id="sidenav" aria-label="Main menu">
      <div class="sn-head">
        <a class="sn-brand" href="#board" aria-label="MediFast Supplier, request board">${logo()}</a>
        <button type="button" class="icon-btn sn-close" id="snClose" aria-label="Close menu">${ic('x')}</button>
      </div>
      <nav class="sn-nav" id="snNav" aria-label="Main">
        <i class="sn-ink" aria-hidden="true"></i>
        ${TABS.map(
          (t) =>
            `<a href="#${t.key}" data-tab="${t.key}">${ic(t.icon)}<span>${t.label}</span>${t.count ? `<b class="cnt" data-cnt="${t.count}">0</b>` : ''}</a>`
        ).join('')}
      </nav>
      <a class="sn-user" href="#account" aria-label="Your account">
        <span class="sn-av" id="snAv"></span>
        <span class="sn-who"><b id="snName"></b><small id="snBiz"></small></span>
      </a>
    </aside>
    <div class="sn-scrim" id="snScrim" aria-hidden="true"></div>

    <header class="topbar" id="topbar">
      <div class="tb-left">
        <button type="button" class="tb-btn tb-menu" id="menuBtn" aria-label="Open menu" aria-controls="sidenav" aria-expanded="false">${ic('menu')}</button>
        <a class="tb-brand" href="#board" aria-label="MediFast Supplier, request board">${logo()}</a>
      </div>
      <nav class="tb-nav" id="tbNav" aria-label="Main">
        <i class="tb-ink" aria-hidden="true"></i>
        ${TABS.map(
          (t) =>
            `<a href="#${t.key}" data-tab="${t.key}">${t.label}${t.count ? `<span class="cnt" data-cnt="${t.count}">0</span>` : ''}</a>`
        ).join('')}
      </nav>
      <div class="tb-right">
        <button type="button" class="tb-btn" id="bellBtn" aria-label="Notifications">${ic('bell')}<i class="dot" id="bellDot" hidden></i></button>
        <button type="button" class="tb-btn" id="cartBtn" aria-label="Cart, empty">${ic('cart')}<b class="badge" id="cartBadge" hidden>0</b></button>
      </div>
      <i class="tb-progress" id="scrollBar" aria-hidden="true"></i>
    </header>

    <main class="page" id="page" tabindex="-1"></main>

    <button type="button" class="cart-pill" id="cartPill" hidden aria-label="Open cart">
      <span class="cp-ic">${ic('cart')}</span>
      <span class="cp-txt"><b id="cpTitle">0 items</b><small>Total at asking price</small></span>
      <span class="cp-sum num" id="cpSum">৳0</span>
      <span class="cp-go">${ic('up')}</span>
    </button>

    <button type="button" class="to-top" id="toTop" aria-label="Back to top">${ic('up')}</button>
  `;

  const topbar = $('#topbar');
  const page = $('#page');
  const pill = $('#cartPill');
  const snNav = $('#snNav');
  const tbNav = $('#tbNav');
  const sidenav = $('#sidenav');
  const menuBtn = $('#menuBtn');
  const wide = window.matchMedia('(min-width: 900px)');
  let tab = null;

  setupScrollChrome({ topbar, progress: $('#scrollBar'), toTop: $('#toTop') });

  /* ---------- who is signed in (shown at the bottom of the drawer) ---------- */
  const paintUser = () => {
    const user = state.user;
    $('#snAv').textContent = (user.name || '?').trim().charAt(0).toUpperCase();
    $('#snName').textContent = user.name || '';
    $('#snBiz').textContent = user.biz || '';
  };
  paintUser();
  on('user', paintUser);

  /* ---------- navigation indicators ---------- */
  const placeInk = (animate) => {
    const index = TABS.findIndex((t) => t.key === tab);
    const sInk = $('.sn-ink', snNav);
    const tInk = $('.tb-ink', tbNav);
    sInk.style.opacity = tInk.style.opacity = index < 0 ? '0' : '1';
    if (index < 0) return;
    /* drawer: every link is the same height, so the highlight only slides up and down */
    const y = $$('a', snNav)[index].offsetTop;
    if (ANIM) gsap.to(sInk, { y, duration: animate ? (LITE ? 0.3 : 0.55) : 0, ease: 'expo.out', overwrite: true });
    else sInk.style.transform = `translateY(${y}px)`;
    /* top bar (desktop): links differ in width, so measure the active one */
    const link = $$('a', tbNav)[index];
    if (link && link.offsetWidth) {
      if (ANIM) gsap.to(tInk, { x: link.offsetLeft, width: link.offsetWidth, duration: animate ? (LITE ? 0.3 : 0.6) : 0, ease: 'expo.out', overwrite: true });
      else {
        tInk.style.transform = `translateX(${link.offsetLeft}px)`;
        tInk.style.width = link.offsetWidth + 'px';
      }
    }
  };

  const setTab = (key) => {
    const first = tab === null;
    tab = key;
    [snNav, tbNav].forEach((nav) =>
      $$('a[data-tab]', nav).forEach((a) => {
        const on = a.dataset.tab === key;
        a.classList.toggle('on', on);
        if (on) a.setAttribute('aria-current', 'page');
        else a.removeAttribute('aria-current');
      })
    );
    placeInk(!first);
  };

  /* ---------- drawer (phones) ---------- */
  const isOpen = () => root.classList.contains('nav-open');
  const openNav = () => {
    if (wide.matches || isOpen()) return;
    root.classList.add('nav-open');
    menuBtn.setAttribute('aria-expanded', 'true');
    lockScroll(true);
    placeInk(false);
    const target = $('a.on', snNav) || $('a', snNav);
    setTimeout(() => target.focus({ preventScroll: true }), 60);
  };
  const closeNav = (restoreFocus = true) => {
    if (!isOpen()) return;
    root.classList.remove('nav-open');
    menuBtn.setAttribute('aria-expanded', 'false');
    lockScroll(false);
    if (restoreFocus) menuBtn.focus({ preventScroll: true });
  };
  menuBtn.addEventListener('click', openNav);
  $('#snClose').addEventListener('click', () => closeNav());
  $('#snScrim').addEventListener('click', () => closeNav());
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isOpen()) closeNav();
  });
  wide.addEventListener('change', () => {
    if (wide.matches) closeNav(false);
    placeInk(false);
  });

  let resizeTimer = 0;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => placeInk(false), 120);
  });

  /* choosing a page closes the drawer; tapping the page you are on scrolls to its top */
  [sidenav, tbNav].forEach((nav) =>
    nav.addEventListener('click', (e) => {
      const link = e.target.closest('a[href^="#"]');
      if (!link) return;
      if (link.dataset.tab && link.dataset.tab === tab && location.hash === '#' + tab) {
        e.preventDefault();
        window.scrollTo({ top: 0, behavior: ANIM ? 'smooth' : 'auto' });
      }
      if (nav === sidenav) closeNav(false);
    })
  );
  $('#toTop').addEventListener('click', () => window.scrollTo({ top: 0, behavior: ANIM ? 'smooth' : 'auto' }));

  /* ---------- live counters ---------- */
  const updateCounts = () => {
    const s = stats();
    $$('[data-cnt]', root).forEach((n) => {
      n.textContent = s[n.dataset.cnt];
    });
  };

  const updateCart = (event) => {
    const n = state.cart.length;
    const badge = $('#cartBadge');
    badge.hidden = !n;
    badge.textContent = n;
    $('#cartBtn').setAttribute('aria-label', n ? `Cart, ${plural(n, 'item')}` : 'Cart, empty');
    if (event && event.adding) pop(badge, 1.7);

    if (n) {
      $('#cpTitle').textContent = plural(n, 'item');
      $('#cpSum').textContent = money2(cartTotal());
      if (pill.hidden || pill.dataset.leaving) {
        gsap.killTweensOf(pill);
        delete pill.dataset.leaving;
        pill.hidden = false;
        if (ANIM) gsap.fromTo(pill, { y: 60, opacity: 0, scale: 0.94 }, { y: 0, opacity: 1, scale: 1, duration: LITE ? 0.3 : 0.65, ease: 'back.out(1.5)', clearProps: 'transform,opacity' });
      } else if (event && event.adding) pop($('#cpSum'), 1.18);
    } else if (!pill.hidden && !pill.dataset.leaving) {
      if (!ANIM) {
        pill.hidden = true;
      } else {
        pill.dataset.leaving = '1';
        gsap.to(pill, {
          y: 40,
          opacity: 0,
          duration: 0.25,
          ease: 'power2.in',
          onComplete: () => {
            delete pill.dataset.leaving;
            if (!state.cart.length) pill.hidden = true;
            gsap.set(pill, { clearProps: 'transform,opacity' });
          },
        });
      }
    }
  };

  const updateBell = () => {
    $('#bellDot').hidden = !state.unread;
  };

  on('cart', updateCart);
  on('quotes', updateCounts);
  on('notifications', updateBell);
  updateCounts();
  updateCart();
  updateBell();

  $('#cartBtn').addEventListener('click', () => {
    if (!state.cart.length) return toast('Your cart is empty. Tap Add to cart on a request.');
    openCart();
  });
  pill.addEventListener('click', openCart);
  $('#bellBtn').addEventListener('click', openNotifications);

  return { page, setTab, pill, updateCounts };
}
