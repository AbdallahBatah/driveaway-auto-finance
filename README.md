# Driveaway Auto Finance — website, CRM and admin

Dynamic site for a used-car dealership (Hobart, IN). One small Node server provides
the public site, per-vehicle SEO pages, a lead form, an admin panel, a sales CRM,
users with roles, an audit log and backups.

- **Runtime:** Node 22.5+ (uses built-in `node:sqlite`, `node:http`, `node:crypto`). No required dependencies.
- **Database:** PostgreSQL when `DATABASE_URL` is set (Replit's built-in DB), otherwise a local SQLite file for development.
- **Optional packages:** `pg` (Postgres driver, installed by `npm install`), `sharp` (resizes uploaded photos to WebP).

## Run locally

```bash
OWNER_EMAIL=you@example.com OWNER_PASSWORD='a-long-passphrase-12+' npm start
# http://localhost:3000   admin: http://localhost:3000/login/
npm test        # 77 API/security checks on a temporary database
```

## Deploy on Replit

1. Replit → **Create App → Import from GitHub** → `AbdallahBatah/driveaway-auto-finance`.
2. **Tools → PostgreSQL** (creates the database and sets `DATABASE_URL` automatically).
3. **Secrets** (padlock icon) — add:

| Secret | Required | Purpose |
|---|---|---|
| `SITE_URL` | yes | Public address, e.g. `https://www.driveawayautofinance.com` (canonical URLs, sitemap, CSRF origin) |
| `OWNER_EMAIL`, `OWNER_PASSWORD` | first run | Creates the first owner account (password 12+ characters). Delete `OWNER_PASSWORD` after first login. |
| `RESEND_API_KEY`, `NOTIFY_EMAIL`, `MAIL_FROM` | recommended | Email alert for each new lead (Resend). Without them, leads are only logged. |
| `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET` | recommended | Cloudflare Turnstile on forms. Honeypot + time trap + rate limit work without it. |
| `SESSION_HOURS`, `BACKUP_KEEP`, `SEED_VEHICLES`, `TRUST_PROXY` | optional | Defaults: 8, 30, on, on behind Replit |

4. Press **Run**, then **Deploy** (Autoscale/Cloud Run is preconfigured in `.replit`). Attach your domain under Deployments → Settings.
5. Open `/login/`, sign in as the owner, change nothing yet — first create your Manager/Sales users under **Users**.

On first start the 37 current vehicles are seeded automatically.

## Roles

| Role | Can do |
|---|---|
| owner | Everything, including Users, Activity log, Backups |
| manager | Vehicles, sales/CRM, leads, reports |
| sales | Only their own deals in the CRM (enforced on the server) |

## Blog

Articles are Markdown files in `data/articles/` (front matter: `title`, `slug`, `description`, `category`, `date`, `image` = a vehicle stock number, `related`). The server renders `/blog/` and `/blog/<slug>/` with canonical URLs, Open Graph, BlogPosting + FAQ + breadcrumb JSON-LD, and adds every article to `sitemap.xml`, `llms.txt` and `llms-full.txt` automatically. A `date` in the future keeps an article hidden until that day, so you can schedule posts. Links inside articles may only point to site paths (`/inventory/`).

## Data and backups

- Inventory, deals and leads are documents in one `docs` table; photos are stored in `blobs`.
- Daily automatic backup (keeps the last 30) plus manual and *full* (with photos) backups; download them and keep a copy off-site. Restore requires typing `RESTORE` and takes a safety snapshot first.
- Migrating old data: put `vehicles.json`, `deals.json`, `leads.json` in `data/migration/` and run `npm run import`.
- Create or reset an owner from the shell: `npm run create-owner`.

## Project layout

```
server/   http server, auth, store, backup, mail, SEO/page rendering
src/      front-end (index.html, app.js, shim.js, admin-extra.js, styles.css, assets/)
data/     seed vehicles
scripts/  create-owner, import-data
tests/    api.test.js
build.py  builds the single-file preview (index.html) used as a Claude artifact
```

After editing `src/`, run `python3 build.py` only if you also want to refresh the single-file preview.

## Honest caveats

- The Postgres driver was verified against a test double, not a live Postgres. Do a smoke test (login, add vehicle, submit lead, backup) right after the first Replit deploy.
- Rate limiting is in memory, so it is per instance; with several instances it is looser. Turnstile covers the lead form.
- Page content is rendered in the browser on top of server-rendered titles, meta, JSON-LD and (on car pages) a full text block, so Google sees the key content.
- See `SECURITY.md` before going live.
