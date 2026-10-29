'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const cfg = require('./config');
const store = require('./store');
const seo = require('./seo');
const blog = require('./blog');
const { esc } = require('./util');

const SRC = path.join(cfg.root, 'src');
const read = f => fs.readFileSync(path.join(SRC, f), 'utf8');
let TPL, VER = '';
function load() {
  TPL = read('index.html');
  const h = crypto.createHash('sha1');
  ['styles.css', 'app.js', 'shim.js', 'admin-extra.js'].forEach(f => { try { h.update(fs.readFileSync(path.join(SRC, f))); } catch (e) {} });
  VER = h.digest('hex').slice(0, 8);
}
load();
if (!cfg.production) fs.watch(SRC, { recursive: true }, () => { try { load(); } catch (e) {} });

const imgFor = v => (fs.existsSync(path.join(SRC, 'assets/img/vehicles', String(v.stock).replace(/[^\w-]/g, '') + '.webp')) ? `/assets/img/vehicles/${String(v.stock).replace(/[^\w-]/g, '')}.webp` : '/assets/img/logo.png');
const origin = req => cfg.siteUrl || `${(cfg.trustProxy && req.headers['x-forwarded-proto']) || (req.socket.encrypted ? 'https' : 'http')}://${req.headers.host}`;

function route(p) {
  p = p.replace(/\/+$/, '') || '/';
  if (p === '/') return { id: 'home' };
  const m = p.match(/^\/cars\/([a-z0-9-]{1,200})$/); if (m) return { id: 'car', slug: m[1] };
  const bm = p.match(/^\/blog\/([a-z0-9-]{1,120})$/); if (bm) return { id: 'post', slug: bm[1] };
  const k = p.slice(1);
  if (seo.PATHS[k] && p !== '/') return { id: k };
  if (k === 'login') return { id: 'login', noindex: true };
  if (k === 'admin' || /^admin\/[a-z-]+$/.test(k)) return { id: 'admin', noindex: true };
  return null;
}
const jsEsc = o => JSON.stringify(o).replace(/</g, '\\u003c').split(String.fromCharCode(0x2028)).join('\\u2028').split(String.fromCharCode(0x2029)).join('\\u2029');

