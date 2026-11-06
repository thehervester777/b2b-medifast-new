import { $, $$, esc, delegate } from '../core/dom.js';
import { ic } from '../core/icons.js';
import { state, on } from '../core/store.js';
import { reveal, shake } from '../core/motion.js';
import { toast } from '../core/toast.js';
import { fmtDateTime } from '../core/format.js';
import { toggle, selectField, setError } from '../components/ui.js';
import { confirmDialog } from '../components/sheet.js';
import { updateNotice, updateMaintenance, noticeLive, maintenanceLive } from '../services/access.js';

/*
 * Notice and maintenance for the supplier site. Both forms are drafts: nothing changes
 * until "Save", the preview follows the draft as you type, and a save can be undone.
 */
const TONES = [
  ['info', 'Information'],
  ['warning', 'Warning'],
  ['urgent', 'Urgent'],
];
const AUDIENCES = [
  ['suppliers', 'Suppliers'],
  ['admins', 'Admins'],
  ['all', 'Everyone'],
];
const MODES = [
  ['off', 'Off', 'Suppliers use the app as normal.'],
  ['now', 'On now', 'Suppliers see the maintenance page straight away.'],
  ['scheduled', 'Scheduled', 'Switches on and off by itself between two times.'],
];

const pad = (n) => String(n).padStart(2, '0');
/** A timestamp to the value a datetime-local box wants. */
const toLocal = (t) => {
  if (!t) return '';
  const d = new Date(t);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const fromLocal = (s) => (s ? new Date(s).getTime() : null);

const noticeBar = (n) => `<div class="sysbar is-notice tone-${esc(n.tone)}" role="presentation">${ic(n.tone === 'info' ? 'info' : 'alert')}<span><b>${esc(n.title || 'Notice title')}</b> ${esc(n.body || 'Your message shows here.')}</span>${n.dismissible ? `<span class="sys-x" aria-hidden="true">${ic('x')}</span>` : ''}</div>`;

function statusOf() {
  const n = state.site.notice;
  const m = state.site.maintenance;
  const nLive = noticeLive();
  const mLive = maintenanceLive();
  return {
    notice: !n.on ? { text: 'Off', cls: 'p-mute' } : nLive ? { text: 'Showing now', cls: 'p-blue' } : { text: 'Scheduled', cls: 'p-wait' },
    maint: m.mode === 'off' ? { text: 'Off', cls: 'p-mute' } : mLive ? { text: 'On now', cls: 'p-redsolid' } : { text: 'Scheduled', cls: 'p-wait' },
  };
}

export default {
  title: 'Notice & maintenance',

  render() {
    const n = state.site.notice;
    const m = state.site.maintenance;
    const st = statusOf();
    return `
      <header class="page-head">
        <div><h1>Notice &amp; maintenance</h1><p>Tell suppliers about a change, or pause the supplier app while you work on it.</p></div>
      </header>

      <p class="callout info site-note">${ic('info')}<span>These settings are saved with this panel. The supplier app is a separate site, so it needs to read them from your server before suppliers see them. The previews show exactly what they will see.</span></p>

      <div class="site-grid">
        <section class="panel" data-reveal id="noticePanel">
          <header class="panel-h"><div><h3>Website notice</h3><p>A banner across the top of the app</p></div><span class="pill ${st.notice.cls}" id="nStatus">${st.notice.text}</span></header>
          <form class="site-form" id="nForm" novalidate autocomplete="off">
            ${toggle({ id: 'nOn', label: 'Show the notice', hint: 'Turn it off to hide it without losing the text.', on: n.on })}
            <div class="field" id="f-nTitle"><label for="nTitle">Title</label><div class="input"><input id="nTitle" type="text" maxlength="60" value="${esc(n.title)}" placeholder="e.g. Eid holiday hours" /></div><small class="err" id="e-nTitle" role="alert"></small></div>
            <div class="field" id="f-nBody"><label for="nBody">Message</label><div class="input ta"><textarea id="nBody" rows="3" maxlength="240" placeholder="What suppliers need to know">${esc(n.body)}</textarea></div><small class="hint"><span id="nCount">${n.body.length}</span> of 240</small><small class="err" id="e-nBody" role="alert"></small></div>
            <div class="two-col">
              ${selectField({ id: 'nTone', label: 'Style', options: TONES.map(([v, l]) => ({ value: v, label: l })), value: n.tone })}
              ${selectField({ id: 'nAud', label: 'Who sees it', options: AUDIENCES.map(([v, l]) => ({ value: v, label: l })), value: n.audience })}
            </div>
            ${toggle({ id: 'nDismiss', label: 'Let people close it', hint: 'A close button is shown on the banner.', on: n.dismissible })}
            ${toggle({ id: 'nSched', label: 'Only show between two times', hint: 'Outside these times the notice stays hidden.', on: n.scheduled })}
            <div class="two-col" id="nTimes">
              <div class="field" id="f-nStart"><label for="nStart">Starts</label><div class="input"><input id="nStart" type="datetime-local" value="${toLocal(n.startAt)}" /></div><small class="err" id="e-nStart" role="alert"></small></div>
              <div class="field" id="f-nEnd"><label for="nEnd">Ends</label><div class="input"><input id="nEnd" type="datetime-local" value="${toLocal(n.endAt)}" /></div><small class="err" id="e-nEnd" role="alert"></small></div>
            </div>
            <div class="form-foot"><button type="button" class="btn btn-ghost" data-act="n-reset" id="nReset" disabled>Discard changes</button><button type="submit" class="btn btn-primary" id="nSave" disabled>Save notice</button></div>
          </form>
          <div class="preview"><span class="pv-l">Preview</span><div class="pv-frame pv-notice" id="nPreview"></div></div>
        </section>

        <section class="panel" data-reveal id="maintPanel">
          <header class="panel-h"><div><h3>Maintenance mode</h3><p>Replaces the supplier app with a short message</p></div><span class="pill ${st.maint.cls}" id="mStatus">${st.maint.text}</span></header>
          <form class="site-form" id="mForm" novalidate autocomplete="off">
            <fieldset class="modes" id="mModes"><legend class="sr-only">When should it be on?</legend>
              ${MODES.map(([v, l, h]) => `<label class="mode"><input type="radio" name="mMode" value="${v}" ${m.mode === v ? 'checked' : ''} /><span><b>${l}</b><small>${h}</small></span></label>`).join('')}
            </fieldset>
            <div class="field" id="f-mMsg"><label for="mMsg">Message suppliers see</label><div class="input ta"><textarea id="mMsg" rows="3" maxlength="240" placeholder="What is happening, and when they can come back">${esc(m.message)}</textarea></div><small class="err" id="e-mMsg" role="alert"></small></div>
            <div class="two-col" id="mTimes">
              <div class="field" id="f-mStart"><label for="mStart">Starts</label><div class="input"><input id="mStart" type="datetime-local" value="${toLocal(m.startAt)}" /></div><small class="err" id="e-mStart" role="alert"></small></div>
              <div class="field" id="f-mEnd"><label for="mEnd">Ends</label><div class="input"><input id="mEnd" type="datetime-local" value="${toLocal(m.endAt)}" /></div><small class="err" id="e-mEnd" role="alert"></small></div>
            </div>
            <div class="form-foot"><button type="button" class="btn btn-ghost" data-act="m-reset" id="mReset" disabled>Discard changes</button><button type="submit" class="btn btn-primary" id="mSave" disabled>Save maintenance</button></div>
          </form>
          <div class="preview"><span class="pv-l">Preview</span><div class="pv-frame pv-maint" id="mPreview"></div></div>
        </section>
      </div>`;
  },

  mount(root) {
    reveal($$('[data-reveal]', root), { y: 24 });

    /* ---------- read a draft from the form ---------- */
    const readNotice = () => ({
      on: $('#nOn', root).checked,
      title: $('#nTitle', root).value.trim(),
      body: $('#nBody', root).value.trim(),
      tone: $('#nTone', root).value,
      audience: $('#nAud', root).value,
      dismissible: $('#nDismiss', root).checked,
      scheduled: $('#nSched', root).checked,
      startAt: fromLocal($('#nStart', root).value),
      endAt: fromLocal($('#nEnd', root).value),
    });
    const readMaint = () => ({
      mode: ($('input[name=mMode]:checked', root) || {}).value || 'off',
      message: $('#mMsg', root).value.trim(),
      startAt: fromLocal($('#mStart', root).value),
      endAt: fromLocal($('#mEnd', root).value),
    });
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

    /* ---------- write the stored values back to the form ---------- */
    const fillNotice = () => {
      const n = state.site.notice;
      $('#nOn', root).checked = n.on;
      $('#nTitle', root).value = n.title;
      $('#nBody', root).value = n.body;
      $('#nTone', root).value = n.tone;
      $('#nAud', root).value = n.audience;
      $('#nDismiss', root).checked = n.dismissible;
      $('#nSched', root).checked = n.scheduled;
      $('#nStart', root).value = toLocal(n.startAt);
      $('#nEnd', root).value = toLocal(n.endAt);
    };
    const fillMaint = () => {
      const m = state.site.maintenance;
      const r = $(`input[name=mMode][value=${m.mode}]`, root);
      if (r) r.checked = true;
      $('#mMsg', root).value = m.message;
      $('#mStart', root).value = toLocal(m.startAt);
      $('#mEnd', root).value = toLocal(m.endAt);
    };

    /* ---------- previews and dirty state ---------- */
    const clearErrors = (ids) => ids.forEach((k) => setError(root, k, ''));
    const paintNotice = () => {
      const d = readNotice();
      $('#nTimes', root).classList.toggle('is-off', !d.scheduled);
      $('#nStart', root).disabled = !d.scheduled;
      $('#nEnd', root).disabled = !d.scheduled;
      $('#nCount', root).textContent = String(d.body.length);
      $('#nPreview', root).innerHTML = d.on ? noticeBar(d) : `<p class="pv-off">The notice is off, so suppliers see nothing here.</p>`;
      const dirty = !same(d, pick(state.site.notice, d));
      $('#nSave', root).disabled = !dirty;
      $('#nReset', root).disabled = !dirty;
    };
    const paintMaint = () => {
      const d = readMaint();
      const sched = d.mode === 'scheduled';
      $('#mTimes', root).classList.toggle('is-off', !sched);
      $('#mStart', root).disabled = !sched;
      $('#mEnd', root).disabled = !sched;
      const when = sched && d.endAt ? `Back by ${fmtDateTime(d.endAt)}` : 'Check back soon';
      $('#mPreview', root).innerHTML =
        d.mode === 'off'
          ? `<p class="pv-off">Maintenance is off. Suppliers use the app as normal.</p>`
          : `<div class="mt-card"><span class="mt-ic">${ic('cog')}</span><b>We are doing some maintenance</b><p>${esc(d.message || 'Your message shows here.')}</p><small>${esc(when)}</small></div>`;
      const dirty = !same(d, pick(state.site.maintenance, d));
      $('#mSave', root).disabled = !dirty;
      $('#mReset', root).disabled = !dirty;
    };
    const pick = (stored, like) => Object.fromEntries(Object.keys(like).map((k) => [k, stored[k]]));
    const paintStatus = () => {
      const s = statusOf();
      const a = $('#nStatus', root);
      const b = $('#mStatus', root);
      a.className = 'pill ' + s.notice.cls;
      a.textContent = s.notice.text;
      b.className = 'pill ' + s.maint.cls;
      b.textContent = s.maint.text;
    };

    fillNotice();
    fillMaint();
    paintNotice();
    paintMaint();

    $('#nForm', root).addEventListener('input', paintNotice);
    $('#nForm', root).addEventListener('change', paintNotice);
    $('#mForm', root).addEventListener('input', paintMaint);
    $('#mForm', root).addEventListener('change', paintMaint);

    /* ---------- save ---------- */
    const fail = (errs, ids, form) => {
      ids.forEach((k) => setError(root, k, errs[k]));
      const bad = ids.find((k) => errs[k]);
      if (bad) {
        shake($('#f-' + bad, root));
        $('#' + bad, root).focus();
      }
      return !!bad;
    };

    $('#nForm', root).addEventListener('submit', async (e) => {
      e.preventDefault();
      const d = readNotice();
      const errs = {};
      if (d.on && d.title.length < 3) errs.nTitle = 'Add a short title.';
      if (d.on && d.body.length < 5) errs.nBody = 'Write the message suppliers will read.';
      if (d.scheduled) {
        if (!d.startAt) errs.nStart = 'Pick when it starts.';
        if (!d.endAt) errs.nEnd = 'Pick when it ends.';
        else if (d.startAt && d.endAt <= d.startAt) errs.nEnd = 'The end must come after the start.';
      }
      if (fail(errs, ['nTitle', 'nBody', 'nStart', 'nEnd'])) return;
      const res = await updateNotice(d);
      if (res) toast(d.on ? 'Notice saved' : 'Notice saved and turned off');
    });

    $('#mForm', root).addEventListener('submit', async (e) => {
      e.preventDefault();
      const d = readMaint();
      const errs = {};
      if (d.mode !== 'off' && d.message.length < 5) errs.mMsg = 'Write the message suppliers will read.';
      if (d.mode === 'scheduled') {
        if (!d.startAt) errs.mStart = 'Pick when it starts.';
        if (!d.endAt) errs.mEnd = 'Pick when it ends.';
        else if (d.startAt && d.endAt <= d.startAt) errs.mEnd = 'The end must come after the start.';
        else if (d.endAt < Date.now()) errs.mEnd = 'The end is already in the past.';
      }
      if (fail(errs, ['mMsg', 'mStart', 'mEnd'])) return;
      if (d.mode === 'now' && state.site.maintenance.mode !== 'now') {
        const ok = await confirmDialog({
          title: 'Turn on maintenance now?',
          body: `Suppliers will see the maintenance message instead of the supplier app. You can switch it off here at any time.`,
          confirm: 'Turn on maintenance',
          tone: 'danger',
        });
        if (!ok) return;
      }
      const res = await updateMaintenance(d);
      if (res) toast(d.mode === 'off' ? 'Maintenance is off' : d.mode === 'now' ? 'Maintenance is on' : 'Maintenance scheduled');
    });

    const offClicks = delegate(root, {
      'n-reset': () => {
        fillNotice();
        clearErrors(['nTitle', 'nBody', 'nStart', 'nEnd']);
        paintNotice();
      },
      'm-reset': () => {
        fillMaint();
        clearErrors(['mMsg', 'mStart', 'mEnd']);
        paintMaint();
      },
    });

    /* A sync from the server puts the stored values back into the forms only after an undo; other changes leave your draft alone. */
    const offData = on('data', (evt) => {
      paintStatus();
      if (evt && evt.type === 'undo') {
        fillNotice();
        fillMaint();
      }
      paintNotice();
      paintMaint();
    });
    const tick = setInterval(paintStatus, 30_000);
    return () => {
      offClicks();
      offData();
      clearInterval(tick);
    };
  },
};
