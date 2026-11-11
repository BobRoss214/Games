// API client. See docs/API.md.
// - Normal routes use the same-origin login cookie and JSON bodies.
// - Payment routes are called with no cookie, so the payment system cannot
//   connect an invoice to an account.
export class ApiError extends Error {
  constructor(status, code, message, extra = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

const OFFLINE = 'Cannot reach the server. Check your connection, then try again.';
let onSignedOut = () => {};
export function setSignedOutHandler(fn) { onSignedOut = fn; }

async function readError(res) {
  let code = 'error';
  let message = '';
  let extra = {};
  try {
    const data = await res.json();
    if (data && data.error) {
      ({ code = 'error', message = '', ...extra } = data.error);
    }
  } catch { /* not JSON */ }
  if (!message) {
    message = res.status === 404 ? 'This item does not exist any more.'
      : res.status === 413 ? 'This is too large to send.'
      : res.status === 429 ? 'Too many requests. Wait a moment, then try again.'
      : res.status >= 500 ? 'Something went wrong on the server. Try again.'
      : 'The request did not work. Try again.';
  }
  return new ApiError(res.status, code, message, extra);
}

async function request(method, path, body, { credentials = 'same-origin', quiet401 = false, signal } = {}) {
  const init = { method, credentials, cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer', headers: { accept: 'application/json' }, signal };
  if (method !== 'GET' && method !== 'HEAD') {
    init.headers['content-type'] = 'application/json';
    if (body !== undefined) init.body = JSON.stringify(body);
    else if (method !== 'DELETE') init.body = '{}';
  }
  let res;
  try {
    res = await fetch(path, init);
  } catch (err) {
    if (err && err.name === 'AbortError') throw err;
    throw new ApiError(0, 'network', OFFLINE);
  }
  if (!res.ok) {
    const error = await readError(res);
    if (res.status === 401 && error.code === 'not_signed_in' && !quiet401) onSignedOut();
    throw error;
  }
  return res;
}

async function json(method, path, body, opts) {
  const res = await request(method, path, body, opts);
  if (res.status === 204) return null;
  const type = res.headers.get('content-type') || '';
  if (!type.includes('json')) return null;
  return res.json();
}

export const api = {
  get: (path, opts) => json('GET', path, undefined, opts),
  post: (path, body, opts) => json('POST', path, body, opts),
  put: (path, body, opts) => json('PUT', path, body, opts),
  patch: (path, body, opts) => json('PATCH', path, body, opts),
  del: (path, body, opts) => json('DELETE', path, body, opts),
  // Encrypted attachment bytes.
  async bytes(path, opts) {
    const res = await request('GET', path, undefined, opts);
    return new Uint8Array(await res.arrayBuffer());
  },
};

// Payment routes: never send the login cookie.
const NO_COOKIE = { credentials: 'omit' };
export const payApi = {
  get: (path) => json('GET', path, undefined, NO_COOKIE),
  post: (path, body) => json('POST', path, body, NO_COOKIE),
};

export function query(params) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') q.set(k, String(v));
  const str = q.toString();
  return str ? `?${str}` : '';
}
