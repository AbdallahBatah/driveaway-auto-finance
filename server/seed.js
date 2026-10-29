'use strict';
// First run only: load the current inventory so the site is not empty.
const fs = require('fs');
const path = require('path');
const db = require('./db');
const cfg = require('./config');
const store = require('./store');
async function run() {
  if (Number((await db.all("SELECT COUNT(*) AS c FROM docs WHERE col='vehicles'"))[0].c) > 0) return;
  if ((await db.all("SELECT 1 AS x FROM audit WHERE action='seed' LIMIT 1")).length) return; // already seeded once; do not refill after deliberate deletion
  const f = path.join(cfg.root, 'data', 'seed-vehicles.json'); if (!fs.existsSync(f)) return;
  const list = JSON.parse(fs.readFileSync(f, 'utf8')), now = Date.now();
  for (const v of list) {
    const d = store.validate('vehicles', { ...v, photos: [] }); d.createdAt = d.updatedAt = now;
    await db.run('INSERT INTO docs(col,id,data,created_at,updated_at) VALUES(?,?,?,?,?)', ['vehicles', String(v.stock).replace(/[^\w-]/g, ''), JSON.stringify(d), now, now]);
  }
  await db.run('INSERT INTO audit(id,at,action,detail) VALUES(?,?,?,?)', [require('./util').tid(), now, 'seed', JSON.stringify({ vehicles: list.length })]);
  store.invalidate(); console.log(`[seed] loaded ${list.length} vehicles`);
}
module.exports = { run };
