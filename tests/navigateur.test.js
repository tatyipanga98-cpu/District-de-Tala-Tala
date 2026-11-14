/* Tests navigateur de la version 13 (serveur statique sur le port 8813). Lancer : NODE_PATH=$(npm root -g) node t13.js */
const { chromium } = require('playwright');
const fs = require('fs');
const SB = 'https://kpdyowuhxekajsbnormp.supabase.co';
const BASE = 'http://localhost:8813/index.html';
const SHOTS = '/tmp/claude-0/shots13';
fs.mkdirSync(SHOTS, { recursive: true });
const out = []; let bad = 0;
const check = (name, ok, extra = '') => { if (!ok) bad++; out.push((ok ? 'OK   ' : 'ECHEC') + ' ' + name + (extra ? '  [' + extra + ']' : '')); };

function mkReports(n) {
  const list = [];
  for (let i = 0; i < n; i++) list.push({ id: 'x' + i, report_code: 'TT-2026-' + String(500 + i).padStart(6, '0'), community_id: 'c1', activity_type_id: 't1', status: 'validated', activity_date: '2026-10-' + String(1 + (i % 20)).padStart(2, '0'), members_count: 10 + i, visitors_count: 1, offering_fc: 1000 + i, offering_usd: 5, writer_name: 'Armine Lubamba', report_officiants: [{ name_as_reported: 'P. Test', role_in_activity: 'principal', position_order: 1 }], religious_acts: [], updated_at: '2026-10-20T10:00:00Z', created_at: '2026-10-20T10:00:00Z' });
  return list;
}
function state(role, reports, extraProfiles) {
  return {
    rpcs: [], reports: reports, fnCalls: [], user: { id: 'u1', email: 'x@y.z' },
    profile: { id: 'u1', display_name: 'Test ' + role, role, community_id: role.startsWith('community') ? 'c1' : null, active: true, must_change_password: false },
    profiles: extraProfiles || []
  };
}
function mkRoute(st) {
  return async (route) => {
    const req = route.request(), url = req.url();
    const json = (b, s = 200) => route.fulfill({ status: s, contentType: 'application/json', headers: { 'content-range': '0-0/*' }, body: JSON.stringify(b) });
    if (url.includes('/auth/v1/user')) return json(st.user);
    if (url.includes('/functions/v1/swift-api')) {
      const body = JSON.parse(req.postData() || '{}'); st.fnCalls.push(body);
      return json({ message: 'ok', user_id: body.reset_password && body.reset_password.user_id, temporary_password: 'Tmp-Pass-2026-XYZ' });
    }
    if (url.includes('/rest/v1/rpc/')) return json({});
    if (url.includes('/rest/v1/profiles')) return json(url.includes('id=eq.') ? [st.profile] : [st.profile].concat(st.profiles));
    if (url.includes('/rest/v1/communities')) return json([{ id: 'c1', name: 'Source de vie', active: true }]);
    if (url.includes('/rest/v1/activity_types')) return json([{ id: 't1', label: 'Service divin ordinaire', active: true, requires_description: false }]);
    if (url.includes('/rest/v1/reports')) return json(st.reports);
    return json([]);
  };
}
async function open(b, st, opts = {}) {
  const ctx = await b.newContext({ viewport: opts.viewport || { width: 360, height: 760 }, colorScheme: opts.scheme || 'light', serviceWorkers: 'block', acceptDownloads: true });
  await ctx.addInitScript(() => { try { localStorage.setItem('tt:onb:u1', '1'); } catch (e) {} });
  await ctx.addInitScript(() => { localStorage.setItem('tt_session', JSON.stringify({ access_token: 'a', refresh_token: 'r', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: 'u1', email: 'x@y.z' } })); });
  await ctx.clock.setFixedTime(new Date('2026-10-20T12:00:00Z')); // les données de test sont d'octobre 2026
  await ctx.route(SB + '/**', mkRoute(st));
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto(BASE); await p.waitForTimeout(1100);
  return { ctx, p, errs };
}
const navTo = async (p, label) => { await p.evaluate((l) => { const b = [...document.querySelectorAll('nav.bottom button')].find(x => x.textContent.includes(l)); b && b.click(); }, label); await p.waitForTimeout(400); };

