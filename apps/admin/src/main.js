import './styles/index.css';
import { $ } from './core/dom.js';
import { mountIcons } from './core/icons.js';
import { initMotion } from './core/motion.js';
import { state, on, restore } from './core/store.js';
import { initRouter } from './core/router.js';
import { mountShell } from './components/shell.js';
import { homePath } from './core/nav.js';
import { toast } from './core/toast.js';

mountIcons();
initMotion();

const shell = mountShell($('#shell'));

/* Signing in or out is just a change of route; the router does the rest. */
on('auth', (authed) => {
  location.hash = authed && !state.mustChange ? '#' + homePath() : '#sign-in';
});
/* e.g. "Your session ended" after the server signed this browser out */
on('notice', (message) => toast(message, { type: 'err' }));

function start() {
  initRouter({
    authRoot: $('#auth'),
    shellRoot: $('#shell'),
    pageRoot: shell.page,
    setTab: shell.setTab,
    onPage: shell.onPage,
    playEntrance: shell.playEntrance,
    onReady: () => {
      const boot = $('#boot');
      boot.classList.add('gone');
      setTimeout(() => boot.remove(), 500);
    },
  });
  /* Keep the page from jumping when a hash link points at the current route. */
  if ((!state.authed || state.mustChange) && !location.hash) location.replace('#sign-in');
}

/* Pick up a session that is still open (a page reload) before the first screen is chosen. */
restore().then(start, start);
