// lite-1.013: desktop inline delete (song + take) visible on desktop, hidden on touch, wired correctly.
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
const URL = (port) => `http://127.0.0.1:${port}/lite-1.013.html`;

async function setup(browser, opts) {
  const ctx = await browser.newContext(Object.assign({ permissions: ['microphone'] }, opts));
  const page = await ctx.newPage();
  return { ctx, page };
}
async function seed(page) {
  await page.click('.auth-btn.ghost');
  await page.waitForSelector('body.signed-in', { timeout: 15000 });
  await page.waitForTimeout(400); // let the (empty) guest snapshot fire first
  await page.evaluate(() => {
    if (_songsUnsub) { _songsUnsub(); _songsUnsub = null; } // stop live listener clobbering injected data
    _songs = [{ id: 'S1', title: 'Song One', updatedAt: Date.now() }]; _songsLoaded = true; renderSongList();
  });
}
const visible = (page, sel) => page.evaluate((s) => { const el = document.querySelector(s); return !!el && getComputedStyle(el).display !== 'none' && el.getClientRects().length > 0; }, sel);

(async () => {
  const { srv, port } = await startServer();
  const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true,
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const results = []; const assert = (n, c) => results.push((c ? 'PASS' : 'FAIL') + ' — ' + n);
  const errors = [];

  // ── Desktop context (mouse / hover:fine) ──
  {
    const { page } = await setup(browser, { viewport: { width: 1100, height: 800 } });
    page.on('pageerror', e => errors.push('PAGEERROR(desktop): ' + e.message));
    await page.goto(URL(port), { waitUntil: 'load' });
    await seed(page);

    assert('desktop: song delete button present', (await page.$$('.sl-del-desktop')).length === 1);
    assert('desktop: song delete VISIBLE', await visible(page, '.sl-del-desktop'));
    assert('desktop: song delete wired to deleteSong', (await page.getAttribute('.sl-del-desktop', 'onclick')).includes('deleteSong'));

    // clicking trash must NOT open the song (stopPropagation), and with confirm=false must not navigate
    await page.evaluate(() => { window.confirm = () => false; });
    await page.click('.sl-del-desktop');
    await page.waitForTimeout(100);
    assert('desktop: trash click does not open song', await page.evaluate(() => getComputedStyle(document.getElementById('screen-songlist')).display !== 'none' && getComputedStyle(document.getElementById('screen-song')).display === 'none'));

    // takes list delete
    await page.evaluate(() => {
      _openSongObj({ id: 'S1', title: 'Song One', lyricsDoc: '<div>x</div>' });
      if (typeof stopTakesListener === 'function') stopTakesListener(); // avoid the live snapshot clobbering injected takes
      _takes = [{ id: 't1', duration: 10, storagePath: 'p', downloadUrl: '', createdAt: { toDate: () => new Date(2026,5,6,15,42) } }];
      _loadedTakeId = 't1'; renderTakes();
    });
    assert('desktop: take delete button present', (await page.$$('.take-del-desktop')).length === 1);
    assert('desktop: take delete VISIBLE', await visible(page, '.take-del-desktop'));
    assert('desktop: take delete right of loop button', await page.evaluate(() => {
      const card = document.querySelector('.take-card');
      const loop = card.querySelector('.loop'), del = card.querySelector('.take-del-desktop');
      return loop && del && del.getBoundingClientRect().left >= loop.getBoundingClientRect().right - 1;
    }));
    assert('desktop: take delete wired to deleteTake', (await page.getAttribute('.take-del-desktop', 'onclick')).includes('deleteTake'));
  }

  // ── Touch / mobile context (pointer:coarse) → desktop deletes hidden, swipe actions still present ──
  {
    const { page } = await setup(browser, { viewport: { width: 390, height: 800 }, hasTouch: true, isMobile: true });
    page.on('pageerror', e => errors.push('PAGEERROR(mobile): ' + e.message));
    await page.goto(URL(port), { waitUntil: 'load' });
    await seed(page);
    assert('mobile: song delete button HIDDEN', !(await visible(page, '.sl-del-desktop')));
    assert('mobile: swipe Delete action still present', (await page.$$('.sl-actions .act-del')).length === 1);
  }

  assert('no fatal JS errors', errors.length === 0);
  console.log(results.join('\n'));
  if (errors.length) console.log('\nERRORS:\n' + errors.join('\n'));
  await browser.close(); srv.close();
  process.exit(results.some(r => r.startsWith('FAIL')) ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR:', e); process.exit(2); });
