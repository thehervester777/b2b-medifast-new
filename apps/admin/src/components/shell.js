import { $, $$, esc, lockScroll, delegate } from '../core/dom.js';
import { ic, logo } from '../core/icons.js';
import { state, ui, on, me, can, signOut } from '../core/store.js';
import { gsap, ANIM, LITE, setupScrollChrome, bindPageTitle, tweenNumber, enter, scrollToY, refresh as refreshScroll } from '../core/motion.js';
import { navigate } from '../core/router.js';
import { NAV } from '../core/nav.js';
import { stats, alerts } from '../services/admin.js';
import { maintenanceLive, noticeFor } from '../services/access.js';
import { avatar } from './ui.js';
import { openPopover } from './popover.js';
import { openPalette } from './palette.js';
import { exportFile } from './panels.js';

/*
 * The signed-in frame: a sidebar (a drawer below 1024px), the top bar with search and
 * alerts, the page area, and a strip for the site notice and maintenance warning.
 * It is built once and stays in the DOM; only <main> changes.
 */
/* The sidebar name. When the menu is collapsed only the initials show, as plain text. */
const sideLogo = () => `<span class="logo logo-side">${logo().replace(/^<span class="logo">/, '').replace(/<\/span>$/, '')}<span class="logo-short" aria-hidden="true">MF</span></span>`;

const SIDE_KEY = 'medifast-admin:side';
const readSide = () => {
  try {
    const v = localStorage.getItem(SIDE_KEY);
    return v === 'collapsed' || v === 'expanded' ? v : null;
  } catch (e) {
    return null;
  }
};
const writeSide = (v) => {
  try {
    localStorage.setItem(SIDE_KEY, v);
  } catch (e) {
    /* storage can be blocked; the choice then lasts until reload */
  }
};

/** Section and page names for the breadcrumb, found from the sidebar list. */
const crumbsFor = (tab, title) => {
  let section = '';
  let label = '';
  for (const n of NAV) {
    if (n.section) section = n.section;
    else if (n.key === tab) {
      label = n.label;
      break;
    }
  }
  const parts = [];
  if (section) parts.push(section);
  if (label) parts.push(label);
  if (title && title !== label) parts.push(title);
  return parts.length ? parts : [title || ''];
};

const navHTML = () => {
  const out = ['<i class="side-ink" aria-hidden="true"></i>'];
  let pending = null;
  NAV.forEach((n) => {
    if (n.section) {
      pending = n.section;
      return;
    }
    if (!can(n.perm)) return;
    if (pending) {
      out.push(`<span class="nav-label">${esc(pending)}</span>`);
      pending = null;
    }
    out.push(`<a href="#${n.key}" data-tab="${n.key}">${ic(n.icon)}<span>${esc(n.label)}</span>${n.badge ? `<b class="nb nb-${n.tone}" data-badge="${n.badge}" hidden>0</b>` : ''}</a>`);
  });
  return out.join('');
};

