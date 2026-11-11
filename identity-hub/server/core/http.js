// Small HTTP layer: router, JSON bodies, sessions, security headers, rate limits, static files.
// It has no dependencies. It writes no request logs and stores no IP addresses.
import { createServer } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { join, normalize, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const WEB_DIR = join(ROOT, 'web');
const SHARED_DIR = join(ROOT, 'shared');

export class HttpError extends Error {
  constructor(status, code, message, extra) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}
// Use: throw fail(400, 'bad_request', 'Plain words for the user.')
export const fail = (status, code, message, extra) => new HttpError(status, code, message, extra);

const REPLY = Symbol('reply');
// Use: return reply(201, body) or reply(200, buffer, { 'content-type': 'application/octet-stream' })
export const reply = (status, body, headers = {}) => ({ [REPLY]: true, status, body, headers });
// A handler returns HANDLED when it wrote the response itself (for example an event stream).
export const HANDLED = Symbol('handled');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
};

const CSP = [
  "default-src 'none'", "script-src 'self'", "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob:",
  "font-src 'self'", "connect-src 'self'", "manifest-src 'self'", "frame-src 'self' blob:", "worker-src 'self'",
  "media-src 'self' blob:",
  "base-uri 'none'", "form-action 'self'", "frame-ancestors 'none'",
].join('; ');

function createLimiter() {
  const salt = randomBytes(16); // new for each start; counters are in memory only
  const buckets = new Map();
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [k, b] of buckets) if (b.reset <= now) buckets.delete(k);
  }, 30_000);
  timer.unref();
  return {
    key: (...parts) => createHash('sha256').update(salt).update(parts.join('\0')).digest('base64'),
    // Returns true if the caller is over the limit.
    hit(key, max, perSec) {
      const now = Date.now();
      let b = buckets.get(key);
      if (!b || b.reset <= now) { b = { n: 0, reset: now + perSec * 1000 }; buckets.set(key, b); }
      b.n++;
      return b.n > max;
    },
    stop: () => clearInterval(timer),
  };
}

