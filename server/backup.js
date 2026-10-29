'use strict';
const zlib = require('zlib');
const db = require('./db');
const cfg = require('./config');
const { tid, HttpError } = require('./util');
const store = require('./store');

async function snapshot(kind, withBlobs) {
  const docs = await db.all('SELECT col,id,data,created_at,updated_at FROM docs');
  const users = (await db.all('SELECT id,email,name,role,active,created_at FROM users'));
  const out = { version: 1, at: Date.now(), docs, users };
  if (withBlobs) out.blobs = (await db.all('SELECT id,type,data,created_at FROM blobs')).map(b => ({ ...b, data: Buffer.from(b.data).toString('base64') }));
  const gz = zlib.gzipSync(Buffer.from(JSON.stringify(out)));
  const id = tid();
  await db.run('INSERT INTO backups(id,at,kind,size,data) VALUES(?,?,?,?,?)', [id, Date.now(), kind, gz.length, gz]);
  const old = await db.all("SELECT id FROM backups WHERE kind='auto' ORDER BY at DESC");
  for (const o of old.slice(cfg.backupKeep)) await db.run('DELETE FROM backups WHERE id=?', [o.id]);
  return { id, size: gz.length, docs: docs.length, blobs: out.blobs ? out.blobs.length : 0 };
}
const list = () => db.all('SELECT id,at,kind,size FROM backups ORDER BY at DESC');
async function download(id) { const r = (await db.all('SELECT * FROM backups WHERE id=?', [id]))[0]; if (!r) throw new HttpError(404, 'Not found'); return Buffer.from(r.data); }
async function restore(id) {
  const buf = await download(id); let d;
  try { d = JSON.parse(zlib.gunzipSync(buf).toString('utf8')); } catch (e) { throw new HttpError(400, 'Backup is unreadable'); }
  await snapshot('auto', false); // safety copy of the current state first
  await db.tx(async t => {
    await t.run("DELETE FROM docs");
    for (const r of d.docs) await t.run('INSERT INTO docs(col,id,data,created_at,updated_at,updated_by) VALUES(?,?,?,?,?,NULL)', [r.col, r.id, r.data, r.created_at, r.updated_at]);
    for (const b of d.blobs || []) await t.run('INSERT INTO blobs(id,type,data,created_at) VALUES(?,?,?,?) ON CONFLICT(id) DO NOTHING', [b.id, b.type, Buffer.from(b.data, 'base64'), b.created_at]);
  });
  store.invalidate();
  return { docs: d.docs.length, blobs: (d.blobs || []).length };
}
function schedule() {
  const run = async () => {
    try {
      const last = (await db.all("SELECT MAX(at) AS at FROM backups WHERE kind='auto'"))[0].at || 0;
      if (Date.now() - last > 23 * 3600000) { const r = await snapshot('auto', false); console.log('[backup] daily backup', r); }
    } catch (e) { console.error('[backup] failed', e.message); }
  };
  setTimeout(run, 5000).unref(); setInterval(run, 3600000).unref();
}
module.exports = { snapshot, list, download, restore, schedule };
