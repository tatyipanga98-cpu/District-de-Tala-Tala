/* Liaison avec Supabase sans bibliothèque externe (auth + PostgREST + fonction serveur). */
(function () {
  "use strict";
  var cfg = window.TT_CONFIG;
  var KEY = "tt_session";
  var session = null;

  function ApiError(status, message, code) {
    var e = new Error(message);
    e.status = status; e.code = code || null;
    return e;
  }
  function now() { return Math.floor(Date.now() / 1000); }
  function loadSession() { try { session = JSON.parse(localStorage.getItem(KEY) || "null"); } catch (e) { session = null; } }
  function saveSession(s) {
    session = s;
    try { if (s) localStorage.setItem(KEY, JSON.stringify(s)); else localStorage.removeItem(KEY); } catch (e) {}
  }
  loadSession();

  async function raw(path, opts) {
    opts = opts || {};
    var h = Object.assign({ apikey: cfg.SUPABASE_KEY }, opts.headers || {});
    if (opts.auth !== false && session) h.Authorization = "Bearer " + session.access_token;
    if (opts.body !== undefined && !h["Content-Type"]) h["Content-Type"] = "application/json";
    var res;
    try {
      res = await fetch(cfg.SUPABASE_URL + path, {
        method: opts.method || "GET", headers: h,
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined
      });
    } catch (e) {
      var ne = ApiError(0, "Réseau indisponible"); ne.isNetwork = true; throw ne;
    }
    var txt = await res.text(), data = null;
    if (txt) { try { data = JSON.parse(txt); } catch (e) { data = txt; } }
    if (!res.ok) {
      var msg = (data && (data.msg || data.message || data.error_description || data.error)) || ("Erreur " + res.status);
      throw ApiError(res.status, msg, data && data.code);
    }
    return { data: data, headers: res.headers };
  }

  function setFromToken(d) {
    saveSession({
      access_token: d.access_token, refresh_token: d.refresh_token,
      expires_at: d.expires_at || (now() + (d.expires_in || 3600)), user: d.user || (session && session.user) || null
    });
  }
  async function refresh() {
    if (!session) return;
    try {
      var r = await raw("/auth/v1/token?grant_type=refresh_token", { method: "POST", body: { refresh_token: session.refresh_token }, auth: false });
      setFromToken(r.data);
    } catch (e) {
      if (!e.isNetwork && (e.status === 400 || e.status === 401)) { saveSession(null); if (api.onSignedOut) api.onSignedOut(); }
      throw e;
    }
  }
  async function ensureFresh() {
    if (session && session.expires_at - 60 <= now()) await refresh();
  }
  async function call(path, opts) {
    try { await ensureFresh(); } catch (e) { if (!e.isNetwork) throw e; }
    try { return await raw(path, opts); }
    catch (e) {
      if (e.status === 401 && session && !e.isNetwork) { await refresh(); return raw(path, opts); }
      throw e;
    }
  }

  var api = {
    onSignedOut: null,
    session: function () { return session; },
    user: function () { return session && session.user; },
    async signIn(email, password) {
      var r = await raw("/auth/v1/token?grant_type=password", { method: "POST", body: { email: email, password: password }, auth: false });
      setFromToken(r.data);
      return session.user;
    },
    async recover(email) {
      await raw("/auth/v1/recover?redirect_to=" + encodeURIComponent(location.origin + location.pathname), { method: "POST", body: { email: email }, auth: false });
    },
    async updatePassword(password) { await call("/auth/v1/user", { method: "PUT", body: { password: password } }); },
    async signOut() {
      try { if (session) await raw("/auth/v1/logout", { method: "POST" }); } catch (e) {}
      saveSession(null);
    },
    /* Lien reçu par e-mail : le jeton arrive dans le « # » de l'adresse. */
    async consumeUrlHash() {
      var h = location.hash.replace(/^#/, "");
      if (h.indexOf("access_token=") < 0 && h.indexOf("error=") < 0) return null;
      var p = new URLSearchParams(h);
      history.replaceState(null, "", location.pathname + location.search);
      if (p.get("error")) return { error: p.get("error_description") || p.get("error") };
      saveSession({
        access_token: p.get("access_token"), refresh_token: p.get("refresh_token"),
        expires_at: now() + Number(p.get("expires_in") || 3600), user: null
      });
      var u = await raw("/auth/v1/user");
      session.user = u.data; saveSession(session);
      return { type: p.get("type") };
    },
    select: async function (table, qs) { return (await call("/rest/v1/" + table + (qs ? "?" + qs : ""))).data; },
    selectAll: async function (table, qs, page) {
      page = page || 1000; var out = [], from = 0;
      for (;;) {
        var r = await call("/rest/v1/" + table + (qs ? "?" + qs : ""), { headers: { "Range-Unit": "items", Range: from + "-" + (from + page - 1) } });
        out = out.concat(r.data || []);
        if (!r.data || r.data.length < page) break;
        from += page;
      }
      return out;
    },
    insert: async function (table, rows) {
      return (await call("/rest/v1/" + table, { method: "POST", body: rows, headers: { Prefer: "return=representation" } })).data;
    },
    update: async function (table, qs, patch) {
      var d = (await call("/rest/v1/" + table + "?" + qs, { method: "PATCH", body: patch, headers: { Prefer: "return=representation" } })).data;
      if (!d || !d.length) throw ApiError(403, "Modification refusée ou fiche introuvable.", "NO_ROW");
      return d;
    },
    rpc: async function (fn, args) { return (await call("/rest/v1/rpc/" + fn, { method: "POST", body: args || {} })).data; },
    fn: async function (name, body) { return (await call("/functions/v1/" + name, { method: "POST", body: body })).data; }
  };
  window.TTApi = api;
})();
