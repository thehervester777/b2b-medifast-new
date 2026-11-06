import { $, $$, esc, delegate, debounce } from '../core/dom.js';
import { ic } from '../core/icons.js';
import { state, on, ui, can } from '../core/store.js';
import { reveal } from '../core/motion.js';
import { QUICK, rangeOf, ymd, fromYmd } from '../core/range.js';
import { plural, fmtDateTime, fmtShort, fmtTime, ago } from '../core/format.js';
import { activityCsv } from '../services/admin.js';
import { saveText, stamp } from '../services/files.js';
import { toast } from '../core/toast.js';
import { openSheet } from '../components/sheet.js';
import { avatar, empty, swapList, mountSeg, pagerHTML, clampPage, selectHTML, PER_OPTIONS, tag } from '../components/ui.js';
import { openQuoteSheet, openRequestSheet, openSupplierSheet } from '../components/panels.js';
import { openOrderSheet } from '../components/orderpanels.js';

const S = () => ui.audit;

const TYPES = [
  ['All', 'All'],
  ['quote', 'Quotes'],
  ['request', 'Requests'],
  ['order', 'Orders'],
  ['product', 'Products'],
  ['supplier', 'Suppliers'],
  ['access', 'Access'],
  ['auth', 'Sign-ins'],
  ['settings', 'Settings'],
  ['site', 'Site'],
];
const TYPE_NAME = Object.fromEntries(TYPES);
const ICONS = { quote: 'quotes', request: 'requests', order: 'truck', product: 'box', supplier: 'building', settings: 'tune', site: 'megaphone', access: 'key', auth: 'user' };
const REF_PERM = { quote: 'quotes.view', request: 'requests.view', supplier: 'suppliers.view', order: 'orders.view' };

const memberOf = (a) => state.team.find((t) => t.id === a.byId);
const roleOf = (a) => (memberOf(a) || {}).role || '';

function windowOf() {
  let from = fromYmd(S().from, false);
  let to = fromYmd(S().to, true);
  if (from != null && to != null && from > to) [from, to] = [fromYmd(S().to, false), fromYmd(S().from, true)];
  return { from, to };
}

/** Everything except the type tab, so the tab counts stay meaningful. */
function scoped() {
  const { user, q } = S();
  const { from, to } = windowOf();
  const term = q.trim().toLowerCase();
  return state.activity.filter((a) => {
    if (from != null && a.at < from) return false;
    if (to != null && a.at > to) return false;
    if (user === 'unknown' ? a.byId != null : user !== 'All' && a.byId !== Number(user)) return false;
    return !term || `${a.by} ${a.text} ${a.ip || ''} ${a.device || ''} ${roleOf(a)}`.toLowerCase().includes(term);
  });
}

const canOpen = (a) => a.ref && REF_PERM[a.ref.kind] && can(REF_PERM[a.ref.kind]);

function rowHTML(a) {
  const role = roleOf(a);
  const failed = a.type === 'auth' && /^failed/.test(a.text);
  return `
    <article class="row qrw arw" data-id="${a.id}" data-status="${a.type}">
      <button type="button" class="c-main au-main" data-act="detail" data-id="${a.id}">
        <span class="ev-ic t-${a.type}">${ic(ICONS[a.type] || 'activity')}</span>
        <span class="au-t"><b>${esc(a.text)}</b><small>${esc(TYPE_NAME[a.type] || a.type)}</small></span>
      </button>
      <div class="c-sup">${avatar(a.by)}<span><b>${esc(a.by)}</b><small>${esc(role || (a.byId == null ? 'Not an admin' : 'Removed admin'))}</small></span></div>
      <div class="c-ip"><b>${esc(a.ip || '—')}</b><small>${esc(a.device || '')}</small></div>
      <div class="c-when"><span>${fmtShort(a.at)}</span><small>${fmtTime(a.at)}</small></div>
      <div class="c-status">${failed ? tag('Failed', 'red') : ''}</div>
    </article>`;
}

