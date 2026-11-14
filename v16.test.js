/* Tests V16 : salutation, rappel des services divins, reçu territorial. Serveur statique sur le port 8813.
   Lancer : NODE_PATH=$(npm root -g) node tests/v16.test.js */
const { chromium } = require('playwright');
const SB = 'https://kpdyowuhxekajsbnormp.supabase.co', BASE = 'http://localhost:8813/index.html';
let bad = 0; const check = (n, ok, x = '') => { if (!ok) bad++; console.log((ok ? 'OK   ' : 'ECHEC') + ' ' + n + (x ? ' [' + x + ']' : '')); };
const T = [{ id: 't1', label: 'Service divin ordinaire', active: true, requires_description: false }, { id: 't2', label: 'Réunion', active: true, requires_description: false }];
async function run(b, name, role, reports, fixed) {
  const ctx = await b.newContext({ viewport: { width: 390, height: 800 }, serviceWorkers: 'block' });
  await ctx.clock.setFixedTime(new Date(fixed));
  await ctx.addInitScript(() => localStorage.setItem('tt_session', JSON.stringify({ access_token: 'a', refresh_token: 'r', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: 'u1', email: 'x@y.z' } })));
  const calls = [];
  await ctx.route(SB + '/**', r => {
    const u = r.request().url(); let body = [];
    if (u.includes('/auth/v1/user')) body = { id: 'u1' };
    else if (u.includes('/rpc/')) { calls.push(JSON.parse(r.request().postData() || '{}')); body = {}; }
    else if (u.includes('/profiles')) body = [{ id: 'u1', display_name: name, role, community_id: role === 'district_admin' ? null : 'c1', active: true, must_change_password: false }];
    else if (u.includes('/communities')) body = [{ id: 'c1', name: 'Source de vie', active: true }];
    else if (u.includes('/activity_types')) body = T;
    else if (u.includes('/reports')) body = reports;
    r.fulfill({ status: 200, contentType: 'application/json', headers: { 'content-range': '0-0/*' }, body: JSON.stringify(body) });
  });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(BASE); await p.waitForTimeout(1200); return { ctx, p, errs, calls };
}
const rep = (id, d, t, rc, st = 'submitted') => ({ id, report_code: 'TT-2026-00000' + id.length, community_id: 'c1', activity_type_id: t, status: st, activity_date: d, members_count: 5, visitors_count: 0, offering_fc: 0, offering_usd: 0, writer_name: 'A', territorial_receipt: rc || null, report_officiants: [], religious_acts: [], created_at: d + 'T10:00:00Z', updated_at: d + 'T10:00:00Z' });
(async () => {
  const b = await chromium.launch();
  // Samedi 14/11/2026 03:34 Kinshasa = 02:34Z ; dernier culte : mercredi 11/11
  let { ctx, p, errs } = await run(b, 'Armine Lubamba', 'community_clerk', [], '2026-11-14T02:34:00Z');
  let txt = await p.locator('main, #app, body').first().innerText();
  check('salutation « Bonjour, Sr. Armine. »', txt.includes('Bonjour, Sr. Armine.') && !txt.includes('Kalala'));
  check('rappel : mercredi 11 novembre, échéance dépassée', /mercredi/i.test(txt) && txt.includes('mercredi à 10 h') && /échéance/.test(txt));
  await p.locator('button', { hasText: 'Rédiger le rapport' }).click(); await p.waitForTimeout(400);
  check('formulaire prérempli : date du culte', (await p.inputValue('#fm-date')) === '2026-11-11');
  check('formulaire prérempli : service divin ordinaire', (await p.inputValue('#fm-type')) === 't1');
  check('champ reçu territorial présent', (await p.locator('#fm-receipt').count()) === 1);
  check('aucune erreur JS (accueil)', errs.length === 0, errs.join('|')); await ctx.close();
  // Rapport déjà transmis pour le mercredi -> message de remerciement
  ({ ctx, p } = await run(b, 'Exaucé KANOWA', 'community_clerk', [rep('r1', '2026-11-11', 't1')], '2026-11-14T02:34:00Z'));
  txt = await p.locator('body').innerText();
  check('transmis : pas de rappel d\'échéance, salutation prénom', txt.includes('Le rapport est transmis') && !txt.includes('À transmettre avant') && txt.includes('Bonjour, Exaucé.'));
  await ctx.close();
  // Une réunion un jeudi ne déclenche aucun message
  ({ ctx, p } = await run(b, 'Exaucé KANOWA', 'community_clerk', [rep('r2', '2026-11-12', 't2')], '2026-11-12T20:00:00Z'));
  txt = await p.locator('body').innerText();
  check('réunion du jeudi : rappel limité au culte de mercredi', txt.includes('mercredi'));
  await ctx.close();
  // Dimanche 15/11 11 h 30 Kinshasa (10:30Z) : avant 12 h
  ({ ctx, p } = await run(b, 'Armine Lubamba', 'community_clerk', [], '2026-11-15T10:30:00Z'));
  txt = await p.locator('body').innerText();
  check('dimanche 11 h 30 : « avant dimanche à 12 h » sans retard', txt.includes('À transmettre avant dimanche à 12 h') && !/est passée/.test(txt));
  await ctx.close();
  // Administrateur : pas de rappel, nom complet
  ({ ctx, p } = await run(b, 'Administrateur du district Tala-Tala', 'district_admin', [], '2026-11-14T02:34:00Z'));
  txt = await p.locator('body').innerText();
  check('admin : pas de rappel de culte', !txt.includes('Rédiger le rapport'));
  await ctx.close();
  // Reçu en double refusé côté appareil, avant tout envoi
  ({ ctx, p, calls: _c } = await run(b, 'Armine Lubamba', 'community_clerk', [rep('r3', '2026-11-04', 't1', 'RC-77')], '2026-11-14T02:34:00Z'));
  await p.locator('button', { hasText: 'Rédiger le rapport' }).click(); await p.waitForTimeout(300);
  await p.fill('#fm-mem', '10'); await p.fill('#fm-off', 'Test'); await p.fill('#fm-receipt', ' rc-77 ');
  await p.locator('button', { hasText: 'Enregistrer le brouillon' }).click(); await p.waitForTimeout(400);
  const msg = await p.locator('.msg.bad').innerText();
  check('reçu en double : message clair', msg.includes('déjà utilisé'), msg);
  await ctx.close(); await b.close();
  console.log(bad ? bad + ' échec(s)' : 'Tous les contrôles V16 sont passés.'); process.exit(bad ? 1 : 0);
})();
