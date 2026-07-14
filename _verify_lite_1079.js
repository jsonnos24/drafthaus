// _verify_lite_1079.js — lite-1.079: audio input device picker (rail popover + level meter)
const { chromium } = require('playwright-core');
const http = require('http'); const fs = require('fs'); const path = require('path');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ROOT = __dirname;
let PASS = 0, FAIL = 0;
const ok = (c, m) => { if (c) { PASS++; console.log('PASS', m); } else { FAIL++; console.log('FAIL', m); } };

function serve() {
  return new Promise(res => {
    const s = http.createServer((req, rq) => {
      let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/lite-1.079.html';
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

const RAW = JSON.stringify({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });

(async () => {
  const srv = await serve(); const port = srv.address().port;
  const browser = await chromium.launch({
    executablePath: CHROME, headless: true,
    args: ['--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
  });
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 } });
  await ctx.addInitScript(() => {
    try { localStorage['drafthaus-eula-accepted'] = '1'; } catch (e) {}
    // Spy getUserMedia constraints (delegates to the fake device so recording really runs).
    const orig = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    window._gumCalls = [];
    navigator.mediaDevices.getUserMedia = (c) => {
      try { window._gumCalls.push(JSON.parse(JSON.stringify(c))); } catch (e) {}
      return orig(c);
    };
  });
  const page = await ctx.newPage();
  await page.goto(`http://localhost:${port}/lite-1.079.html`, { waitUntil: 'domcontentloaded' });
  await page.click('.auth-btn.ghost');
  await page.waitForSelector('body.signed-in', { timeout: 15000 });
  await page.evaluate(s => { window._openSongObj(s); },
    { id: 'TESTSONG', ownerId: 'guest', title: 'Rec Song', key: '', lyricsDoc: '<div>x</div>' });
  await page.waitForTimeout(300);

  // ── S0: sanity ──
  ok(await page.evaluate(() => !!document.getElementById('takesList') && document.body.classList.contains('signed-in')),
    'S0 boot: signed in, song open');

  // (tests appended by later tasks go here)

  console.log(`\n${PASS}/${PASS + FAIL} passed`);
  await browser.close(); srv.close();
  process.exit(FAIL ? 1 : 0);
})();
