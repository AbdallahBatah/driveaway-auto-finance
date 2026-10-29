'use strict';
const http = require('http');
const fs = require('fs');
const crypto = require('crypto');
const cfg = require('./config');
const db = require('./db');
const auth = require('./auth');
const store = require('./store');
const pages = require('./pages');
const mail = require('./mail');
const backup = require('./backup');
const { HttpError, send, readJson, readBody, securityHeaders, clientIp, limit, hit, safeEq, rid, tid, esc } = require('./util');

let sharp = null; try { sharp = require('sharp'); } catch (e) { console.warn('[images] "sharp" not installed: photos are stored as uploaded (validated, max 5 MB).'); }

const J = (res, status, body, h) => send(res, status, body, { 'Cache-Control': 'no-store', ...h });
const staff = (s, ...roles) => { if (!s) throw new HttpError(401, 'Sign in required.'); if (roles.length && !roles.includes(s.user.role)) throw new HttpError(403, 'You do not have access to that.'); return s.user; };
function csrf(req, s) {
  const origin = req.headers.origin;
  if (origin) { let ok = false; try { const o = new URL(origin); ok = o.host === req.headers.host; } catch (e) {} if (!ok) throw new HttpError(403, 'Cross-site request blocked.'); }
  if (!s || !safeEq(req.headers['x-csrf-token'] || '', s.csrf)) throw new HttpError(403, 'Session check failed. Reload the page.');
}
const sniff = b => (b.length > 12 && b.slice(0, 4).toString() === 'RIFF' && b.slice(8, 12).toString() === 'WEBP' ? 'image/webp' : b[0] === 0xff && b[1] === 0xd8 ? 'image/jpeg' : b.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) ? 'image/png' : null);

async function turnstile(token, ip) {
  if (!cfg.turnstileSecret) return true;
  if (!token || typeof token !== 'string' || token.length > 2100) return false;
  try {
    const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ secret: cfg.turnstileSecret, response: token, remoteip: ip }) });
    return !!(await r.json()).success;
  } catch (e) { return false; }
}
const clean = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, n);

