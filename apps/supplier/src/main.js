import './styles/index.css';
import { $ } from './core/dom.js';
import { mountIcons } from './core/icons.js';
import { initMotion } from './core/motion.js';
import { state, on, restore } from './core/store.js';
import { initRouter } from './core/router.js';
import { mountShell } from './components/shell.js';
import { toast } from './core/toast.js';

mountIcons();
initMotion();

const shell = mountShell($('#shell'));

/* Signing in or out always lands on the right screen, wherever it was triggered from. */
on('auth', (authed) => {
  location.hash = authed ? (state.mustChange ? '#change-password' : '#board') : '#sign-in';
});
/* e.g. "Your session ended" after the server signed this browser out */
on('notice', (message) => toast(message, { type: 'err' }));

function start() {
  initRouter({
    authRoot: $('#auth'),
    shellRoot: $('#shell'),
    pageRoot: shell.page,
    setTab: shell.setTab,
    onReady: () => {
      const boot = $('#boot');
      boot.classList.add('gone');
      setTimeout(() => boot.remove(), 500);
    },
  });
}

/* Pick up a session that is still open (a page reload) before the first screen is chosen. */
restore().then(start, start);