function openDetail(id) {
  const a = state.activity.find((x) => x.id === Number(id));
  if (!a) return null;
  const m = memberOf(a);
  const sheet = openSheet({
    title: 'Log entry',
    subtitle: `#${a.id} · ${TYPE_NAME[a.type] || a.type}`,
    body: `
      <div class="rs-head">
        <div class="rs-title"><span class="ev-ic t-${a.type}">${ic(ICONS[a.type] || 'activity')}</span><span class="code">${esc(TYPE_NAME[a.type] || a.type)}</span></div>
        <h3 class="au-big">${esc(a.by)} ${esc(a.text)}</h3>
      </div>
      <dl class="facts two">
        <div><dt>When</dt><dd>${fmtDateTime(a.at)}<small> ${ago(a.at)}</small></dd></div>
        <div><dt>Who</dt><dd>${esc(a.by)}</dd></div>
        <div><dt>Role</dt><dd>${esc(m ? m.role : a.byId == null ? 'Not an admin' : 'Removed admin')}</dd></div>
        <div><dt>Account</dt><dd class="wrap">${m ? esc(m.email) : '—'}</dd></div>
        <div><dt>IP address</dt><dd>${esc(a.ip || '—')}</dd></div>
        <div><dt>Device</dt><dd class="wrap">${esc(a.device || '—')}</dd></div>
      </dl>`,
    footer: canOpen(a) ? `<button type="button" class="btn btn-ghost" data-close>Close</button><button type="button" class="btn btn-primary" data-act="open-ref">${ic('arrow')}Open ${esc(a.ref.kind)}</button>` : `<button type="button" class="btn btn-ghost" data-close>Close</button>`,
    onMount: (api) => {
      delegate(api.wrap, { 'open-ref': () => openRef(a.ref) });
    },
  });
  return sheet;
}

function openRef(ref) {
  if (!ref) return;
  if (ref.kind === 'quote') openQuoteSheet(ref.id);
  else if (ref.kind === 'request') openRequestSheet(ref.id);
  else if (ref.kind === 'supplier') openSupplierSheet(ref.id);
  else if (ref.kind === 'order') openOrderSheet(ref.id);
}

/** One small card per admin, for the selected dates: who has been doing what. */
function peopleHTML(list) {
  const cur = S().user;
  const cards = state.team.map((m) => {
    const mine = list.filter((a) => a.byId === m.id);
    const last = state.activity.find((a) => a.byId === m.id);
    return `
      <button type="button" class="who ${String(m.id) === cur ? 'is-on' : ''} ${m.active === false ? 'is-off' : ''}" data-act="who" data-user="${m.id}" aria-pressed="${String(m.id) === cur}">
        ${avatar(m.name)}
        <span class="who-t"><b>${esc(m.name)}</b><small>${esc(m.role)}${m.active === false ? ' · switched off' : ''}</small></span>
        <span class="who-n"><b>${mine.length}</b><small>${last ? ago(last.at) : 'No activity'}</small></span>
      </button>`;
  });
  const unknown = list.filter((a) => a.byId == null).length;
  if (unknown || cur === 'unknown') {
    cards.push(`
      <button type="button" class="who is-warn ${cur === 'unknown' ? 'is-on' : ''}" data-act="who" data-user="unknown" aria-pressed="${cur === 'unknown'}">
        <span class="av" aria-hidden="true">?</span>
        <span class="who-t"><b>Unknown</b><small>Failed sign-ins</small></span>
        <span class="who-n"><b>${unknown}</b><small>in range</small></span>
      </button>`);
  }
  return cards.join('');
}