async function api(req, res, url) {
  const m = req.method, p = url.pathname, s = await auth.currentSession(req), ip = clientIp(req);
  if (m !== 'GET' && m !== 'HEAD' && p !== '/api/login' && p !== '/api/lead') csrf(req, s);
  limit('api:' + ip, 900, 10 * 60000);

  if (s && s.user.must_change && !['/api/me', '/api/me/password', '/api/logout'].includes(p)) throw new HttpError(403, 'Choose a new password first.');
  if (p === '/api/me' && m === 'GET') return J(res, 200, s ? { user: auth.pub(s.user), csrf: s.csrf } : { user: null });
  if (p === '/api/login' && m === 'POST') {
    csrf({ headers: { origin: req.headers.origin, host: req.headers.host, 'x-csrf-token': 'x' } }, { csrf: 'x' });
    const b = await readJson(req, 4096); const r = await auth.login(req, b.email, b.password);
    return J(res, 200, { user: auth.pub(r.user), csrf: r.csrf }, { 'Set-Cookie': r.cookie });
  }
  if (p === '/api/logout' && m === 'POST') return J(res, 200, { ok: true }, { 'Set-Cookie': await auth.logout(req) });
  if (p === '/api/me/password' && m === 'POST') {
    const u = staff(s); const b = await readJson(req, 4096);
    if (!(await auth.checkPw(String(b.current || '').slice(0, 200), u.pass))) throw new HttpError(400, 'Current password is wrong.');
    const bad = auth.pwProblem(b.password, u.email); if (bad) throw new HttpError(400, bad);
    await db.run('UPDATE users SET pass=?, must_change=0 WHERE id=?', [await auth.hashPw(b.password), u.id]);
    await db.run('DELETE FROM sessions WHERE uid=? AND sid<>?', [u.id, s.sid]);
    await auth.audit(req, u, 'user.password.self'); return J(res, 200, { ok: true });
  }
  if (p === '/api/team' && m === 'GET') {
    staff(s); return J(res, 200, (await db.all('SELECT name,role FROM users WHERE active=1 ORDER BY name')).map(r => ({ name: r.name, role: r.role })));
  }
  // ---- public lead form ----
  if (p === '/api/lead' && m === 'POST') {
    csrf({ headers: { origin: req.headers.origin, host: req.headers.host, 'x-csrf-token': 'x' } }, { csrf: 'x' });
    const b = await readJson(req, 8192);
    if (b.hp) return J(res, 200, { ok: true }); // honeypot: pretend success
    if (typeof b.t === 'number' && Date.now() - b.t < 2500) throw new HttpError(429, 'Please take a moment and try again.');
    limit('lead:' + ip, 6, 3600000); limit('lead-all', 400, 3600000);
    if (!(await turnstile(b['cf-turnstile-response'], ip))) throw new HttpError(400, 'Please complete the human check and try again.');
    const kind = b.kind === 'sell' ? 'sell' : 'apply';
    const d = { source: kind === 'sell' ? 'Sell or trade form' : 'Financing form', name: clean(b.name, 120), phone: clean(b.phone, 40), email: clean(b.email, 160), vehicle: clean(b.vehicle, 160), down: clean(b.down, 40), miles: clean(b.miles, 20) };
    if (!d.name || d.phone.replace(/\D/g, '').length < 7) throw new HttpError(400, 'Enter your name and a phone number.');
    if (d.email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(d.email)) throw new HttpError(400, 'Check your email address.');
    const id = await store.createLead(d);
    await auth.audit(req, null, 'lead.create', 'leads', id, { source: d.source });
    mail.send(`New ${kind === 'sell' ? 'sell/trade' : 'financing'} request: ${d.name}`, [['Name', d.name], ['Phone', d.phone], ['Email', d.email], ['Vehicle', d.vehicle], ['Down payment', d.down], ['Mileage', d.miles], ['Source', d.source]], d.email);
    return J(res, 200, { ok: true });
  }
  // ---- documents ----
  let mt = p.match(/^\/api\/c\/([a-z]+)$/);
  if (mt && m === 'GET') {
    if (mt[1] === 'vehicles' && !s) return J(res, 200, (await store.publicVehicles()).map(({ id, ...data }) => ({ id, data })), { 'Cache-Control': 'public, max-age=30' });
    return J(res, 200, await store.list(s && s.user, mt[1]));
  }
  mt = p.match(/^\/api\/c\/([a-z]+)\/([A-Za-z0-9_-]{1,64})$/);
  if (mt) {
    const [, col, id] = mt;
    if (m === 'GET') { const r = await store.get(s && s.user, col, id); return r ? J(res, 200, r) : J(res, 404, { error: 'Not found' }); }
    const u = staff(s);
    if (m === 'PUT' || m === 'PATCH') return J(res, 200, await store.put(req, u, col, id, await readJson(req), m === 'PATCH'));
    if (m === 'DELETE') return J(res, 200, { ok: await store.remove(req, u, col, id) });
  }
  // ---- photos ----
  if (p === '/api/upload' && m === 'POST') {
    const u = staff(s, 'owner', 'manager'); limit('upload:' + u.id, 80, 3600000);
    let buf = await readBody(req, 8 * 1024 * 1024), type = sniff(buf);
    if (!type) throw new HttpError(400, 'Use a JPG, PNG or WebP photo.');
    if (sharp) { try { buf = await sharp(buf, { limitInputPixels: 80e6 }).rotate().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true }).webp({ quality: 80 }).toBuffer(); type = 'image/webp'; } catch (e) { throw new HttpError(400, 'That image could not be read.'); } }
    else if (buf.length > 5 * 1024 * 1024) throw new HttpError(413, 'Photo is larger than 5 MB.');
    const id = rid(16);
    await db.run('INSERT INTO blobs(id,type,data,created_at,created_by) VALUES(?,?,?,?,?)', [id, type, buf, Date.now(), u.id]);
    await auth.audit(req, u, 'photo.upload', 'blobs', id, { bytes: buf.length });
    return J(res, 200, { id, url: '/_blob/' + id, sizeBytes: buf.length, contentType: type });
  }
  // ---- users (owner) ----
  if (p === '/api/users' && m === 'GET') { staff(s, 'owner'); return J(res, 200, (await db.all('SELECT * FROM users ORDER BY created_at')).map(auth.pub)); }
  if (p === '/api/users' && m === 'POST') {
    const u = staff(s, 'owner'); const b = await readJson(req, 4096);
    const n = await auth.createUser({ email: b.email, name: b.name, role: b.role, password: b.password, mustChange: true });
    await auth.audit(req, u, 'user.create', 'users', n.id, { email: n.email, role: n.role }); return J(res, 200, auth.pub(n));
  }
  mt = p.match(/^\/api\/users\/([A-Za-z0-9_-]{1,40})$/);
  if (mt && m === 'PATCH') {
    const u = staff(s, 'owner'); const b = await readJson(req, 4096);
    const t = (await db.all('SELECT * FROM users WHERE id=?', [mt[1]]))[0]; if (!t) throw new HttpError(404, 'Not found');
    const owners = Number((await db.all("SELECT COUNT(*) AS c FROM users WHERE role='owner' AND active=1"))[0].c);
    const role = b.role !== undefined ? b.role : t.role, active = b.active !== undefined ? (b.active ? 1 : 0) : t.active;
    if (!auth.ROLES.includes(role)) throw new HttpError(400, 'Unknown role.');
    if (t.id === u.id && (role !== 'owner' || !active)) throw new HttpError(400, 'You cannot demote or disable your own account.');
    if (t.role === 'owner' && t.active && (role !== 'owner' || !active) && owners <= 1) throw new HttpError(400, 'Keep at least one active owner.');
    const name = b.name !== undefined ? clean(b.name, 80) : t.name; if (!name) throw new HttpError(400, 'Name is required.');
    await db.run('UPDATE users SET name=?, role=?, active=? WHERE id=?', [name, role, active, t.id]);
    if (b.password) {
      const bad = auth.pwProblem(b.password, t.email); if (bad) throw new HttpError(400, bad);
      await db.run('UPDATE users SET pass=?, must_change=1, fails=0, locked_until=0 WHERE id=?', [await auth.hashPw(b.password), t.id]);
    }
    if (b.password || !active || role !== t.role) await db.run('DELETE FROM sessions WHERE uid=?', [t.id]);
    await auth.audit(req, u, 'user.update', 'users', t.id, { email: t.email, role, active: !!active, passwordReset: !!b.password });
    return J(res, 200, auth.pub((await db.all('SELECT * FROM users WHERE id=?', [t.id]))[0]));
  }
  // ---- audit and backups (owner) ----
  if (p === '/api/audit' && m === 'GET') {
    staff(s, 'owner'); const lim = Math.min(+url.searchParams.get('limit') || 100, 500), before = url.searchParams.get('before') || 'z';
    return J(res, 200, (await db.all('SELECT id,at,uname,action,col,doc,ip,detail FROM audit WHERE id<? ORDER BY id DESC LIMIT ' + lim, [before])).map(r => ({ ...r, detail: r.detail ? JSON.parse(r.detail) : null })));
  }
  if (p === '/api/backups' && m === 'GET') { staff(s, 'owner'); return J(res, 200, await backup.list()); }
  if (p === '/api/backups' && m === 'POST') {
    const u = staff(s, 'owner'); const b = await readJson(req, 1024); const r = await backup.snapshot(b.full ? 'full' : 'manual', !!b.full);
    await auth.audit(req, u, 'backup.create', 'backups', r.id, r); return J(res, 200, r);
  }
  mt = p.match(/^\/api\/backups\/([A-Za-z0-9]{1,40})(\/download|\/restore)?$/);
  if (mt) {
    const u = staff(s, 'owner');
    if (mt[2] === '/download' && m === 'GET') { await auth.audit(req, u, 'backup.download', 'backups', mt[1]); return send(res, 200, await backup.download(mt[1]), { 'Content-Type': 'application/gzip', 'Content-Disposition': `attachment; filename="driveaway-backup-${mt[1]}.json.gz"`, 'Cache-Control': 'no-store' }); }
    if (mt[2] === '/restore' && m === 'POST') {
      const b = await readJson(req, 1024); if (b.confirm !== 'RESTORE') throw new HttpError(400, 'Type RESTORE to confirm.');
      const r = await backup.restore(mt[1]); await auth.audit(req, u, 'backup.restore', 'backups', mt[1], r); return J(res, 200, r);
    }
  }
  throw new HttpError(404, 'Not found');
}

