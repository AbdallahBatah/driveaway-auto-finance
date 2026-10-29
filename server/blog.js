'use strict';
// Articles: markdown files in data/articles/*.md with a small front matter. Posts dated in the future stay hidden (scheduled publishing).
const fs = require('fs');
const path = require('path');
const cfg = require('./config');
const { esc } = require('./util');

const DIR = path.join(cfg.root, 'data', 'articles');
const IMGS = { 'slide-1': '/assets/img/slider/slide-1.webp', 'slide-2': '/assets/img/slider/slide-2.webp', 'slide-3': '/assets/img/slider/slide-3.webp', 'slide-4': '/assets/img/slider/slide-4.webp' };
const imgPath = k => IMGS[k] || (/^\d+$/.test(k || '') ? `/assets/img/vehicles/${k}.webp` : IMGS['slide-1']);

function inline(s) {
  return esc(s)
    .replace(/\[([^\]]+)\]\((\/[a-z0-9\-_\/#?=&]*)\)/gi, (m, t, u) => `<a href="${u}">${t}</a>`)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
}
const plain = s => s.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/\*\*/g, '');
const slugId = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function parse(file) {
  const raw = fs.readFileSync(path.join(DIR, file), 'utf8').replace(/\r/g, '');
  const m = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/); if (!m) return null;
  const a = {}; m[1].split('\n').forEach(l => { const i = l.indexOf(':'); if (i > 0) a[l.slice(0, i).trim()] = l.slice(i + 1).trim(); });
  if (!a.slug || !a.title || !/^[a-z0-9-]+$/.test(a.slug)) return null;
  const md = m[2].trim(), blocks = md.split(/\n{2,}/), out = [], toc = [], faq = []; let inFaq = false, q = null;
  for (const b of blocks) {
    const t = b.trim(); if (!t) continue;
    if (t.startsWith('## ')) { const h = t.slice(3); inFaq = /^frequently asked/i.test(h); toc.push([slugId(h), h]); out.push(`<h2 id="${slugId(h)}">${inline(h)}</h2>`); continue; }
    if (t.startsWith('### ')) { const h = t.slice(4); if (inFaq) q = h; out.push(`<h3>${inline(h)}</h3>`); continue; }
    if (/^(- |\d+\. )/.test(t)) { const ol = /^\d+\./.test(t); out.push(`<${ol ? 'ol' : 'ul'}>${t.split('\n').map(l => `<li>${inline(l.replace(/^(- |\d+\. )/, ''))}</li>`).join('')}</${ol ? 'ol' : 'ul'}>`); continue; }
    if (t.startsWith('|')) {
      const rows = t.split('\n').filter(l => !/^\|[\s|:-]+\|?$/.test(l)).map(l => l.replace(/^\||\|$/g, '').split('|').map(c => c.trim()));
      out.push(`<div class="atw"><table><thead><tr>${rows[0].map(c => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${rows.slice(1).map(r => `<tr>${r.map(c => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`); continue;
    }
    if (t.startsWith('> ')) { out.push(`<blockquote>${inline(t.replace(/^> ?/gm, ''))}</blockquote>`); continue; }
    out.push(`<p>${inline(t.replace(/\n/g, ' '))}</p>`);
    if (inFaq && q) { faq.push([q, plain(t.replace(/\n/g, ' '))]); q = null; }
  }
  const words = plain(md).split(/\s+/).length;
  return { slug: a.slug, title: a.title, description: a.description || '', category: a.category || 'Guides', date: a.date || '2026-10-29', image: a.image || 'slide-1', related: (a.related || '').split(',').map(x => x.trim()).filter(Boolean),
    html: out.join('\n'), toc, faq, md, words, mins: Math.max(2, Math.round(words / 220)) };
}
let CACHE = null, STAMP = 0;
function all() {
  const st = fs.existsSync(DIR) ? fs.readdirSync(DIR).map(f => f + fs.statSync(path.join(DIR, f)).mtimeMs).join() : '';
  if (CACHE && st === STAMP) return CACHE;
  const today = new Date().toISOString().slice(0, 10);
  CACHE = fs.existsSync(DIR) ? fs.readdirSync(DIR).filter(f => f.endsWith('.md')).map(f => { try { return parse(f); } catch (e) { return null; } }).filter(Boolean).filter(p => p.date <= today).sort((x, y) => y.date.localeCompare(x.date) || x.slug.localeCompare(y.slug)) : [];
  STAMP = st; return CACHE;
}
const get = s => all().find(p => p.slug === s) || null;
const fmt = d => new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const url = p => `/blog/${p.slug}/`;

const card = p => `<a class="bc" href="${url(p)}"><span class="bi" style="background-image:url(${imgPath(p.image)})" role="img" aria-label="${esc(p.title)}"></span><span class="bb"><small>${esc(p.category)} · ${p.mins} min read</small><b>${esc(p.title)}</b><span>${esc(p.description)}</span></span></a>`;

function listHtml(cat) {
  const ps = all(), cats = [...new Set(ps.map(p => p.category))].sort();
  return `<div class="pg"><div class="wrap"><h1>Used car tips and guides</h1><p>Practical advice on buying, financing and owning a used car in Northwest Indiana, written by the team at Driveaway Auto Finance in Hobart.</p></div></div>
<div class="sec"><div class="wrap"><nav class="bcats" aria-label="Article categories">${cats.map(c => `<span class="chip">${esc(c)}</span>`).join('')}</nav><div class="bg">${ps.map(card).join('')}</div></div></div>`;
}
function relatedOf(p) {
  const ps = all().filter(x => x.slug !== p.slug), pick = [];
  p.related.forEach(s => { const x = ps.find(y => y.slug === s); if (x) pick.push(x); });
  ps.filter(x => x.category === p.category && !pick.includes(x)).forEach(x => pick.push(x));
  ps.forEach(x => { if (!pick.includes(x)) pick.push(x); });
  return pick.slice(0, 3);
}
function postHtml(p, S) {
  const rel = relatedOf(p);
  return `<article class="wrap art"><nav class="crumb" aria-label="Breadcrumb"><a href="/">Home</a> › <a href="/blog/">Blog</a> › <span>${esc(p.title)}</span></nav>
<div class="ahd"><small class="ak">${esc(p.category)} · ${p.mins} min read</small><h1>${esc(p.title)}</h1><p class="al">${esc(p.description)}</p><p class="amt">By the ${esc(S.name)} team · <time datetime="${p.date}">${fmt(p.date)}</time></p></div>
<div class="ah" role="img" aria-label="${esc(p.title)}" style="background-image:url(${imgPath(p.image)})"></div>
<div class="ab">${p.html}
<aside class="acta"><h2>Ready to look at real cars?</h2><p>Browse what is on the lot in Hobart, or send a quick application and a person will call you back. Questions? Call <a href="tel:${S.tel}">${S.phone}</a>.</p><p><a class="btn" href="/inventory/">Browse inventory</a> <a class="btn o" href="/financing/">Apply for financing</a></p></aside></div>
<section class="arel"><h2>Keep reading</h2><div class="bg">${rel.map(card).join('')}</div></section></article>`;
}
function homeHtml() {
  const ps = all().slice(0, 3); if (!ps.length) return '';
  return `<div class="sec"><div class="wrap"><h2>From the blog</h2><p class="sub">Straight answers on buying, financing and keeping a used car.</p><div class="bg">${ps.map(card).join('')}</div><p style="margin-top:22px"><a class="btn o" href="/blog/">All articles</a></p></div></div>`;
}
function ld(p, base, S) {
  const u = base + url(p), im = base + imgPath(p.image), pub = { '@id': base + '/#dealer' };
  const g = [{ '@context': 'https://schema.org', '@type': 'BlogPosting', '@id': u + '#article', headline: p.title.slice(0, 110), description: p.description, image: [im], datePublished: p.date, dateModified: p.date, inLanguage: 'en-US',
    mainEntityOfPage: u, articleSection: p.category, wordCount: p.words, author: { '@type': 'Organization', name: S.name, url: base + '/' }, publisher: pub },
  { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [['Home', base + '/'], ['Blog', base + '/blog/'], [p.title, u]].map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: c[0], item: c[1] })) }];
  if (p.faq.length) g.push({ '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: p.faq.map(f => ({ '@type': 'Question', name: f[0], acceptedAnswer: { '@type': 'Answer', text: f[1] } })) });
  return g;
}
module.exports = { all, get, url, listHtml, postHtml, homeHtml, ld, imgPath, fmt };
