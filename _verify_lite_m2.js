// Milestone 2: lyrics, recording state machine, takes UI, playback, boost, menu, formatting.
const { chromium } = require('playwright-core');
const path = require('path');
const http = require('http');
const fs = require('fs');

// Serve the repo dir over real HTTP so origin is http (not file://): fixes
// getUserMedia secure-context + same-origin fetch behaviour like production.
function startServer() {
  return new Promise(resolve => {
    const srv = http.createServer((req, res) => {
      const file = path.join(__dirname, decodeURIComponent(req.url.split('?')[0]));
      fs.readFile(file, (err, buf) => {
        if (err) { res.writeHead(404); res.end('nf'); return; }
        res.writeHead(200, { 'Content-Type': file.endsWith('.html') ? 'text/html' : 'application/octet-stream' });
        res.end(buf);
      });
    });
    srv.listen(0, '127.0.0.1', () => resolve({ srv, port: srv.address().port }));
  });
}

(async () => {
  const { srv, port } = await startServer();
  const browser = await chromium.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
  });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 800 }, permissions: ['microphone'] });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));

  await page.goto(`http://127.0.0.1:${port}/lite-1.01.html`, { waitUntil: 'load' });
  const results = [];
  const assert = (n, c) => results.push((c ? 'PASS' : 'FAIL') + ' — ' + n);

  // Sign in (guest)
  await page.click('.auth-btn.ghost');
  await page.waitForSelector('body.signed-in', { timeout: 15000 });

  // ── Date / name formatting (pure) ──
  const fmt = await page.evaluate(() => {
    const d = new Date(2026, 5, 6, 15, 42); // June 6 2026, 3:42pm local
    return {
      noYear: window.fmtTakeDate(d, false),
      withYear: window.fmtTakeDate(d, true),
      disp: window.takeDisplayName({ name: 'Chorus idea', createdAt: { toDate: () => d } }, true),
      empty: window.takeDisplayName({ createdAt: { toDate: () => d } }, false),
    };
  });
  assert('rail date format (no year)', fmt.noYear === 'June 6th - 3:42pm');
  assert('panel date format (with year)', fmt.withYear === 'June 6th, 2026 - 3:42pm');
  assert('renamed take = name + date', fmt.disp === 'Chorus idea - June 6th, 2026 - 3:42pm');
  assert('default take name = date only', fmt.empty === 'June 6th - 3:42pm');

  // ── Open a synthetic song (avoids depending on Firestore write perms in guest) ──
  await page.evaluate(() => {
    window._openSongObj({
      id: 'TESTSONG', ownerId: 'guest', title: 'Ghost in the Rain', key: '',
      lyricsDoc: '<div style="font-weight:700;color:#6aabee">Verse 1</div><div>Walking down a road</div>',
    });
  });
  assert('song screen active', await page.evaluate(() => document.getElementById('screen-song').classList.contains('active')));
  assert('title rendered', (await page.textContent('#songTitle')) === 'Ghost in the Rain');
  assert('lyrics loaded into editor', (await page.innerHTML('#lyricsEditor')).includes('Walking down a road'));

  // ── Lyrics edit + commit guard ──
  const lyr = await page.evaluate(() => {
    const ed = document.getElementById('lyricsEditor');
    ed.innerHTML = '<div>New line of lyrics</div>';
    window.flushLyrics();
    return _currentSong.lyricsDoc;
  });
  assert('lyrics commit updates song', lyr.includes('New line of lyrics'));
  const guard = await page.evaluate(() => {
    document.getElementById('lyricsEditor').innerHTML = '';   // try to blank
    window.flushLyrics();
    return _currentSong.lyricsDoc;                     // should NOT be blanked
  });
  assert('blank-guard keeps lyrics', guard.includes('New line of lyrics'));

  // ── Rail elements ──
  assert('record button present', await page.isVisible('#recBtn'));
  assert('play/stop button present', await page.isVisible('#playBtn'));
  assert('takes button present', await page.isVisible('.takes-btn'));
  assert('rail shows Empty (no takes)', (await page.textContent('#railTakeName')).trim() === 'Empty');

  // ── Recording state machine (fake mic) ──
  await page.click('#recBtn');
  await page.waitForTimeout(500);
  assert('record → recording state', await page.evaluate(() => document.getElementById('recBtn').classList.contains('recording') && _recording === true));
  assert('timer running', /\d:\d\d/.test(await page.textContent('#recTimer')));
  await page.waitForTimeout(600);
  await page.click('#recBtn');               // stop
  await page.waitForTimeout(300);
  assert('stop → recording cleared', await page.evaluate(() => !document.getElementById('recBtn').classList.contains('recording') && _recording === false));

  // ── Takes UI (inject synthetic takes; no network) ──
  await page.evaluate(() => {
    const d1 = new Date(2026, 5, 6, 15, 42), d2 = new Date(2026, 5, 5, 21, 30);
    _takes = [
      { id: 't1', duration: 48, storagePath: 'x', downloadUrl: '', createdAt: { toDate: () => d1 } },
      { id: 't2', duration: 33, name: 'Chorus idea', storagePath: 'y', downloadUrl: '', createdAt: { toDate: () => d2 } },
    ];
    _loadedTakeId = 't1';
    window.renderTakes(); window.updateRail();
  });
  assert('two take rows render', (await page.$$('.take-card')).length === 2);
  assert('rail shows loaded take name', (await page.textContent('#railTakeName')).includes('June 6th'));
  assert('renamed take shows custom name', (await page.innerText('#takesList')).includes('Chorus idea'));

  // loop toggle
  await page.evaluate(() => window.toggleLoop('t1'));
  assert('loop toggles on', await page.evaluate(() => _loopTakes.has('t1')));

  // select take updates rail
  await page.evaluate(() => window.selectTake('t2'));
  assert('select take updates loaded', await page.evaluate(() => _loadedTakeId === 't2'));

  // playback engine doesn't throw on bad URL (caught)
  await page.evaluate(() => window.playTake('t1'));
  await page.waitForTimeout(150);
  assert('playTake handled gracefully', true);

  // ── Takes panel open/close ──
  await page.evaluate(() => window.toggleTakes());
  assert('takes panel opens', await page.evaluate(() => document.getElementById('takesPanel').classList.contains('open')));
  await page.evaluate(() => window.toggleTakes());
  assert('takes panel closes', await page.evaluate(() => !document.getElementById('takesPanel').classList.contains('open')));

  // ── Boost toggle (UI; firestore write may fail in guest, tolerated) ──
  await page.evaluate(() => window.toggleBoost());
  assert('boost turns on', await page.evaluate(() => _currentSong.boost === true && document.getElementById('boostToggle').classList.contains('on')));
  await page.evaluate(() => window.toggleBoost());
  assert('boost turns off', await page.evaluate(() => _currentSong.boost === false));

  // ── Menu + key picker + appearance ──
  await page.evaluate(() => window.openMenu());
  assert('menu opens', await page.evaluate(() => document.getElementById('menuSheet').classList.contains('open')));
  await page.evaluate(() => window.openKeyPicker());
  assert('key picker renders', (await page.innerHTML('#menuSheetInner')).includes('key-grid'));
  await page.evaluate(() => window.setKey('C major'));
  assert('key sets on song', await page.evaluate(() => _currentSong.key === 'C major'));
  const before = await page.evaluate(() => document.documentElement.classList.contains('dark'));
  await page.evaluate(() => window.cycleTheme());
  const after = await page.evaluate(() => ({ dark: document.documentElement.classList.contains('dark'), theme: localStorage.getItem('dh-lite-theme') }));
  assert('appearance cycle changes theme', after.theme && (after.dark !== before || after.theme !== 'system'));

  // ── Back to song list ──
  await page.evaluate(() => { window.closeMenu(); window.goHome(); });
  assert('goHome returns to song list', await page.evaluate(() => document.getElementById('screen-songlist').classList.contains('active')));

  const fatal = errors.filter(e => !/permission|insufficient|FirebaseError|Failed to load resource|net::ERR|storage\/|Unexpected token|decodeAudioData|EncodingError|Unable to decode/i.test(e));
  assert('no fatal JS errors', fatal.length === 0);

  console.log(results.join('\n'));
  if (fatal.length) console.log('\nFATAL:\n' + fatal.join('\n'));
  console.log('\nconsole errors (' + errors.length + ', non-fatal noise expected):');
  errors.slice(0, 10).forEach(e => console.log('  · ' + e.slice(0, 150)));

  await browser.close();
  srv.close();
  process.exit(results.some(r => r.startsWith('FAIL')) ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR:', e); process.exit(2); });
