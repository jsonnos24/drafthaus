// _verify_lite_1078.js — lite-1.078: music-grade capture (raw mic constraints + explicit bitrates)
const { chromium } = require('playwright-core');
const http = require('http'); const fs = require('fs'); const path = require('path');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ROOT = __dirname;
let PASS = 0, FAIL = 0;
const ok = (c, m) => { if (c) { PASS++; console.log('PASS', m); } else { FAIL++; console.log('FAIL', m); } };

function serve() {
  return new Promise(res => {
    const s = http.createServer((req, rq) => {
      let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/lite-1.078.html';
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
    // Spy MediaRecorder constructor options (returns a real recorder).
    const OrigMR = window.MediaRecorder;
    window._mrOpts = [];
    window.MediaRecorder = function (stream, opts) { window._mrOpts.push(opts || null); return new OrigMR(stream, opts); };
    window.MediaRecorder.isTypeSupported = (t) => OrigMR.isTypeSupported(t);
  });
  const page = await ctx.newPage();
  await page.goto(`http://localhost:${port}/lite-1.078.html`, { waitUntil: 'domcontentloaded' });
  await page.click('.auth-btn.ghost');
  await page.waitForSelector('body.signed-in', { timeout: 15000 });
  await page.evaluate(s => { window._openSongObj(s); },
    { id: 'TESTSONG', ownerId: 'guest', title: 'Rec Song', key: '', lyricsDoc: '<div>x</div>' });
  await page.waitForTimeout(300);

  // ── S0: sanity ──
  ok(await page.evaluate(() => !!document.getElementById('takesList') && document.body.classList.contains('signed-in')),
    'S0 boot: signed in, song open');

  // ── A1: countdown pre-acquire requests raw music-grade constraints ──
  await page.evaluate(() => { window._gumCalls.length = 0; _startCountdown(); });
  await page.waitForTimeout(250);
  await page.evaluate(() => _cancelCountdown());
  const a1 = await page.evaluate(() => window._gumCalls);
  ok(a1.length === 1 && JSON.stringify(a1[0]) === RAW,
    'A1 countdown pre-acquire: EC/NS/AGC all requested off');

  // ── A2 + B + D: startRecord fallback constraints, recorder options, real capture ──
  await page.evaluate(() => {
    window._gumCalls.length = 0; window._mrOpts.length = 0; window._uploads = [];
    // Top-level function → window prop; swallow the upload (Firestore not needed here).
    window.uploadTake = (blob, mime, dur) => { window._uploads.push({ size: blob.size, mime, dur }); };
    startRecord();
  });
  await page.waitForTimeout(1200);
  await page.evaluate(() => stopRecord());
  await page.waitForTimeout(600);
  const st = await page.evaluate(() => ({ gum: window._gumCalls, mr: window._mrOpts, up: window._uploads }));
  ok(st.gum.length === 1 && JSON.stringify(st.gum[0]) === RAW,
    'A2 startRecord fallback: EC/NS/AGC all requested off');
  ok(st.mr.length === 1 && !!st.mr[0] && st.mr[0].audioBitsPerSecond === 128000 && /webm|mp4/.test(st.mr[0].mimeType || ''),
    'B MediaRecorder gets audioBitsPerSecond 128000 alongside the picked mimeType');
  ok(st.up.length === 1 && st.up[0].size > 0 && st.up[0].dur > 0.9 && st.up[0].dur < 3,
    'D real ~1s capture produces a non-empty blob and reaches uploadTake');

  // ── C: _encodeMp3 encodes at 192 kbps (stubbed lamejs, real AudioBuffer) ──
  const mp3 = await page.evaluate(() => {
    window.lamejs = { Mp3Encoder: function (ch, sr, kbps) {
      window._mp3Args = { ch, sr, kbps };
      this.encodeBuffer = () => []; this.flush = () => [];
    } };
    const ac = new (window.AudioContext || window.webkitAudioContext)();
    const buf = ac.createBuffer(1, 4410, 44100);
    _encodeMp3(buf);
    return window._mp3Args;
  });
  ok(!!mp3 && mp3.ch === 1 && mp3.sr === 44100 && mp3.kbps === 192,
    'C _encodeMp3 constructs Mp3Encoder at 192 kbps');

  console.log(`\n${PASS}/${PASS + FAIL} passed`);
  await browser.close(); srv.close();
  process.exit(FAIL ? 1 : 0);
})();
