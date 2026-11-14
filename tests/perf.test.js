/* Chargement initial sous réseau mobile simulé (3G « Regular » : 750 kbit/s, 250 ms ; CPU 4× plus lent).
   Mesure : temps jusqu'à l'affichage de l'accueil. Objectif : < 3 s. Serveur intégré (port 8814), avec compression gzip.
   Lancer : NODE_PATH=$(npm root -g) node tests/perf.test.js */
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path'), zlib = require('zlib');
const ROOT = path.resolve(__dirname, '..');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.txt': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8' };
// Serveur qui compresse comme Netlify (gzip) : la mesure reflète les tailles réellement transférées.
const server = http.createServer((req, res) => {
  let u = decodeURIComponent(req.url.split('?')[0]); if (u.endsWith('/')) u += 'index.html';
  const fp = path.join(ROOT, u);
  if (!fp.startsWith(ROOT) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { res.writeHead(404); return res.end('404'); }
  const type = TYPES[path.extname(fp)] || 'application/octet-stream';
  const body = fs.readFileSync(fp);
  const gz = /gzip/.test(req.headers['accept-encoding'] || '');
  res.writeHead(200, Object.assign({ 'Content-Type': type, 'Cache-Control': 'no-cache' }, gz ? { 'Content-Encoding': 'gzip' } : {}));
  res.end(gz ? zlib.gzipSync(body) : body);
});
const PORT = 8814;
const SB = 'https://kpdyowuhxekajsbnormp.supabase.co', BASE = 'http://localhost:' + PORT + '/index.html';
const PROFILES = [
  { name: '3G régulière', down: 750, latency: 250 },
  { name: '2G/3G lente (Slow 3G)', down: 400, latency: 400 },
];
(async () => {
  await new Promise(r => server.listen(PORT, r));
  const b = await chromium.launch();
  let bad = 0;
  for (const pr of PROFILES) {
    const times = [];
    for (let run = 0; run < 3; run++) {
      const ctx = await b.newContext({ viewport: { width: 360, height: 740 }, serviceWorkers: 'block' });
      await ctx.addInitScript(() => { try { localStorage.setItem('tt:onb:u1', '1'); localStorage.setItem('tt_session', JSON.stringify({ access_token: 'a', refresh_token: 'r', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: 'u1', email: 'x@y.z' } })); } catch (e) {} });
      await ctx.route(SB + '/**', r => {
        const u = r.request().url(); let body = [];
        if (u.includes('/auth/v1/user')) body = { id: 'u1' };
        else if (u.includes('/profiles')) body = [{ id: 'u1', display_name: 'Armine Lubamba', role: 'community_clerk', community_id: 'c1', active: true, must_change_password: false }];
        else if (u.includes('/communities')) body = [{ id: 'c1', name: 'Source de vie', active: true }];
        else if (u.includes('/activity_types')) body = [];
        r.fulfill({ status: 200, contentType: 'application/json', headers: { 'content-range': '0-0/*' }, body: JSON.stringify(body) });
      });
      const p = await ctx.newPage();
      const errs = []; p.on('pageerror', e => errs.push(e.message));
      const cdp = await ctx.newCDPSession(p);
      await cdp.send('Network.enable');
      await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: pr.latency, downloadThroughput: pr.down * 1024 / 8, uploadThroughput: pr.down * 1024 / 8, connectionType: 'cellular3g' });
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
      const t0 = Date.now();
      await p.goto(BASE, { waitUntil: 'commit' });
      await p.waitForSelector('.hero h2', { timeout: 60000 });
      const ms = Date.now() - t0;
      times.push(ms);
      if (errs.length) { bad++; console.log('ERREURS JS', errs); }
      await ctx.close();
    }
    const median = times.slice().sort((a, b) => a - b)[1];
    const ok = median < 3000;
    if (!ok) bad++;
    console.log((ok ? 'OK   ' : 'ECHEC') + ' ' + pr.name + ' : accueil affiché en ' + median + ' ms (médiane de 3 essais ; ' + times.join(', ') + ' ms)');
  }
  await b.close(); server.close();
  console.log(bad ? bad + ' échec(s)' : 'Objectif de chargement atteint.');
  process.exit(bad ? 1 : 0);
})();
