const { chromium } = require('playwright-core');
const path = require('path'); const http = require('http'); const fs = require('fs');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BUILD = 'index.html';
function startServer() {
  return new Promise(resolve => {
    const srv = http.createServer((req, res) => {
      const file = path.join(__dirname, decodeURIComponent(req.url.split('?')[0]));
      fs.readFile(file, (err, buf) => { if (err) { res.writeHead(404); res.end('nf'); return; }
        const ct = file.endsWith('.html') ? 'text/html' : 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': ct }); res.end(buf); });
    });
    srv.listen(0, '127.0.0.1', () => resolve({ srv, port: srv.address().port }));
  });
}
(async () => {
  const { srv, port } = await startServer();
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
  await page.addInitScript(() => localStorage.setItem('drafthaus-eula-accepted', '1'));
  await page.goto(`http://127.0.0.1:${port}/${BUILD}`, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof liteStorageCap === 'function', { timeout: 8000 });

  const r = await page.evaluate(() => {
    const out = {};
    // Stub the real `auth` object's currentUser (compat exposes it as a getter,
    // so plain assignment is ignored — use defineProperty). Test-only; no app change.
    const mk = u => {
      Object.defineProperty(auth, 'currentUser', { value: u, configurable: true, writable: true });
      const cap = liteStorageCap();
      return cap === Infinity ? 'INF' : cap; // sentinel: ∞ can't be JSON-compared cleanly
    };
    out.signedOut  = mk(null);
    out.guest      = mk({ uid: 'g1', isAnonymous: true });
    out.registered = mk({ uid: 'r1', isAnonymous: false });
    out.admin      = mk({ uid: 'FMskbD7caYYHdpnHRT4Vw41vqNf2', isAnonymous: false });
    return out;
  });
  const ok =
    r.signedOut === 0 &&
    r.guest === 10*1024*1024 &&
    r.registered === 120*1024*1024 &&
    r.admin === 'INF'; // admin cap is Infinity (unlimited)
  console.log('TASK1', JSON.stringify(r), 'pageerrors=', errs.length, errs);
  if (!ok) { console.error('TASK1 FAIL'); process.exit(1); }
  console.log('TASK1 PASS');

  // ── TASK 2: liteUsageRecompute sums take bytes ──
  const r2 = await page.evaluate(async () => {
    Object.defineProperty(auth, 'currentUser', { value: { uid: 'r1', isAnonymous: false }, configurable: true, writable: true });
    const orig = db.collection; // db is const, but its method is assignable
    db.collection = () => ({
      where: () => ({ get: async () => ({
        forEach: cb => {
          cb({ id: 'a', data: () => ({ bytes: 5*1024*1024 }) });
          cb({ id: 'b', data: () => ({ bytes: 7*1024*1024 }) });
        }
      }) })
    });
    const total = await liteUsageRecompute();
    db.collection = orig;
    return total;
  });
  if (r2 !== 12*1024*1024) { console.error('TASK2 FAIL', r2); process.exit(1); }
  console.log('TASK2 PASS', r2);

  await browser.close(); srv.close();
})();
