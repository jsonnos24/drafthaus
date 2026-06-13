// lite-1.031: an open swipe row closes on any tap outside its actions (was stuck open).
const { chromium } = require('playwright-core');
const path = require('path'); const http = require('http'); const fs = require('fs');
function startServer() {
  return new Promise(resolve => {
    const srv = http.createServer((req, res) => {
      const file = path.join(__dirname, decodeURIComponent(req.url.split('?')[0]));
      fs.readFile(file, (err, buf) => { if (err) { res.writeHead(404); res.end('nf'); return; }
        const ct = file.endsWith('.html') ? 'text/html' : file.endsWith('.mp3') ? 'audio/mpeg' : 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': ct }); res.end(buf); });
    });
    srv.listen(0, '127.0.0.1', () => resolve({ srv, port: srv.address().port }));
  });
}
const FILE = process.env.LITE_FILE || 'lite-1.031.html';
function touchStartOn() {
  // dispatch a touchstart on an element by selector (runs inside the page)
  return null;
}
(async () => {
  const { srv, port } = await startServer();
  const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true,
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 800 }, hasTouch: true, isMobile: true, permissions: ['microphone'] });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  await page.goto(`http://127.0.0.1:${port}/${FILE}`, { waitUntil: 'load' });
  const results = []; const assert = (n, c) => results.push((c ? 'PASS' : 'FAIL') + ' — ' + n);

  await page.click('.auth-btn.ghost');
  await page.waitForSelector('body.signed-in', { timeout: 15000 });
  await page.evaluate(() => {
    _openSongObj({ id: 'S', title: 'X', key: 'C major', lyricsDoc: '<div>x</div>' });
    stopTakesListener();
    _takes = [{ id: 't1', songId: 'S', pinned: true, pinOrder: 1, duration: 10, storagePath: 'p', downloadUrl: '', createdAt: { toDate: () => new Date() } }];
    _loadedTakeId = 't1'; renderTakes();
  });

  // helper inside page: dispatch a touchstart on the element matched by selector
  const dispatchTouch = (sel) => page.evaluate((sel) => {
    const el = document.querySelector(sel); if (!el) return 'no-el';
    const r = el.getBoundingClientRect();
    const t = new Touch({ identifier: 1, target: el, clientX: r.left + 5, clientY: r.top + 5 });
    el.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, cancelable: true, touches: [t], targetTouches: [t], changedTouches: [t] }));
    return 'ok';
  }, sel);
  const openSwipe = () => page.evaluate(() => { const card = document.querySelector('.take-card'); card.style.transform = 'translateX(-144px)'; _swipeOpenCard = card; });
  const isOpen = () => page.evaluate(() => !!_swipeOpenCard);

  assert('take card present', await page.evaluate(() => !!document.querySelector('.take-card')));

  // 1) open swipe, then tap the CARD → closes
  await openSwipe();
  assert('swipe is open (setup)', await isOpen());
  await dispatchTouch('.take-card .meta');
  assert('tapping the card closes the open swipe', !(await isOpen()) && await page.evaluate(() => document.querySelector('.take-card').style.transform === ''));
  assert('a click is suppressed right after closing', await page.evaluate(() => _suppressNextClick === true));

  // 2) open swipe, then tap EMPTY space (panel head) → closes
  await openSwipe();
  await dispatchTouch('.tp-head');
  assert('tapping empty space closes the open swipe', !(await isOpen()));

  // 3) open swipe, then touch an ACTION button → does NOT close (so Unpin/Delete can fire)
  await openSwipe();
  await dispatchTouch('.take-actions button');
  assert('touching an action button does NOT close (action can fire)', await isOpen());
  await page.evaluate(() => _closeSwipe());

  // 4) the suppressed click is actually prevented
  const suppressed = await page.evaluate(() => {
    _suppressNextClick = true;
    let fired = false; const b = document.createElement('button'); b.onclick = () => { fired = true; }; document.body.appendChild(b);
    b.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    b.remove();
    return { fired, cleared: _suppressNextClick };
  });
  assert('suppressed click is swallowed (and flag clears)', suppressed.fired === false && suppressed.cleared === false);

  const fatal = errors.filter(e => !/permission|insufficient|FirebaseError|Failed to load resource|net::ERR|storage\//i.test(e));
  assert('no fatal JS errors', fatal.length === 0);
  console.log(results.join('\n'));
  if (fatal.length) console.log('\nFATAL:\n' + fatal.join('\n'));
  await browser.close(); srv.close();
  process.exit(results.some(r => r.startsWith('FAIL')) ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR:', e); process.exit(2); });
