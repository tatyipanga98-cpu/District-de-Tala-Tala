// Tests des fonctions pures des graphiques signature (js/signature.js). Lancer : node tests/signature.test.js
const fs = require('fs');
const vm = require('vm');
const assert = require('assert');
const ctx = { console };
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(__dirname + '/../js/signature.js', 'utf8'), ctx);
const G = ctx.TTSig._geo;
let n = 0;
const t = (name, fn) => { fn(); n++; console.log('ok -', name); };

t('niveaux de couleur : 0, 1, 2, puis 3+ (jamais plus de 3)', () => {
  assert.deepStrictEqual([0, 1, 2, 3, 7].map(G.level), [0, 1, 2, 3, 3]);
});
t('semaine ISO : 14 novembre 2026 = semaine 46', () => {
  assert.strictEqual(G.isoWeek(new Date(Date.UTC(2026, 10, 14))), 46);
});
t('arc : chemin fermé avec arc sur la bonne grande/petite voie', () => {
  const d = G.arcPath(0, 0, 10, 0, Math.PI / 2);
  assert.ok(d.startsWith('M0,0 L10.00,0.00'));
  assert.ok(d.includes(' 0 0 1 '));
  assert.ok(d.endsWith('Z'));
  assert.ok(G.arcPath(0, 0, 10, 0, Math.PI * 1.5).includes(' 0 1 1 '));
});
t('courbe : y croît vers le bas, le max touche le haut', () => {
  const g = G.linePoints([0, 5, 10], 0, 100, 0, 100);
  assert.strictEqual(g.max, 10);
  assert.strictEqual(g.points[0].y, 100);
  assert.strictEqual(g.points[2].y, 0);
  assert.strictEqual(g.points[2].x, 100);
});
t('légende du parchemin : aucun mois renseigné', () => {
  assert.ok(G.parcheminLegend([0, 0], 2026, null, [], null).startsWith('Aucune présence'));
});
t('légende du tableau d\'honneur : position de la communauté', () => {
  const s = G.honneurLegend([{ name: 'A', value: 5 }, { name: 'B', value: 3 }], 1, 'mars 2026', '');
  assert.ok(s.startsWith('B, 2'));
  assert.ok(s.includes('2 communautés'));
  assert.ok(s.includes('8'));
});
t('couleurs de la roue : sémantique, pas décorative', () => {
  assert.strictEqual(G.segmentColor('Service divin ordinaire'), 'var(--sig-navy)');
  assert.strictEqual(G.segmentColor('Activité de jeunesse'), 'var(--sig-good)');
  assert.strictEqual(G.segmentColor('Culte funèbre'), 'var(--sig-muted)');
  assert.strictEqual(G.segmentColor('Autre'), 'var(--sig-gold)');
});
t('pourcentage arrondi, division par zéro évitée', () => {
  assert.strictEqual(G.pct(1, 4), 25);
  assert.strictEqual(G.pct(3, 0), 0);
});
console.log(n + ' tests passés.');
