/* Petits outils d'interface (construction du DOM sans innerHTML : les données ne sont jamais interprétées comme du HTML). */
(function () {
  "use strict";
  var TT = window.TT = window.TT || {};

  /* Remplace le contenu d'un élément (équivalent de replaceChildren, compatible avec les anciens WebView Android). */
  TT.replaceAll = function (el) {
    while (el.firstChild) el.removeChild(el.firstChild);
    function put(c) {
      if (c === null || c === undefined || c === false) return;
      if (Array.isArray(c)) c.forEach(put);
      else el.appendChild(c.nodeType ? c : document.createTextNode(String(c)));
    }
    for (var i = 1; i < arguments.length; i++) put(arguments[i]);
    return el;
  };
  TT.h = function (tag, attrs) {
    var el = document.createElement(tag);
    attrs = attrs || {};
    Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v === null || v === undefined || v === false) return;
      if (k === "class") el.className = v;
      else if (k === "text") el.textContent = v;
      else if (k.slice(0, 2) === "on") el.addEventListener(k.slice(2), v);
      else if (k === "value") el.value = v;
      else if (k === "checked" || k === "disabled" || k === "selected" || k === "required") el[k] = !!v;
      else el.setAttribute(k, v === true ? "" : v);
    });
    function put(c) {
      if (c === null || c === undefined || c === false) return;
      if (Array.isArray(c)) c.forEach(put);
      else el.appendChild(c.nodeType ? c : document.createTextNode(String(c)));
    }
    for (var i = 2; i < arguments.length; i++) put(arguments[i]);
    return el;
  };

  function nf(opts) { return new Intl.NumberFormat("fr-FR", opts); }
  var nInt = nf({ maximumFractionDigits: 0 }), nDec = nf({ minimumFractionDigits: 2, maximumFractionDigits: 2 }), nAny = nf({ maximumFractionDigits: 2 });
  TT.fmtInt = function (n) { return nInt.format(n || 0); };
  TT.fmtFC = function (c) { return nAny.format((c || 0) / 100) + " FC"; };
  TT.fmtUSD = function (c) { return nDec.format((c || 0) / 100) + " $"; };
  TT.fmtDate = function (s) {
    if (!s) return "";
    var p = s.slice(0, 10).split("-");
    return p[2] + "/" + p[1] + "/" + p[0];
  };
  TT.today = function () {
    var d = new Date(), p = function (n) { return (n < 10 ? "0" : "") + n; };
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
  };
  TT.MONTHS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
  TT.STATUS = {
    draft: "Brouillon", submitted: "Transmis", needs_correction: "À corriger",
    in_control: "En contrôle", checked: "Contrôlé", validated: "Validé"
  };
  TT.ROLES = {
    community_clerk: "Rapporteur de communauté", community_leader: "Responsable de communauté",
    commission: "Commission de rédaction", commission_deputy: "Commission de rédaction (adjoint)",
    district_admin: "Administrateur du district"
  };
  TT.uuid = function () {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    var b = new Uint8Array(16); crypto.getRandomValues(b);
    b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
    var s = Array.prototype.map.call(b, function (x) { return (x + 256).toString(16).slice(1); }).join("");
    return s.slice(0, 8) + "-" + s.slice(8, 12) + "-" + s.slice(12, 16) + "-" + s.slice(16, 20) + "-" + s.slice(20);
  };
  TT.friendly = function (e) {
    var m = (e && e.message) || "Erreur inconnue";
    if (/Invalid login credentials/i.test(m)) return "E-mail ou mot de passe incorrect.";
    if (/Email not confirmed/i.test(m)) return "Adresse e-mail non confirmée.";
    if (/rate limit|too many/i.test(m)) return "Trop de tentatives. Patientez quelques minutes.";
    if (/same password|different from the old/i.test(m)) return "Le nouveau mot de passe doit être différent de l'ancien.";
    if (/Password should be at least/i.test(m)) return "Mot de passe trop court.";
    if (/reports_territorial_receipt_uniq|duplicate key.*territorial/i.test(m)) return "Ce numéro de reçu territorial est déjà utilisé par une autre fiche.";
    if (e && e.isNetwork) return "Pas de connexion Internet.";
    if (e && e.status === 403 && !/réservé|refusée/i.test(m)) return "Action non autorisée pour votre profil.";
    return m;
  };

  var toastTimer = null;
  TT.toast = function (msg, kind) {
    var el = document.getElementById("toast");
    if (!el) return;
    el.textContent = msg; el.className = "toast show " + (kind || "");
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { el.className = "toast"; }, 4200);
  };
  TT.confirmBox = function (message, okLabel, danger) {
    return new Promise(function (resolve) {
      var h = TT.h;
      var back = h("div", { class: "overlay", role: "dialog", "aria-modal": "true" });
      function close(v) { back.remove(); resolve(v); }
      back.appendChild(h("div", { class: "dialog" },
        h("p", { text: message }),
        h("div", { class: "row end" },
          h("button", { class: "btn ghost", type: "button", onclick: function () { close(false); }, text: "Annuler" }),
          h("button", { class: "btn " + (danger ? "danger" : "primary"), type: "button", onclick: function () { close(true); }, text: okLabel || "Confirmer" }))));
      document.body.appendChild(back);
      back.querySelector(".btn.primary,.btn.danger").focus();
    });
  };
  TT.promptNote = function (title, required, placeholder) {
    return new Promise(function (resolve) {
      var h = TT.h;
      var ta = h("textarea", { rows: "4", id: "note-box", placeholder: placeholder || "" });
      var err = h("p", { class: "error", hidden: true });
      var back = h("div", { class: "overlay", role: "dialog", "aria-modal": "true" });
      function close(v) { back.remove(); resolve(v); }
      back.appendChild(h("div", { class: "dialog" },
        h("label", { for: "note-box", text: title }), ta, err,
        h("div", { class: "row end" },
          h("button", { class: "btn ghost", type: "button", onclick: function () { close(null); }, text: "Annuler" }),
          h("button", { class: "btn primary", type: "button", onclick: function () {
            var v = ta.value.trim();
            if (required && !v) { err.textContent = "Ce message est obligatoire."; err.hidden = false; return; }
            close(v);
          }, text: "Envoyer" }))));
      document.body.appendChild(back); ta.focus();
    });
  };
  TT.csv = function (rows) {
    return "﻿" + rows.map(function (r) {
      return r.map(function (c) { c = String(c == null ? "" : c); return /[;"\n]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c; }).join(";");
    }).join("\r\n");
  };
  TT.download = function (name, text, type) {
    var url = URL.createObjectURL(new Blob([text], { type: type || "text/csv;charset=utf-8" }));
    var a = document.createElement("a"); a.href = url; a.download = name; document.body.appendChild(a); a.click();
    setTimeout(function () { a.remove(); URL.revokeObjectURL(url); }, 500);
  };
})();
