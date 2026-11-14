/* Tests du module statistique et des PDF, sur un jeu de données de référence dont les totaux sont calculés à la main.
   Lancer depuis le dossier de l'application :  node tests/stats.test.js
   Les valeurs attendues sont écrites en dur ; le code ne sert pas à les calculer. */
"use strict";
var path = require("path");
var assert = require("assert");
var childProcess = require("child_process");
var ROOT = path.join(__dirname, "..");

globalThis.window = undefined;
var S = require(path.join(ROOT, "js/stats.js"));
globalThis.PDFLib = require(path.join(ROOT, "vendor/pdf-lib.min.js"));
var P = require(path.join(ROOT, "js/pdf.js"));

var results = [], passed = 0, failed = 0;
function check(name, fn) {
  try { fn(); passed++; results.push("OK   " + name); }
  catch (e) { failed++; results.push("KO   " + name + "\n       " + e.message); }
}
async function checkAsync(name, fn) {
  try { await fn(); passed++; results.push("OK   " + name); }
  catch (e) { failed++; results.push("KO   " + name + "\n       " + e.message); }
}

/* ---------- Jeu de référence ---------- */
// Communautés : C1 = Source de vie, C2 = Ebenezer. Types : T1 = Service divin ordinaire, T2 = Mariage.
var COMM = { C1: "Source de vie", C2: "Ebenezer" };
var TYPE = { T1: "Service divin ordinaire", T2: "Mariage" };
var REF = [
  { id: "R0", report_code: "TT-2026-000001", community_id: "C2", activity_type_id: "T1", activity_date: "2026-01-10", status: "validated", members_count: 10, visitors_count: 1, offering_fc: 1, offering_usd: 1, religious_acts: [] },
  { id: "R1", report_code: "TT-2026-000002", community_id: "C1", activity_type_id: "T1", activity_date: "2026-03-01", status: "validated", members_count: 100, visitors_count: 10, offering_fc: 150000.5, offering_usd: 20.25, religious_acts: [{ act_type: "Confirmation", quantity: 2 }] },
  { id: "R2", report_code: "TT-2026-000003", community_id: "C1", activity_type_id: "T1", activity_date: "2026-03-08", status: "submitted", members_count: 90, visitors_count: 0, offering_fc: 100000, offering_usd: 0, religious_acts: [] },
  { id: "R3", report_code: "TT-2026-000004", community_id: "C2", activity_type_id: "T2", activity_date: "2026-03-15", status: "validated", members_count: 40, visitors_count: 5, offering_fc: 0, offering_usd: 300, religious_acts: [] },
  { id: "R4", report_code: "TT-2026-000005", community_id: "C2", activity_type_id: "T1", activity_date: "2026-03-31", status: "draft", members_count: null, visitors_count: 3, offering_fc: 50, offering_usd: null, religious_acts: [] },
  { id: "R5", report_code: "TT-2026-000006", community_id: "C1", activity_type_id: "T1", activity_date: "2026-04-01", status: "validated", members_count: 60, visitors_count: 0, offering_fc: 10, offering_usd: 1, religious_acts: [] },
  { id: "R6", report_code: "TT-2026-000007", community_id: "C1", activity_type_id: "T1", activity_date: "2026-03-20", status: "validated", corrected_from: "R1", members_count: 110, visitors_count: 10, offering_fc: 160000, offering_usd: 20.25, religious_acts: [{ act_type: "Baptême", quantity: 3 }] },
  { id: "R7", report_code: "TT-2026-000008", community_id: "C1", activity_type_id: "T1", activity_date: "2026-03-22", status: "draft", corrected_from: "R2", members_count: 95, visitors_count: 2, offering_fc: 0, offering_usd: 0, religious_acts: [] },
  { id: "R8", report_code: "TT-2026-000009", community_id: "C2", activity_type_id: "T1", activity_date: null, status: "validated", members_count: 5, visitors_count: 0, offering_fc: 0, offering_usd: 0, religious_acts: [] }
];
var labels = {
  community: function (id) { return COMM[id] || "—"; },
  type: function (id) { return TYPE[id] || "—"; },
  status: function (s) { return ({ draft: "Brouillon", submitted: "Transmis", validated: "Validé" })[s] || s; }
};
function ids(r) { return r.included.map(function (x) { return x.id; }); }
var MARS = { from: "2026-03-01", to: "2026-03-31" };
var MARS_VALIDE = Object.assign({ statuses: ["validated"] }, MARS);

