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
    cars = pg.evaluate("AV().map(v=>({slug:slug(v),stock:v[8],img:(v[9][0]||IMG[v[8]]||''),title:vt(v),year:v[0],make:v[1],model:v[2],miles:v[4],price:v[5],body:v[6],color:v[7],drive:(v[13]||{}).drive||'',trans:(v[13]||{}).trans||'',engine:(v[13]||{}).engine||''}))")
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

# 4. llms.txt (short index) and llms-full.txt (full inventory) for AI assistants
def esc_md(t): return str(t).replace("[", "(").replace("]", ")")
def line(c):
    bits = [f"{c['miles']:,} miles", c["color"], c["body"]] + [x for x in (c["drive"], c["trans"], c["engine"]) if x]
    price = f"${c['price']:,}" if c["price"] else "call for price"
    return f"- [{esc_md(c['title'])}]({BASE}/cars/{c['slug']}/): {price}, " + ", ".join(bits) + f". Stock {c['stock']}."
about = ("Driveaway Auto Finance is an independent used-car dealership with in-house financing at 2333 W 37th Ave, Hobart, IN 46342 (Lake County, northwest Indiana). "
         "Phone 219-945-3136. It sells used sedans, SUVs, trucks and minivans, buys and takes trade-ins on vehicles, and helps customers with limited or damaged credit find financing. "
         "Prices exclude taxes and fees and may change without notice; approval and terms depend on the customer's income, credit and the vehicle.")
core = [("Inventory", "/inventory/", "All used vehicles currently for sale, with filters and a payment estimate"),
        ("Financing", "/financing/", "Quick application and payment calculator"),
        ("Sell or trade", "/sell/", "How selling or trading in a vehicle works"),
        ("Car finder", "/finder/", "Describe the car you want and we search for it"),
        ("Visit us", "/visit/", "Address, phone, what to bring"),
        ("Reviews", "/reviews/", "Highlights from customer reviews")]
head = f"# Driveaway Auto Finance\n\n> {about}\n\n"
llms = head + "## Key pages\n\n" + "\n".join(f"- [{n}]({BASE}{p}): {d}" for n, p, d in core)
llms += f"\n\n## Vehicles in stock ({len(cars)})\n\n" + "\n".join(line(c) for c in cars)
llms += f"\n\n## Optional\n\n- [Full inventory details]({BASE}/llms-full.txt)\n- [Sitemap]({BASE}/sitemap.xml)\n- [Privacy policy]({BASE}/privacy/)\n- [Terms of service]({BASE}/terms/)\n"
(OUT / "llms.txt").write_text(llms, encoding="utf-8")
full = head + f"Last updated: {today}\n\n## Contact\n\nDriveaway Auto Finance, 2333 W 37th Ave, Hobart, IN 46342. Phone 219-945-3136. Map: https://www.google.com/maps/place/Driveaway+Auto+Finance/data=!4m2!3m1!1s0x0:0x4d325bdfe1317fba\n\n## Inventory\n\n"
for c in cars:
    full += f"### {c['title']}\n- URL: {BASE}/cars/{c['slug']}/\n- Price: {'$' + format(c['price'], ',') if c['price'] else 'Call for price'}\n- Mileage: {c['miles']:,} miles\n- Body style: {c['body']}\n- Exterior color: {c['color']}\n" + "".join(f"- {k}: {c[v]}\n" for k, v in (("Drive", "drive"), ("Transmission", "trans"), ("Engine", "engine")) if c[v]) + f"- Stock number: {c['stock']}\n- Condition: Used\n\n"
(OUT / "llms-full.txt").write_text(full, encoding="utf-8")
shutil.rmtree(TMP)
print(f"{n} pages + 404 written to {OUT.relative_to(R)}/ for {BASE}")
