var S = require("../js/schedule.js"), ok = 0, ko = 0;
function eq(a, b, m) { if (JSON.stringify(a) === JSON.stringify(b)) ok++; else { ko++; console.log("ÉCHEC", m, a, b); } }
function T(s) { return new Date(s); }
// 2026-11-14 = samedi, 03:34 Kinshasa => 02:34Z. Dernier service : mercredi 11/11.
var a = S.lastSlot(T("2026-11-14T02:34:00Z"));
eq(a.date, "2026-11-11", "samedi -> mercredi"); eq(a.deadlineLabel, "mercredi à 10 h", "label mercredi");
eq(S.isLate(a, T("2026-11-14T02:34:00Z")), true, "en retard");
// dimanche 15/11 à 10 h Kinshasa (09:00Z) : service en cours => encore mercredi
eq(S.lastSlot(T("2026-11-15T09:00:00Z")).date, "2026-11-11", "pendant le culte");
// dimanche 11 h 30 Kinshasa (10:30Z) : dimanche, échéance 12 h pas dépassée
var d = S.lastSlot(T("2026-11-15T10:30:00Z"));
eq(d.date, "2026-11-15", "dimanche fini"); eq(d.deadlineLabel, "dimanche à 12 h", "label dimanche"); eq(S.isLate(d, T("2026-11-15T10:30:00Z")), false, "pas en retard");
eq(S.isLate(d, T("2026-11-15T11:01:00Z")), true, "12 h 01 Kinshasa = en retard");
// mercredi 06:45 Kinshasa (05:45Z) : mercredi fini, échéance 10 h
eq(S.lastSlot(T("2026-11-18T05:45:00Z")).date, "2026-11-18", "mercredi fini");
eq(S.lastSlot(T("2026-11-18T05:15:00Z")).date, "2026-11-15", "mercredi pas fini -> dimanche");
// minuit Kinshasa : 22:30Z veille
eq(S.kinDate(T("2026-11-14T23:30:00Z")), "2026-11-15", "date Kinshasa");
eq(S.isDivine("Service divin ordinaire"), true, "divin"); eq(S.isDivine("Réunion de jeunes"), false, "autre");
console.log(ok + " réussis, " + ko + " échecs"); process.exit(ko ? 1 : 0);
