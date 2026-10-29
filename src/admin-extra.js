/* Admin pages that only exist on the server: Users, Activity, Backups, My account. */
(function () {
  if (!window.SERVER_MODE) return;
  var E = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var Q = function (s, r) { return (r || document).querySelector(s); };
  var T = function (t) { return t ? new Date(t).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }) : 'Never'; };
  var genPw = function () { var a = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789', o = '', r = new Uint32Array(16); crypto.getRandomValues(r); r.forEach(function (x) { o += a[x % a.length]; }); return o.slice(0, 5) + '-' + o.slice(5, 10) + '-' + o.slice(10, 16) + '7'; };
  var msg = function (box, text, bad) { var m = Q('.xmsg', box); if (m) { m.textContent = text || ''; m.style.color = bad ? '#b3261e' : 'var(--cu)'; } };
  var ROLES = { owner: 'Owner: everything, including users, activity and backups', manager: 'Manager: vehicles, customers, leads and reports', sales: 'Sales: only their own customers in the CRM' };

  window.rUsr = function () {
    var box = Q('#v-usr'); box.innerHTML = '<p class="fine">Loading…</p>';
    API('GET', '/api/users').then(function (U) {
      box.innerHTML = '<div class="card"><h3 style="font-size:26px;margin-bottom:6px">Add a team member</h3><p class="fine">They sign in with the email and temporary password below and must choose a new password on first sign-in.</p>' +
        '<div class="fg"><div><label for="un">Full name</label><input id="un" autocomplete="off"></div><div><label for="ue">Email</label><input id="ue" type="email" autocomplete="off"></div><div><label for="ur">Role</label><select id="ur"><option value="sales">Sales</option><option value="manager">Manager</option><option value="owner">Owner</option></select></div><div><label for="up">Temporary password</label><input id="up" value="' + E(genPw()) + '" autocomplete="off"></div></div>' +
        '<p class="fine" id="urh">' + E(ROLES.sales) + '</p><p><button class="btn" id="ua">Create account</button> <span class="xmsg fine" role="status"></span></p></div>' +
        '<div class="tw"><table><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>Last sign-in</th><th></th></tr>' + U.map(function (u) {
          return '<tr data-u="' + E(u.id) + '"><td>' + E(u.name) + '</td><td>' + E(u.email) + '</td><td><select data-f="role">' + ['sales', 'manager', 'owner'].map(function (r) { return '<option value="' + r + '"' + (r === u.role ? ' selected' : '') + '>' + r + '</option>'; }).join('') + '</select></td><td><span class="st ' + (u.active ? 'available' : 'draft') + '">' + (u.active ? 'active' : 'disabled') + '</span></td><td>' + E(T(u.lastLogin)) + '</td><td class="ac"><button data-a="toggle">' + (u.active ? 'Disable' : 'Enable') + '</button><button data-a="reset">Reset password</button></td></tr>';
        }).join('') + '</table></div><p class="xmsg2 fine" role="status"></p>';
      Q('#ur', box).onchange = function () { Q('#urh', box).textContent = ROLES[this.value]; };
      Q('#ua', box).onclick = function () {
        API('POST', '/api/users', { name: Q('#un', box).value, email: Q('#ue', box).value, role: Q('#ur', box).value, password: Q('#up', box).value }).then(function () {
          alertBox(box, 'Account created. Give them this temporary password: ' + Q('#up', box).value); window.rUsr();
        }).catch(function (e) { msg(box, e.message, true); });
      };
      box.onclick = function (ev) {
        var b = ev.target.closest('button[data-a]'); if (!b) return; var tr = b.closest('tr'), id = tr.dataset.u, u = U.find(function (x) { return x.id === id; });
        if (b.dataset.a === 'toggle') API('PATCH', '/api/users/' + id, { active: !u.active }).then(window.rUsr).catch(function (e) { alertBox(box, e.message, true); });
        if (b.dataset.a === 'reset') { var pw = genPw(); API('PATCH', '/api/users/' + id, { password: pw }).then(function () { alertBox(box, 'New temporary password for ' + u.name + ': ' + pw + ' (they must change it at next sign-in; any open sessions were ended).'); }).catch(function (e) { alertBox(box, e.message, true); }); }
      };
      box.onchange = function (ev) {
        var s = ev.target.closest('select[data-f=role]'); if (!s) return; var id = s.closest('tr').dataset.u;
        API('PATCH', '/api/users/' + id, { role: s.value }).then(window.rUsr).catch(function (e) { alertBox(box, e.message, true); window.rUsr(); });
      };
    }).catch(function (e) { box.innerHTML = '<p class="fine">' + E(e.message) + '</p>'; });
  };
  function alertBox(box, text, bad) { var m = Q('.xmsg2', box); if (m) { m.textContent = text; m.style.color = bad ? '#b3261e' : 'var(--ink)'; m.style.fontWeight = 500; } }

  var AUD = { rows: [], done: false };
  var label = function (a) { return ({ 'login.ok': 'Signed in', 'login.fail': 'Failed sign-in', 'login.locked': 'Locked out', logout: 'Signed out', 'vehicles.create': 'Added vehicle', 'vehicles.update': 'Edited vehicle', 'vehicles.delete': 'Deleted vehicle', 'deals.create': 'Added customer', 'deals.update': 'Edited customer', 'deals.delete': 'Deleted customer', 'leads.create': 'New website request', 'leads.update': 'Edited lead', 'leads.delete': 'Deleted lead', 'photo.upload': 'Uploaded photo', 'user.create': 'Created user', 'user.update': 'Changed user', 'user.password.self': 'Changed own password', 'backup.create': 'Created backup', 'backup.download': 'Downloaded backup', 'backup.restore': 'Restored backup', seed: 'Loaded starting inventory' })[a] || a; };
  var detail = function (d) {
    if (!d) return ''; if (d.changed) { var k = Object.keys(d.changed).filter(function (x) { return x !== 'updatedAt' && x !== 'hist'; }).slice(0, 6); return (d.label ? d.label + ': ' : '') + (k.length ? 'changed ' + k.join(', ') : 'saved'); }
    if (d.label) return d.label; if (d.email) return d.email + (d.role ? ' (' + d.role + ')' : ''); if (d.source) return d.source; return Object.keys(d).slice(0, 4).map(function (k) { return k + ': ' + d[k]; }).join(', ');
  };
  window.rAud = function (more) {
    var box = Q('#v-aud'); if (!more) { AUD = { rows: [], done: false }; }
    var before = AUD.rows.length ? AUD.rows[AUD.rows.length - 1].id : '';
    API('GET', '/api/audit?limit=100' + (before ? '&before=' + encodeURIComponent(before) : '')).then(function (r) {
      AUD.rows = AUD.rows.concat(r); AUD.done = r.length < 100;
      box.innerHTML = '<p class="fine">Every sign-in, edit, delete and upload, with who did it and when. Entries cannot be edited.</p><div class="tw"><table><tr><th>When</th><th>Who</th><th>What</th><th>Details</th><th>IP</th></tr>' +
        AUD.rows.map(function (x) { return '<tr><td>' + E(T(x.at)) + '</td><td>' + E(x.uname || 'Website visitor') + '</td><td>' + E(label(x.action)) + '</td><td>' + E(detail(x.detail)) + '</td><td><small>' + E(x.ip || '') + '</small></td></tr>'; }).join('') + '</table></div>' + (AUD.done ? '' : '<p><button class="btn o" id="am">Load older</button></p>');
      var b = Q('#am', box); if (b) b.onclick = function () { window.rAud(true); };
    }).catch(function (e) { box.innerHTML = '<p class="fine">' + E(e.message) + '</p>'; });
  };

  window.rBak = function () {
    var box = Q('#v-bak');
    API('GET', '/api/backups').then(function (B) {
      var sz = function (n) { return n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB'; };
      box.innerHTML = '<div class="card"><h3 style="font-size:26px;margin-bottom:6px">Backups</h3><p class="fine">A backup of vehicles, customers, payments and leads is made automatically every day (the last 30 are kept). Make a full backup, which includes photos, before big changes. Download a copy now and then and keep it somewhere outside this site.</p><p><button class="btn" id="bn">Back up now</button> <button class="btn o" id="bf">Full backup with photos</button> <span class="xmsg fine" role="status"></span></p></div>' +
        '<div class="tw"><table><tr><th>When</th><th>Type</th><th>Size</th><th></th></tr>' + B.map(function (b) { return '<tr data-b="' + E(b.id) + '"><td>' + E(T(b.at)) + '</td><td>' + E(b.kind) + '</td><td>' + sz(b.size) + '</td><td class="ac"><a class="btn o sm" href="/api/backups/' + E(b.id) + '/download">Download</a> <button data-a="restore">Restore</button></td></tr>'; }).join('') + '</table></div>' +
        '<div class="card" id="rsb" hidden><h3 style="font-size:22px">Restore this backup?</h3><p class="fine">This replaces all current vehicles, customers and leads with the backup. A safety copy of today’s data is made first. Type RESTORE to confirm.</p><p><input id="rst" style="max-width:220px"> <button class="btn" id="rsg">Restore</button> <button class="btn o" id="rsc">Cancel</button></p></div>';
      var make = function (full) { msg(box, 'Working…'); API('POST', '/api/backups', { full: full }).then(function () { window.rBak(); }).catch(function (e) { msg(box, e.message, true); }); };
      Q('#bn', box).onclick = function () { make(false); }; Q('#bf', box).onclick = function () { make(true); };
      var pick = null;
      box.onclick = function (ev) {
        var b = ev.target.closest('button[data-a=restore]'); if (b) { pick = b.closest('tr').dataset.b; Q('#rsb', box).hidden = false; Q('#rst', box).value = ''; Q('#rst', box).focus(); }
        if (ev.target.id === 'rsc') Q('#rsb', box).hidden = true;
        if (ev.target.id === 'rsg') API('POST', '/api/backups/' + pick + '/restore', { confirm: Q('#rst', box).value }).then(function (r) { msg(box, 'Restored ' + r.docs + ' records.'); Q('#rsb', box).hidden = true; window.rBak(); }).catch(function (e) { msg(box, e.message, true); });
      };
    }).catch(function (e) { box.innerHTML = '<p class="fine">' + E(e.message) + '</p>'; });
  };

  window.rAcc = function () {
    var box = Q('#v-acc');
    API('GET', '/api/me').then(function (j) {
      var u = j.user;
      box.innerHTML = '<div class="card" style="max-width:520px"><h3 style="font-size:26px;margin-bottom:4px">' + E(u.name) + '</h3><p class="fine">' + E(u.email) + ' · ' + E(u.role) + '</p>' + (u.mustChange ? '<p style="color:#b3261e;font-weight:500">Choose a new password to continue.</p>' : '') +
        '<label for="pc">Current password</label><input id="pc" type="password" autocomplete="current-password"><label for="pn">New password</label><input id="pn" type="password" autocomplete="new-password"><label for="pn2">Repeat new password</label><input id="pn2" type="password" autocomplete="new-password"><p class="fine">At least 12 characters, with letters and numbers or symbols. Changing it signs you out on other devices.</p><p><button class="btn" id="pg">Change password</button> <span class="xmsg fine" role="status"></span></p></div>';
      Q('#pg', box).onclick = function () {
        if (Q('#pn', box).value !== Q('#pn2', box).value) { msg(box, 'The new passwords do not match.', true); return; }
        API('POST', '/api/me/password', { current: Q('#pc', box).value, password: Q('#pn', box).value }).then(function () { window.__mustChange = false; msg(box, 'Password changed.'); setTimeout(function () { location.href = '/admin/'; }, 800); }).catch(function (e) { msg(box, e.message, true); });
      };
    });
  };

  var ai = document.getElementById('ai'); if (ai) ai.hidden = true; // AI descriptions are not available on the server version
  document.addEventListener('click', function (e) {
    var a = e.target.closest('#so'); if (!a) return; e.preventDefault();
    API('POST', '/api/logout', {}).catch(function () {}).then(function () { location.href = '/login/'; });
  });
})();
