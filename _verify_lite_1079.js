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

  // ── B: input picker popover ──
  await page.evaluate(() => {
    navigator.mediaDevices.enumerateDevices = async () => ([
      { kind: 'audioinput', deviceId: 'default', label: 'Default - MacBook Pro Microphone' },
      { kind: 'audioinput', deviceId: 'MIC1', label: 'MacBook Pro Microphone' },
      { kind: 'audioinput', deviceId: 'IFACE4', label: 'Scarlett 4i4 USB' },
      { kind: 'videoinput', deviceId: 'CAM1', label: 'FaceTime Camera' },
    ]);
    openInputPicker(document.getElementById('inputBtn'));
  });
  await page.waitForTimeout(400);
  const b1 = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('#inputPicker .tp-row .tp-name')].map(n => n.textContent);
    const checks = [...document.querySelectorAll('#inputPicker .tp-row .tp-check')].map(n => n.textContent.trim());
    return { rows, checks };
  });
  ok(b1.rows.length === 3 && b1.rows[0] === 'System default' && b1.rows[1] === 'MacBook Pro Microphone' && b1.rows[2] === 'Scarlett 4i4 USB',
    'B1 popover lists System default first, audio inputs only, "default" pseudo-device filtered');
  ok(b1.checks[0] === '✓' && b1.checks[1] === '' && b1.checks[2] === '',
    'B2 nothing saved → System default checked');

  // B3: selecting the interface persists it and re-renders with the check moved
  await page.evaluate(() => inputPickerSelect('IFACE4', 'Scarlett 4i4 USB'));
  await page.waitForTimeout(300);
  const b3 = await page.evaluate(() => ({
    saved: JSON.parse(localStorage.getItem('dh-lite-input-device') || 'null'),
    checks: [...document.querySelectorAll('#inputPicker .tp-row .tp-check')].map(n => n.textContent.trim()),
  }));
  ok(b3.saved && b3.saved.id === 'IFACE4' && b3.saved.label === 'Scarlett 4i4 USB' && b3.checks[2] === '✓' && b3.checks[0] === '',
    'B3 selecting a device persists {id,label} and moves the checkmark');

  // B4: close removes the popover; System default clears the key
  await page.evaluate(() => { closeInputPicker(); });
  const b4gone = await page.evaluate(() => !document.getElementById('inputPicker'));
  await page.evaluate(async () => { openInputPicker(document.getElementById('inputBtn')); });
  await page.waitForTimeout(300);
  await page.evaluate(() => inputPickerSelect(null, null));
  const b4 = await page.evaluate(() => localStorage.getItem('dh-lite-input-device'));
  await page.evaluate(() => closeInputPicker());
  ok(b4gone && b4 === null, 'B4 close tears down popover; System default clears the saved key');

  // B5: rail button desktop-only
  const b5desk = await page.evaluate(() => getComputedStyle(document.getElementById('inputBtn')).display !== 'none');
  await page.setViewportSize({ width: 375, height: 700 });
  await page.waitForTimeout(200);
  const b5mob = await page.evaluate(() => getComputedStyle(document.getElementById('inputBtn')).display === 'none');
  await page.setViewportSize({ width: 1200, height: 800 });
  await page.waitForTimeout(200);
  ok(b5desk && b5mob, 'B5 #inputBtn visible on desktop, hidden under 768px');

  console.log(`\n${PASS}/${PASS + FAIL} passed`);
  await browser.close(); srv.close();
  process.exit(FAIL ? 1 : 0);
})();
