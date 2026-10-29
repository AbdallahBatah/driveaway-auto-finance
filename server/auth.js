'use strict';
const crypto = require('crypto');
const db = require('./db');
const cfg = require('./config');
const { rid, tid, sha, safeEq, HttpError, clientIp, isHttps, limit } = require('./util');

const ROLES = ['owner', 'manager', 'sales'];
const N = 32768;
const scrypt = (pw, salt, n = N) => new Promise((ok, no) => crypto.scrypt(pw, salt, 32, { N: n, r: 8, p: 1, maxmem: 128 * 1024 * 1024 }, (e, k) => (e ? no(e) : ok(k))));
async function hashPw(pw) { const salt = crypto.randomBytes(16); return `scrypt$${N}$${salt.toString('base64')}$${(await scrypt(pw, salt)).toString('base64')}`; }
async function checkPw(pw, stored) {
  const [alg, n, salt, hash] = String(stored).split('$');
  if (alg !== 'scrypt') return false;
  const k = await scrypt(pw, Buffer.from(salt, 'base64'), +n);
  return crypto.timingSafeEqual(k, Buffer.from(hash, 'base64'));
}
const DUMMY = hashPw('not-a-real-password');
function pwProblem(pw, email) {
  if (typeof pw !== 'string' || pw.length < 12) return 'Use at least 12 characters.';
  if (pw.length > 200) return 'Password is too long.';
  if (/^(.)\1+$/.test(pw)) return 'Choose a less repetitive password.';
  if (email && pw.toLowerCase().includes(String(email).split('@')[0].toLowerCase()) && String(email).split('@')[0].length > 3) return 'Do not use your email name inside the password.';
  if (!/[a-zA-Z]/.test(pw) || !/[0-9\W_]/.test(pw)) return 'Mix letters with numbers or symbols.';
  return '';
}
const pub = u => ({ id: u.id, email: u.email, name: u.name, role: u.role, active: !!u.active, mustChange: !!u.must_change, lastLogin: u.last_login, createdAt: u.created_at });

async function audit(req, user, action, col, doc, detail) {
  try {
    const d = detail === undefined ? null : JSON.stringify(detail).slice(0, 4000);
    await db.run('INSERT INTO audit(id,at,uid,uname,action,col,doc,ip,detail) VALUES(?,?,?,?,?,?,?,?,?)',
      [tid(), Date.now(), user ? user.id : null, user ? user.name : null, action, col || null, doc || null, req ? clientIp(req) : null, d]);
  } catch (e) { console.error('audit failed', e.message); }
}

function parseCookies(req) {
  const o = {}; String(req.headers.cookie || '').split(';').forEach(p => { const i = p.indexOf('='); if (i > 0) o[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); });
  return o;
}
function cookie(req, token, maxAgeSec) {
  return `sid=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${isHttps(req) || cfg.production ? '; Secure' : ''}`;
}

