// lite-1.011 patch checks: takes-panel clears the rail when closed + song-list loading gate.
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
(async () => {
  const { srv, port } = await startServer();
  const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true,
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 800 }, permissions: ['microphone'] });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  await page.goto(`http://127.0.0.1:${port}/lite-1.011.html`, { waitUntil: 'load' });
  const results = []; const assert = (n, c) => results.push((c ? 'PASS' : 'FAIL') + ' — ' + n);

  // ── Loading gate BEFORE auth-driven snapshot: render with not-loaded → spinner, not empty-state ──
  const gate = await page.evaluate(() => {
    _songsLoaded = false; _songs = [];
    renderSongList();
    const h = document.getElementById('songListBody').innerHTML;
    return { spinner: h.includes('spinner'), empty: h.includes('No songs yet') };
  });
  assert('loading shows spinner, not empty-state', gate.spinner && !gate.empty);
  const loaded = await page.evaluate(() => {
    _songsLoaded = true; _songs = [];
    renderSongList();
    return document.getElementById('songListBody').innerHTML.includes('No songs yet');
  });
  assert('empty-state only AFTER load', loaded);

  // Sign in (guest) and open a synthetic song to get the rail + takes panel
  await page.click('.auth-btn.ghost');
  await page.waitForSelector('body.signed-in', { timeout: 15000 });
  await page.evaluate(() => _openSongObj({ id: 'T', title: 'X', lyricsDoc: '<div>hi</div>' }));

  const vw = 390;
  // closed: panel should be fully off-screen to the right (left >= viewport width)
  const closed = await page.evaluate(() => document.getElementById('takesPanel').getBoundingClientRect().left);
  assert('takes panel closed → off-screen (clears rail)', closed >= vw - 2);

  // open: panel covers the lyrics area (left ~0) and stops before the 52px rail
  await page.evaluate(() => toggleTakes());
  await page.waitForTimeout(320);
  const open = await page.evaluate(() => { const r = document.getElementById('takesPanel').getBoundingClientRect(); return { left: r.left, right: r.right }; });
  assert('takes panel open → covers lyrics (left ~0)', open.left <= 1);
  assert('takes panel open → leaves rail (right ≈ vw-52)', Math.abs(open.right - (vw - 52)) <= 2);

  // close again → back off-screen, not overlapping rail
  await page.evaluate(() => toggleTakes());
  await page.waitForTimeout(320);
  const closed2 = await page.evaluate(() => document.getElementById('takesPanel').getBoundingClientRect().left);
  assert('takes panel re-closed → off-screen', closed2 >= vw - 2);

  assert('no fatal JS errors', errors.length === 0);
  console.log(results.join('\n'));
  if (errors.length) console.log('\nERRORS:\n' + errors.join('\n'));
  await browser.close(); srv.close();
  process.exit(results.some(r => r.startsWith('FAIL')) ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR:', e); process.exit(2); });
