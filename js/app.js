/* Écrans de l'application. */
(function () {
  "use strict";
  var TT = window.TT, h = TT.h, A = window.TTApi, D = TT.data, S = window.TTStats;
  var root = document.getElementById("app");
  var state = { screen: "home", params: {}, recovery: false, listFilter: { status: "", community: "", month: "", q: "" }, listLimit: 50, stats: null, reviewTab: "todo" };
  var LIST_PAGE = 50;
  var timer = null;

  /* ---------- Rôles ---------- */
  function role() { return D.profile && D.profile.role; }
  function isCommunity() { return role() === "community_clerk" || role() === "community_leader"; }
  function isCommission() { return role() === "commission" || role() === "commission_deputy"; }
  function isAdmin() { return role() === "district_admin"; }
  function isObserver() { return role() === "district_leader" || role() === "district_deputy"; }
  function canEditReport(r) {
    if (r.status === "validated") return false;
    if (isCommunity()) return r.status === "draft" || r.status === "needs_correction";
    return isCommission();
  }

  /* ---------- Navigation ---------- */
  function go(screen, params, push) {
    if (state.screen === "form" && formDirty && screen !== "form" && !window.confirm("Vous avez une saisie non enregistrée. La quitter quand même ?")) return;
    state.screen = screen; state.params = params || {}; state.listLimit = LIST_PAGE;
    if (push !== false) { try { history.pushState({ screen: screen, params: state.params }, ""); } catch (e) {} }
    render(); window.scrollTo(0, 0);
    if (push !== false) { var m = document.getElementById("main"); if (m) m.focus({ preventScroll: true }); }
  }
  window.addEventListener("popstate", function (e) {
    if (!D.profile) return;
    if (e.state && e.state.screen) go(e.state.screen, e.state.params, false); else go("home", {}, false);
  });

  /* ---------- Éléments communs ---------- */
  function chip(text, kind) { return h("span", { class: "chip " + (kind || ""), text: text }); }
  var STATUS_ICON = { draft: "✎", submitted: "✉", needs_correction: "!", in_control: "⏱", checked: "◎", validated: "✔" };
  function statusChip(s) {
    var kind = { draft: "", submitted: "info", needs_correction: "warn", in_control: "info", checked: "info", validated: "good" }[s] || "";
    return h("span", { class: "chip ico " + kind }, h("span", { "aria-hidden": "true", text: STATUS_ICON[s] || "" }), " " + (TT.STATUS[s] || s));
  }
  /* ---------- États vides : pictogramme, titre, explication et action secondaire ---------- */
  function emptyState(icon, title, text, action) {
    return h("div", { class: "empty-state" },
      h("span", { class: "es-ico", "aria-hidden": "true", text: icon }),
      h("h3", { text: title }),
      text ? h("p", { class: "muted", text: text }) : null,
      action || null);
  }
  function syncChip(r) {
    if (!r._sync) return null;
    if (r._sync === "pending") return chip("En attente d'envoi", "warn");
    if (r._sync === "conflict") return chip("Conflit", "bad");
    return chip("Erreur d'envoi", "bad");
  }
  function pwField(input) {
    var btn = h("button", { class: "pw-toggle", type: "button", "aria-pressed": "false", "aria-label": "Afficher le mot de passe", text: "Afficher" });
    btn.addEventListener("click", function () {
      var show = input.type === "password";
      input.type = show ? "text" : "password";
      btn.textContent = show ? "Masquer" : "Afficher";
      btn.setAttribute("aria-pressed", show ? "true" : "false");
      btn.setAttribute("aria-label", show ? "Masquer le mot de passe" : "Afficher le mot de passe");
    });
    return h("div", { class: "pw-wrap" }, input, btn);
  }
  function reqField(label, input, hint) {
    return h("div", { class: "field" }, h("label", { for: input.id, text: label }, h("span", { class: "req", "aria-hidden": "true", text: " *" })), input, hint ? h("p", { class: "hint", text: hint }) : null);
  }
  function sectionHead(n, title) {
    return h("div", { class: "form-sec-head" }, h("span", { class: "step-no", "aria-hidden": "true", text: String(n) }), h("h3", { text: title }));
  }
  function field(label, input, hint, id) {
    return h("div", { class: "field" }, h("label", { for: id || input.id, text: label }), input, hint ? h("p", { class: "hint", text: hint }) : null);
  }
  function opt(value, label, selected) { return h("option", { value: value, text: label, selected: selected }); }

  function header() {
    var pending = D.pendingCount();
    var sync = h("button", { class: "icon-btn", type: "button", id: "sync-btn", disabled: D.syncing, onclick: manualSync,
      "aria-label": "Synchroniser" + (pending ? " (" + pending + " en attente)" : ""), title: "Synchroniser" });
    sync.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 11a8 8 0 0 0-14.9-3.5L4 9"/><path d="M4 4v5h5"/><path d="M4 13a8 8 0 0 0 14.9 3.5L20 15"/><path d="M20 20v-5h-5"/></svg>' + (pending ? '<span class="sync-count">' + Number(pending) + '</span>' : "");
    return h("header", { class: "top" },
      h("div", { class: "brand" }, h("img", { src: "icons/logo-badge.png", alt: "", width: "36", height: "36" }), h("span", { text: "Tala-Tala" }, h("small", { text: "Champ apostolique de Kinshasa-Centre 2" }))),
      h("div", { class: "top-right" },
        h("span", { class: "pill " + (D.online ? "on" : "off"), text: D.online ? "En ligne" : "Hors ligne" }),
        sync));
  }
  var NAV_ICONS = {
    account: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/>',
    home: '<path d="M3 11l9-8 9 8v10a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
    reports: '<path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5M9 13h7M9 17h7"/>',
    form: '<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>',
    review: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M8.5 12l2.5 2.5L16 9.5"/>',
    stats: '<path d="M4 20V10M10 20V4M16 20v-7M2 20h20"/>',
    accounts: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.5-4 3-6 6.5-6s6 2 6.5 6M17 7.5a3 3 0 0 1 0 6M18.5 14.5c2 .7 3 2.5 3.2 5"/>'
  };
  function navIcon(name) {
    var sp = h("span", { class: "ni", "aria-hidden": "true" });
    sp.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + (NAV_ICONS[name] || "") + "</svg>";
    return sp;
  }
  function nav() {
    var items;
    if (isObserver()) {
      items = [["home", "Accueil"], ["reports", "Activités"], ["stats", "Statistiques"], ["account", "Compte"]];
    } else {
      items = [["home", "Accueil"], ["reports", "Activités"], ["form", "Nouvelle"]];
      if (isCommission() || isAdmin()) items.push(["review", isCommission() ? "Contrôle / Valider" : "Contrôle"]);
      items.push(["stats", "Statistiques"]);
    }
    if (!isObserver()) items.push(["account", "Compte"]);
    return h("nav", { class: "bottom", "aria-label": "Navigation" }, items.map(function (it) {
      var active = state.screen === it[0] || (state.screen === "detail" && it[0] === "reports");
      return h("button", { type: "button", class: active ? "active" : "", "aria-current": active ? "page" : null, onclick: function () { go(it[0], {}); } }, navIcon(it[0]), h("span", { text: it[0] === "stats" ? "Stats" : it[1] }));
    }));
  }
  function shell(content) {
    TT.replaceAll(root, h("a", { class: "skip", href: "#main", text: "Aller au contenu" }), header(), h("main", { id: "main", tabindex: "-1" }, content), nav());
  }
  async function manualSync() {
    if (!navigator.onLine) { D.online = false; TT.toast("Pas de connexion Internet.", "bad"); render(); return; }
    D.online = true;
    await D.sync();
    try { await D.loadRef(); } catch (e) {}
    TT.toast(D.pendingCount() ? "Certains éléments n'ont pas pu être envoyés." : "Synchronisé.", D.pendingCount() ? "bad" : "good");
    render();
  }
  async function endSession(message, kind) {
    var uid = A.user() && A.user().id;
    clearInterval(timer);
    await A.signOut();
    if (uid) { try { await Promise.all(["profile", "communities", "types", "reports"].map(function (n) { return TTStore.kvDel(n + ":" + uid); })); } catch (e) {} }
    D.reset(); showLogin(message, kind);
  }
  async function logout() {
    var pend = D.pendingCount();
    var msg = pend ? "Vous avez " + pend + " élément(s) non envoyé(s). Ils restent sur cet appareil mais ne seront envoyés qu'après reconnexion avec ce même compte. Quitter ?" : "Quitter l'application ?";
    if (!await TT.confirmBox(msg, "Quitter")) return;
    await endSession();
  }

  var IDLE_MS = 30 * 60 * 1000, lastActivity = Date.now();
  ["pointerdown", "keydown", "touchstart"].forEach(function (ev) {
    window.addEventListener(ev, function () { lastActivity = Date.now(); }, { passive: true });
  });
  setInterval(function () {
    if (!A.session() || !D.profile) return;
    if (Date.now() - lastActivity < IDLE_MS || formDirty) return;
    endSession("Session fermée après 30 minutes sans activité. Vos saisies non envoyées restent sur cet appareil.", "bad");
  }, 30000);

  /* ---------- Connexion ---------- */
  function showLogin(message, kind, view) {
    var mode = view || "login";
    var email = h("input", { id: "login-email", type: "email", autocomplete: "username", required: true, inputmode: "email" });
    var pass = h("input", { id: "login-pass", type: "password", autocomplete: "current-password", required: true });
    var msg = h("p", { class: "msg " + (kind || ""), role: "status", text: message || "", hidden: !message });
    var btn = h("button", { class: "btn primary block", type: "submit", text: mode === "login" ? "Se connecter" : "Envoyer le lien" });
    function say(t, k) { msg.textContent = t; msg.className = "msg " + (k || ""); msg.hidden = !t; }
    var form = h("form", { class: "card login", onsubmit: async function (ev) {
      ev.preventDefault();
      if (!navigator.onLine) { say("Une connexion Internet est nécessaire pour se connecter.", "bad"); return; }
      btn.disabled = true; say("");
      try {
        if (mode === "login") { await A.signIn(email.value.trim(), pass.value); await startSession(); }
        else { await A.recover(email.value.trim()); say("Si cette adresse correspond à un compte, un lien de réinitialisation vient d'être envoyé. Ouvrez-le depuis ce téléphone.", "good"); btn.disabled = false; }
      } catch (e) { say(TT.friendly(e), "bad"); btn.disabled = false; }
    } },
      h("h2", { text: mode === "login" ? "Se connecter" : "Réinitialiser le mot de passe" }),
      h("p", { class: "sub", text: mode === "login" ? "Accès réservé aux responsables du district." : "Un lien vous sera envoyé par e-mail." }),
      field("Adresse e-mail", email),
      mode === "login" ? field("Mot de passe", pwField(pass), null, "login-pass") : null,
      msg, btn,
      h("button", { class: "linklike", type: "button", onclick: function () { showLogin("", "", mode === "login" ? "recover" : "login"); }, text: mode === "login" ? "Mot de passe oublié ?" : "Retour à la connexion" }));
    var brandPanel = h("aside", { class: "auth-brand" },
      h("img", { class: "login-logo", src: "icons/logo.png", alt: "Église Néo-Apostolique de la RDC-Ouest" }),
      h("h1", { text: "District de Tala-Tala" }),
      h("p", { class: "place", text: "Champ apostolique de Kinshasa-Centre 2" }));
    TT.replaceAll(root, h("div", { class: "auth" }, brandPanel, h("main", { class: "auth-form" }, form,
      h("p", { class: "foot", text: "Fonctionne hors connexion après la première ouverture. Vos saisies sont conservées sur l'appareil et envoyées dès le retour d'Internet." }))));
  }

  function showPasswordChange(reason) {
    var p1 = h("input", { id: "np1", type: "password", autocomplete: "new-password", required: true, minlength: "8" });
    var p2 = h("input", { id: "np2", type: "password", autocomplete: "new-password", required: true, minlength: "8" });
    var msg = h("p", { class: "msg", hidden: true, role: "status" });
    var btn = h("button", { class: "btn primary block", type: "submit", text: "Enregistrer le mot de passe" });
    function say(t, k) { msg.textContent = t; msg.className = "msg " + (k || ""); msg.hidden = !t; }
    TT.replaceAll(root, h("main", { class: "center login-screen" }, h("form", { class: "card login", onsubmit: async function (ev) {
      ev.preventDefault();
      if (p1.value.length < 8) { say("Au moins 8 caractères.", "bad"); return; }
      if (p1.value !== p2.value) { say("Les deux mots de passe ne sont pas identiques.", "bad"); return; }
      if (!navigator.onLine) { say("Connexion Internet nécessaire.", "bad"); return; }
      btn.disabled = true;
      try {
        await A.updatePassword(p1.value);
        await A.rpc("mark_password_changed");
        if (D.profile) D.profile.must_change_password = false;
        state.recovery = false; enterApp();
      } catch (e) { say(TT.friendly(e), "bad"); btn.disabled = false; }
    } },
      h("h1", { text: "Nouveau mot de passe" }),
      h("p", { class: "sub", text: reason || "Choisissez un mot de passe personnel (8 caractères minimum)." }),
      field("Nouveau mot de passe", pwField(p1), null, "np1"), field("Confirmer", pwField(p2), null, "np2"), msg, btn,
      h("button", { class: "linklike", type: "button", onclick: logout, text: "Quitter" }))));
  }

  /* ---------- Démarrage ---------- */
  async function startSession() {
    TT.replaceAll(root, h("main", { class: "center" }, h("p", { class: "sub", text: "Chargement…" })));
    await D.loadLocal();
    try { await D.loadProfile(); } catch (e) {
      if (!e.isNetwork) { await A.signOut(); showLogin(TT.friendly(e), "bad"); return; }
    }
    if (!D.profile) {
      await A.signOut();
      showLogin(D.online ? "Ce compte n'a pas de profil. Contactez l'administrateur du district." : "Première connexion : une connexion Internet est nécessaire.", "bad");
      return;
    }
    if (D.profile.active === false) { await A.signOut(); showLogin("Ce compte est désactivé.", "bad"); return; }
    if (state.recovery) { showPasswordChange("Choisissez votre nouveau mot de passe."); return; }
    if (D.profile.must_change_password && D.online) { showPasswordChange("Pour votre sécurité, remplacez le mot de passe provisoire."); return; }
    enterApp();
  }
  var subscribed = false;
  function enterApp() {
    if (!subscribed) {
      subscribed = true;
      D.subscribe(function () {
        if (D.profile && !document.querySelector(".overlay") && state.screen !== "form" && state.screen !== "accounts") render();
      });
    }
    go("home", {}, false);
    try { history.replaceState({ screen: "home", params: {} }, ""); } catch (e) {}
    D.refresh().then(function () { return D.sync(); }).then(render).catch(function (e) { if (!e.isNetwork) TT.toast(TT.friendly(e), "bad"); render(); });
    clearInterval(timer);
    timer = setInterval(function () { if (navigator.onLine && D.pendingCount() && !D.syncing) D.sync(); }, 45000);
  }

  /* ---------- Salutation et rappel des services divins ---------- */
  function greeting() {
    var name = (D.profile && D.profile.display_name || "").trim();
    if (!name) return "Bonjour";
    var titles = (window.TT_CONFIG && window.TT_CONFIG.HONORIFICS) || {};
    var title = titles[name.toLowerCase()];
    if (title) return "Bonjour, " + title + " " + name.split(/\s+/)[0] + ".";
    return "Bonjour, " + (isCommunity() ? name.split(/\s+/)[0] : name) + ".";
  }
  function typeLabelOf(r) { var t = D.type(r.activity_type_id); return t ? t.label : ""; }
  function dayMonth(iso) {
    var p = (iso || "").slice(0, 10).split("-");
    return p.length === 3 ? (+p[2]) + " " + TT.MONTHS[(+p[1]) - 1] : "";
  }
  function nounCommunities(n) { return n + " communauté" + (n > 1 ? "s" : ""); }

  /* Premier bloc : l'état de la semaine (rapporteur). */
  function weekBlock(info) {
    var mine = D.viewReports().filter(function (r) { return TTSchedule.matches(r, info, typeLabelOf); });
    var sent = mine.filter(function (r) { return r.status !== "draft" && r.status !== "needs_correction"; })[0];
    var draft = mine.filter(function (r) { return r.status === "draft" || r.status === "needs_correction"; })[0];
    var late = TTSchedule.isLate(info, new Date());
    var what = "Service divin du " + info.day + " " + dayMonth(info.date);
    if (sent) {
      return h("section", { class: "card service ok" }, h("h3", { text: what }), h("p", { text: "Le rapport est transmis. Merci." }));
    }
    var types = D.types.filter(function (x) { return x.active && /^service divin ordinaire/i.test(x.label); });
    var action = function () {
      if (draft) go("form", draft._local ? { qid: draft._qid } : { id: draft.id });
      else go("form", { presetDate: info.date, presetType: types[0] && types[0].id });
    };
    var deadline = late
      ? "L'échéance (" + info.deadlineLabel + ") est passée. Transmettez-le dès que possible."
      : "À transmettre avant " + info.deadlineLabel + ".";
    var lines = draft
      ? [h("p", { text: "Votre brouillon du " + dayMonth(draft.activity_date) + " n'a pas été transmis." }), h("p", { class: "muted", text: deadline })]
      : [h("p", { text: "Le rapport du service divin n'est pas encore rédigé. " + deadline })];
    return h("section", { class: "card service" + (late ? " late" : "") },
      h("h3", { text: what }), lines,
      h("button", { class: "linklike alert-action", type: "button", onclick: action, text: (draft ? "Continuer le brouillon" : "Rédiger le rapport") + " →" }));
  }

  /* Deuxième bloc : tableau de bord des communautés (commission et administrateur). */
  function districtBlock(info) {
    var comms = D.communities.filter(function (c) { return c.active !== false; });
    var reps = D.viewReports().filter(function (r) { return TTSchedule.matches(r, info, typeLabelOf); });
    var sentIds = {};
    reps.forEach(function (r) { if (r.status !== "draft") sentIds[r.community_id] = true; });
    var missing = comms.filter(function (c) { return !sentIds[c.id]; });
    var x = comms.length - missing.length;
    var many = comms.length > 1;
    var msg = x + " sur " + comms.length + (many ? " communautés ont transmis" : " communauté a transmis") + " le dernier service. " +
      (missing.length ? "Il manque " + nounCommunities(missing.length) + "." : "Toutes les communautés ont transmis.");
    return h("section", { class: "card service" + (missing.length ? "" : " ok") },
      h("h3", { text: "Service divin du " + info.day + " " + dayMonth(info.date) }),
      h("p", { text: msg }),
      missing.length ? h("p", { class: "muted", text: "Pas encore transmis : " + missing.map(function (c) { return c.name; }).join(", ") + "." }) : null,
      h("button", { class: "btn ghost", type: "button", onclick: function () { go("review", {}); }, text: "Voir les rapports" }));
  }

  /* Troisième bloc : la comptabilité du mois (toutes les personnes). */
  function moneyBlock(st, y, m) {
    var name = TT.MONTHS[m - 1];
    return h("section", { class: "card" },
      h("h3", { text: "Ce mois-ci · " + name.charAt(0).toUpperCase() + name.slice(1) + " " + y }),
      kv("Activités validées", TT.fmtInt(st.total.n)),
      kv("Offrandes en CDF", TT.fmtFC(st.total.fc)),
      kv("Offrandes en USD", TT.fmtUSD(st.total.usd)));
  }

  /* ---------- Onboarding : trois écrans, une seule fois par compte ---------- */
  var onbShown = false;
  function onbKey() { return "tt:onb:" + (D.profile && D.profile.id || "x"); }
  function onbDone() { try { return localStorage.getItem(onbKey()) === "1"; } catch (e) { return false; } }
  function setOnbDone() { try { localStorage.setItem(onbKey(), "1"); } catch (e) {} }
  function showOnboarding() {
    var steps = [
      { t: "Voici votre communauté", b: "Vous rédigez les rapports de " + D.communityName(D.profile.community_id) + ". Chaque activité reste sur votre appareil tant que vous ne la transmettez pas, même sans Internet." },
      { t: "À quoi ressemble un rapport validé", b: "Une fois validé par la Commission, le rapport reçoit un numéro de fiche (TT-AAAA-NNNNNN) et ne peut plus être modifié. Pour corriger, vous créez une correction liée à cette fiche." },
      { t: "Créez votre premier brouillon", b: "Commencez par le dernier service divin. Vous pouvez enregistrer un brouillon à tout moment et le transmettre plus tard." }
    ];
    var i = 0;
    var back = h("div", { class: "overlay", role: "dialog", "aria-modal": "true", "aria-labelledby": "onb-title" });
    function close(openForm) {
      setOnbDone(); back.remove();
      if (openForm) go("form", { presetDate: TT.today() });
    }
    function draw() {
      var st = steps[i], last = i === steps.length - 1;
      TT.replaceAll(back, h("div", { class: "dialog onb" },
        h("p", { class: "muted", text: (i + 1) + " sur " + steps.length }),
        h("h2", { id: "onb-title", text: st.t }),
        h("p", { text: st.b }),
        h("div", { class: "row end" },
          h("button", { class: "btn ghost", type: "button", onclick: function () { close(false); }, text: "Passer" }),
          i > 0 ? h("button", { class: "btn ghost", type: "button", onclick: function () { i--; draw(); }, text: "Précédent" }) : null,
          last
            ? h("button", { class: "btn primary", type: "button", onclick: function () { close(true); }, text: "Rédiger le rapport" })
            : h("button", { class: "btn primary", type: "button", onclick: function () { i++; draw(); }, text: "Suivant" }))));
      var first = back.querySelector(".btn.primary"); if (first) first.focus();
    }
    draw();
    document.body.appendChild(back);
  }

  /* ---------- Accueil ---------- */
  function homeScreen() {
    var rs = D.viewReports(), count = function (s) { return rs.filter(function (r) { return r.status === s; }).length; };
    var d = new Date(), y = d.getFullYear(), m = d.getMonth() + 1;
    var pr = S.periodRange("month", y, m);
    var st = S.compute(D.reports, { from: pr.from, to: pr.to, statuses: ["validated"] });
    var blocks = [];
    var monthName = TT.MONTHS[m - 1];
    if (isObserver()) { shell(observerBlocks(y, m, st, monthName, rs)); return; }
    blocks.push(h("section", { class: "hero" },
      h("h2", { text: greeting() }),
      h("p", { class: "muted", text: TT.ROLES[role()] + (D.profile.community_id ? " · " + D.communityName(D.profile.community_id) : "") }),
      h("p", { class: "month", text: monthName.charAt(0).toUpperCase() + monthName.slice(1) + " " + y })));
    var info = window.TTSchedule ? TTSchedule.lastSlot(new Date()) : null;
    if (info) blocks.push(isCommunity() ? weekBlock(info) : districtBlock(info));
    var pend = D.queue.length;
    if (pend) {
      var bad = D.queue.filter(function (q) { return q.state !== "pending"; }).length;
      blocks.push(h("section", { class: "card alert" },
        h("h3", { text: pend + " élément(s) en attente d'envoi" }),
        h("p", { class: "muted", text: bad ? bad + " nécessite(nt) votre attention (erreur ou conflit)." : (D.online ? "Envoi en cours ou prêt à partir." : "Ils partiront dès le retour d'Internet.") }),
        h("div", { class: "row" },
          h("button", { class: "btn primary", type: "button", onclick: manualSync, text: "Envoyer maintenant" }),
          h("button", { class: "btn ghost", type: "button", onclick: function () { state.listFilter = { status: "", community: "", month: "" }; go("reports"); }, text: "Voir" }))));
    }
    var tiles = [];
    blocks.push(h("h3", { text: isCommunity() ? "Vos activités" : "À traiter" }));
    if (isCommunity()) tiles = [["Brouillons", count("draft")], ["À corriger", count("needs_correction")], ["Transmis", count("submitted") + count("in_control") + count("checked")], ["Validés", count("validated")]];
    else tiles = [["À contrôler", count("submitted") + count("in_control")], ["À valider", count("checked")], ["À corriger", count("needs_correction")], ["Validés", count("validated")]];
    blocks.push(h("section", { class: "tiles" }, tiles.map(function (t) {
      return h("button", { class: "tile tile-" + ({ "Brouillons": "draft", "À corriger": "fix", "Transmis": "sent", "Validés": "ok", "À contrôler": "sent", "À valider": "val" }[t[0]] || "sent"), type: "button", onclick: function () { go(isCommunity() ? "reports" : "review", {}); } }, h("span", { class: "num", text: String(t[1]) }), h("span", { class: "lbl", text: t[0] }));
    })));
    blocks.push(moneyBlock(st, y, m));
    if (!D.online) blocks.push(h("p", { class: "foot", text: "Mode hors connexion : vous voyez les dernières données reçues sur cet appareil." }));
    shell(blocks);
    try { document.querySelectorAll(".tile .num").forEach(function (n) { var v = parseInt(n.textContent, 10) || 0; if (window.TTChart && v > 0) window.TTChart.animateCounter(n, v, { duration: 700 }); }); } catch (e) {}
    if (isCommunity() && !onbShown && !onbDone()) { onbShown = true; showOnboarding(); }
  }

  /* ---------- Liste des activités ---------- */
  function reportRow(r) {
    var t = D.type(r.activity_type_id);
    var tot = TT.fmtFC(S.cents(r.offering_fc)) + " et " + TT.fmtUSD(S.cents(r.offering_usd));
    return h("button", { class: "row-item has-num", type: "button", onclick: function () { go("detail", r._local ? { qid: r._qid } : { id: r.id }); } },
      h("span", { class: "ri-num", "aria-hidden": "true", text: r.report_code ? r.report_code.slice(-3) : "" }),
      h("div", { class: "ri-main" },
        h("strong", { text: t ? t.label : "Activité" }),
        h("span", { class: "muted", text: TT.fmtDate(r.activity_date) }),
        r.report_code ? h("span", { class: "muted", text: r.report_code }) : null,
        isCommunity() ? null : h("span", { class: "muted", text: D.communityName(r.community_id) }),
        h("span", { class: "muted", text: (r.members_count != null ? r.members_count + " membres" : "") + (r.visitors_count ? " et " + r.visitors_count + " visiteur(s)" : "") }),
        h("span", { class: "muted", text: tot })),
      h("div", { class: "ri-side" }, statusChip(r.status), syncChip(r)));
  }
  function listScreen(opts) {
    opts = opts || {};
    var f = state.listFilter, rs = D.viewReports();
    if (opts.fixedStatuses) rs = rs.filter(function (r) { return opts.fixedStatuses.indexOf(r.status) >= 0; });
    if (f.status && !opts.fixedStatuses) rs = rs.filter(function (r) { return r.status === f.status; });
    if (f.community) rs = rs.filter(function (r) { return r.community_id === f.community; });
    if (f.month) rs = rs.filter(function (r) { return (r.activity_date || "").slice(0, 7) === f.month; });
    if (f.q) {
      var needle = f.q.toLowerCase();
      rs = rs.filter(function (r) {
        var t = D.type(r.activity_type_id);
        return [r.report_code, r.activity_date, TT.fmtDate(r.activity_date), t && t.label, D.communityName(r.community_id), r.writer_name, r.activity_description]
          .some(function (v) { return v && String(v).toLowerCase().indexOf(needle) >= 0; });
      });
    }
    var total = rs.length, limit = state.listLimit || LIST_PAGE;
    rs = rs.slice(0, limit);
    rs.sort(function (a, b) { return (b.activity_date || "").localeCompare(a.activity_date || "") || (b.created_at || "").localeCompare(a.created_at || ""); });
    var months = {};
    D.viewReports().forEach(function (r) { if (r.activity_date) months[r.activity_date.slice(0, 7)] = 1; });
    var controls = h("div", { class: "filters" });
    if (!opts.fixedStatuses) {
      var sSel = h("select", { id: "f-status", onchange: function () { f.status = this.value; render(); } }, opt("", "Tous les statuts", !f.status), Object.keys(TT.STATUS).map(function (k) { return opt(k, TT.STATUS[k], f.status === k); }));
      controls.appendChild(field("Statut", sSel));
    }
    if (!isCommunity()) {
      var cSel = h("select", { id: "f-comm", onchange: function () { f.community = this.value; render(); } }, opt("", "Toutes les communautés", !f.community), D.communities.map(function (c) { return opt(c.id, c.name, f.community === c.id); }));
      controls.appendChild(field("Communauté", cSel));
    }
    var mSel = h("select", { id: "f-month", onchange: function () { f.month = this.value; render(); } }, opt("", "Tous les mois", !f.month), Object.keys(months).sort().reverse().map(function (k) { var p = k.split("-"); return opt(k, TT.MONTHS[+p[1] - 1] + " " + p[0], f.month === k); }));
    controls.appendChild(field("Mois", mSel));
    var qInput = h("input", { id: "f-q", type: "search", value: f.q || "", placeholder: "N° de fiche, date, type, rédacteur…", onchange: function () { f.q = this.value.trim(); state.listLimit = LIST_PAGE; render(); } });
    controls.appendChild(field("Recherche", qInput, "Tapez puis validez (Entrée) : recherche par numéro de fiche, date, type, communauté ou rédacteur.", "f-q"));
    var more = total > limit ? h("div", { class: "row end" }, h("span", { class: "muted", text: "Affichées : " + rs.length + " sur " + total }), h("button", { class: "btn ghost", type: "button", text: "Afficher " + Math.min(LIST_PAGE, total - limit) + " de plus", onclick: function () { state.listLimit = limit + LIST_PAGE; render(); } })) : (total ? h("p", { class: "muted", text: total + " fiche(s)." }) : null);
    return [
      h("div", { class: "title-row" }, h("h2", { text: opts.title || "Activités" }), opts.noNew ? null : h("button", { class: "btn primary", type: "button", onclick: function () { go("form", {}); }, text: "+ Nouvelle" })),
      opts.extra || null, controls,
      total ? h("div", { class: "list" }, rs.map(reportRow)) : emptyState("✎", "Aucune activité à afficher", isCommunity() ? "Créez votre premier rapport, ou modifiez les filtres." : "Modifiez les filtres pour voir d'autres activités.", isCommunity() ? h("button", { class: "btn primary", type: "button", onclick: function () { go("form", {}); }, text: "Nouvelle fiche" }) : null),
      more
    ];
  }
  function reportsScreen() { shell(listScreen({ title: "Activités", noNew: isObserver() })); }

  function reviewScreen() {
    var tabs = [["todo", "À contrôler", ["submitted", "in_control"]], ["validate", "À valider", ["checked"]], ["fix", "À corriger", ["needs_correction"]]];
    var cur = tabs.find(function (t) { return t[0] === state.reviewTab; }) || tabs[0];
    var rs = D.viewReports();
    var bar = h("div", { class: "tabs", role: "tablist" }, tabs.map(function (t) {
      var n = rs.filter(function (r) { return t[2].indexOf(r.status) >= 0; }).length;
      return h("button", { type: "button", role: "tab", class: t[0] === cur[0] ? "active" : "", "aria-selected": t[0] === cur[0] ? "true" : "false", onclick: function () { state.reviewTab = t[0]; render(); }, text: t[1] + " (" + n + ")" });
    }));
    var note = isAdmin() ? h("p", { class: "hint box", text: "Vous consultez ici l'avancement. Le contrôle et la validation sont réservés à la Commission de rédaction." }) : null;
    shell(listScreen({ title: "Contrôle", fixedStatuses: cur[2], noNew: true, extra: [bar, note] }));
  }

  /* ---------- PDF ---------- */
  function pdfLabels() {
    return {
      community: function (id) { return D.communityName(id); },
      type: function (id) { var t = D.type(id); return t ? t.label : "Activité"; },
      status: function (st) { return TT.STATUS[st] || st; }
    };
  }
  /* Export PDF : indicateur « Préparation du PDF… » ; si le chargement échoue, on oriente vers l'export CSV.
     L'interface n'est pas bloquée : le rendu est asynchrone, et un message apparaît après 5 secondes. */
  async function savePdf(model, btn, csvHint) {
    var old = btn ? btn.textContent : null;
    var slow = setTimeout(function () {
      TT.toast("Le PDF prend plus de temps que prévu. Vous pouvez patienter" + (csvHint ? ", ou utiliser l'export CSV." : "."), "");
    }, 5000);
    if (btn) { btn.disabled = true; btn.setAttribute("aria-busy", "true"); btn.textContent = "Préparation du PDF…"; }
    try {
      if (window.__loadPdfLib) await window.__loadPdfLib();
      var logo = await TTPdf.loadLogo();
      var bytes = await TTPdf.render(model, { logo: logo || null });
      TT.download(model.fileName, bytes, "application/pdf");
      TT.toast("PDF créé : " + model.fileName, "good");
    } catch (e) {
      TT.toast("Le PDF n'a pas pu être créé. " + TT.friendly(e) + (csvHint ? " " + csvHint : ""), "bad");
    } finally {
      clearTimeout(slow);
      if (btn) { btn.disabled = false; btn.removeAttribute("aria-busy"); btn.textContent = old; }
    }
  }

  /* ---------- Détail ---------- */
  function findReport(p) {
    return D.viewReports().find(function (r) { return p.qid ? r._qid === p.qid && r._local : r.id === p.id; });
  }
  function kv(label, value) { return value === null || value === undefined || value === "" ? null : h("div", { class: "kv" }, h("span", { class: "k", text: label }), h("span", { class: "v", text: String(value) })); }

  function detailScreen() {
    var r = findReport(state.params);
    if (!r) { shell([emptyState("?", "Fiche introuvable", "Elle n'existe plus ou n'est pas accessible avec votre compte.", h("button", { class: "btn", type: "button", onclick: function () { go("reports"); }, text: "Retour aux activités" }))]); return; }
    var t = D.type(r.activity_type_id);
    var hist = h("div", { id: "history" });
    var blocks = [
      h("button", { class: "linklike back", type: "button", onclick: function () { history.length > 1 ? history.back() : go("reports"); }, text: "Retour" }),
      isObserver() ? h("p", { class: "hint box", role: "note", text: "Consultation en lecture seule." }) : null,
      h("section", { class: "card" },
        h("div", { class: "title-row" }, h("div", {}, h("h2", { text: t ? t.label : "Activité" }), h("p", { class: "muted", text: "Activité du " + TT.fmtDate(r.activity_date) })), h("div", { class: "chips" }, statusChip(r.status), syncChip(r))),
        r._err ? h("p", { class: "msg bad", text: (r._errKind === "temporary" ? "Erreur temporaire (nouvel essai possible) : " : "Action requise : ") + r._err }) : null,
        kv("N° de fiche", r.report_code), kv("N° de reçu territorial", r.territorial_receipt), kv("Communauté", D.communityName(r.community_id)), kv("Précision", r.activity_description),
        kv("Début", r.start_time && r.start_time.slice(0, 5)), kv("Fin", r.end_time && r.end_time.slice(0, 5)),
        kv("Membres présents", r.members_count), kv("Visiteurs", r.visitors_count),
        kv("Offrande en CDF", TT.fmtFC(S.cents(r.offering_fc))), kv("Offrande en USD", TT.fmtUSD(S.cents(r.offering_usd))),
        kv("Texte biblique", r.bible_text), kv("Rédigé par", r.writer_name), kv("Observations", r.observations),
        kv("Saisie", r.intake_source === "commission_transcription" ? "Transcrite par la Commission" : r.intake_source ? "Saisie par la communauté" : null),
        r.corrected_from ? kv("Correction de", "une fiche validée précédente") : null),
      (r.report_officiants || []).length ? h("section", { class: "card" }, h("h3", { text: "Intervenants à l'autel de grâce" }),
        r.report_officiants.slice().sort(function (a, b) { return (a.position_order || 0) - (b.position_order || 0); }).map(function (o) {
          return h("p", {}, h("strong", { text: o.name_as_reported || "—" }), " — " + ({ principal: "Officiant", assistant: "Assistant" }[o.role_in_activity] || ""));
        })) : null,
      (r.religious_acts || []).length ? h("section", { class: "card" }, h("h3", { text: "Actes" }),
        r.religious_acts.map(function (a) { return h("p", { text: a.act_type + " : " + a.quantity + (a.notes ? " — " + a.notes : "") }); })) : null,
      hist,
      h("div", { class: "actions" }, h("button", { class: "btn ghost", type: "button", text: "Télécharger la fiche (PDF)", onclick: function (ev) { savePdf(TTPdf.reportModel(r, pdfLabels()), ev.currentTarget); } })),
      actionsFor(r)
    ];
    shell(blocks);
    if (r.id && D.online) loadHistory(r, hist);
  }
  async function loadHistory(r, box) {
    try {
      var c = await A.select("report_controls", "select=*&report_id=eq." + r.id + "&order=created_at.asc");
      var v = await A.select("report_validations", "select=*&report_id=eq." + r.id + "&order=created_at.asc");
      var items = c.map(function (x) { return { at: x.created_at, text: { match: "Contrôle : conforme", discrepancy: "Contrôle : écart constaté", correction_requested: "Correction demandée", checked: "Contrôlé" }[x.result] || x.result, note: x.notes || x.paper_reference }; })
        .concat(v.map(function (x) { return { at: x.created_at, text: { validated: "Validé", rejected: "Rejeté", returned_for_correction: "Renvoyé pour correction" }[x.decision] || x.decision, note: x.note }; }))
        .sort(function (a, b) { return a.at.localeCompare(b.at); });
      if (!items.length) return;
      TT.replaceAll(box, h("section", { class: "card" }, h("h3", { text: "Historique" }), items.map(function (i) {
        return h("p", {}, h("strong", { text: new Date(i.at).toLocaleDateString("fr-FR") + " — " + i.text }), i.note ? h("span", { class: "muted", text: " : " + i.note }) : null);
      })));
    } catch (e) {}
  }
  function actionsFor(r) {
    var btns = [];
    function b(label, cls, fn) { btns.push(h("button", { class: "btn " + cls, type: "button", onclick: fn, text: label })); }
    if (r._sync === "conflict") {
      return h("section", { class: "card alert" }, h("h3", { text: "Cette fiche a été modifiée ailleurs" }),
        h("p", { class: "muted", text: "Vos modifications n'ont pas été envoyées pour ne pas écraser la version plus récente du serveur. Choisissez la version à conserver." }),
        h("div", { class: "row" },
          h("button", { class: "btn ghost", type: "button", text: "Garder la version du serveur", onclick: async function () { var q = D.queue.find(function (x) { return x.qid === r._qid; }); if (await TT.confirmBox("Abandonner vos modifications locales ?", "Abandonner", true)) { await D.resolveConflict(q, "server"); go("reports"); } } }),
          h("button", { class: "btn primary", type: "button", text: "Écraser avec ma version", onclick: async function () { var q = D.queue.find(function (x) { return x.qid === r._qid; }); await D.resolveConflict(q, "mine"); go("reports"); } })));
    }
    if (r._sync === "error") {
      btns.push(h("button", { class: "btn primary", type: "button", text: "Réessayer l'envoi", onclick: async function () { var q = D.queue.find(function (x) { return x.qid === r._qid; }); await D.retry(q); } }));
    }
    if (canEditReport(r) && !(r._qid && D.queue.find(function (x) { return x.qid === r._qid && x.reportId && x.kind === "insert"; }))) {
      b("Modifier", "ghost", function () { go("form", r._local ? { qid: r._qid } : { id: r.id }); });
    }
    if ((isCommunity() || isCommission()) && (r.status === "draft" || r.status === "needs_correction") && (r._local ? true : true) && r._sync !== "conflict") {
      b(r.status === "needs_correction" ? "Soumettre la correction" : "Soumettre", "primary", function () { submitReport(r); });
    }
    if (r.status === "validated" && r.id && (isCommunity() || isCommission())) {
      b("Créer une correction", "ghost", function () { go("form", { copyOf: r.id }); });
    }
    if (r._local && !D.queue.find(function (x) { return x.qid === r._qid && x.reportId; })) {
      b("Supprimer ce brouillon local", "danger", async function () {
        if (await TT.confirmBox("Supprimer définitivement cette saisie qui n'a pas encore été envoyée ?", "Supprimer", true)) {
          await D.discard(D.queue.find(function (x) { return x.qid === r._qid; })); go("reports");
        }
      });
    }
    if (isCommission() && r.id && !r._local) {
      if (r.status === "submitted") b("Commencer le contrôle", "primary", function () { review(r, "start"); });
      if (r.status === "in_control") { b("Contrôle conforme", "primary", function () { review(r, "ok"); }); b("Demander une correction", "warn", function () { review(r, "correction"); }); }
      if (r.status === "checked") { b("Valider", "primary", function () { review(r, "validate"); }); b("Renvoyer pour correction", "warn", function () { review(r, "return"); }); }
    }
    var guide = null;
    if (isCommission() && r.id && !r._local && r.status !== "validated") {
      var steps = { submitted: "Étape 1 sur 3 : commencez le contrôle.", in_control: "Étape 2 sur 3 : vous pouvez modifier la fiche, puis cliquer « Contrôle conforme ».", checked: "Étape 3 sur 3 : validez la fiche, ou renvoyez-la pour correction.", needs_correction: "Fiche renvoyée au rapporteur pour correction." };
      if (steps[r.status]) guide = h("p", { class: "hint box", text: steps[r.status] });
    }
    return (btns.length || guide) ? h("div", { class: "actions-wrap" }, guide, btns.length ? h("div", { class: "actions" }, btns) : null) : null;
  }
  async function submitReport(r) {
    if (!await TT.confirmBox("Transmettre cette fiche ? Elle ne sera plus modifiable par vous tant qu'elle n'est pas renvoyée pour correction.", "Soumettre")) return;
    try {
      if (r._local) { var q = D.queue.find(function (x) { return x.qid === r._qid; }); q.wantStatus = "submitted"; q.state = "pending"; await TTStore.qPut(q); D.emit(); D.sync(); }
      else await D.enqueueUpdate(r, {}, null, null, true);
      TT.toast(D.online ? "Transmission en cours…" : "Enregistré. La fiche sera transmise au retour d'Internet.", "good");
      go("reports");
    } catch (e) { TT.toast(TT.friendly(e), "bad"); }
  }
  async function review(r, action) {
    if (!D.online) { TT.toast("Le contrôle et la validation nécessitent une connexion Internet.", "bad"); return; }
    var note = null;
    try {
      if (action === "ok") { note = await TT.promptNote("Note ou référence du rapport papier (facultatif)", false); if (note === null) return; }
      else if (action === "correction") { note = await TT.promptNote("Que faut-il corriger ? (le rapporteur verra ce message)", true); if (note === null) return; }
      else if (action === "return") { note = await TT.promptNote("Motif du renvoi (le rapporteur verra ce message)", true); if (note === null) return; }
      else if (action === "validate") {
        if (!await TT.confirmBox("Valider définitivement cette fiche ? Elle ne pourra plus être modifiée (seule une correction liée sera possible).", "Valider")) return;
      }
      await A.rpc("review_report", { p_payload: { op_id: TT.uuid(), report_id: r.id, action: action, note: note || null } });
      await D.loadReports(); TT.toast("Fait.", "good"); render();
    } catch (e) { TT.toast(TT.friendly(e), "bad"); await D.loadReports().catch(function () {}); render(); }
  }

  /* ---------- Formulaire ---------- */
  var formDirty = false;
  window.addEventListener("beforeunload", function (e) { if (formDirty) { e.preventDefault(); e.returnValue = ""; } });
  function num(v) { var n = Number(String(v == null ? "" : v).replace(/\s/g, "").replace(",", ".")); return isFinite(n) ? n : NaN; }

  function formScreen() {
    formDirty = false;
    var p = state.params, existing = null, copy = null;
    if (p.id || p.qid) existing = findReport(p);
    if (p.copyOf) copy = findReport({ id: p.copyOf });
    var src = existing || copy || {};
    var editingSynced = !!(existing && existing.id);
    var lockedLocal = existing && existing._local && D.queue.find(function (x) { return x.qid === existing._qid && x.reportId; });
    if (lockedLocal) { shell([emptyState("⏱", "Envoi en cours", "Cette fiche est en cours d'envoi. Réessayez dans un instant.", h("button", { class: "btn", type: "button", onclick: function () { go("reports"); }, text: "Retour aux activités" }))]); return; }
    var types = D.types.filter(function (x) { return x.active || x.id === src.activity_type_id; });
    var commFixed = isCommunity();

    var iComm = h("select", { id: "fm-comm", required: true, disabled: commFixed || editingSynced && isCommunity() },
      opt("", "Choisir…", !(src.community_id || (commFixed && D.profile.community_id))),
      D.communities.filter(function (c) { return c.active !== false; }).map(function (c) { return opt(c.id, c.name, (src.community_id || (commFixed ? D.profile.community_id : "")) === c.id); }));
    var presetT = src.activity_type_id || p.presetType;
    var iType = h("select", { id: "fm-type", required: true }, opt("", "Choisir…", !presetT), types.map(function (x) { return opt(x.id, x.label, presetT === x.id); }));
    var iDesc = h("input", { id: "fm-desc", type: "text", value: src.activity_description || "", maxlength: "200" });
    var descField = field("Précisez l'activité", iDesc, "Obligatoire pour ce type d'activité.");
    function syncDesc() { var t = D.type(iType.value); descField.hidden = !(t && t.requires_description); iDesc.required = !!(t && t.requires_description); }
    iType.addEventListener("change", syncDesc);
    var iDate = h("input", { id: "fm-date", type: "date", required: true, value: src.activity_date || p.presetDate || TT.today() });
    var iStart = h("input", { id: "fm-start", type: "time", value: (src.start_time || "").slice(0, 5) });
    var iEnd = h("input", { id: "fm-end", type: "time", value: (src.end_time || "").slice(0, 5) });
    var iMem = h("input", { id: "fm-mem", type: "text", inputmode: "numeric", required: true, value: src.members_count != null ? src.members_count : "" });
    var iVis = h("input", { id: "fm-vis", type: "text", inputmode: "numeric", required: true, value: src.visitors_count != null ? src.visitors_count : "0" });
    var iFC = h("input", { id: "fm-fc", type: "text", inputmode: "decimal", required: true, value: src.offering_fc != null ? src.offering_fc : "0" });
    var iUSD = h("input", { id: "fm-usd", type: "text", inputmode: "decimal", required: true, value: src.offering_usd != null ? src.offering_usd : "0" });
    var iBible = h("input", { id: "fm-bible", type: "text", value: src.bible_text || "" });
    var iWriter = h("input", { id: "fm-writer", type: "text", required: true, value: src.writer_name || D.profile.display_name || "" });
    var iReceipt = h("input", { id: "fm-receipt", type: "text", maxlength: "40", autocomplete: "off", value: src.territorial_receipt || "" });
    var iObs = h("textarea", { id: "fm-obs", rows: "3" }); iObs.value = src.observations || "";
    var err = h("p", { class: "msg bad", role: "alert", hidden: true });

    var offRows = [], actRows = [];
    var offBox = h("div"), actBox = h("div");
    function offRow(o) {
      var n = h("input", { type: "text", "aria-label": "Nom de l'assistant", value: o.name_as_reported || "", placeholder: "Nom de l'assistant" });
      var row = { n: n };
      offRows.push(row);
      var el = h("div", { class: "subrow" }, n, h("button", { class: "btn small ghost", type: "button", "aria-label": "Retirer", text: "✕", onclick: function () { offRows.splice(offRows.indexOf(row), 1); el.remove(); } }));
      offBox.appendChild(el);
    }
    function actRow(a) {
      var t = h("input", { type: "text", "aria-label": "Type d'acte", list: "acts-list", value: a.act_type || "", placeholder: "Type d'acte" });
      var q = h("input", { type: "text", inputmode: "numeric", "aria-label": "Nombre", value: a.quantity != null ? a.quantity : "1", placeholder: "Nombre" });
      var nt = h("input", { type: "text", "aria-label": "Note", value: a.notes || "", placeholder: "Note (facultatif)" });
      var row = { t: t, q: q, n: nt }; actRows.push(row);
      var el = h("div", { class: "subrow" }, t, q, nt, h("button", { class: "btn small ghost", type: "button", "aria-label": "Retirer", text: "✕", onclick: function () { actRows.splice(actRows.indexOf(row), 1); el.remove(); } }));
      actBox.appendChild(el);
    }
    var knownActs = {};
    D.reports.forEach(function (r) { (r.religious_acts || []).forEach(function (a) { if (a.act_type) knownActs[a.act_type] = 1; }); });
    var dl = h("datalist", { id: "acts-list" }, Object.keys(knownActs).sort().map(function (k) { return h("option", { value: k }); }));
    var offInit = (src.report_officiants || []).find(function (o) { return o.role_in_activity === "principal"; });
    var iOff = h("input", { id: "fm-off", type: "text", required: true, placeholder: "Nom de l'officiant", value: offInit ? offInit.name_as_reported || "" : "" });
    (src.report_officiants || []).filter(function (o) { return o.role_in_activity !== "principal"; }).forEach(offRow);
    (src.religious_acts || []).forEach(actRow);

    function collect(submit) {
      var m = {
        community_id: iComm.value || (commFixed ? D.profile.community_id : ""), activity_type_id: iType.value, activity_description: iDesc.value.trim() || null,
        activity_date: iDate.value, start_time: iStart.value || null, end_time: iEnd.value || null,
        members_count: num(iMem.value), visitors_count: num(iVis.value), offering_fc: num(iFC.value), offering_usd: num(iUSD.value),
        bible_text: iBible.value.trim() || null, writer_name: iWriter.value.trim(), observations: iObs.value.trim() || null,
        territorial_receipt: iReceipt.value.trim() || null
      };
      var t = D.type(m.activity_type_id);
      if (!m.community_id) return "Choisissez la communauté.";
      if (!m.activity_type_id) return "Choisissez le type d'activité.";
      if (!m.activity_date) return "Indiquez la date.";
      if (t && t.requires_description && !m.activity_description) return "Précisez l'activité.";
      if (!m.writer_name) return "Indiquez qui a rédigé le rapport.";
      if (m.territorial_receipt) {
        var rcLow = m.territorial_receipt.toLowerCase(), selfId = existing && existing.id, selfQ = existing && existing._qid;
        var dup = D.viewReports().some(function (x) {
          if (!x.territorial_receipt || x.territorial_receipt.toLowerCase() !== rcLow) return false;
          if (selfId && x.id === selfId) return false;
          if (selfQ && x._qid === selfQ) return false;
          if (copy && x.id === copy.id) return false;
          return true;
        });
        if (dup) return "Ce numéro de reçu territorial est déjà utilisé par une autre fiche.";
      }
      if (!Number.isInteger(m.members_count) || m.members_count < 0) return "Nombre de membres : un entier positif ou zéro.";
      if (!Number.isInteger(m.visitors_count) || m.visitors_count < 0) return "Nombre de visiteurs : un entier positif ou zéro.";
      if (!(m.offering_fc >= 0)) return "Offrande en CDF : un montant positif ou zéro.";
      if (!(m.offering_usd >= 0)) return "Offrande en USD : un montant positif ou zéro.";
      if (m.offering_fc > 1e12 || m.offering_usd > 1e9) return "Montant trop grand : vérifiez la saisie.";
      if (m.start_time && m.end_time && m.end_time < m.start_time) return "L'heure de fin précède l'heure de début.";
      var offs = [], acts = [];
      var offName = iOff.value.trim();
      if (!offName) return "Indiquez le nom de l'officiant : il est obligatoire.";
      offs.push({ name_as_reported: offName, role_in_activity: "principal", role_description: null });
      for (var i = 0; i < offRows.length; i++) { var n = offRows[i].n.value.trim(); if (n) offs.push({ name_as_reported: n, role_in_activity: "assistant", role_description: null }); }
      if (offs.length - 1 > 5) return "Une activité ne peut pas avoir plus de cinq assistants.";
      for (var j = 0; j < actRows.length; j++) {
        var at = actRows[j].t.value.trim(); if (!at) continue;
        var qn = num(actRows[j].q.value); if (!Number.isInteger(qn) || qn < 0) return "Actes : le nombre doit être un entier.";
        acts.push({ act_type: at, quantity: qn, notes: actRows[j].n.value.trim() || null });
      }
      return { m: m, offs: offs, acts: acts };
    }
    async function save(submit) {
      var c = collect(submit);
      if (typeof c === "string") { err.textContent = c; err.hidden = false; err.scrollIntoView({ block: "center" }); return; }
      err.hidden = true;
      try {
        if (editingSynced) {
          var patch = Object.assign({}, c.m); if (isCommunity()) delete patch.community_id;
          await D.enqueueUpdate(existing, patch, c.offs, c.acts, submit);
        } else if (existing && existing._local) {
          var q = D.queue.find(function (x) { return x.qid === existing._qid; });
          await D.replaceLocalInsert(q, Object.assign({}, q.payload, c.m), c.offs, c.acts, submit);
        } else {
          var payload = Object.assign({}, c.m, { intake_source: isCommunity() ? "community_entry" : "commission_transcription", corrected_from: copy ? copy.id : null });
          await D.enqueueInsert(payload, c.offs, c.acts, submit);
        }
        formDirty = false;
        try { localStorage.removeItem(autoKey); } catch (e) {}
        TT.toast(D.online ? "Enregistré. Envoi en cours…" : "Enregistré sur cet appareil. Envoi dès le retour d'Internet.", "good");
        go("reports");
      } catch (e) { err.textContent = TT.friendly(e); err.hidden = false; }
    }
    var submitLabel = isCommunity() ? "Enregistrer et transmettre" : "Enregistrer et soumettre au contrôle";
    var title = existing ? "Modifier l'activité" : copy ? "Correction d'une fiche validée" : "Nouvelle activité";
    var actions = h("div", { class: "actions form-actions" },
        h("button", { class: "linklike", type: "button", onclick: function () { formDirty = false; history.length > 1 ? history.back() : go("reports"); }, text: "Annuler" }),
        (editingSynced && !isCommunity())
          ? h("button", { class: "btn primary", type: "submit", text: "Enregistrer les modifications" })
          : [h("button", { class: "linklike form-draft", type: "submit", text: "Enregistrer le brouillon" }),
             h("button", { class: "btn primary", type: "button", onclick: function () { save(true); }, text: isCommunity() ? "Transmettre" : "Soumettre au contrôle" })]);
    /* Brouillon automatique : la saisie en cours (sans validation) est gardée sur cet appareil jusqu'à l'enregistrement
       de la fiche. Ce n'est pas la file d'envoi : rien n'est transmis tant que l'utilisateur n'enregistre pas. */
    function pad2(n) { return (n < 10 ? "0" : "") + n; }
    function hhmm(d) { return pad2(d.getHours()) + ":" + pad2(d.getMinutes()); }
    var autoKey = "tt:autosave:" + (D.profile && D.profile.id || "x") + ":" + (existing ? (existing.id || existing._qid) : copy ? "copie-" + copy.id : "nouvelle");
    var autoState = h("p", { class: "muted autosave", "aria-live": "polite", text: "" });
    var autoTimer = null;
    function readAuto() {
      try {
        var raw = localStorage.getItem(autoKey);
        if (!raw) return null;
        var o = JSON.parse(raw);
        if (!o || o.v !== 1 || !o.f || Date.now() - o.at > 7 * 86400000) { localStorage.removeItem(autoKey); return null; }
        return o;
      } catch (e) { return null; }
    }
    function fieldValues() {
      return { comm: iComm.value, type: iType.value, desc: iDesc.value, date: iDate.value, start: iStart.value, end: iEnd.value,
        mem: iMem.value, vis: iVis.value, fc: iFC.value, usd: iUSD.value, bible: iBible.value, writer: iWriter.value,
        receipt: iReceipt.value, obs: iObs.value, off: iOff.value,
        offs: offRows.map(function (r) { return r.n.value; }),
        acts: actRows.map(function (r) { return [r.t.value, r.q.value, r.n.value]; }) };
    }
    function autosaveNow() {
      try {
        var now = new Date();
        localStorage.setItem(autoKey, JSON.stringify({ v: 1, at: now.getTime(), f: fieldValues() }));
        autoState.textContent = "Enregistré à " + hhmm(now);
      } catch (e) { autoState.textContent = "Brouillon automatique indisponible sur cet appareil."; }
    }
    function scheduleAutosave() { clearTimeout(autoTimer); autoTimer = setTimeout(autosaveNow, 800); }
    function applyValues(f) {
      iComm.value = f.comm || ""; iType.value = f.type || ""; iDesc.value = f.desc || ""; iDate.value = f.date || "";
      iStart.value = f.start || ""; iEnd.value = f.end || ""; iMem.value = f.mem || ""; iVis.value = f.vis || "";
      iFC.value = f.fc || ""; iUSD.value = f.usd || ""; iBible.value = f.bible || ""; iWriter.value = f.writer || "";
      iReceipt.value = f.receipt || ""; iObs.value = f.obs || ""; iOff.value = f.off || "";
      offRows.length = 0; TT.replaceAll(offBox);
      (f.offs || []).forEach(function (n) { offRow({ name_as_reported: n }); });
      actRows.length = 0; TT.replaceAll(actBox);
      (f.acts || []).forEach(function (a) { actRow({ act_type: a[0], quantity: a[1], notes: a[2] }); });
      syncDesc();
    }
    var stored = readAuto();
    var autoBanner = h("div", { class: "card alert autosave-banner", role: "status", hidden: !stored },
      h("p", { text: stored ? "Un brouillon non transmis a été trouvé sur cet appareil (enregistré à " + hhmm(new Date(stored.at)) + ")." : "" }),
      h("div", { class: "row" },
        h("button", { class: "btn primary", type: "button", text: "Restaurer", onclick: function () { applyValues(stored.f); autoBanner.hidden = true; autosaveNow(); } }),
        h("button", { class: "btn ghost", type: "button", text: "Ignorer", onclick: function () { try { localStorage.removeItem(autoKey); } catch (e) {} autoBanner.hidden = true; autoState.textContent = ""; } })));
    var form = h("form", { class: "card form", novalidate: true, oninput: function () { formDirty = true; scheduleAutosave(); }, onsubmit: function (e) { e.preventDefault(); save(false); } },
      h("div", { class: "form-head" },
        h("h2", { text: title }),
        h("p", { class: "legend-note" }, h("span", { class: "req", "aria-hidden": "true", text: "*" }), " Champs obligatoires. Les autres sont facultatifs.")), autoState, autoBanner,
      copy ? h("p", { class: "hint box", text: "Cette fiche remplacera la fiche validée dans les statistiques une fois validée à son tour." }) : null,
      h("section", { class: "form-section" }, sectionHead(1, "Activité"),
        reqField("Communauté", iComm), reqField("Type d'activité", iType), descField,
        h("div", { class: "grid2" }, reqField("Date", iDate), field("Début", iStart), field("Fin", iEnd))),
      h("section", { class: "form-section" }, sectionHead(2, "Effectifs et offrandes"),
        h("div", { class: "grid2" }, reqField("Membres présents", iMem), reqField("Visiteurs", iVis)),
        h("fieldset", {}, h("legend", { text: "Offrandes (deux monnaies séparées)" }),
          h("div", { class: "grid2" }, reqField("En francs congolais (CDF)", iFC), reqField("En dollars américains (USD)", iUSD)))),
      h("section", { class: "form-section" }, sectionHead(3, "Déroulement"),
        field("Texte biblique", iBible), reqField("Rédigé par", iWriter),
        field("N° de reçu territorial", iReceipt, "Facultatif. Ce numéro est unique : il ne peut servir que pour une seule fiche."), field("Observations", iObs)),
      h("section", { class: "form-section" }, sectionHead(4, "Intervenants à l'autel de grâce"),
        reqField("Officiant", iOff, "Un seul officiant par activité."),
        h("fieldset", {}, h("legend", { text: "Assistants (facultatif, cinq au maximum)" }),
          offBox, h("button", { class: "btn small ghost", type: "button", text: "+ Ajouter un assistant", onclick: function () { if (offRows.length >= 5) { TT.toast("Maximum cinq assistants.", "bad"); return; } offRow({}); } }))),
      h("section", { class: "form-section" }, sectionHead(5, "Actes"),
        h("fieldset", {}, h("legend", { text: "Actes (facultatif)" }), dl,
          actBox, h("button", { class: "btn small ghost", type: "button", text: "+ Ajouter un acte", onclick: function () { actRow({}); } }))),
      err,
      actions);
    shell(form); syncDesc();
  }

  /* ---------- Statistiques ---------- */
  function statsScreen() {
    var now = new Date();
    if (!state.stats) state.stats = { kind: "month", year: now.getFullYear(), idx: now.getMonth() + 1, statuses: "validated", community: "" };
    var s = state.stats;
    var years = {}; years[2026] = 1; years[2027] = 1; years[now.getFullYear()] = 1;
    D.reports.forEach(function (r) { if (r.activity_date) years[r.activity_date.slice(0, 4)] = 1; });
    var statusSets = { validated: ["validated"], noDraft: ["submitted", "needs_correction", "in_control", "checked", "validated"], all: null };
    var range = S.periodRange(s.kind, s.year, s.idx);
    var res = S.compute(D.reports, { from: range.from, to: range.to, statuses: statusSets[s.statuses], communityId: s.community || (isCommunity() ? D.profile.community_id : "") });

    // --- PRÉPARATION DES DONNÉES POUR LES GRAPHIQUES ---
    var chartStats = {
      byCommunity: Object.keys(res.byCommunity).map(function (id) {
        var c = D.communities.find(function (x) { return x.id === id; });
        var t = res.byCommunity[id];
        return { id: id, name: c ? c.name : id, total: t.n, isMine: isCommunity() && D.profile.community_id === id,
          items: ["Présences : " + TT.fmtInt(t.members) + " membres, " + TT.fmtInt(t.visitors) + " visiteurs", "Offrandes : " + TT.fmtFC(t.fc) + " ; " + TT.fmtUSD(t.usd)] };
      }).sort(function(a, b) { return b.total - a.total; }),
      byType: Object.keys(res.byType).map(function (id) {
        var t = D.types.find(function (x) { return x.id === id; });
        return { label: t ? t.label : id, total: res.byType[id].n };
      }),
      byMonth: []
    };
    
    // Calcul de la courbe des 12 mois de l'année sélectionnée
    for (var m = 1; m <= 12; m++) {
      var r = S.periodRange("month", s.year, m);
      var mRes = S.compute(D.reports, { from: r.from, to: r.to, statuses: statusSets[s.statuses], communityId: s.community || (isCommunity() ? D.profile.community_id : "") });
      chartStats.byMonth.push({ label: TT.MONTHS[m-1], shortLabel: TT.MONTHS[m-1].substring(0,3), total: mRes.total.n });
    }
    // Calendrier : activités par jour du mois affiché (le dernier mois de la période si ce n'est pas un mois)
    var almMonth = s.kind === "month" ? s.idx : s.kind === "quarter" ? s.idx * 3 : 12;
    var almDays = new Date(Date.UTC(s.year, almMonth, 0)).getUTCDate();
    chartStats.year = s.year;
    chartStats.almanach = { year: s.year, month: almMonth, counts: {} };
    for (var dd = 1; dd <= almDays; dd++) {
      var dk = s.year + "-" + String(almMonth).padStart(2, "0") + "-" + String(dd).padStart(2, "0");
      var dRes = S.compute(D.reports, { from: dk, to: dk, statuses: statusSets[s.statuses], communityId: s.community || (isCommunity() ? D.profile.community_id : "") });
      chartStats.almanach.counts[dk] = dRes.total.n;
    }
    // ---------------------------------------------------

    function sel(id, val, options, on) { return h("select", { id: id, onchange: function () { on(this.value); render(); } }, options.map(function (o) { return opt(o[0], o[1], String(o[0]) === String(val)); })); }
    var kindSel = sel("st-kind", s.kind, [["month", "Mois"], ["quarter", "Trimestre"], ["year", "Année"]], function (v) { s.kind = v; s.idx = v === "quarter" ? Math.ceil((now.getMonth() + 1) / 3) : now.getMonth() + 1; });
    var yearSel = sel("st-year", s.year, Object.keys(years).sort().map(function (y) { return [y, y]; }), function (v) { s.year = Number(v); });
    var idxSel = s.kind === "year" ? null : sel("st-idx", s.idx,
      s.kind === "month" ? TT.MONTHS.map(function (m, i) { return [i + 1, m[0].toUpperCase() + m.slice(1)]; }) : [[1, "1er trimestre"], [2, "2e trimestre"], [3, "3e trimestre"], [4, "4e trimestre"]], function (v) { s.idx = Number(v); });
    var stSel = sel("st-status", s.statuses, [["validated", "Fiches validées (chiffres officiels)"], ["noDraft", "Toutes sauf brouillons"], ["all", "Toutes, brouillons compris"]], function (v) { s.statuses = v; });
    var cSel = isCommunity() ? null : sel("st-comm", s.community, [["", "Toutes les communautés"]].concat(D.communities.map(function (c) { return [c.id, c.name]; })), function (v) { s.community = v; });

    function row(label, t, strong) {
      return h("tr", { class: strong ? "total" : "" }, h("th", { scope: "row", text: label }), h("td", { text: TT.fmtInt(t.n) }), h("td", { text: TT.fmtInt(t.members) }), h("td", { text: TT.fmtInt(t.visitors) }), h("td", { text: TT.fmtFC(t.fc) }), h("td", { text: TT.fmtUSD(t.usd) }));
    }
    function table(first, rows, total) {
      return h("div", { class: "scroll" }, h("table", {},
        h("thead", {}, h("tr", {}, h("th", { text: first }), h("th", { text: "Activités" }), h("th", { text: "Membres" }), h("th", { text: "Visiteurs" }), h("th", { text: "Offrandes CDF" }), h("th", { text: "Offrandes USD" }))),
        h("tbody", {}, rows), total ? h("tfoot", {}, total) : null));
    }
    var commRows = D.communities.filter(function (c) { return res.byCommunity[c.id]; }).map(function (c) { return row(c.name, res.byCommunity[c.id]); });
    var typeRows = D.types.filter(function (t) { return res.byType[t.id]; }).map(function (t) { return row(t.label, res.byType[t.id]); });
    var actKeys = Object.keys(res.acts).sort();
    var exStatus = Object.keys(res.excluded.byStatus).map(function (k) { return res.excluded.byStatus[k] + " " + TT.STATUS[k].toLowerCase(); }).join(", ");
    var periodLabel = s.kind === "year" ? "Année " + s.year : s.kind === "quarter" ? s.idx + (s.idx === 1 ? "er" : "e") + " trimestre " + s.year : TT.MONTHS[s.idx - 1] + " " + s.year;

    var scopeName = s.community ? D.communityName(s.community) : (isCommunity() ? D.communityName(D.profile.community_id) : "Toutes les communautés");
    var slug = function (x) { return String(x).normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, ""); };
    var statusLabels = { validated: "Fiches validées (chiffres officiels)", noDraft: "Toutes sauf brouillons", all: "Toutes, brouillons compris" };
    var fileBase = range.from + "_" + range.to;
    function exportCsv() {
      var rows = [["Période", periodLabel], [], ["Communauté", "Activités", "Membres", "Visiteurs", "Offrandes CDF", "Offrandes USD"]];
      D.communities.forEach(function (c) { var t = res.byCommunity[c.id]; if (t) rows.push([c.name, t.n, t.members, t.visitors, S.amount(t.fc), S.amount(t.usd)]); });
      rows.push(["TOTAL", res.total.n, res.total.members, res.total.visitors, S.amount(res.total.fc), S.amount(res.total.usd)]);
      TT.download("statistiques-tala-tala-" + fileBase + ".csv", TT.csv(rows));
    }
    function exportFiches() {
      var t = S.reportTable(res, { community: D.communityName, type: function (id) { var x = D.type(id); return x ? x.label : ""; }, status: function (st) { return TT.STATUS[st] || st; } });
      var rows = [["Période", periodLabel], [], t.head].concat(t.rows);
      rows.push(["TOTAL", "", "", "", "", res.total.members, res.total.visitors, S.amount(res.total.fc), S.amount(res.total.usd)]);
      TT.download("fiches-tala-tala-" + fileBase + ".csv", TT.csv(rows));
    }
    function exportPdf(btn) {
      savePdf(TTPdf.summaryModel(res, { title: "Statistiques du district", periodLabel: periodLabel, scopeLabel: scopeName, statusLabel: statusLabels[s.statuses],
        labels: pdfLabels(), communities: D.communities, types: D.types, periodSlug: slug(periodLabel), communitySlug: slug(scopeName) }), btn, "Utilisez « Exporter la synthèse (CSV) » sur cet écran.");
    }
    
    // Taux de validation par communauté : fiches validées / fiches transmises (hors brouillons), sur la période.
    var rateCard = (function () {
      var rows = D.communities.map(function (c) {
        var all = S.compute(D.reports, { from: range.from, to: range.to, statuses: statusSets.noDraft, communityId: c.id }).total.n;
        var ok = S.compute(D.reports, { from: range.from, to: range.to, statuses: statusSets.validated, communityId: c.id }).total.n;
        return { name: c.name, all: all, ok: ok };
      }).filter(function (r) { return r.all > 0; });
      if (!rows.length) return h("span", { hidden: true });
      return h("section", { class: "card" }, h("h3", { text: "Fiches validées par communauté" }),
        h("p", { class: "hint", text: "Part des fiches transmises (hors brouillons) que la Commission a validées sur la période." }),
        rows.map(function (r) {
          var p = Math.round(r.ok / r.all * 100);
          return h("div", { class: "rate-row" },
            h("div", { class: "rate-head" }, h("span", { text: r.name }), h("span", { class: "rate-val", text: r.ok + " / " + r.all + " · " + p + " %" })),
            h("div", { class: "reg-progress", role: "progressbar", "aria-label": r.name + " : fiches validées", "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": String(p) },
              h("span", { class: p >= 80 ? "is-good" : p >= 50 ? "is-warn" : "is-bad", style: "width:" + p + "%" })));
        }));
    })();
    shell([
      h("div", { class: "title-row" }, h("h2", { text: "Statistiques" })),
      h("div", { class: "card filters" }, field("Période", kindSel), field("Année", yearSel), idxSel ? field(s.kind === "month" ? "Mois" : "Trimestre", idxSel) : null, field("Fiches prises en compte", stSel), cSel ? field("Communauté", cSel) : null),
      
      // --- BLOC GRAPHIQUES ---
      h("section", { class: "charts", "aria-labelledby": "charts-title", style: "margin-bottom:1.5rem;" },
        h("h2", { id: "charts-title", class: "sr-only", text: "Vues graphiques" }),
        h("div", { class: "chart-card" }, h("h3", { text: "Évolution sur 12 mois" }), h("p", { class: "chart-sub", text: "Présences totales, toutes communautés confondues." }), h("div", { id: "sig-parchemin" })),
        h("div", { class: "chart-card" }, h("h3", { text: "Classement des communautés" }), h("p", { class: "chart-sub", text: "Présences par communauté sur la période. Touchez une ligne pour le détail." }), h("div", { id: "sig-honneur" })),
        h("div", { class: "chart-card" }, h("h3", { text: "Répartition par type d'activité" }), h("p", { class: "chart-sub", text: "Part de chaque type dans le total de la période." }), h("div", { id: "sig-roue" })),
        h("div", { class: "chart-card" }, h("h3", { text: "Calendrier du mois" }), h("p", { class: "chart-sub", text: "Activités par jour. Touchez une case pour voir le détail." }), h("div", { id: "sig-almanach" }))
      ),
      // ----------------------

      rateCard,
      h("section", { class: "card" },
        h("h3", { text: periodLabel }),
        res.total.n ? [table("Communauté", commRows, row("Total", res.total, true)), h("h3", { text: "Par type d'activité" }), table("Type", typeRows),
          actKeys.length ? [h("h3", { text: "Actes" }), h("div", { class: "scroll" }, h("table", {}, h("tbody", {}, actKeys.map(function (k) { return h("tr", {}, h("th", { scope: "row", text: k }), h("td", { text: TT.fmtInt(res.acts[k]) })); }))))] : null]
          : emptyState("○", "Aucune fiche pour cette période", "Choisissez une autre période ou élargissez les statuts retenus."),
        h("p", { class: "hint", text: "Chaque activité est comptée une seule fois. Les présences additionnent les effectifs de chaque service : une personne présente à deux services le même jour y figure deux fois. Les offrandes en CDF et en USD ne sont jamais additionnées entre elles." }),
        exStatus || res.excluded.superseded ? h("p", { class: "hint", text: "Non comptées : " + [exStatus, res.excluded.superseded ? res.excluded.superseded + " remplacée(s) par une correction validée" : ""].filter(Boolean).join(" ; ") + "." }) : null,
        h("div", { class: "actions" },
          h("button", { class: "btn ghost", type: "button", text: "Exporter la synthèse (CSV)", onclick: exportCsv }),
          h("button", { class: "btn ghost", type: "button", text: "Exporter les fiches (CSV)", onclick: exportFiches }),
          h("button", { class: "btn primary", type: "button", text: "Télécharger la synthèse (PDF)", onclick: function (ev) { exportPdf(ev.currentTarget); } })))
    ]);

    // Déclenchement du dessin des graphiques après le rendu HTML
    chartStats.periodLabel = periodLabel;
    chartStats.scopeName = scopeName;
    setTimeout(function () {
      if (window.mountStatsCharts) window.mountStatsCharts(chartStats);
    }, 10);
  }

  /* ---------- Comptes (administrateur) ---------- */
  var accountsCache = { rows: null, created: null };
  async function accountsScreen() {
    var box = h("div");
    var toggle = h("button", { class: "btn primary", type: "button", "aria-expanded": "false", "aria-controls": "ac-form", text: "+ Créer un compte" });
    shell([h("div", { class: "title-row" }, h("div", {}, h("h2", { text: "Comptes" }), h("p", { class: "hint", style: "font-style:italic", text: "Gérez les accès au registre du district." })), toggle), box]);
    if (!D.online) { box.appendChild(emptyState("⚠", "Connexion nécessaire", "La gestion des comptes nécessite une connexion Internet.")); return; }
    try { accountsCache.rows = await A.select("profiles", "select=*&order=created_at.asc"); } catch (e) { box.appendChild(h("p", { class: "msg bad", text: TT.friendly(e) })); return; }
    var me = A.user().id;
    var iMail = h("input", { id: "ac-mail", type: "email", required: true, inputmode: "email" });
    var iName = h("input", { id: "ac-name", type: "text", required: true });
    var iRole = h("select", { id: "ac-role", required: true }, ["community_clerk", "community_leader", "commission", "commission_deputy", "district_leader", "district_deputy"].map(function (r) { return opt(r, TT.ROLES[r]); }));
    var iComm = h("select", { id: "ac-comm" }, opt("", "—"), D.communities.map(function (c) { return opt(c.id, c.name); }));
    var commField = field("Communauté", iComm);
    function syncRole() { commField.hidden = !(iRole.value === "community_clerk" || iRole.value === "community_leader"); }
    iRole.addEventListener("change", syncRole);
    var msg = h("p", { class: "msg", hidden: true, role: "status" });
    var out = h("div");
    var form = h("form", { class: "card", id: "ac-form", hidden: true, onsubmit: async function (ev) {
      ev.preventDefault(); msg.hidden = true; TT.replaceAll(out);
      var comm = !commField.hidden ? iComm.value : null;
      if (!commField.hidden && !comm) { msg.textContent = "Choisissez la communauté."; msg.className = "msg bad"; msg.hidden = false; return; }
      try {
        var r = await A.fn("swift-api", { users: [{ email: iMail.value.trim(), display_name: iName.value.trim(), role: iRole.value, community_id: comm }] });
        var u = r.created[0];
        TT.replaceAll(out, h("div", { class: "box reg-gold" }, h("p", {}, h("strong", { text: "Compte créé pour " + u.email + "." })), h("p", { text: "Mot de passe provisoire (affiché une seule fois) :" }),
          h("p", {}, h("code", { id: "tmp-pw", text: u.temporary_password })),
          h("p", { class: "hint", text: "Transmettez-le de façon confidentielle. La personne devra le remplacer à sa première connexion." }),
          h("button", { class: "btn small", type: "button", text: "Copier", onclick: function () { try { navigator.clipboard.writeText(u.temporary_password).then(function () { TT.toast("Copié.", "good"); }); } catch (e) { TT.toast("Sélectionnez le mot de passe pour le copier.", "bad"); } } })));
        form.reset(); syncRole();
        try { accountsCache.rows = await A.select("profiles", "select=*&order=created_at.asc"); } catch (e) {}
      } catch (e) { msg.textContent = TT.friendly(e); msg.className = "msg bad"; msg.hidden = false; }
    } }, h("div", { class: "drawer-head" }, h("h3", { text: "Créer un compte" }), h("button", { class: "linklike", type: "button", text: "Fermer", onclick: function () { form.hidden = true; toggle.setAttribute("aria-expanded", "false"); toggle.focus(); } })), field("Adresse e-mail", iMail), field("Nom affiché", iName), field("Rôle", iRole), commField, msg, h("button", { class: "btn primary", type: "submit", text: "Créer le compte" }), out);
    syncRole();
    var out2 = h("div", { class: "box good", hidden: true });
    async function resetPassword(p, btn) {
      if (!await TT.confirmBox("Générer un nouveau mot de passe provisoire pour " + p.display_name + " ? L'ancien ne fonctionnera plus, et la personne devra en choisir un autre à sa prochaine connexion.", "Réinitialiser", true)) return;
      btn.disabled = true;
      try {
        var r = await A.fn("swift-api", { reset_password: { user_id: p.id } });
        out2.hidden = false;
        TT.replaceAll(out2, h("p", {}, h("strong", { text: "Nouveau mot de passe provisoire pour " + p.display_name + " :" })),
          h("p", {}, h("code", { text: r.temporary_password })),
          h("p", { class: "hint", text: "Affiché une seule fois. Transmettez-le de façon confidentielle." }));
      } catch (e) { TT.toast(TT.friendly(e), "bad"); }
      finally { btn.disabled = false; }
    }
    toggle.addEventListener("click", function () {
      form.hidden = !form.hidden;
      toggle.setAttribute("aria-expanded", String(!form.hidden));
      if (!form.hidden) iMail.focus();
    });
    var q = h("input", { id: "ac-search", type: "search", placeholder: "Rechercher par nom ou rôle", "aria-label": "Rechercher un utilisateur", oninput: function () { paint(); } });
    var listBox = h("div", { class: "card registre" });
    function rowFor(p) {
      var comm = p.community_id ? " — " + D.communityName(p.community_id) : "";
      return h("div", { class: "reg-row" },
        h("span", { class: "avatar", "aria-hidden": "true", text: initials(p.display_name) }),
        h("div", { class: "ri-main" }, h("h3", { class: "reg-name", text: p.display_name }), h("span", { class: "reg-role", text: (TT.ROLES[p.role] || p.role) + comm })),
        h("div", { class: "reg-side" }, chip(p.active ? "Actif" : "Désactivé", p.active ? "good" : "bad"), p.id === me ? chip("Vous", "") : h("div", { class: "reg-actions" },
          h("button", { class: "btn small ghost", type: "button", text: "Nouveau mot de passe", onclick: function (ev) { resetPassword(p, ev.currentTarget); } }),
          h("button", { class: "btn small ghost rubric", type: "button", text: p.active ? "Désactiver" : "Réactiver", onclick: async function () {
            if (!await TT.confirmBox((p.active ? "Désactiver" : "Réactiver") + " le compte de " + p.display_name + " ?", "Confirmer", p.active)) return;
            try { await A.update("profiles", "id=eq." + p.id, { active: !p.active }); TT.toast("Fait.", "good"); accountsScreen(); } catch (e) { TT.toast(TT.friendly(e), "bad"); }
          } }))));
    }
    function paint() {
      var needle = q.value.trim().toLowerCase();
      var rows = accountsCache.rows.filter(function (p) {
        return !needle || (p.display_name + " " + (TT.ROLES[p.role] || p.role) + " " + (p.community_id ? D.communityName(p.community_id) : "")).toLowerCase().indexOf(needle) >= 0;
      });
      TT.replaceAll(listBox, h("h3", { text: "Utilisateurs (" + rows.length + (needle ? " sur " + accountsCache.rows.length : "") + ")" }), out2,
        rows.length ? rows.map(rowFor) : h("p", { class: "muted", text: "Aucun utilisateur ne correspond à cette recherche." }));
    }
    paint();
    var list = h("div", {}, h("div", { class: "field" }, q), listBox);
    var backupCard = h("section", { class: "card" }, h("h3", { text: "Sauvegarde des données" }),
      h("p", { class: "hint", text: "Fichier complet : communautés, types d'activités, comptes (sans mots de passe), fiches, intervenants, actes, contrôles et validations. Conservez-le hors de cet appareil." }),
      h("button", { class: "btn ghost", type: "button", text: "Télécharger une sauvegarde (JSON)", onclick: function (ev) { backup(ev.currentTarget); } }));
    TT.replaceAll(box, form, list, backupCard);
  }

  async function backup(btn) {
    var old = btn.textContent; btn.disabled = true; btn.textContent = "Préparation…";
    try {
      var names = ["communities", "activity_types", "profiles", "reports", "report_officiants", "religious_acts", "report_controls", "report_validations"];
      var out = { format: "tala-tala-sauvegarde", app_version: "v16", created_at: new Date().toISOString(), counts: {}, tables: {} };
      for (var i = 0; i < names.length; i++) {
        out.tables[names[i]] = await A.selectAll(names[i], "select=*");
        out.counts[names[i]] = out.tables[names[i]].length;
      }
      var stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
      TT.download("sauvegarde-tala-tala-" + stamp + ".json", JSON.stringify(out), "application/json");
      TT.toast("Sauvegarde téléchargée : " + out.counts.reports + " fiche(s).", "good");
    } catch (e) { TT.toast("Sauvegarde impossible. " + TT.friendly(e), "bad"); }
    finally { btn.disabled = false; btn.textContent = old; }
  }

  /* ---------- Observateurs (Responsable et Suppléant du district) : constats, sans action ---------- */
  function initials(name) {
    return String(name || "").trim().split(/\s+/).filter(Boolean).slice(0, 2).map(function (w) { return w.charAt(0).toUpperCase(); }).join("") || "•";
  }
  function observerBlocks(y, m, st, monthName, rs) {
    var n = function (s) { return rs.filter(function (r) { return r.status === s; }).length; };
    var inProgress = n("submitted") + n("in_control") + n("checked") + n("needs_correction");
    var mois = monthName.charAt(0).toUpperCase() + monthName.slice(1) + " " + y;
    var constats = [
      st.total.n + " activité" + (st.total.n > 1 ? "s" : "") + " validée" + (st.total.n > 1 ? "s" : "") + " ce mois-ci.",
      inProgress ? inProgress + " fiche" + (inProgress > 1 ? "s" : "") + " en cours de traitement dans le district." : "Aucune fiche en cours de traitement dans le district.",
    ];
    return [
      h("section", { class: "hero" },
        h("h2", { text: "District de Tala-Tala — " + mois }),
        h("p", { class: "muted", text: TT.ROLES[role()] })),
      moneyBlock(st, y, m),
      h("section", { class: "card" }, h("h3", { text: "Situation du district" }),
        constats.map(function (t) { return h("p", { text: t }); }),
        h("p", { class: "hint", text: "Consultation en lecture seule. Les fiches sont saisies et contrôlées par les communautés et la Commission." })),
      h("div", { class: "actions" }, h("button", { class: "btn primary", type: "button", text: "Voir les statistiques", onclick: function () { go("stats", {}); } })),
    ];
  }
  function themeCard() {
    var cur = window.TTTheme ? TTTheme.get() : "auto";
    var opts = [["auto", "Automatique"], ["light", "Clair"], ["dark", "Sombre"]];
    return h("section", { class: "card" }, h("h3", { text: "Apparence" }),
      h("p", { class: "hint", text: "Affichage de l'application sur cet appareil. « Automatique » suit le réglage du téléphone." }),
      h("div", { class: "chips", role: "group", "aria-label": "Apparence" }, opts.map(function (o) {
        return h("button", { class: "chip" + (cur === o[0] ? " on" : ""), type: "button", "aria-pressed": String(cur === o[0]), text: o[1],
          onclick: function () { TTTheme.set(o[0]); render(); } });
      })));
  }
  function accountScreen() {
    shell([
      h("div", { class: "title-row" }, h("h2", { text: "Compte" })),
      themeCard(),
      h("section", { class: "card" },
        h("h3", { text: D.profile.display_name || "" }),
        h("p", { class: "muted", text: TT.ROLES[role()] || role() }),
        isAdmin() ? h("p", { class: "hint", text: "Créez les comptes et réinitialisez les mots de passe depuis l'écran Comptes." })
          : h("p", { class: "hint", text: "Pour un nouveau mot de passe, adressez-vous à l'administrateur du district." }),
        h("div", { class: "actions" },
          isAdmin() ? h("button", { class: "btn primary", type: "button", text: "Gérer les comptes", onclick: function () { go("accounts", {}); } }) : null,
          h("button", { class: "btn ghost", type: "button", text: "Se déconnecter", onclick: function () { logout(); } }))),
    ]);
  }

  /* ---------- Rendu ---------- */
  function render() {
    if (!D.profile) return;
    switch (state.screen) {
      case "home": return homeScreen();
      case "reports": return reportsScreen();
      case "review": return reviewScreen();
      case "detail": return detailScreen();
      case "form": return formScreen();
      case "stats": return statsScreen();
      case "accounts": if (isAdmin()) return accountsScreen(); break;
      case "account": return accountScreen();
    }
    homeScreen();
  }

  /* ---------- Lancement ---------- */
  window.addEventListener("online", function () { D.online = true; if (D.profile) { D.sync().then(function () { return D.loadRef(); }).then(render).catch(function () {}); render(); } });
  window.addEventListener("offline", function () { D.online = false; if (D.profile) render(); });
  A.onSignedOut = function () { clearInterval(timer); D.reset(); showLogin("Votre session a expiré. Reconnectez-vous.", "bad"); };

  (async function boot() {
    if ("serviceWorker" in navigator && location.protocol !== "file:") { navigator.serviceWorker.register("sw.js").catch(function () {}); }
    var hashRes = null;
    try { hashRes = await A.consumeUrlHash(); } catch (e) { hashRes = { error: TT.friendly(e) }; }
    if (hashRes && hashRes.error) { showLogin("Lien invalide ou expiré : " + hashRes.error + " Demandez un nouveau lien.", "bad", "recover"); return; }
    if (hashRes && hashRes.type === "recovery") state.recovery = true;
    if (A.session() && A.user()) await startSession(); else showLogin();
  })();
  window.TTApp = { state: state, go: go };
})();

