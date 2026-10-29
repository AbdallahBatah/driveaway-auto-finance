'use strict';
const crypto = require('crypto');
const cfg = require('./config');

const rid = (n = 12) => crypto.randomBytes(n).toString('base64url');
const tid = () => Date.now().toString(36).padStart(9, '0') + crypto.randomBytes(5).toString('hex'); // time-ordered id
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const safeEq = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function clientIp(req) {
  if (cfg.trustProxy) {
    const x = req.headers['x-forwarded-for'];
    if (x) return String(x).split(',')[0].trim().slice(0, 64);
  }
  return (req.socket.remoteAddress || '').slice(0, 64);
}
const isHttps = req => req.socket.encrypted || (cfg.trustProxy && req.headers['x-forwarded-proto'] === 'https');

class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }

async function readBody(req, limit) {
  const chunks = []; let n = 0;
  for await (const c of req) { n += c.length; if (n > limit) throw new HttpError(413, 'Request too large'); chunks.push(c); }
  return Buffer.concat(chunks);
}
async function readJson(req, limit = 300 * 1024) {
  const ct = String(req.headers['content-type'] || '');
  if (!/^application\/json/i.test(ct)) throw new HttpError(415, 'Send JSON');
  const b = await readBody(req, limit);
  if (!b.length) return {};
  try { const v = JSON.parse(b.toString('utf8')); if (v === null || typeof v !== 'object') throw 0; return v; } catch (e) { throw new HttpError(400, 'Invalid JSON'); }
}

function send(res, status, body, headers = {}) {
  const isObj = body !== null && typeof body === 'object' && !Buffer.isBuffer(body);
  const data = isObj ? JSON.stringify(body) : body;
  res.writeHead(status, { 'Content-Type': isObj ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8', ...(Buffer.isBuffer(data) ? { 'Content-Length': data.length } : {}), ...headers });
  res.end(data);
}

// ---- in-memory rate limiter (one process; use a shared store if you scale to several instances) ----
const buckets = new Map();
function hit(key, max, windowMs) {
  const now = Date.now(); let b = buckets.get(key);
  if (!b || b.reset < now) b = { n: 0, reset: now + windowMs };
  b.n++; buckets.set(key, b);
  return { ok: b.n <= max, retry: Math.ceil((b.reset - now) / 1000) };
}
const limit = (key, max, windowMs) => { const r = hit(key, max, windowMs); if (!r.ok) { const e = new HttpError(429, 'Too many attempts. Try again in ' + Math.ceil(r.retry / 60) + ' min.'); e.retry = r.retry; throw e; } };
setInterval(() => { const now = Date.now(); for (const [k, v] of buckets) if (v.reset < now) buckets.delete(k); }, 60000).unref();

function securityHeaders(res, req, nonce, html) {
  const h = {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'X-Frame-Options': 'DENY',
    'X-Permitted-Cross-Domain-Policies': 'none'
  };
  if (isHttps(req)) h['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains';
  if (html) h['Content-Security-Policy'] = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' https://challenges.cloudflare.com`,
    "script-src-attr 'none'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: blob:",
    "connect-src 'self'",
    'frame-src https://challenges.cloudflare.com',
    "object-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'none'",
    isHttps(req) ? 'upgrade-insecure-requests' : ''
  ].filter(Boolean).join('; ');
  for (const [k, v] of Object.entries(h)) res.setHeader(k, v);
}
module.exports = { rid, tid, sha, safeEq, esc, clientIp, isHttps, HttpError, readBody, readJson, send, limit, hit, securityHeaders };
