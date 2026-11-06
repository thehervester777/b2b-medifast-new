import { $, $$, esc, delegate } from '../core/dom.js';
import { ic } from '../core/icons.js';
import { state, signOut, updateUser, changePassword } from '../core/store.js';
import { gsap, ANIM } from '../core/motion.js';
import { toast } from '../core/toast.js';
import { isBdPhone } from '../services/validation.js';
import { openSheet } from '../components/sheet.js';
import { openNotifications } from '../components/notifications.js';
import { field, setError, bindEyes } from '../components/forms.js';

const row = (label, value, num = false) => `<div><dt>${label}</dt><dd${num ? ' class="num"' : ''}>${esc(value)}</dd></div>`;
const item = (icon, label, act) => `<button type="button" class="act-row" data-act="${act}">${ic(icon)}<span>${label}</span>${ic('chr', 'go')}</button>`;

const bodyHtml = () => {
  const u = state.user;
  return `
    <section class="idcard intro">
      <span class="big-av">${esc(u.name.charAt(0).toUpperCase())}</span>
      <div class="id-t"><h2>${esc(u.name)}</h2><p>${esc(u.biz)}</p><span class="verified">${ic('shield')}Verified provider</span></div>
      <button type="button" class="icon-btn" data-act="edit" aria-label="Edit account">${ic('edit')}</button>
    </section>
    <div class="acct-grid">
      <section class="intro"><h3 class="sec-t">Business information</h3>
        <dl class="dl card">${row('Email', u.email)}${row('Phone', u.phone)}${row('Address', u.addr)}</dl></section>
      <section class="intro"><h3 class="sec-t">Legal details</h3>
        <dl class="dl card">${row('Drug licence', u.lic, true)}${row('TIN number', u.tin, true)}</dl></section>
      <section class="intro"><h3 class="sec-t">Settings</h3>
        <div class="acts card">
          ${item('edit', 'Edit account', 'edit')}
          ${item('key', 'Change password', 'password')}
          ${item('bell', 'Notifications', 'notes')}
          ${item('logout', 'Sign out', 'logout')}
        </div></section>
    </div>`;
};

export default {
  title: 'Account',

  render() {
    return `
      <header class="p-head intro"><h1>Account</h1><p>Your business and licence details.</p></header>
      <div id="acctBody">${bodyHtml()}</div>`;
  },

  mount(root) {
    const openEdit = () => {
      const u = state.user;
      const api = openSheet({
        title: 'Edit account',
        className: 'edit-sheet',
        body: `
          <form id="editForm" novalidate>
            ${field({ id: 'eName', label: 'Owner name', icon: 'user', value: u.name, autocomplete: 'name' })}
            ${field({ id: 'eBiz', label: 'Business name', icon: 'building', value: u.biz, autocomplete: 'organization' })}
            ${field({ id: 'ePhone', label: 'Phone', icon: 'phone', type: 'tel', value: u.phone, autocomplete: 'tel' })}
            ${field({ id: 'eAddr', label: 'Address', icon: 'pin', value: u.addr, autocomplete: 'street-address' })}
          </form>`,
        footer: `<div class="foot-actions"><button type="button" class="btn btn-soft" data-close>Cancel</button><button type="submit" form="editForm" class="btn btn-primary" id="eSave">Save changes</button></div>`,
      });
      const form = $('#editForm', api.wrap);
      $$('input', form).forEach((i) => i.addEventListener('input', () => setError(i.id, '')));
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = $('#eName').value.trim();
        const biz = $('#eBiz').value.trim();
        const phone = $('#ePhone').value.trim();
        const addr = $('#eAddr').value.trim();
        const ok = [
          setError('eName', name ? '' : 'Enter the owner name.'),
          setError('eBiz', biz ? '' : 'Enter the business name.'),
          setError('ePhone', isBdPhone(phone) ? '' : 'Use +8801XXXXXXXXX or 01XXXXXXXXX.'),
          setError('eAddr', addr ? '' : 'Enter the address.'),
        ].every(Boolean);
        if (!ok) return;
        const save = $('#eSave');
        save.disabled = true;
        const res = await updateUser({ name, biz, phone, addr });
        save.disabled = false;
        if (!res.ok) return toast(res.error, { type: 'err' });
        $('#acctBody', root).innerHTML = bodyHtml();
        api.close();
        toast('Account updated.');
      });
    };

    const openPassword = () => {
      const api = openSheet({
        title: 'Change password',
        className: 'edit-sheet',
        body: `
          <form id="pwForm" novalidate>
            ${field({ id: 'pCur', label: 'Current password', icon: 'lock', type: 'password', autocomplete: 'current-password', eye: true })}
            ${field({ id: 'pNew', label: 'New password', icon: 'lock', type: 'password', autocomplete: 'new-password', placeholder: 'At least 8 characters', eye: true })}
            ${field({ id: 'pNew2', label: 'Repeat new password', icon: 'lock', type: 'password', autocomplete: 'new-password', eye: true })}
          </form>`,
        footer: `<div class="foot-actions"><button type="button" class="btn btn-soft" data-close>Cancel</button><button type="submit" form="pwForm" class="btn btn-primary" id="pSave">Save password</button></div>`,
      });
      const unbind = bindEyes(api.wrap);
      const form = $('#pwForm', api.wrap);
      $$('input', form).forEach((i) => i.addEventListener('input', () => setError(i.id, '')));
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const cur = $('#pCur').value;
        const next = $('#pNew').value;
        const ok = [
          setError('pCur', cur ? '' : 'Enter your current password.'),
          setError('pNew', next.length < 8 ? 'Use at least 8 characters.' : next === cur ? 'Choose a password that is different from the current one.' : ''),
          setError('pNew2', $('#pNew2').value === next ? '' : 'The two passwords do not match.'),
        ].every(Boolean);
        if (!ok) return;
        const save = $('#pSave');
        save.disabled = true;
        try {
          await changePassword(cur, next);
        } catch (err) {
          save.disabled = false;
          setError(err.code === 'bad_password' ? 'pCur' : 'pNew', err.message || 'Something went wrong. Please try again.');
          return;
        }
        unbind();
        api.close();
        toast('Password changed. Other devices were signed out.');
      });
    };

    const stop = delegate(root, {
      edit: openEdit,
      notes: openNotifications,
      password: openPassword,
      logout: async () => {
        await signOut();
        toast('You are signed out.');
      },
    });

    if (ANIM) gsap.from($$('.intro', root), { y: 18, opacity: 0, duration: 0.6, stagger: 0.08, ease: 'power3.out', clearProps: 'transform,opacity' });
    return stop;
  },
};
