'use strict';
// Import vehicles / customers / leads exported from the claude.ai version (or any JSON in the same shape).
//   npm run import -- data/migration
// Reads vehicles.json (array of vehicle objects), deals.json (array of CRM customers) and leads.json (array of requests) if present.
// Safe to run twice: existing records with the same id are overwritten, nothing else is touched.
const fs = require('fs'), path = require('path');
const db = require('../server/db'), store = require('../server/store'), { tid } = require('../server/util');
(async () => {
  const dir = path.resolve(process.argv[2] || 'data/migration'); await db.init(); const now = Date.now(); let n = { vehicles: 0, deals: 0, leads: 0 };
  const rd = f => { const p = path.join(dir, f); return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : []; };
  for (const v of rd('vehicles.json')) {
    const d = store.validate('vehicles', { ...v, photos: [] }); d.createdAt = d.updatedAt = now;
    await db.run('INSERT INTO docs(col,id,data,created_at,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(col,id) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at', ['vehicles', String(d.stock).replace(/[^\w-]/g, ''), JSON.stringify(d), now, now]); n.vehicles++;
  }
  for (const x of rd('deals.json')) {
    const id = String(x.id || tid()).replace(/[^\w-]/g, '').slice(0, 64), { id: _i, ...d } = x; store.validate('deals', d);
    await db.run('INSERT INTO docs(col,id,data,created_at,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(col,id) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at', ['deals', id, JSON.stringify(d), d.createdAt || now, now]); n.deals++;
  }
  for (const x of rd('leads.json')) {
    const id = tid(); await db.run('INSERT INTO docs(col,id,data,created_at,updated_at) VALUES(?,?,?,?,?)', ['leads', id, JSON.stringify(x), x.createdAt || now, now]); n.leads++;
  }
  console.log('Imported', n); await db.close(); process.exit(0);
})().catch(e => { console.error(e.message); process.exit(1); });