// returns {user, session} or null
async function currentSession(req) {
  if (req._auth !== undefined) return req._auth;
  const t = parseCookies(req).sid; let out = null;
  if (t && /^[A-Za-z0-9_-]{30,60}$/.test(t)) {
    const rows = await db.all('SELECT s.sid,s.csrf,s.expires_at,s.touched_at,u.* FROM sessions s JOIN users u ON u.id=s.uid WHERE s.sid=?', [sha(t)]);
    const r = rows[0], now = Date.now();
    if (r && r.expires_at > now && r.active) {
      if (now - r.touched_at > 600000) { // slide the idle window
        await db.run('UPDATE sessions SET touched_at=?, expires_at=? WHERE sid=?', [now, now + cfg.sessionHours * 3600000, r.sid]);
        req._setCookie = cookie(req, t, cfg.sessionHours * 3600);
      }
      out = { user: r, csrf: r.csrf, sid: r.sid };
    } else if (r) await db.run('DELETE FROM sessions WHERE sid=?', [r.sid]);
  }
  return (req._auth = out);
}
async function login(req, email, password) {
  const ip = clientIp(req); email = String(email || '').trim().toLowerCase().slice(0, 200);
  limit('login-ip:' + ip, 20, 15 * 60000); limit('login-em:' + email, 10, 15 * 60000);
  const u = (await db.all('SELECT * FROM users WHERE email=?', [email]))[0], now = Date.now();
  if (!u) { await checkPw(String(password || '').slice(0, 200), await DUMMY); await audit(req, null, 'login.fail', null, null, { email, why: 'unknown' }); throw new HttpError(401, 'Wrong email or password.'); }
  if (u.locked_until > now) { await audit(req, u, 'login.locked'); throw new HttpError(423, 'Account temporarily locked. Try again in a few minutes.'); }
  const ok = u.active && await checkPw(String(password || '').slice(0, 200), u.pass);
  if (!ok) {
    const f = u.fails + 1;
    await db.run('UPDATE users SET fails=?, locked_until=? WHERE id=?', [f >= 8 ? 0 : f, f >= 8 ? now + 15 * 60000 : 0, u.id]);
    await audit(req, u, 'login.fail', null, null, { fails: f });
    throw new HttpError(401, 'Wrong email or password.');
  }
  await db.run('UPDATE users SET fails=0, locked_until=0, last_login=? WHERE id=?', [now, u.id]);
  const token = rid(32), csrf = rid(24);
  await db.run('INSERT INTO sessions(sid,uid,csrf,created_at,expires_at,touched_at,ip,ua) VALUES(?,?,?,?,?,?,?,?)',
    [sha(token), u.id, csrf, now, now + cfg.sessionHours * 3600000, now, ip, String(req.headers['user-agent'] || '').slice(0, 200)]);
  await db.run('DELETE FROM sessions WHERE expires_at<?', [now]);
  await audit(req, u, 'login.ok');
  return { token, user: u, csrf, cookie: cookie(req, token, cfg.sessionHours * 3600) };
}
async function logout(req) {
  const s = await currentSession(req);
  if (s) { await db.run('DELETE FROM sessions WHERE sid=?', [s.sid]); await audit(req, s.user, 'logout'); }
  return `sid=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${isHttps(req) || cfg.production ? '; Secure' : ''}`;
}
async function ensureOwner() {
  const n = (await db.all('SELECT COUNT(*) AS c FROM users'))[0].c;
  if (Number(n) > 0) return;
  if (!cfg.ownerEmail || !cfg.ownerPassword) { console.warn('\n[setup] No users yet. Set OWNER_EMAIL and OWNER_PASSWORD (Replit Secrets) and restart to create the first owner.\n'); return; }
  const bad = pwProblem(cfg.ownerPassword, cfg.ownerEmail);
  if (bad) { console.error('[setup] OWNER_PASSWORD rejected: ' + bad); return; }
  await createUser({ email: cfg.ownerEmail, name: 'Owner', role: 'owner', password: cfg.ownerPassword, mustChange: false });
  console.log('[setup] Owner account created for ' + cfg.ownerEmail + '. You can remove OWNER_PASSWORD from Secrets now.');
}
async function createUser({ email, name, role, password, mustChange }) {
  email = String(email || '').trim().toLowerCase();
  if (!/^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/.test(email)) throw new HttpError(400, 'Enter a valid email.');
  name = String(name || '').trim().slice(0, 80); if (!name) throw new HttpError(400, 'Name is required.');
  if (!ROLES.includes(role)) throw new HttpError(400, 'Choose a role.');
  const bad = pwProblem(password, email); if (bad) throw new HttpError(400, bad);
  if ((await db.all('SELECT id FROM users WHERE email=?', [email])).length) throw new HttpError(409, 'That email already has an account.');
  const id = rid(12);
  await db.run('INSERT INTO users(id,email,name,role,pass,active,must_change,created_at) VALUES(?,?,?,?,?,?,?,?)', [id, email, name, role, await hashPw(password), 1, mustChange ? 1 : 0, Date.now()]);
  return (await db.all('SELECT * FROM users WHERE id=?', [id]))[0];
}
const can = (user, ...roles) => !!user && roles.includes(user.role);
module.exports = { ROLES, hashPw, checkPw, pwProblem, pub, audit, currentSession, login, logout, ensureOwner, createUser, can, cookie, parseCookies };
