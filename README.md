# Driveaway Auto Finance: website, admin and CRM

Single-file website for Driveaway Auto Finance, a used-car dealership at 2333 W 37th Ave, Hobart, IN 46342 (219-945-3136).

## What is inside `index.html`
- **Public site** (hash-routed pages): Home, Inventory, Financing, Sell or trade, Car finder, Visit us, Reviews, Privacy, Terms. Mega menu, hero slider, route timeline and bento grid, vehicle compare tray (up to 3), payment calculator.
- **Staff sign-in** (`#login`) and **Admin** (`#admin`): Dashboard, Vehicles (add/edit/photos/mark sold), Sales, Leads inbox, **CRM**, Reports.
- **CRM** (`#admin-crm`): Kanban board with 11 stages, customer file (deal money, payments, tasks, notes and activity log, documents checklist), sales team assignment, task list, insights and CSV export.

## Project structure
```
index.html            built single file (identical to the published artifact)
build.py              python3 build.py  -> inlines src/ into index.html
src/index.html        page markup (all pages + admin + dialogs)
src/styles.css        all styles
src/app.js            all logic: routing, inventory, compare, finder, admin, CRM
src/assets/img/       logo, 4 hero slider images, 22 vehicle photos (named by stock number)
originals/            the original files you uploaded (photos and the source site content)
```
Edit files in `src/`, run `python3 build.py`, and publish the resulting `index.html`.
To preview `src/` directly: `cd src && python3 -m http.server` (admin and CRM still need the claude.ai runtime).

## Important: how it runs
The admin, live inventory, lead capture and CRM use the `window.claude` runtime of claude.ai artifacts (`db`, `user`, `assets`, `sample`, `downloads`). Opened elsewhere (for example GitHub Pages) the public pages work with the 37 built-in vehicles, but admin, CRM and saving of leads do not.

Collections and access rules used when published as an artifact:
- `vehicles` read: view, write: admin
- `leads` read/write: admin; `leads/{self}` read/write: interact
- `deals` and `settings` read/write: admin

To self-host, replace the `claude.use(...)` calls with your own backend (auth plus a database for vehicles, leads, deals and settings).

## Notes
- Fonts: Cormorant Garamond and Jost (Google Fonts). Images are embedded as base64.
- Confirm you have rights to the slider photos before going live.
