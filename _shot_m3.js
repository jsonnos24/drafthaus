const { chromium } = require('playwright-core');
const path = require('path'); const http = require('http'); const fs = require('fs');
function startServer() { return new Promise(resolve => { const srv = http.createServer((req, res) => { const file = path.join(__dirname, decodeURIComponent(req.url.split('?')[0])); fs.readFile(file, (err, buf) => { if (err) { res.writeHead(404); res.end('nf'); return; } res.writeHead(200, { 'Content-Type': file.endsWith('.html') ? 'text/html' : 'application/octet-stream' }); res.end(buf); }); }); srv.listen(0, '127.0.0.1', () => resolve({ srv, port: srv.address().port })); }); }
(async () => {
  const { srv, port } = await startServer();
  const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
  const page = await (await browser.newContext({ viewport: { width: 390, height: 820 } })).newPage();
  await page.goto(`http://127.0.0.1:${port}/lite-1.02.html`, { waitUntil: 'load' });
  await page.click('.auth-btn.ghost'); await page.waitForSelector('body.signed-in');
  await page.evaluate(() => _openSongObj({ id: 'S', title: 'X', key: 'G major', lyricsDoc: '<div>x</div>' }));
  await page.evaluate(() => { openQuickChords(); qcPlayPill('G'); });
  await page.waitForTimeout(200);
  await page.screenshot({ path: '_shot_qc.png' });
  await page.evaluate(() => { openFindChord(); const r=document.getElementById('fcRoot'),q=document.getElementById('fcQual'); r.value='G'; q.value='0'; fcSelectFromDropdown(); });
  await page.waitForTimeout(200);
  await page.screenshot({ path: '_shot_fc.png' });
  await browser.close(); srv.close();
  console.log('shots written');
})();
