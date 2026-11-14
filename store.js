/* Stockage local (IndexedDB) : copie des données + file d'attente d'envoi. Repli en mémoire si indisponible. */
(function () {
  "use strict";
  var mem = { kv: {}, queue: {} };
  var dbp = null, useMem = false;

  function open() {
    if (dbp) return dbp;
    dbp = new Promise(function (resolve, reject) {
      try {
        var r = indexedDB.open("tt_local", 1);
        r.onupgradeneeded = function () {
          var d = r.result;
          d.createObjectStore("kv");
          d.createObjectStore("queue", { keyPath: "qid" });
        };
        r.onsuccess = function () { resolve(r.result); };
        r.onerror = function () { reject(r.error); };
      } catch (e) { reject(e); }
    });
    return dbp;
  }
  function tx(store, mode, fn) {
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        var t = db.transaction(store, mode), s = t.objectStore(store), out = fn(s);
        t.oncomplete = function () { resolve(out && out.result !== undefined ? out.result : undefined); };
        t.onerror = function () { reject(t.error); };
        t.onabort = function () { reject(t.error); };
      });
    });
  }
  async function guard(idbFn, memFn) {
    if (useMem) return memFn();
    try { return await idbFn(); } catch (e) { useMem = true; return memFn(); }
  }
  window.TTStore = {
    kvGet: function (k) { return guard(function () { return tx("kv", "readonly", function (s) { return s.get(k); }); }, function () { return mem.kv[k]; }); },
    kvSet: function (k, v) { return guard(function () { return tx("kv", "readwrite", function (s) { s.put(v, k); }); }, function () { mem.kv[k] = v; }); },
    kvDel: function (k) { return guard(function () { return tx("kv", "readwrite", function (s) { s.delete(k); }); }, function () { delete mem.kv[k]; }); },
    qAll: function () { return guard(function () { return tx("queue", "readonly", function (s) { return s.getAll(); }); }, function () { return Object.values(mem.queue); }).then(function (r) { return r || []; }); },
    qPut: function (item) { return guard(function () { return tx("queue", "readwrite", function (s) { s.put(item); }); }, function () { mem.queue[item.qid] = item; }); },
    qDel: function (qid) { return guard(function () { return tx("queue", "readwrite", function (s) { s.delete(qid); }); }, function () { delete mem.queue[qid]; }); },
    usingMemory: function () { return useMem; }
  };
})();
