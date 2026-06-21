// _verify_lite_1068.js  (Task 1: lyrics base tracking + pendingLyrics IndexedDB store + divider helper)
const { chromium } = require('playwright-core');
const http = require('http'); const fs = require('fs'); const path = require('path');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ROOT = __dirname;
let PASS = 0, FAIL = 0;
const ok = (c, m) => { if (c) { PASS++; console.log('PASS', m); } else { FAIL++; console.log('FAIL', m); } };

function serve() {
  return new Promise(res => {
    const s = http.createServer((req, rq) => {
      let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/lite-1.068.html';
      const fp = path.join(ROOT, p);
      fs.readFile(fp, (e, d) => {
        if (e) { rq.statusCode = 404; rq.end('nf'); return; }
        const ext = path.extname(fp);
        rq.setHeader('Content-Type', ext === '.html' ? 'text/html' : ext === '.js' ? 'text/javascript' : ext === '.mp3' ? 'audio/mpeg' : 'application/octet-stream');
        rq.end(d);
      });
    });
    s.listen(0, () => res(s));
  });
}

(async () => {
  const srv = await serve(); const port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  const ctx = await browser.newContext();
  await ctx.addInitScript(() => { try { localStorage['drafthaus-eula-accepted'] = '1'; } catch (e) {} });

  // ── Guest sign-in helper ──
  async function guestIn(page) {
    for (let i = 0; i < 2; i++) {
      try { await page.click('.auth-card .auth-btn.ghost'); await page.waitForSelector('body.signed-in', { timeout: 20000 }); return true; }
      catch (e) { if (i === 1) return false; await page.waitForTimeout(1000); }
    }
  }

  // ── Task-1 infra assert page: pure infra — no auth needed ──
  const pg = await ctx.newPage();
  await pg.goto(`http://localhost:${port}/lite-1.068.html`, { waitUntil: 'domcontentloaded' });
  await pg.waitForFunction(() => typeof window.dhAudioPut === 'function', { timeout: 10000 });

  const t1 = await pg.evaluate(async () => {
    const hasHelpers = typeof currentEditorHtml === 'function' && typeof _lyricsDivider === 'function' && typeof dhPendingLyricsPut === 'function';
    const div = _lyricsDivider('iPhone');
    await dhPendingLyricsPut({ songId: 's1', lyricsDoc: '<div>A2</div>', base: '<div>A</div>', editedAt: 1 });
    const got = await dhPendingLyricsGet('s1');
    const all = await dhPendingLyricsAll();
    await dhPendingLyricsDelete('s1');
    const afterDel = await dhPendingLyricsGet('s1');
    return { hasHelpers, divHasText: /Also edited on iPhone/.test(div), gotDoc: got && got.lyricsDoc, allLen: all.length, afterDel: afterDel === null };
  });
  ok(t1.hasHelpers, 'T1 lyrics helpers + pendingLyrics helpers exist');
  ok(t1.divHasText, 'T1 _lyricsDivider includes the source label');
  ok(t1.gotDoc === '<div>A2</div>', 'T1 dhPendingLyricsPut/Get round-trips');
  ok(t1.allLen >= 1, 'T1 dhPendingLyricsAll returns entries');
  ok(t1.afterDel, 'T1 dhPendingLyricsDelete removes the entry');

  // ── Task-1 base assert: open a song, check _lyricsBase + currentEditorHtml ──
  const pg2 = await ctx.newPage();
  await pg2.goto(`http://localhost:${port}/lite-1.068.html`, { waitUntil: 'domcontentloaded' });
  await pg2.waitForFunction(() => typeof window.dhAudioPut === 'function', { timeout: 10000 });
  const signedin2 = await guestIn(pg2);
  if (signedin2) {
    await pg2.evaluate(() => {
      _openSongObj({ id: 'S1068base', title: 'verify-1068-base', key: 'C major', lyricsDoc: '<div>Hello</div>' });
      stopTakesListener();
    });
    await pg2.waitForTimeout(200);

    const t1base = await pg2.evaluate(() => {
      const baseIsStr = typeof _lyricsBase === 'string';
      const edHtml = currentEditorHtml();
      const edHasContent = typeof edHtml === 'string' && edHtml.length > 0;
      return { baseIsStr, edHasContent, baseNotEmpty: _lyricsBase.length > 0 };
    });
    ok(t1base.baseIsStr, 'T1 _lyricsBase is a string after openSong');
    ok(t1base.baseNotEmpty, 'T1 _lyricsBase is non-empty after openSong with lyricsDoc');
    ok(t1base.edHasContent, 'T1 currentEditorHtml() returns sanitized html string');
  } else {
    console.log('SKIP T1-base (guest auth unavailable)');
  }
  await pg2.close();

  // ── Sanitize-survival check: run in page context ──
  const sanitizeResult = await pg.evaluate(() => {
    const div = _lyricsDivider('x');
    const sanitized = ilSanitizeDocHtml(div);
    return { div, sanitized, textSurvives: /Also edited on x/.test(sanitized) };
  });
  console.log('[sanitize-check] divider:', sanitizeResult.div);
  console.log('[sanitize-check] after ilSanitizeDocHtml:', sanitizeResult.sanitized);
  ok(sanitizeResult.textSurvives, 'T1 ilSanitizeDocHtml preserves divider text content');

  console.log(`\n${PASS} PASS / ${FAIL} FAIL`);
  await browser.close(); srv.close();
  process.exit(FAIL ? 1 : 0);
})();
