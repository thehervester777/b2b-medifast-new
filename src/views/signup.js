import { $, $$, esc } from '../core/dom.js';
import { ic } from '../core/icons.js';
import { registerProvider } from '../core/store.js';
import { CITIES } from '../data/seed.js';
import { gsap, ANIM, LITE, shake, slideIn, drawPath, pop } from '../core/motion.js';
import { isEmail, isBdPhone, passwordLevel, PASSWORD_HINTS } from '../services/validation.js';
import { authHero, playAuthIntro } from '../components/authHero.js';
import { field, setError, bindEyes, setBusy } from '../components/forms.js';
import { navigate } from '../core/router.js';

const STEPS = ['Business', 'Legal', 'Account'];

/* Each step lists its fields; validate() returns the first invalid id, or null. */
const VALIDATORS = {
  1: () => {
    const v = (id) => $('#' + id).value.trim();
    const checks = [
      ['suBiz', v('suBiz').length < 2 ? 'Enter your business name.' : ''],
      ['suOwner', v('suOwner').length < 2 ? 'Enter the owner or manager name.' : ''],
      ['suAddr', v('suAddr').length < 6 ? 'Enter the full business address.' : ''],
      ['suCity', v('suCity').length < 2 ? 'Enter your city.' : ''],
    ];
    return run(checks);
  },
  2: () => {
    const lic = $('#suLic').value.trim();
    const tin = $('#suTin').value.replace(/\s/g, '');
    return run([
      ['suLic', lic.length < 6 ? 'Enter your drug licence number (at least 6 characters).' : ''],
      ['suTin', !/^\d{9,13}$/.test(tin) ? 'TIN/BIN should be 9 to 13 digits.' : ''],
    ]);
  },
  3: () => {
    const pass = $('#suPass').value;
    return run([
      ['suEmail', !isEmail($('#suEmail').value) ? 'Enter a valid email, like you@company.com.' : ''],
      ['suPhone', !isBdPhone($('#suPhone').value) ? 'Use +8801XXXXXXXXX or 01XXXXXXXXX.' : ''],
      ['suPass', pass.length < 8 ? 'Use at least 8 characters.' : ''],
      ['suPass2', $('#suPass2').value !== pass || !pass ? 'The passwords do not match.' : ''],
    ]);
  },
};

function run(checks) {
  let first = null;
  checks.forEach(([id, msg]) => {
    setError(id, msg);
    if (msg && !first) first = id;
  });
  return first;
}

