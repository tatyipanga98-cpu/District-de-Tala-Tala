/* Calculs statistiques purs (sans accès réseau). Utilisés par l'écran Statistiques, les exports CSV et les PDF,
   pour que les trois donnent exactement les mêmes totaux. Testés par tests/stats.test.js.

   Règles de calcul (documentées dans LISEZMOI.txt) :
   - une fiche est comptée une seule fois, dans la période de son « date d'activité » ;
   - seules les fiches dont le statut figure dans « statuses » sont retenues (null = toutes) ;
   - une fiche d'origine est remplacée (non comptée) lorsqu'une fiche corrective la remplace
     et que cette correction est elle-même retenue pour la même période : aucun double comptage ;
   - les montants sont manipulés en centimes entiers (évite les erreurs d'arrondi des décimaux) ;
   - les offrandes CDF et USD ne sont jamais additionnées entre elles. */
(function (root) {
  "use strict";
  function cents(x) { return Math.round(Number(x == null || x === "" ? 0 : x) * 100); }
  function count(x) { var n = Number(x == null || x === "" ? 0 : x); return isFinite(n) ? n : 0; }
  function pad(n) { return (n < 10 ? "0" : "") + n; }

  /* Bornes d'une période : kind = "month" (idx 1-12), "quarter" (idx 1-4) ou "year". */
  function periodRange(kind, year, idx) {
    year = Number(year); idx = Number(idx);
    if (kind === "year") return { from: year + "-01-01", to: year + "-12-31" };
    var m1, m2;
    if (kind === "quarter") { m1 = (idx - 1) * 3 + 1; m2 = m1 + 2; } else { m1 = m2 = idx; }
    var last = new Date(year, m2, 0).getDate(); // jour 0 du mois suivant = dernier jour (années bissextiles incluses)
    return { from: year + "-" + pad(m1) + "-01", to: year + "-" + pad(m2) + "-" + pad(last) };
  }

  function blank() { return { n: 0, members: 0, visitors: 0, fc: 0, usd: 0 }; }
  function add(t, r) {
    t.n += 1; t.members += count(r.members_count); t.visitors += count(r.visitors_count);
    t.fc += cents(r.offering_fc); t.usd += cents(r.offering_usd);
  }

  /* opts : { from, to, statuses (tableau ou null = tous), communityId (facultatif) } */
  function compute(reports, opts) {
    var statuses = opts.statuses ? new Set(opts.statuses) : null;
    var res = { total: blank(), byCommunity: {}, byType: {}, acts: {}, excluded: { superseded: 0, byStatus: {}, outside: 0 }, included: [] };
    // 1re passe : fiches retenues pour la période, la communauté et le statut.
    var pass = [];
    (reports || []).forEach(function (r) {
      if (!r || !r.activity_date || r.activity_date < opts.from || r.activity_date > opts.to) { res.excluded.outside++; return; }
      if (opts.communityId && r.community_id !== opts.communityId) return;
      if (statuses && !statuses.has(r.status)) { res.excluded.byStatus[r.status] = (res.excluded.byStatus[r.status] || 0) + 1; return; }
      pass.push(r);
    });
    // 2e passe : une fiche d'origine remplacée par une correction retenue n'est plus comptée.
    var superseded = new Set();
    pass.forEach(function (r) { if (r.corrected_from) superseded.add(r.corrected_from); });
    pass.forEach(function (r) {
      if (superseded.has(r.id)) { res.excluded.superseded++; return; }
      res.included.push(r);
      add(res.total, r);
      add(res.byCommunity[r.community_id] = res.byCommunity[r.community_id] || blank(), r);
      add(res.byType[r.activity_type_id] = res.byType[r.activity_type_id] || blank(), r);
      (r.religious_acts || []).forEach(function (a) {
        var k = (a.act_type || "").trim() || "(sans nom)";
        res.acts[k] = (res.acts[k] || 0) + count(a.quantity);
      });
    });
    res.included.sort(function (a, b) { return (a.activity_date || "").localeCompare(b.activity_date || "") || (a.report_code || "").localeCompare(b.report_code || ""); });
    return res;
  }

  /* Montant en centimes -> texte pour PDF et CSV (séparateur d'espace insécable remplacé par une espace simple). */
  function amount(c, unit) {
    var neg = c < 0; c = Math.abs(c);
    var whole = Math.floor(c / 100), frac = c % 100;
    var s = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, " ") + "," + pad(frac);
    return (neg ? "-" : "") + s + (unit ? " " + unit : "");
  }

  /* Tableau « une ligne par fiche incluse » (CSV et annexe PDF). labels = { community(id), type(id) }. */
  function reportTable(res, labels) {
    var head = ["N° de fiche", "Date", "Communauté", "Type d'activité", "Statut", "Membres", "Visiteurs", "Offrande CDF", "Offrande USD"];
    var rows = res.included.map(function (r) {
      return [r.report_code || "(en attente)", dateFr(r.activity_date), labels.community(r.community_id), labels.type(r.activity_type_id), labels.status ? labels.status(r.status) : r.status,
        count(r.members_count), count(r.visitors_count), amount(cents(r.offering_fc)), amount(cents(r.offering_usd))];
    });
    return { head: head, rows: rows };
  }

  /* Date ISO (AAAA-MM-JJ) -> JJ/MM/AAAA. */
  function dateFr(s) {
    if (!s) return "—";
    var p = String(s).slice(0, 10).split("-");
    return p.length === 3 ? p[2] + "/" + p[1] + "/" + p[0] : String(s);
  }

  function presences(t) { return ((t && t.members) || 0) + ((t && t.visitors) || 0); }
  var api = { presences: presences, cents: cents, count: count, periodRange: periodRange, compute: compute, amount: amount, reportTable: reportTable, dateFr: dateFr };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.TTStats = api;
})(typeof window !== "undefined" ? window : globalThis);
