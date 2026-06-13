// lite-1.034: chords float above lyrics + tap-insert entry; auth gates anonymous resume.
const { chromium } = require('playwright-core');
const path = require('path'); const http = require('http'); const fs = require('fs');
const BUILD = 'lite-1.034.html';
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
// Sign in as guest and open a song with one lyric line, takes listener stopped.
async function openGuestSong(page, lyricsDoc) {
  await page.click('.auth-btn.ghost');
  await page.waitForSelector('body.signed-in', { timeout: 15000 });
  await page.evaluate((doc) => {
    _openSongObj({ id: 'S', title: 'X', key: 'C major', lyricsDoc: doc });
    stopTakesListener();
  }, lyricsDoc || '<div>I walked the line</div>');
  await page.waitForTimeout(60);
}
(async () => {
  const { srv, port } = await startServer();
  const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
  const results = []; const assert = (n, c) => results.push((c ? 'PASS' : 'FAIL') + ' — ' + n);
  const errors = [];
  const base = `http://127.0.0.1:${port}/${BUILD}`;

  // (task assertions get appended here in later tasks)

  const fatal = errors.filter(e => !/permission|insufficient|FirebaseError|Failed to load resource|net::ERR|storage\//i.test(e));
  assert('no fatal JS errors', fatal.length === 0);
  console.log(results.join('\n'));
  await browser.close(); srv.close();
  if (results.some(r => r.startsWith('FAIL'))) process.exit(1);
})();