export function createHttp({ config, store, log }) {
  const routes = [];
  const limiter = createLimiter();
  const cookieName = config.secureCookies ? '__Host-postern' : 'postern';

  function route(method, path, opts, handler) {
    if (typeof opts === 'function') { handler = opts; opts = {}; }
    routes.push({ method, path, segs: path.split('/').filter(Boolean), opts, handler });
  }

  function match(method, pathname) {
    const segs = pathname.split('/').filter(Boolean);
    let pathFound = false;
    for (const r of routes) {
      if (r.segs.length !== segs.length) continue;
      const params = {};
      let ok = true;
      for (let i = 0; i < segs.length; i++) {
        if (r.segs[i][0] === ':') {
          try { params[r.segs[i].slice(1)] = decodeURIComponent(segs[i]); } catch { ok = false; }
        } else if (r.segs[i] !== segs[i]) ok = false;
        if (!ok) break;
      }
      if (!ok) continue;
      pathFound = true;
      if (r.method === method) return { route: r, params };
    }
    return pathFound ? { wrongMethod: true } : null;
  }

  function clientIp(req) {
    if (config.trustProxy) {
      const xff = req.headers['x-forwarded-for'];
      if (xff) return String(xff).split(',').pop().trim();
    }
    return req.socket.remoteAddress || '';
  }

  function readBody(req, limit) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      let size = 0;
      let done = false;
      req.on('data', (chunk) => {
        if (done) return;
        size += chunk.length;
        if (size > limit) {
          done = true;
          reject(fail(413, 'too_large', 'The request is too large.'));
          req.resume();
          return;
        }
        chunks.push(chunk);
      });
      req.on('end', () => { if (!done) resolve(Buffer.concat(chunks)); });
      req.on('error', () => { if (!done) reject(fail(400, 'bad_request', 'The request was not complete.')); });
    });
  }

  function parseCookies(header) {
    const out = {};
    for (const part of String(header || '').split(';')) {
      const i = part.indexOf('=');
      if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
    }
    return out;
  }

  function securityHeaders(res) {
    res.setHeader('Content-Security-Policy', CSP);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()');
    if (config.secureCookies) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }

  function sendJson(res, status, body, headers = {}) {
    const data = Buffer.from(JSON.stringify(body));
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': data.length, 'cache-control': 'no-store', ...headers });
    res.end(data);
  }

  async function serveStatic(req, res, pathname) {
    if (req.method !== 'GET' && req.method !== 'HEAD') throw fail(405, 'method_not_allowed', 'Method not allowed.');
    let rel;
    try { rel = decodeURIComponent(pathname); } catch { throw fail(400, 'bad_request', 'Bad path.'); }
    if (rel.includes('\0')) throw fail(400, 'bad_request', 'Bad path.');
    let base = WEB_DIR;
    if (rel.startsWith('/shared/')) { base = SHARED_DIR; rel = rel.slice('/shared'.length); }
    let file = normalize(join(base, rel));
    if (file !== base && !file.startsWith(base + sep)) throw fail(404, 'not_found', 'Not found.');
    let info = await stat(file).catch(() => null);
    if (!info || info.isDirectory()) {
      // Single-page app: unknown paths without a file extension get index.html.
      if (extname(rel) && !(info && info.isDirectory())) throw fail(404, 'not_found', 'Not found.');
      file = join(WEB_DIR, 'index.html');
      info = await stat(file).catch(() => null);
      if (!info) throw fail(404, 'not_found', 'Not found.');
    }
    const etag = `"${info.size.toString(36)}-${Math.floor(info.mtimeMs).toString(36)}"`;
    const headers = { 'content-type': MIME[extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache', etag };
    if (req.headers['if-none-match'] === etag) { res.writeHead(304, headers); res.end(); return; }
    const data = await readFile(file);
    res.writeHead(200, { ...headers, 'content-length': data.length });
    res.end(req.method === 'HEAD' ? undefined : data);
  }

  async function handleApi(req, res, url) {
    const m = match(req.method, url.pathname);
    if (!m) throw fail(404, 'not_found', 'Not found.');
    if (m.wrongMethod) throw fail(405, 'method_not_allowed', 'Method not allowed.');
    const { route: r, params } = m;
    const opts = r.opts;
    const ip = clientIp(req);
    const c = {
      req, res, method: req.method, path: url.pathname, params, query: Object.fromEntries(url.searchParams),
      headers: req.headers, account: null, session: null, body: undefined, raw: undefined,
      setSession(session) {
        const attrs = [`${cookieName}=${session.token}`, 'Path=/', 'HttpOnly', 'SameSite=Strict', `Max-Age=${config.sessionDays * 86400}`];
        if (config.secureCookies) attrs.push('Secure');
        res.setHeader('Set-Cookie', attrs.join('; '));
      },
      clearSession() {
        res.setHeader('Set-Cookie', `${cookieName}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${config.secureCookies ? '; Secure' : ''}`);
      },
      // Extra rate limit from inside a handler. Throws 429 when over the limit.
      limit(name, max, perSec, who) {
        if (!config.rateLimits) return;
        if (limiter.hit(limiter.key('h', name, who || ip), max, perSec)) throw fail(429, 'rate_limited', 'Too many requests. Wait a moment, then try again.');
      },
    };

    if (config.rateLimits && limiter.hit(limiter.key('g', ip), config.limits.requestsPerMinute || 900, 60)) {
      throw fail(429, 'rate_limited', 'Too many requests. Wait a moment, then try again.');
    }

    if (opts.auth) {
      const token = parseCookies(req.headers.cookie)[cookieName];
      const session = token ? store.getSession(token) : null;
      const account = session ? store.getAccount(session.accountId) : null;
      if (account) { c.session = session; c.account = account; }
      else if (opts.auth !== 'optional') throw fail(401, 'not_signed_in', 'Sign in first.');
    }

    // Cross-site request protection. Browsers send Origin or Sec-Fetch-Site with requests that change data.
    if (c.account && req.method !== 'GET' && req.method !== 'HEAD') {
      const origin = req.headers.origin;
      const site = req.headers['sec-fetch-site'];
      if ((origin && origin !== config.origin) || (site && site !== 'same-origin' && site !== 'none')) {
        throw fail(403, 'bad_origin', 'This request came from a different website.');
      }
    }

    if (opts.rate && config.rateLimits) {
      const who = c.account ? c.account.id : ip;
      if (limiter.hit(limiter.key('r', r.method, r.path, who), opts.rate.max, opts.rate.per)) {
        throw fail(429, 'rate_limited', 'Too many requests. Wait a moment, then try again.');
      }
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      c.raw = await readBody(req, opts.limit || 64 * 1024);
      const kind = opts.body || 'json';
      const type = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
      if (kind === 'json') {
        if (c.raw.length === 0) c.body = {};
        else {
          if (type !== 'application/json') throw fail(415, 'bad_content_type', 'Send JSON.');
          try { c.body = JSON.parse(c.raw.toString('utf8')); } catch { throw fail(400, 'bad_json', 'The JSON is not valid.'); }
          if (c.body === null || typeof c.body !== 'object' || Array.isArray(c.body)) throw fail(400, 'bad_json', 'Send a JSON object.');
        }
      } else if (kind === 'form') {
        c.body = Object.fromEntries(new URLSearchParams(c.raw.toString('utf8')));
      }
    }

    const out = await r.handler(c);
    if (out === HANDLED) return;
    if (out && out[REPLY]) {
      if (Buffer.isBuffer(out.body) || out.body instanceof Uint8Array || typeof out.body === 'string') {
        const data = Buffer.from(out.body);
        res.writeHead(out.status, { 'content-type': 'application/octet-stream', 'cache-control': 'no-store', 'content-length': data.length, ...out.headers });
        res.end(data);
      } else if (out.body === undefined || out.body === null) {
        res.writeHead(out.status, { 'cache-control': 'no-store', ...out.headers });
        res.end();
      } else sendJson(res, out.status, out.body, out.headers);
      return;
    }
    if (out === undefined || out === null) { res.writeHead(204, { 'cache-control': 'no-store' }); res.end(); return; }
    sendJson(res, 200, out);
  }

  async function handle(req, res) {
    securityHeaders(res);
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname === '/api' || url.pathname.startsWith('/api/')) await handleApi(req, res, url);
      else await serveStatic(req, res, url.pathname);
    } catch (err) {
      if (res.headersSent) { res.destroy(); return; }
      if (err instanceof HttpError) {
        sendJson(res, err.status, { error: { code: err.code, message: err.message, ...(err.extra || {}) } });
      } else {
        log.error('request failed', err);
        sendJson(res, 500, { error: { code: 'server_error', message: 'Something went wrong on the server. Try again.' } });
      }
    }
  }

  const server = createServer({ requestTimeout: 60_000, headersTimeout: 20_000 }, handle);
  const http = {
    server, route, handle, limiter,
    get: (p, o, h) => route('GET', p, o, h),
    post: (p, o, h) => route('POST', p, o, h),
    put: (p, o, h) => route('PUT', p, o, h),
    patch: (p, o, h) => route('PATCH', p, o, h),
    del: (p, o, h) => route('DELETE', p, o, h),
    listen() {
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(config.port, config.host, () => resolve(server.address().port));
      });
    },
    close() {
      limiter.stop();
      return new Promise((resolve) => { server.closeAllConnections(); server.close(() => resolve()); });
    },
  };
  return http;
}

