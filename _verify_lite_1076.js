// _verify_lite_1076.js — lite-1.076: lyrics selection format toolbar (color/size/B·I·U)
const { chromium } = require('playwright-core');
const http = require('http'); const fs = require('fs'); const path = require('path');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ROOT = __dirname;
let PASS = 0, FAIL = 0;
const ok = (c, m) => { if (c) { PASS++; console.log('PASS', m); } else { FAIL++; console.log('FAIL', m); } };

function serve() {
  return new Promise(res => {
    const s = http.createServer((req, rq) => {
      let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/lite-1.076.html';
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

async function boot(browser, port, viewport) {
  const ctx = await browser.newContext({ viewport });
  await ctx.addInitScript(() => { try { localStorage['drafthaus-eula-accepted'] = '1'; } catch (e) {} });
  const page = await ctx.newPage();
  await page.goto(`http://localhost:${port}/lite-1.076.html`, { waitUntil: 'domcontentloaded' });
  await page.click('.auth-btn.ghost');
  await page.waitForSelector('body.signed-in', { timeout: 15000 });
  return page;
}

// Open a synthetic song with known lyrics (no network/Firestore needed).
async function seedSong(page) {
  await page.evaluate(() => {
    window._openSongObj({ id: 'TESTSONG', ownerId: 'guest', title: 'Fmt Song', key: '', lyricsDoc: '<div>hello world lyrics</div>' });
  });
  await page.waitForTimeout(300);
}

// Select the full contents of the lyrics editor (fires selectionchange).
const selectAllLyrics = (page) => page.evaluate(() => {
  const ed = document.getElementById('lyricsEditor'); ed.focus();
  const r = document.createRange(); r.selectNodeContents(ed);
  const s = getSelection(); s.removeAllRanges(); s.addRange(r);
});

(async () => {
  const srv = await serve(); const port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await boot(browser, port, { width: 390, height: 780 });   // mobile-size
  await seedSong(page);

  // ── F0: sanity — song open, lyrics rendered ──
  ok(await page.evaluate(() => document.getElementById('lyricsEditor').textContent.includes('hello world')),
    'F0 sanity: seeded lyrics render in the editor');

  // ── F1: popover shows on selection, hides on collapse, suppressed in Chordify, theme token flips ──
  {
    ok(await page.evaluate(() => !document.querySelector('#fmtBar.open')), 'F1 no selection → no format bar');
    await selectAllLyrics(page);
    await page.waitForTimeout(300);
    ok(await page.evaluate(() => !!document.querySelector('#fmtBar.open')), 'F1 selection → format bar opens');
    const pos = await page.evaluate(() => {
      const b = document.getElementById('fmtBar').getBoundingClientRect();
      return b.left >= 8 && b.right <= innerWidth - 8 && b.top >= 8;
    });
    ok(pos, 'F1 bar positioned inside the viewport');
    await page.evaluate(() => getSelection().removeAllRanges());
    await page.waitForTimeout(300);
    ok(await page.evaluate(() => !document.querySelector('#fmtBar.open')), 'F1 collapse → bar hides');
    await page.evaluate(() => toggleChordsMode(true));
    await selectAllLyrics(page);
    await page.waitForTimeout(300);
    ok(await page.evaluate(() => !document.querySelector('#fmtBar.open')), 'F1 Chordify mode → bar suppressed');
    await page.evaluate(() => { toggleChordsMode(false); getSelection().removeAllRanges(); });
    const tok = await page.evaluate(() => {
      const get = () => getComputedStyle(document.documentElement).getPropertyValue('--fmtText').trim();
      const light = get();
      document.documentElement.classList.add('dark'); const dark = get();
      document.documentElement.classList.remove('dark');
      return { light, dark };
    });
    ok(tok.light === '#111111' && tok.dark === '#ffffff', 'F1 --fmtText token: #111111 light / #ffffff dark');
  }

  // ── F2: B/I/U apply, reflect state, toggle off ──
  {
    await selectAllLyrics(page);
    await page.waitForTimeout(300);
    await page.click('#fmtBar [data-cmd="bold"]');
    ok(await page.evaluate(() => /<(b|strong)\b/i.test(document.getElementById('lyricsEditor').innerHTML)),
      'F2 bold applies to the selection');
    ok(await page.evaluate(() => document.querySelector('#fmtBar [data-cmd="bold"]').classList.contains('on')),
      'F2 bold button shows active state');
    await page.click('#fmtBar [data-cmd="italic"]');
    await page.click('#fmtBar [data-cmd="underline"]');
    ok(await page.evaluate(() => {
      const h = document.getElementById('lyricsEditor').innerHTML;
      return /<(i|em)\b/i.test(h) && /<u\b/i.test(h);
    }), 'F2 italic + underline apply');
    await page.click('#fmtBar [data-cmd="bold"]');   // toggle bold back off
    ok(await page.evaluate(() => !/<(b|strong)\b/i.test(document.getElementById('lyricsEditor').innerHTML)),
      'F2 bold toggles off');
    ok(await page.evaluate(() => {
      // formatting survives the sanitizer round-trip
      const ed = document.getElementById('lyricsEditor');
      const clean = ilSanitizeDocHtml(ed.innerHTML);
      return /<(i|em)\b/i.test(clean) && /<u\b/i.test(clean);
    }), 'F2 B/I/U survive ilSanitizeDocHtml');
    await page.evaluate(() => { document.execCommand('italic'); document.execCommand('underline'); getSelection().removeAllRanges(); });
  }

  // ── [test blocks F1–F5: appended by tasks 2–5 above this line] ──

  console.log(`\n${PASS}/${PASS + FAIL} passed, ${FAIL} failed`);
  await browser.close(); srv.close();
  process.exit(FAIL ? 1 : 0);
})();
