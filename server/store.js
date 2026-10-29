'use strict';
// Document store (vehicles, deals, leads) with role permissions, validation and audit.
const db = require('./db');
const { HttpError, tid } = require('./util');
const { audit, can } = require('./auth');

const COLS = { vehicles: 1, deals: 1, leads: 1 };
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const STAGES = ['New lead', 'Contacted', 'Application', 'Approved', 'Test drive', 'Negotiation', 'Sold', 'Delivered', 'Follow-up', 'Declined', 'Lost'];
const cache = { vehicles: null };

function checkShape(v, depth = 0) {
  if (depth > 7) throw new HttpError(400, 'Data too deep');
  if (typeof v === 'string') { if (v.length > 6000) throw new HttpError(400, 'Text too long'); return; }
  if (Array.isArray(v)) { if (v.length > 600) throw new HttpError(400, 'List too long'); v.forEach(x => checkShape(x, depth + 1)); return; }
  if (v && typeof v === 'object') {
    const ks = Object.keys(v); if (ks.length > 80) throw new HttpError(400, 'Too many fields');
    for (const k of ks) { if (k === '__proto__' || k === 'constructor' || k.length > 60) throw new HttpError(400, 'Bad field name'); checkShape(v[k], depth + 1); }
  }
}
const numOrNull = (v, min, max, name) => { if (v === null || v === undefined || v === '') return null; const n = Number(v); if (!isFinite(n) || n < min || n > max) throw new HttpError(400, name + ' is out of range'); return n; };
const str = (v, max, name, req) => { v = v == null ? '' : String(v).trim(); if (req && !v) throw new HttpError(400, name + ' is required'); if (v.length > max) throw new HttpError(400, name + ' is too long'); return v; };

function validate(col, d) {
  if (!d || typeof d !== 'object' || Array.isArray(d)) throw new HttpError(400, 'Invalid document');
  checkShape(d);
  if (col === 'vehicles') {
    d.year = numOrNull(d.year, 1950, 2100, 'Year'); if (!d.year) throw new HttpError(400, 'Year is required');
    d.make = str(d.make, 60, 'Make', 1); d.model = str(d.model, 80, 'Model', 1); d.trim = str(d.trim, 120, 'Trim'); d.stock = str(d.stock, 40, 'Stock number', 1);
    d.miles = numOrNull(d.miles, 0, 2000000, 'Mileage') || 0; d.price = numOrNull(d.price, 0, 10000000, 'Price');
    d.body = str(d.body, 30, 'Body'); d.color = str(d.color, 30, 'Color'); d.desc = str(d.desc, 4000, 'Description');
    if (!['available', 'draft', 'sold'].includes(d.status)) d.status = 'available';
    if (d.photos !== undefined) {
      if (!Array.isArray(d.photos) || d.photos.length > 30 || d.photos.some(p => typeof p !== 'string' || !ID_RE.test(p))) throw new HttpError(400, 'Invalid photos');
    } else d.photos = [];
    ['vin', 'engine', 'trans', 'drive', 'buyer', 'finType'].forEach(k => { if (d[k] !== undefined) d[k] = str(d[k], 80, k); });
    ['soldPrice', 'down'].forEach(k => { if (d[k] !== undefined) d[k] = numOrNull(d[k], 0, 10000000, k); });
  }
  if (col === 'deals') {
    d.name = str(d.name, 120, 'Name'); d.phone = str(d.phone, 40, 'Phone'); d.email = str(d.email, 160, 'Email');
    if (d.stage !== undefined && !STAGES.includes(d.stage)) throw new HttpError(400, 'Unknown stage');
    if (d.owner !== undefined) d.owner = str(d.owner, 80, 'Owner');
  }
  return d;
}
const parse = r => ({ id: r.id, data: JSON.parse(r.data), createdAt: r.created_at, updatedAt: r.updated_at });
function access(user, col, action) {
  if (!COLS[col]) throw new HttpError(404, 'Not found');
  if (col === 'vehicles') { if (action !== 'read' && !can(user, 'owner', 'manager')) throw new HttpError(403, 'Not allowed'); return; }
  if (!user) throw new HttpError(401, 'Sign in');
  if (col === 'leads' && !can(user, 'owner', 'manager')) throw new HttpError(403, 'Not allowed');
  if (col === 'deals' && !can(user, 'owner', 'manager', 'sales')) throw new HttpError(403, 'Not allowed');
}
const mine = (user, d) => !can(user, 'sales') || (d.owner || '') === user.name;

