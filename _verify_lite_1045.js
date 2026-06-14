// lite-1.045: no-account chord tools on the landing (Quick Chords / Find a Chord),
// sign-in nudge, and Back routing to the landing for preview visitors.
const { chromium } = require('playwright-core');
const path = require('path'); const http = require('http'); const fs = require('fs');
const BUILD = 'lite-1.045.html';
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
// COMPUTED visibility: visible iff it has a non-none display AND lays out (rects).
async function visible(page, sel) {
  return await page.evaluate((s) => {
    const el = document.querySelector(s); if (!el) return false;
    return getComputedStyle(el).display !== 'none' && el.getClientRects().length > 0;
  }, sel);
}
(async () => {
  const { srv, port } = await startServer();
  const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
  const results = []; const assert = (n, c) => results.push((c ? 'PASS' : 'FAIL') + ' — ' + n);
  const errors = [];
  const base = `http://127.0.0.1:${port}/${BUILD}`;
  const mobileCtx = () => browser.newContext({ viewport: { width: 390, height: 800 }, hasTouch: true, isMobile: true });

  // ── Landing: brand + two chord buttons + nudge + auth card (guest kept) ──
  {
    const page = await (await mobileCtx()).newPage();
    page.on('pageerror', e => errors.push('PAGEERROR(landing): ' + e.message));
    await page.goto(base, { waitUntil: 'load' });
    assert('landing: shown on load (not signed in)', await visible(page, '#landing'));
    assert('landing: #app hidden on load', !(await visible(page, '#app')));
    assert('landing: two chord buttons present, labelled Quick Chords + Find a Chord', await page.evaluate(() => {
      const b = [...document.querySelectorAll('.landing-tools .ltool-btn')];
      return b.length === 2 && /Quick Chords/.test(b[0].textContent) && /Find a Chord/.test(b[1].textContent);
    }));
    assert('landing: chord buttons sit BETWEEN the brand and the auth card', await page.evaluate(() => {
      const kids = [...document.getElementById('landing').children];
      const i = kids.findIndex(k => k.classList.contains('brand'));
      const t = kids.findIndex(k => k.classList.contains('landing-tools'));
      const a = kids.findIndex(k => k.classList.contains('auth-card'));
      return i < t && t < a;
    }));
    assert('landing: nudge copy mentions saving + syncing', await page.evaluate(() => {
      const n = document.querySelector('.landing-nudge');
      return !!n && /save/i.test(n.textContent) && /sync/i.test(n.textContent);
    }));
    assert('landing: "Continue as guest" button kept', await page.evaluate(() =>
      !!document.querySelector('.auth-card .auth-btn.ghost') &&
      /guest/i.test(document.querySelector('.auth-card .auth-btn.ghost').textContent)));
  }

  // ── Quick Chords from the landing (no auth) ──
  {
    const page = await (await mobileCtx()).newPage();
    page.on('pageerror', e => errors.push('PAGEERROR(qc): ' + e.message));
    await page.goto(base, { waitUntil: 'load' });
    await page.click('.landing-tools .ltool-btn:nth-child(1)');
    await page.waitForTimeout(80);
    assert('qc: body.chord-preview set (no .signed-in)', await page.evaluate(() =>
      document.body.classList.contains('chord-preview') && !document.body.classList.contains('signed-in')));
    assert('qc: #landing hidden (computed), #app visible', !(await visible(page, '#landing')) && (await visible(page, '#app')));
    assert('qc: #screen-qc is the active screen', await page.evaluate(() =>
      document.getElementById('screen-qc').classList.contains('active') && getComputedStyle(document.getElementById('screen-qc')).display !== 'none'));
    assert('qc: diatonic chord pills rendered', await page.evaluate(() =>
      document.querySelectorAll('#qcPills *').length > 0));
    assert('qc: key pill defaults to C major', await page.evaluate(() =>
      /C major/.test(document.getElementById('qcKeyPill').textContent)));

    // Switch QC → FC keeps the landing origin.
    await page.click('#screen-qc .nav-switch');
    await page.waitForTimeout(60);
    assert('qc→fc: switch lands on #screen-fc, still in chord-preview', await page.evaluate(() =>
      document.getElementById('screen-fc').classList.contains('active') && document.body.classList.contains('chord-preview')));

    // Back from FC returns to the landing.
    await page.click('#screen-fc .back-btn');
    await page.waitForTimeout(60);
    assert('back: chord-preview cleared', await page.evaluate(() => !document.body.classList.contains('chord-preview')));
    assert('back: #landing visible again, #app hidden', (await visible(page, '#landing')) && !(await visible(page, '#app')));
  }

  // ── Find a Chord directly from the landing ──
  {
    const page = await (await mobileCtx()).newPage();
    page.on('pageerror', e => errors.push('PAGEERROR(fc): ' + e.message));
    await page.goto(base, { waitUntil: 'load' });
    await page.click('.landing-tools .ltool-btn:nth-child(2)');
    await page.waitForTimeout(80);
    assert('fc: opens #screen-fc in chord-preview (no auth)', await page.evaluate(() =>
      document.getElementById('screen-fc').classList.contains('active') &&
      document.body.classList.contains('chord-preview') && !document.body.classList.contains('signed-in')));
    assert('fc: #landing hidden, #app visible', !(await visible(page, '#landing')) && (await visible(page, '#app')));
  }

  // ── Regression: signed-in rail path still goes Back to the song screen, never the landing ──
  {
    const page = await (await mobileCtx()).newPage();
    page.on('pageerror', e => errors.push('PAGEERROR(reg): ' + e.message));
    await page.goto(base, { waitUntil: 'load' });
    await page.click('.auth-card .auth-btn.ghost');
    await page.waitForSelector('body.signed-in', { timeout: 15000 });
    await page.evaluate(() => { _openSongObj({ id: 'S', title: 'X', key: 'C major', lyricsDoc: '<div>x</div>' }); stopTakesListener(); });
    await page.waitForTimeout(60);
    await page.click('.rail .rail-tool'); // first rail tool = 🎸 Quick Chords
    await page.waitForTimeout(80);
    assert('reg: rail 🎸 opens #screen-qc WITHOUT setting chord-preview', await page.evaluate(() =>
      document.getElementById('screen-qc').classList.contains('active') && !document.body.classList.contains('chord-preview')));
    await page.click('#screen-qc .back-btn');
    await page.waitForTimeout(60);
    assert('reg: Back returns to #screen-song (not the landing)', await page.evaluate(() =>
      document.getElementById('screen-song').classList.contains('active') &&
      document.body.classList.contains('signed-in') && !document.body.classList.contains('chord-preview')));
  }

  // ── Narrow viewport: the two chord buttons stack ──
  {
    const page = await (await browser.newContext({ viewport: { width: 320, height: 700 }, hasTouch: true, isMobile: true })).newPage();
    await page.goto(base, { waitUntil: 'load' });
    assert('narrow: .landing-tools stacks (flex-direction column) at ≤360px', await page.evaluate(() =>
      getComputedStyle(document.querySelector('.landing-tools')).flexDirection === 'column'));
  }

  // ── Screenshots ──
  {
    const page = await (await mobileCtx()).newPage();
    await page.goto(base, { waitUntil: 'load' });
    await page.screenshot({ path: '_shot_lite_1045_landing.png' });
    await page.click('.landing-tools .ltool-btn:nth-child(1)'); await page.waitForTimeout(120);
    await page.screenshot({ path: '_shot_lite_1045_qc.png' });
    await page.click('#screen-qc .nav-switch'); await page.waitForTimeout(120);
    await page.screenshot({ path: '_shot_lite_1045_fc.png' });
  }

  const fatal = errors.filter(e => !/permission|insufficient|FirebaseError|Failed to load resource|net::ERR|storage\//i.test(e));
  assert('no fatal JS errors', fatal.length === 0);
  if (fatal.length) console.log('FATAL:\n' + fatal.join('\n'));
  console.log(results.join('\n'));
  await browser.close(); srv.close();
  if (results.some(r => r.startsWith('FAIL'))) process.exit(1);
})();
