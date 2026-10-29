'use strict';
// Storage layer. PostgreSQL when DATABASE_URL is set (Replit built-in database),
// otherwise a local SQLite file (development, tests, or a Replit Reserved VM).
// All SQL below is written in the dialect both engines share; `?` placeholders are translated for pg.
const fs = require('fs');
const path = require('path');
const cfg = require('./config');

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL, role TEXT NOT NULL,
    pass TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, fails INTEGER NOT NULL DEFAULT 0, locked_until {INT} NOT NULL DEFAULT 0,
    must_change INTEGER NOT NULL DEFAULT 0, created_at {INT} NOT NULL, last_login {INT} NOT NULL DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS sessions (sid TEXT PRIMARY KEY, uid TEXT NOT NULL, csrf TEXT NOT NULL, created_at {INT} NOT NULL,
    expires_at {INT} NOT NULL, touched_at {INT} NOT NULL, ip TEXT, ua TEXT)`,
  `CREATE INDEX IF NOT EXISTS sessions_uid ON sessions(uid)`,
  `CREATE TABLE IF NOT EXISTS docs (col TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, created_at {INT} NOT NULL,
    updated_at {INT} NOT NULL, updated_by TEXT, PRIMARY KEY (col, id))`,
  `CREATE TABLE IF NOT EXISTS blobs (id TEXT PRIMARY KEY, type TEXT NOT NULL, data {BLOB} NOT NULL, created_at {INT} NOT NULL, created_by TEXT)`,
  `CREATE TABLE IF NOT EXISTS audit (id TEXT PRIMARY KEY, at {INT} NOT NULL, uid TEXT, uname TEXT, action TEXT NOT NULL,
    col TEXT, doc TEXT, ip TEXT, detail TEXT)`,
  `CREATE INDEX IF NOT EXISTS audit_at ON audit(at)`,
  `CREATE TABLE IF NOT EXISTS backups (id TEXT PRIMARY KEY, at {INT} NOT NULL, kind TEXT NOT NULL, size {INT} NOT NULL, data {BLOB} NOT NULL)`
];

let impl;
async function init() {
  if (cfg.databaseUrl) {
    let pg;
    try { pg = require('pg'); } catch (e) { throw new Error('DATABASE_URL is set but the "pg" package is missing. Run: npm install'); }
    pg.types.setTypeParser(20, v => parseInt(v, 10)); // BIGINT -> number
    const ssl = /localhost|127\.0\.0\.1/.test(cfg.databaseUrl) || /sslmode=disable/.test(cfg.databaseUrl) ? false : { rejectUnauthorized: false };
    const pool = new pg.Pool({ connectionString: cfg.databaseUrl, max: 8, ssl });
    const q = (sql, p) => { let i = 0; return pool.query(sql.replace(/\?/g, () => '$' + (++i)), p || []); };
    impl = {
      kind: 'postgres',
      all: async (s, p) => (await q(s, p)).rows,
      run: async (s, p) => { const r = await q(s, p); return { changes: r.rowCount }; },
      tx: async fn => {
        const c = await pool.connect();
        const cq = (sql, p) => { let i = 0; return c.query(sql.replace(/\?/g, () => '$' + (++i)), p || []); };
        try {
          await c.query('BEGIN');
          const r = await fn({ all: async (s, p) => (await cq(s, p)).rows, run: async (s, p) => ({ changes: (await cq(s, p)).rowCount }) });
          await c.query('COMMIT'); return r;
        } catch (e) { try { await c.query('ROLLBACK'); } catch (_) {} throw e; } finally { c.release(); }
      },
      close: () => pool.end(),
      types: { INT: 'BIGINT', BLOB: 'BYTEA' }
    };
  } else {
    const { DatabaseSync } = require('node:sqlite');
    fs.mkdirSync(path.dirname(cfg.sqliteFile), { recursive: true });
    const d = new DatabaseSync(cfg.sqliteFile);
    d.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
    const norm = r => (r && typeof r === 'object' ? Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v instanceof Uint8Array ? Buffer.from(v) : v])) : r);
    let chain = Promise.resolve();
    const lock = fn => { const p = chain.then(fn, fn); chain = p.then(() => {}, () => {}); return p; };
    const ops = {
      all: async (s, p) => d.prepare(s).all(...(p || [])).map(norm),
      run: async (s, p) => { const r = d.prepare(s).run(...(p || [])); return { changes: Number(r.changes) }; }
    };
    impl = {
      kind: 'sqlite', ...ops,
      tx: fn => lock(async () => {
        d.exec('BEGIN IMMEDIATE');
        try { const r = await fn(ops); d.exec('COMMIT'); return r; } catch (e) { try { d.exec('ROLLBACK'); } catch (_) {} throw e; }
      }),
      close: async () => d.close(),
      types: { INT: 'INTEGER', BLOB: 'BLOB' }
    };
  }
  for (const s of SCHEMA) await impl.run(s.replace(/\{INT\}/g, impl.types.INT).replace(/\{BLOB\}/g, impl.types.BLOB));
  return impl;
}
const wrap = name => (...a) => impl[name](...a);
module.exports = { init, all: wrap('all'), run: wrap('run'), tx: wrap('tx'), close: () => impl && impl.close(), get kind() { return impl && impl.kind; } };
