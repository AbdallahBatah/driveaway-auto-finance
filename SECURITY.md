# Security

## Controls in place

- **Passwords:** scrypt (N=32768) with per-user salt; 12+ character policy; constant-time compare; dummy hash for unknown emails so timing does not reveal accounts.
- **Brute force:** per-account lockout (8 failures → 15 min) plus per-IP rate limits on login, lead form, uploads and API.
- **Sessions:** random 256-bit token, only its SHA-256 is stored; `HttpOnly`, `SameSite=Lax`, `Secure` on HTTPS; sliding idle expiry (default 8 h); logout and password change revoke sessions.
- **CSRF:** per-session token header on every write, plus Origin must match the host.
- **Authorization:** enforced on the server per collection and role; sales users can only read/write their own deals regardless of what the browser sends.
- **Headers:** strict CSP (nonce for the single inline data script, no inline handlers), HSTS, `nosniff`, `X-Frame-Options: DENY`, Permissions-Policy, COOP.
- **Input:** schema validation and size limits on every document; SQL always parameterised; output HTML-escaped; JSON embedded in pages is escaped against `</script>` and U+2028/2029.
- **Uploads:** type decided by magic bytes (JPEG/PNG/WebP/GIF only), size-capped, served with `nosniff`; static serving is path-traversal safe.
- **Forms:** honeypot, time trap, rate limit, optional Cloudflare Turnstile.
- **Audit log:** logins, failures, user changes, data changes (diffs), backups and restores. Passwords are never logged.
- **Backups:** daily, retained 30, restore with confirmation and safety snapshot.

## Before going live

1. Set a long unique owner password; remove `OWNER_PASSWORD` from Secrets after first login.
2. Set `SITE_URL` to the real https address and serve only over HTTPS.
3. Add Turnstile keys and Resend settings.
4. Create personal accounts for each staff member; never share logins; deactivate leavers under Users.
5. Download a full backup weekly and store it off Replit.
6. Smoke-test on the live database (login, add vehicle, submit lead, backup/restore on a copy).
7. Review the Activity log regularly; rotate secrets if a device is lost.

## Known limits

- In-memory rate limiter is per instance.
- No two-factor authentication yet (recommended next step for the owner account).
- Postgres path not yet exercised against a real server in development.

Report vulnerabilities privately to the site owner.
