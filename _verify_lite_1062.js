// lite-1.062: ✎ rename button — whole take card selects; dedicated pencil opens rename.
const { chromium } = require('playwright-core');
const path = require('path'); const http = require('http'); const fs = require('fs');
const BUILD = 'lite-1.062.html';
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
async function guestIn(page) {
  for (let i = 0; i < 4; i++) {
    try { await page.click('.auth-card .auth-btn.ghost'); await page.waitForSelector('body.signed-in', { timeout: 20000 }); return; }
    catch (e) { if (i === 3) throw e; await page.waitForTimeout(800); }
  }
}
(async () => {
  const { srv, port } = await startServer();
  const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
  const errors = [];
  const base = `http://127.0.0.1:${port}/${BUILD}`;

  const page = await browser.newContext({ viewport: { width: 390, height: 800 }, hasTouch: true, isMobile: true }).then(c => c.newPage());
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  await page.addInitScript(() => { localStorage['drafthaus-eula-accepted'] = '1'; });
  await page.goto(base, { waitUntil: 'load' });
  await guestIn(page);
  await page.evaluate(() => {
    _openSongObj({ id: 'S1062', title: 'verify-1062', key: 'C major', lyricsDoc: '<div>test</div>' });
    stopTakesListener();
  });
  await page.waitForTimeout(200);

  // open the takes panel and inject two takes (one pinned, one not)
  await page.evaluate(() => {
    stopTakesListener();                       // stop the live snapshot clobbering injected takes
    _takes = [
      { id: 'tk_pin', name: 'Pinned take', duration: 12, pinned: true,  pinOrder: 0, mimeType: 'audio/mp3',  bytes: 1200000 },
      { id: 'tk_rest', name: 'Verse idea 2', duration: 31, pinned: false,                mimeType: 'audio/webm', bytes: 2000000 },
    ];
    if (typeof toggleTakes === 'function') toggleTakes();  // ensure panel open
    renderTakes();
  });

  const results = [];
  const ok = (name, cond) => results.push((cond ? 'PASS ' : 'FAIL ') + name);

  // 1. Every row has exactly one .take-edit, ordered immediately before .loop
  const order = await page.evaluate(() => [...document.querySelectorAll('.take-card')].map(card => {
    const kids = [...card.children];
    const e = kids.findIndex(k => k.classList.contains('take-edit'));
    const l = kids.findIndex(k => k.classList.contains('loop'));
    return { hasEdit: e !== -1, hasLoop: l !== -1, editBeforeLoop: e !== -1 && l !== -1 && e === l - 1 };
  }));
  ok('two rows rendered (pinned + rest)', order.length === 2);
  ok('each row has a .take-edit', order.every(o => o.hasEdit));
  ok('.take-edit immediately precedes .loop in every row', order.every(o => o.editBeforeLoop));

  // 2. Title no longer carries a rename onclick
  const titleHasOnclick = await page.evaluate(() =>
    [...document.querySelectorAll('.take-card .nm')].some(n => n.hasAttribute('onclick')));
  ok('title (.nm) has no onclick', titleHasOnclick === false);

  // 3. Tapping the card body selects (load + waveform host), NOT the .take-edit
  await page.evaluate(() => { _loadedTakeId = null; });
  await page.click('.take-card .meta .nm');  // tapping the title selects now
  const afterTitleTap = await page.evaluate(() => ({
    loaded: _loadedTakeId,
    renaming: !!document.querySelector('.take-card .nm[contenteditable]'),
  }));
  ok('tapping title selects a take', !!afterTitleTap.loaded);
  ok('tapping title does NOT enter rename', afterTitleTap.renaming === false);
  ok('selected row shows a .take-wave host', await page.evaluate(() => !!document.querySelector('.take-row .take-wave')));

  // 4. Clicking .take-edit enters contenteditable rename
  await page.evaluate(() => { db.collection = () => ({ doc: () => ({ set: async () => {} }) }); }); // stub Firestore write
  await page.click('.take-card .take-edit');
  ok('clicking ✎ enters contenteditable rename', await page.evaluate(() =>
    !!document.querySelector('.take-card .nm[contenteditable="true"]')));

  const fatal = errors.filter(e => !/permission|insufficient|FirebaseError|Failed to load resource|net::ERR|storage\//i.test(e));
  ok('no fatal JS errors', fatal.length === 0);
  if (fatal.length) console.log('FATAL:\n' + fatal.join('\n'));

  console.log(results.join('\n'));
  console.log(results.filter(r => r.startsWith('PASS')).length + ' PASS / ' + results.filter(r => r.startsWith('FAIL')).length + ' FAIL');

  await browser.close(); srv.close();
  if (results.some(r => r.startsWith('FAIL'))) process.exit(1);
})();
