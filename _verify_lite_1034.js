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

  // ── Bug 4: auth gating ──
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 800 }, hasTouch: true, isMobile: true });
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push('PAGEERROR(auth): ' + e.message));
    await page.goto(base, { waitUntil: 'load' });

    // Fresh "Continue as guest" tap → enters the app (real choice this session).
    await page.click('.auth-btn.ghost');
    await page.waitForSelector('body.signed-in', { timeout: 15000 });
    assert('bug4: fresh guest choice enters the app', await page.evaluate(() => document.body.classList.contains('signed-in')));

    // Simulate a RETURNING visit: guest session persists (Firebase IndexedDB) but the
    // per-session "guest chosen" flag is gone. Should show the login landing, not the app.
    await page.evaluate(() => { try { sessionStorage.clear(); } catch(e){} });
    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(1500); // let onAuthStateChanged resolve the persisted anon user
    assert('bug4: resumed guest (no session flag) shows login landing', await page.evaluate(() =>
      !document.body.classList.contains('signed-in') && getComputedStyle(document.getElementById('landing')).display !== 'none'));
    await ctx.close();
  }

  // ── Bug 3: double-space-period mitigations wired ──
  {
    const page = await (await browser.newContext({ viewport: { width: 390, height: 800 }, hasTouch: true, isMobile: true })).newPage();
    page.on('pageerror', e => errors.push('PAGEERROR(bug3): ' + e.message));
    await page.goto(base, { waitUntil: 'load' });
    await openGuestSong(page);
    assert('bug3: editor disables autocorrect/autocapitalize', await page.evaluate(() => {
      const ed = document.getElementById('lyricsEditor');
      return ed.getAttribute('autocorrect') === 'off' && ed.getAttribute('autocapitalize') === 'off';
    }));
    assert('bug3: a ". " smart-punctuation beforeinput is cancelled to stay two spaces', await page.evaluate(() => {
      const ed = document.getElementById('lyricsEditor'); ed.focus();
      ed.innerHTML = '<div>hi </div>'; // a trailing space already present
      const ev = new InputEvent('beforeinput', { inputType: 'insertText', data: '. ', cancelable: true, bubbles: true });
      const notCancelled = ed.dispatchEvent(ev); // returns false if preventDefault() was called
      return notCancelled === false;
    }));
  }

  // ── Chords render ABOVE the lyric line, taking zero advance width ──
  {
    const page = await (await browser.newContext({ viewport: { width: 390, height: 800 }, hasTouch: true, isMobile: true })).newPage();
    page.on('pageerror', e => errors.push('PAGEERROR(render): ' + e.message));
    await page.goto(base, { waitUntil: 'load' });
    await openGuestSong(page, '<div><span class="chord">G</span>walked the line</div>');
    assert('render: chord takes ~0 advance width in the lyric line', await page.evaluate(() =>
      document.querySelector('#lyricsEditor .chord').offsetWidth === 0));
    assert('render: chord label sits ABOVE the lyric baseline', await page.evaluate(() => {
      const ch = document.querySelector('#lyricsEditor .chord').getBoundingClientRect();
      // the lyric word after it
      const line = document.querySelector('#lyricsEditor div');
      const word = line.lastChild; // text node "walked the line"
      const r = document.createRange(); r.selectNodeContents(word);
      const lyr = r.getBoundingClientRect();
      return ch.top < lyr.top - 4; // chord is meaningfully higher than the words
    }));
  }

  // ── Bugs 1 & 2: discrete chord entry, caret never trapped in the span ──
  {
    const page = await (await browser.newContext({ viewport: { width: 390, height: 800 }, hasTouch: true, isMobile: true })).newPage();
    page.on('pageerror', e => errors.push('PAGEERROR(entry): ' + e.message));
    await page.goto(base, { waitUntil: 'load' });
    await openGuestSong(page, '<div>verse</div>');

    // Insert one chord at the caret, then type lyrics — typing must land OUTSIDE the chord.
    const r1 = await page.evaluate(() => {
      const ed = document.getElementById('lyricsEditor'); ed.focus();
      const sel = window.getSelection(); const r = document.createRange();
      r.selectNodeContents(ed.querySelector('div')); r.collapse(true); // caret at line start
      sel.removeAllRanges(); sel.addRange(r);
      document.dispatchEvent(new Event('selectionchange'));
      startChordEntry();
      document.getElementById('chordEntry').value = 'G'; commitChordEntry();
      document.execCommand('insertText', false, 'sing');
      const chords = ed.querySelectorAll('.chord');
      const typedNode = window.getSelection().anchorNode;
      const typedInChord = !!(typedNode && (typedNode.nodeType === 1 ? typedNode : typedNode.parentElement).closest('.chord'));
      return { count: chords.length, chordText: chords[0] && chords[0].textContent, typedInChord };
    });
    assert('bug1: chord entry creates exactly one .chord span', r1.count === 1 && r1.chordText === 'G');
    assert('bug1: text typed after a chord is NOT inside the chord span', r1.typedInChord === false);

    // Insert a second chord further along — must stay a separate span.
    const r2 = await page.evaluate(() => {
      const ed = document.getElementById('lyricsEditor');
      const sel = window.getSelection(); const r = document.createRange();
      r.selectNodeContents(ed.querySelector('div')); r.collapse(false); // caret at line end
      sel.removeAllRanges(); sel.addRange(r);
      document.dispatchEvent(new Event('selectionchange'));
      startChordEntry();
      document.getElementById('chordEntry').value = 'C'; commitChordEntry();
      return ed.querySelectorAll('.chord').length;
    });
    assert('bug2: a second chord is a separate span (2 total, not merged)', r2 === 2);

    // Stored form stays full-app compatible: inline <span class="chord">.
    assert('compat: saved lyricsDoc still uses <span class="chord">', await page.evaluate(() => {
      const ed = document.getElementById('lyricsEditor');
      return /<span class="chord">/.test(ilSanitizeDocHtml(ed.innerHTML));
    }));
  }

  // ── Reloaded (saved) chords are also atomic + still saved clean ──
  {
    const page = await (await browser.newContext({ viewport: { width: 390, height: 800 }, hasTouch: true, isMobile: true })).newPage();
    page.on('pageerror', e => errors.push('PAGEERROR(atomize): ' + e.message));
    await page.goto(base, { waitUntil: 'load' });
    await openGuestSong(page, '<div><span class="chord">G</span>walked the line</div>');
    assert('atomize: a loaded (saved) chord span is atomic (contenteditable=false)', await page.evaluate(() =>
      document.querySelector('#lyricsEditor .chord').isContentEditable === false));
    assert('atomize: save still strips contenteditable (stored stays <span class="chord">)', await page.evaluate(() => {
      const out = ilSanitizeDocHtml(document.getElementById('lyricsEditor').innerHTML);
      return /<span class="chord">/.test(out) && !/contenteditable/i.test(out);
    }));
  }

  const fatal = errors.filter(e => !/permission|insufficient|FirebaseError|Failed to load resource|net::ERR|storage\//i.test(e));
  assert('no fatal JS errors', fatal.length === 0);
  console.log(results.join('\n'));
  await browser.close(); srv.close();
  if (results.some(r => r.startsWith('FAIL'))) process.exit(1);
})();
