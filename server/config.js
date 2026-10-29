'use strict';
const path = require('path');
const env = process.env;
const num = (v, d) => (v === undefined || v === '' || isNaN(+v) ? d : +v);
module.exports = {
  root: path.resolve(__dirname, '..'),
  port: num(env.PORT, 3000),
  production: env.NODE_ENV === 'production' || !!env.REPLIT_DEPLOYMENT,
  databaseUrl: env.DATABASE_URL || '',
  sqliteFile: env.SQLITE_FILE || path.resolve(__dirname, '..', 'data', 'app.sqlite'),
  siteUrl: (env.SITE_URL || '').replace(/\/$/, ''),
  ownerEmail: (env.OWNER_EMAIL || '').trim().toLowerCase(),
  ownerPassword: env.OWNER_PASSWORD || '',
  notifyEmail: env.NOTIFY_EMAIL || '',
  resendKey: env.RESEND_API_KEY || '',
  mailFrom: env.MAIL_FROM || 'Driveaway Auto Finance <onboarding@resend.dev>',
  turnstileSite: env.TURNSTILE_SITE_KEY || '',
  turnstileSecret: env.TURNSTILE_SECRET || '',
  sessionHours: num(env.SESSION_HOURS, 8),
  backupKeep: num(env.BACKUP_KEEP, 30),
  seed: env.SEED_VEHICLES !== '0',
  trustProxy: env.TRUST_PROXY !== '0'
};
