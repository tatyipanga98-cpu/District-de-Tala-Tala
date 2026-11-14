/* Données locales, file d'attente d'envoi et synchronisation (sans doublon, avec reprise et détection de conflit). */
(function () {
  "use strict";
  var TT = window.TT, A = window.TTApi, St = window.TTStore;
  var D = TT.data = {
    profile: null, communities: [], types: [], reports: [], queue: [],
    online: navigator.onLine, syncing: false, lastSync: null, lastError: null, listeners: []
  };
  function uid() { return A.user().id; }
  function emit() { D.listeners.forEach(function (f) { try { f(); } catch (e) { console.error(e); } }); }
  D.subscribe = function (f) { D.listeners.push(f); };
  D.emit = emit;
  function k(name) { return name + ":" + uid(); }
  function err(msg) { var e = new Error(msg); e.status = 400; return e; }

  D.reset = function () { D.profile = null; D.communities = []; D.types = []; D.reports = []; D.queue = []; D.lastError = null; };

  async function cachedOrFetch(name, fetcher) {
    try {
      var data = await fetcher();
      await St.kvSet(k(name), data);
      D.online = true;
      return data;
    } catch (e) {
      if (!e.isNetwork) throw e;
      D.online = false;
      var c = await St.kvGet(k(name));
      return c === undefined ? null : c;
    }
  }

  D.loadLocal = async function () {
    var r = await Promise.all([St.kvGet(k("profile")), St.kvGet(k("communities")), St.kvGet(k("types")), St.kvGet(k("reports")), St.qAll()]);
    D.profile = r[0] || null; D.communities = r[1] || []; D.types = r[2] || []; D.reports = r[3] || [];
    D.queue = r[4].filter(function (q) { return q.uid === uid(); });
  };
  D.loadProfile = async function () {
    var p = await cachedOrFetch("profile", async function () {
      var rows = await A.select("profiles", "select=*&id=eq." + uid());
      return rows[0] || null;
    });
    if (p) D.profile = p;
    return D.profile;
  };
  D.loadRef = async function () {
    var c = await cachedOrFetch("communities", function () { return A.select("communities", "select=id,name,active&order=name.asc"); });
    var t = await cachedOrFetch("types", function () { return A.select("activity_types", "select=*&order=created_at.asc,label.asc"); });
    if (c) D.communities = c; if (t) D.types = t;
  };
  D.loadReports = async function () {
    var r = await cachedOrFetch("reports", function () {
      return A.selectAll("reports", "select=*,report_officiants(*),religious_acts(*)&order=activity_date.desc,created_at.desc");
    });
    if (r) D.reports = r;
    D.lastSync = Date.now();
  };
  D.refresh = async function () {
    await D.loadRef(); await D.loadReports(); emit();
  };

  D.communityName = function (id) { var c = D.communities.find(function (x) { return x.id === id; }); return c ? c.name : "—"; };
  D.type = function (id) { return D.types.find(function (x) { return x.id === id; }); };

  /* Vue fusionnée : données du serveur + éléments en attente d'envoi. */
  D.viewReports = function () {
    var byId = {}, locals = [];
    D.reports.forEach(function (r) { byId[r.id] = Object.assign({}, r, { _sync: null }); });
    D.queue.forEach(function (q) {
      if (q.kind === "insert") {
        if (q.reportId && byId[q.reportId]) { byId[q.reportId]._sync = q.state; byId[q.reportId]._qid = q.qid; byId[q.reportId]._err = q.error; byId[q.reportId]._errKind = q.errorKind; return; }
        locals.push(Object.assign({}, q.payload, {
          id: null, _local: true, _qid: q.qid, _sync: q.state, _err: q.error, _errKind: q.errorKind,
          status: q.wantStatus === "submitted" ? "submitted" : "draft",
          report_officiants: q.officiants || [], religious_acts: q.acts || [], created_at: new Date(q.created_at).toISOString()
        }));
      } else if (q.kind === "update") {
        var r = byId[q.reportId];
        if (r) {
          Object.assign(r, q.patch); if (q.wantStatus) r.status = q.wantStatus;
          r._sync = q.state; r._qid = q.qid; r._err = q.error; r._errKind = q.errorKind; r._pendingEdit = true;
          if (q.addOfficiants) r.report_officiants = q.addOfficiants;
          if (q.addActs) r.religious_acts = q.addActs;
        }
      }
    });
    return locals.concat(Object.keys(byId).map(function (id) { return byId[id]; }));
  };
  D.pendingCount = function () { return D.queue.length; };

  async function save(q) { await St.qPut(q); }
  async function remove(q) {
    await St.qDel(q.qid);
    D.queue = D.queue.filter(function (x) { return x.qid !== q.qid; });
  }

  /* ---- Mise en file d'attente ---- */
  // Chaque envoi porte un identifiant d'opération (op_id). Le serveur le mémorise : si la réponse
  // se perd et que l'envoi est rejoué, rien n'est enregistré deux fois.
  D.enqueueInsert = async function (payload, officiants, acts, submit) {
    var q = {
      qid: TT.uuid(), op_id: TT.uuid(), uid: uid(), kind: "insert", state: "pending", created_at: Date.now(),
      device_record_id: TT.uuid(), payload: payload, officiants: officiants || [], acts: acts || [],
      wantStatus: submit ? "submitted" : "draft", reportId: null
    };
    D.queue.push(q); await save(q); emit(); D.sync();
    return q;
  };
  D.replaceLocalInsert = async function (q, payload, officiants, acts, submit) {
    q.payload = payload; q.officiants = officiants || []; q.acts = acts || []; q.wantStatus = submit ? "submitted" : "draft";
    q.state = "pending"; q.error = null; await save(q); emit(); D.sync();
  };
  D.enqueueUpdate = async function (report, patch, officiants, acts, submit) {
    // Une seule modification en attente par fiche : on fusionne. Intervenants et actes sont remplacés en entier.
    var q = D.queue.find(function (x) { return x.kind === "update" && x.reportId === report.id && x.state !== "conflict"; });
    if (q) {
      q.patch = Object.assign(q.patch || {}, patch || {});
      if (officiants) q.addOfficiants = officiants;
      if (acts) q.addActs = acts;
      if (submit) q.wantStatus = "submitted";
      q.state = "pending"; q.error = null;
    } else {
      var base = (D.reports.find(function (r) { return r.id === report.id; }) || report).updated_at;
      q = {
        qid: TT.uuid(), op_id: TT.uuid(), uid: uid(), kind: "update", state: "pending", created_at: Date.now(), reportId: report.id,
        patch: patch || {}, addOfficiants: officiants || null, addActs: acts || null, wantStatus: submit ? "submitted" : null,
        base_updated_at: base
      };
      D.queue.push(q);
    }
    await save(q); emit(); D.sync();
    return q;
  };
  D.retry = async function (q) { q.state = "pending"; q.error = null; await save(q); emit(); D.sync(); };
  D.discard = async function (q) { await remove(q); emit(); };
  D.resolveConflict = async function (q, keep) {
    if (keep === "server") { await remove(q); await D.refresh(); return; }
    q.base_updated_at = q.serverVersion ? q.serverVersion.updated_at : q.base_updated_at;
    q.state = "pending"; q.error = null; await save(q); emit(); D.sync();
  };

  /* ---- Envoi : une seule fonction serveur par opération ---- */
  function serverPayload(q) {
    var out = { op_id: q.op_id, submit: q.wantStatus === "submitted" };
    if (q.kind === "insert") {
      var fields = Object.assign({}, q.payload || {});
      delete fields.intake_source; delete fields.corrected_from;
      out.device_record_id = q.device_record_id;
      if (q.payload && q.payload.corrected_from) out.corrected_from = q.payload.corrected_from;
      out.fields = fields;
      out.officiants = q.officiants || [];
      out.acts = q.acts || [];
    } else {
      out.id = q.reportId;
      out.base_updated_at = q.base_updated_at;
      if (q.patch && Object.keys(q.patch).length) out.fields = q.patch;
      if (q.addOfficiants) out.officiants = q.addOfficiants;
      if (q.addActs) out.acts = q.addActs;
    }
    return out;
  }
  async function processOne(q) {
    var res;
    try {
      res = await A.rpc("save_report", { p_payload: serverPayload(q) });
    } catch (e) {
      if (e.code === "PT409" && q.kind === "update") {
        // Modifiée ailleurs entre-temps : on propose à l'utilisateur de choisir.
        var cur = await A.select("reports", "select=id,updated_at,status&id=eq." + q.reportId);
        q.state = "conflict"; q.serverVersion = cur[0] || null; await save(q);
        return;
      }
      throw e;
    }
    if (q.kind === "insert" && res && res.id) q.reportId = res.id;
    if (q.kind === "update" && res && res.updated_at) q.base_updated_at = res.updated_at;
    await remove(q);
  }

  var retryTimer = null;
  function scheduleRetry() {
    // Coupure en cours d'envoi alors que l'appareil se croit connecté : nouvel essai rapide.
    if (retryTimer || !navigator.onLine) return;
    retryTimer = setTimeout(function () { retryTimer = null; D.sync(); }, 8000);
  }
  var again = false;
  D.sync = async function () {
    if (!A.session()) return;
    if (D.syncing) { again = true; return; } // demande pendant un envoi : on rejoue à la fin
    D.syncing = true; D.lastError = null; emit();
    try {
      again = false;
      var items = D.queue.slice().sort(function (a, b) { return a.created_at - b.created_at; });
      for (var i = 0; i < items.length; i++) {
        var q = items[i];
        if (q.state !== "pending") continue;
        try {
          await processOne(q);
          D.online = true;
        } catch (e) {
          if (e.isNetwork) { D.online = false; scheduleRetry(); break; }
          // Erreur serveur (5xx) : temporaire, un nouvel essai est possible. Autre erreur (4xx) : l'utilisateur doit agir.
          q.state = "error"; q.error = TT.friendly(e); q.errorKind = (e.status >= 500 || e.status === 0) ? "temporary" : "action"; await save(q);
        }
      }
      if (D.online) { try { await D.loadReports(); } catch (e) { if (!e.isNetwork) D.lastError = TT.friendly(e); } }
    } finally {
      D.syncing = false; emit();
      if (again && D.online) { again = false; D.sync(); }
    }
  };
})();
