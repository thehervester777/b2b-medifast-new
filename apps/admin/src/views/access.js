import { $, $$, esc, delegate } from '../core/dom.js';
import { ic } from '../core/icons.js';
import { state, on, me, can } from '../core/store.js';
import { reveal, shake } from '../core/motion.js';
import { toast } from '../core/toast.js';
import { PERMS, ROLE_NAMES, ROLE_INFO } from '../data/constants.js';
import { memberById, setRolePerm, setMemberActive, removeMember, ownerCount, inviteAdmin, setRole, resetMemberPassword } from '../services/access.js';
import { showPassword } from '../components/tempPassword.js';
import { avatar, tag, pill, field, selectField, setError } from '../components/ui.js';
import { openSheet, confirmDialog } from '../components/sheet.js';
import { ago, plural } from '../core/format.js';

const INVITE_ROLES = ROLE_NAMES.filter((r) => r !== 'Owner');
const roleCount = (role) => state.team.filter((t) => t.role === role && t.active !== false).length;

function memberRow(t) {
  const mine = t.id === me().id;
  const lastOwner = t.role === 'Owner' && ownerCount() <= 1;
  const off = t.active === false;
  return `
    <article class="row qrw mrw ${off ? 'is-off-row' : ''}" data-id="${t.id}" data-status="${off ? 'Suspended' : 'Verified'}">
      <div class="c-main with-av-row as-text">
        ${avatar(t.name)}
        <span class="wa-t"><b>${esc(t.name)}${mine ? ' ' + tag('You', 'info') : ''}</b><small>${esc(t.email)}</small></span>
      </div>
      <div class="c-role">
        <div class="select sel-inline"><select data-role="${t.id}" aria-label="Role for ${esc(t.name)}" ${mine || lastOwner ? 'disabled' : ''} ${mine || lastOwner ? `title="${mine ? 'You cannot change your own role' : 'Keep at least one Owner'}"` : ''}>${ROLE_NAMES.map((r) => `<option ${r === t.role ? 'selected' : ''}>${r}</option>`).join('')}</select>${ic('chd', 'sel-ic')}</div>
      </div>
      <div class="c-ip"><b>${esc(t.ip || '—')}</b><small>${esc(t.device || '')}</small></div>
      <div class="c-when"><span>${t.lastSeenAt ? ago(t.lastSeenAt) : mine ? 'Now' : 'Never'}</span><small>last signed in</small></div>
      <div class="c-status">${pill(off ? 'Suspended' : 'Verified', off ? 'Switched off' : 'Active')}</div>
      <div class="c-acts">
        ${
          mine
            ? ''
            : `<button type="button" class="btn btn-sm btn-ghost" data-act="reset" data-id="${t.id}">New password</button>
               <button type="button" class="btn btn-sm btn-ghost" data-act="toggle" data-id="${t.id}" ${!off && lastOwner ? 'disabled title="Keep at least one Owner"' : ''}>${off ? 'Switch on' : 'Switch off'}</button>
               <button type="button" class="icon-btn no" data-act="remove" data-id="${t.id}" aria-label="Remove ${esc(t.name)}" title="Remove" ${lastOwner ? 'disabled' : ''}>${ic('trash')}</button>`
        }
      </div>
    </article>`;
}

const membersHTML = () => state.team.map(memberRow).join('');

