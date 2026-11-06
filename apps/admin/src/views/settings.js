import { $, $$, delegate } from '../core/dom.js';
import { ic } from '../core/icons.js';
import { state, on } from '../core/store.js';
import { reveal } from '../core/motion.js';
import { toast } from '../core/toast.js';
import * as A from '../services/admin.js';
import { toggle } from '../components/ui.js';
import { exportFile } from '../components/panels.js';

export default {
  title: 'Settings',

  render() {
    const s = state.settings;
    return `
      <header class="page-head">
        <div><h1>Settings</h1><p>Changes save as soon as you make them, and each one can be undone. Admins and roles are on the Admin access page.</p></div>
      </header>

      <div class="set-grid">
        <section class="panel" data-reveal>
          <header class="panel-h"><div><h3>Quote checks</h3><p>What the panel flags before you approve</p></div></header>
          <div class="set-body">
            ${toggle({ id: 'flagLowPrice', label: 'Flag unusually low prices', hint: 'Quotes far below the asking price get a second look.', on: s.flagLowPrice })}
            <div class="range-row" id="lowRow">
              <label for="lowPricePct">Low price means more than <b id="lowVal">${s.lowPricePct}%</b> below asking</label>
              <input type="range" id="lowPricePct" min="5" max="50" step="5" value="${s.lowPricePct}" />
            </div>
            <div class="field inline" id="f-reviewHours">
              <label for="reviewHours">Review time limit<small>Pending quotes older than this are marked overdue.</small></label>
              <div class="input select"><select id="reviewHours">${[12, 24, 48, 72].map((h) => `<option value="${h}" ${h === s.reviewHours ? 'selected' : ''}>${h} hours</option>`).join('')}</select>${ic('chd', 'sel-ic')}</div>
            </div>
          </div>
        </section>

        <section class="panel" data-reveal>
          <header class="panel-h"><div><h3>Decisions</h3><p>How rejecting and awarding behave</p></div></header>
          <div class="set-body">
            ${toggle({ id: 'requireReason', label: 'Ask for a reason when rejecting', hint: 'The reason is saved with the quote.', on: s.requireReason })}
            ${toggle({ id: 'rejectOthersOnAward', label: 'Turn down other quotes on award', hint: 'When one quote is awarded, the rest for that request are rejected.', on: s.rejectOthersOnAward })}
          </div>
        </section>

        <section class="panel" data-reveal>
          <header class="panel-h"><div><h3>Alerts</h3><p>What reaches you by email</p></div></header>
          <div class="set-body">
            ${toggle({ id: 'notifyPending', label: 'Quotes waiting too long', hint: 'When a quote passes the review time limit.', on: s.notifyPending })}
            ${toggle({ id: 'notifyDigest', label: 'Daily summary', hint: 'New quotes, decisions and closing requests.', on: s.notifyDigest })}
            ${toggle({ id: 'notifySuppliers', label: 'New supplier sign-ups', hint: 'When a supplier applies for verification.', on: s.notifySuppliers })}
          </div>
        </section>

        <section class="panel" data-reveal>
          <header class="panel-h"><div><h3>Orders</h3><p>Used to work out when an order is due</p></div></header>
          <div class="set-body">
            <div class="field inline" id="f-leadDays">
              <label for="leadDays">Delivery lead time<small>Orders are marked late this many days after they are placed.</small></label>
              <div class="input select"><select id="leadDays">${[3, 4, 5, 7, 10].map((d) => `<option value="${d}" ${d === s.leadDays ? 'selected' : ''}>${d} days</option>`).join('')}</select>${ic('chd', 'sel-ic')}</div>
            </div>
          </div>
        </section>

        <section class="panel wide" data-reveal>
          <header class="panel-h"><div><h3>Exports</h3><p>Download your records as spreadsheets</p></div></header>
          <div class="set-body data-row">
            <button type="button" class="btn btn-ghost" data-act="x-quotes">${ic('download')}Quotes (CSV)</button>
            <button type="button" class="btn btn-ghost" data-act="x-requests">${ic('download')}Requests (CSV)</button>
            <button type="button" class="btn btn-ghost" data-act="x-orders">${ic('download')}Orders (CSV)</button>
            <button type="button" class="btn btn-ghost" data-act="x-activity">${ic('download')}Audit log (CSV)</button>
          </div>
        </section>
      </div>`;
  },

  mount(root) {
    reveal($$('[data-reveal]', root), { y: 24 });

    const save = async (key, value) => {
      if (state.settings[key] === value) return;
      const res = await A.updateSetting(key, value);
      if (res) toast('Saved');
      else sync(); /* put the saved value back */
    };
    const sync = () => {
      const s = state.settings;
      ['flagLowPrice', 'requireReason', 'rejectOthersOnAward', 'notifyPending', 'notifyDigest', 'notifySuppliers'].forEach((k) => {
        const n = $('#' + k, root);
        if (n) n.checked = !!s[k];
      });
      $('#lowPricePct', root).value = s.lowPricePct;
      $('#lowVal', root).textContent = s.lowPricePct + '%';
      $('#reviewHours', root).value = s.reviewHours;
      $('#leadDays', root).value = s.leadDays || 4;
      $('#lowRow', root).classList.toggle('is-off', !s.flagLowPrice);
      $('#lowPricePct', root).disabled = !s.flagLowPrice;
    };
    sync();

    root.addEventListener('change', (e) => {
      const n = e.target;
      if (n.type === 'checkbox') save(n.id, n.checked);
      else if (n.id === 'lowPricePct') save('lowPricePct', Number(n.value));
      else if (n.id === 'reviewHours') save('reviewHours', Number(n.value));
      else if (n.id === 'leadDays') save('leadDays', Number(n.value));
    });
    $('#lowPricePct', root).addEventListener('input', (e) => ($('#lowVal', root).textContent = e.target.value + '%'));

    const offClicks = delegate(root, {
      'x-quotes': () => exportFile('quotes'),
      'x-requests': () => exportFile('requests'),
      'x-orders': () => exportFile('orders'),
      'x-activity': () => exportFile('activity'),
    });
    const offData = on('data', sync);
    return () => {
      offClicks();
      offData();
    };
  },
};
