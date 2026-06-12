// lite-1.030: 3-second visual countdown before recording.
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
(async () => {
  const { srv, port } = await startServer();
  const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true,
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 800 }, permissions: ['microphone'] });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  await page.goto(`http://127.0.0.1:${port}/lite-1.030.html`, { waitUntil: 'load' });
  const results = []; const assert = (n, c) => results.push((c ? 'PASS' : 'FAIL') + ' — ' + n);

  await page.click('.auth-btn.ghost');
  await page.waitForSelector('body.signed-in', { timeout: 15000 });
  await page.evaluate(() => _openSongObj({ id: 'S', title: 'X', key: 'C major', lyricsDoc: '<div>x</div>' }));

  // Tap Record → countdown begins at 3 (not recording yet)
  await page.click('#recBtn');
  await page.waitForTimeout(120);
  assert('tap Record starts a countdown (not recording yet)', await page.evaluate(() => _recCounting === true && _recording === false));
  assert('countdown overlay shows "3"', await page.evaluate(() => { const e = document.getElementById('recCountdown'); return e.classList.contains('show') && e.textContent === '3'; }));
  assert('record button shows the counting state', await page.evaluate(() => document.getElementById('recBtn').classList.contains('counting')));

  // counts down 3 → 2
  await page.waitForTimeout(1050);
  assert('countdown ticks to "2"', await page.evaluate(() => document.getElementById('recCountdown').textContent === '2'));

  // Tapping during countdown cancels it (no recording)
  await page.click('#recBtn');
  await page.waitForTimeout(80);
  assert('tap during countdown cancels it', await page.evaluate(() => _recCounting === false && _recording === false && !document.getElementById('recCountdown').classList.contains('show')));

  // Restart and let it finish → recording actually starts after the count
  await page.click('#recBtn');
  await page.waitForTimeout(120);
  assert('countdown restarts at "3"', await page.evaluate(() => document.getElementById('recCountdown').textContent === '3'));
  await page.waitForTimeout(3300);
  assert('recording starts after the countdown', await page.evaluate(() => _recording === true && document.getElementById('recBtn').classList.contains('recording')));
  assert('countdown overlay hidden once recording', await page.evaluate(() => !document.getElementById('recCountdown').classList.contains('show')));
  assert('mic was pre-acquired during the count (stream ready)', await page.evaluate(() => !!_recStream));

  // stop
  await page.click('#recBtn');
  await page.waitForTimeout(200);
  assert('tap while recording stops it', await page.evaluate(() => _recording === false));

  const fatal = errors.filter(e => !/permission|insufficient|FirebaseError|Failed to load resource|net::ERR|storage\//i.test(e));
  assert('no fatal JS errors', fatal.length === 0);
  console.log(results.join('\n'));
  if (fatal.length) console.log('\nFATAL:\n' + fatal.join('\n'));
  await browser.close(); srv.close();
  process.exit(results.some(r => r.startsWith('FAIL')) ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR:', e); process.exit(2); });
