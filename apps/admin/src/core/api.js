/*
 * Talks to the server. Every write carries the X-MF header (the server rejects writes without it, which
 * stops other websites from posting to it). A 401 means the session ended, so the panel goes back to sign-in.
 */
export class ApiError extends Error {
  constructor(status, code, message, extra) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

let onSignedOut = () => {};
export const setSignedOutHandler = (fn) => {
  onSignedOut = fn;
};

async function call(method, path, body) {
  let res;
  try {
    res = await fetch('/api' + path, {
      method,
      credentials: 'same-origin',
      headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(method !== 'GET' ? { 'X-MF': '1' } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (e) {
    throw new ApiError(0, 'offline', 'Cannot reach the server. Check your connection and try again.');
  }
  let data = null;
  try {
    data = await res.json();
  } catch (e) {
    /* empty or non-JSON answer */
  }
  if (!res.ok) {
    const err = (data && data.error) || {};
    const e = new ApiError(res.status, err.code || 'error', err.message || 'Something went wrong. Please try again.', err);
    if (res.status === 401 && !path.startsWith('/admin/auth/login')) onSignedOut(e);
    throw e;
  }
  return data;
}

export const api = {
  get: (p) => call('GET', p),
  post: (p, b = {}) => call('POST', p, b),
  patch: (p, b = {}) => call('PATCH', p, b),
  del: (p) => call('DELETE', p),
};
