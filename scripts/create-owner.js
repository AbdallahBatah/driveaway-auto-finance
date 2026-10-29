'use strict';
// Create (or reset) an owner account from the shell:  npm run create-owner -- you@example.com "Your Name"
// The password is read from the OWNER_PASSWORD environment variable, never from the command line history.
const db = require('../server/db'), auth = require('../server/auth');
(async () => {
  const [email, name] = process.argv.slice(2); const pw = process.env.OWNER_PASSWORD;
  if (!email || !pw) { console.error('Usage: OWNER_PASSWORD=... npm run create-owner -- email "Full name"'); process.exit(1); }
  await db.init();
  const ex = (await db.all('SELECT id FROM users WHERE email=?', [email.toLowerCase()]))[0];
  if (ex) {
    const bad = auth.pwProblem(pw, email); if (bad) throw new Error(bad);
    await db.run("UPDATE users SET pass=?, role='owner', active=1, must_change=0, fails=0, locked_until=0 WHERE id=?", [await auth.hashPw(pw), ex.id]);
    await db.run('DELETE FROM sessions WHERE uid=?', [ex.id]); console.log('Owner password reset for', email);
  } else { await auth.createUser({ email, name: name || 'Owner', role: 'owner', password: pw, mustChange: false }); console.log('Owner created:', email); }
  await db.close(); process.exit(0);
})().catch(e => { console.error(e.message); process.exit(1); });
