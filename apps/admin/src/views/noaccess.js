import { ic } from '../core/icons.js';
import { me } from '../core/store.js';
import { esc } from '../core/dom.js';
import { homePath, pageOf } from '../core/nav.js';
import { delegate } from '../core/dom.js';
import { navigate } from '../core/router.js';

/* Shown when someone opens a page their role does not include (for example by typing the address). */
export default {
  title: 'No access',

  render() {
    const home = pageOf(homePath());
    return `
      <div class="noaccess">
        <span class="na-ic">${ic('lock')}</span>
        <h1>This page is not part of your role</h1>
        <p>${esc(me().name)} signs in as ${/^[AEIOU]/.test(me().role) ? 'an' : 'a'} <b>${esc(me().role)}</b>. Ask an Owner if you need access to this page.</p>
        <button type="button" class="btn btn-primary" data-act="home">${ic('arrow')}Go to ${esc(home ? home.label : 'the dashboard')}</button>
      </div>`;
  },

  mount(root) {
    return delegate(root, { home: () => navigate(homePath()) });
  },
};
