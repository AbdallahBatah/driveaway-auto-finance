#!/usr/bin/env python3
"""Pre-render the site into crawlable static pages (one URL per page and per vehicle).

    pip install playwright && playwright install chromium
    python3 tools/build_static.py

Reads site.config.json (base_url, out_dir, custom_domain), the sources in src/ and,
optionally, data/vehicles.json (exported from Admin > Vehicles) and data/photos/<stock>.webp|jpg|png.
Writes the static site to out_dir: pages, assets, sitemap.xml, robots.txt, 404.html.
"""
import json, re, shutil, sys, threading, datetime, http.server, socketserver, functools, pathlib
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright

R = pathlib.Path(__file__).resolve().parent.parent
cfg = json.loads((R / "site.config.json").read_text())
BASE = cfg["base_url"].rstrip("/")
PREFIX = urlparse(BASE).path.rstrip("/")
OUT = R / cfg.get("out_dir", "docs")
TMP = R / ".build"
PAGES = {"home": "/", "inventory": "/inventory/", "financing": "/financing/", "sell": "/sell/",
         "finder": "/finder/", "visit": "/visit/", "reviews": "/reviews/", "privacy": "/privacy/", "terms": "/terms/"}

# 1. working copy served under the same path prefix as production
site = TMP / PREFIX.lstrip("/")
if TMP.exists(): shutil.rmtree(TMP)
(site / "assets").mkdir(parents=True)
shutil.copytree(R / "src" / "assets" / "img", site / "assets" / "img")
shutil.copy(R / "src" / "styles.css", site / "assets" / "styles.css")
shutil.copy(R / "src" / "app.js", site / "assets" / "app.js")
extra_img = {}
for f in sorted((R / "data" / "photos").glob("*")):
    if f.suffix.lower() in (".webp", ".jpg", ".jpeg", ".png"):
        shutil.copy(f, site / "assets" / "img" / "vehicles" / f.name)
        extra_img[f.stem.split("_")[0]] = f"{PREFIX}/assets/img/vehicles/{f.name}"
html = (R / "src" / "index.html").read_text(encoding="utf-8")
html = html.replace("assets/img/", f"{PREFIX}/assets/img/")
inject = f'<meta name="site-base" content="{BASE}"><link rel="icon" type="image/png" href="{PREFIX}/assets/img/logo.png"><link rel="apple-touch-icon" href="{PREFIX}/assets/img/logo.png"><script>window.ASSET_BASE="{PREFIX}/";window.IMG_EXTRA={json.dumps(extra_img)};'
vj = R / "data" / "vehicles.json"
if vj.exists():
    inject += "window.VEHICLES_JSON=" + json.dumps(json.loads(vj.read_text(encoding="utf-8")), separators=(",", ":")) + ";"
inject += "</script>"
html = html.replace("<title>", inject + "<title>", 1)
html = html.replace('<link rel="stylesheet" href="styles.css">', f'<link rel="stylesheet" href="{PREFIX}/assets/styles.css">')
html = html.replace('<script src="app.js"></script>', f'<script src="{PREFIX}/assets/app.js"></script>')
(site / "index.html").write_text(html, encoding="utf-8")

# 2. serve it and render every page
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = socketserver.TCPServer(("127.0.0.1", 0), functools.partial(Q, directory=str(TMP)))
port = srv.server_address[1]
threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = f"http://127.0.0.1:{port}{PREFIX}/index.html"

def fix_links(h, slugs):
    def a(m):
        t = m.group(0)
        if re.search(r"\sdata-[fmp]=", t): return t
        def hr(x):
            k = x.group(1)
            if k in PAGES: return f'href="{PREFIX}{PAGES[k]}"'
            if k.startswith("car/"): return f'href="{PREFIX}/cars/{k[4:]}/"'
            return x.group(0)
        return re.sub(r'href="#([^"]*)"', hr, t)
    return re.sub(r"<a\s[^>]*>", a, h)

def write(path, content):
    p = OUT / path.strip("/") / "index.html" if path != "/404.html" else OUT / "404.html"
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(content, encoding="utf-8")

if OUT.exists(): shutil.rmtree(OUT)
OUT.mkdir(parents=True)
with sync_playwright() as pw:
    br = pw.chromium.launch()
    pg = br.new_page(viewport={"width": 1300, "height": 900})
    errs = []
    pg.on("pageerror", lambda e: errs.append(pg.url.split("#")[-1] + " " + str(e) + " " + (getattr(e, "stack", "") or "")[:250]))
    pg.goto(URL + "#home"); pg.wait_for_timeout(500)
    cars = pg.evaluate("AV().map(v=>({slug:slug(v),stock:v[8],img:(v[9][0]||IMG[v[8]]||'')}))")
    def snap(hashid, pid):
        pg.goto("about:blank"); pg.goto(URL + "#" + hashid); pg.wait_for_timeout(450)
        h = pg.content()
        h = re.sub(r"<body([^>]*)>", lambda m: f'<body{m.group(1)} data-page="{pid}">', h, count=1)
        return fix_links(h, cars)
    n = 0
    for k, path in PAGES.items():
        write(path, snap(k, k)); n += 1
    for c in cars:
        write(f"/cars/{c['slug']}/", snap("car/" + c["slug"], "car/" + c["slug"])); n += 1
    write("/404.html", snap("car/none", "car/none"))
    br.close()
if errs: print("page errors:", errs[:3])

# 3. assets, sitemap, robots
shutil.copytree(site / "assets", OUT / "assets")
(OUT / ".nojekyll").write_text("")
if cfg.get("custom_domain"): (OUT / "CNAME").write_text(cfg["custom_domain"])
today = datetime.date.today().isoformat()
def url(path, extra=""):
    pr = {"/": "1.0", "/inventory/": "0.9"}.get(path, "0.8" if "/cars/" in path else "0.7")
    return f"<url><loc>{BASE}{path}</loc><lastmod>{today}</lastmod><changefreq>{'daily' if path in ('/', '/inventory/') else 'weekly'}</changefreq><priority>{pr}</priority>{extra}</url>"
urls = [url(p) for k, p in PAGES.items() if k not in ("privacy", "terms")] + [url(PAGES[k]) for k in ("privacy", "terms")]
for c in cars:
    im = c["img"]
    ex = ""
    if im:
        full = im if im.startswith("http") else BASE + (im if im.startswith("/") else "/" + im)
        if PREFIX and im.startswith(PREFIX): full = urlparse(BASE).scheme + "://" + urlparse(BASE).netloc + im
        ex = f"<image:image><image:loc>{full}</image:loc></image:image>"
    urls.append(url(f"/cars/{c['slug']}/", ex))
(OUT / "sitemap.xml").write_text('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">\n' + "\n".join(urls) + "\n</urlset>\n")
(OUT / "robots.txt").write_text(f"User-agent: *\nAllow: /\n\nSitemap: {BASE}/sitemap.xml\n")
shutil.rmtree(TMP)
print(f"{n} pages + 404 written to {OUT.relative_to(R)}/ for {BASE}")