export default {
  title: 'Audit logs',

  render() {
    const s = S();
    const quick = QUICK.concat([['custom', 'Custom dates']]);
    const users = [['All', 'Everyone'], ...state.team.map((m) => [String(m.id), `${m.name} (${m.role})`]), ['unknown', 'Unknown (failed sign-ins)']];
    return `
      <header class="page-head">
        <div><h1>Audit logs</h1><p id="aSub"></p></div>
        <div class="ph-actions"><button type="button" class="btn btn-ghost" data-act="export">${ic('download')}Export</button></div>
      </header>

      <div class="who-row" id="who" aria-label="Admins"></div>

      <div class="seg-row"><div id="aSeg" class="seg-wrap"></div></div>

      <section class="filters f-audit" aria-label="Filter the log">
        <label class="fl f-search"><span>Search</span><div class="search">${ic('search')}<input id="aSearch" type="search" placeholder="Person, action, IP address or device" value="${esc(s.q)}" autocomplete="off" enterkeyhint="search" aria-label="Search the log" /></div></label>
        <label class="fl"><span>User</span>${selectHTML({ id: 'aUser', label: 'User', options: users, value: s.user })}</label>
        <label class="fl"><span>Quick filter</span>${selectHTML({ id: 'aQuick', label: 'Quick date filter', options: quick, value: s.quick })}</label>
        <label class="fl"><span>Start date</span><div class="date-in"><input type="date" id="aFrom" value="${esc(s.from)}" aria-label="Start date" /></div></label>
        <label class="fl"><span>End date</span><div class="date-in"><input type="date" id="aTo" value="${esc(s.to)}" aria-label="End date" /></div></label>
        <label class="fl"><span>Per page</span>${selectHTML({ id: 'aPer', label: 'Entries per page', options: PER_OPTIONS, value: s.per })}</label>
        <div class="fl f-act"><span aria-hidden="true">&nbsp;</span><button type="button" class="btn btn-ghost" data-act="reset" id="aReset">${ic('refresh')}Reset</button></div>
      </section>

      <section class="table" aria-label="Audit log">
        <div class="thead row-h qrw arw" aria-hidden="true">
          <span class="c-main">Action</span><span class="c-sup">User</span><span class="c-ip">IP address and device</span><span class="c-when">When</span><span class="c-status"></span>
        </div>
        <div id="rows" class="rows"></div>
      </section>
      <div class="more-row pager" id="pager"></div>`;
  },

  mount(root) {
    let list = [];
    const box = $('#rows', root);
    const countOf = (base, t) => (t === 'All' ? base.length : base.filter((a) => a.type === t).length);

    const seg = mountSeg($('#aSeg', root), {
      label: 'Entry type',
      active: S().type,
      items: TYPES.map(([key, label]) => ({ key, label, count: countOf(scoped(), key) })),
      onChange: (key) => {
        S().type = key;
        S().page = 1;
        paint(true);
      },
    });

    function paint(fresh = false) {
      const s = S();
      const base = scoped();
      list = (s.type === 'All' ? base : base.filter((a) => a.type === s.type)).sort((a, b) => b.at - a.at);
      s.page = clampPage(s.page, list.length, s.per);
      const shown = list.slice((s.page - 1) * s.per, s.page * s.per);
      const filtered = !!(s.q || s.from || s.to || s.user !== 'All' || s.type !== 'All');
      const html = shown.length
        ? shown.map(rowHTML).join('')
        : empty({ icon: 'activity', title: 'Nothing logged here', body: 'No entries match these filters.', action: filtered ? `<button type="button" class="btn btn-soft" data-act="reset">${ic('refresh')}Clear filters</button>` : '' });
      if (fresh) {
        box.innerHTML = html;
        if (shown.length) reveal($$('.row', box).slice(0, 14), { y: 12, start: 'top 98%', stagger: 0.03 });
      } else swapList(box, html, { rows: '.row' });

      seg.counts(Object.fromEntries(TYPES.map(([key]) => [key, countOf(base, key)])));
      $('#who', root).innerHTML = peopleHTML(base);
      const failed = base.filter((a) => a.type === 'auth' && /^failed/.test(a.text)).length;
      $('#aSub', root).textContent = `${plural(state.activity.length, 'entry', 'entries')} kept${base.length !== state.activity.length ? ` · ${plural(base.length, 'entry', 'entries')} in this view` : ''}${failed ? ` · ${plural(failed, 'failed sign-in')}` : ''}`;
      $('#pager', root).innerHTML = pagerHTML({ page: s.page, per: s.per, total: list.length });
      $('#aQuick', root).value = s.quick;
      $('#aFrom', root).value = s.from;
      $('#aTo', root).value = s.to;
      $('#aUser', root).value = s.user;
      $('#aPer', root).value = String(s.per);
      $('#aReset', root).disabled = !filtered;
    }
    paint(true);

    const refilter = () => {
      S().page = 1;
      paint(true);
    };
    $('#aSearch', root).addEventListener(
      'input',
      debounce((e) => {
        S().q = e.target.value;
        refilter();
      }, 180)
    );
    $('#aUser', root).addEventListener('change', (e) => {
      S().user = e.target.value;
      refilter();
    });
    $('#aQuick', root).addEventListener('change', (e) => {
      const key = e.target.value;
      S().quick = key;
      const r = rangeOf(key);
      S().from = r ? ymd(r.from) : '';
      S().to = r ? ymd(r.to) : '';
      refilter();
    });
    const dateChange = () => {
      S().from = $('#aFrom', root).value;
      S().to = $('#aTo', root).value;
      S().quick = S().from || S().to ? 'custom' : 'all';
      refilter();
    };
    $('#aFrom', root).addEventListener('change', dateChange);
    $('#aTo', root).addEventListener('change', dateChange);
    $('#aPer', root).addEventListener('change', (e) => {
      S().per = Number(e.target.value);
      refilter();
    });
    root.addEventListener('click', (e) => {
      const b = e.target.closest('[data-pg]');
      if (!b || b.disabled) return;
      S().page = Number(b.dataset.pg);
      paint(true);
      $('#who', root).scrollIntoView({ block: 'start', behavior: 'smooth' });
    });

    const offClicks = delegate(root, {
      export: async () => {
        const result = await saveText(`medifast-audit-log-${stamp()}.csv`, activityCsv(list));
        if (result === 'saved') toast(`${plural(list.length, 'entry', 'entries')} exported to CSV`);
      },
      detail: (t) => openDetail(t.dataset.id),
      who: (t) => {
        S().user = S().user === t.dataset.user ? 'All' : t.dataset.user;
        refilter();
      },
      reset: () => {
        Object.assign(S(), { type: 'All', user: 'All', q: '', quick: 'all', from: '', to: '', page: 1 });
        $('#aSearch', root).value = '';
        seg.set('All');
        paint(true);
      },
    });
    const offData = on('data', () => paint(false));
    return () => {
      offClicks();
      offData();
      seg.destroy();
    };
  },
};