export function mountShell(root) {
  root.innerHTML = `
    <aside class="side" id="side" aria-label="Main menu">
      <div class="side-head">
        <a class="brand" href="#overview" aria-label="MediFast Admin, dashboard">${sideLogo()}</a>
        <button type="button" class="icon-btn side-x" id="sideClose" aria-label="Close menu">${ic('x')}</button>
      </div>
      <nav class="side-nav" id="sideNav" aria-label="Main"></nav>
      <button type="button" class="side-edge" id="sideEdge" aria-label="Collapse menu" aria-expanded="true" aria-controls="sideNav" title="Collapse menu (Ctrl B)">${ic('chl')}</button>
      <div class="side-foot">
        <div class="me">
          <span id="meAv"></span>
          <span class="me-t"><b id="meName"></b><small id="meRole"></small></span>
          <button type="button" class="icon-btn" id="signOut" aria-label="Sign out" title="Sign out">${ic('logout')}</button>
        </div>
      </div>
    </aside>
    <div class="side-scrim" id="sideScrim" aria-hidden="true"></div>
    <div class="nav-tip" id="navTip" role="tooltip" hidden></div>

    <div class="main">
      <div class="sys" id="sysBars"></div>
      <header class="topbar" id="topbar">
        <button type="button" class="icon-btn tb-menu" id="menuBtn" aria-label="Open menu" aria-controls="side" aria-expanded="false" title="Menu">${ic('menu')}</button>
        <h2 class="tb-title" id="tbTitle" aria-hidden="true"></h2>
        <button type="button" class="cmd" id="cmdBtn" aria-label="Search or jump to a page">
          ${ic('search')}<span class="cmd-t">Search or jump to…</span><kbd class="cmd-k" id="cmdKey">Ctrl K</kbd>
        </button>
        <div class="tb-right">
          <span class="tb-maint" id="tbMaint" hidden title="Maintenance mode is on">${ic('cog')}<span>Maintenance</span></span>
          <button type="button" class="icon-btn tb-btn" id="bellBtn" aria-label="Alerts" aria-haspopup="dialog" aria-expanded="false">${ic('bell')}<b class="dot" id="bellDot" hidden>0</b></button>
          <button type="button" class="tb-me" id="meBtn" aria-label="Account menu" aria-haspopup="dialog" aria-expanded="false"><span id="meAv2"></span></button>
        </div>
      </header>
      <main class="page" id="page" tabindex="-1"></main>
    </div>
    <button type="button" class="to-top" id="toTop" aria-label="Back to top">${ic('up')}</button>
  `;

  const topbar = $('#topbar');
  const sideNav = $('#sideNav');
  const menuBtn = $('#menuBtn');
  const compact = window.matchMedia('(max-width: 1023px)');
  let tab = null;
  let navSig = '';

  /* Show the right shortcut hint for the platform. */
  $('#cmdKey').textContent = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? '⌘ K' : 'Ctrl K';

  setupScrollChrome({ topbar, toTop: $('#toTop') });

  /* ---------- who is signed in ---------- */
  const paintMe = () => {
    const admin = me();
    $('#meAv').innerHTML = avatar(admin.name);
    $('#meAv2').innerHTML = avatar(admin.name);
    $('#meName').textContent = admin.name;
    $('#meRole').textContent = admin.role;
  };

  /* ---------- sliding highlight in the sidebar ---------- */
  const placeInk = (animate) => {
    const link = $(`a[data-tab="${tab}"]`, sideNav);
    const ink = $('.side-ink', sideNav);
    if (!ink) return;
    if (!link) return gsap.set(ink, { opacity: 0 });
    const vars = { y: link.offsetTop, height: link.offsetHeight, opacity: 1 };
    if (ANIM && animate) gsap.to(ink, { ...vars, duration: LITE ? 0.3 : 0.6, ease: 'expo.out', overwrite: true });
    else gsap.set(ink, vars);
  };

  const markTab = () => {
    $$('a[data-tab]', sideNav).forEach((a) => {
      const isOn = a.dataset.tab === tab;
      a.classList.toggle('on', isOn);
      if (isOn) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
  };

  /** Rebuild the links when the admin or their role's permissions change. */
  const paintNav = () => {
    const sig = me().id + '|' + me().role + '|' + (state.roles[me().role] || []).join(',');
    if (sig === navSig) return;
    navSig = sig;
    sideNav.innerHTML = navHTML();
    markTab();
    paintCounts(true);
    placeInk(false);
  };

  const setTab = (key) => {
    tab = key;
    markTab();
    placeInk(true);
    closeNav();
  };

  /* ---------- collapse and expand the sidebar (1024px and up) ---------- */
  const wide = window.matchMedia('(min-width: 1280px)');
  const edge = $('#sideEdge');
  const tip = $('#navTip');
  const html = document.documentElement;
  const isCollapsed = () => html.dataset.side === 'collapsed';
  let sideTimer = 0;
  function applySide(collapsed, { save = false, quiet = false } = {}) {
    const was = isCollapsed();
    html.dataset.side = collapsed ? 'collapsed' : 'expanded';
    if (save) writeSide(collapsed ? 'collapsed' : 'expanded');
    const label = collapsed ? 'Expand menu' : 'Collapse menu';
    edge.setAttribute('aria-expanded', String(!collapsed));
    edge.setAttribute('aria-label', label);
    edge.title = `${label} (${/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? '⌘' : 'Ctrl'} B)`;
    if (!compact.matches) {
      menuBtn.setAttribute('aria-label', label);
      menuBtn.setAttribute('aria-expanded', String(!collapsed));
    }
    hideTip();
    if (was !== collapsed && !quiet) {
      /* let the width finish animating, then let scroll triggers and the ink catch up */
      clearTimeout(sideTimer);
      sideTimer = setTimeout(() => {
        refreshScroll();
        placeInk(false);
      }, 420);
    }
  }
  const toggleSide = () => applySide(!isCollapsed(), { save: true });
  /* with no saved choice, small laptops start collapsed and big screens expanded */
  const startSide = () => readSide() || (wide.matches ? 'expanded' : 'collapsed');
  applySide(startSide() === 'collapsed', { quiet: true });
  wide.addEventListener('change', () => {
    if (!readSide()) applySide(!wide.matches);
  });
  edge.addEventListener('click', toggleSide);
  document.addEventListener('keydown', (e) => {
    if (!state.authed || compact.matches) return;
    if ((e.key === 'b' || e.key === 'B') && (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey) {
      e.preventDefault();
      toggleSide();
    }
  });

  /* A small label beside each icon while the menu is collapsed. It is a fixed element, so the
     scrolling nav list cannot clip it. */
  function showTip(el) {
    if (!isCollapsed() || compact.matches) return;
    const name = ((el.querySelector('span:not(.nb)') || {}).textContent || el.getAttribute('aria-label') || '').trim();
    if (!name) return;
    const badge = el.querySelector('.nb');
    const count = badge && !badge.hidden ? Number(badge.dataset.n || badge.textContent) : 0;
    tip.textContent = count ? `${name} · ${count}` : name;
    tip.hidden = false;
    const r = el.getBoundingClientRect();
    tip.style.left = `${Math.round(r.right + 12)}px`;
    tip.style.top = `${Math.round(r.top + r.height / 2)}px`;
    tip.classList.add('on');
  }
  function hideTip() {
    tip.classList.remove('on');
    tip.hidden = true;
  }
  sideNav.addEventListener('pointerover', (e) => {
    const a = e.target.closest('a[data-tab]');
    if (a && e.pointerType !== 'touch') showTip(a);
  });
  sideNav.addEventListener('pointerleave', hideTip);
  sideNav.addEventListener('focusin', (e) => {
    const a = e.target.closest('a[data-tab]');
    if (a && a.matches(':focus-visible')) showTip(a);
  });
  sideNav.addEventListener('focusout', hideTip);
  sideNav.addEventListener('scroll', hideTip, { passive: true });
  sideNav.addEventListener('click', hideTip);

  /* ---------- drawer (below 1024px) ---------- */
  const openNav = () => {
    if (!compact.matches) return;
    root.classList.add('nav-open');
    menuBtn.setAttribute('aria-expanded', 'true');
    lockScroll(true);
    const links = $$('.side-nav a', root);
    if (ANIM) enter(links, { x: -14, y: 0, stagger: 0.04, delay: 0.1, duration: 0.45 });
    $('#sideClose').focus({ preventScroll: true });
  };
  function closeNav() {
    if (!root.classList.contains('nav-open')) return;
    root.classList.remove('nav-open');
    menuBtn.setAttribute('aria-expanded', 'false');
    lockScroll(false);
  }
  /* the same button opens the drawer on small screens and collapses the sidebar on wide ones */
  menuBtn.addEventListener('click', () => (compact.matches ? openNav() : toggleSide()));
  $('#sideClose').addEventListener('click', () => {
    closeNav();
    menuBtn.focus({ preventScroll: true });
  });
  $('#sideScrim').addEventListener('click', closeNav);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeNav();
  });
  compact.addEventListener('change', () => {
    closeNav();
    placeInk(false);
    if (compact.matches) {
      menuBtn.setAttribute('aria-label', 'Open menu');
      menuBtn.setAttribute('aria-expanded', 'false');
    } else applySide(isCollapsed(), { quiet: true });
  });
  sideNav.addEventListener('click', (e) => {
    const a = e.target.closest('a[data-tab]');
    if (!a) return;
    if (a.dataset.tab === tab) {
      scrollToY(0);
      closeNav();
    }
  });
  window.addEventListener('resize', () => placeInk(false));
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => placeInk(false));

  /* ---------- counts in the sidebar and bell ---------- */
  function paintCounts(quiet) {
    const s = stats();
    const map = { pending: s.pending, active: s.active, awaiting: s.awaiting, openOrders: s.openOrders, restock: s.restock };
    $$('[data-badge]', root).forEach((b) => {
      const n = map[b.dataset.badge] || 0;
      const was = Number(b.dataset.n || 0);
      b.hidden = n === 0;
      b.dataset.n = String(n);
      if (quiet) b.textContent = String(n);
      else if (n !== was) tweenNumber(b, n, (v) => String(Math.round(v)), { from: was, duration: 0.5 });
    });
    const a = alerts().length;
    const dot = $('#bellDot');
    dot.hidden = a === 0;
    dot.textContent = String(a);
  }

  /* ---------- site notice and maintenance warning ---------- */
  let dismissed = '';
  const paintSys = () => {
    const bars = [];
    const live = maintenanceLive();
    $('#tbMaint').hidden = !live;
    if (live) {
      bars.push(
        `<div class="sysbar is-maint" role="status">${ic('cog')}<span><b>Maintenance mode is on.</b> Suppliers see the maintenance page.</span>${can('site.manage') ? `<button type="button" class="sys-btn" data-act="sys-site">Manage</button>` : ''}</div>`
      );
    }
    if (noticeFor('admins')) {
      const n = state.site.notice;
      const key = n.title + '|' + n.body;
      if (!(n.dismissible && dismissed === key)) {
        bars.push(
          `<div class="sysbar is-notice tone-${esc(n.tone)}" role="status">${ic(n.tone === 'info' ? 'info' : 'alert')}<span><b>${esc(n.title)}</b> ${esc(n.body)}</span>${n.dismissible ? `<button type="button" class="sys-x" data-act="sys-dismiss" aria-label="Dismiss notice">${ic('x')}</button>` : ''}</div>`
        );
      }
    }
    const html = bars.join('');
    const box = $('#sysBars');
    if (box.innerHTML !== html) box.innerHTML = html;
  };
  delegate($('#sysBars'), {
    'sys-site': () => navigate('site'),
    'sys-dismiss': () => {
      const n = state.site.notice;
      dismissed = n.title + '|' + n.body;
      paintSys();
    },
  });
  setInterval(paintSys, 30_000);

  const refresh = () => {
    paintMe();
    paintNav();
    paintCounts();
    paintSys();
  };
  refresh();
  on('data', refresh);
  on('auth', (authed) => {
    if (authed) {
      navSig = '';
      refresh();
    }
  });

  /* ---------- search palette ---------- */
  $('#cmdBtn').addEventListener('click', openPalette);
  document.addEventListener('keydown', (e) => {
    if (!state.authed) return;
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test((document.activeElement || {}).tagName || '') || (document.activeElement || {}).isContentEditable;
    if ((e.key === 'k' || e.key === 'K') && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      openPalette();
    } else if (e.key === '/' && !typing && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      openPalette();
    }
  });

  /* ---------- alerts ---------- */
  $('#bellBtn').addEventListener('click', (e) => {
    const list = alerts().filter((a) => can({ suppliers: 'suppliers.view', requests: 'requests.view', orders: 'orders.view', products: 'products.view' }[a.go] || 'dashboard.view'));
    openPopover(
      e.currentTarget,
      `
      <div class="pop-head"><b>Needs attention</b>${list.length ? `<span class="pop-n">${list.length}</span>` : ''}</div>
      ${
        list.length
          ? `<ul class="alerts">${list
              .map(
                (a, i) =>
                  `<li><button type="button" class="al al-${a.tone}" data-act="alert" data-i="${i}"><span class="al-ic">${ic(a.icon)}</span><span class="al-t">${esc(a.title)}</span>${ic('chr', 'al-go')}</button></li>`
              )
              .join('')}</ul>`
          : `<p class="pop-empty">${ic('check')}<span>You are all caught up.</span></p>`
      }`,
      {
        className: 'pop-alerts',
        onMount: (api) =>
          delegate(api.node, {
            alert: (t) => {
              const a = list[Number(t.dataset.i)];
              if (a.go === 'suppliers') {
                ui.suppliers.status = a.filter;
                ui.suppliers.q = '';
              } else if (a.go === 'requests') {
                ui.requests.status = a.filter;
                ui.requests.q = '';
                ui.requests.co = 'All';
              } else if (a.go === 'orders') {
                ui.orders.status = a.filter;
                ui.orders.q = '';
                ui.orders.supplier = 'All';
                ui.orders.quick = 'all';
                ui.orders.from = '';
                ui.orders.to = '';
                ui.orders.page = 1;
              } else if (a.go === 'products') {
                ui.products.max = a.filter;
                ui.products.q = '';
                ui.products.brand = 'All';
                ui.products.sort = 'low';
                ui.products.page = 1;
              }
              api.close();
              navigate(a.go);
            },
          }),
      }
    );
  });

  /* ---------- account menu ---------- */
  $('#meBtn').addEventListener('click', (e) => {
    const admin = me();
    openPopover(
      e.currentTarget,
      `
      <div class="pop-me">${avatar(admin.name, 'av-lg')}<div><b>${esc(admin.name)}</b><small>${esc(admin.email)}</small><span class="role">${esc(admin.role)}</span></div></div>
      <div class="pop-menu">
        ${can('settings.manage') ? `<button type="button" data-act="settings">${ic('tune')}Settings</button>` : ''}
        ${can('quotes.view') ? `<button type="button" data-act="export">${ic('download')}Export quotes to CSV</button>` : ''}
        <button type="button" data-act="out" class="danger-text">${ic('logout')}Sign out</button>
      </div>`,
      {
        className: 'pop-account',
        onMount: (api) =>
          delegate(api.node, {
            settings: () => {
              api.close();
              navigate('preferences');
            },
            export: () => {
              api.close();
              exportFile('quotes');
            },
            out: () => {
              api.close();
              signOut();
            },
          }),
      }
    );
  });
  $('#signOut').addEventListener('click', signOut);

  $('#toTop').addEventListener('click', () => scrollToY(0));

  /* ---------- page title in the top bar once the big heading scrolls away ---------- */
  const onPage = (title, pageRoot) => {
    const parts = crumbsFor(tab, title);
    $('#tbTitle').innerHTML = parts
      .map((t, i) => (i === parts.length - 1 ? `<b>${esc(t)}</b>` : `<span class="crumb">${esc(t)}</span><i class="crumb-sep" aria-hidden="true">/</i>`))
      .join('');
    bindPageTitle($('.page-head h1', pageRoot), topbar);
  };

  /* Sidebar links fly in the first time the shell appears. */
  const playEntrance = () => {
    placeInk(false);
    if (!ANIM) return;
    if (!compact.matches) enter($$('.side-nav a, .side-head, .side-foot', root), { x: -16, y: 0, stagger: 0.04, duration: 0.6 });
    gsap.fromTo(topbar, { opacity: 0, y: -12 }, { opacity: 1, y: 0, duration: 0.5, delay: 0.1, clearProps: 'transform,opacity' });
  };

  return { page: $('#page'), setTab, onPage, playEntrance, topbar };
}
