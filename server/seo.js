'use strict';
// Server-side SEO: titles, descriptions, canonical, Open Graph, JSON-LD. Mirrors the client logic in src/app.js.
const { esc } = require('./util');
const SITE = { name: 'Driveaway Auto Finance', phone: '219-945-3136', tel: '+12199453136', street: '2333 W 37th Ave', city: 'Hobart', region: 'IN', zip: '46342',
  map: 'https://www.google.com/maps/place/Driveaway+Auto+Finance/data=!4m2!3m1!1s0x0:0x4d325bdfe1317fba' };
const PATHS = { home: '/', inventory: '/inventory/', financing: '/financing/', sell: '/sell/', finder: '/finder/', visit: '/visit/', reviews: '/reviews/', privacy: '/privacy/', terms: '/terms/' };
const NAMES = { inventory: 'Inventory', financing: 'Financing', sell: 'Sell or trade', finder: 'Car finder', visit: 'Visit us', reviews: 'Reviews', privacy: 'Privacy policy', terms: 'Terms of service' };
const META = {
  home: ['Used Cars in Hobart, IN | Driveaway Auto Finance', 'Used cars, trucks and SUVs in Hobart, Indiana, with financing built around your budget. Browse the lot online, compare up to three vehicles and apply in minutes.'],
  inventory: ['Used Cars for Sale in Hobart, IN | Driveaway Auto Finance', 'Browse used sedans, SUVs, trucks and minivans on our Hobart, Indiana lot. Filter by style, price and brand, compare up to three cars and see an estimated monthly payment.'],
  financing: ['Auto Financing in Hobart, IN | Driveaway Auto Finance', 'Send a quick application and a real person calls you back. Financing for used cars in Hobart, Indiana, with a payment calculator and options for tougher credit.'],
  sell: ['Sell or Trade Your Car in Hobart, IN | Driveaway Auto Finance', 'We buy cars in Hobart, Indiana. Get an offer in cash or as trade-in credit toward your next vehicle. Tell us the VIN and mileage and we will take it from there.'],
  finder: ['Car Finder and Locator in Hobart, IN | Driveaway Auto Finance', 'Tell us your budget and what you drive. Our car finder shows matches on the lot, and if nothing fits we search for the car you want.'],
  visit: ['Visit Us: 2333 W 37th Ave, Hobart, IN | Driveaway Auto Finance', 'Find Driveaway Auto Finance at 2333 W 37th Ave, Hobart, IN 46342. Call 219-945-3136, see what to bring and plan your test drive.'],
  reviews: ['Customer Reviews | Driveaway Auto Finance, Hobart, IN', 'Read what recent customers say about buying a used car at Driveaway Auto Finance in Hobart, Indiana, from fast approvals to friendly, patient staff.'],
  privacy: ['Privacy Policy | Driveaway Auto Finance', 'How Driveaway Auto Finance collects, uses and protects the information you share through this website.'],
  terms: ['Terms of Service | Driveaway Auto Finance', 'The terms that apply to using the Driveaway Auto Finance website, vehicle listings and online forms.'],
  admin: ['Staff dashboard | Driveaway Auto Finance', ''], login: ['Staff sign in | Driveaway Auto Finance', ''],
  notfound: ['Vehicle not found | Driveaway Auto Finance', 'This vehicle is no longer listed. Browse our current used cars in Hobart, Indiana.']
};
const slug = v => [v.year, v.make, v.model, v.trim, v.stock].join(' ').toLowerCase().replace(/&amp;/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const vt = v => `${v.year} ${v.make} ${v.model} ${v.trim || ''}`.replace(/\s+/g, ' ').trim();
const money = n => '$' + Number(n).toLocaleString('en-US');
const clip = (s, n) => (s.length <= n ? s : s.slice(0, n - 1).replace(/[\s,.;:–-]+\S*$/, '') + '…');
const an = s => (/^[aeiou]/i.test(s) ? 'an ' : 'a ');
const photos = v => (v.photos || []).map(p => '/_blob/' + p);

function carMeta(v) {
  const t = vt(v), p = v.price ? money(v.price) : '', N = SITE.name;
  const T = [`${t} for Sale in Hobart, IN | ${N}`, `${t} for Sale | ${N}`, `${t} | ${N}`, `${t} | Hobart, IN`].find(x => x.length <= 66) || clip(`${t} | ${N}`, 66);
  const base = `${t}: ${Number(v.miles || 0).toLocaleString('en-US')} miles, ${String(v.color || '').toLowerCase()}`, tail = `${p ? '. ' + p : ''}. Stock ${v.stock} at ${N} in ${SITE.city}, ${SITE.region}. Call ${SITE.phone}.`;
  let mid = ''; [v.drive, v.trans && v.trans.toLowerCase()].filter(Boolean).forEach(x => { if ((base + mid + ', ' + x + tail).length <= 158) mid += ', ' + x; });
  return [T, clip(base + mid + tail, 158)];
}
function graph(base, id, v, cars, imgFor) {
  const abs = p => (p ? (/^https?:/.test(p) ? p : base + p) : undefined);
  const dealer = { '@context': 'https://schema.org', '@graph': [
    { '@type': ['AutoDealer', 'LocalBusiness'], '@id': base + '/#dealer', name: SITE.name, url: base + '/', telephone: SITE.tel, image: abs('/assets/img/slider/slide-1.webp'), logo: abs('/assets/img/logo.png'),
      address: { '@type': 'PostalAddress', streetAddress: SITE.street, addressLocality: SITE.city, addressRegion: SITE.region, postalCode: SITE.zip, addressCountry: 'US' }, hasMap: SITE.map,
      areaServed: ['Hobart', 'Merrillville', 'Portage', 'Crown Point', 'Gary'].map(n => ({ '@type': 'City', name: n })) },
    { '@type': 'WebSite', '@id': base + '/#website', url: base + '/', name: SITE.name, inLanguage: 'en-US', publisher: { '@id': base + '/#dealer' } }] };
  const crumbs = [['Home', base + '/']];
  if (id === 'inventory' || v) crumbs.push(['Inventory', base + PATHS.inventory]);
  if (v) crumbs.push([vt(v), `${base}/cars/${slug(v)}/`]); else if (NAMES[id] && id !== 'inventory') crumbs.push([NAMES[id], base + PATHS[id]]);
  const page = [{ '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: crumbs.map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: c[0], item: c[1] })) }];
  if (v) {
    const url = `${base}/cars/${slug(v)}/`, im = photos(v).map(abs).concat(photos(v).length ? [] : [abs(imgFor(v))]).filter(Boolean);
    page.push({ '@context': 'https://schema.org', '@type': 'Car', '@id': url + '#vehicle', name: vt(v), url, sku: String(v.stock), image: im.length ? im : undefined, brand: { '@type': 'Brand', name: v.make }, model: v.model,
      vehicleModelDate: String(v.year), bodyType: v.body, color: v.color, vehicleIdentificationNumber: v.vin || undefined, vehicleEngine: v.engine ? { '@type': 'EngineSpecification', name: v.engine } : undefined,
      vehicleTransmission: v.trans || undefined, driveWheelConfiguration: v.drive || undefined, mileageFromOdometer: { '@type': 'QuantitativeValue', value: v.miles, unitCode: 'SMI' }, itemCondition: 'https://schema.org/UsedCondition',
      offers: v.price ? { '@type': 'Offer', price: v.price, priceCurrency: 'USD', availability: v.status === 'sold' ? 'https://schema.org/SoldOut' : 'https://schema.org/InStock', itemCondition: 'https://schema.org/UsedCondition', url, seller: { '@id': base + '/#dealer' } } : undefined });
  }
  if (id === 'inventory') page.push({ '@context': 'https://schema.org', '@type': 'ItemList', name: 'Used cars for sale in Hobart, IN', itemListElement: cars.filter(c => c.status === 'available').map((x, i) => ({ '@type': 'ListItem', position: i + 1, url: `${base}/cars/${slug(x)}/`, name: vt(x) })) });
  return [dealer, page];
}
const ldTag = (id, o) => `<script type="application/ld+json" id="${id}">${JSON.stringify(o).replace(/</g, '\\u003c')}</script>`;
function headTags({ base, id, v, cars, noindex, notFound, imgFor }) {
  let m = META[id] || META.home, type = 'website', robots = 'index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1';
  if (v) { m = carMeta(v); type = 'product'; }
  if (notFound) { m = META.notfound; robots = 'noindex,follow'; }
  if (noindex) robots = 'noindex,nofollow';
  const canon = notFound || noindex ? '' : base + (v ? `/cars/${slug(v)}/` : PATHS[id] || '/');
  const img = base + (v ? (photos(v)[0] || imgFor(v)) : '/assets/img/slider/slide-1.webp');
  const [site, page] = noindex || notFound ? [null, null] : graph(base, id, v, cars, imgFor);
  const alt = v ? vt(v) + ' for sale in Hobart, IN' : SITE.name + ' used car dealership in Hobart, IN';
  return [`<title>${esc(m[0])}</title>`, `<meta name="description" content="${esc(m[1])}">`, `<meta name="robots" content="${robots}">`,
    canon ? `<link rel="canonical" href="${esc(canon)}">` : '<link rel="canonical">',
    `<meta property="og:site_name" content="${SITE.name}"><meta property="og:locale" content="en_US"><meta property="og:type" content="${type}">`,
    `<meta property="og:title" content="${esc(m[0])}"><meta property="og:description" content="${esc(m[1])}"><meta property="og:url" content="${esc(canon)}"><meta property="og:image" content="${esc(img)}"><meta property="og:image:alt" content="${esc(alt)}">`,
    `<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${esc(m[0])}"><meta name="twitter:description" content="${esc(m[1])}"><meta name="twitter:image" content="${esc(img)}">`,
    `<script type="application/ld+json" id="ld-site">${site ? JSON.stringify(site).replace(/</g, '\\u003c') : ''}</script><script type="application/ld+json" id="ld-page">${page ? JSON.stringify(page).replace(/</g, '\\u003c') : ''}</script>`].join('\n');
}
function carBody(v, cars, imgFor) {
  const t = vt(v), sold = v.status === 'sold', ph = photos(v)[0] || imgFor(v);
  const sp = [['Year', v.year], ['Make', v.make], ['Model', v.model], ['Trim', v.trim], ['Mileage', Number(v.miles || 0).toLocaleString('en-US') + ' miles'], ['Body style', v.body], ['Exterior color', v.color], ['Drive', v.drive], ['Engine', v.engine], ['Transmission', v.trans], ['Stock number', v.stock], ['VIN', v.vin]].filter(x => x[1]);
  const about = `This ${v.year} ${v.make} ${v.model}${v.trim ? ' ' + v.trim : ''} is a used ${String(v.body || 'vehicle').toLowerCase()} in ${String(v.color || '').toLowerCase()} on our lot in Hobart, Indiana. It has ${Number(v.miles || 0).toLocaleString('en-US')} miles${v.drive ? ', ' + v.drive + ' drive' : ''}${v.engine ? ' and a ' + v.engine + ' engine' : ''}${v.trans ? ' with ' + an(v.trans) + v.trans.toLowerCase() + ' transmission' : ''}.${v.price ? ' It is priced at ' + money(v.price) + '.' : ' Call us for current pricing.'}${v.desc ? ' ' + v.desc : ''}`;
  return `<nav class="crumb" aria-label="Breadcrumb"><a href="/">Home</a> › <a href="/inventory/">Inventory</a> › <span>${esc(t)}</span></nav><div class="cp-g"><div><div class="cp-m" role="img" aria-label="${esc(t)}" style="background-image:url(${esc(ph)})">${sold ? '<span class="cp-s">Sold</span>' : ''}</div></div><div><h1>${esc(t)} for sale in Hobart, IN</h1><div class="pr">${sold ? 'Sold' : v.price ? money(v.price) : 'Call for price'}</div><p class="cp-b"><a class="btn" href="/financing/">Apply for this car</a> <a class="btn o" href="tel:${SITE.tel}">Call ${SITE.phone}</a></p><dl class="cp-d">${sp.map(x => `<dt>${esc(x[0])}</dt><dd>${esc(x[1])}</dd>`).join('')}</dl></div></div><div class="cp-tx"><h2>About this ${esc(v.model)}</h2><p>${esc(about)}</p><h2>See it in person</h2><p>Visit us at ${SITE.street}, ${SITE.city}, ${SITE.region} ${SITE.zip}, or call <a href="tel:${SITE.tel}">${SITE.phone}</a> and ask for stock number ${esc(v.stock)}. Prices exclude taxes and fees and may change without notice.</p></div>`;
}
module.exports = { SITE, PATHS, META, slug, vt, headTags, carBody, carMeta };