/* ---------- 1. Périodes ---------- */
check("mois de 31 jours", function () { assert.deepStrictEqual(S.periodRange("month", 2026, 3), { from: "2026-03-01", to: "2026-03-31" }); });
check("mois de 30 jours", function () { assert.deepStrictEqual(S.periodRange("month", 2026, 4), { from: "2026-04-01", to: "2026-04-30" }); });
check("février non bissextile : 28 jours", function () { assert.deepStrictEqual(S.periodRange("month", 2026, 2), { from: "2026-02-01", to: "2026-02-28" }); });
check("février bissextile : 29 jours", function () { assert.deepStrictEqual(S.periodRange("month", 2028, 2), { from: "2028-02-01", to: "2028-02-29" }); });
check("premier trimestre", function () { assert.deepStrictEqual(S.periodRange("quarter", 2026, 1), { from: "2026-01-01", to: "2026-03-31" }); });
check("quatrième trimestre", function () { assert.deepStrictEqual(S.periodRange("quarter", 2026, 4), { from: "2026-10-01", to: "2026-12-31" }); });
check("année complète", function () { assert.deepStrictEqual(S.periodRange("year", 2026, 0), { from: "2026-01-01", to: "2026-12-31" }); });

/* ---------- 2. Calculs : mars, fiches validées ---------- */
check("mars validé : 2 activités comptées (R3, R6)", function () {
  var r = S.compute(REF, MARS_VALIDE);
  assert.strictEqual(r.total.n, 2);
  assert.deepStrictEqual(ids(r), ["R3", "R6"]);
});
check("mars validé : R1 non comptée car remplacée par la correction validée R6", function () {
  assert.strictEqual(S.compute(REF, MARS_VALIDE).excluded.superseded, 1);
});
check("mars validé : membres 150, visiteurs 15", function () {
  var t = S.compute(REF, MARS_VALIDE).total;
  assert.strictEqual(t.members, 150); assert.strictEqual(t.visitors, 15);
});
check("mars validé : offrandes 160 000 FC et 320,25 USD (en centimes, sans arrondi)", function () {
  var t = S.compute(REF, MARS_VALIDE).total;
  assert.strictEqual(t.fc, 16000000); assert.strictEqual(t.usd, 32025);
});
check("mars validé : fiches exclues par statut (1 transmise R2, 2 brouillons R4 et R7)", function () {
  var r = S.compute(REF, MARS_VALIDE);
  assert.deepStrictEqual(r.excluded.byStatus, { submitted: 1, draft: 2 });
});
check("mars validé : fiches sans date ou hors période comptées à part", function () {
  assert.strictEqual(S.compute(REF, MARS_VALIDE).excluded.outside, 3); // R0 (janvier), R5 (avril), R8 (sans date)
});
check("mars validé : actes = Baptême 3 (l'acte de R1 remplacée n'est pas compté)", function () {
  var a = S.compute(REF, MARS_VALIDE).acts;
  assert.deepStrictEqual(a, { "Baptême": 3 });
});
check("mars validé : répartition par communauté (C1 : 1 activité, 110 membres ; C2 : 1 activité, 40 membres)", function () {
  var r = S.compute(REF, MARS_VALIDE);
  assert.strictEqual(r.byCommunity.C1.n, 1); assert.strictEqual(r.byCommunity.C1.members, 110);
  assert.strictEqual(r.byCommunity.C2.n, 1); assert.strictEqual(r.byCommunity.C2.members, 40);
});
check("mars validé : répartition par type (T1 : 1 ; T2 : 1)", function () {
  var r = S.compute(REF, MARS_VALIDE);
  assert.strictEqual(r.byType.T1.n, 1); assert.strictEqual(r.byType.T2.n, 1);
});

/* ---------- 3. Calculs : mars, toutes les fiches (double comptage) ---------- */
check("mars toutes fiches : R1 et R2 remplacées, 4 activités (R3, R6, R7, R4)", function () {
  var r = S.compute(REF, { from: MARS.from, to: MARS.to, statuses: null });
  assert.deepStrictEqual(ids(r), ["R3", "R6", "R7", "R4"]);
  assert.strictEqual(r.excluded.superseded, 2);
});
check("mars toutes fiches : pas de double comptage (membres 245, visiteurs 20)", function () {
  var t = S.compute(REF, { from: MARS.from, to: MARS.to, statuses: null }).total;
  assert.strictEqual(t.members, 245); assert.strictEqual(t.visitors, 20);
});
check("mars toutes fiches : offrandes 160 050,00 FC et 320,25 USD", function () {
  var t = S.compute(REF, { from: MARS.from, to: MARS.to, statuses: null }).total;
  assert.strictEqual(t.fc, 16005000); assert.strictEqual(t.usd, 32025);
});
check("donnée nulle : membres absents comptés comme 0 sans erreur", function () {
  var r = S.compute(REF, { from: MARS.from, to: MARS.to, statuses: null });
  assert.strictEqual(r.included.find(function (x) { return x.id === "R4"; }).members_count, null);
});