// =========================================================
// V16 — Vérification de révocation de session
// =========================================================
(function () {
  const EPOCH_KEY = 'tt:session_epoch';
  
  async function checkSessionEpoch() {
    if (typeof TTApi === 'undefined' || !TTApi.session() || !TTApi.user()) return;
    try {
      const stored = parseInt(localStorage.getItem(EPOCH_KEY) || '0', 10);
      var res = await TTApi.select('profiles', 'select=session_epoch&id=eq.' + TTApi.user().id);
      if (!res || !res.length) return;
      const server = (res[0].session_epoch != null ? res[0].session_epoch : 0);

      if (stored > 0 && stored !== server) {
        await TTApi.signOut();
        localStorage.removeItem(EPOCH_KEY);
        if (window.TT && typeof window.TT.toast === 'function') {
          window.TT.toast('Votre session a été révoquée. Reconnectez-vous.', 'bad');
        }
        location.reload(); // Recharge la page pour revenir à l'écran de connexion
        return;
      }

      if (server !== stored) {
        localStorage.setItem(EPOCH_KEY, String(server));
      }
    } catch (e) {
      console.warn('Vérification de session ignorée', e);
    }
  }

  window.addEventListener('load', () => setTimeout(checkSessionEpoch, 2000));
  setInterval(checkSessionEpoch, 5 * 60 * 1000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) checkSessionEpoch();
  });
})();