(async () => {
  const b = await chromium.launch();

  // 1. Politique de sécurité : CSP présente, aucune violation
  { const st = state('commission', mkReports(3));
    const { ctx, p, errs } = await open(b, st);
    const csp = await p.getAttribute('meta[http-equiv="Content-Security-Policy"]', 'content');
    check('CSP présente et restreint les scripts à l\'origine', !!csp && csp.includes("script-src 'self'") && csp.includes('connect-src \'self\' https://kpdyowuhxekajsbnormp.supabase.co'));
    await navTo(p, 'Stats');
    check('écran statistiques : bouton PDF de synthèse', (await p.locator('button', { hasText: 'Télécharger la synthèse (PDF)' }).count()) === 1);
    check('écran statistiques : pas d\'impression navigateur', (await p.locator('button', { hasText: 'Imprimer' }).count()) === 0);
    // 2. Téléchargement du PDF de synthèse (statuts : toutes les fiches)
    await p.selectOption('#st-status', 'all');
    await p.waitForTimeout(200);
    const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 15000 }), p.locator('button', { hasText: 'Télécharger la synthèse (PDF)' }).click()]);
    const fname = dl.suggestedFilename();
    const file = '/tmp/claude-0/' + fname; await dl.saveAs(file);
    const head = fs.readFileSync(file).slice(0, 5).toString();
    check('synthèse PDF : téléchargée avec un nom explicite', /^Statistiques_Octobre-2026_Toutes-les-communautes\.pdf$/.test(fname) || /^Statistiques_.*\.pdf$/.test(fname), fname);
    check('synthèse PDF : fichier PDF valide', head === '%PDF-', head);
    // 3. Exports CSV avec identifiants
    const [dl2] = await Promise.all([p.waitForEvent('download', { timeout: 15000 }), p.locator('button', { hasText: 'Exporter les fiches (CSV)' }).click()]);
    const csvPath = '/tmp/claude-0/' + dl2.suggestedFilename(); await dl2.saveAs(csvPath);
    const csv = fs.readFileSync(csvPath, 'utf8');
    check('export fiches CSV : identifiants TT-2026 présents', csv.includes('TT-2026-000500') && csv.includes('N° de fiche'), dl2.suggestedFilename());
    await p.screenshot({ path: SHOTS + '/stats-360.png', fullPage: true });
    check('aucune erreur JavaScript ni violation CSP (statistiques)', errs.length === 0, errs.join(' | ').slice(0, 300));
    await ctx.close();
  }

  // 4. Fiche : PDF individuel et identifiant
  { const st = state('commission', mkReports(3));
    const { ctx, p, errs } = await open(b, st);
    await navTo(p, 'Activités');
    await p.locator('.row-item').first().click(); await p.waitForTimeout(500);
    const txt = await p.textContent('body');
    check('fiche : identifiant affiché', txt.includes('N° de fiche') && txt.includes('TT-2026-000502'));
    check('fiche : intervenants sous « Intervenants à l\'autel de grâce »', txt.includes("Intervenants à l'autel de grâce") && txt.includes('P. Test'));
    const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 15000 }), p.locator('button', { hasText: 'Télécharger la fiche (PDF)' }).click()]);
    check('fiche PDF : nom explicite avec identifiant', dl.suggestedFilename().startsWith('Fiche_TT-2026-000502_'), dl.suggestedFilename());
    await dl.saveAs('/tmp/claude-0/fiche-test.pdf');
    check('fiche PDF : fichier valide', fs.readFileSync('/tmp/claude-0/fiche-test.pdf').slice(0, 5).toString() === '%PDF-');
    check('aucune erreur JavaScript (fiche)', errs.length === 0, errs.join(' | ').slice(0, 300));
    await ctx.close();
  }

  // 5. Recherche et pagination
  { const st = state('commission', mkReports(120));
    const { ctx, p, errs } = await open(b, st);
    await navTo(p, 'Activités');
    check('pagination : 50 fiches affichées au départ', (await p.locator('.row-item').count()) === 50);
    await p.locator('button', { hasText: 'Afficher 50 de plus' }).click(); await p.waitForTimeout(300);
    check('pagination : 100 fiches après « Afficher 50 de plus »', (await p.locator('.row-item').count()) === 100);
    await p.fill('#f-q', 'TT-2026-000519'); await p.press('#f-q', 'Enter'); await p.waitForTimeout(300);
    check('recherche par identifiant : une seule fiche', (await p.locator('.row-item').count()) === 1);
    await p.fill('#f-q', 'zzz-inexistant'); await p.press('#f-q', 'Enter'); await p.waitForTimeout(300);
    check('recherche sans résultat : message clair', (await p.textContent('body')).includes('Aucune activité'));
    check('aucune erreur JavaScript (recherche)', errs.length === 0, errs.join(' | ').slice(0, 300));
    await ctx.close();
  }

  // 6. Déconnexion : copie locale de l'utilisateur effacée
  { const st = state('community_clerk', mkReports(2));
    const { ctx, p, errs } = await open(b, st);
    await p.waitForTimeout(300);
    await p.locator('button', { hasText: 'Quitter' }).first().click(); await p.waitForTimeout(300);
    await p.locator('.overlay button', { hasText: 'Quitter' }).click(); await p.waitForTimeout(800);
    const session = await p.evaluate(() => localStorage.getItem('tt_session'));
    check('déconnexion : session supprimée de l\'appareil', session === null);
    check('déconnexion : écran de connexion affiché', (await p.locator('#login-email').count()) === 1);
    const cached = await p.evaluate(() => new Promise((res) => {
      const r = indexedDB.open('tt_local', 1);
      r.onsuccess = () => { const db = r.result; const t = db.transaction('kv', 'readonly'); const g = t.objectStore('kv').get('reports:u1'); g.onsuccess = () => res(g.result === undefined ? 'absent' : 'present'); g.onerror = () => res('erreur'); };
      r.onerror = () => res('erreur');
    }));
    check('déconnexion : cache des fiches effacé', cached === 'absent', cached);
    check('aucune erreur JavaScript (déconnexion)', errs.length === 0, errs.join(' | ').slice(0, 300));
    await ctx.close();
  }

  // 7. Administrateur : réinitialisation de mot de passe et sauvegarde
  { const others = [{ id: 'u2', display_name: 'Armine Lubamba', role: 'community_clerk', community_id: 'c1', active: true }];
    const st = state('district_admin', [], others);
    const { ctx, p, errs } = await open(b, st, { viewport: { width: 390, height: 844 } });
    await navTo(p, 'Comptes');
    const btns = await p.locator('button', { hasText: 'Nouveau mot de passe' }).count();
    check('comptes : bouton réinitialisation pour les autres comptes seulement', btns === 1, 'n=' + btns);
    check('comptes : bouton sauvegarde présent', (await p.locator('button', { hasText: 'Télécharger une sauvegarde' }).count()) === 1);
    await p.locator('button', { hasText: 'Nouveau mot de passe' }).click(); await p.waitForTimeout(300);
    await p.locator('.overlay button', { hasText: 'Réinitialiser' }).click(); await p.waitForTimeout(700);
    const shown = await p.textContent('body');
    check('réinitialisation : mot de passe provisoire affiché une fois', shown.includes('Tmp-Pass-2026-XYZ'));
    check('réinitialisation : appel serveur avec l\'identifiant de la personne', st.fnCalls.length === 1 && st.fnCalls[0].reset_password.user_id === 'u2');
    const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 15000 }), p.locator('button', { hasText: 'Télécharger une sauvegarde' }).click()]);
    check('sauvegarde : fichier JSON téléchargé', /^sauvegarde-tala-tala-.*\.json$/.test(dl.suggestedFilename()), dl.suggestedFilename());
    await p.screenshot({ path: SHOTS + '/comptes-390.png', fullPage: true });
    check('aucune erreur JavaScript (comptes)', errs.length === 0, errs.join(' | ').slice(0, 300));
    await ctx.close();
  }

  // 8. Mise en page : écrans principaux à plusieurs largeurs (clair et sombre)
  for (const vp of [{ width: 360, height: 760 }, { width: 768, height: 1000 }, { width: 1280, height: 800 }]) {
    for (const scheme of ['light', 'dark']) {
      const st = state('commission', mkReports(5));
      const { ctx, p, errs } = await open(b, st, { viewport: vp, scheme });
      const overflow = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
      check('pas de défilement horizontal ' + vp.width + 'px ' + scheme, !overflow);
      await p.screenshot({ path: SHOTS + '/home-' + vp.width + '-' + scheme + '.png' });
      check('aucune erreur JavaScript ' + vp.width + 'px ' + scheme, errs.length === 0);
      await ctx.close();
    }
  }

  await b.close();
  console.log(out.join('\n'));
  console.log('\n' + (bad ? bad + ' échec(s)' : 'Tous les contrôles navigateur sont passés.'));
})().catch(e => { console.error('ERREUR TEST', e); process.exit(1); });
