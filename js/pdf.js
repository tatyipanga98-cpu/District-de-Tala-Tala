/* Génération des rapports PDF (fiche individuelle, synthèse de période, communauté ou district).
   Bibliothèque locale vendor/pdf-lib.min.js (MIT) : aucun appel réseau, fonctionne hors connexion.
   La construction du contenu (modèles) est séparée du dessin, pour être testée (tests/pdf.test.js). */
(function (root) {
  "use strict";
  var S = root.TTStats;

  var ORG = "DISTRICT DE TALA-TALA";
  var ORG_SUB = "Champ apostolique de Kinshasa-Centre 2";
  var ORG_EGLISE = "Église Néo-Apostolique · RDC-Ouest";
  var EXTRA_OK = "€‚ƒ„…†‡ˆ‰Š‹ŽŸ‘’“”•–—˜™š›žŸ";

  function pad(n) { return (n < 10 ? "0" : "") + n; }

  /* Texte compatible avec les polices standard PDF (WinAnsi) : accents français conservés. */
  function clean(s) {
    s = String(s == null ? "" : s).normalize("NFC")
      .replace(/[   ]/g, " ").replace(/œ/g, "oe").replace(/Œ/g, "OE")
      .replace(/→/g, "->").replace(/…/g, "...").replace(/[\r\n\t]+/g, " ");
    var out = "";
    for (var ch of s) {
      var c = ch.codePointAt(0);
      out += (c >= 32 && c <= 126) || (c >= 160 && c <= 255) || EXTRA_OK.indexOf(ch) >= 0 ? ch : "?";
    }
    return out;
  }
  function stamp(d) {
    d = d || new Date();
    return pad(d.getDate()) + "/" + pad(d.getMonth() + 1) + "/" + d.getFullYear() + " à " + pad(d.getHours()) + ":" + pad(d.getMinutes());
  }
  /* Nom de fichier explicite, sans accents ni caractères spéciaux. */
  function fileName(parts) {
    return parts.map(function (p) {
      return String(p == null ? "" : p).normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
    }).filter(Boolean).join("_") + ".pdf";
  }

  /* ---------- Modèles (contenu, sans dessin) ---------- */
  // Un modèle : { title, subtitle, fileName, code, generated, blocks: [ {type:"kv"|"heading"|"para"|"table", ...} ] }

  function reportModel(r, labels) {
    var typeLabel = labels.type(r.activity_type_id) || "Activité";
    var offs = (r.report_officiants || []).slice().sort(function (a, b) { return (a.position_order || 0) - (b.position_order || 0); });
    var principal = offs.filter(function (o) { return o.role_in_activity === "principal"; });
    var assistants = offs.filter(function (o) { return o.role_in_activity !== "principal"; });
    var blocks = [
      { type: "kv", rows: [
        ["Communauté", labels.community(r.community_id)],
        ["Type d'activité", typeLabel],
        ["Précision", r.activity_description],
        ["Date", fmtDate(r.activity_date)],
        ["Heure de début", r.start_time ? String(r.start_time).slice(0, 5) : null],
        ["Heure de fin", r.end_time ? String(r.end_time).slice(0, 5) : null],
        ["Statut", labels.status(r.status)],
        ["Membres présents", S.count(r.members_count)],
        ["Visiteurs", S.count(r.visitors_count)],
        ["Offrande en CDF", S.amount(S.cents(r.offering_fc), "FC")],
        ["Offrande en USD", S.amount(S.cents(r.offering_usd), "$")],
        ["Texte biblique", r.bible_text],
        ["Rédigé par", r.writer_name],
        ["Observations", r.observations]
      ] },
      { type: "heading", text: "Intervenants à l'autel de grâce" },
      { type: "kv", rows: [
        ["Officiant", principal.length ? principal.map(function (o) { return o.name_as_reported; }).join(", ") : "Aucun"],
        ["Assistants", assistants.length ? assistants.map(function (o) { return o.name_as_reported; }).join(", ") : "Aucun"]
      ] }
    ];
    var acts = r.religious_acts || [];
    blocks.push({ type: "heading", text: "Actes" });
    blocks.push(acts.length
      ? { type: "table", head: ["Type d'acte", "Nombre", "Note"], widths: [0.5, 0.15, 0.35], align: ["l", "r", "l"],
          rows: acts.map(function (a) { return [a.act_type, S.count(a.quantity), a.notes]; }) }
      : { type: "para", text: "Aucun acte enregistré." });
    return {
      title: "Fiche d'activité", subtitle: typeLabel + " du " + fmtDate(r.activity_date),
      code: r.report_code || "En attente d'envoi", generated: stamp(),
      fileName: fileName(["Fiche", r.report_code || "en-attente", labels.community(r.community_id), r.activity_date]),
      blocks: blocks
    };
  }

  function fmtDate(s) { return S.dateFr(s); }

  /* res : résultat de TTStats.compute ; meta : { periodLabel, scopeLabel, statusLabel, labels, communitySlug, periodSlug, title } */
  function summaryModel(res, meta) {
    var L = meta.labels, tot = res.total;
    var commRows = meta.communities.filter(function (c) { return res.byCommunity[c.id]; }).map(function (c) { return sumRow(c.name, res.byCommunity[c.id]); });
    var typeRows = meta.types.filter(function (t) { return res.byType[t.id]; }).map(function (t) { return sumRow(t.label, res.byType[t.id]); });
    var actKeys = Object.keys(res.acts).sort();
    var rep = S.reportTable(res, { community: L.community, type: L.type, status: L.status });
    var notes = [];
    var ex = res.excluded;
    var exStatus = Object.keys(ex.byStatus).map(function (k) { return ex.byStatus[k] + " " + L.status(k).toLowerCase(); }).join(", ");
    if (exStatus) notes.push("Fiches non comptées selon le filtre de statut : " + exStatus + ".");
    if (ex.superseded) notes.push(ex.superseded + " fiche(s) d'origine remplacée(s) par une fiche corrective retenue : comptée(s) une seule fois.");
    notes.push("Chaque activité est comptée une seule fois. Les présences additionnent les effectifs de chaque service. Les offrandes CDF et USD sont présentées séparément.");
    var blocks = [
      { type: "kv", rows: [
        ["Période", meta.periodLabel], ["Périmètre", meta.scopeLabel], ["Fiches prises en compte", meta.statusLabel],
        ["Nombre d'activités comptées", S.count(tot.n)]
      ] },
      { type: "heading", text: "Totaux par communauté" },
      tot.n
        ? { type: "table", head: ["Communauté", "Activités", "Membres", "Visiteurs", "Offrandes CDF", "Offrandes USD"], widths: [0.3, 0.12, 0.13, 0.13, 0.16, 0.16], align: ["l", "r", "r", "r", "r", "r"], rows: commRows, total: sumRow("Total", tot) }
        : { type: "para", text: "Aucune fiche pour cette période avec ces critères." }
    ];
    if (tot.n) {
      blocks.push({ type: "heading", text: "Par type d'activité" });
      blocks.push({ type: "table", head: ["Type", "Activités", "Membres", "Visiteurs", "Offrandes CDF", "Offrandes USD"], widths: [0.3, 0.12, 0.13, 0.13, 0.16, 0.16], align: ["l", "r", "r", "r", "r", "r"], rows: typeRows });
      if (actKeys.length) {
        blocks.push({ type: "heading", text: "Actes" });
        blocks.push({ type: "table", head: ["Type d'acte", "Nombre"], widths: [0.8, 0.2], align: ["l", "r"], rows: actKeys.map(function (k) { return [k, S.count(res.acts[k])]; }) });
      }
      blocks.push({ type: "heading", text: "Fiches incluses (" + rep.rows.length + ")" });
      blocks.push({ type: "table", head: rep.head, widths: [0.15, 0.11, 0.13, 0.13, 0.075, 0.085, 0.10, 0.11, 0.11], align: ["l", "l", "l", "l", "l", "r", "r", "r", "r"], rows: rep.rows,
        total: ["Total", "", "", "", "", S.count(tot.members), S.count(tot.visitors), S.amount(tot.fc, "FC"), S.amount(tot.usd, "$")] });
    }
    blocks.push({ type: "heading", text: "Règles de calcul" });
    notes.forEach(function (n) { blocks.push({ type: "para", text: n }); });
    return {
      title: meta.title || "Rapport statistique", subtitle: meta.periodLabel + " · " + meta.scopeLabel,
      code: null, generated: stamp(), fileName: fileName(["Statistiques", meta.periodSlug, meta.communitySlug]), blocks: blocks
    };
  }
  function sumRow(label, t) {
    return [label, S.count(t.n), S.count(t.members), S.count(t.visitors), S.amount(t.fc, "FC"), S.amount(t.usd, "$")];
  }

  /* ---------- Dessin ---------- */
  var BRAND = [2 / 255, 28 / 255, 157 / 255], ACCENT = [0, 155 / 255, 254 / 255], INK = [0.12, 0.13, 0.18], MUTED = [0.4, 0.42, 0.5], ZEBRA = [0.94, 0.96, 0.99], RULE = [0.8, 0.83, 0.9];
  var PAGE_W = 595.28, PAGE_H = 841.89, M = 48, CW = PAGE_W - 2 * M, FOOT_Y = 40;

  var logoBytes = null;
  async function loadLogo() {
    if (logoBytes !== null) return logoBytes;
    try { var r = await fetch("icons/logo.png"); logoBytes = r.ok ? await r.arrayBuffer() : false; } catch (e) { logoBytes = false; }
    return logoBytes;
  }

  function wrap(text, font, size, maxW) {
    var words = clean(text).split(" "), lines = [], line = "";
    words.forEach(function (w) {
      while (font.widthOfTextAtSize(w, size) > maxW && w.length > 1) { // mot trop long : coupure brute
        var k = w.length;
        while (k > 1 && font.widthOfTextAtSize(w.slice(0, k), size) > maxW) k--;
        if (line) { lines.push(line); line = ""; }
        lines.push(w.slice(0, k)); w = w.slice(k);
      }
      var t = line ? line + " " + w : w;
      if (font.widthOfTextAtSize(t, size) > maxW && line) { lines.push(line); line = w; } else line = t;
    });
    if (line || !lines.length) lines.push(line);
    return lines;
  }

  /* Dessine le modèle. Retourne les octets du PDF. opts.logo : octets PNG (facultatif). */
  async function render(model, opts) {
    opts = opts || {};
    var PL = root.PDFLib;
    if (!PL) throw new Error("Bibliothèque PDF indisponible. Rechargez l'application.");
    var doc = await PL.PDFDocument.create();
    doc.setTitle(clean(model.title + " — " + model.subtitle));
    doc.setAuthor("District de Tala-Tala");
    doc.setSubject(clean(ORG_SUB));
    doc.setCreator("Application statistiques du district de Tala-Tala");
    doc.setCreationDate(new Date());
    var F = await doc.embedFont(PL.StandardFonts.Helvetica), FB = await doc.embedFont(PL.StandardFonts.HelveticaBold);
    var logo = null;
    if (opts.logo) { try { logo = await doc.embedPng(opts.logo); } catch (e) { logo = null; } }
    var pages = [], page, y;
    var rgb = function (c) { return PL.rgb(c[0], c[1], c[2]); };

    function newPage() {
      page = doc.addPage([PAGE_W, PAGE_H]); pages.push(page);
      var top = PAGE_H - M;
      if (logo) { var lh = 44, lw = lh * logo.width / logo.height; page.drawImage(logo, { x: M, y: top - lh, width: lw, height: lh }); }
      var tx = M + (logo ? 58 : 0);
      page.drawText(clean(ORG), { x: tx, y: top - 14, size: 12, font: FB, color: rgb(BRAND) });
      page.drawText(clean(ORG_SUB), { x: tx, y: top - 28, size: 9, font: F, color: rgb(INK) });
      page.drawText(clean(ORG_EGLISE), { x: tx, y: top - 40, size: 8, font: F, color: rgb(MUTED) });
      page.drawLine({ start: { x: M, y: top - 52 }, end: { x: PAGE_W - M, y: top - 52 }, thickness: 1.5, color: rgb(BRAND) });
      y = top - 52 - 22;
    }
    function ensure(h) { if (y - h < FOOT_Y + 24) newPage(); }
    function text(t, x, yy, size, font, color) { page.drawText(clean(t), { x: x, y: yy, size: size, font: font, color: Array.isArray(color) ? rgb(color) : (color || rgb(INK)) }); }

    newPage();
    text(model.title, M, y, 18, FB, rgb(BRAND)); y -= 22;
    var sub = wrap(model.subtitle, F, 11, CW);
    sub.forEach(function (l) { text(l, M, y, 11, F, rgb(INK)); y -= 15; });
    if (model.code) {
      ensure(30); y -= 4;
      text("N° de fiche : " + model.code, M, y, 13, FB, rgb(ACCENT)); y -= 22;
    } else y -= 8;

    model.blocks.forEach(function (b) {
      if (b.type === "heading") {
        ensure(34); y -= 10;
        text(b.text, M, y, 12, FB, rgb(BRAND)); y -= 5;
        page.drawLine({ start: { x: M, y: y }, end: { x: PAGE_W - M, y: y }, thickness: 0.6, color: rgb(RULE) });
        y -= 12;
      } else if (b.type === "para") {
        var pl = wrap(b.text, F, 9.5, CW);
        pl.forEach(function (l) { ensure(14); text(l, M, y, 9.5, F); y -= 13; });
        y -= 4;
      } else if (b.type === "kv") {
        var lw = 150, vw = CW - lw - 10;
        b.rows.forEach(function (row) {
          if (row[1] === null || row[1] === undefined || row[1] === "") return;
          var vl = wrap(String(row[1]), F, 10, vw), kl = wrap(row[0], FB, 10, lw - 4);
          var n = Math.max(vl.length, kl.length);
          ensure(n * 13 + 6);
          kl.forEach(function (l, i) { text(l, M, y - i * 13, 10, FB, rgb(MUTED)); });
          vl.forEach(function (l, i) { text(l, M + lw, y - i * 13, 10, F); });
          y -= n * 13 + 5;
        });
        y -= 4;
      } else if (b.type === "table") {
        drawTable(b);
        y -= 8;
      }
    });

    function drawTable(b) {
      var widths = b.widths.map(function (w) { return w * CW; });
      var pad = 4, size = 8.5, lh = 11;
      function rowHeight(cells, font) {
        var n = 1;
        cells.forEach(function (c, i) { n = Math.max(n, wrap(c == null ? "" : c, font, size, widths[i] - 2 * pad).length); });
        return n * lh + 2 * pad;
      }
      function drawRow(cells, opts2) {
        var hgt = rowHeight(cells, opts2.font);
        if (opts2.bg) page.drawRectangle({ x: M, y: y - hgt, width: CW, height: hgt, color: rgb(opts2.bg) });
        var x = M;
        cells.forEach(function (c, i) {
          var lines = wrap(c == null ? "" : c, opts2.font, size, widths[i] - 2 * pad);
          lines.forEach(function (l, li) {
            var tw = opts2.font.widthOfTextAtSize(l, size);
            var tx = b.align[i] === "r" ? x + widths[i] - pad - tw : x + pad;
            text(l, tx, y - pad - size - li * lh + 2, size, opts2.font, opts2.color);
          });
          x += widths[i];
        });
        y -= hgt;
      }
      function head() {
        var hh = rowHeight(b.head, FB);
        page.drawRectangle({ x: M, y: y - hh, width: CW, height: hh, color: rgb(BRAND) });
        drawRow(b.head, { font: FB, color: [1, 1, 1] });
      }
      ensure(rowHeight(b.head, FB) + 30);
      head();
      b.rows.forEach(function (row, i) {
        var hgt = rowHeight(row, F);
        if (y - hgt < FOOT_Y + 24) { newPage(); ensure(rowHeight(b.head, FB) + hgt); head(); }
        drawRow(row, { font: F, bg: i % 2 ? ZEBRA : null });
      });
      if (b.total) {
        var th = rowHeight(b.total, FB);
        ensure(th + 2);
        page.drawLine({ start: { x: M, y: y }, end: { x: PAGE_W - M, y: y }, thickness: 1, color: rgb(BRAND) });
        drawRow(b.total, { font: FB });
      }
    }

    // Pied de page et pagination (le nombre total de pages est connu à la fin).
    var total = pages.length, stampText = "Généré le " + model.generated;
    pages.forEach(function (p, i) {
      p.drawLine({ start: { x: M, y: FOOT_Y + 8 }, end: { x: PAGE_W - M, y: FOOT_Y + 8 }, thickness: 0.5, color: rgb(RULE) });
      p.drawText(clean(stampText), { x: M, y: FOOT_Y - 4, size: 8, font: F, color: rgb(MUTED) });
      var mid = model.code ? "N° " + model.code : "";
      if (mid) p.drawText(clean(mid), { x: PAGE_W / 2 - F.widthOfTextAtSize(clean(mid), 8) / 2, y: FOOT_Y - 4, size: 8, font: FB, color: rgb(MUTED) });
      var pg = "Page " + (i + 1) + " / " + total, pw = F.widthOfTextAtSize(pg, 8);
      p.drawText(pg, { x: PAGE_W - M - pw, y: FOOT_Y - 4, size: 8, font: F, color: rgb(MUTED) });
    });
    return doc.save();
  }

  var api = { clean: clean, fileName: fileName, reportModel: reportModel, summaryModel: summaryModel, render: render, loadLogo: loadLogo, wrap: wrap };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.TTPdf = api;
})(typeof window !== "undefined" ? window : globalThis);
