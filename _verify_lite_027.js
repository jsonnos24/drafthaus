// lite-1.027: pin + reorder for takes; desktop pin for songs+takes; drag-reorder commit.
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
  const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
  const desktop = await browser.newContext({ viewport: { width: 1100, height: 800 } });
  const page = await desktop.newPage();
  const errors = []; page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  await page.goto(`http://127.0.0.1:${port}/lite-1.027.html`, { waitUntil: 'load' });
  const results = []; const assert = (n, c) => results.push((c ? 'PASS' : 'FAIL') + ' — ' + n);

  await page.click('.auth-btn.ghost');
  await page.waitForSelector('body.signed-in', { timeout: 15000 });
  await page.waitForTimeout(300);

  // ── Takes: pinned section + reorder + pin affordances ──
  await page.evaluate(() => {
    if (_songsUnsub) { _songsUnsub(); _songsUnsub = null; }
    _openSongObj({ id: 'S', title: 'X', key: 'C major', lyricsDoc: '<div>x</div>' });
    stopTakesListener(); // prevent the live (empty) snapshot from clobbering injected takes
    const d = (n) => ({ toDate: () => new Date(2026, 5, n, 12, 0) });
    _takes = [
      { id: 'p1', pinned: true, pinOrder: 1, duration: 10, storagePath: 'x', downloadUrl: '', createdAt: d(6) },
      { id: 'p2', pinned: true, pinOrder: 2, duration: 12, storagePath: 'x', downloadUrl: '', createdAt: d(5) },
      { id: 'u1', duration: 8, storagePath: 'x', downloadUrl: '', createdAt: d(7) },
    ];
    renderTakes();
  });
  assert('takes: Pinned section rendered', await page.evaluate(() => [...document.querySelectorAll('#takesList .tp-sec')].some(el => el.textContent.includes('Pinned'))));
  assert('takes: pinned group is reorderable', (await page.$$('#takesList .tp-group[data-reorder="takes"]')).length === 1);
  assert('takes: drag handles on the 2 pinned rows', (await page.$$('#takesList .tp-group[data-reorder="takes"] .drag-handle')).length === 2);
  assert('takes: swipe Pin action present', (await page.$$('#takesList .act-pin-take')).length === 3);
  assert('takes: desktop pin icon present', (await page.$$('#takesList .take-pin-desktop')).length === 3);
  assert('takes: desktop pin icon visible on desktop', await page.evaluate(() => getComputedStyle(document.querySelector('.take-pin-desktop')).display !== 'none'));

  // ── Songs: pinned reorderable group + desktop pin ──
  await page.evaluate(() => {
    _songs = [
      { id: 'sp1', title: 'Pinned One', pinned: true, pinOrder: 1, updatedAt: Date.now() },
      { id: 'sp2', title: 'Pinned Two', pinned: true, pinOrder: 2, updatedAt: Date.now() },
      { id: 'sr1', title: 'Recent', updatedAt: Date.now() },
    ];
    _songsLoaded = true; goHome(); renderSongList();
  });
  assert('songs: pinned group is reorderable', (await page.$$('#songListBody .sl-group[data-reorder="songs"]')).length === 1);
  assert('songs: drag handles on pinned rows', (await page.$$('#songListBody .sl-group[data-reorder="songs"] .drag-handle')).length === 2);
  assert('songs: desktop pin icon present + visible', await page.evaluate(() => { const b = document.querySelector('.sl-pin-desktop'); return !!b && getComputedStyle(b).display !== 'none'; }));

  // ── Reorder commit maps DOM order → pinOrder writes ──
  const takeCommit = await page.evaluate(() => {
    const c = document.createElement('div'); c.dataset.reorder = 'takes';
    ['a','b','c'].forEach(id => { const d = document.createElement('div'); d.dataset.id = id; c.appendChild(d); });
    document.body.appendChild(c);
    c.appendChild(c.firstElementChild); // move 'a' to the end → b,c,a
    let cap = null; const orig = window._commitOrder; window._commitOrder = (col, ids) => { cap = { col, ids }; };
    _reorder = { row: c.querySelector('[data-id]'), container: c, type: 'takes' };
    _endReorder(); window._commitOrder = orig; c.remove(); return cap;
  });
  assert('reorder commits takes → voice_takes with new order', takeCommit && takeCommit.col === 'voice_takes' && JSON.stringify(takeCommit.ids) === JSON.stringify(['b','c','a']));
  const songCommit = await page.evaluate(() => {
    const c = document.createElement('div'); c.dataset.reorder = 'songs';
    ['x','y'].forEach(id => { const d = document.createElement('div'); d.dataset.id = id; c.appendChild(d); });
    document.body.appendChild(c); c.insertBefore(c.lastElementChild, c.firstElementChild); // y,x
    let cap = null; const orig = window._commitOrder; window._commitOrder = (col, ids) => { cap = { col, ids }; };
    _reorder = { row: c.querySelector('[data-id]'), container: c, type: 'songs' };
    _endReorder(); window._commitOrder = orig; c.remove(); return cap;
  });
  assert('reorder commits songs with new order', songCommit && songCommit.col === 'songs' && JSON.stringify(songCommit.ids) === JSON.stringify(['y','x']));

  // ── toggleTakePin is wired ──
  assert('toggleTakePin exists', await page.evaluate(() => typeof toggleTakePin === 'function'));

  const fatal = errors.filter(e => !/permission|insufficient|FirebaseError|Failed to load resource|net::ERR|storage\//i.test(e));
  assert('no fatal JS errors', fatal.length === 0);
  console.log(results.join('\n'));
  if (fatal.length) console.log('\nFATAL:\n' + fatal.join('\n'));
  await browser.close(); srv.close();
  process.exit(results.some(r => r.startsWith('FAIL')) ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR:', e); process.exit(2); });
