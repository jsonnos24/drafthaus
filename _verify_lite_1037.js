// lite-1.037: QC key selector moved out of the header to a centered row between fretboard + diatonic pills.
const { chromium } = require('playwright-core');
const path = require('path'); const http = require('http'); const fs = require('fs');
const BUILD = 'lite-1.037.html';
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
async function openGuestSong(page, lyricsDoc) {
  await page.click('.auth-btn.ghost');
  await page.waitForSelector('body.signed-in', { timeout: 15000 });
  await page.evaluate((doc) => {
    _openSongObj({ id: 'S', title: 'X', key: 'C major', lyricsDoc: doc });
    stopTakesListener();
  }, lyricsDoc || '<div>I walked the line</div>');
  await page.waitForTimeout(60);
}
// Return the viewport-center point of a substring inside the first editor line's last text node.
async function wordCenter(page, word) {
  return await page.evaluate((w) => {
    const line = document.querySelector('#lyricsEditor div');
    // find the text node containing the word
    let node = null, idx = -1;
    for (const n of line.childNodes) { if (n.nodeType === 3 && (idx = n.data.indexOf(w)) >= 0) { node = n; break; } }
    if (!node) return null;
    const r = document.createRange(); r.setStart(node, idx); r.setEnd(node, idx + w.length);
    const rect = r.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }, word);
}
(async () => {
  const { srv, port } = await startServer();
  const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
  const results = []; const assert = (n, c) => results.push((c ? 'PASS' : 'FAIL') + ' — ' + n);
  const errors = [];
  const base = `http://127.0.0.1:${port}/${BUILD}`;

  // ── Chords mode toggle ──
  {
    const page = await (await browser.newContext({ viewport: { width: 390, height: 800 }, hasTouch: true, isMobile: true })).newPage();
    page.on('pageerror', e => errors.push('PAGEERROR(toggle): ' + e.message));
    await page.goto(base, { waitUntil: 'load' });
    await openGuestSong(page, '<div>I walked the line</div>');
    assert('toggle: editor starts editable, not in chords-mode', await page.evaluate(() => {
      const ed = document.getElementById('lyricsEditor');
      return ed.getAttribute('contenteditable') === 'true' && !ed.classList.contains('chords-mode');
    }));
    await page.evaluate(() => toggleChordsMode());
    assert('toggle: chords mode makes editor non-editable + adds class + button active', await page.evaluate(() => {
      const ed = document.getElementById('lyricsEditor');
      return ed.getAttribute('contenteditable') === 'false' && ed.classList.contains('chords-mode')
        && document.getElementById('chordsModeBtn').classList.contains('active');
    }));
    await page.evaluate(() => toggleChordsMode());
    assert('toggle: toggling off restores editable + removes class', await page.evaluate(() => {
      const ed = document.getElementById('lyricsEditor');
      return ed.getAttribute('contenteditable') === 'true' && !ed.classList.contains('chords-mode');
    }));
  }

  // ── Tap a word: add / pre-fill / remove a chord ──
  {
    const page = await (await browser.newContext({ viewport: { width: 390, height: 800 }, hasTouch: true, isMobile: true })).newPage();
    page.on('pageerror', e => errors.push('PAGEERROR(tap): ' + e.message));
    await page.goto(base, { waitUntil: 'load' });
    await openGuestSong(page, '<div>I walked the line</div>');
    await page.evaluate(() => toggleChordsMode());

    const c1 = await wordCenter(page, 'walked');
    await page.mouse.click(c1.x, c1.y);
    assert('tap: chord field is shown after tapping a word', await page.evaluate(() =>
      getComputedStyle(document.getElementById('chordEntry')).display !== 'none'));
    await page.evaluate(() => { document.getElementById('chordEntry').value = 'G'; commitChordEntry(); });
    assert('tap: a chord span "G" now sits immediately before "walked"', await page.evaluate(() => {
      const spans = [...document.querySelectorAll('#lyricsEditor .chord')];
      if (spans.length !== 1 || spans[0].textContent !== 'G') return false;
      const next = spans[0].nextSibling;
      return next && next.nodeType === 3 && next.data.indexOf('walked') === 0;
    }));
    assert('tap: the chord renders ABOVE the baseline (zero advance width)', await page.evaluate(() =>
      document.querySelector('#lyricsEditor .chord').offsetWidth === 0));

    const c2 = await wordCenter(page, 'walked');
    await page.mouse.click(c2.x, c2.y);
    assert('tap: tapping a word with a chord pre-fills the field', await page.evaluate(() =>
      document.getElementById('chordEntry').value === 'G'));

    await page.evaluate(() => { document.getElementById('chordEntry').value = ''; commitChordEntry(); });
    assert('tap: empty submit removes the chord', await page.evaluate(() =>
      document.querySelectorAll('#lyricsEditor .chord').length === 0));
  }

  // ── Compatibility: stored form stays <span class="chord"> with no contenteditable ──
  {
    const page = await (await browser.newContext({ viewport: { width: 390, height: 800 }, hasTouch: true, isMobile: true })).newPage();
    page.on('pageerror', e => errors.push('PAGEERROR(compat): ' + e.message));
    await page.goto(base, { waitUntil: 'load' });
    await openGuestSong(page, '<div>I walked the line</div>');
    await page.evaluate(() => toggleChordsMode());
    const c = await wordCenter(page, 'line');
    await page.mouse.click(c.x, c.y);
    await page.evaluate(() => { document.getElementById('chordEntry').value = 'Cmaj7'; commitChordEntry(); });
    assert('compat: saved lyricsDoc keeps <span class="chord"> and strips contenteditable', await page.evaluate(() => {
      const out = ilSanitizeDocHtml(document.getElementById('lyricsEditor').innerHTML);
      return /<span class="chord">Cmaj7<\/span>/.test(out) && !/contenteditable/i.test(out);
    }));
  }

  // ── Old caret-entry API is gone ──
  {
    const page = await (await browser.newContext({ viewport: { width: 390, height: 800 }, hasTouch: true, isMobile: true })).newPage();
    await page.goto(base, { waitUntil: 'load' });
    assert('cleanup: old startChordEntry/_lyricCaretRange/cpEditChord are removed', await page.evaluate(() =>
      typeof window.startChordEntry === 'undefined' && typeof window._lyricCaretRange === 'undefined' && typeof window.cpEditChord === 'undefined'));
  }

  // ── Auto-capitalize the chord root: typing "am" yields "Am" ──
  {
    const page = await (await browser.newContext({ viewport: { width: 390, height: 800 }, hasTouch: true, isMobile: true })).newPage();
    page.on('pageerror', e => errors.push('PAGEERROR(cap): ' + e.message));
    await page.goto(base, { waitUntil: 'load' });
    await openGuestSong(page, '<div>I walked the line</div>');
    await page.evaluate(() => toggleChordsMode());
    const c = await wordCenter(page, 'walked');
    await page.mouse.click(c.x, c.y);
    await page.evaluate(() => { document.getElementById('chordEntry').value = 'am'; commitChordEntry(); });
    assert('cap: typing "am" stores "Am"', await page.evaluate(() => {
      const s = document.querySelector('#lyricsEditor .chord');
      return s && s.textContent === 'Am';
    }));
    assert('cap: quality case preserved ("cmaj7" → "Cmaj7")', await page.evaluate(() => {
      // remove the Am, add cmaj7 on the same word
      const w = document.querySelector('#lyricsEditor .chord'); if (w) { w.remove(); }
      _chordTarget = (function(){ const line = document.querySelector('#lyricsEditor div');
        let n=null,i=-1; for (const x of line.childNodes){ if(x.nodeType===3 && (i=x.data.indexOf('walked'))>=0){n=x;break;} }
        return n ? { node:n, wordStart:i, wordEnd:i+6, span:null, anchorRect:{left:0,right:0,top:0,bottom:0} } : null; })();
      document.getElementById('chordEntry').value = 'cmaj7'; commitChordEntry();
      const s = document.querySelector('#lyricsEditor .chord');
      return s && s.textContent === 'Cmaj7';
    }));
  }

  // ── QC key selector: out of the header, centered between fretboard and diatonic pills ──
  {
    const page = await (await browser.newContext({ viewport: { width: 390, height: 800 }, hasTouch: true, isMobile: true })).newPage();
    page.on('pageerror', e => errors.push('PAGEERROR(qckey): ' + e.message));
    await page.goto(base, { waitUntil: 'load' });
    await openGuestSong(page, '<div>x</div>');
    await page.evaluate(() => openQuickChords());
    await page.waitForTimeout(60);
    assert('qckey: key pill is NOT inside the header anymore', await page.evaluate(() =>
      !document.querySelector('#screen-qc .chord-nav #qcKeyPill') && !!document.getElementById('qcKeyPill')));
    assert('qckey: pill sits between the fretboard (fb-card) and the diatonic pills (#qcPills)', await page.evaluate(() => {
      const qc = document.getElementById('screen-qc');
      const kids = [...qc.children];
      const fb = qc.querySelector('.fb-card'), row = qc.querySelector('.qc-key-row'), pills = document.getElementById('qcPills');
      return kids.indexOf(fb) < kids.indexOf(row) && kids.indexOf(row) < kids.indexOf(pills) && row.contains(document.getElementById('qcKeyPill'));
    }));
    assert('qckey: the key row is horizontally centered', await page.evaluate(() =>
      getComputedStyle(document.querySelector('.qc-key-row')).justifyContent === 'center'));
    assert('qckey: pill still updates its label + opens the picker', await page.evaluate(() => {
      const p = document.getElementById('qcKeyPill');
      return typeof qcOpenKeyPicker === 'function' && /major|minor/.test(p.textContent);
    }));
  }

  const fatal = errors.filter(e => !/permission|insufficient|FirebaseError|Failed to load resource|net::ERR|storage\//i.test(e));
  assert('no fatal JS errors', fatal.length === 0);
  console.log(results.join('\n'));
  await browser.close(); srv.close();
  if (results.some(r => r.startsWith('FAIL'))) process.exit(1);
})();
