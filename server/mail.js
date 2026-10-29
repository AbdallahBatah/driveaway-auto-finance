'use strict';
const cfg = require('./config');
const { esc } = require('./util');
async function send(subject, rows, replyTo) {
  const to = cfg.notifyEmail; if (!to) return;
  const html = `<div style="font:15px/1.5 Arial,sans-serif"><h2 style="margin:0 0 12px">${esc(subject)}</h2><table cellpadding="6" style="border-collapse:collapse">${rows.filter(r => r[1]).map(r => `<tr><td style="color:#666">${esc(r[0])}</td><td><b>${esc(r[1])}</b></td></tr>`).join('')}</table><p style="color:#888;font-size:13px">Open the CRM in the admin area to follow up.</p></div>`;
  const text = rows.filter(r => r[1]).map(r => r[0] + ': ' + r[1]).join('\n');
  if (!cfg.resendKey) { console.log('[mail] (no RESEND_API_KEY) ' + subject + '\n' + text); return; }
  try {
    const r = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: 'Bearer ' + cfg.resendKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: cfg.mailFrom, to: to.split(',').map(s => s.trim()).filter(Boolean), subject: subject.replace(/[\r\n]+/g, ' ').slice(0, 150), html, text, reply_to: replyTo || undefined }) });
    if (!r.ok) console.error('[mail] failed', r.status, (await r.text()).slice(0, 200));
  } catch (e) { console.error('[mail] error', e.message); }
}
module.exports = { send };
