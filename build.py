#!/usr/bin/env python3
"""Build the single-file site: inlines src/styles.css, src/app.js and every image
under src/assets/img (as base64) into ./index.html, the file published as the artifact."""
import re, base64, mimetypes, pathlib
R = pathlib.Path(__file__).parent
S = R / "src"
h = (S / "index.html").read_text(encoding="utf-8")
css = (S / "styles.css").read_text(encoding="utf-8")
js = (S / "app.js").read_text(encoding="utf-8")
h = h.replace('<link rel="stylesheet" href="styles.css">', "<style>" + css + "</style>")
h = h.replace('<script src="app.js"></script>', "<script>" + js + "</script>")
def inline(m):
    p = S / m.group(0)
    mime = mimetypes.guess_type(p.name)[0] or "application/octet-stream"
    return "data:%s;base64,%s" % (mime, base64.b64encode(p.read_bytes()).decode())
h = re.sub(r"assets/img/[\w./-]+\.(?:webp|png|jpg)", inline, h)
(R / "index.html").write_text(h, encoding="utf-8")
print("index.html", len(h) // 1024, "KB")