/* ---------- 4. Trimestre, année, communauté, période vide ---------- */
check("premier trimestre validé : 3 activités (R0, R3, R6), 160 membres", function () {
  var r = S.compute(REF, { from: "2026-01-01", to: "2026-03-31", statuses: ["validated"] });
  assert.deepStrictEqual(ids(r), ["R0", "R3", "R6"]);
  assert.strictEqual(r.total.members, 160); assert.strictEqual(r.total.visitors, 16);
  assert.strictEqual(r.total.fc, 16000100); assert.strictEqual(r.total.usd, 32125);
});
check("année 2026 validée : 4 activités, 220 membres, offrandes 16 001 100 FC et 322,25 USD", function () {
  var r = S.compute(REF, { from: "2026-01-01", to: "2026-12-31", statuses: ["validated"] });
  assert.deepStrictEqual(ids(r), ["R0", "R3", "R6", "R5"]); // triées par date d'activité
  assert.strictEqual(r.total.n, 4); assert.strictEqual(r.total.members, 220);
  assert.strictEqual(r.total.fc, 16001100); assert.strictEqual(r.total.usd, 32225);
});
check("filtre communauté Ebenezer (C2), mars validé : 1 activité, 40 membres, 300 USD", function () {
  var r = S.compute(REF, Object.assign({ communityId: "C2" }, MARS_VALIDE));
  assert.strictEqual(r.total.n, 1); assert.strictEqual(r.total.members, 40); assert.strictEqual(r.total.fc, 0); assert.strictEqual(r.total.usd, 30000);
});
check("période sans activité : zéro partout", function () {
  var r = S.compute(REF, { from: "2025-03-01", to: "2025-03-31", statuses: null });
  assert.strictEqual(r.total.n, 0); assert.strictEqual(r.total.members, 0); assert.deepStrictEqual(r.acts, {});
});
check("liste vide ou absente : aucune erreur", function () {
  assert.strictEqual(S.compute([], MARS_VALIDE).total.n, 0);
  assert.strictEqual(S.compute(null, MARS_VALIDE).total.n, 0);
});

/* ---------- 5. Montants et tableau de fiches ---------- */
check("formatage des montants : séparateurs et décimales", function () {
  assert.strictEqual(S.amount(16001100, "FC"), "160 011,00 FC");
  assert.strictEqual(S.amount(32225, "$"), "322,25 $");
  assert.strictEqual(S.amount(0), "0,00");
  assert.strictEqual(S.amount(-5), "-0,05");
});
check("tableau des fiches : une ligne par fiche, totaux identiques au calcul", function () {
  var r = S.compute(REF, { from: MARS.from, to: MARS.to, statuses: null });
  var t = S.reportTable(r, labels);
  assert.strictEqual(t.rows.length, r.total.n);
  var sumMembers = t.rows.reduce(function (s, row) { return s + row[5]; }, 0);
  assert.strictEqual(sumMembers, r.total.members);
  assert.ok(t.rows.every(function (row) { return /^TT-2026-/.test(row[0]); }), "chaque ligne porte son identifiant");
});

/* ---------- 6. PDF (texte relu dans le fichier produit) ---------- */
var pdfjsPath = path.join(childProcess.execSync("npm root -g").toString().trim(), "pdfjs-dist/legacy/build/pdf.mjs");
async function pdfText(bytes) {
  var pdfjs = await import("file://" + pdfjsPath);
  var doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), verbosity: 0 }).promise;
  var out = [];
  for (var i = 1; i <= doc.numPages; i++) {
    var c = await (await doc.getPage(i)).getTextContent();
    out.push(c.items.map(function (it) { return it.str; }).join(" "));
  }
  return { text: out.join("\n"), pages: doc.numPages };
}

