// lite-1.033: swipe actions confined to the card (not the waveform) + hidden on desktop.
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
async function setupLoadedTakeWithWave(page) {
  await page.click('.auth-btn.ghost');
  await page.waitForSelector('body.signed-in', { timeout: 15000 });
  await page.evaluate(() => {
    _openSongObj({ id: 'S', title: 'X', key: 'C major', lyricsDoc: '<div>x</div>' });
    stopTakesListener();
    const ctx = ensureCtx(); const sr = ctx.sampleRate; const buf = ctx.createBuffer(1, Math.floor(sr * 2), sr);
    const d = buf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.sin(i * 0.01) * 0.4;
    _takes = [{ id: 't1', songId: 'S', pinned: true, pinOrder: 1, duration: 2, storagePath: 'p', downloadUrl: '', createdAt: { toDate: () => new Date() } }];
    _loadedTakeId = 't1';
    _wf.takeId = 't1'; _wf.buffer = buf; _wf.dur = 2; _wf.peaks = _computePeaks(buf, 1400); _wf.sel = { a: 0.5, b: 1.2 };
    document.getElementById('takesPanel').classList.add('open');
    renderTakes(); wfRender();
  });
  await page.waitForTimeout(60);
}
(async () => {
  const { srv, port } = await startServer();
  const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
  const results = []; const assert = (n, c) => results.push((c ? 'PASS' : 'FAIL') + ' — ' + n);
  const errors = [];

  // ── Desktop ──
  {
    const page = await (await browser.newContext({ viewport: { width: 1100, height: 800 } })).newPage();
    page.on('pageerror', e => errors.push('PAGEERROR(desktop): ' + e.message));
    await page.goto(`http://127.0.0.1:${port}/lite-1.033.html`, { waitUntil: 'load' });
    await setupLoadedTakeWithWave(page);

    assert('take-swipe wrapper exists', (await page.$$('.take-row .take-swipe')).length >= 1);
    assert('waveform is OUTSIDE the swipe wrapper (sibling, not over the actions)', await page.evaluate(() => {
      const row = document.querySelector('.take-row[data-id="t1"]');
      return !!row.querySelector(':scope > .take-wave') && !row.querySelector('.take-swipe .take-wave');
    }));
    assert('desktop: swipe Pin/Delete actions are HIDDEN', await page.evaluate(() => getComputedStyle(document.querySelector('.take-actions')).display === 'none'));
    assert('desktop: waveform + its controls render (not covered)', await page.evaluate(() => {
      const wave = document.querySelector('.take-wave .wave-canvas'); const save = document.querySelector('.take-wave .wf-btn.trim');
      return !!wave && !!save && getComputedStyle(save).display !== 'none';
    }));
    assert('desktop: inline pin + trash icons still present', await page.evaluate(() => !!document.querySelector('.take-pin-desktop') && !!document.querySelector('.take-del-desktop')));
  }

  // ── Mobile: swipe actions still available (revealable) ──
  {
    const page = await (await browser.newContext({ viewport: { width: 390, height: 800 }, hasTouch: true, isMobile: true })).newPage();
    page.on('pageerror', e => errors.push('PAGEERROR(mobile): ' + e.message));
    await page.goto(`http://127.0.0.1:${port}/lite-1.033.html`, { waitUntil: 'load' });
    await setupLoadedTakeWithWave(page);
    assert('mobile: swipe actions present + revealable (display flex)', await page.evaluate(() => getComputedStyle(document.querySelector('.take-actions')).display === 'flex'));
    assert('mobile: swipe wrapper clips overflow', await page.evaluate(() => getComputedStyle(document.querySelector('.take-swipe')).overflow === 'hidden'));
    assert('mobile: waveform still outside the wrapper', await page.evaluate(() => !document.querySelector('.take-swipe .take-wave')));
  }

  const fatal = errors.filter(e => !/permission|insufficient|FirebaseError|Failed to load resource|net::ERR|storage\//i.test(e));
  assert('no fatal JS errors', fatal.length === 0);
  console.log(results.join('\n'));
  if (fatal.length) console.log('\nFATAL:\n' + fatal.join('\n'));
  await browser.close(); srv.close();
  process.exit(results.some(r => r.startsWith('FAIL')) ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR:', e); process.exit(2); });
