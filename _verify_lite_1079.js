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

  // ── A1: nothing saved → both capture sites request exactly the raw trio ──
  await page.evaluate(() => { window._gumCalls.length = 0; _startCountdown(); });
  await page.waitForTimeout(250);
  await page.evaluate(() => _cancelCountdown());
  const a1 = await page.evaluate(() => window._gumCalls);
  ok(a1.length === 1 && JSON.stringify(a1[0]) === RAW,
    'A1 no saved device: countdown pre-acquire sends raw trio, no deviceId');

  // ── A2: saved device → deviceId {ideal} rides alongside the raw trio ──
  const a2 = await page.evaluate(() => {
    localStorage.setItem('dh-lite-input-device', JSON.stringify({ id: 'FAKEDEV123', label: 'Test Interface' }));
    return recAudioConstraints();
  });
  ok(a2.echoCancellation === false && a2.noiseSuppression === false && a2.autoGainControl === false
     && a2.deviceId && a2.deviceId.ideal === 'FAKEDEV123',
    'A2 saved device: recAudioConstraints has raw trio + deviceId ideal');

  // ── A3: startRecord uses the helper + mismatch toast fires once per session ──
  await page.evaluate(() => {
    window._gumCalls.length = 0; window._uploads = [];
    window.uploadTake = (blob, mime, dur) => { window._uploads.push({ size: blob.size, mime, dur }); };
    startRecord();
  });
  await page.waitForTimeout(1200);
  const a3toast = await page.evaluate(() => {
    const t = document.getElementById('toast');
    return { shown: t.classList.contains('show'), text: t.textContent };
  });
  await page.evaluate(() => stopRecord());
  await page.waitForTimeout(600);
  const a3 = await page.evaluate(() => ({ gum: window._gumCalls, up: window._uploads }));
  ok(a3.gum.length === 1 && a3.gum[0].audio && a3.gum[0].audio.deviceId && a3.gum[0].audio.deviceId.ideal === 'FAKEDEV123'
     && a3.gum[0].audio.echoCancellation === false,
    'A3a startRecord requests the saved deviceId with the raw trio');
  ok(a3toast.shown && /Saved input not found/.test(a3toast.text),
    'A3b fake device ≠ saved id → mismatch toast shown');
  ok(a3.up.length === 1 && a3.up[0].size > 0,
    'A3c recording still completes on fallback (real ~1s capture reaches uploadTake)');

  // A4: second record → no second toast (once per session)
  await page.evaluate(() => {
    const t = document.getElementById('toast'); t.classList.remove('show'); t.textContent = '';
    startRecord();
  });
  await page.waitForTimeout(700);
  const a4 = await page.evaluate(() => document.getElementById('toast').textContent);
  await page.evaluate(() => stopRecord());
  await page.waitForTimeout(400);
  ok(!/Saved input not found/.test(a4), 'A4 mismatch toast is once-per-session');
  await page.evaluate(() => localStorage.removeItem('dh-lite-input-device'));

  console.log(`\n${PASS}/${PASS + FAIL} passed`);
  await browser.close(); srv.close();
  process.exit(FAIL ? 1 : 0);
})();
