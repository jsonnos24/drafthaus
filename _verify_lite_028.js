// lite-1.028: rich-text chord formatting + tap-a-chord overlay.
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
  const page = await (await browser.newContext({ viewport: { width: 1100, height: 800 } })).newPage();
  const errors = []; page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  await page.goto(`http://127.0.0.1:${port}/lite-1.028.html`, { waitUntil: 'load' });
  const results = []; const assert = (n, c) => results.push((c ? 'PASS' : 'FAIL') + ' — ' + n);

  await page.click('.auth-btn.ghost');
  await page.waitForSelector('body.signed-in', { timeout: 15000 });
  await page.evaluate(() => _openSongObj({ id: 'S', title: 'X', key: 'C major', lyricsDoc: '<div>Walking down the road</div>' }));

  // ── toolbar ──
  assert('lyrics toolbar present (Chord button)', await page.evaluate(() => !!document.querySelector('.lyr-toolbar .lyr-btn[onclick*="applyChordFormat"]')));

  // ── _normChordName (flats → sharps for the engine) ──
  const norm = await page.evaluate(() => ({ a: _normChordName('B♭m'), b: _normChordName('Bb'), c: _normChordName('C#m7'), d: _normChordName('C°'), e: _normChordName('Eb') }));
  assert('normalize B♭m → A#m', norm.a === 'A#m');
  assert('normalize Bb → A#, Eb → D#', norm.b === 'A#' && norm.e === 'D#');
  assert('normalize C#m7 stays sharp; C° → Cdim', norm.c === 'C#m7' && norm.d === 'Cdim');

  // ── applyChordFormat wraps a selection in span.chord (monospace + tappable) ──
  const wrapped = await page.evaluate(() => {
    const ed = document.getElementById('lyricsEditor');
    ed.innerHTML = '<div>C Walking</div>';
    const tn = ed.querySelector('div').firstChild;
    const r = document.createRange(); r.setStart(tn, 0); r.setEnd(tn, 1);
    const s = getSelection(); s.removeAllRanges(); s.addRange(r);
    applyChordFormat();
    const span = ed.querySelector('.chord');
    return { has: !!span, text: span && span.textContent, mono: span && /mono/i.test(getComputedStyle(span).fontFamily) };
  });
  assert('Chord button wraps selection in span.chord', wrapped.has && wrapped.text === 'C');
  assert('chord span renders monospace', wrapped.mono);

  // chord spans survive the lyrics sanitizer (persist in lyricsDoc)
  const persists = await page.evaluate(() => ilSanitizeDocHtml('<div><span class="chord">G</span> word</div>').includes('class="chord"'));
  assert('chord spans persist through the sanitizer (saved in lyricsDoc)', persists);

  // ── Clicking a chord opens the overlay with a fretboard ──
  const clicked = await page.evaluate(() => {
    const ed = document.getElementById('lyricsEditor');
    ed.innerHTML = '<div><span class="chord">Am</span> something</div>';
    ed.querySelector('.chord').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return {
      open: document.getElementById('chordPop').classList.contains('open'),
      name: document.getElementById('cpName').textContent,
      hasNeck: document.getElementById('cpNeck').innerHTML.includes('<svg'),
      playShown: getComputedStyle(document.getElementById('cpPlay')).display !== 'none',
    };
  });
  assert('clicking a chord opens the overlay', clicked.open);
  assert('overlay shows the chord name', clicked.name === 'Am');
  assert('overlay renders the fretboard', clicked.hasNeck);
  assert('overlay shows a Play button', clicked.playShown);

  // instrument toggle + play (no throw) + flat chord
  await page.evaluate(() => cpSetInstrument('ukulele'));
  assert('overlay uke toggle re-renders neck', await page.evaluate(() => document.querySelector('#cpSeg button[data-inst=ukulele]').classList.contains('on') && document.getElementById('cpNeck').innerHTML.includes('<svg')));
  assert('overlay Play does not throw', await page.evaluate(() => { try { cpPlay(); return true; } catch (e) { return false; } }));
  const flat = await page.evaluate(() => { openChordPop('B♭m', null, true); return { shown: document.getElementById('cpName').textContent, neck: document.getElementById('cpNeck').innerHTML.includes('<svg') }; });
  assert('flat-named chord (B♭m) shows + renders via engine', flat.shown === 'B♭m' && flat.neck);

  // unrecognized monospace text → "Not a recognized chord", no play
  const bad = await page.evaluate(() => { openChordPop('Verse', null, true); return { na: document.getElementById('cpNeck').innerText.includes('Not a recognized'), play: getComputedStyle(document.getElementById('cpPlay')).display }; });
  assert('non-chord text shows "not a chord" + hides Play', bad.na && bad.play === 'none');

  // close
  await page.evaluate(() => closeChordPop());
  assert('overlay closes', await page.evaluate(() => !document.getElementById('chordPop').classList.contains('open')));

  const fatal = errors.filter(e => !/permission|insufficient|FirebaseError|Failed to load resource|net::ERR|storage\//i.test(e));
  assert('no fatal JS errors', fatal.length === 0);
  console.log(results.join('\n'));
  if (fatal.length) console.log('\nFATAL:\n' + fatal.join('\n'));
  await browser.close(); srv.close();
  process.exit(results.some(r => r.startsWith('FAIL')) ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR:', e); process.exit(2); });
