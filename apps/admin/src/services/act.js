import { api, ApiError } from '../core/api.js';
import { loadAll } from '../core/store.js';
import { toast } from '../core/toast.js';

/*
 * Every change goes through here: ask the server, then reload what the server now holds, so the screen
 * always shows what is really saved. The server answers with an undo token for changes that can be taken back;
 * it is turned into a function the toast's Undo button calls.
 */
const message = (e) => (e instanceof ApiError ? e.message : 'Something went wrong. Please try again.');

function undoOf(token) {
  return async () => {
    try {
      await api.post('/admin/undo', { token });
    } catch (e) {
      toast(message(e), { type: 'err' });
    }
    await loadAll().catch(() => {});
  };
}

/**
 * Returns { ...serverAnswer, undo } or null when the server refused. The reason is shown as a toast,
 * and the data is reloaded, because a refusal often means someone else changed it first.
 */
export async function act(method, path, body) {
  try {
    const res = await api[method](path, body);
    await loadAll();
    return { ...res, undo: res.undo ? undoOf(res.undo.token) : null };
  } catch (e) {
    toast(message(e), { type: 'err' });
    if (e instanceof ApiError && e.status !== 401 && e.status !== 0) await loadAll().catch(() => {});
    return null;
  }
}