async function handle(req, res) {
  const url = new URL(req.url, 'http://x'); let p;
  try { p = decodeURIComponent(url.pathname); } catch (e) { return send(res, 400, 'Bad request'); }
  const nonce = crypto.randomBytes(16).toString('base64');
  securityHeaders(res, req, nonce, false);
  try {
    if (p.startsWith('/api/')) {
      if (!['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) throw new HttpError(405, 'Method not allowed');
      return await api(req, res, { pathname: p, searchParams: url.searchParams });
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Method not allowed');
    if (p === '/healthz') return send(res, 200, 'ok');
    let mt = p.match(/^\/_blob\/([A-Za-z0-9_-]{1,64})$/);
    if (mt) {
      const r = (await db.all('SELECT type,data FROM blobs WHERE id=?', [mt[1]]))[0]; if (!r) return send(res, 404, 'Not found');
      return send(res, 200, Buffer.from(r.data), { 'Content-Type': r.type, 'Cache-Control': 'public, max-age=31536000, immutable', 'Content-Disposition': 'inline', 'Cross-Origin-Resource-Policy': 'same-origin' });
    }
    mt = p.match(/^\/assets\/(.+)$/);
    if (mt) {
      const a = pages.asset(mt[1]); if (!a) return send(res, 404, 'Not found');
      res.writeHead(200, { 'Content-Type': a.type, 'Content-Length': a.size, 'Cache-Control': url.searchParams.has('v') ? 'public, max-age=31536000, immutable' : 'public, max-age=3600' });
      return req.method === 'HEAD' ? res.end() : fs.createReadStream(a.file).pipe(res);
    }
    if (p === '/robots.txt') return send(res, 200, pages.robots(req), { 'Cache-Control': 'public, max-age=3600' });
    if (p === '/sitemap.xml') return send(res, 200, await pages.sitemap(req), { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=900' });
    if (p === '/llms.txt' || p === '/llms-full.txt') return send(res, 200, await pages.llms(req, p === '/llms-full.txt'), { 'Cache-Control': 'public, max-age=900' });
    if (p === '/index.html') { res.writeHead(301, { Location: '/' }); return res.end(); }
    const r = pages.route(p);
    if (r && p !== '/' && !p.endsWith('/')) { res.writeHead(301, { Location: p + '/' + (url.search || '') }); return res.end(); }
    const out = await pages.render(req, p, nonce);
    if (!out) { const nf = await pages.render(req, '/cars/not-found', nonce); securityHeaders(res, req, nonce, true); return send(res, 404, nf.html, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); }
    securityHeaders(res, req, nonce, true);
    const priv = r && r.noindex;
    return send(res, out.status, req.method === 'HEAD' ? '' : out.html, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': priv ? 'no-store' : 'public, max-age=0, must-revalidate', ...(priv ? { 'X-Robots-Tag': 'noindex, nofollow' } : {}) });
  } catch (e) {
    if (e instanceof HttpError) return J(res, e.status, { error: e.message }, e.retry ? { 'Retry-After': String(e.retry) } : {});
    console.error('[error]', req.method, req.url, e);
    return J(res, 500, { error: 'Something went wrong. Please try again.' });
  }
}

async function start() {
  await db.init(); await auth.ensureOwner();
  if (cfg.seed) await require('./seed').run();
  backup.schedule();
  const server = http.createServer((req, res) => { handle(req, res).catch(e => { console.error(e); try { res.end(); } catch (_) {} }); });
  server.requestTimeout = 60000; server.headersTimeout = 20000; server.keepAliveTimeout = 10000;
  await new Promise(ok => server.listen(cfg.port, '0.0.0.0', ok));
  console.log(`Driveaway server on :${cfg.port} (${db.kind}${cfg.production ? ', production' : ''})`);
  return server;
}
if (require.main === module) start().catch(e => { console.error(e); process.exit(1); });
module.exports = { start };
