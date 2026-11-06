import { $ } from '../core/dom.js';
import { ic } from '../core/icons.js';
import { changePassword, signOut } from '../core/store.js';
import { shake } from '../core/motion.js';
import { toast } from '../core/toast.js';
import { authHero, playAuthIntro } from '../components/authHero.js';
import { field, setError, bindEyes, setBusy } from '../components/forms.js';

/* Shown after signing in with a temporary password that MediFast gave out. */
export default {
  title: 'Choose a password',

  render() {
    return `
      <div class="auth-screen">
        ${authHero({ lines: ['Choose your', 'own password.'], sub: 'You signed in with a temporary password. Pick one only you know.', compact: true })}
        <form class="auth-card" id="pwForm" novalidate>
          <div class="card-head rise">
            <h2>New password</h2>
            <p>Use at least 8 characters.</p>
          </div>
          ${field({ id: 'pwCur', label: 'Temporary password', icon: 'lock', type: 'password', autocomplete: 'current-password', eye: true, cls: 'rise' })}
          ${field({ id: 'pwNew', label: 'New password', icon: 'lock', type: 'password', autocomplete: 'new-password', placeholder: 'Create a password', eye: true, cls: 'rise' })}
          ${field({ id: 'pwNew2', label: 'Repeat new password', icon: 'lock', type: 'password', autocomplete: 'new-password', eye: true, cls: 'rise' })}
          <button class="btn btn-primary btn-lg btn-block rise" type="submit" id="pwGo"><span>Save and continue</span>${ic('arrow')}</button>
          <p class="alt rise"><button type="button" class="link" id="pwOut">Sign out</button></p>
        </form>
        <p class="auth-foot">© ${new Date().getFullYear()} MediFast Supplier</p>
      </div>`;
  },

  mount(root) {
    const unbindEyes = bindEyes(root);
    playAuthIntro(root);
    const form = $('#pwForm', root);

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const cur = $('#pwCur').value;
      const next = $('#pwNew').value;
      const ok = [
        setError('pwCur', cur ? '' : 'Enter the temporary password.'),
        setError('pwNew', next.length < 8 ? 'Use at least 8 characters.' : next === cur ? 'Choose a password that is different from the temporary one.' : ''),
        setError('pwNew2', $('#pwNew2').value === next ? '' : 'The two passwords do not match.'),
      ].every(Boolean);
      if (!ok) {
        shake($('.auth-card', root));
        return;
      }
      const button = $('#pwGo');
      setBusy(button, true, 'Saving');
      try {
        await changePassword(cur, next);
        toast('Password saved. Your board is ready.');
      } catch (err) {
        setBusy(button, false, 'Save and continue');
        setError(err.code === 'bad_password' ? 'pwCur' : 'pwNew', err.message || 'Something went wrong. Please try again.');
        shake($('.auth-card', root));
      }
    });
    ['pwCur', 'pwNew', 'pwNew2'].forEach((id) => $('#' + id, root).addEventListener('input', () => setError(id, '')));
    $('#pwOut', root).addEventListener('click', () => signOut());
    return unbindEyes;
  },
};
