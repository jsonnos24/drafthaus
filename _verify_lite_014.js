// lite-1.014: tapping a revealed swipe action must NOT close the swipe (so its click fires, not the card's).
const { chromium } = require('playwright-core');
const path = require('path'); const http = require('http'); const fs = require('fs');
function startServer() {
  return new Promise(resolve => {
    const srv = http.createServer((req, res) => {
      const file = path.join(__dirname, decodeURIComponent(req.url.split('?')[0]));
      fs.readFile(file, (err, buf) => { if (err) { res.writeHead(404); res.end('nf'); return; }
        res.writeHead(200, { 'Content-Type': file.endsWith('.html') ? 'text/html' : 'application/octet-stream' }); res.end(buf); });
    });
    srv.listen(0, '127.0.0.1', () => resolve({ srv, port: srv.address().port }));
  });
}
const FILE = process.env.LITE_FILE || 'lite-1.014.html';
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
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    if (_songsUnsub) { _songsUnsub(); _songsUnsub = null; }
    _songs = [{ id: 'S1', title: 'Song One', updatedAt: Date.now() }]; _songsLoaded = true; renderSongList();
  });

  // Pin button is wired to togglePin (and the card to openSong) — sanity
  assert('pin button wired to togglePin', (await page.getAttribute('.act-pin', 'onclick')).includes('togglePin'));
  assert('card wired to openSong', (await page.getAttribute('.sl-card', 'onclick')).includes('openSong'));

  // Reproduce: open the swipe, then touchstart on the Pin button → must stay open
  const stayedOpen = await page.evaluate(() => {
    const card = document.querySelector('.sl-card');
    const pin = document.querySelector('.act-pin');
    card.style.transform = 'translateX(-152px)';
    _swipeOpenCard = card;
    const t = new Touch({ identifier: 1, target: pin, clientX: 350, clientY: 120 });
    pin.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, cancelable: true, touches: [t], targetTouches: [t], changedTouches: [t] }));
    return card.style.transform;
  });
  assert('touchstart on Pin keeps swipe OPEN (bug fix)', stayedOpen.includes('-152px'));

  // Sanity: touchstart on empty area still CLOSES an open swipe
  const closed = await page.evaluate(() => {
    const card = document.querySelector('.sl-card');
    card.style.transform = 'translateX(-152px)';
    _swipeOpenCard = card;
    const t = new Touch({ identifier: 2, target: document.body, clientX: 10, clientY: 400 });
    document.body.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, cancelable: true, touches: [t], targetTouches: [t], changedTouches: [t] }));
    return card.style.transform;
  });
  assert('touchstart on empty area still closes swipe', closed === '' || !closed.includes('-152px'));

  // Take rows: same protection for .take-actions
  await page.evaluate(() => {
    _openSongObj({ id: 'S1', title: 'Song One', lyricsDoc: '<div>x</div>' });
    _takes = [{ id: 't1', duration: 9, storagePath: 'p', downloadUrl: '', createdAt: { toDate: () => new Date() } }];
    _loadedTakeId = 't1'; renderTakes();
  });
  const takeStayedOpen = await page.evaluate(() => {
    const card = document.querySelector('.take-card');
    const del = document.querySelector('.take-actions button');
    card.style.transform = 'translateX(-72px)';
    _swipeOpenCard = card;
    const t = new Touch({ identifier: 3, target: del, clientX: 360, clientY: 200 });
    del.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, cancelable: true, touches: [t], targetTouches: [t], changedTouches: [t] }));
    return card.style.transform;
  });
  assert('touchstart on take Delete keeps swipe OPEN', takeStayedOpen.includes('-72px'));

  assert('no fatal JS errors', errors.length === 0);
  console.log(results.join('\n'));
  if (errors.length) console.log('\nERRORS:\n' + errors.join('\n'));
  await browser.close(); srv.close();
  process.exit(results.some(r => r.startsWith('FAIL')) ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR:', e); process.exit(2); });
