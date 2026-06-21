// _verify_lite_1070.js  (Task 1: share state + id/link/snapshot helpers)
const { chromium } = require('playwright-core');
const http = require('http'); const fs = require('fs'); const path = require('path');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ROOT = __dirname;
let PASS = 0, FAIL = 0;
const ok = (c, m) => { if (c) { PASS++; console.log('PASS', m); } else { FAIL++; console.log('FAIL', m); } };

function serve() {
  return new Promise(res => {
    const s = http.createServer((req, rq) => {
      let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/lite-1.070.html';
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

  // ── Task 1: share id + link + snapshot helpers (no auth needed) ──
  const pgS = await ctx.newPage();
  await pgS.goto(`http://localhost:${port}/lite-1.070.html`, { waitUntil: 'domcontentloaded' });
  await pgS.waitForFunction(() => typeof window.shareNewId === 'function', { timeout: 10000 });
  const s1 = await pgS.evaluate(() => {
    const a = shareNewId(), b = shareNewId();
    const snap = _shareSnapshot(
      { id: 'T1', downloadUrl: 'https://x/y', duration: 12, mimeType: 'audio/mp3' },
      { id: 'S1', title: 'My Song', lyricsDoc: '<div>Hi</div>' });
    _shareId = 'ABC123';
    const link = shareLink();
    return {
      idLen: a.length, idsDiffer: a !== b, urlSafe: /^[A-Za-z0-9_-]+$/.test(a),
      snapOK: snap.takeId === 'T1' && snap.songId === 'S1' && snap.songTitle === 'My Song'
              && snap.lyricsDoc === '<div>Hi</div>' && snap.downloadUrl === 'https://x/y'
              && snap.duration === 12 && typeof snap.addedAt === 'number',
      linkOK: /\?share=ABC123$/.test(link),
    };
  });
  ok(s1.idLen >= 20, 'T1 shareNewId is >=20 chars');
  ok(s1.idsDiffer, 'T1 shareNewId is random (two differ)');
  ok(s1.urlSafe, 'T1 shareNewId is URL-safe');
  ok(s1.snapOK, 'T1 _shareSnapshot builds a correct entry');
  ok(s1.linkOK, 'T1 shareLink returns <origin><path>?share=<id>');

  console.log(`\n${PASS} PASS / ${FAIL} FAIL`);
  await browser.close(); srv.close();
  process.exit(FAIL ? 1 : 0);
})();
