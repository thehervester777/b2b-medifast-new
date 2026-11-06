/*
 * One inline SVG sprite for the whole app. Icons are referenced with <use>,
 * so each is parsed once no matter how many times it appears in the DOM.
 */
const PATHS = {
  mail: '<rect x="3" y="5" width="18" height="14" rx="3"/><path d="m4 8 8 6 8-6"/>',
  lock: '<rect x="5" y="11" width="14" height="9" rx="2.5"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  eye: '<path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="2.8"/>',
  eyeoff:
    '<path d="M3 3l18 18"/><path d="M6.6 7.6A16.8 16.8 0 0 0 2 12s3.6 6.5 10 6.5c1.7 0 3.2-.4 4.4-1M10.6 5.6c.4-.1.9-.1 1.4-.1 6.4 0 10 6.5 10 6.5a17 17 0 0 1-3.2 3.9"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  chl: '<path d="m15 18-6-6 6-6"/>',
  chr: '<path d="m9 18 6-6-6-6"/>',
  chd: '<path d="m6 9 6 6 6-6"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h10"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  alert: '<path d="M12 3 2.5 20h19L12 3z"/><path d="M12 10v4.5M12 17.5h.01"/>',
  grid: '<rect x="3.5" y="3.5" width="7" height="8" rx="2"/><rect x="13.5" y="3.5" width="7" height="5" rx="2"/><rect x="13.5" y="11.5" width="7" height="9" rx="2"/><rect x="3.5" y="14.5" width="7" height="6" rx="2"/>',
  quotes: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3z"/><path d="m9 11 2 2 4-4"/>',
  requests: '<rect x="4" y="4" width="16" height="17" rx="3"/><path d="M9 4V3h6v1M8 10h8M8 14h8M8 18h4"/>',
  building:
    '<path d="M4 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16"/><path d="M16 9h2a2 2 0 0 1 2 2v10M2 21h20M8 7h4M8 11h4M8 15h4"/>',
  activity: '<path d="M3 12h4l2.2-6 4.2 12 2.2-6H21"/>',
  tune: '<path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2.2"/><circle cx="8" cy="17" r="2.2"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  userplus: '<circle cx="9" cy="8" r="4"/><path d="M2 21a7 7 0 0 1 14 0M19 8v6M16 11h6"/>',
  pin: '<path d="M12 21s7-6.1 7-11.5A7 7 0 0 0 5 9.5C5 14.9 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
  shield:
    '<path d="M12 3 4.5 6v5.5c0 4.6 3.1 8.3 7.5 9.5 4.4-1.2 7.5-4.9 7.5-9.5V6L12 3z"/><path d="m9 12 2.2 2.2L15.5 10"/>',
  phone:
    '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z"/>',
  bell: '<path d="M6 9a6 6 0 0 1 12 0c0 6 2.5 7.5 2.5 7.5h-17S6 15 6 9z"/><path d="M10 20a2 2 0 0 0 4 0"/>',
  logout: '<path d="M9 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h3"/><path d="M16 8l4 4-4 4M20 12H9"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  filter: '<path d="M4 6h16M7 12h10M10 18h4"/>',
  sort: '<path d="M8 4v16M8 20l-3-3M8 20l3-3M16 20V4M16 4l-3 3M16 4l3 3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  box: '<path d="M21 8 12 3 3 8v8l9 5 9-5V8z"/><path d="m3 8 9 5 9-5M12 13v8"/>',
  timer: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2M9.5 2h5"/>',
  bolt: '<path d="M13 2 4 14h7l-1 8 9-12h-7l1-8z"/>',
  cal: '<rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M8 3v4M16 3v4M3.5 10h17"/>',
  edit: '<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4z"/><path d="m13.5 6.5 4 4"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  trophy:
    '<path d="M8 4h8v5a4 4 0 0 1-8 0V4z"/><path d="M8 6H4v1a4 4 0 0 0 4 4M16 6h4v1a4 4 0 0 1-4 4M12 13v4M8 21h8M10 17h4"/>',
  download: '<path d="M12 4v11M7 11l5 5 5-5M5 20h14"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9M16 7l3 3"/>',
  doc: '<path d="M7 3h7l5 5v13H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M14 3v5h5M9 13h6M9 17h6"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>',
  up: '<path d="M12 19V5M5 12l7-7 7 7"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  ban: '<circle cx="12" cy="12" r="9"/><path d="m5.6 5.6 12.8 12.8"/>',
  flag: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
  dots: '<circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>',
  refresh:
    '<path d="M20 11a8 8 0 0 0-14-4.5L4 9M4 4v5h5M4 13a8 8 0 0 0 14 4.5L20 15M20 20v-5h-5"/>',
  cmd: '<path d="M9 9h6v6H9z"/><path d="M9 9V6.5A2.5 2.5 0 1 0 6.5 9H9zM15 9V6.5A2.5 2.5 0 1 1 17.5 9H15zM9 15v2.5A2.5 2.5 0 1 1 6.5 15H9zM15 15v2.5a2.5 2.5 0 1 0 2.5-2.5H15z"/>',
  list: '<path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/>',
  truck: '<path d="M2.5 6.5h11.5v9.5H2.5z"/><path d="M14 9.5h4l3 3.2V16h-7"/><circle cx="7" cy="17.5" r="2"/><circle cx="17.5" cy="17.5" r="2"/>',
  chart: '<path d="M4 20V4M4 20h16"/><path d="M8.5 16v-5M12.5 16V8M16.5 16v-3"/>',
  megaphone: '<path d="M4 10v4a1 1 0 0 0 1 1h2l8 4V5L7 9H5a1 1 0 0 0-1 1z"/><path d="M18.5 9a4 4 0 0 1 0 6"/>',
  cog: '<circle cx="12" cy="12" r="3.2"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M18.7 5.3l-2.1 2.1M7.4 16.6l-2.1 2.1"/>',
  printer: '<path d="M7 9V3.5h10V9"/><rect x="3.5" y="9" width="17" height="8" rx="2"/><path d="M7 14h10v6.5H7z"/>',
  merge: '<circle cx="6" cy="5.5" r="2"/><circle cx="6" cy="18.5" r="2"/><circle cx="18" cy="12" r="2"/><path d="M6 7.5v1a4 4 0 0 0 4 4h6M6 16.5v-1a4 4 0 0 1 4-4"/>',
  clip: '<rect x="5" y="4.5" width="14" height="16.5" rx="2.5"/><path d="M9 4.5v-1h6v1M9 11h6M9 15h6"/>',
  send: '<path d="M21 3 10 14"/><path d="M21 3l-7 18-4-7-7-4 18-7z"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.8a3.5 3.5 0 0 1 0 6.4M18 14a6.5 6.5 0 0 1 3.5 6"/>',
  trend: '<path d="m3 17 6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
  lines: '<path d="M4 6h16M4 12h16M4 18h10"/>',
};

/** Markup for one icon. */
export const ic = (name, cls = '') =>
  `<svg class="ic ${cls}" aria-hidden="true" focusable="false"><use href="#i-${name}"/></svg>`;

/** Inject the sprite once at start-up. */
export function mountIcons() {
  if (document.getElementById('icon-sprite')) return;
  const symbols = Object.entries(PATHS)
    .map(([id, d]) => `<symbol id="i-${id}" viewBox="0 0 24 24">${d}</symbol>`)
    .join('');
  const wrap = document.createElement('div');
  wrap.id = 'icon-sprite';
  wrap.setAttribute('aria-hidden', 'true');
  wrap.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
  wrap.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="0" height="0">${symbols}</svg>`;
  document.body.prepend(wrap);
}

/** The wordmark: the product name set in type. */
export const logo = () => `<span class="logo"><span class="logo-text">MediFast<b>Admin</b></span></span>`;
