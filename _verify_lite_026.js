// lite-1.026: chord tools in the rail, ☰→theme toggle, boost smooth live ramp.
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
    args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await (await browser.newContext({ viewport: { width: 390, height: 820 } })).newPage();
  const errors = []; page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  await page.goto(`http://127.0.0.1:${port}/lite-1.026.html`, { waitUntil: 'load' });
  const results = []; const assert = (n, c) => results.push((c ? 'PASS' : 'FAIL') + ' — ' + n);

  await page.click('.auth-btn.ghost');
  await page.waitForSelector('body.signed-in', { timeout: 15000 });
  await page.evaluate(() => _openSongObj({ id:'S', title:'X', key:'C major', lyricsDoc:'<div>x</div>' }));

  // ── Chord tools live in the rail (between Play and Takes), no ☰ menu ──
  const rail = await page.evaluate(() => {
    const tools = [...document.querySelectorAll('.rail .rail-tool')].map(b => ({ t: b.textContent, oc: b.getAttribute('onclick') }));
    const order = [...document.querySelector('.rail').children].map(c => c.className || c.id || c.tagName);
    return { tools, order, noMenuBtn: !document.querySelector('[onclick*="openMenu"]') };
  });
  assert('rail has Quick Chords (guitar) tool → openQuickChords', rail.tools.some(t => /openQuickChords/.test(t.oc) && /🎸/.test(t.t)));
  assert('rail has Find a Chord (magnifier) tool → openFindChord', rail.tools.some(t => /openFindChord/.test(t.oc) && /🔍/.test(t.t)));
  assert('chord tools sit between Play and Takes', (() => {
    const ids = rail.order.join('|');
    const play = rail.order.findIndex(x => /pt-btn/.test(x));
    const tool = rail.order.findIndex(x => /rail-tool/.test(x));
    const takes = rail.order.findIndex(x => /takes-btn/.test(x));
    return play < tool && tool < takes;
  })());
  assert('no ☰ menu button anywhere', rail.noMenuBtn);
  assert('rail chord tools open their screens', await page.evaluate(() => { openQuickChords(); const ok1 = getComputedStyle(document.getElementById('screen-qc')).display !== 'none'; openFindChord(); const ok2 = getComputedStyle(document.getElementById('screen-fc')).display !== 'none'; showScreen('song'); return ok1 && ok2; }));

  // ── Theme toggle (sun/moon) replaces the menu button ──
  const tb = await page.evaluate(() => !!document.getElementById('themeToggleBtn'));
  assert('theme toggle button present in top bar', tb);
  const t1 = await page.evaluate(() => { applyTheme('light'); return { dark: document.documentElement.classList.contains('dark'), icon: document.getElementById('themeToggleBtn').textContent }; });
  assert('light mode shows ☀ icon', !t1.dark && t1.icon === '☀️');
  const t2 = await page.evaluate(() => { toggleTheme(); return { dark: document.documentElement.classList.contains('dark'), icon: document.getElementById('themeToggleBtn').textContent }; });
  assert('toggle → dark mode shows 🌙 icon', t2.dark && t2.icon === '🌙');
  const t3 = await page.evaluate(() => { toggleTheme(); return document.documentElement.classList.contains('dark'); });
  assert('toggle again → back to light', t3 === false);

  // ── Key picker still reachable (from the QC key pill) ──
  const keyOk = await page.evaluate(() => { qcOpenKeyPicker(); return document.getElementById('menuSheet').classList.contains('open') && document.getElementById('menuSheetInner').innerHTML.includes('key-grid'); });
  assert('key picker still opens from QC key pill', keyOk);
  await page.evaluate(() => closeMenu());

  // ── Boost: live, click-free toggle during playback (ramps a real gain node) ──
  const boost = await page.evaluate(() => {
    // simulate active playback with a gain node + cached buffer
    _currentSong = { id:'S', boost:false };
    const ctx = ensureCtx();
    _curGain = ctx.createGain(); _curGain.gain.value = 1; _playingTakeId = 't';
    _bufCache['t'] = { normGain: 3.2 };
    let ramped = false; const orig = _curGain.gain.setTargetAtTime.bind(_curGain.gain);
    _curGain.gain.setTargetAtTime = (...a) => { ramped = true; return orig(...a); };
    toggleBoost();
    return { ramped, boost: _currentSong.boost };
  });
  assert('boost toggles ON during playback via smooth ramp', boost.ramped && boost.boost === true);

  const fatal = errors.filter(e => !/permission|insufficient|FirebaseError|Failed to load resource|net::ERR|storage\//i.test(e));
  assert('no fatal JS errors', fatal.length === 0);
  console.log(results.join('\n'));
  if (fatal.length) console.log('\nFATAL:\n' + fatal.join('\n'));
  await browser.close(); srv.close();
  process.exit(results.some(r => r.startsWith('FAIL')) ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR:', e); process.exit(2); });
