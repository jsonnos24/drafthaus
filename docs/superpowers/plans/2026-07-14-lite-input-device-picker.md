# Drafthaus Lite Input Device Picker (lite-1.079) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user record through a chosen audio input (e.g. a 4-channel USB interface) via a desktop-only rail button that opens a device-picker popover with a live level meter; takes stay mono/single-file.

**Architecture:** All changes live in one new snapshot file `lite-1.079.html` (copied from `lite-1.078.html`, the current live root). A `recAudioConstraints()` helper becomes the single source of truth for capture constraints (raw trio + optional `deviceId: {ideal}` from localStorage); both existing `getUserMedia` call sites switch to it. A new rail button opens a popover reusing the existing `.tray-picker` CSS pattern, listing `enumerateDevices()` audio inputs plus a live AnalyserNode level meter. Verification is a new headless playwright-core script `_verify_lite_1079.js` mirroring `_verify_lite_1078.js`.

**Tech Stack:** Vanilla JS in a single HTML file, Web Audio API, MediaDevices API, playwright-core + installed Chrome for headless verification.

**Spec:** `docs/superpowers/specs/2026-07-14-lite-input-device-picker-design.md`

## Global Constraints

- Work ONLY on `lite-1.079.html` (and `_verify_lite_1079.js`). Never touch `full.html`, `1.3xx.html`, `index.html`, or `lite-1.078.html`.
- Base file is `lite-1.078.html`. Before editing the snapshot, `md5` it against `index.html` (they must match — base-drift trap) and `diff` the fresh copy against its source (must be empty).
- Takes stay **mono, single file**. Do NOT touch MediaRecorder mime/bitrate selection, `uploadTake`, trim, mp3 export, Firestore, or the share viewer.
- localStorage key: `dh-lite-input-device` (JSON `{id, label}`); absent key = system default.
- Constraint fallback uses `deviceId: { ideal: … }` — never `exact` (recording must not fail when the device is unplugged).
- Desktop-only UI: the rail button is hidden `@media (max-width: 767px)` exactly like `#scratchBtn` (line ~533).
- Verify with `node _verify_lite_1079.js` (exits 0, `N/N passed`). Chrome binary: `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`.
- Commit to `main` after each task. Do NOT `git push` and do NOT promote to `index.html` — both require explicit user confirmation (Pages deploy).
- The app file is ~4k lines; locate code by searching quoted strings/function names, not line numbers.

---

### Task 1: Snapshot lite-1.079.html + verify-script scaffold

**Files:**
- Create: `lite-1.079.html` (copy of `lite-1.078.html`)
- Create: `_verify_lite_1079.js`

**Interfaces:**
- Produces: `lite-1.079.html` (the only app file later tasks edit) and `_verify_lite_1079.js` with the serve/boot/spy harness later tasks append tests to. The harness exposes `window._gumCalls` (array of deep-copied getUserMedia constraint objects) and boots to a signed-in guest with song `TESTSONG` open.

- [ ] **Step 1: Confirm the base is live and snapshot it**

```bash
cd /Users/jasoncraig/Documents/Claude/Projects/Drafthaus
md5 -q index.html lite-1.078.html   # the two hashes MUST be identical
cp lite-1.078.html lite-1.079.html
diff lite-1.078.html lite-1.079.html && echo SNAPSHOT-CLEAN   # must print SNAPSHOT-CLEAN, no diff output
```

If the md5s differ, STOP and report — the base assumption is wrong.

- [ ] **Step 2: Write the verify-script scaffold with the S0 sanity check**

Create `_verify_lite_1079.js`. This mirrors `_verify_lite_1078.js` but serves `lite-1.079.html`:

```js
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
```

- [ ] **Step 3: Run it — S0 must pass**

Run: `node _verify_lite_1079.js`
Expected: `PASS S0 boot: signed in, song open` then `1/1 passed`, exit 0.

- [ ] **Step 4: Commit**

```bash
git add lite-1.079.html _verify_lite_1079.js
git commit -m "chore(lite-1.079): snapshot from lite-1.078 + verify scaffold"
```

---

### Task 2: recAudioConstraints() helper, call-site swap, unplugged-device toast

**Files:**
- Modify: `lite-1.079.html` — the recording block (search `let _mediaRec = null`) and both `getUserMedia` call sites (search `echoCancellation: false`)
- Test: `_verify_lite_1079.js`

