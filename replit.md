# Running this imported project

This project keeps its original Node.js server, plain JavaScript frontend, and database layer. It requires Node.js 22.5 or newer; the Replit toolchain is Node.js 22.

## Start and test

- Click **Run** to start the `Start application` workflow (`npm start`).
- The HTTP server binds to `0.0.0.0:5000` using the `PORT` setting in `.replit`.
- Run `npm test` for the API/security suite. It uses a temporary SQLite database, not the configured application database.
- Source files are in `src/` and `server/`. The root `index.html` is an optional generated single-file preview, not the running server entry point.

## Database and account setup

- The server uses the existing `DATABASE_URL` connection when present. Do not replace it or switch database providers as part of setup.
- Without `DATABASE_URL`, the existing local-development SQLite mode uses `data/app.sqlite`.
- To create the first owner, add `OWNER_EMAIL` and `OWNER_PASSWORD` in Replit Secrets, then restart the workflow. The password must satisfy the app's password policy (at least 12 characters). Sign in at `/login/` and remove `OWNER_PASSWORD` after account creation.
- Without owner credentials, the public site runs, but no first admin account is created.
- `SITE_URL` is optional for preview; set it to the actual public site address before publishing so canonical URLs and sitemaps use the correct address.
- Optional email notifications require `RESEND_API_KEY`, `NOTIFY_EMAIL`, and `MAIL_FROM`. Optional form CAPTCHA requires `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET`. No credentials are fabricated during setup.

See `README.md` and `SECURITY.md` for the existing application behavior and production checklist.