async function render(req, pathname, nonce) {
  const r = route(pathname); if (!r) return null;
  const base = origin(req), cars = await store.publicVehicles();
  let v = null, notFound = false, status = 200, post = null;
  if (r.id === 'post') { post = blog.get(r.slug); if (!post) { notFound = true; status = 404; } }
  if (r.id === 'car') { v = cars.find(c => seo.slug(c) === r.slug) || null; if (!v) { notFound = true; status = 404; } }
  const head = seo.headTags({ base, id: v ? 'car/' + r.slug : r.id === 'post' ? 'blog' : r.id, v, cars, noindex: r.noindex, notFound, imgFor, post: post && { title: post.title, description: post.description, slug: post.slug, img: blog.imgPath(post.image), ld: blog.ld(post, base, seo.SITE) } });
  const pageId = r.id === 'post' ? 'blog/' + r.slug : r.id === 'car' ? 'car/' + r.slug : r.id;
  const inline = `<script nonce="${nonce}">window.SERVER_MODE=true;window.SITE_BASE=${jsEsc(base)};window.TURNSTILE_SITE_KEY=${jsEsc(cfg.turnstileSite)};window.VEHICLES_JSON=${jsEsc(cars)};window.INITIAL_ROUTE=${jsEsc(pageId)};</script>`;
  let carHtml = '';
  if (r.id === 'car') carHtml = v ? seo.carBody(v, cars, imgFor) : `<div class="cp-nf"><h1>That vehicle is no longer listed</h1><p>It may have sold. Here is what is on the lot right now.</p><p><a class="btn" href="/inventory/">Browse inventory</a> <a class="btn o" href="tel:${seo.SITE.tel}">Call ${seo.SITE.phone}</a></p></div>`;
  const blogHtml = r.id === 'blog' ? blog.listHtml() : '';
  const postHtml = r.id === 'post' ? (post ? blog.postHtml(post, seo.SITE) : `<div class="wrap cp"><div class="cp-nf"><h1>We could not find that article</h1><p><a class="btn" href="/blog/">All articles</a> <a class="btn o" href="/inventory/">Browse inventory</a></p></div></div>`) : '';
  const links = r.id === 'inventory' ? `<noscript><nav aria-label="All vehicles"><ul>${cars.filter(c => c.status === 'available').map(c => `<li><a href="/cars/${seo.slug(c)}/">${esc(seo.vt(c))}${c.price ? ' – $' + Number(c.price).toLocaleString('en-US') : ''}</a></li>`).join('')}</ul></nav></noscript>` : '';
  let html = TPL
    .replace(/<!--SEOD-->[\s\S]*?<!--\/SEOD-->/, '')
    .replace('<!--SEO-->', () => head)
    .replace('<!--DATA-->', () => inline)
    .replace('<!--CAR-->', () => carHtml)
    .replace('<!--LINKS-->', () => links)
    .replace('<!--BLOG-->', () => blogHtml)
    .replace('<!--POST-->', () => postHtml)
    .replace('<!--HOMEBLOG-->', () => (r.id === 'home' ? blog.homeHtml() : ''))
    .replace(/<body([^>]*)>/, (m, a) => `<body${a} data-page="${esc(pageId)}">`)
    .replace(/<script src="app\.js"><\/script>/, () => ['shim', 'app', 'admin-extra'].map(n => `<script src="/assets/${n}.js?v=${VER}"></script>`).join(''))
    .replace('href="styles.css"', () => `href="/assets/styles.css?v=${VER}"`)
    .replace(/(["(])assets\/img\//g, '$1/assets/img/');
  // real, crawlable internal links instead of #hash routes
  html = html.replace(/<a\s[^>]*>/g, t => (/\sdata-[fmp]=/.test(t) ? t : t.replace(/href="#([^"]*)"/, (x, k) => {
    if (seo.PATHS[k]) return `href="${seo.PATHS[k]}"`; if (k === 'login') return 'href="/login/"';
    if (k === 'admin') return 'href="/admin/"'; if (/^admin-/.test(k)) return `href="/admin/${k.slice(6)}/"`; if (k.startsWith('car/')) return `href="/cars/${k.slice(4)}/"`; return x;
  })));
  return { html, status, noindex: !!r.noindex || notFound };
}