**Interfaces:**
- Consumes: existing `recToast(msg, ms)` (toast anchored left of the record button), `_startCountdown()` / `_cancelCountdown()` / `startRecord()` / `stopRecord()` (top-level functions, reachable as bare names in page.evaluate), `_recStream` (top-level `let` — NOT a window prop).
- Produces: `recAudioConstraints()` → constraint object `{echoCancellation:false, noiseSuppression:false, autoGainControl:false, deviceId?:{ideal:string}}`; `recSavedInput()` → `{id, label}|null`; `recSaveInput(dev|null)`; `recCheckInputMatch(stream)` (once-per-session mismatch toast). All top-level functions — Task 3's popover calls `recSavedInput`/`recSaveInput`, Task 4's meter calls `recAudioConstraints`.

- [ ] **Step 1: Add failing tests A1–A3 to the verify script**

In `_verify_lite_1079.js`, insert after the S0 block (before the `console.log` summary):

```js
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
```

- [ ] **Step 2: Run — A2/A3a/A3b must FAIL (helper doesn't exist yet)**

Run: `node _verify_lite_1079.js`
Expected: S0 and A1 PASS (current code already sends the raw trio); the A2 evaluate throws `recAudioConstraints is not defined` — playwright will reject. A crash before the summary is an acceptable "failing test" signal here.

- [ ] **Step 3: Implement the helper block**

In `lite-1.079.html`, directly ABOVE the line `let _mediaRec = null, _recChunks = [], _recStart = 0, _recTimerId = null, _recStream = null, _recording = false;` insert:

```js
/* ── Input device picker (lite-1.079): saved input + capture constraints ── */
const REC_DEV_KEY = 'dh-lite-input-device';
function recSavedInput() { try { return JSON.parse(localStorage.getItem(REC_DEV_KEY) || 'null'); } catch (e) { return null; } }
function recSaveInput(dev) { try { if (dev && dev.id) localStorage.setItem(REC_DEV_KEY, JSON.stringify(dev)); else localStorage.removeItem(REC_DEV_KEY); } catch (e) {} }
function recAudioConstraints() {
  const c = { echoCancellation: false, noiseSuppression: false, autoGainControl: false };
  const dev = recSavedInput();
  if (dev && dev.id) c.deviceId = { ideal: dev.id };
  return c;
}
let _inputMismatchToasted = false;
function recCheckInputMatch(stream) {
  const dev = recSavedInput(); if (!dev || !dev.id || _inputMismatchToasted) return;
  const tr = stream && stream.getAudioTracks && stream.getAudioTracks()[0];
  const s = tr && tr.getSettings && tr.getSettings();
  if (s && s.deviceId && s.deviceId !== dev.id) {
    _inputMismatchToasted = true;
    recToast('Saved input not found — using default mic', 2600);
  }
}
```

- [ ] **Step 4: Swap both call sites and add the mismatch check**

Site 1 — in `_startCountdown()`, replace:

```js
  navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } })
```

with:

```js
  navigator.mediaDevices.getUserMedia({ audio: recAudioConstraints() })
```

Site 2 — in `startRecord()`, replace:

```js
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } }); }
```

with:

```js
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: recAudioConstraints() }); }
```

Then in `startRecord()`, immediately after the line `_recStream = stream;` add:

```js
  recCheckInputMatch(stream);
```

(This covers both the pre-acquired countdown stream and the direct-acquire path — `startRecord` is the single funnel.)

- [ ] **Step 5: Run — all A tests pass**

Run: `node _verify_lite_1079.js`
Expected: `7/7 passed` (S0, A1, A2, A3a, A3b, A3c, A4), exit 0.

- [ ] **Step 6: Commit**

```bash
git add lite-1.079.html _verify_lite_1079.js
git commit -m "feat(lite-1.079): recAudioConstraints helper — saved input device + unplugged fallback toast"
```

---

### Task 3: Rail button + input-picker popover (device list, selection, persistence)

**Files:**
- Modify: `lite-1.079.html` — rail markup (search `id="scratchBtn"`), CSS (search `#scratchPad, #scratchBtn { display: none`), JS (insert the picker block directly after the `recCheckInputMatch` function from Task 2)
- Test: `_verify_lite_1079.js`

**Interfaces:**
- Consumes: `recSavedInput()` / `recSaveInput(dev)` (Task 2), `_esc(s)` (existing HTML-escape helper), `.tray-picker-back` / `.tray-picker` / `.tp-row` / `.tp-check` / `.tp-name` / `.tp-empty` (existing CSS classes).
- Produces: `openInputPicker(btnEl)` / `closeInputPicker()` / `renderInputPicker()` / `inputPickerSelect(id, label)` (top-level functions); popover DOM `#inputPicker` (backdrop) containing `.tray-picker`; button `#inputBtn`. Calls `_ipMeterStart()` / `_ipMeterStop()`, which this task defines as no-op stubs that Task 4 replaces with the real meter.

- [ ] **Step 1: Add failing tests B1–B4 to the verify script**

Insert after the A4 block. Note: `enumerateDevices` is stubbed via the spied `navigator.mediaDevices` object (it IS a window-reachable object, unlike top-level `let` vars):

```js
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
```

- [ ] **Step 2: Run — B tests fail**

Run: `node _verify_lite_1079.js`
Expected: A tests still pass; B1 evaluate throws `openInputPicker is not defined` (crash before summary is the failing signal).

- [ ] **Step 3: Add the rail button markup**

In `lite-1.079.html`, directly AFTER the `#scratchBtn` button line (search `id="scratchBtn"`), insert:

```html
        <button class="rail-tool" id="inputBtn" onclick="openInputPicker(this)" aria-label="Input source" title="Input source"><svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg></button>
```

- [ ] **Step 4: Hide it on mobile**

Find the CSS line `@media (max-width: 767px) { #scratchPad, #scratchBtn { display: none !important; } }` and change it to:

```css
@media (max-width: 767px) { #scratchPad, #scratchBtn, #inputBtn { display: none !important; } }
```

- [ ] **Step 5: Implement the popover JS**

Directly after the `recCheckInputMatch` function (end of the Task 2 block), insert:

```js
/* Input picker popover — reuses the .tray-picker visual pattern. */
function openInputPicker(btnEl) {
  closeInputPicker();
  const back = document.createElement('div');
  back.id = 'inputPicker'; back.className = 'tray-picker-back';
  back.onclick = (e) => { if (e.target === back) closeInputPicker(); };
  back.innerHTML = '<div class="tray-picker"></div>';
  document.body.appendChild(back);
  const pop = back.querySelector('.tray-picker');
  if (btnEl && pop && btnEl.getBoundingClientRect) {
    const r = btnEl.getBoundingClientRect();
    pop.style.position = 'fixed';
    pop.style.top = Math.min(r.bottom + 6, window.innerHeight - 60) + 'px';
    pop.style.left = Math.max(8, Math.min(r.left, window.innerWidth - 232)) + 'px';
  }
  document.addEventListener('keydown', _inputPickerEsc);
  try { navigator.mediaDevices.addEventListener('devicechange', _ipDeviceChange); } catch (e) {}
  // Meter acquisition doubles as the permission grant that unblanks device labels.
  _ipMeterStart().then(() => renderInputPicker());
}
function _inputPickerEsc(e) { if (e.key === 'Escape') closeInputPicker(); }
function _ipDeviceChange() { renderInputPicker(); }
function closeInputPicker() {
  _ipMeterStop();
  try { navigator.mediaDevices.removeEventListener('devicechange', _ipDeviceChange); } catch (e) {}
  document.removeEventListener('keydown', _inputPickerEsc);
  const el = document.getElementById('inputPicker'); if (el) el.remove();
}
async function renderInputPicker() {
  const back = document.getElementById('inputPicker'); if (!back) return;
  const pop = back.querySelector('.tray-picker'); if (!pop) return;
  let devs = [];
  try { devs = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'audioinput' && d.deviceId !== 'default' && d.deviceId !== 'communications'); } catch (e) {}
  if (!document.getElementById('inputPicker')) return; // closed while enumerating
  const saved = recSavedInput();
  if (_ipBlocked) { pop.innerHTML = '<div class="tp-empty">Microphone blocked — allow mic access</div>'; return; }
  const rows = devs.map((d, i) => {
    const label = d.label || ('Microphone ' + (i + 1));
    const on = !!(saved && saved.id === d.deviceId);
    return `<div class="tp-row" onclick="inputPickerSelect('${_esc(d.deviceId)}', '${_esc(label).replace(/'/g, '&#39;')}')"><span class="tp-check">${on ? '✓' : ''}</span><span class="tp-name">${_esc(label)}</span></div>`;
  }).join('');
  pop.innerHTML = '<div class="ip-meter"><div class="ip-meter-fill" id="ipMeterFill"></div></div>' +
    `<div class="tp-row" onclick="inputPickerSelect(null, null)"><span class="tp-check">${saved ? '' : '✓'}</span><span class="tp-name">System default</span></div>` + rows;
}
function inputPickerSelect(id, label) {
  recSaveInput(id ? { id, label } : null);
  renderInputPicker();
  _ipMeterStart(); // re-point the meter at the newly selected device
}
/* Meter stubs — replaced with the real AnalyserNode meter in the next task. */
let _ipBlocked = false, _ipStream = null, _ipAC = null, _ipRaf = null;
async function _ipMeterStart() {}
function _ipMeterStop() {}
```

- [ ] **Step 6: Add the meter-bar CSS**

Directly after the CSS rule `.tp-empty { color: var(--text-2); font-size: 13px; padding: 10px 8px; }` (the ~line-226 one, NOT the ~line-545 duplicate), insert:

```css
/* input picker level meter (lite-1.079) */
.ip-meter { height: 6px; border-radius: 3px; background: var(--bg-2, rgba(127,127,127,0.15)); margin: 6px 8px 8px; overflow: hidden; }
.ip-meter-fill { height: 100%; width: 0%; border-radius: 3px; background: var(--tint); transition: width .08s linear; }
```

- [ ] **Step 7: Run — all tests pass**

Run: `node _verify_lite_1079.js`
Expected: `12/12 passed` (S0, A1–A4 ×5, B1–B5), exit 0.

- [ ] **Step 8: Commit**

```bash
git add lite-1.079.html _verify_lite_1079.js
git commit -m "feat(lite-1.079): input-source rail button + device picker popover (desktop-only)"
```

---

### Task 4: Live level meter

**Files:**
- Modify: `lite-1.079.html` — replace the meter stubs at the end of the Task 3 block
- Test: `_verify_lite_1079.js`

**Interfaces:**
- Consumes: `recAudioConstraints()` (Task 2 — the meter previews exactly what a recording would capture), `#ipMeterFill` (Task 3 markup), `renderInputPicker()`/`_ipBlocked` (Task 3).
- Produces: real `_ipMeterStart()` / `_ipMeterStop()`; module state `_ipStream`, `_ipAC`, `_ipRaf`. Exposes nothing new to other tasks.

- [ ] **Step 1: Add failing tests C1–C2 to the verify script**

Insert after the B5 block. The fake-device flag provides a real audible test stream, so the meter genuinely moves:

```js
  // ── C: live level meter ──
  await page.evaluate(() => {
    // The B-test enumerateDevices stub can stay installed — the meter only uses getUserMedia.
    openInputPicker(document.getElementById('inputBtn'));
  });
  await page.waitForTimeout(900); // let the analyser RAF run against the fake tone
  const c1 = await page.evaluate(() => {
    const el = document.getElementById('ipMeterFill');
    return { exists: !!el, width: el ? el.style.width : '' };
  });
  ok(c1.exists && c1.width !== '' && c1.width !== '0%',
    'C1 meter fill exists and moves off 0% with live (fake) input');

  // C2: closing the popover releases the stream and stops the RAF
  const c2 = await page.evaluate(() => {
    const s = _ipStream; // top-level let, bare-name reachable inside evaluate
    closeInputPicker();
    return { hadStream: !!s, live: s ? s.getTracks().some(t => t.readyState === 'live') : false, cleared: (typeof _ipStream !== 'undefined') && _ipStream === null };
  });
  ok(c2.hadStream && !c2.live && c2.cleared,
    'C2 close stops meter tracks and clears _ipStream');
```

- [ ] **Step 2: Run — C1 fails**

Run: `node _verify_lite_1079.js`
Expected: A/B pass; `FAIL C1` (stub meter never sets a width), C2 fails too (no stream was acquired). Summary shows `12/14 passed`, exit 1.

- [ ] **Step 3: Replace the stubs with the real meter**

In `lite-1.079.html`, replace this block (end of Task 3's insertion):

```js
/* Meter stubs — replaced with the real AnalyserNode meter in the next task. */
let _ipBlocked = false, _ipStream = null, _ipAC = null, _ipRaf = null;
async function _ipMeterStart() {}
function _ipMeterStop() {}
```

with:

```js
/* Live input level meter — temporary stream + AnalyserNode, torn down on close. */
let _ipBlocked = false, _ipStream = null, _ipAC = null, _ipRaf = null;
async function _ipMeterStart() {
  _ipMeterStop();
  try {
    _ipStream = await navigator.mediaDevices.getUserMedia({ audio: recAudioConstraints() });
    _ipBlocked = false;
  } catch (e) { _ipBlocked = true; renderInputPicker(); return; }
  if (!document.getElementById('inputPicker')) { _ipMeterStop(); return; } // closed during acquire
  _ipAC = new (window.AudioContext || window.webkitAudioContext)();
  const src = _ipAC.createMediaStreamSource(_ipStream);
  const an = _ipAC.createAnalyser(); an.fftSize = 512;
  src.connect(an);
  const buf = new Uint8Array(an.fftSize);
  const tick = () => {
    const el = document.getElementById('ipMeterFill');
    if (el) {
      an.getByteTimeDomainData(buf);
      let peak = 0;
      for (let i = 0; i < buf.length; i++) { const v = Math.abs(buf[i] - 128) / 128; if (v > peak) peak = v; }
      el.style.width = Math.min(100, Math.round(peak * 140)) + '%';
    }
    _ipRaf = requestAnimationFrame(tick);
  };
  _ipRaf = requestAnimationFrame(tick);
}
function _ipMeterStop() {
  if (_ipRaf) cancelAnimationFrame(_ipRaf); _ipRaf = null;
  if (_ipStream) { try { _ipStream.getTracks().forEach(t => t.stop()); } catch (e) {} _ipStream = null; }
  if (_ipAC) { try { _ipAC.close(); } catch (e) {} _ipAC = null; }
}
```

- [ ] **Step 4: Run — all pass**

Run: `node _verify_lite_1079.js`
Expected: `14/14 passed`, exit 0.

- [ ] **Step 5: Commit**

```bash
git add lite-1.079.html _verify_lite_1079.js
git commit -m "feat(lite-1.079): live input level meter in the device picker"
```

---

### Task 5: Regression checks + final verification

**Files:**
- Test: `_verify_lite_1079.js` (regression asserts), `_verify_lite_1078.js` (unchanged, re-run as-is)

**Interfaces:**
- Consumes: everything above; `_encodeMp3` (existing mp3 export function), MediaRecorder options spy pattern from `_verify_lite_1078.js`.
- Produces: the finished, fully verified `lite-1.079.html`. Nothing further consumes this task.

- [ ] **Step 1: Add regression tests R1–R2 (recorder bitrate + mp3 192k untouched)**

First, extend the `addInitScript` in `_verify_lite_1079.js` — add the MediaRecorder spy after the getUserMedia spy, inside the same callback:

```js
    // Spy MediaRecorder constructor options (returns a real recorder).
    const OrigMR = window.MediaRecorder;
    window._mrOpts = [];
    window.MediaRecorder = function (stream, opts) { window._mrOpts.push(opts || null); return new OrigMR(stream, opts); };
    window.MediaRecorder.isTypeSupported = (t) => OrigMR.isTypeSupported(t);
```

Then insert after the C2 block:

```js
  // ── R: regressions — the 1.078 music-grade guarantees are untouched ──
  const r1 = await page.evaluate(() => window._mrOpts);
  ok(r1.length >= 1 && r1.every(o => o && o.audioBitsPerSecond === 128000 && /webm|mp4/.test(o.mimeType || '')),
    'R1 MediaRecorder still gets audioBitsPerSecond 128000 + picked mimeType');

  const r2 = await page.evaluate(() => {
    window.lamejs = { Mp3Encoder: function (ch, sr, kbps) {
      window._mp3Args = { ch, sr, kbps };
      this.encodeBuffer = () => []; this.flush = () => [];
    } };
    const ac = new (window.AudioContext || window.webkitAudioContext)();
    const buf = ac.createBuffer(1, 4410, 44100);
    _encodeMp3(buf);
    return window._mp3Args;
  });
  ok(!!r2 && r2.ch === 1 && r2.sr === 44100 && r2.kbps === 192,
    'R2 _encodeMp3 still constructs Mp3Encoder at 192 kbps mono');
```

(`window._mrOpts` accumulates from the Task 2 A3/A4 recordings earlier in the run — `r1.every(...)` covers them all.)

- [ ] **Step 2: Run the new suite**

Run: `node _verify_lite_1079.js`
Expected: `16/16 passed`, exit 0.

- [ ] **Step 3: Run the 1.078 suite untouched (proves the old file/behavior is intact)**

Run: `node _verify_lite_1078.js`
Expected: `6/6 passed`, exit 0.

- [ ] **Step 4: Confirm no other files changed**

```bash
git status --porcelain
```

Expected: only `_verify_lite_1079.js` modified (staged next); `index.html`, `lite-1.078.html`, `full.html` untouched.

- [ ] **Step 5: Commit**

```bash
git add _verify_lite_1079.js
git commit -m "test(lite-1.079): regression asserts — recorder bitrate + mp3 export untouched"
```

- [ ] **Step 6: Report for manual QA — do NOT push**

Tell the user the build is ready for desktop QA and list the manual checks from the spec:
1. Open `lite-1.079.html` locally (or wait for deploy), click the new input button in the rail — the popover lists inputs and the meter moves when you speak/play.
2. Select the interface, record a take — playback carries interface audio.
3. Unplug the interface, record — take still records via default mic and the "Saved input not found" toast appears once.

Pushing to `main` (deploys via Pages) and any promotion to `index.html` happen ONLY on explicit user confirmation, as separate release commits per the project workflow.
