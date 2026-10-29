/* Connects the existing admin/CRM code to the server API.
   Provides the small `window.claude.use()` surface the app code expects: db, user, assets, downloads.
   Only active in server mode (window.SERVER_MODE). */
(function () {
  if (!window.SERVER_MODE) return;
  var ME = null, CSRF = '';
  var meP = fetch('/api/me', { credentials: 'same-origin' }).then(function (r) { return r.json(); }).then(function (j) { ME = j.user || null; CSRF = j.csrf || ''; window.__mustChange = !!(ME && ME.mustChange); return ME; }).catch(function () { return null; });

  function api(method, path, body, raw, type) {
    var h = {};
    if (method !== 'GET') h['X-CSRF-Token'] = CSRF;
    if (body !== undefined && !raw) h['Content-Type'] = 'application/json';
    if (raw && type) h['Content-Type'] = type;
    return fetch(path, { method: method, headers: h, credentials: 'same-origin', body: raw ? body : (body === undefined ? undefined : JSON.stringify(body)) }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) { var e = new Error(j.error || ('Error ' + r.status)); e.status = r.status; throw e; }
        return j;
      });
    });
  }
  window.API = api;
  window.apiCsrf = function () { return CSRF; };

  var subs = [];
  function wrap(col, x) { return col === 'leads' ? { id: x.id, data: function () { return { items: [x.data] }; } } : { id: x.id, data: function () { return x.data; } }; }
  function pull(sub) {
    return api('GET', '/api/c/' + sub.col).then(function (rows) {
      var key = JSON.stringify(rows); if (key === sub.last) return; sub.last = key;
      var docs = rows.map(function (x) { return wrap(sub.col, x); });
      sub.cb({ empty: !docs.length, docs: docs });
    }).catch(function (e) { if (!sub.failed) { sub.failed = true; if (sub.err) sub.err(e); } });
  }
  function refresh(col) { subs.forEach(function (s) { if (s.col === col) pull(s); }); }
  setInterval(function () { if (document.visibilityState === 'visible') subs.forEach(pull); }, 6000);

  var db = {
    collection: function (col) {
      return { onSnapshot: function (cb, err) { var s = { col: col, cb: cb, err: err, last: null }; subs.push(s); pull(s); return function () { subs = subs.filter(function (x) { return x !== s; }); }; } };
    },
    doc: function (path) {
      var p = path.split('/'), col = p[0], id = p[1];
      var lead = col === 'leads', url = '/api/c/' + col + '/' + encodeURIComponent(id);
      var body = function (d) { return lead ? (d.items && d.items[0]) || {} : d; };
      var after = function (r) { refresh(col); return r; };
      return {
        get: function () {
          return api('GET', url).then(function (x) { var w = wrap(col, x); return { exists: true, data: w.data }; }).catch(function (e) { if (e.status === 404) return { exists: false, data: function () { return undefined; } }; throw e; });
        },
        set: function (d) { return api('PUT', url, body(d)).then(after); },
        update: function (d) { return api('PATCH', url, body(d)).then(after); },
        delete: function () { return api('DELETE', url).then(after); }
      };
    }
  };
  var staff = function (r) { return ME && (!r || r.indexOf(ME.role) >= 0); };
  window.claude = {
    use: function (name) {
      return meP.then(function () {
        if (name === 'db') return staff() ? db : null;
        if (name === 'user') return { canEdit: function () { return Promise.resolve(!!ME); }, isOwner: function () { return !!ME && ME.role === 'owner'; }, id: function () { return Promise.resolve(ME && ME.id); }, role: function () { return ME && ME.role; }, me: function () { return Promise.resolve(ME); } };
        if (name === 'assets') return staff(['owner', 'manager']) ? { upload: function (blob) { return api('POST', '/api/upload', blob, true, 'application/octet-stream'); } } : null;
        if (name === 'downloads') return { save: function (o) {
          var b = o.data instanceof Blob ? o.data : new Blob([o.data], { type: /\.csv$/.test(o.filename) ? 'text/csv;charset=utf-8' : 'application/json' });
          var a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = String(o.filename).replace(/[^\w.\-]+/g, '_'); document.body.appendChild(a); a.click();
          setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000); return Promise.resolve({ status: 'saved' });
        } };
        return null;
      });
    }
  };

  /* Cloudflare Turnstile on the public forms (only when a site key is configured) */
  if (window.TURNSTILE_SITE_KEY) {
    window.__tsr = function () {
      document.querySelectorAll('form[data-lead]').forEach(function (f) {
        var d = f.querySelector('.ts'); if (d && f._ts == null) f._ts = window.turnstile.render(d, { sitekey: window.TURNSTILE_SITE_KEY });
      });
    };
    var sc = document.createElement('script'); sc.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=__tsr'; sc.async = true; document.head.appendChild(sc);
  }
})();
