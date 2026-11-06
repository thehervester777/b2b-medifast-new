import { ymd } from '../core/range.js';

/*
 * Save a text file for the person using the panel.
 * Inside an Artifact the page asks the viewer's app to save it (the `downloads`
 * capability); anywhere else it is a normal browser download.
 * Returns 'saved' or 'declined'.
 */
export async function saveText(filename, text, type = 'text/csv;charset=utf-8') {
  const blob = new Blob([text], { type });
  let saver = null;
  try {
    saver = window.claude && window.claude.use ? await window.claude.use('downloads') : null;
  } catch (e) {
    saver = null;
  }
  if (saver) {
    try {
      await saver.save({ filename, data: blob });
      return 'saved';
    } catch (e) {
      if (e && e.code === 'declined') return 'declined';
      throw e;
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return 'saved';
}

export const stamp = () => ymd(Date.now());
