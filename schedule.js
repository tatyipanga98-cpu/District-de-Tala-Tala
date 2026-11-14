/* Règle des services divins : mercredi 6 h 00 – 6 h 30 (rapport avant 10 h), dimanche 9 h 30 – 11 h 00 (rapport avant 12 h).
   Heure de Kinshasa = UTC+1, sans changement d'heure. Les autres activités n'ont pas d'échéance. */
(function (root) {
  var SLOTS = [
    { dow: 3, day: "mercredi", start: "06:00", end: "06:30", deadline: "10:00", deadlineLabel: "10 h" },
    { dow: 0, day: "dimanche", start: "09:30", end: "11:00", deadline: "12:00", deadlineLabel: "12 h" }
  ];
  var OFFSET = 60; // minutes

  function kin(now) { return new Date((now || new Date()).getTime() + OFFSET * 60000); } // champs UTC = heure de Kinshasa
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function iso(d) { return d.getUTCFullYear() + "-" + pad(d.getUTCMonth() + 1) + "-" + pad(d.getUTCDate()); }
  function mins(hhmm) { var p = hhmm.split(":"); return +p[0] * 60 + +p[1]; }
  function isDivine(label) { return /^\s*service divin/i.test(label || ""); }

  /* Dernier service divin dont l'heure de fin est passée. */
  function lastSlot(now) {
    var k = kin(now), best = null;
    for (var back = 0; back < 8 && !best; back++) {
      var d = new Date(Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate() - back));
      var found = SLOTS.filter(function (s) { return s.dow === d.getUTCDay(); })[0];
      if (!found) continue;
      var endMin = mins(found.end), nowMin = k.getUTCHours() * 60 + k.getUTCMinutes();
      if (back === 0 && nowMin < endMin) continue; // pas encore terminé
      best = { slot: found, date: iso(d), dow: found.dow, day: found.day, deadlineLabel: found.day + " à " + found.deadlineLabel, deadlineISO: iso(d) + "T" + found.deadline + ":00+01:00" };
    }
    return best;
  }
  function isLate(info, now) { return !!info && (now || new Date()).getTime() > new Date(info.deadlineISO).getTime(); }
  /* Rapport pertinent pour ce créneau : service divin à cette date. */
  function matches(report, info, typeLabelOf) {
    return !!info && report.activity_date === info.date && isDivine(typeLabelOf(report));
  }
  root.TTSchedule = { SLOTS: SLOTS, lastSlot: lastSlot, isLate: isLate, isDivine: isDivine, matches: matches, kinDate: function (n) { return iso(kin(n)); } };
  if (typeof module !== "undefined") module.exports = root.TTSchedule;
})(typeof window !== "undefined" ? window : globalThis);