export default {
  title: 'Join as provider',

  render() {
    return `
      <div class="auth-screen">
        ${authHero({ lines: ['Become a verified', 'MediFast supplier.'], sub: 'Three short steps. We check your licence, then you can quote.', compact: true })}
        <div class="auth-card wizard" id="wizCard">
          <form id="signupForm" novalidate>
            <header class="wz-top rise">
              <button class="icon-btn" type="button" id="wzBack" aria-label="Back">${ic('chl')}</button>
              <div><h2>Join as provider</h2><p id="wzStepTxt" aria-live="polite">Step 1 of 3</p></div>
            </header>

            <ol class="wz-prog rise" id="wzProg" aria-label="Sign-up progress">
              ${STEPS.map(
                (name, i) => `
                <li class="${i === 0 ? 'on' : ''}" data-s="${i + 1}">
                  <i class="bar"><u></u></i>
                  <span class="dotn"><em>${i + 1}</em>${ic('check')}</span>
                  <b>${name}</b>
                </li>`
              ).join('')}
            </ol>

            <section class="wz" data-step="1" aria-labelledby="wzH1">
              <div class="wz-head"><h3 id="wzH1">Business information</h3><p>Tell us about your company.</p></div>
              ${field({ id: 'suBiz', label: 'Business name', icon: 'building', autocomplete: 'organization', placeholder: 'Enter your business name' })}
              ${field({ id: 'suOwner', label: 'Owner name', icon: 'user', autocomplete: 'name', placeholder: 'Enter owner or manager name' })}
              ${field({ id: 'suAddr', label: 'Business address', icon: 'pin', textarea: true, autocomplete: 'street-address', placeholder: 'Enter business address' })}
              ${field({ id: 'suCity', label: 'City', icon: 'pin', autocomplete: 'address-level2', placeholder: 'Enter your city', list: 'suCities' })}
              <datalist id="suCities">${CITIES.map((c) => `<option value="${esc(c)}">`).join('')}</datalist>
            </section>

            <section class="wz" data-step="2" aria-labelledby="wzH2" hidden>
              <div class="wz-head"><h3 id="wzH2">Legal details</h3><p>Licence and tax information.</p></div>
              ${field({ id: 'suLic', label: 'Drug licence number', icon: 'shield', placeholder: 'Enter drug licence number' })}
              ${field({ id: 'suTin', label: 'TIN/BIN number', icon: 'receipt', inputmode: 'numeric', placeholder: 'Enter TIN/BIN number' })}
              <div class="note-box warn">${ic('info')}<span>Please make sure your licence and TIN/BIN details are accurate. They are verified during approval.</span></div>
            </section>

            <section class="wz" data-step="3" aria-labelledby="wzH3" hidden>
              <div class="wz-head"><h3 id="wzH3">Account details</h3><p>Create your login credentials.</p></div>
              ${field({ id: 'suEmail', label: 'Email', icon: 'mail', type: 'email', inputmode: 'email', autocomplete: 'email', placeholder: 'Enter your email' })}
              ${field({ id: 'suPhone', label: 'Phone number', icon: 'phone', type: 'tel', autocomplete: 'tel', placeholder: '+8801XXXXXXXXX or 01XXXXXXXXX' })}
              ${field({ id: 'suPass', label: 'Password', icon: 'lock', type: 'password', autocomplete: 'new-password', placeholder: 'Create a password', eye: true })}
              <div class="pw" id="suMeter" data-lv="0" aria-live="polite">
                <div class="pw-bars"><i></i><i></i><i></i><i></i></div>
                <span id="suMeterTxt">${PASSWORD_HINTS[0]}</span>
              </div>
              ${field({ id: 'suPass2', label: 'Confirm password', icon: 'lock', type: 'password', autocomplete: 'new-password', placeholder: 'Confirm your password', eye: true })}
            </section>

            <div class="wz-foot">
              <button class="btn btn-soft btn-lg" type="button" id="wzPrev" hidden>Back</button>
              <button class="btn btn-primary btn-lg" type="submit" id="wzNext"><span>Continue</span>${ic('arrow')}</button>
            </div>
            <p class="alt">Already have an account? <a class="link" href="#sign-in">Sign in</a></p>
          </form>

          <div class="wz-done" id="wzDone" hidden tabindex="-1">
            <span class="done-orb"><svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path id="doneCheck" d="m5 12.5 4.5 4.5L19 7.5"/></svg></span>
            <div><h2>Request submitted</h2>
              <p class="sub">Thanks, <b id="dnName"></b>. We will verify your drug licence and TIN/BIN, then email <b id="dnEmail"></b> once your provider account is approved.</p></div>
            <dl class="dl">
              <div><dt>Request ID</dt><dd class="num" id="dnId"></dd></div>
              <div><dt>Business</dt><dd id="dnBiz"></dd></div>
              <div><dt>Status</dt><dd><span class="pill soft">Awaiting approval</span></dd></div>
            </dl>
            <button class="btn btn-primary btn-lg btn-block" type="button" id="dnBack"><span>Back to sign in</span>${ic('arrow')}</button>
            <div class="note-box">${ic('info')}<span>Demo workspace. Requests are not reviewed, so use the filled-in demo account on the sign-in page to look around.</span></div>
          </div>
        </div>
        <p class="auth-foot">© 2026 MediFast Supplier. Demo with sample data.</p>
      </div>`;
  },

  mount(root) {
    const form = $('#signupForm', root);
    let step = 1;
    const unbindEyes = bindEyes(root);
    playAuthIntro(root);

    const show = (next, dir) => {
      step = next;
      $$('.wz', root).forEach((s) => {
        s.hidden = Number(s.dataset.step) !== step;
      });
      $('#wzStepTxt').textContent = `Step ${step} of 3`;
      $('#wzPrev').hidden = step === 1;
      $('#wzNext span').textContent = step === 3 ? 'Submit request' : 'Continue';
      $$('#wzProg li', root).forEach((li) => {
        const s = Number(li.dataset.s);
        const was = li.classList.contains('done');
        li.classList.toggle('on', s === step);
        li.classList.toggle('done', s < step);
        const fill = $('.bar u', li);
        if (ANIM) gsap.to(fill, { scaleX: s <= step ? 1 : 0, duration: LITE ? 0.3 : 0.6, ease: 'power3.out' });
        else fill.style.transform = `scaleX(${s <= step ? 1 : 0})`;
        if (s < step && !was) pop($('.dotn', li), 1.3);
      });
      const section = $(`.wz[data-step="${step}"]`, root);
      slideIn(section, dir);
      const firstInput = $('input,textarea', section);
      if (firstInput && dir !== 0) firstInput.focus({ preventScroll: true });
    };
    $('#wzProg li.on .bar u', root).style.transform = 'scaleX(1)';

    const back = () => (step > 1 ? show(step - 1, -1) : navigate('sign-in'));
    $('#wzBack', root).addEventListener('click', back);
    $('#wzPrev', root).addEventListener('click', back);

    /* live password meter */
    $('#suPass', root).addEventListener('input', (e) => {
      const level = passwordLevel(e.target.value);
      const meter = $('#suMeter');
      meter.dataset.lv = level;
      $('#suMeterTxt').textContent = PASSWORD_HINTS[level];
    });

    /* clear an error as soon as the person starts fixing it */
    $$('input,textarea', root).forEach((input) => input.addEventListener('input', () => input.id && setError(input.id, '')));

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const bad = VALIDATORS[step]();
      if (bad) {
        shake($('#wzCard', root));
        $('#' + bad).focus();
        return;
      }
      if (step < 3) return show(step + 1, 1);

      const button = $('#wzNext');
      setBusy(button, true, 'Submitting');
      setTimeout(() => {
        const v = (id) => $('#' + id).value.trim();
        const request = registerProvider({
          biz: v('suBiz'),
          owner: v('suOwner'),
          addr: v('suAddr'),
          city: v('suCity'),
          lic: v('suLic'),
          tin: v('suTin'),
          email: v('suEmail'),
          phone: v('suPhone'),
        });
        $('#dnName').textContent = request.owner;
        $('#dnEmail').textContent = request.email;
        $('#dnId').textContent = request.id;
        $('#dnBiz').textContent = request.biz;
        form.hidden = true;
        const done = $('#wzDone');
        done.hidden = false;
        slideIn(done, 1);
        if (ANIM) {
          pop($('.done-orb', done), 0.5);
          drawPath($('#doneCheck'), { duration: 0.7, delay: 0.2 });
        }
        done.focus({ preventScroll: true });
        window.scrollTo({ top: 0, behavior: ANIM ? 'smooth' : 'auto' });
      }, 700);
    });

    $('#dnBack', root).addEventListener('click', () => navigate('sign-in'));
    return unbindEyes;
  },
};