async function list(user, col) {
  access(user, col, 'read');
  const rows = (await db.all('SELECT * FROM docs WHERE col=? ORDER BY created_at DESC', [col])).map(parse);
  if (col === 'vehicles' && !can(user, 'owner', 'manager', 'sales')) return rows.filter(r => r.data.status !== 'draft');
  if (col === 'deals') return rows.filter(r => mine(user, r.data));
  return rows;
}
async function get(user, col, id) {
  access(user, col, 'read'); if (!ID_RE.test(id)) throw new HttpError(404, 'Not found');
  const r = (await db.all('SELECT * FROM docs WHERE col=? AND id=?', [col, id]))[0];
  if (!r) return null; const p = parse(r);
  if (col === 'vehicles' && p.data.status === 'draft' && !can(user, 'owner', 'manager', 'sales')) return null;
  if (col === 'deals' && !mine(user, p.data)) return null;
  return p;
}
function diff(a, b) {
  const out = {}; const keys = new Set([...Object.keys(a || {}), ...Object.keys(b || {})]);
  for (const k of keys) { const x = JSON.stringify(a && a[k]), y = JSON.stringify(b && b[k]); if (x !== y) out[k] = [x === undefined ? null : x.slice(0, 80), y === undefined ? null : y.slice(0, 80)]; }
  return out;
}
async function put(req, user, col, id, data, merge) {
  access(user, col, 'write'); if (!ID_RE.test(id)) throw new HttpError(400, 'Bad id');
  const old = (await db.all('SELECT * FROM docs WHERE col=? AND id=?', [col, id]))[0], now = Date.now();
  let prev = old ? JSON.parse(old.data) : null;
  if (prev && col === 'deals' && !mine(user, prev)) throw new HttpError(404, 'Not found');
  let next = merge && prev ? { ...prev, ...data } : { ...data };
  if (col === 'deals' && can(user, 'sales')) next.owner = user.name; // sales cannot hand customers to others
  next = validate(col, next);
  if (col === 'vehicles') { next.createdAt = prev ? prev.createdAt : now; next.updatedAt = now; }
  const json = JSON.stringify(next); if (json.length > 250000) throw new HttpError(413, 'Document too large');
  await db.run(`INSERT INTO docs(col,id,data,created_at,updated_at,updated_by) VALUES(?,?,?,?,?,?)
    ON CONFLICT(col,id) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at, updated_by=excluded.updated_by`, [col, id, json, old ? old.created_at : now, now, user.id]);
  cache.vehicles = null;
  const label = col === 'vehicles' ? `${next.year} ${next.make} ${next.model}` : col === 'deals' ? next.name : undefined;
  await audit(req, user, old ? col + '.update' : col + '.create', col, id, { label, changed: old ? diff(prev, next) : undefined });
  return { id, data: next, updatedAt: now };
}
async function remove(req, user, col, id) {
  access(user, col, 'write'); if (!ID_RE.test(id)) throw new HttpError(400, 'Bad id');
  if (col !== 'vehicles' && !can(user, 'owner', 'manager')) throw new HttpError(403, 'Only managers can delete');
  const old = (await db.all('SELECT * FROM docs WHERE col=? AND id=?', [col, id]))[0];
  if (!old) return false;
  const prev = JSON.parse(old.data);
  if (col === 'deals' && !mine(user, prev)) throw new HttpError(404, 'Not found');
  await db.run('DELETE FROM docs WHERE col=? AND id=?', [col, id]); cache.vehicles = null;
  await audit(req, user, col + '.delete', col, id, { label: prev.name || `${prev.year} ${prev.make} ${prev.model}`, snapshot: JSON.stringify(prev).slice(0, 2500) });
  return true;
}
async function publicVehicles() {
  if (!cache.vehicles) cache.vehicles = (await db.all("SELECT * FROM docs WHERE col='vehicles' ORDER BY created_at DESC")).map(parse).filter(r => r.data.status !== 'draft').map(r => ({ ...r.data, id: r.id }));
  return cache.vehicles;
}
const invalidate = () => { cache.vehicles = null; };
async function createLead(data) {
  const id = tid(); const now = Date.now();
  await db.run('INSERT INTO docs(col,id,data,created_at,updated_at,updated_by) VALUES(?,?,?,?,?,?)', ['leads', id, JSON.stringify({ ...data, status: 'New', createdAt: now }), now, now, null]);
  return id;
}
module.exports = { list, get, put, remove, publicVehicles, invalidate, createLead, STAGES, ID_RE, validate };