function matrixHTML() {
  const head = ROLE_NAMES.map((r) => `<th scope="col"><b>${r}</b><small>${plural(roleCount(r), 'person', 'people')}</small></th>`).join('');
  const body = PERMS.map(
    (g) => `
    <tr class="mx-group"><th colspan="${ROLE_NAMES.length + 1}" scope="colgroup">${esc(g.group)}</th></tr>
    ${g.items
      .map(
        (p) => `
      <tr><th scope="row">${esc(p.label)}</th>${ROLE_NAMES.map((r) => {
        const on = (state.roles[r] || []).includes(p.key);
        const locked = r === 'Owner';
        return `<td><label class="chk ${locked ? 'is-off' : ''}" title="${locked ? 'The Owner role always has everything' : ''}"><input type="checkbox" data-perm="${p.key}" data-role-name="${r}" ${on ? 'checked' : ''} ${locked ? 'disabled tabindex="-1"' : ''} aria-label="${esc(r)}: ${esc(p.label)}" /><i aria-hidden="true"></i></label></td>`;
      }).join('')}</tr>`
      )
      .join('')}`
  ).join('');
  return `<p class="mx-hint">Swipe sideways to see every role.</p><div class="rtable-wrap mx-wrap" tabindex="0" role="region" aria-label="Role permissions"><table class="rtable matrix"><thead><tr><th scope="col" class="mx-first">What they can do</th>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

export default {
  title: 'Admin access',

  render() {
    return `
      <header class="page-head">
        <div><h1>Admin access</h1><p>Each admin signs in with their own account. A role decides which pages they see and what they can change.</p></div>
        <div class="ph-actions"><button type="button" class="btn btn-primary" data-act="invite">${ic('userplus')}Invite an admin</button></div>
      </header>

      <section class="panel" data-reveal>
        <header class="panel-h"><div><h3>Admins</h3><p id="mSub"></p></div></header>
        <div class="table flush">
          <div class="thead row-h qrw mrw" aria-hidden="true"><span class="c-main">Admin</span><span class="c-role">Role</span><span class="c-ip">Last IP address and device</span><span class="c-when">Last seen</span><span class="c-status">Account</span><span class="c-acts"></span></div>
          <div id="members" class="rows"></div>
        </div>
      </section>

      <section class="panel roles-panel" data-reveal>
        <header class="panel-h"><div><h3>Roles and permissions</h3><p>Tick what each role may do. Changes apply the next time that person opens a page.</p></div></header>
        <ul class="role-cards" id="roleCards">${ROLE_NAMES.map((r) => `<li><b>${r}</b><small>${esc(ROLE_INFO[r])}</small></li>`).join('')}</ul>
        <div id="matrix">${matrixHTML()}</div>
      </section>`;
  },

  mount(root) {
    reveal($$('[data-reveal]', root), { y: 24 });

    const paint = () => {
      $('#members', root).innerHTML = membersHTML();
      const active = state.team.filter((t) => t.active !== false).length;
      $('#mSub', root).textContent = `${plural(state.team.length, 'admin')} · ${active} active · ${plural(ownerCount(), 'Owner')}`;
      /* keep the matrix in step with undo without redrawing it under the mouse */
      $$('input[data-perm]', root).forEach((cb) => {
        const on = (state.roles[cb.dataset.roleName] || []).includes(cb.dataset.perm);
        if (cb.checked !== on) cb.checked = on;
      });
      $$('#matrix thead th small', root).forEach((s, i) => (s.textContent = plural(roleCount(ROLE_NAMES[i]), 'person', 'people')));
    };
    paint();

    root.addEventListener('change', (e) => {
      const n = e.target;
      if (n.dataset && n.dataset.perm) {
        const role = n.dataset.roleName;
        Promise.resolve(setRolePerm(role, n.dataset.perm, n.checked)).then((res) => {
          if (res) toast(`${role} ${n.checked ? 'can now' : 'can no longer'} ${(PERMS.flatMap((g) => g.items).find((p) => p.key === n.dataset.perm) || {}).label?.toLowerCase()}`, { undo: res.undo });
          else paint();
        });
      } else if (n.dataset && n.dataset.role) {
        const t = memberById(n.dataset.role);
        if (!t || t.id === me().id) return paint();
        if (t.role === 'Owner' && n.value !== 'Owner' && ownerCount() <= 1) {
          toast('Keep at least one Owner', { type: 'err' });
          return paint();
        }
        setRole(t.id, n.value).then((res) => {
          if (res) toast(`${t.name} is now ${/^[AEIOU]/.test(n.value) ? 'an' : 'a'} ${n.value}`);
          else paint();
        });
      }
    });

    const invite = () =>
      openSheet({
        title: 'Invite an admin',
        subtitle: 'You will get a temporary password to give them. They choose their own at the first sign-in.',
        kind: 'dialog',
        body: `<form id="inv" novalidate autocomplete="off">
          ${field({ id: 'iname', label: 'Full name', placeholder: 'e.g. Rahim Uddin', attrs: 'maxlength="50"' })}
          ${field({ id: 'iemail', label: 'Email', type: 'email', placeholder: 'name@medifast.example', attrs: 'inputmode="email"' })}
          ${selectField({ id: 'irole', label: 'Role', options: INVITE_ROLES, value: 'Reviewer' })}
          <p class="note-text" id="irInfo"></p>
        </form>`,
        footer: `<button type="button" class="btn btn-ghost" data-close>Cancel</button><button type="submit" form="inv" class="btn btn-primary">Add admin</button>`,
        onMount: (api) => {
          const r = api.wrap;
          const info = () => ($('#irInfo', r).textContent = ROLE_INFO[$('#irole', r).value]);
          $('#irole', r).addEventListener('change', info);
          info();
          $('#iname', r).focus();
          $('#inv', r).addEventListener('submit', async (e) => {
            e.preventDefault();
            const name = $('#iname', r).value.trim();
            const email = $('#iemail', r).value.trim().toLowerCase();
            const errs = {};
            if (name.length < 2) errs.iname = 'Enter their name.';
            if (!/^\S+@\S+\.\S+$/.test(email)) errs.iemail = 'Enter a valid email address.';
            else if (state.team.some((t) => t.email === email)) errs.iemail = 'That email is already on the team.';
            ['iname', 'iemail'].forEach((k) => setError(r, k, errs[k]));
            const bad = Object.keys(errs)[0];
            if (bad) {
              shake($('#f-' + bad, r));
              $('#' + bad, r).focus();
              return;
            }
            const role = $('#irole', r).value;
            const res = await inviteAdmin({ name, email, role });
            if (!res) return;
            api.close();
            showPassword(name, res.password, `${name} added as ${role}`);
          });
        },
      });

    const offClicks = delegate(root, {
      invite,
      toggle: async (t) => {
        const m = memberById(t.dataset.id);
        const next = m.active === false;
        if (!can('access.manage')) return;
        const res = await setMemberActive(m.id, next);
        if (res === null) return;
        toast(`${m.name}'s account is ${next ? 'on again' : 'switched off'}`);
      },
      remove: async (t) => {
        const m = memberById(t.dataset.id);
        const ok = await confirmDialog({
          title: `Remove ${m.name}?`,
          body: `${esc(m.name)} will not be able to sign in. Everything they did stays in the audit log. You can undo this right after.`,
          confirm: 'Remove admin',
          tone: 'danger',
        });
        if (!ok) return;
        const res = await removeMember(m.id);
        if (res) toast(`${m.name} removed`);
      },
      reset: async (t) => {
        const m = memberById(t.dataset.id);
        const ok = await confirmDialog({ title: `Set a new password for ${m.name}?`, body: `${esc(m.name)} is signed out everywhere and must choose their own password at the next sign-in.`, confirm: 'Set temporary password' });
        if (!ok) return;
        const res = await resetMemberPassword(m.id);
        if (res) showPassword(m.name, res.password, `Temporary password for ${m.name}`);
      },
    });
    const offData = on('data', paint);
    return () => {
      offClicks();
      offData();
    };
  },
};
