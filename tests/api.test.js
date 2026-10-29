'use strict';
// End-to-end API test: boots the real server on a temporary SQLite database.
const path = require('path'), fs = require('fs'), os = require('os'), assert = require('assert');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-'));
Object.assign(process.env, { SQLITE_FILE: path.join(tmp, 't.sqlite'), PORT: '0', OWNER_EMAIL: 'boss@example.com', OWNER_PASSWORD: 'Correct-Horse-9', SITE_URL: 'https://example.test', NODE_ENV: 'test' });
delete process.env.DATABASE_URL;
const { start } = require('../server/index');

let base, pass = 0;
const ck = (c, m) => { assert(c, m); pass++; console.log('  ok  ' + m); };
class Client {
  constructor() { this.cookie = ''; this.csrf = ''; }
  async req(method, url, body, opt = {}) {
    const h = { Origin: base, ...(this.cookie ? { Cookie: this.cookie } : {}), ...(this.csrf && method !== 'GET' ? { 'X-CSRF-Token': this.csrf } : {}), ...(opt.headers || {}) };
    if (body !== undefined && !opt.raw) h['Content-Type'] = 'application/json';
    const r = await fetch(base + url, { method, headers: h, body: opt.raw ? body : body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' });
    const sc = r.headers.get('set-cookie'); if (sc) this.cookie = sc.split(';')[0];
    const ct = r.headers.get('content-type') || ''; let data = ct.includes('json') ? await r.json() : ct.startsWith('text') ? await r.text() : Buffer.from(await r.arrayBuffer());
    return { status: r.status, data, headers: r.headers };
  }
  async login(email, password) { const r = await this.req('POST', '/api/login', { email, password }); if (r.status === 200) this.csrf = r.data.csrf; return r; }
}
(async () => {
  const server = await start(); base = 'http://127.0.0.1:' + server.address().port;
  const anon = new Client(), owner = new Client(), mgr = new Client(), sales = new Client(), sales2 = new Client();

  console.log('public site');
  let r = await anon.req('GET', '/'); ck(r.status === 200 && /<title>Used Cars in Hobart/.test(r.data), 'home renders with its own title');
  ck(/Content-Security-Policy/i.test([...r.headers.keys()].join()) && /script-src-attr 'none'/.test(r.headers.get('content-security-policy')), 'CSP forbids inline event handlers');
  ck(r.headers.get('x-frame-options') === 'DENY' && r.headers.get('x-content-type-options') === 'nosniff', 'security headers present');
  ck(/rel="canonical" href="https:\/\/example.test\/"/.test(r.data), 'canonical uses SITE_URL');
  r = await anon.req('GET', '/inventory/'); ck(/\/cars\/2020-chevrolet-colorado[^"]*\//.test(r.data), 'inventory lists crawlable vehicle links');
  r = await anon.req('GET', '/cars/2020-chevrolet-colorado-4wd-crew-cab-work-truck-10016/');
  ck(r.status === 200 && /<h1>2020 Chevrolet Colorado/.test(r.data) && /"@type":"Car"/.test(r.data), 'vehicle page: server-rendered h1 + Car JSON-LD');
  r = await anon.req('GET', '/cars/does-not-exist/'); ck(r.status === 404 && /noindex/.test(r.data), 'unknown vehicle returns 404 + noindex');
  r = await anon.req('GET', '/sitemap.xml'); ck(r.data.includes('/cars/2020-chevrolet-colorado') && !r.data.includes('/admin'), 'sitemap lists vehicles, not admin');
  r = await anon.req('GET', '/robots.txt'); ck(/Disallow: \/admin\//.test(r.data) && /Sitemap: https:\/\/example.test/.test(r.data), 'robots.txt blocks admin');
  r = await anon.req('GET', '/llms.txt'); ck(/^# Driveaway Auto Finance/.test(r.data) && r.data.includes('Vehicles in stock'), 'llms.txt is generated');

  console.log('blog');
  r = await anon.req('GET', '/blog/'); ck(r.status === 200 && /<title>Used Car Tips and Guides/.test(r.data) && (r.data.match(/class="bc"/g) || []).length === 20, 'blog index lists 20 articles');
  const art = r.data.match(/href="(\/blog\/[a-z0-9-]+\/)"/)[1];
  r = await anon.req('GET', art); ck(r.status === 200 && /<h1>/.test(r.data) && /"@type":"BlogPosting"/.test(r.data) && /rel="canonical" href="[^"]+\/blog\//.test(r.data), 'article renders with BlogPosting JSON-LD and canonical');
  ck(/"@type":"FAQPage"/.test(r.data) && /data-page="blog\//.test(r.data), 'article has FAQ schema and its own page id');
  r = await anon.req('GET', '/blog/does-not-exist/'); ck(r.status === 404 && /noindex/.test(r.data), 'unknown article is a 404 noindex');
  r = await anon.req('GET', '/sitemap.xml'); ck((String(r.data).match(/\/blog\/[a-z0-9-]+\//g) || []).length >= 20 && String(r.data).includes('/blog/</loc>'), 'sitemap lists the blog index and all 20 articles');
  r = await anon.req('GET', '/llms.txt'); ck((r.data.match(/\/blog\/[a-z0-9-]+\//g) || []).length >= 20, 'llms.txt links every article');
  r = await anon.req('GET', '/llms-full.txt'); ck(/## Articles/.test(r.data) && r.data.includes('Used Car Financing With Bad Credit'), 'llms-full.txt carries article text');
  r = await anon.req('GET', '/'); ck(/From the blog/.test(r.data), 'home links to latest articles');
  r = await anon.req('GET', '/admin/'); ck(r.status === 200 && /noindex/.test(r.data) && r.headers.get('cache-control') === 'no-store', 'admin shell is noindex and not cached');
  r = await anon.req('GET', '/assets/../server/config.js'); ck(r.status === 404, 'path traversal blocked');
  r = await anon.req('GET', '/assets/%2e%2e/server/config.js'); ck(r.status === 404, 'encoded traversal blocked');
  r = await anon.req('GET', '/financing'); ck(r.status === 301 && r.headers.get('location') === '/financing/', 'trailing slash redirect');

  console.log('data access without login');
  r = await anon.req('GET', '/api/c/vehicles'); ck(r.status === 200 && r.data.length === 37, 'public sees 37 vehicles');
  r = await anon.req('GET', '/api/c/deals'); ck(r.status === 401, 'customers need login');
  r = await anon.req('GET', '/api/c/leads'); ck(r.status === 401, 'leads need login');
  r = await anon.req('PUT', '/api/c/vehicles/x1', { year: 2020 }); ck(r.status === 403, 'anonymous write rejected (no CSRF/session)');
  r = await anon.req('GET', '/api/users'); ck(r.status === 403 || r.status === 401, 'users list is private');
  r = await anon.req('GET', '/api/audit'); ck(r.status === 401, 'audit is private');

  console.log('authentication');
  r = await owner.login('boss@example.com', 'wrong'); ck(r.status === 401, 'wrong password rejected');
  r = await owner.login('nobody@example.com', 'x'); ck(r.status === 401 && r.data.error === 'Wrong email or password.', 'unknown user gets the same message');
  r = await owner.login('boss@example.com', 'Correct-Horse-9'); ck(r.status === 200 && r.data.user.role === 'owner', 'owner signs in');
  r = await new Client().req('POST', '/api/login', { email: 'boss@example.com', password: 'Correct-Horse-9' }, { headers: { Origin: 'https://evil.example' } }); ck(r.status === 403, 'cross-site login blocked');
  r = await owner.req('GET', '/api/me'); ck(r.data.user.email === 'boss@example.com' && !('pass' in r.data.user), 'me never exposes the password hash');
  const bad = new Client(); bad.csrf = 'nope'; bad.cookie = owner.cookie;
  r = await bad.req('PUT', '/api/c/vehicles/zz', { year: 2020, make: 'A', model: 'B', stock: 'zz' }); ck(r.status === 403, 'wrong CSRF token rejected');

  console.log('users and roles');
  r = await owner.req('POST', '/api/users', { name: 'Mia Manager', email: 'mia@example.com', role: 'manager', password: 'short' }); ck(r.status === 400, 'weak password refused');
  r = await owner.req('POST', '/api/users', { name: 'Mia Manager', email: 'mia@example.com', role: 'manager', password: 'Temp-Pass-12345' }); ck(r.status === 200, 'manager created');
  await owner.req('POST', '/api/users', { name: 'Sam Sales', email: 'sam@example.com', role: 'sales', password: 'Temp-Pass-12345' });
  await owner.req('POST', '/api/users', { name: 'Sue Sales', email: 'sue@example.com', role: 'sales', password: 'Temp-Pass-12345' });
  r = await mgr.login('mia@example.com', 'Temp-Pass-12345'); ck(r.status === 200 && r.data.user.mustChange, 'new users must change password');
  r = await mgr.req('GET', '/api/c/vehicles'); ck(r.status === 403, 'must-change blocks the API');
  r = await mgr.req('POST', '/api/me/password', { current: 'Temp-Pass-12345', password: 'Mia-New-Password-77' }); ck(r.status === 200, 'password changed');
  r = await mgr.req('GET', '/api/c/vehicles'); ck(r.status === 200, 'manager can work after changing password');
  for (const [c, e] of [[sales, 'sam@example.com'], [sales2, 'sue@example.com']]) { await c.login(e, 'Temp-Pass-12345'); await c.req('POST', '/api/me/password', { current: 'Temp-Pass-12345', password: 'Sales-New-Password-1' }); }
  r = await mgr.req('GET', '/api/users'); ck(r.status === 403, 'manager cannot list users');
  r = await mgr.req('POST', '/api/users', { name: 'X', email: 'x@example.com', role: 'owner', password: 'Temp-Pass-12345' }); ck(r.status === 403, 'manager cannot create users');
  r = await sales.req('GET', '/api/c/leads'); ck(r.status === 403, 'sales cannot read leads');
  r = await sales.req('PUT', '/api/c/vehicles/10016', { year: 2020, make: 'x', model: 'y', stock: '10016' }); ck(r.status === 403, 'sales cannot edit vehicles');
  r = await sales.req('GET', '/api/audit'); ck(r.status === 403, 'sales cannot read the audit log');

  console.log('vehicles');
  r = await mgr.req('PUT', '/api/c/vehicles/T100', { year: 2018, make: 'Honda', model: 'Civic', trim: 'EX', miles: 50000, price: 14500, body: 'Sedan', color: 'Red', stock: 'T100', status: 'draft', photos: [] }); ck(r.status === 200, 'manager adds a vehicle');
  r = await anon.req('GET', '/api/c/vehicles'); ck(!r.data.some(x => x.id === 'T100'), 'draft vehicle hidden from the public');
  r = await mgr.req('GET', '/api/c/vehicles'); ck(r.data.some(x => x.id === 'T100'), 'draft visible to staff');
  r = await mgr.req('PATCH', '/api/c/vehicles/T100', { status: 'available' }); ck(r.status === 200, 'publish vehicle');
  r = await anon.req('GET', '/cars/2018-honda-civic-ex-t100/'); ck(r.status === 200 && /Honda Civic/.test(r.data), 'new vehicle has its own live page immediately');
  r = await mgr.req('PUT', '/api/c/vehicles/T101', { year: 1800, make: 'A', model: 'B', stock: 'T101' }); ck(r.status === 400, 'invalid year rejected');
  r = await mgr.req('PUT', '/api/c/vehicles/T102', { year: 2020, make: 'A', model: 'B', stock: 'T102', photos: ['../../etc/passwd'] }); ck(r.status === 400, 'bad photo id rejected');
  r = await mgr.req('PUT', '/api/c/vehicles/T103', { year: 2020, make: '<img src=x onerror=alert(1)>', model: 'B', stock: 'T103' }); ck(r.status === 200 && !/<img src=x/.test((await anon.req('GET', '/cars/2020--img-src-x-onerror-alert-1--b-t103/')).data.replace(/&lt;img/g, '')), 'markup in vehicle names is escaped in pages');

  console.log('photos');
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  r = await mgr.req('POST', '/api/upload', png, { raw: true, headers: { 'Content-Type': 'application/octet-stream' } }); ck(r.status === 200 && r.data.id, 'manager uploads a photo');
  const bid = r.data.id; r = await anon.req('GET', '/_blob/' + bid); ck(r.status === 200 && /image\//.test(r.headers.get('content-type')) && /immutable/.test(r.headers.get('cache-control')), 'photo is served publicly and cached');
  r = await mgr.req('POST', '/api/upload', Buffer.from('<?php echo 1;'), { raw: true, headers: { 'Content-Type': 'application/octet-stream' } }); ck(r.status === 400, 'non-image upload rejected');
  r = await sales.req('POST', '/api/upload', png, { raw: true, headers: { 'Content-Type': 'application/octet-stream' } }); ck(r.status === 403, 'sales cannot upload');

  console.log('website requests (leads)');
  const lead = { kind: 'apply', name: 'Pat Buyer', phone: '219-555-0100', email: 'pat@example.com', vehicle: '2020 Chevrolet Colorado', down: '$500', t: Date.now() - 10000 };
  r = await anon.req('POST', '/api/lead', { ...lead, t: Date.now() }); ck(r.status === 429, 'form submitted instantly is refused (time trap)');
  r = await anon.req('POST', '/api/lead', { ...lead, hp: 'http://spam' }); ck(r.status === 200, 'honeypot answers OK');
  r = await mgr.req('GET', '/api/c/leads'); ck(r.data.length === 0, 'honeypot submission was not stored');
  r = await anon.req('POST', '/api/lead', lead); ck(r.status === 200, 'real request accepted');
  r = await anon.req('POST', '/api/lead', { ...lead, name: '', phone: '1' }); ck(r.status === 400, 'missing contact details refused');
  r = await mgr.req('GET', '/api/c/leads'); ck(r.data.length === 1 && r.data[0].data.name === 'Pat Buyer' && r.data[0].data.status === 'New', 'manager sees the request');
  for (let i = 0; i < 6; i++) await anon.req('POST', '/api/lead', lead);
  r = await anon.req('POST', '/api/lead', lead); ck(r.status === 429, 'rate limit stops a flood');

  console.log('CRM and sales isolation');
  r = await sales.req('PUT', '/api/c/deals/d1', { name: 'Sam Customer', stage: 'New lead', owner: 'Someone Else', fin: { price: 10000 } }); ck(r.status === 200 && r.data.data.owner === 'Sam Sales', 'sales deals are forced to their own name');
  r = await sales2.req('GET', '/api/c/deals'); ck(r.data.length === 0, 'other sales person cannot see it');
  r = await sales2.req('PATCH', '/api/c/deals/d1', { stage: 'Lost' }); ck(r.status === 404, 'other sales person cannot edit it');
  r = await sales2.req('DELETE', '/api/c/deals/d1'); ck(r.status === 403 || r.status === 404, 'sales cannot delete');
  r = await mgr.req('GET', '/api/c/deals'); ck(r.data.length === 1, 'manager sees all customers');
  r = await mgr.req('PUT', '/api/c/deals/d2', { name: 'X', stage: 'Not a stage' }); ck(r.status === 400, 'unknown stage rejected');
  r = await sales.req('GET', '/api/team'); ck(r.data.some(x => x.name === 'Sue Sales'), 'team list available for assignment');

  console.log('audit and backups');
  r = await owner.req('GET', '/api/audit?limit=200'); ck(r.data.some(a => a.action === 'vehicles.create') && r.data.some(a => a.action === 'login.fail') && r.data.some(a => a.action === 'deals.create'), 'audit log records edits and failed logins');
  ck(!JSON.stringify(r.data).includes('Correct-Horse') && !JSON.stringify(r.data).includes('Temp-Pass'), 'no passwords in the audit log');
  r = await owner.req('POST', '/api/backups', {}); ck(r.status === 200 && r.data.docs > 37, 'backup created');
  const bk = r.data.id;
  await mgr.req('DELETE', '/api/c/vehicles/T100');
  r = await owner.req('GET', '/api/backups/' + bk + '/download'); ck(r.status === 200 && r.data[0] === 0x1f, 'backup downloads as gzip');
  r = await mgr.req('GET', '/api/backups'); ck(r.status === 403, 'manager cannot see backups');
  r = await owner.req('POST', '/api/backups/' + bk + '/restore', { confirm: 'no' }); ck(r.status === 400, 'restore needs confirmation');
  r = await owner.req('POST', '/api/backups/' + bk + '/restore', { confirm: 'RESTORE' }); ck(r.status === 200, 'restore works');
  r = await anon.req('GET', '/api/c/vehicles'); ck(r.data.some(x => x.id === 'T100'), 'restored vehicle is back');

  console.log('account safety');
  r = await owner.req('PATCH', '/api/users/' + (await owner.req('GET', '/api/me')).data.user.id, { role: 'sales' }); ck(r.status === 400, 'owner cannot demote themselves');
  const users = (await owner.req('GET', '/api/users')).data, sam = users.find(u => u.email === 'sam@example.com');
  r = await owner.req('PATCH', '/api/users/' + sam.id, { active: false }); ck(r.status === 200, 'owner disables a user');
  r = await sales.req('GET', '/api/c/deals'); ck(r.status === 401, 'disabled user is signed out immediately');
  const lock = new Client(); for (let i = 0; i < 8; i++) await lock.login('sue@example.com', 'bad' + i);
  r = await lock.login('sue@example.com', 'Sales-New-Password-1'); ck(r.status === 423 || r.status === 429, 'repeated failures lock the account');
  r = await owner.req('POST', '/api/logout', {}); ck(r.status === 200, 'sign out'); r = await owner.req('GET', '/api/me'); ck(r.data.user === null, 'session is gone after sign out');

  console.log(`\n${pass} checks passed`);
  server.close(); fs.rmSync(tmp, { recursive: true, force: true }); process.exit(0);
})().catch(e => { console.error('\nFAILED:', e.message, e.stack.split('\n').slice(1, 3).join('\n')); process.exit(1); });
