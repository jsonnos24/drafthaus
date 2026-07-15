// _verify_lite_1083.js — lite-1.083: +CHORDS rename, mobile scratch pad (color-bleed fix deferred to 1.084 — not reproduced)
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

  // ── D: desktop scratch pad regression (unchanged behavior) ──
  const d1 = await dpage.evaluate(() => {
    const pad = document.getElementById('scratchPad'), sb = document.querySelector('.song-body');
    const pr = pad.getBoundingClientRect(), sr = sb.getBoundingClientRect();
    return {
      hidden: pad.hidden,
      w: pr.width, h: pr.height,
      rightGap: sr.right - pr.right,                       // expect 50% of song-body + 14
      halfPlus14: sr.width / 2 + 14,
      fs: getComputedStyle(document.getElementById('scratchText')).fontSize,
    };
  });
  ok(!d1.hidden, 'D1 desktop: pad default-open with no stored key');
  ok(Math.abs(d1.w - 280) < 2 && Math.abs(d1.h - 320) < 2, `D2 desktop: 280x320 unchanged (got ${d1.w}x${d1.h})`);
  ok(Math.abs(d1.rightGap - d1.halfPlus14) < 2, 'D3 desktop: position right:calc(50% + 14px) unchanged');
  ok(d1.fs === '14px', 'D4 desktop: textarea font 14px unchanged');

  // ── M: mobile scratch pad ──
  const mob = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await mob.addInitScript(() => { try { localStorage['drafthaus-eula-accepted'] = '1'; } catch (e) {} });
  const mpage = await boot(mob, port);

  const m1 = await mpage.evaluate(() => ({
    btnShown: getComputedStyle(document.getElementById('scratchBtn')).display !== 'none',
    inputHidden: getComputedStyle(document.getElementById('inputBtn')).display === 'none',
    padHidden: document.getElementById('scratchPad').hidden,
    btnOn: document.getElementById('scratchBtn').classList.contains('on'),
  }));
  ok(m1.btnShown, 'M1 mobile: scratch rail button visible');
  ok(m1.inputHidden, 'M2 mobile: input-device button still hidden');
  ok(m1.padHidden && !m1.btnOn, 'M3 mobile: pad default-CLOSED with no stored key');

  await mpage.evaluate(() => toggleScratch());
  const m4 = await mpage.evaluate(() => {
    const pad = document.getElementById('scratchPad'), sb = document.querySelector('.song-body');
    const pr = pad.getBoundingClientRect(), sr = sb.getBoundingClientRect();
    return {
      hidden: pad.hidden, stored: localStorage.getItem('dh-lite-scratch-open'),
      w: pr.width, h: pr.height, rightGap: sr.right - pr.right,
      fs: getComputedStyle(document.getElementById('scratchText')).fontSize,
    };
  });
  ok(!m4.hidden && m4.stored === '1', 'M4 mobile: toggle opens pad and persists open state');
  ok(Math.abs(m4.w - 273) < 2, `M5 mobile: width min(280px,70vw) => 273 on 390w (got ${m4.w})`);
  ok(Math.abs(m4.h - 220) < 2, `M6 mobile: default height 220 (got ${m4.h})`);
  ok(Math.abs(m4.rightGap - 66) < 2, `M7 mobile: anchored 66px from song-body right — 14px clear of the 52px rail (got ${m4.rightGap})`);
  ok(m4.fs === '16px', 'M8 mobile: textarea font 16px (no iOS focus-zoom)');

  const m9 = await mpage.evaluate(async () => {
    const ta = document.getElementById('scratchText');
    ta.value = 'riff idea: Em -> C'; scratchInput();
    await new Promise(r => setTimeout(r, 750));          // > 600ms debounce
    return { model: _currentSong.scratch, saved: _scratchLastSaved };
  });
  ok(m9.model === 'riff idea: Em -> C' && m9.saved === 'riff idea: Em -> C', 'M9 mobile: typing flows through scratchInput -> flush (song.scratch path unchanged)');

  const m10 = await mpage.evaluate(() => {
    toggleScratch();                                      // close -> stores '0'
    scratchApply({ scratch: 'from another song' });       // re-entering a song
    return {
      hidden: document.getElementById('scratchPad').hidden,
      text: document.getElementById('scratchText').value,
      stored: localStorage.getItem('dh-lite-scratch-open'),
    };
  });
  ok(m10.hidden && m10.stored === '0' && m10.text === 'from another song', 'M10 mobile: stored closed-state wins over default; scratch text loads');

  // === END TESTS ===
  console.log(`\n${PASS}/${PASS + FAIL} passed`);
  await browser.close(); srv.close();
  process.exit(FAIL ? 1 : 0);
})();
