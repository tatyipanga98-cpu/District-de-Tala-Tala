/* Graphiques signature (cahier « Le Bestiaire des Signes »).
   SVG et HTML écrits à la main, sans bibliothèque. Quatre graphiques :
     - parchemin : courbe des 12 mois (tracé unique, sceaux, note de marge au toucher)
     - tableau d'honneur : classement des communautés (liste typographique, détail au toucher)
     - roue : répartition par type d'activité (anneau à filets d'or, sceau central)
     - almanach : calendrier du mois (cellules colorées selon le nombre d'activités)
   Chaque graphique a une phrase de légende (renvoyée à l'appelant) et un équivalent texte pour les lecteurs d'écran.
   Animations : une seule fois, à l'apparition. Aucune si l'utilisateur demande moins de mouvement.
   Exposé via window.TTSig. Dépend de TT (ui.js) pour rien d'autre que la mise en forme. */
(function (root) {
  "use strict";

  var NS = "http://www.w3.org/2000/svg";
  var REDUCED = typeof root.matchMedia === "function" && root.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var MONTHS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
  var LETTERS = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];
  var WEEKDAYS = ["L", "M", "M", "J", "V", "S", "D"];
  var uid = 0;

  function fmt(n) { return Number(n || 0).toLocaleString("fr-FR"); }
  function pct(part, total) { return total ? Math.round(part / total * 100) : 0; }

  function el(tag, attrs, kids) {
    var e = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (attrs[k] === null || attrs[k] === undefined || attrs[k] === false) return;
      if (k === "text") e.textContent = attrs[k]; else e.setAttribute(k, attrs[k] === true ? "" : attrs[k]);
    });
    (kids || []).forEach(function (c) { if (c) e.appendChild(c); });
    return e;
  }
  function svg(tag, attrs, kids) {
    var e = document.createElementNS(NS, tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (attrs[k] === null || attrs[k] === undefined) return;
      e.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (c) { if (c) e.appendChild(c); });
    return e;
  }
  function svgText(x, y, txt, attrs) {
    var t = svg("text", Object.assign({ x: x, y: y }, attrs || {}));
    t.textContent = txt;
    return t;
  }
  function labelled(svgEl, id, title, desc) {
    var t = svg("title", { id: id + "-t" }); t.textContent = title;
    var d = svg("desc", { id: id + "-d" }); d.textContent = desc;
    svgEl.insertBefore(d, svgEl.firstChild);
    svgEl.insertBefore(t, svgEl.firstChild);
    svgEl.setAttribute("role", "img");
    svgEl.setAttribute("aria-labelledby", id + "-t " + id + "-d");
    return svgEl;
  }
  function nextId(prefix) { uid += 1; return prefix + "-" + uid; }

  /* Apparition unique : déclenche `fn` quand l'élément devient visible. Sans IntersectionObserver ou en mode
     « moins de mouvement », l'état final est affiché immédiatement. */
  function onceVisible(target, fn) {
    if (REDUCED || !("IntersectionObserver" in root)) { fn(); return; }
    var io = new IntersectionObserver(function (entries) {
      if (entries.some(function (e) { return e.isIntersecting; })) { io.disconnect(); fn(); }
    }, { threshold: 0.25 });
    io.observe(target);
  }

  /* ---------- Géométrie (fonctions pures, testées) ---------- */
  function linePoints(values, L, R, T, B) {
    var n = values.length, max = Math.max.apply(null, values.concat([1])), pts = [];
    for (var i = 0; i < n; i++) {
      pts.push({ x: n > 1 ? L + i * (R - L) / (n - 1) : L, y: B - values[i] / max * (B - T), v: values[i] });
    }
    return { points: pts, max: max };
  }
  function arcPath(cx, cy, r, a1, a2) {
    var large = (a2 - a1) > Math.PI ? 1 : 0;
    var x1 = cx + Math.cos(a1) * r, y1 = cy + Math.sin(a1) * r;
    var x2 = cx + Math.cos(a2) * r, y2 = cy + Math.sin(a2) * r;
    return "M" + cx + "," + cy + " L" + x1.toFixed(2) + "," + y1.toFixed(2) +
      " A" + r + "," + r + " 0 " + large + " 1 " + x2.toFixed(2) + "," + y2.toFixed(2) + " Z";
  }
  function isoWeek(d) { // d : Date UTC
    var t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    var day = t.getUTCDay() || 7;
    t.setUTCDate(t.getUTCDate() + 4 - day);
    var y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
    return Math.ceil(((t - y0) / 86400000 + 1) / 7);
  }
  function level(count) { return count <= 0 ? 0 : count === 1 ? 1 : count === 2 ? 2 : 3; }
  var VIZ = ["var(--viz-1)", "var(--viz-2)", "var(--viz-3)", "var(--viz-4)", "var(--viz-5)", "var(--viz-6)"];
  function segmentColor(label, i) {
    var l = (label || "").toLowerCase();
    if (/ordinaire/.test(l)) return "var(--viz-1)";
    if (/spécial|special/.test(l)) return "var(--viz-2)";
    if (/jeunesse/.test(l)) return "var(--viz-4)";
    if (/funèbre|funebre/.test(l)) return "var(--viz-5)";
    return VIZ[(i || 0) % VIZ.length];
  }

  /* Courbe lissée (Bézier cubique, Catmull-Rom) ; les poignées sont bornées au cadre du graphique. */
  function smoothPath(pts, top, bottom) {
    if (!pts.length) return "";
    var d = "M" + pts[0].x.toFixed(1) + "," + pts[0].y.toFixed(1);
    var clampY = function (y) { return Math.min(bottom, Math.max(top, y)); };
    for (var i = 0; i < pts.length - 1; i++) {
      var p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
      var c1x = p1.x + (p2.x - p0.x) / 6, c1y = clampY(p1.y + (p2.y - p0.y) / 6);
      var c2x = p2.x - (p3.x - p1.x) / 6, c2y = clampY(p2.y - (p3.y - p1.y) / 6);
      d += " C" + c1x.toFixed(1) + "," + c1y.toFixed(1) + " " + c2x.toFixed(1) + "," + c2y.toFixed(1) + " " + p2.x.toFixed(1) + "," + p2.y.toFixed(1);
    }
    return d;
  }

  /* ---------- 1. Parchemin : courbe des 12 mois ---------- */
  function parchemin(target, o) {
    var L = 32, R = 344, T = 24, B = 160;
    var values = o.values.slice(0, 12);
    while (values.length < 12) values.push(0);
    var g = linePoints(values, L, R, T, B), pts = g.points;
    var id = nextId("sig-p");
    var nonzero = values.map(function (v, i) { return { v: v, i: i }; }).filter(function (x) { return x.v > 0; });
    var peak = nonzero.length ? nonzero.reduce(function (a, b) { return b.v > a.v ? b : a; }) : null;
    var low = nonzero.length > 1 ? nonzero.reduce(function (a, b) { return b.v < a.v ? b : a; }) : null;
    var last = nonzero.length ? nonzero[nonzero.length - 1] : null;
    /* Mois mis en avant : celui choisi dans les filtres (o.focus, 0 à 11), sinon le dernier mois renseigné. */
    var shown = (typeof o.focus === "number" && o.focus >= 0 && o.focus < 12) ? { v: values[o.focus], i: o.focus } : last;

    /* Les mois sans donnée après le dernier mois renseigné (à venir) ne sont pas tracés : pas de chute fictive à zéro. */
    var drawN = last ? last.i + 1 : pts.length;
    var drawPts = pts.slice(0, drawN);
    var line = smoothPath(drawPts, T, B);
    var area = line + " L" + drawPts[drawPts.length - 1].x.toFixed(1) + "," + B + " L" + L + "," + B + " Z";

    var kids = [];
    kids.push(svg("defs", {}, [
      svg("linearGradient", { id: id + "-area", x1: 0, y1: 0, x2: 0, y2: 1 }, [
        svg("stop", { offset: "0%", "stop-color": "var(--viz-2)", "stop-opacity": 0.55 }, []),
        svg("stop", { offset: "100%", "stop-color": "var(--viz-2)", "stop-opacity": 0.02 }, [])
      ]),
      svg("linearGradient", { id: id + "-stroke", x1: 0, y1: 0, x2: 1, y2: 0 }, [
        svg("stop", { offset: "0%", "stop-color": "var(--viz-1)" }, []),
        svg("stop", { offset: "60%", "stop-color": "var(--viz-2)" }, []),
        svg("stop", { offset: "100%", "stop-color": "var(--viz-4)" }, [])
      ]),
      svg("pattern", { id: id + "-paper", width: 4, height: 4, patternUnits: "userSpaceOnUse" }, [
        svg("circle", { cx: 1, cy: 1, r: 0.4, fill: "var(--sig-rule)", opacity: 0.5 }, [])
      ])
    ]));
    [0, 0.25, 0.5, 0.75, 1].forEach(function (f) {
      var y = B - f * (B - T);
      kids.push(svg("line", { x1: L, y1: y, x2: R, y2: y, stroke: "var(--sig-grid)", "stroke-width": 1 }, []));
      if (nonzero.length) kids.push(svgText(L - 5, (y + 3).toFixed(1), fmt(Math.round(f * g.max)), { "font-size": 9, fill: "var(--sig-muted)", "text-anchor": "end" }));
    });
    var areaEl = svg("path", { d: area, fill: "url(#" + id + "-area)", class: "sig-area" }, []);
    var lineEl = svg("path", { d: line, fill: "none", stroke: "url(#" + id + "-stroke)", "stroke-width": 3.5, "stroke-linecap": "round", "stroke-linejoin": "round", class: "sig-line" }, []);
    kids.push(areaEl, lineEl);

    var seals = svg("g", { class: "sig-seals" }, []);
    var sealEls = drawPts.map(function (p, i) {
      var isPeak = peak && i === peak.i, isLow = low && i === low.i;
      var c = svg("circle", {
        cx: p.x.toFixed(1), cy: p.y.toFixed(1), r: isPeak ? 6 : 4,
        fill: isPeak ? "var(--viz-3)" : isLow ? "var(--viz-6)" : "var(--viz-1)"
      }, []);
      c.setAttribute("data-i", i);
      seals.appendChild(c);
      if (isPeak) seals.appendChild(svg("circle", { cx: p.x.toFixed(1), cy: p.y.toFixed(1), r: 9, fill: "none", stroke: "var(--sig-gold)", "stroke-width": 1, opacity: 0.3 }, []));
      return c;
    });
    kids.push(seals);
    o.labels.slice(0, 12).forEach(function (lab, i) {
      kids.push(svgText(pts[i].x.toFixed(1), 190, lab, { "font-size": 10, "font-style": "italic", fill: "var(--sig-muted)", "text-anchor": "middle" }));
    });
    if (shown && shown.v > 0) {
      kids.push(svgText((pts[shown.i].x - 6).toFixed(1), (pts[shown.i].y - 10).toFixed(1), fmt(shown.v), { "font-size": 14, "font-weight": 600, fill: "var(--sig-ink)", stroke: "var(--card, #fff)", "stroke-width": 3, "paint-order": "stroke", "stroke-linejoin": "round", "text-anchor": "end", class: "sig-value" }));
    }

    var sv = labelled(svg("svg", { viewBox: "0 0 360 200", class: "sig sig-line-chart" }, kids), id, o.title, o.desc);
    target.replaceChildren ? target.replaceChildren(sv) : (target.innerHTML = "", target.appendChild(sv));

    /* Note de marge : tap sur un point. */
    var note = el("div", { class: "sig-note", "aria-live": "polite" }, []);
    target.appendChild(note);
    function showNote(i) {
      var p = values[i], m = MONTHS[i];
      var cap = (m.charAt(0).toUpperCase() + m.slice(1)) + " " + o.year;
      var phrase = p ? fmt(p) + " présences." : "Aucune présence enregistrée.";
      var kind = peak && i === peak.i ? " is-record" : low && i === low.i && nonzero.length > 1 ? " is-low" : "";
      note.className = "sig-note" + kind;
      note.replaceChildren ? note.replaceChildren() : (note.innerHTML = "");
      note.appendChild(el("span", { class: "sig-cap", text: cap }, []));
      note.appendChild(el("strong", { class: "sig-big", text: fmt(p) }, []));
      note.appendChild(el("span", { class: "sig-phrase", text: phrase + (peak && i === peak.i ? " Le mois le plus fréquenté de l'année." : "") }, []));
    }
    svg_tap(sv, function (clientX) {
      var rect = sv.getBoundingClientRect();
      var x = (clientX - rect.left) / rect.width * 360;
      var best = 0, bd = Infinity;
      pts.forEach(function (p, i) { var d = Math.abs(p.x - x); if (d < bd) { bd = d; best = i; } });
      showNote(best);
    });

    /* Animation : tracé unique, sceaux en cascade, aire retardée. */
    onceVisible(sv, function () {
      if (REDUCED) return;
      var len = lineEl.getTotalLength();
      lineEl.style.strokeDasharray = len;
      lineEl.style.strokeDashoffset = len;
      areaEl.style.opacity = 0;
      sealEls.forEach(function (c) { c.style.opacity = 0; });
      void lineEl.getBoundingClientRect();
      lineEl.style.transition = "stroke-dashoffset 1200ms cubic-bezier(0.22, 1, 0.36, 1)";
      lineEl.style.strokeDashoffset = 0;
      areaEl.style.transition = "opacity 600ms cubic-bezier(0.22, 1, 0.36, 1) 200ms";
      areaEl.style.opacity = 1;
      sealEls.forEach(function (c, i) {
        var isPeak = peak && i === peak.i;
        c.style.transition = "opacity 200ms ease " + (isPeak ? 1200 : i * 80) + "ms" + (isPeak ? ", transform 400ms cubic-bezier(0.34, 1.56, 0.64, 1) 1200ms" : "");
        c.style.opacity = 1;
      });
    });

    return {
      legend: parcheminLegend(values, o.year, peak, nonzero, shown),
      rows: values.map(function (v, i) { return { month: MONTHS[i], value: v }; })
    };
  }
  function parcheminLegend(values, year, peak, nonzero, last) {
    if (!last) return "Aucune présence enregistrée sur l'année " + year + ".";
    if (!last.v) return "Aucune présence enregistrée en " + MONTHS[last.i] + " " + year + ".";
    var avg = nonzero.reduce(function (s, x) { return s + x.v; }, 0) / nonzero.length;
    var delta = avg ? Math.round((last.v - avg) / avg * 100) : 0;
    var dtxt = (delta >= 0 ? "+" : "") + delta + " %";
    var base = fmt(last.v) + " présences en " + MONTHS[last.i] + ". " + dtxt + " par rapport à la moyenne des mois enregistrés.";
    return peak ? base + " Le pic annuel reste " + MONTHS[peak.i] + " (" + fmt(peak.v) + ")." : base;
  }

  /* Un tap court (moins de 8 px de déplacement) : évite les faux déclenchements pendant un défilement. */
  function svg_tap(target, fn) {
    var sx = null, sy = null;
    target.addEventListener("pointerdown", function (e) { sx = e.clientX; sy = e.clientY; });
    target.addEventListener("pointerup", function (e) {
      if (sx === null) return;
      var moved = Math.hypot(e.clientX - sx, e.clientY - sy);
      sx = null;
      if (moved < 8) fn(e.clientX, e.clientY);
    });
  }

  /* ---------- 2. Tableau d'honneur : classement des communautés ---------- */
  function honneur(target, o) {
    var rows = o.rows.slice().sort(function (a, b) { return b.value - a.value; });
    var max = Math.max.apply(null, rows.map(function (r) { return r.value; }).concat([1]));
    var id = nextId("sig-h");
    var cap = el("caption", { class: "sr-only", text: o.caption }, []);
    var tbody = el("tbody", {}, []);
    var fills = [];
    var btns = [];
    var details = [];
    rows.forEach(function (r, i) {
      var btn = el("button", { type: "button", class: "sig-rank-btn", "aria-expanded": "false" }, [
        el("span", { class: "sig-rank-num", text: String(i + 1) }, []),
        i < 3 ? el("span", { class: "sig-fleuron", "aria-hidden": "true", text: "✠" }, []) : null,
        el("span", { class: "sig-name", text: r.name }, [])
      ]);
      var fill = el("div", { class: "sig-bar-fill" }, []);
      fill.style.transform = REDUCED ? "scaleX(" + (r.value / max) + ")" : "scaleX(0)";
      fill.setAttribute("data-v", (r.value / max).toFixed(3));
      fill.style.background = i === 0 ? "linear-gradient(90deg,var(--viz-3),#ffd35c)" : "linear-gradient(90deg," + VIZ[i % 6] + ",var(--viz-2))";
      fills.push(fill);
      var val = el("span", { class: "sig-val", text: fmt(r.value) }, []);
      var tr = el("tr", { class: "sig-rank-row" + (r.isMine ? " is-mine" : "") }, [
        el("th", { scope: "row" }, [btn]),
        el("td", {}, [el("div", { class: "sig-bar" }, [fill]), val])
      ]);
      var items = (r.items || []).map(function (t) { return el("li", { text: t }, []); });
      var det = el("tr", { class: "sig-detail", hidden: true }, [
        el("td", { colspan: 2 }, [items.length ? el("ul", { class: "sig-items" }, items) : el("p", { class: "muted", text: "Aucune activité sur la période." }, [])])
      ]);
      details.push(det);
      btns.push(btn);
      btn.addEventListener("click", function () {
        var open = btn.getAttribute("aria-expanded") === "true";
        btns.forEach(function (b) { b.setAttribute("aria-expanded", "false"); });
        details.forEach(function (d) { d.hidden = true; });
        if (!open) { det.hidden = false; btn.setAttribute("aria-expanded", "true"); }
      });
      tbody.appendChild(tr);
      tbody.appendChild(det);
    });
    var table = el("table", { class: "sig-rank", id: id }, [cap, tbody]);
    target.replaceChildren ? target.replaceChildren(table) : (target.innerHTML = "", target.appendChild(table));

    onceVisible(table, function () {
      if (REDUCED) return;
      fills.forEach(function (f, i) {
        f.style.transition = "transform 600ms cubic-bezier(0.22, 1, 0.36, 1) " + (i * 60) + "ms";
        f.style.transform = "scaleX(" + f.getAttribute("data-v") + ")";
      });
    });

    var mine = rows.findIndex(function (r) { return r.isMine; });
    return {
      legend: honneurLegend(rows, mine, o.periodLabel, o.scopeLabel),
      rows: rows
    };
  }
  function honneurLegend(rows, mine, periodLabel, scopeLabel) {
    var n = rows.length;
    var total = rows.reduce(function (s, r) { return s + r.value; }, 0);
    if (!n) return "Aucune activité à classer sur " + periodLabel + ".";
    if (n === 1) return rows[0].name + " : " + fmt(total) + " présences, " + periodLabel + ". Aucun classement : une seule communauté sur cette vue.";
    if (mine >= 0) {
      return rows[mine].name + ", " + (mine + 1) + (mine === 0 ? "re" : "ᵉ") + " des " + n + " communauté" + (n > 1 ? "s" : "") +
        " pour les présences, " + periodLabel + ". Le total du district est de " + fmt(total) + ".";
    }
    return rows[0].name + " est en tête pour les présences, " + periodLabel + ". Total : " + fmt(total) + ".";
  }

  /* ---------- 3. Roue : répartition par type d'activité ---------- */
  function roue(target, o) {
    var cx = 180, cy = 120, R = 80;
    var segs = o.segments.filter(function (s) { return s.value > 0; });
    var total = segs.reduce(function (s, x) { return s + x.value; }, 0);
    var id = nextId("sig-r");
    var kids = [];
    var a = -Math.PI / 2, wedges = [], legendItems = [];
    if (!total) {
      target.replaceChildren ? target.replaceChildren(el("p", { class: "muted", text: "Aucune activité sur la période." }, [])) : (target.innerHTML = "");
      return { legend: "Aucune activité sur la période.", rows: [] };
    }
    var group = svg("g", { transform: "translate(" + cx + "," + cy + ")" }, []);
    segs.forEach(function (s, i) {
      var frac = s.value / total, a2 = a + frac * Math.PI * 2, am = (a + a2) / 2;
      var p = svg("path", {
        d: arcPath(0, 0, R, a, a2), fill: segmentColor(s.label, i), stroke: "var(--sig-paper)", "stroke-width": 2, class: "sig-seg"
      }, []);
      p.setAttribute("data-i", i);
      p.setAttribute("data-mid", am.toFixed(4));
      var ariaTxt = s.label + " : " + pct(s.value, total) + " %, " + fmt(s.value);
      p.setAttribute("aria-label", ariaTxt);
      group.appendChild(p);
      wedges.push(p);
      if (frac > 0.15) {
        var lab = svgText((Math.cos(am) * 52).toFixed(1), (Math.sin(am) * 52).toFixed(1), s.label.split(" ").slice(-1)[0].toUpperCase(), { "font-size": 9, "text-anchor": "middle", fill: "var(--sig-paper)", "font-weight": 600 });
        group.appendChild(lab);
      }
      legendItems.push({ label: s.label, value: s.value, pct: pct(s.value, total) });
      a = a2;
    });
    var seal = svg("g", { class: "sig-seal" }, [
      svg("circle", { cx: 0, cy: 0, r: 32, fill: "var(--viz-7)" }, []),
      svgText(0, -2, fmt(total), { "text-anchor": "middle", "font-size": 22, "font-weight": 600, fill: "var(--sig-paper)" }),
      svgText(0, 14, "ACTIVITÉS", { "text-anchor": "middle", "font-size": 8, fill: "var(--sig-paper)", opacity: 0.8 })
    ]);
    group.appendChild(seal);
    kids.push(group);
    var sv = labelled(svg("svg", { viewBox: "0 0 360 240", class: "sig sig-wheel" }, kids), id, o.title, o.desc);
    var note = el("div", { class: "sig-note", "aria-live": "polite" }, []);
    var wrap = el("div", {}, [sv, note]);
    target.replaceChildren ? target.replaceChildren(wrap) : (target.innerHTML = "", target.appendChild(wrap));

    /* Tap sur un segment : il se soulève de 4 px et sa légende apparaît. */
    wedges.forEach(function (p, i) {
      p.addEventListener("click", function () {
        wedges.forEach(function (q) { q.style.transform = ""; });
        p.style.transform = "translate(" + (Math.cos(Number(p.getAttribute("data-mid"))) * 4).toFixed(2) + "px," + (Math.sin(Number(p.getAttribute("data-mid"))) * 4).toFixed(2) + "px)";
        var it = legendItems[i];
        note.className = "sig-note";
        note.replaceChildren ? note.replaceChildren() : (note.innerHTML = "");
        note.appendChild(el("span", { class: "sig-cap", text: it.label }, []));
        note.appendChild(el("strong", { class: "sig-big", text: fmt(it.value) + " · " + it.pct + " %" }, []));
      });
    });

    onceVisible(sv, function () {
      if (REDUCED) return;
      wedges.forEach(function (p, i) {
        p.style.opacity = 0;
        p.style.transition = "opacity 300ms ease " + (i * 100) + "ms";
        requestAnimationFrame(function () { p.style.opacity = 1; });
      });
      seal.style.opacity = 0;
      seal.style.transition = "opacity 300ms ease 500ms";
      requestAnimationFrame(function () { seal.style.opacity = 1; });
    });

    var top = legendItems.slice().sort(function (x, y) { return y.value - x.value; })[0];
    var others = 100 - (top ? top.pct : 0);
    return {
      legend: top ? top.pct + " % des activités sont « " + top.label + " ». Les autres types représentent " + others + " %." : "",
      rows: legendItems
    };
  }

  /* ---------- 4. Almanach : calendrier du mois ---------- */
  function almanach(target, o) {
    var year = o.year, month = o.month; // mois 1..12
    var first = new Date(Date.UTC(year, month - 1, 1));
    var days = new Date(Date.UTC(year, month, 0)).getUTCDate();
    var startDow = (first.getUTCDay() + 6) % 7; // lundi = 0
    var counts = o.counts || {};
    var id = nextId("sig-a");
    var head = el("tr", {}, [el("th", { scope: "col", class: "sig-cal-wk", "aria-label": "Semaine" }, [])].concat(
      WEEKDAYS.map(function (d) { return el("th", { scope: "col", class: "sig-cal-dow", text: d }, []); })));
    var body = el("tbody", {}, []);
    var day = 1 - startDow, sundaysEmpty = 0, sundays = 0, bestDay = null;
    var dayKey = function (dn) { return year + "-" + String(month).padStart(2, "0") + "-" + String(dn).padStart(2, "0"); };
    for (var k0 = 1; k0 <= days; k0++) { var c0 = counts[dayKey(k0)] || 0; if (c0 > 0 && (!bestDay || c0 > bestDay.c)) bestDay = { dn: k0, c: c0 }; }
    var dayNames = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];
    var weeks = Math.ceil((startDow + days) / 7);
    for (var w = 0; w < weeks; w++) {
      var mondayDate = new Date(Date.UTC(year, month - 1, day + w * 7));
      var cells = [el("th", { scope: "row", class: "sig-cal-wk", text: String(isoWeek(mondayDate)) }, [])];
      for (var d = 0; d < 7; d++) {
        var dn = day + w * 7 + d;
        if (dn < 1 || dn > days) { cells.push(el("td", { class: "sig-cal-out" }, [])); continue; }
        var key = dayKey(dn);
        var c = counts[key] || 0;
        var isSun = d === 6;
        if (isSun) { sundays++; if (!c) sundaysEmpty++; }
        var txt = dn + " " + MONTHS[month - 1] + " : " + c + " activité" + (c > 1 ? "s" : "");
        var best = bestDay && bestDay.dn === dn && c ? " sig-cal-best" : "";
        cells.push(el("td", { class: "sig-cal-cell sig-lv" + level(c) + best, "data-day": key, "data-c": String(c), "data-dn": String(dn) }, [
          el("span", { class: "sig-cal-d", "aria-hidden": "true", text: String(dn) }, []),
          el("span", { class: "sr-only", text: txt }, [])
        ]));
      }
      body.appendChild(el("tr", {}, cells));
    }
    var cap = el("caption", { class: "sr-only", text: "Calendrier des activités, " + MONTHS[month - 1] + " " + year }, []);
    var table = el("table", { class: "sig-cal", id: id }, [cap, el("thead", {}, [head]), body]);
    var key = el("div", { class: "sig-cal-key", "aria-hidden": "true" }, [
      el("span", { class: "sig-cal-kl", text: "0" }, [el("i", { class: "sig-cal-sw sig-lv0" }, [])]),
      el("span", { class: "sig-cal-kl", text: "1" }, [el("i", { class: "sig-cal-sw sig-lv1" }, [])]),
      el("span", { class: "sig-cal-kl", text: "2" }, [el("i", { class: "sig-cal-sw sig-lv2" }, [])]),
      el("span", { class: "sig-cal-kl", text: "3+" }, [el("i", { class: "sig-cal-sw sig-lv3" }, [])])
    ]);
    var note = el("div", { class: "sig-note", "aria-live": "polite" }, []);
    target.replaceChildren ? target.replaceChildren(table, key, note) : (target.innerHTML = "", target.appendChild(table), target.appendChild(key), target.appendChild(note));
    /* Tap sur une cellule : note de marge (date, nombre, phrase). */
    table.addEventListener("click", function (ev) {
      var td = ev.target && ev.target.closest ? ev.target.closest("td[data-day]") : null;
      if (!td) return;
      var c = Number(td.getAttribute("data-c")), dn = Number(td.getAttribute("data-dn"));
      var wd = dayNames[new Date(Date.UTC(year, month - 1, dn)).getUTCDay()];
      note.className = "sig-note" + (bestDay && bestDay.dn === dn && c ? " is-record" : "");
      note.replaceChildren ? note.replaceChildren() : (note.innerHTML = "");
      note.appendChild(el("span", { class: "sig-cap", text: wd.charAt(0).toUpperCase() + wd.slice(1) + " " + dn + " " + MONTHS[month - 1] }, []));
      note.appendChild(el("strong", { class: "sig-big", text: String(c) }, []));
      note.appendChild(el("span", { class: "sig-phrase", text: c ? (c > 1 ? c + " activités enregistrées." : "Une activité enregistrée.") : "Aucune activité enregistrée ce jour-là." }, []));
    });
    var mName = MONTHS[month - 1];
    var legend = mName.charAt(0).toUpperCase() + mName.slice(1) + " " + year + ". " +
      (sundays - sundaysEmpty) + " dimanche" + (sundays - sundaysEmpty > 1 ? "s" : "") + " sur " + sundays + " avec activité." +
      (bestDay ? " Le " + bestDay.dn + " " + mName + " concentre le plus d'activités du mois (" + bestDay.c + ")." : " Aucune activité enregistrée ce mois-ci.");
    return { legend: legend, rows: [] };
  }

  root.TTSig = {
    parchemin: parchemin,
    honneur: honneur,
    roue: roue,
    almanach: almanach,
    _geo: { linePoints: linePoints, arcPath: arcPath, isoWeek: isoWeek, level: level, segmentColor: segmentColor, parcheminLegend: parcheminLegend, honneurLegend: honneurLegend, pct: pct, fmt: fmt }
  };
})(typeof window !== "undefined" ? window : globalThis);
