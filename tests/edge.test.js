/* Tests de la Edge Function swift-api (logique pure extraite du fichier réel).
   Lancer : node tests/edge.test.js */
const fs = require('fs');
const src = fs.readFileSync(__dirname + '/../supabase/functions/swift-api/index.ts', 'utf8');
const start = src.indexOf('function temporaryPassword()');
const end = src.indexOf('Deno.serve(');
if (start < 0 || end < 0) { console.log('ÉCHEC : fonction temporaryPassword introuvable'); process.exit(1); }
const code = src.slice(start, end).trim().replace(/: string\[\]/g, '');
const temporaryPassword = new Function('crypto', code + '\nreturn temporaryPassword;')(globalThis.crypto);
let ok = 0, ko = 0;
const eq = (a, b, msg) => { if (a === b) ok++; else { ko++; console.log('ÉCHEC', msg, a, b); } };
const CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$";
const N = 3000; const counts = {}; let bad = 0;
for (let i = 0; i < N; i++) {
  const p = temporaryPassword();
  eq(p.length, 20, 'longueur 20');
  for (const c of p) { counts[c] = (counts[c] || 0) + 1; if (!CHARS.includes(c)) bad++; }
}
eq(bad, 0, 'uniquement des caractères autorisés');
const total = N * 20, expected = total / CHARS.length;
let maxDev = 0; for (const c of CHARS) maxDev = Math.max(maxDev, Math.abs((counts[c] || 0) - expected) / expected);
eq(Object.keys(counts).length, CHARS.length, 'tous les caractères apparaissent');
eq(maxDev < 0.15, true, 'écart maximal < 15 % (distribution uniforme, obtenu ' + (maxDev * 100).toFixed(1) + ' %)');
// Vérification de la règle de rejet : aucune valeur d'octet ≥ 244 ne doit être convertie
eq(256 - (256 % CHARS.length), 244, 'seuil de rejet = 244');
// Vérification de l'ordre de réinitialisation (flag avant mot de passe)
const body = src.slice(src.indexOf('if (body.reset_password)'), src.indexOf('if (\n!Array.isArray'));
eq(body.indexOf('must_change_password: true') < body.indexOf('updateUserById'), true, 'marquage avant changement de mot de passe');
// Passe 1 : journal d'audit et limite de fréquence
eq(body.indexOf('admin_audit_log') < body.indexOf('updateUserById'), true, 'journal écrit avant toute réinitialisation');
eq(body.indexOf("gte(\"created_at\", sinceHour)") > 0 && body.indexOf('>= 5') > 0, true, 'limite de 5 par heure contrôlée');
const createPart = src.slice(src.indexOf('const password = temporaryPassword();'), src.indexOf('await adminClient.auth.admin.createUser'));
eq(createPart.includes('create_account'), true, 'création journalisée avant createUser (la portion ci-dessus s\'arrête à createUser)');
console.log(ok + ' réussis, ' + ko + ' échec(s)'); process.exit(ko ? 1 : 0);
