import './styles/index.css';
import { $ } from './core/dom.js';
import { mountIcons } from './core/icons.js';
import { initMotion } from './core/motion.js';
import { on } from './core/store.js';
import { initRouter } from './core/router.js';
import { mountShell } from './components/shell.js';

mountIcons();
initMotion();

const shell = mountShell($('#shell'));

/* Signing in or out always lands on the right screen, wherever it was triggered from. */
on('auth', (authed) => {
  location.hash = authed ? '#board' : '#sign-in';
});

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