// ---- input checks for handlers ----
export const need = {
  string(v, name, { min = 1, max = 256, pattern } = {}) {
    if (typeof v !== 'string' || v.length < min || v.length > max || (pattern && !pattern.test(v))) throw fail(400, 'bad_request', `The value "${name}" is not valid.`);
    return v;
  },
  int(v, name, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
    if (!Number.isInteger(v) || v < min || v > max) throw fail(400, 'bad_request', `The value "${name}" is not valid.`);
    return v;
  },
  bool(v, name) {
    if (typeof v !== 'boolean') throw fail(400, 'bad_request', `The value "${name}" is not valid.`);
    return v;
  },
  // base64url string -> Buffer with a size check
  bytes(v, name, { min = 1, max = 4096 } = {}) {
    if (typeof v !== 'string' || !/^[A-Za-z0-9_-]*$/.test(v)) throw fail(400, 'bad_request', `The value "${name}" is not valid.`);
    const b = Buffer.from(v, 'base64url');
    if (b.length < min || b.length > max) throw fail(400, 'bad_request', `The value "${name}" is not valid.`);
    return b;
  },
  optional: (v, fn, ...args) => (v === undefined || v === null ? undefined : fn(v, ...args)),
};
export const b64u = (bytes) => (bytes === null || bytes === undefined ? null : Buffer.from(bytes).toString('base64url'));