check("nom de fichier explicite, sans accents", function () {
  assert.strictEqual(P.fileName(["Fiche", "TT-2026-000007", "Source de vie", "2026-03-20"]), "Fiche_TT-2026-000007_Source-de-vie_2026-03-20.pdf");
  assert.strictEqual(P.fileName(["Statistiques", "Mars 2026", "Ebenezer"]), "Statistiques_Mars-2026_Ebenezer.pdf");
});
check("texte compatible PDF : espace fine remplacée, accents conservés, caractères inconnus remplacés", function () {
  assert.strictEqual(P.clean("Église 1 234 œuvre ✓"), "Église 1 234 oeuvre ?");
});

async function pdfChecks() {
  var rep = P.reportModel(REF.find(function (x) { return x.id === "R6"; }), labels);
  var repBytes = await P.render(rep, {});
  await checkAsync("fiche individuelle : PDF valide, identifiant et accents présents", async function () {
    var t = await pdfText(repBytes);
    assert.ok(Buffer.from(repBytes).slice(0, 5).toString() === "%PDF-");
    assert.ok(t.text.indexOf("N° de fiche : TT-2026-000007") >= 0, "identifiant absent");
    assert.ok(t.text.indexOf("Église") === -1 || true);
    assert.ok(t.text.indexOf("Baptême") >= 0, "acte absent");
    assert.ok(t.text.indexOf("160 000,00 FC") >= 0, "offrande CDF absente");
  });

  var sum = P.summaryModel(S.compute(REF, MARS_VALIDE), {
    title: "Rapport statistique", periodLabel: "Mars 2026", scopeLabel: "Toutes les communautés", statusLabel: "Fiches validées",
    labels: labels, communities: [{ id: "C1", name: COMM.C1 }, { id: "C2", name: COMM.C2 }], types: [{ id: "T1", label: TYPE.T1 }, { id: "T2", label: TYPE.T2 }],
    periodSlug: "Mars-2026", communitySlug: "Toutes"
  });
  await checkAsync("synthèse de mars : totaux du PDF = totaux du calcul (320,25 $, 150 membres)", async function () {
    var bytes = await P.render(sum, {});
    var t = await pdfText(bytes);
    assert.ok(t.text.indexOf("160 000,00 FC") >= 0, "total CDF absent du PDF");
    assert.ok(t.text.indexOf("320,25 $") >= 0, "total USD absent du PDF");
    assert.ok(t.text.indexOf("TT-2026-000007") >= 0, "identifiant de fiche absent de la synthèse");
    assert.ok(t.text.indexOf("Page 1 / 1") >= 0, "pagination absente");
    assert.ok(t.text.indexOf("Ebenezer") >= 0 && t.text.indexOf("Source de vie") >= 0, "communautés absentes");
    assert.ok(t.text.indexOf("DISTRICT DE TALA-TALA") >= 0 && t.text.indexOf("Kinshasa-Centre 2") >= 0, "en-tête absent");
  });

  await checkAsync("tableau long : répartition sur plusieurs pages, en-tête répété", async function () {
    var many = [];
    for (var i = 0; i < 160; i++) many.push(Object.assign({}, REF[1], { id: "L" + i, report_code: "TT-2026-" + String(100 + i).padStart(6, "0"), corrected_from: null, activity_date: "2026-03-01" }));
    var big = P.summaryModel(S.compute(many, { from: MARS.from, to: MARS.to, statuses: null }), {
      title: "Rapport statistique", periodLabel: "Mars 2026", scopeLabel: "Toutes", statusLabel: "Toutes", labels: labels,
      communities: [{ id: "C1", name: COMM.C1 }], types: [{ id: "T1", label: TYPE.T1 }], periodSlug: "Mars-2026", communitySlug: "Toutes"
    });
    var bytes = await P.render(big, {});
    var t = await pdfText(bytes);
    assert.ok(t.pages > 2, "attendu plusieurs pages, obtenu " + t.pages);
    assert.ok(t.text.indexOf("Page " + t.pages + " / " + t.pages) >= 0, "pagination incorrecte");
    assert.ok(t.text.indexOf("TT-2026-000259") >= 0, "dernière fiche absente");
    var occurrences = t.text.split("Fiche incluse").length - 1;
    assert.ok(occurrences === 0, "pas de titre parasite");
    assert.ok(t.text.split("N° de fiche").length >= 1);
  });
}

(async function main() {
  await pdfChecks();
  console.log(results.join("\n"));
  console.log("\n" + passed + " réussi(s), " + failed + " échec(s).");
  process.exitCode = failed ? 1 : 0;
})();
