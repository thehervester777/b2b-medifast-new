import { $ } from '../core/dom.js';
import { ic } from '../core/icons.js';
import { signIn } from '../core/store.js';
import { DEMO_ACCOUNT } from '../data/seed.js';
import { shake } from '../core/motion.js';
import { toast } from '../core/toast.js';
import { isEmail } from '../services/validation.js';
import { authHero, playAuthIntro } from '../components/authHero.js';
import { field, setError, bindEyes, setBusy } from '../components/forms.js';

export default {
  title: 'Sign in',

  render() {
    return `
      <div class="auth-screen">
        ${authHero({
          lines: ['Quote on live', 'pharmacy requests.', 'Win on price.'],
          sub: 'Real buyer requests, one tap to send your price.',
        })}
        <form class="auth-card" id="signinForm" novalidate>
          <div class="card-head rise">
            <h2>Sign in</h2>
            <p>Use your MediFast Supplier account.</p>
          </div>
          ${field({ id: 'siEmail', label: 'Email', icon: 'mail', type: 'email', inputmode: 'email', autocomplete: 'username', placeholder: 'you@company.com', value: DEMO_ACCOUNT.email, cls: 'rise' })}
          ${field({ id: 'siPass', label: 'Password', icon: 'lock', type: 'password', autocomplete: 'current-password', placeholder: 'Enter your password', value: DEMO_ACCOUNT.password, eye: true, cls: 'rise' })}
          <div class="row-between rise">
            <label class="check"><input type="checkbox" id="siKeep" checked /><span>Keep me signed in</span></label>
            <button type="button" class="link" id="forgot">Forgot password?</button>
          </div>
          <button class="btn btn-primary btn-lg btn-block rise" type="submit" id="siGo"><span>Sign in</span>${ic('arrow')}</button>
          <div class="note-box rise">${ic('info')}<span>Demo workspace with sample data. The details are filled in, so just press Sign in.</span></div>
          <p class="alt rise">New supplier? <a class="link" href="#sign-up">Create an account</a></p>
        </form>
        <p class="auth-foot">© 2026 MediFast Supplier. Demo with sample data.</p>
      </div>`;
  },

  mount(root) {
    const form = $('#signinForm', root);
    const unbindEyes = bindEyes(root);
    playAuthIntro(root);

    $('#forgot', root).addEventListener('click', () => toast('Password reset is not set up in this demo.'));

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const email = $('#siEmail').value;
      const pass = $('#siPass').value;
      const okEmail = setError('siEmail', !email.trim() ? 'Enter your email.' : !isEmail(email) ? 'Enter a valid email, like you@company.com.' : '');
      const okPass = setError('siPass', pass ? '' : 'Enter your password.');
      if (!okEmail || !okPass) {
        shake($('.auth-card', root));
        $(okEmail ? '#siPass' : '#siEmail').focus();
        return;
      }
      const button = $('#siGo');
      setBusy(button, true, 'Signing in');
      /* a short beat, so the busy state reads as real work */
      setTimeout(() => {
        const result = signIn(email, pass, $('#siKeep').checked);
        if (result.ok) return toast('Welcome back. Your board is ready.');
        setBusy(button, false, 'Sign in');
        setError(result.field === 'email' ? 'siEmail' : 'siPass', result.error);
        shake($('.auth-card', root));
      }, 650);
    });

    ['siEmail', 'siPass'].forEach((id) => $('#' + id, root).addEventListener('input', () => setError(id, '')));
    return unbindEyes;
  },
};
