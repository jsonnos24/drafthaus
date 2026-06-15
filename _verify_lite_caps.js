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

  // ── TASK 5: edit-save gate blocks an over-cap mp3 re-save ──
  const r5 = await page.evaluate(async () => {
    Object.defineProperty(auth, 'currentUser', { value: { uid: 'r1', isAnonymous: false }, configurable: true, writable: true });
    _liteUsageBytes = 119 * 1024 * 1024;          // lexical let (bare assign)
    _takes = [{ id: 't1', songId: 's1', bytes: 1 * 1024 * 1024, storagePath: 'p' }];
    _wf.takeId = 't1';                            // _wf is an object — mutate it
    window._ensureMp3Lib = async () => {};         // function decls → on window
    window._encodeMp3 = () => ({ size: 5 * 1024 * 1024 }); // 119-1+5 = 123 MB > 120 → blocked
    window.stopPlayback = () => {};
    let toasted = ''; window.toast = m => { toasted = m; };
    let putCalled = false;
    const origStorage = firebase.storage;
    firebase.storage = () => ({ ref: () => ({ put: () => { putCalled = true; return Promise.reject('should not upload'); } }) });
    const ret = await _wfReplaceAudio({ duration: 3 }, null, 'Trim');
    firebase.storage = origStorage;
    return { ret, toasted, putCalled };
  });
  const ok5 = r5.ret === false && r5.putCalled === false && /Storage full/.test(r5.toasted);
  if (!ok5) { console.error('TASK5 FAIL', JSON.stringify(r5)); process.exit(1); }
  console.log('TASK5 PASS', JSON.stringify(r5));

  // ── TASK 6: meter renders per tier ──
  const r6 = await page.evaluate(() => {
    const set = (u, used) => {
      Object.defineProperty(auth, 'currentUser', { value: u, configurable: true, writable: true });
      _liteUsageBytes = used;
      liteRenderMeter();
      const el = document.getElementById('liteMeter');
      return { disp: el.style.display, txt: el.textContent, over: el.classList.contains('over') };
    };
    return {
      admin:     set({ uid: 'FMskbD7caYYHdpnHRT4Vw41vqNf2', isAnonymous: false }, 999*1024*1024),
      regUnder:  set({ uid: 'r1', isAnonymous: false }, 30*1024*1024),
      guestOver: set({ uid: 'g1', isAnonymous: true }, 11*1024*1024),
    };
  });
  const ok6 = r6.admin.disp === 'none'
    && r6.regUnder.disp === '' && r6.regUnder.txt.indexOf('30 / 120 MB') !== -1 && !r6.regUnder.over
    && r6.guestOver.over === true && r6.guestOver.txt.indexOf('120 MB') !== -1;
  if (!ok6) { console.error('TASK6 FAIL', JSON.stringify(r6)); process.exit(1); }
  console.log('TASK6 PASS', JSON.stringify(r6));

  // ── FEEDBACK: guest UNDER cap still shows the upsell CTA; upgrade refreshes meter to 120 MB ──
  const rf = await page.evaluate(() => {
    const el = document.getElementById('liteMeter');
    // guest, well under cap → CTA still present
    Object.defineProperty(auth, 'currentUser', { value: { uid: 'g1', isAnonymous: true }, configurable: true, writable: true });
    _liteUsageBytes = 2 * 1024 * 1024;
    liteRenderMeter();
    const guestUnder = { html: el.innerHTML, hasCta: !!el.querySelector('.lite-meter-cta') };
    // simulate in-place upgrade → _guestUpgradeOK should re-render to 120 MB (no page reload)
    Object.defineProperty(auth, 'currentUser', { value: { uid: 'g1', isAnonymous: false }, configurable: true, writable: true });
    db.collection = () => ({ where: () => ({ get: async () => ({ forEach: () => {} }) }) }); // recompute → 0 takes seeded
    _guestUpgradeOK();
    return { guestUnder, afterUpgrade: el.textContent };
  });
  // recompute is async inside _guestUpgradeOK; give it a tick then re-read
  await page.waitForTimeout(300);
  const afterTxt = await page.evaluate(() => document.getElementById('liteMeter').textContent);
  const okf = rf.guestUnder.hasCta && /120 MB/.test(rf.guestUnder.html) && /120 MB/.test(afterTxt) && !/10 MB/.test(afterTxt.replace('120 MB',''));
  if (!okf) { console.error('FEEDBACK FAIL', JSON.stringify(rf), 'afterTxt=', afterTxt); process.exit(1); }
  console.log('FEEDBACK PASS', JSON.stringify(rf), 'afterTxt=', afterTxt);

  // ── TASK 7: uploadTake blocks when over cap ──
  const r7 = await page.evaluate(async () => {
    Object.defineProperty(auth, 'currentUser', { value: { uid: 'g1', isAnonymous: true }, configurable: true, writable: true }); // 10 MB cap
    _currentSong = { id: 's1' };          // lexical — bare assign
    _liteUsageBytes = 11 * 1024 * 1024;   // over
    let toasted = ''; window.toast = m => { toasted = m; };
    let added = false;
    const orig = db.collection;
    db.collection = () => ({ add: async () => { added = true; }, doc: () => ({ set: async () => {} }) });
    await uploadTake({ size: 500000 }, 'audio/webm', 5);
    db.collection = orig;
    return { added, toasted };
  });
  const ok7 = r7.added === false && /Storage full/.test(r7.toasted);
  if (!ok7) { console.error('TASK7 FAIL', JSON.stringify(r7)); process.exit(1); }
  console.log('TASK7 PASS', JSON.stringify(r7));

  await browser.close(); srv.close();
})();
