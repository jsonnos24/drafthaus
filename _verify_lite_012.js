// lite-1.012: screens must be mutually exclusive by COMPUTED VISIBILITY, not just .active class.
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
  await page.goto(`http://127.0.0.1:${port}/lite-1.012.html`, { waitUntil: 'load' });
  const results = []; const assert = (n, c) => results.push((c ? 'PASS' : 'FAIL') + ' — ' + n);

  // helper: a section is *visually shown* only if computed display !== none AND it has layout
  const shown = (id) => page.evaluate((id) => {
    const el = document.getElementById(id);
    const disp = getComputedStyle(el).display;
    return disp !== 'none' && el.getClientRects().length > 0;
  }, id);

  await page.click('.auth-btn.ghost');
  await page.waitForSelector('body.signed-in', { timeout: 15000 });

  // On the song list, the SONG screen must be fully hidden (the reported bug)
  assert('song list visible at start', await shown('screen-songlist'));
  assert('song screen HIDDEN at start (not bleeding through)', !(await shown('screen-song')));

  // Open a song → song screen visible, list hidden
  await page.evaluate(() => _openSongObj({ id: 'T', title: 'X', lyricsDoc: '<div>hi</div>' }));
  assert('song screen visible after open', await shown('screen-song'));
  assert('song list hidden after open', !(await shown('screen-songlist')));

  // Back home → list visible, song screen hidden again
  await page.evaluate(() => goHome());
  assert('song list visible after goHome', await shown('screen-songlist'));
  assert('song screen hidden after goHome', !(await shown('screen-song')));

  // And the song screen still works as flex column when active (layout intact)
  await page.evaluate(() => _openSongObj({ id: 'T2', title: 'Y', lyricsDoc: '<div>x</div>' }));
  assert('song screen is flex column when active', await page.evaluate(() => {
    const s = getComputedStyle(document.getElementById('screen-song'));
    return s.display === 'flex' && s.flexDirection === 'column';
  }));

  assert('no fatal JS errors', errors.length === 0);
  console.log(results.join('\n'));
  if (errors.length) console.log('\nERRORS:\n' + errors.join('\n'));
  await browser.close(); srv.close();
  process.exit(results.some(r => r.startsWith('FAIL')) ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR:', e); process.exit(2); });