async function sitemap(req) {
  const base = origin(req), cars = (await store.publicVehicles()).filter(c => c.status === 'available'), today = new Date().toISOString().slice(0, 10);
  const u = (p, pr, cf, img) => `<url><loc>${base}${p}</loc><lastmod>${today}</lastmod><changefreq>${cf}</changefreq><priority>${pr}</priority>${img ? `<image:image><image:loc>${base}${esc(img)}</image:loc></image:image>` : ''}</url>`;
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">\n` +
    Object.entries(seo.PATHS).map(([k, p]) => u(p, p === '/' ? '1.0' : p === '/inventory/' ? '0.9' : '0.7', ['/', '/inventory/'].includes(p) ? 'daily' : 'weekly')).join('\n') + '\n' +
    blog.all().map(p => `<url><loc>${base}${blog.url(p)}</loc><lastmod>${p.date}</lastmod><changefreq>monthly</changefreq><priority>0.6</priority><image:image><image:loc>${base}${blog.imgPath(p.image)}</image:loc></image:image></url>`).join('\n') + '\n' +
    cars.map(c => u(`/cars/${seo.slug(c)}/`, '0.8', 'weekly', (c.photos || []).length ? '/_blob/' + c.photos[0] : imgFor(c))).join('\n') + '\n</urlset>\n';
}
const robots = req => `User-agent: *\nAllow: /\nDisallow: /admin/\nDisallow: /login/\nDisallow: /api/\n\nSitemap: ${origin(req)}/sitemap.xml\n`;
async function llms(req, full) {
  const base = origin(req), cars = (await store.publicVehicles()).filter(c => c.status === 'available'), S = seo.SITE;
  const about = `${S.name} is an independent used-car dealership with in-house financing at ${S.street}, ${S.city}, ${S.region} ${S.zip} (Lake County, northwest Indiana). Phone ${S.phone}. It sells used sedans, SUVs, trucks and minivans, buys and takes trade-ins on vehicles, and helps customers with limited or damaged credit find financing. Prices exclude taxes and fees and may change without notice; approval and terms depend on the customer's income, credit and the vehicle.`;
  const price = c => (c.price ? '$' + Number(c.price).toLocaleString('en-US') : 'call for price');
  let t = `# ${S.name}\n\n> ${about}\n\n`;
  if (!full) {
    t += '## Key pages\n\n' + [['Inventory', '/inventory/', 'All used vehicles currently for sale'], ['Financing', '/financing/', 'Quick application and payment calculator'], ['Sell or trade', '/sell/', 'How selling or trading in a vehicle works'], ['Car finder', '/finder/', 'Describe the car you want and we search for it'], ['Visit us', '/visit/', 'Address, phone, what to bring'], ['Reviews', '/reviews/', 'Highlights from customer reviews'], ['Blog', '/blog/', 'Used car buying, financing and ownership guides']].map(x => `- [${x[0]}](${base}${x[1]}): ${x[2]}`).join('\n');
    t += `\n\n## Vehicles in stock (${cars.length})\n\n` + cars.map(c => `- [${seo.vt(c).replace(/[\[\]]/g, '')}](${base}/cars/${seo.slug(c)}/): ${price(c)}, ${Number(c.miles || 0).toLocaleString('en-US')} miles, ${c.color}, ${c.body}. Stock ${c.stock}.`).join('\n');
    t += `\n\n## Articles (${blog.all().length})\n\n` + blog.all().map(p => `- [${p.title.replace(/[\[\]]/g, '')}](${base}${blog.url(p)}): ${p.description}`).join('\n');
    t += `\n\n## Optional\n\n- [Full inventory details](${base}/llms-full.txt)\n- [Sitemap](${base}/sitemap.xml)\n`;
  } else {
    t += `Last updated: ${new Date().toISOString().slice(0, 10)}\n\n## Contact\n\n${S.name}, ${S.street}, ${S.city}, ${S.region} ${S.zip}. Phone ${S.phone}. Map: ${S.map}\n\n## Inventory\n\n`;
    cars.forEach(c => { t += `### ${seo.vt(c)}\n- URL: ${base}/cars/${seo.slug(c)}/\n- Price: ${price(c)}\n- Mileage: ${Number(c.miles || 0).toLocaleString('en-US')} miles\n- Body style: ${c.body}\n- Exterior color: ${c.color}\n${c.drive ? '- Drive: ' + c.drive + '\n' : ''}${c.trans ? '- Transmission: ' + c.trans + '\n' : ''}${c.engine ? '- Engine: ' + c.engine + '\n' : ''}- Stock number: ${c.stock}\n- Condition: Used\n\n`; });
  }
  if (full) t += `## Articles\n\n` + blog.all().map(p => `### ${p.title}\n- URL: ${base}${blog.url(p)}\n- Category: ${p.category}\n- Published: ${p.date}\n\n${p.md}\n`).join('\n');
  return t;
}
const MIME = { '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8' };
function asset(rel) {
  const p = path.normalize(path.join(SRC, rel === 'styles.css' || /^(app|shim|admin-extra)\.js$/.test(rel) ? rel : path.join('assets', rel)));
  if (!p.startsWith(SRC + path.sep) || !/\.(js|css|webp|png|jpg|svg)$/.test(p)) return null;
  try { const st = fs.statSync(p); if (!st.isFile()) return null; return { file: p, size: st.size, type: MIME[path.extname(p)] || 'application/octet-stream' }; } catch (e) { return null; }
}
module.exports = { render, sitemap, robots, llms, asset, route, imgFor };