// =========================================================
// V16 — Fonction d'affichage des graphiques
// =========================================================
window.mountStatsCharts = function (stats) {
  if (!window.TTSig) return;
  const fmtN = (v) => Number(v || 0).toLocaleString('fr-FR');
  // Légende (phrase du cartographe) placée sous le graphique.
  const caption = (box, text) => {
    if (!box || !text) return;
    const p = document.createElement('p');
    p.className = 'sig-legend';
    p.textContent = text;
    box.parentNode.appendChild(p);
  };
  // Équivalent texte, lu par les lecteurs d'écran uniquement.
  const srTable = (box, title, head, rows) => {
    const t = document.createElement('table');
    t.className = 'sr-only';
    const cap = document.createElement('caption');
    cap.textContent = title;
    t.appendChild(cap);
    const hr = document.createElement('tr');
    head.forEach((x) => { const th = document.createElement('th'); th.setAttribute('scope', 'col'); th.textContent = x; hr.appendChild(th); });
    t.appendChild(hr);
    rows.forEach((r) => {
      const tr = document.createElement('tr');
      r.forEach((c) => { const td = document.createElement('td'); td.textContent = String(c); tr.appendChild(td); });
      t.appendChild(tr);
    });
    box.appendChild(t);
  };

  const lineBox = document.getElementById('sig-parchemin');
  if (lineBox && stats.byMonth && stats.byMonth.length) {
    const months = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
    const values = stats.byMonth.map((m) => m.total);
    const res = TTSig.parchemin(lineBox, {
      values: values,
      labels: stats.byMonth.map((m) => m.shortLabel || m.label),
      year: stats.year,
      title: 'Présences mois par mois en ' + stats.year,
      desc: 'Présences par mois en ' + stats.year + ' : ' + values.map((v, i) => months[i] + ' ' + fmtN(v)).join(', ') + '.',
    });
    srTable(lineBox, 'Présences par mois, ' + stats.year, ['Mois', 'Présences'], stats.byMonth.map((m) => [m.label, fmtN(m.total)]));
    caption(lineBox, res.legend);
  }

  const honBox = document.getElementById('sig-honneur');
  if (honBox && stats.byCommunity) {
    const res = TTSig.honneur(honBox, {
      rows: stats.byCommunity.slice(0, 12).map((c) => ({ name: c.name, value: c.total, isMine: c.isMine, items: c.items })),
      caption: 'Classement des communautés par nombre de présences',
      periodLabel: stats.periodLabel || '',
      scopeLabel: stats.scopeName || '',
    });
    caption(honBox, res.legend);
  }

  const rouBox = document.getElementById('sig-roue');
  if (rouBox && stats.byType) {
    const res = TTSig.roue(rouBox, {
      segments: stats.byType.map((t) => ({ label: t.label, value: t.total })),
      title: "Répartition des activités par type",
      desc: 'Répartition : ' + stats.byType.map((t) => t.label + ' ' + fmtN(t.total)).join(', ') + '.',
    });
    if (res.rows.length) srTable(rouBox, "Répartition par type d'activité", ['Type', 'Activités'], res.rows.map((r) => [r.label, fmtN(r.value)]));
    caption(rouBox, res.legend);
  }

  const almBox = document.getElementById('sig-almanach');
  if (almBox && stats.almanach) {
    const res = TTSig.almanach(almBox, stats.almanach);
    caption(almBox, res.legend);
  }
};