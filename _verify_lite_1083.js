// _verify_lite_1083.js — lite-1.083: +CHORDS rename, mobile scratch pad, lyric-color bleed fix
const { chromium } = require('playwright-core');
const http = require('http'); const fs = require('fs'); const path = require('path');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ROOT = __dirname;
let PASS = 0, FAIL = 0;
const ok = (c, m) => { if (c) { PASS++; console.log('PASS', m); } else { FAIL++; console.log('FAIL', m); } };

function serve() {
  return new Promise(res => {
    const s = http.createServer((req, rq) => {
      let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/lite-1.083.html';
      const fp = path.join(ROOT, p);
      fs.readFile(fp, (e, d) => {
        if (e) { rq.statusCode = 404; rq.end('nf'); return; }
        const ext = path.extname(fp);
        rq.setHeader('Content-Type', ext === '.html' ? 'text/html' : ext === '.js' ? 'text/javascript' : 'application/octet-stream');
        rq.end(d);
      });
    });
    s.listen(0, () => res(s));
  });
}

// Boot a page to the signed-in song screen: guest sign-in, then createSong()
// (fire-and-forget Firestore write — works in guest mode; permission noise is expected).
async function boot(ctx, port) {
  const page = await ctx.newPage();
  await page.goto(`http://localhost:${port}/lite-1.083.html`, { waitUntil: 'domcontentloaded' });
  await page.click('.auth-btn.ghost');
  await page.waitForSelector('body.signed-in', { timeout: 15000 });
  await page.evaluate(() => createSong());
  await page.waitForSelector('#screen-song.active', { timeout: 5000 });
  return page;
}

(async () => {
  const src = fs.readFileSync(path.join(ROOT, 'lite-1.083.html'), 'utf8');

  // ── CH: +CHORDS rename ──
  ok(!src.includes('C<br>H<br>O<br>R<br>D<br>I<br>F<br>Y'), 'CH1 source: stacked CHORDIFY label gone');
  ok(src.includes('aria-label="Add chords">+<br>C<br>H<br>O<br>R<br>D<br>S</button>'), 'CH2 source: +CHORDS label with aria-label "Add chords"');
  ok(src.includes('title="Add chords by tapping words"'), 'CH3 source: tooltip unchanged');

  const srv = await serve(); const port = srv.address().port;
  const browser = await chromium.launch({
    executablePath: CHROME, headless: true,
    args: ['--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
  });

  const desk = await browser.newContext({ viewport: { width: 1200, height: 800 } });
  await desk.addInitScript(() => { try { localStorage['drafthaus-eula-accepted'] = '1'; } catch (e) {} });
  const dpage = await boot(desk, port);

  const ch4 = await dpage.evaluate(() => {
    const btn = document.getElementById('chordsModeBtn');
    const label = btn.textContent;                    // <br>-separated letters concatenate
    toggleChordsMode();                                // enter chords mode
    const onActive = btn.classList.contains('active');
    const edOn = document.getElementById('lyricsEditor').classList.contains('chords-mode');
    toggleChordsMode(false);                           // force off (same call _openSongObj uses)
    const offActive = btn.classList.contains('active');
    return { label, onActive, edOn, offActive };
  });
  ok(ch4.label === '+CHORDS', `CH4 button renders "+CHORDS" (got "${ch4.label}")`);
  ok(ch4.onActive && ch4.edOn && !ch4.offActive, 'CH5 toggleChordsMode logic untouched (active class + editor chords-mode)');

  // === END TESTS ===
  console.log(`\n${PASS}/${PASS + FAIL} passed`);
  await browser.close(); srv.close();
  process.exit(FAIL ? 1 : 0);
})();
