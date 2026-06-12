// lite-1.024: enharmonic spelling, top-sliding/trimmed menu, QC nav (no title, centered key pill), strum spread.
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
  await page.goto(`http://127.0.0.1:${port}/lite-1.024.html`, { waitUntil: 'load' });
  const results = []; const assert = (n, c) => results.push((c ? 'PASS' : 'FAIL') + ' — ' + n);

  await page.click('.auth-btn.ghost');
  await page.waitForSelector('body.signed-in', { timeout: 15000 });

  // ── Enharmonic helpers (pure) ──
  const sp = await page.evaluate(() => ({
    a: _spellChordName('A#m', true), b: _spellChordName('A#m', false),
    c: _spellChordName('C#', true), d: _spellChordName('F#m', false),
  }));
  assert('_spellChordName A#m→B♭m (flats)', sp.a === 'B♭m');
  assert('_spellChordName A#m stays A#m (sharps)', sp.b === 'A#m');
  assert('_spellChordName C#→D♭ (flats)', sp.c === 'D♭');
  assert('_spellChordName F#m stays sharp', sp.d === 'F#m');

  // ── B♭ minor: diatonic shows flats, internal name stays sharp for audio ──
  await page.evaluate(() => { _openSongObj({ id:'S', title:'X', key:'B♭ minor', lyricsDoc:'<div>x</div>' }); openQuickChords(); });
  const first = await page.evaluate(() => { const el = document.querySelector('#qcPills .qc-col .qc-pill'); return { text: el.textContent, onclick: el.getAttribute('onclick') }; });
  assert('B♭ minor: first diatonic displays B♭m (not A#m)', first.text === 'B♭m');
  assert('internal chord name stays A#m for audio/voicing', /qcPlayPill\('A#m'\)/.test(first.onclick));
  const allFlat = await page.evaluate(() => !/A#|C#|D#|F#|G#/.test(document.getElementById('qcPills').innerText));
  assert('B♭ minor: no sharp spellings shown anywhere', allFlat);

  // ── F major (flat key with no ♭ in its name) shows B♭ for the IV ──
  await page.evaluate(() => { _openSongObj({ id:'S2', title:'Y', key:'F major', lyricsDoc:'<div>x</div>' }); openQuickChords(); });
  const fmaj = await page.evaluate(() => document.getElementById('qcPills').innerText);
  assert('F major: shows B♭ (not A#)', fmaj.includes('B♭') && !fmaj.includes('A#'));

  // ── Sharp key still uses sharps ──
  await page.evaluate(() => { _openSongObj({ id:'S3', title:'Z', key:'D major', lyricsDoc:'<div>x</div>' }); openQuickChords(); });
  const dmaj = await page.evaluate(() => document.getElementById('qcPills').innerText);
  assert('D major: shows sharps (F#m)', dmaj.includes('F#m') && !dmaj.includes('G♭'));

  // ── QC nav: no "Quick Chords" title; key pill centered + wide ──
  const nav = await page.evaluate(() => {
    const n = document.querySelector('#screen-qc .chord-nav');
    const pill = document.getElementById('qcKeyPill');
    return { hasTitle: /Quick Chords/.test(n.textContent), pillInCenter: !!n.querySelector('.nav-center #qcKeyPill'),
             pillW: pill.getBoundingClientRect().width };
  });
  assert('QC: "Quick Chords" title removed', !nav.hasTitle);
  assert('QC: key pill is centered (.nav-center)', nav.pillInCenter);
  assert('QC: key pill is wide (≥130px)', nav.pillW >= 130);

  // ── VIII octave column removed (7 diatonic columns) ──
  assert('QC: VIII octave column removed (7 columns)', (await page.$$('#qcPills .qc-col')).length === 7);

  // ── Header switch buttons ──
  const qcSwitch = await page.evaluate(() => { const b = document.querySelector('#screen-qc .nav-switch'); return b ? { text: b.textContent, onclick: b.getAttribute('onclick') } : null; });
  assert('QC: "Chord Search" button → Find a Chord', qcSwitch && /Chord Search/.test(qcSwitch.text) && /openFindChord/.test(qcSwitch.onclick));
  await page.evaluate(() => openFindChord());
  const fcNav = await page.evaluate(() => {
    const n = document.querySelector('#screen-fc .chord-nav'); const b = n.querySelector('.nav-switch');
    return { hasTitle: /Find a Chord/.test(n.textContent), switchText: b ? b.textContent : '', switchClick: b ? b.getAttribute('onclick') : '' };
  });
  assert('FC: "Find a Chord" title removed', !fcNav.hasTitle);
  assert('FC: "Quick Chords" button → Quick Chords', /Quick Chords/.test(fcNav.switchText) && /openQuickChords/.test(fcNav.switchClick));
  assert('switching FC→QC works', await page.evaluate(() => { openQuickChords(); return getComputedStyle(document.getElementById('screen-qc')).display !== 'none'; }));

  // ── Menu: slides from the TOP, trimmed items ──
  await page.evaluate(() => { _openSongObj({ id:'S4', title:'M', key:'C major', lyricsDoc:'<div>x</div>' }); openMenu(); });
  const menu = await page.evaluate(() => {
    const sheet = document.querySelector('#menuSheet .sheet');
    const inner = document.getElementById('menuSheetInner').innerText;
    return { top: getComputedStyle(sheet).top, rectTop: sheet.getBoundingClientRect().top, inner };
  });
  assert('menu sheet anchored to top (top:0)', menu.top === '0px');
  assert('menu open sits at top of screen', Math.abs(menu.rectTop) <= 2);
  assert('menu has Quick Chords + Find a Chord + Appearance', /Quick Chords/.test(menu.inner) && /Find a Chord/.test(menu.inner) && /Appearance/.test(menu.inner));
  assert('menu: "Song key" removed', !/Song key/.test(menu.inner));
  assert('menu: "All songs" removed', !/All songs/.test(menu.inner));

  // ── Strum still plays without error (offset applied) ──
  const playOk = await page.evaluate(() => { try { _playSynth([55,59,62,67], 'guitar'); return true; } catch(e){ return String(e); } });
  assert('strum playback (with offset) no error', playOk === true);

  // ── Find-a-Chord: selecting root + type auto-plays ──
  const autoplay = await page.evaluate(() => {
    openFindChord();
    let played = false; const orig = window.fcPlay; window.fcPlay = () => { played = true; return orig(); };
    document.getElementById('fcRoot').value = 'C'; document.getElementById('fcQual').value = '0'; fcSelectFromDropdown();
    window.fcPlay = orig; return played;
  });
  assert('FC: selecting root + type auto-plays the chord', autoplay === true);

  const fatal = errors.filter(e => !/permission|insufficient|FirebaseError|Failed to load resource|net::ERR|storage\//i.test(e));
  assert('no fatal JS errors', fatal.length === 0);
  console.log(results.join('\n'));
  if (fatal.length) console.log('\nFATAL:\n' + fatal.join('\n'));
  await browser.close(); srv.close();
  process.exit(results.some(r => r.startsWith('FAIL')) ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR:', e); process.exit(2); });
