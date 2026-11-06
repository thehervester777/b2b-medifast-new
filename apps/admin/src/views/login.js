import { $ } from '../core/dom.js';
import { ic, logo } from '../core/icons.js';
import { signIn, changePassword, state } from '../core/store.js';
import { enter, shake } from '../core/motion.js';
import { setError } from '../components/ui.js';

const eyeBtn = (id) => `<button type="button" class="eye" data-eye="${id}" aria-label="Show password" aria-pressed="false">${ic('eye')}</button>`;

const signInForm = () => `
  <form class="lg-card" id="lgForm" novalidate>
    <header>
      <h2>Sign in</h2>
      <p>Use your MediFast admin account.</p>
    </header>
    <div class="field" id="f-email">
      <label for="email">Email</label>
      <div class="input">${ic('mail')}<input id="email" name="email" type="email" inputmode="email" autocomplete="username" placeholder="you@company.com" /></div>
      <small class="err" id="e-email" role="alert"></small>
    </div>
    <div class="field" id="f-password">
      <label for="password">Password</label>
      <div class="input">${ic('lock')}<input id="password" name="password" type="password" autocomplete="current-password" placeholder="Your password" />${eyeBtn('password')}</div>
      <small class="err" id="e-password" role="alert"></small>
    </div>
    <button type="submit" class="btn btn-primary btn-block" id="lgGo">Sign in</button>
  </form>`;

const changeForm = () => `
  <form class="lg-card" id="cpForm" novalidate>
    <header>
      <h2>Choose a new password</h2>
      <p>You signed in with a temporary password. Pick your own to continue.</p>
    </header>
    <div class="field" id="f-cur">
      <label for="cur">Temporary password</label>
      <div class="input">${ic('lock')}<input id="cur" type="password" autocomplete="current-password" /></div>
      <small class="err" id="e-cur" role="alert"></small>
    </div>
    <div class="field" id="f-next">
      <label for="next">New password</label>
      <div class="input">${ic('lock')}<input id="next" type="password" autocomplete="new-password" placeholder="At least 10 characters" />${eyeBtn('next')}</div>
      <small class="err" id="e-next" role="alert"></small>
    </div>
    <div class="field" id="f-again">
      <label for="again">Repeat new password</label>
      <div class="input">${ic('lock')}<input id="again" type="password" autocomplete="new-password" /></div>
      <small class="err" id="e-again" role="alert"></small>
    </div>
    <button type="submit" class="btn btn-primary btn-block" id="cpGo">Save and continue</button>
  </form>`;

export default {
  title: 'Sign in',
  render() {
    return `
      <div class="login">
        <aside class="lg-brand">
          <div class="lg-top">${logo()}</div>
          <div class="lg-copy">
            <h1>Check every quote before it counts.</h1>
            <p>Approve supplier prices, turn them into orders, follow each order to the door, and keep a record of who did what.</p>
            <ul class="lg-facts">
              <li>${ic('check')}Rule checks on every quote</li>
              <li>${ic('check')}Orders, invoices and warehouse papers</li>
              <li>${ic('check')}Roles, undo, and a full audit log</li>
            </ul>
          </div>
        </aside>
        <main class="lg-form" id="lgHost">${state.authed && state.mustChange ? changeForm() : signInForm()}</main>
      </div>`;
  },

  mount(root) {
    const host = $('#lgHost', root);
    enter(root.querySelectorAll('.lg-copy h1, .lg-copy p, .lg-facts, .lg-card > *'), { y: 18, stagger: 0.07, delay: 0.1 });

    const busy = (btn, on, label) => {
      btn.disabled = on;
      btn.classList.toggle('is-busy', on);
      btn.textContent = label;
    };
    const wire = () => {
      host.querySelectorAll('[data-eye]').forEach((b) =>
        b.addEventListener('click', () => {
          const input = $('#' + b.dataset.eye, host);
          const show = input.type === 'password';
          input.type = show ? 'text' : 'password';
          b.setAttribute('aria-pressed', String(show));
          b.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
          b.innerHTML = ic(show ? 'eyeoff' : 'eye');
        })
      );
      const form = $('#lgForm', host);
      if (form) form.addEventListener('submit', onSignIn);
      const cp = $('#cpForm', host);
      if (cp) cp.addEventListener('submit', onChange);
      const first = host.querySelector('input');
      if (first) first.focus({ preventScroll: true });
    };

    async function onSignIn(e) {
      e.preventDefault();
      const email = $('#email', host);
      const pass = $('#password', host);
      const errors = {};
      if (!/^\S+@\S+\.\S+$/.test(email.value.trim())) errors.email = 'Enter your email address.';
      if (!pass.value) errors.password = 'Enter your password.';
      ['email', 'password'].forEach((k) => setError(host, k, errors[k]));
      if (Object.keys(errors).length) {
        shake($('.lg-card', host));
        (errors.email ? email : pass).focus();
        return;
      }
      const btn = $('#lgGo', host);
      busy(btn, true, 'Signing in');
      const result = await signIn(email.value, pass.value);
      if (result === 'must-change') {
        host.innerHTML = changeForm();
        wire();
        return;
      }
      if (result !== true) {
        busy(btn, false, 'Sign in');
        setError(host, 'password', result);
        shake($('.lg-card', host));
        pass.select();
      }
    }

    async function onChange(e) {
      e.preventDefault();
      const cur = $('#cur', host).value;
      const next = $('#next', host).value;
      const again = $('#again', host).value;
      const errors = {};
      if (!cur) errors.cur = 'Enter the temporary password.';
      if (next.length < 10) errors.next = 'Use at least 10 characters.';
      else if (next === cur) errors.next = 'Choose a password that is different from the temporary one.';
      if (again !== next) errors.again = 'The two passwords do not match.';
      ['cur', 'next', 'again'].forEach((k) => setError(host, k, errors[k]));
      const bad = ['cur', 'next', 'again'].find((k) => errors[k]);
      if (bad) {
        shake($('.lg-card', host));
        $('#' + bad, host).focus();
        return;
      }
      const btn = $('#cpGo', host);
      busy(btn, true, 'Saving');
      try {
        await changePassword(cur, next);
      } catch (err) {
        busy(btn, false, 'Save and continue');
        setError(host, 'cur', err.status === 422 || err.status === 401 ? err.message : 'Something went wrong. Please try again.');
        shake($('.lg-card', host));
      }
    }

    wire();
    return () => {};
  },
};
