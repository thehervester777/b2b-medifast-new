import { $, esc } from '../core/dom.js';
import { toast } from '../core/toast.js';
import { openSheet } from './sheet.js';

/** Shows a temporary password once, with a Copy button. The person it belongs to must change it at their next sign-in. */
export function showPassword(name, password, title) {
  return openSheet({
    title,
    subtitle: 'Shown once. Copy it and send it to them privately.',
    kind: 'dialog',
    body: `
      <div class="temp-pw"><code id="tpw">${esc(password)}</code><button type="button" class="btn btn-ghost btn-sm" id="tpwCopy">Copy</button></div>
      <p class="note-text">${esc(name)} must choose a new password the first time they sign in. If you lose this one, set another temporary password.</p>`,
    footer: `<button type="button" class="btn btn-primary" data-close>Done</button>`,
    onMount: (api) => {
      $('#tpwCopy', api.wrap).addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(password);
          toast('Copied');
        } catch (e) {
          const r = document.createRange();
          r.selectNodeContents($('#tpw', api.wrap));
          const sel = window.getSelection();
          sel.removeAllRanges();
          sel.addRange(r);
          toast('Press Ctrl+C to copy');
        }
      });
    },
  });
}
