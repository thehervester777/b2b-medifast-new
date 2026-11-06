import { esc } from '../core/dom.js';
import { ic } from '../core/icons.js';

/** One labelled input with icon, optional password eye, and an inline error slot. */
export function field({ id, label, icon, prefix = '', type = 'text', placeholder = '', value = '', autocomplete = 'off', inputmode = '', eye = false, textarea = false, list = '', attrs = '', hint = '', cls = '' }) {
  const common = `id="${id}" name="${id}" placeholder="${esc(placeholder)}" autocomplete="${autocomplete}" ${inputmode ? `inputmode="${inputmode}"` : ''} ${list ? `list="${list}"` : ''} ${attrs}`;
  const control = textarea ? `<textarea ${common} rows="3">${esc(value)}</textarea>` : `<input ${common} type="${type}" value="${esc(value)}">`;
  return `
    <div class="field ${cls}">
      <label for="${id}">${esc(label)}</label>
      <div class="input${textarea ? ' ta' : ''}">
        ${prefix ? `<span class="pre">${esc(prefix)}</span>` : icon ? ic(icon) : ''}
        ${control}
        ${eye ? `<button type="button" class="eye" data-eye="${id}" aria-label="Show password">${ic('eyeoff')}</button>` : ''}
      </div>
      ${hint ? `<p class="hint">${hint}</p>` : ''}
      <p class="err" id="${id}Err" role="alert"></p>
    </div>`;
}

/** Show or clear an error under a field, and mark the input invalid. */
export function setError(id, message) {
  const input = document.getElementById(id);
  const out = document.getElementById(id + 'Err');
  if (input) {
    const box = input.closest('.input');
    if (box) box.classList.toggle('err', !!message);
    input.setAttribute('aria-invalid', message ? 'true' : 'false');
  }
  if (out) out.textContent = message || '';
  return !message;
}

/** Wire every password eye button inside a root. */
export function bindEyes(root) {
  const onClick = (e) => {
    const btn = e.target.closest('[data-eye]');
    if (!btn || !root.contains(btn)) return;
    const input = document.getElementById(btn.dataset.eye);
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    btn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
    btn.querySelector('use').setAttribute('href', show ? '#i-eye' : '#i-eyeoff');
  };
  root.addEventListener('click', onClick);
  return () => root.removeEventListener('click', onClick);
}

/** Swap a button into a busy state and back. */
export function setBusy(button, busy, label) {
  if (!button) return;
  button.disabled = busy;
  button.classList.toggle('is-busy', busy);
  const text = button.querySelector('span');
  if (text && label) text.textContent = label;
}
