# Lite Mobile Playback-Session Robustness — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Drafthaus Lite playback survive phone lock/app-switch, keep the screen awake while a song is open, float the sketchpad over the takes panel, and teach iOS users how to stop the repeated mic prompt.

**Architecture:** One single-file HTML app (`lite-1.085.html`, copied from `lite-1.084.html`). Take **transport** moves off Web Audio (`AudioContext` buffer sources, which iOS suspends in the background) onto one reused hidden `<audio>` element (which iOS keeps alive), plus a Media Session for lock-screen controls. Web Audio is retained only for waveform peak decoding, chord playback, and the share viewer. A screen Wake Lock is held while a song is open. Two small self-contained changes (sketchpad z-index; a one-time iOS mic tip) round it out.

**Tech Stack:** Vanilla JS, HTML `<audio>` element, Media Session API, Screen Wake Lock API, Firestore (unchanged). Verification: `playwright-core` driving installed Chrome headless (no unit-test runner) + mandatory real-iPhone QA.

## Global Constraints

- **Lite only.** Edit `lite-1.085.html` exclusively. Never touch `full.html` / `1.3xx.html` / `index.html` (promotion to `index.html` happens later, by the user, after iPhone QA).
- **Base build:** copy from `lite-1.084.html`, md5 `89c4d010629894eec4cc05bc123d4a50`. Diff the fresh copy against the source before editing (must be identical).
- **No test runner.** Assertions live in `_verify_lite_1085.js` (playwright-core + installed Chrome at `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`, `headless: true`, launch args `--use-fake-ui-for-media-stream --use-fake-device-for-media-stream --autoplay-policy=no-user-gesture-required`, context `viewport {width:390,height:820}`, `permissions:['microphone']`). Some behaviors (real background audio, wake lock keeping the screen on, lock-screen controls, the iOS tip render) are **not** headless-provable and are deferred to iPhone QA — do not claim them PASS from headless.
- **Feature-detect every new browser API** (`navigator.wakeLock`, `navigator.mediaSession`) and no-op silently when absent.
- **Boost (>1×) is dropped for playback.** HTML `<audio>.volume` cannot exceed 1.0. Boost degrades to attenuate-only via `playEl.volume = min(normGain, 1)`; it can no longer amplify quiet takes. Signed off in the spec.
- **Region-loop slop accepted:** loop boundaries are enforced by a `requestAnimationFrame` seek (`currentTime >= region.b → currentTime = region.a`), a few ms looser than the old sample-exact `loopStart/loopEnd`. Signed off.
- **Work lands on `main`** by file-copy versioning (no branches). Commit per task. Do **not** push or promote — the user does that after QA.
- **Spec:** `docs/superpowers/specs/2026-07-29-lite-mobile-playback-session-design.md`.

## File Structure

- `lite-1.085.html` — the entire app (create by copy, then modify in place). Sole responsibility: the Lite app.
- `_verify_lite_1085.js` — headless assertion harness. Sole responsibility: automated regression + wiring checks for this build.

---

### Task 1: Create the build + verify-harness skeleton

**Files:**
- Create: `lite-1.085.html` (copy of `lite-1.084.html`)
- Create: `_verify_lite_1085.js`

**Interfaces:**
- Produces: a runnable harness with a `boot(page)` helper that reaches a song-loaded state, reused by all later tasks. Boot sequence: guest sign-in → seed a song via `_openSongObj` → seed a take into `_takes`.

- [ ] **Step 1: Copy the base build and confirm it is byte-identical**

```bash
cp lite-1.084.html lite-1.085.html
diff lite-1.084.html lite-1.085.html && echo "IDENTICAL COPY OK"
md5 -q lite-1.085.html   # must print 89c4d010629894eec4cc05bc123d4a50
```
Expected: `IDENTICAL COPY OK` and the matching md5.

- [ ] **Step 2: Write the harness skeleton with a smoke assertion**

Create `_verify_lite_1085.js`:

```js
// Lite 1.085: mobile playback-session robustness (bg audio, wake lock, sketchpad z-index, mic tip).
const { chromium } = require('playwright-core');
const path = require('path'); const http = require('http'); const fs = require('fs');
function startServer() {
  return new Promise(resolve => {
    const srv = http.createServer((req, res) => {
      const file = path.join(__dirname, decodeURIComponent(req.url.split('?')[0]));
      fs.readFile(file, (err, buf) => { if (err) { res.writeHead(404); res.end('nf'); return; }
        res.writeHead(200, { 'Content-Type': file.endsWith('.html') ? 'text/html' : 'application/octet-stream' }); res.end(buf); });
    });
    srv.listen(0, '127.0.0.1', () => resolve({ srv, port: srv.address().port }));
  });
}
const results = []; const assert = (n, c) => results.push((c ? 'PASS' : 'FAIL') + ' — ' + n);

// Reach a song-loaded state with one fake take in _takes.
async function boot(page) {
  await page.click('.auth-btn.ghost');
  await page.waitForSelector('body.signed-in', { timeout: 15000 });
  await page.evaluate(() => {
    _openSongObj({ id: 'S1', title: 'Test Song', key: 'C major', lyricsDoc: '<div>hi</div>' });
    // Seed a synthetic take (no real audio needed for wiring checks).
    _takes = [{ id: 'T1', name: 'Take 1', downloadUrl: 'about:blank', mimeType: 'audio/webm', createdAt: 1 }];
    _loadedTakeId = 'T1';
  });
}

(async () => {
  const { srv, port } = await startServer();
  const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true,
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 820 }, permissions: ['microphone'] });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  await page.goto(`http://127.0.0.1:${port}/lite-1.085.html`, { waitUntil: 'load' });

  await boot(page);
  assert('boots to signed-in + song loaded', await page.evaluate(() => !!_currentSong && _currentSong.id === 'S1'));

  console.log(results.join('\n'));
  console.log('\n' + results.filter(r => r.startsWith('PASS')).length + '/' + results.length + ' PASS');
  if (errors.length) console.log('PAGE ERRORS:\n' + errors.join('\n'));
  await browser.close(); srv.close();
  process.exit(results.some(r => r.startsWith('FAIL')) ? 1 : 0);
})();
```

- [ ] **Step 3: Run the harness — confirm the smoke assert passes**

Run: `node _verify_lite_1085.js`
Expected: `1/1 PASS` and no `FAIL`. (Firestore `permission-denied` noise in guest mode is expected and does not appear as a page error here.)

- [ ] **Step 4: Commit**

```bash
git add lite-1.085.html _verify_lite_1085.js
git commit -m "chore(lite-1.085): branch build from 1.084 + verify harness skeleton"
```

---

### Task 2: Route take playback through a hidden `<audio>` element (#1 background/lock-screen audio)

**Files:**
- Modify: `lite-1.085.html` — add `<audio>` element after `<body>` (line 800); replace playback globals (line 2369), `toggleLoop` loop-branch (lines 2131-2137), `_phNow`/`_startPlayhead`/`stopPlayback`/`playTake` (lines 2394-2437), `_wfUIHtml` selPlaying (line 2479), `wfPlaySel` guard (line 2534), and `toggleBoost` live-adjust (lines 2886-2891); add `_getPlayableSrc`, `_applyPlayVolume`, `_setMediaSession`.
- Modify: `_verify_lite_1085.js` — add assertions.

**Interfaces:**
- Consumes: `dhAudioGet(id) -> Promise<Blob|null>`, `dhAudioTouch(id)`, `take.downloadUrl`, `_takes`, `_loadedTakeId`, `_loopTakes`, `_wf`, `wfLoad(take)`, `takeDisplayName(t)`, `_currentSong`, `_bufCache` (populated by `wfLoad`→`_getBuffer` with `{buffer, normGain}`), `toast(msg)`.
- Produces: singleton `<audio id="playEl">`; globals `_playEl`, `_playUrl`, `_playRegion`; functions `_getPlayableSrc(take) -> Promise<string>`, `_applyPlayVolume()`, `_setMediaSession(take)`, and rewritten `playTake(id, opts)` / `stopPlayback()` / `_startPlayhead()` with unchanged call signatures. `_playRegion` replaces the old `_phRegion` as the "region-loop active" flag read by the waveform UI.

- [ ] **Step 1: Add the assertions (they fail first)**

In `_verify_lite_1085.js`, before the results print, add:

```js
  // ── #1 background audio: <audio> transport ──
  assert('#playEl audio element exists', await page.evaluate(() => {
    const el = document.getElementById('playEl'); return !!el && el.tagName === 'AUDIO' && el.hasAttribute('playsinline');
  }));
  // playTake sets the element src + drives it (stub _getPlayableSrc so no real blob is needed)
  await page.evaluate(async () => {
    window.__played = null;
    window._getPlayableSrc = async () => 'about:blank#take';   // deterministic stub
    const _origPlay = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () { window.__played = this.id; return Promise.resolve(); };
    await playTake('T1');
  });
  assert('playTake sets #playEl.src', await page.evaluate(() => document.getElementById('playEl').src.includes('about:blank#take')));
  assert('playTake calls play() on #playEl', await page.evaluate(() => window.__played === 'playEl'));
  assert('playTake sets _playingTakeId', await page.evaluate(() => _playingTakeId === 'T1'));
  assert('stopPlayback pauses + clears', await page.evaluate(() => { let paused = false; const el = document.getElementById('playEl'); const p = el.pause; el.pause = () => { paused = true; }; stopPlayback(); el.pause = p; return paused && _playingTakeId === null; }));
  // whole-take loop flag
  assert('loop take sets #playEl.loop', await page.evaluate(async () => { _loopTakes = new Set(['T1']); await playTake('T1'); return document.getElementById('playEl').loop === true; }));
  // region loop uses _playRegion (old _phRegion is gone)
  assert('_phRegion removed / _playRegion is the flag', await page.evaluate(() => typeof _phRegion === 'undefined'));
  assert('region play sets _playRegion', await page.evaluate(async () => { _loopTakes = new Set(); await playTake('T1', { offset: 1, region: { a: 1, b: 2 } }); return _playRegion && _playRegion.a === 1 && _playRegion.b === 2; }));
  // Media Session wired (guarded no-op if unsupported)
  assert('Media Session metadata set (if supported)', await page.evaluate(() => !('mediaSession' in navigator) || (navigator.mediaSession.metadata && navigator.mediaSession.metadata.title.includes('Take 1'))));
```

- [ ] **Step 2: Run — confirm the new assertions FAIL**

Run: `node _verify_lite_1085.js`
Expected: the `#1` assertions FAIL (e.g. `#playEl audio element exists` → FAIL; `_phRegion removed` → FAIL because `_phRegion` still exists), smoke assert still PASS.

- [ ] **Step 3: Add the `<audio>` element**

Immediately after the `<body>` tag (line 800), insert as the first child:

```html
<audio id="playEl" playsinline preload="auto" style="display:none"></audio>
```

- [ ] **Step 4: Replace the playback globals**

Find (line 2369):
```js
let _audioCtx = null, _curSource = null, _curGain = null, _playingTakeId = null, _bufCache = {};
```
Replace with:
```js
let _audioCtx = null, _playingTakeId = null, _bufCache = {};
let _playEl = null, _playUrl = null, _playRegion = null;
function _ensurePlayEl() {
  if (_playEl) return _playEl;
  _playEl = document.getElementById('playEl');
  _playEl.addEventListener('ended', () => {
    if (_playEl.loop) return; // whole-take loop restarts natively
    _playingTakeId = null; _stopPlayhead(); _wf.playhead = 0; updateRailPlayBtn(); renderTakes(); wfPaint();
  });
  return _playEl;
}
// Playable source: IndexedDB blob first (offline-safe object URL), else the remote URL.
async function _getPlayableSrc(take) {
  const local = await dhAudioGet(take.id);
  if (local) { dhAudioTouch(take.id); return URL.createObjectURL(local); }
  if (!take.downloadUrl) throw new Error('pending-remote');
  return take.downloadUrl;
}
// Boost degrades to attenuate-only: HTML volume caps at 1.0, so quiet takes can no longer be amplified.
function _applyPlayVolume() {
  if (!_playEl) return;
  const e = _bufCache[_playingTakeId];
  _playEl.volume = (_currentSong && _currentSong.boost && e) ? Math.min(e.normGain, 1) : 1;
}
function _setMediaSession(take) {
  if (!('mediaSession' in navigator)) return;
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: takeDisplayName(take),
      artist: (_currentSong && _currentSong.title) || 'Drafthaus',
    });
    navigator.mediaSession.setActionHandler('play', () => { if (_playEl) _playEl.play().catch(() => {}); });
    navigator.mediaSession.setActionHandler('pause', () => stopPlayback());
    navigator.mediaSession.setActionHandler('stop', () => stopPlayback());
  } catch (e) {}
}
```

- [ ] **Step 5: Rewrite `_phNow`/`_startPlayhead`/`stopPlayback`/`playTake`**

Find the block from `let _phStartCtx = 0, _phOffset = 0, _phRegion = null, _phRaf = null;` (line 2394) through the end of `playTake` (line 2437, ending `wfLoad(take);` + `}`). Replace the whole block with:

```js
let _phRaf = null;
function _stopPlayhead() { if (_phRaf) cancelAnimationFrame(_phRaf); _phRaf = null; }
function _startPlayhead() {
  _stopPlayhead();
  const tick = () => {
    if (_playingTakeId == null || !_playEl) return;
    _applyPlayVolume();
    let t = _playEl.currentTime;
    if (_playRegion && t >= _playRegion.b) { t = _playRegion.a; try { _playEl.currentTime = t; } catch (e) {} }
    _wf.playhead = t; wfPaint();
    _phRaf = requestAnimationFrame(tick);
  };
  _phRaf = requestAnimationFrame(tick);
}
function stopPlayback() {
  if (_playEl) { try { _playEl.pause(); } catch (e) {} }
  _stopPlayhead();
  _playRegion = null; _playingTakeId = null;
  updateRailPlayBtn(); renderTakes(); wfPaint();
}
async function playTake(id, opts) {
  opts = opts || {};
  stopPlayback();
  const take = _takes.find(t => t.id === id); if (!take) return;
  _loadedTakeId = id;
  const el = _ensurePlayEl();
  let src;
  try { src = await _getPlayableSrc(take); }
  catch (e) { console.warn('[play]', e); toast('Could not load take'); return; }
  if (_playUrl) { try { URL.revokeObjectURL(_playUrl); } catch (e) {} _playUrl = null; }
  if (typeof src === 'string' && src.indexOf('blob:') === 0) _playUrl = src;
  el.src = src;
  const region = ('region' in opts) ? opts.region : ((_wf.takeId === id && _wf.loopSel && _wf.sel) ? _wf.sel : null);
  _playRegion = (region && region.b > region.a) ? region : null;
  el.loop = !_playRegion && _loopTakes.has(id);
  let offset = (typeof opts.offset === 'number') ? opts.offset : (_playRegion ? _playRegion.a : 0);
  const start = () => {
    const dur = el.duration || 0;
    if (offset < 0 || (dur && offset > dur - 0.02)) offset = _playRegion ? _playRegion.a : 0;
    try { el.currentTime = offset; } catch (e) {}
    el.play().catch(err => console.warn('[play] play()', err));
  };
  if (el.readyState >= 1) start();
  else el.addEventListener('loadedmetadata', start, { once: true });
  _playingTakeId = id;
  _startPlayhead();
  _setMediaSession(take);
  updateRailPlayBtn(); renderTakes(); updateRail();
  wfLoad(take); // decodes buffer for peaks + populates _bufCache[id].normGain for _applyPlayVolume
}
```

- [ ] **Step 6: Fix the remaining old-state references**

(a) `toggleLoop` loop-branch — find (lines 2131-2137):
```js
  if (_playingTakeId === id && _curSource) {
    const on = _loopTakes.has(id);
    // Turning loop OFF mid-play: rebase the playhead clock to the current wrapped position
    // (computed while src.loop is still true) so the line doesn't jump off-canvas.
    if (!on && _audioCtx) { _phOffset = _phNow(); _phStartCtx = _audioCtx.currentTime; _phRegion = null; }
    _curSource.loop = on;
  }
```
Replace with:
```js
  if (_playingTakeId === id && _playEl) {
    _playEl.loop = _loopTakes.has(id); // playhead reads currentTime directly — no clock rebase needed
  }
```

(b) `_wfUIHtml` — find (line 2479): `const hasSel = !!_wf.sel, selPlaying = _playingTakeId === _wf.takeId && !!_phRegion;`
Replace `!!_phRegion` with `!!_playRegion`.

(c) `wfPlaySel` — find (line 2534): `if (_playingTakeId === _wf.takeId && _phRegion) { stopPlayback(); return; }`
Replace `_phRegion` with `_playRegion`.

(d) `toggleBoost` live-adjust — find (lines 2886-2891):
```js
  // Live, click-free toggle during playback (smooth ramp instead of a jump).
  if (_curGain && _playingTakeId && _bufCache[_playingTakeId]) {
    const target = v ? _bufCache[_playingTakeId].normGain : 1;
    try { _curGain.gain.setTargetAtTime(target, ensureCtx().currentTime, 0.04); }
    catch (e) { _curGain.gain.value = target; }
  }
```
Replace with:
```js
  _applyPlayVolume(); // live-apply (attenuate-only; the RAF also keeps this current)
```

- [ ] **Step 7: Verify no orphaned references remain**

Run:
```bash
grep -n "_curSource\|_curGain\|_phNow\|_phOffset\|_phStartCtx\|_phRegion" lite-1.085.html
```
Expected: **no output** (all removed/renamed).

- [ ] **Step 8: Run the harness — confirm #1 assertions PASS**

Run: `node _verify_lite_1085.js`
Expected: all `#1` assertions PASS, smoke PASS, and no `PAGE ERRORS`.

- [ ] **Step 9: Commit**

```bash
git add lite-1.085.html _verify_lite_1085.js
git commit -m "feat(lite-1.085): route take playback through <audio> element + Media Session (bg/lock-screen audio)"
```

---

### Task 3: Hold a screen Wake Lock while a song is open (#2)

**Files:**
- Modify: `lite-1.085.html` — add wake-lock helpers near the playback block; call acquire at end of `_openSongObj` (line 1459, after `showScreen('song')` region), release in `goHome` (line 1462), re-acquire in the `visibilitychange` handler (line 3987).
- Modify: `_verify_lite_1085.js` — add assertions (stub `navigator.wakeLock`).

**Interfaces:**
- Consumes: `_currentSong`, `_openSongObj`, `goHome`, the existing `visibilitychange` listener.
- Produces: `_wakeLock` sentinel global; `_wakeLockAcquire()` / `_wakeLockRelease()`.

- [ ] **Step 1: Add the assertions (fail first)**

In `_verify_lite_1085.js`, add before the print:

```js
  // ── #2 wake lock ──
  await page.evaluate(() => {
    window.__wl = { acquired: 0, released: 0 };
    const sentinel = { release() { window.__wl.released++; return Promise.resolve(); }, addEventListener() {} };
    navigator.wakeLock = { request: () => { window.__wl.acquired++; return Promise.resolve(sentinel); } };
  });
  await page.evaluate(async () => { await _wakeLockAcquire(); });
  assert('wake lock acquired on demand', await page.evaluate(() => window.__wl.acquired === 1));
  await page.evaluate(async () => { await _wakeLockRelease(); });
  assert('wake lock released', await page.evaluate(() => window.__wl.released === 1));
  assert('goHome releases wake lock', await page.evaluate(async () => {
    window.__wl = { acquired: 0, released: 0 };
    await _wakeLockAcquire(); goHome(); await new Promise(r => setTimeout(r, 30));
    return window.__wl.released >= 1;
  }));
  assert('wakeLock absent → helpers no-op (no throw)', await page.evaluate(async () => {
    const saved = navigator.wakeLock; delete navigator.wakeLock;
    let ok = true; try { await _wakeLockAcquire(); await _wakeLockRelease(); } catch (e) { ok = false; }
    navigator.wakeLock = saved; return ok;
  }));
```

- [ ] **Step 2: Run — confirm they FAIL**

Run: `node _verify_lite_1085.js`
Expected: `#2` assertions FAIL (`_wakeLockAcquire is not defined`).

- [ ] **Step 3: Add the wake-lock helpers**

Immediately after the `_ensurePlayEl` / `_getPlayableSrc` block added in Task 2 (i.e. right after `_setMediaSession`), add:

```js
let _wakeLock = null;
async function _wakeLockAcquire() {
  if (!('wakeLock' in navigator) || _wakeLock) return;
  try {
    _wakeLock = await navigator.wakeLock.request('screen');
    _wakeLock.addEventListener && _wakeLock.addEventListener('release', () => { _wakeLock = null; });
  } catch (e) { _wakeLock = null; }
}
async function _wakeLockRelease() {
  if (!_wakeLock) return;
  try { await _wakeLock.release(); } catch (e) {}
  _wakeLock = null;
}
```

- [ ] **Step 4: Acquire on song open**

In `_openSongObj`, find the last line before the closing brace (line 1459 region):
```js
  try { loadSampler(_qcInstrument); } catch (e) {}
}
```
Replace with:
```js
  try { loadSampler(_qcInstrument); } catch (e) {}
  _wakeLockAcquire();
}
```

- [ ] **Step 5: Release in `goHome`**

Find `goHome` (line 1462):
```js
function goHome() {
  toggleChordsMode(false);
  flushLyrics(); scratchFlush(); stopPlayback(); stopTakesListener();
  _currentSong = null; _wfReset(); wfRender();
  showScreen('songlist');
}
```
Replace with:
```js
function goHome() {
  toggleChordsMode(false);
  flushLyrics(); scratchFlush(); stopPlayback(); stopTakesListener();
  _wakeLockRelease();
  _currentSong = null; _wfReset(); wfRender();
  showScreen('songlist');
}
```

- [ ] **Step 6: Re-acquire on return to foreground**

Find (line 3987):
```js
document.addEventListener('visibilitychange', () => { if (!document.hidden) liteFreshenSong(); });
```
Replace with:
```js
document.addEventListener('visibilitychange', () => { if (!document.hidden) { liteFreshenSong(); if (_currentSong) _wakeLockAcquire(); } });
```

- [ ] **Step 7: Run — confirm #2 PASS**

Run: `node _verify_lite_1085.js`
Expected: all `#2` assertions PASS.

- [ ] **Step 8: Commit**

```bash
git add lite-1.085.html _verify_lite_1085.js
git commit -m "feat(lite-1.085): hold screen wake lock while a song is open (#2)"
```

---

### Task 4: Float the sketchpad over the takes panel (#3)

**Files:**
- Modify: `lite-1.085.html` — `#scratchPad` z-index (line 524).
- Modify: `_verify_lite_1085.js` — add one assertion.

**Interfaces:**
- Consumes: `#scratchPad`, `#takesPanel`, `toggleScratch()`, `toggleTakes()`.
- Produces: nothing new (pure CSS).

- [ ] **Step 1: Add the assertion (fails first)**

In `_verify_lite_1085.js`, add:

```js
  // ── #3 sketchpad floats over takes ──
  assert('scratchPad z-index > takesPanel z-index', await page.evaluate(() => {
    const z = el => parseInt(getComputedStyle(el).zIndex, 10);
    document.getElementById('takesPanel').classList.add('open');
    document.getElementById('scratchPad').hidden = false;
    return z(document.getElementById('scratchPad')) > z(document.getElementById('takesPanel'));
  }));
```

- [ ] **Step 2: Run — confirm it FAILS**

Run: `node _verify_lite_1085.js`
Expected: FAIL (6 is not > 7).

- [ ] **Step 3: Raise the z-index**

Find (in the `#scratchPad` rule, line 524):
```css
  box-shadow: var(--shadow-lg); z-index: 6; display: flex; flex-direction: column;
```
Replace with:
```css
  box-shadow: var(--shadow-lg); z-index: 8; display: flex; flex-direction: column;
```

- [ ] **Step 4: Run — confirm PASS**

Run: `node _verify_lite_1085.js`
Expected: the `#3` assertion PASS (8 > 7).

- [ ] **Step 5: Commit**

```bash
git add lite-1.085.html _verify_lite_1085.js
git commit -m "fix(lite-1.085): sketchpad floats over takes panel (z-index 6->8) (#3)"
```

---

### Task 5: One-time iOS mic tip (#4)

**Files:**
- Modify: `lite-1.085.html` — add `#micTip` markup after `<body>` (near `#playEl`), CSS in the mobile style block, `micTipMaybeShow()`/`micTipDismiss()` functions, and a call at the top of `_startCountdown` (line 2779).
- Modify: `_verify_lite_1085.js` — add assertions.

**Interfaces:**
- Consumes: `localStorage`, `_startCountdown` (the record-attempt entry point that triggers `getUserMedia`).
- Produces: `micTipMaybeShow()`, `micTipDismiss()`; `#micTip` element; localStorage key `dh-lite-mic-tip-seen`.

- [ ] **Step 1: Add the assertions (fail first)**

In `_verify_lite_1085.js`, add:

```js
  // ── #4 mic tip (iOS tab only, once) ──
  const isIOSTabStub = () => {
    Object.defineProperty(navigator, 'standalone', { value: false, configurable: true });
    Object.defineProperty(navigator, 'userAgent', { value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1', configurable: true });
  };
  assert('mic tip shows on iOS tab, first time', await page.evaluate((fn) => {
    eval('(' + fn + ')()'); // apply iOS stub
    localStorage.removeItem('dh-lite-mic-tip-seen');
    micTipMaybeShow();
    return getComputedStyle(document.getElementById('micTip')).display !== 'none';
  }, isIOSTabStub.toString()));
  assert('mic tip dismiss hides + sets flag', await page.evaluate(() => {
    micTipDismiss();
    return document.getElementById('micTip').hidden && localStorage.getItem('dh-lite-mic-tip-seen') === '1';
  }));
  assert('mic tip does not re-show once seen', await page.evaluate(() => {
    micTipMaybeShow(); return document.getElementById('micTip').hidden;
  }));
  assert('mic tip never shows on desktop UA', await page.evaluate(() => {
    Object.defineProperty(navigator, 'userAgent', { value: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) Chrome/120', configurable: true });
    localStorage.removeItem('dh-lite-mic-tip-seen');
    micTipMaybeShow(); return document.getElementById('micTip').hidden;
  }));
```

- [ ] **Step 2: Run — confirm they FAIL**

Run: `node _verify_lite_1085.js`
Expected: FAIL (`micTipMaybeShow is not defined`).

- [ ] **Step 3: Add the `#micTip` markup**

Immediately after the `<audio id="playEl" ...>` line added in Task 2, insert:

```html
<div id="micTip" hidden role="dialog" aria-live="polite">
  <div class="mic-tip-card">
    <p class="mic-tip-h">Tired of the mic prompt every visit?</p>
    <p class="mic-tip-b">iOS asks each time you open the site in a tab. To stop it: tap <b>aA</b> in the address bar → <b>Website Settings</b> → <b>Microphone</b> → <b>Allow</b>. Or use <b>Share → Add to Home Screen</b> and open it from there.</p>
    <button class="mic-tip-ok" onclick="micTipDismiss()">Got it</button>
  </div>
</div>
```

- [ ] **Step 4: Add the CSS**

Inside the `@media (max-width: 767px)` block (near line 542), add:

```css
  #micTip { position: fixed; inset: 0; z-index: 9500; display: flex; align-items: flex-end; justify-content: center; background: rgba(0,0,0,.45); }
  #micTip[hidden] { display: none; }
  .mic-tip-card { background: var(--bg-elev); color: var(--text); border-radius: 16px 16px 0 0; padding: 20px 18px calc(18px + env(safe-area-inset-bottom)); width: 100%; max-width: 480px; box-shadow: var(--shadow-lg); }
  .mic-tip-h { font-weight: 700; font-size: 15px; margin: 0 0 8px; }
  .mic-tip-b { font-size: 13px; line-height: 1.5; color: var(--text-2); margin: 0 0 16px; }
  .mic-tip-ok { width: 100%; padding: 12px; border: none; border-radius: 12px; background: var(--tint); color: #fff; font-weight: 700; font-size: 15px; }
```

- [ ] **Step 5: Add the show/dismiss functions**

After `_setMediaSession` (or anywhere in the top-level script), add:

```js
function _isIOSTab() {
  const ua = navigator.userAgent || '';
  const iOS = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && 'ontouchend' in document);
  return iOS && navigator.standalone !== true;
}
function micTipMaybeShow() {
  if (localStorage.getItem('dh-lite-mic-tip-seen') === '1') return;
  if (!_isIOSTab()) return;
  document.getElementById('micTip').hidden = false;
}
function micTipDismiss() {
  document.getElementById('micTip').hidden = true;
  try { localStorage.setItem('dh-lite-mic-tip-seen', '1'); } catch (e) {}
}
```

- [ ] **Step 6: Trigger on the record attempt**

Find the top of `_startCountdown` (line 2778-2779):
```js
function _startCountdown() {
  _recCounting = true;
```
Replace with:
```js
function _startCountdown() {
  micTipMaybeShow();
  _recCounting = true;
```

- [ ] **Step 7: Run — confirm #4 PASS**

Run: `node _verify_lite_1085.js`
Expected: all `#4` assertions PASS.
Note: the assertion toggles `#micTip.hidden`; the CSS `[hidden]` rule + the base `display:flex` mean `display` is `none` when hidden and `flex` when shown — matching the `display !== 'none'` check.

- [ ] **Step 8: Commit**

```bash
git add lite-1.085.html _verify_lite_1085.js
git commit -m "feat(lite-1.085): one-time iOS mic-prompt tip (aA toggle / Add to Home Screen) (#4)"
```

---

### Task 6: Full regression + iPhone QA gate

**Files:**
- Modify: none (verification only). May add a short QA checklist comment to the top of `_verify_lite_1085.js`.

**Interfaces:**
- Consumes: all prior tasks.
- Produces: a green headless run + a written iPhone-QA checklist for the user.

- [ ] **Step 1: Run the new suite clean**

Run: `node _verify_lite_1085.js`
Expected: `N/N PASS`, zero FAIL, zero PAGE ERRORS.

- [ ] **Step 2: Run the prior regression suites against 1.085**

Copy each prior harness's target to 1.085 (they hard-code the filename) or temporarily point them at `lite-1.085.html`, then run:
```bash
node _verify_lite_1084.js   # 28/28 expected (lyrics self-merge)
```
Expected: `28/28 PASS`. Investigate any regression before proceeding. (The 1.084 suite loads its own filename — if it targets `lite-1.084.html`, duplicate it as `_verify_lite_1085_regress.js` pointed at `lite-1.085.html` and run that.)

- [ ] **Step 3: Confirm no orphaned Web Audio playback refs and the base diff is sane**

Run:
```bash
grep -n "_curSource\|_curGain\|_phNow\|_phRegion\|createBufferSource().*take" lite-1.085.html || echo "clean"
diff <(git show HEAD~5:lite-1.084.html 2>/dev/null || cat lite-1.084.html) lite-1.085.html | head -5
```
Expected: `clean` for the grep; the diff shows only the intended feature changes.

- [ ] **Step 4: Hand the iPhone-QA checklist to the user (NOT headless-provable)**

Present this checklist for real-device sign-off before any promotion:
- Play a take, **lock the phone** → audio keeps playing; lock screen shows play/pause/stop that work.
- Play a take, **switch to another app** → audio keeps playing until stopped in-app.
- Open a song and leave it idle → **screen does not auto-lock**; return to the song list → normal auto-lock resumes.
- Waveform: select a region + loop → loops within the selection (slight boundary slop is expected/accepted).
- Open the takes panel, tap the sketchpad → **sketchpad appears on top**, usable.
- Fresh Safari tab visit → hit record → the **mic tip appears once**; dismiss → never returns; boosted songs play at normal volume (no crash).

- [ ] **Step 5: Commit any checklist comment**

```bash
git add _verify_lite_1085.js
git commit -m "test(lite-1.085): full suite + iPhone QA checklist"
```

Do **not** promote to `index.html` or push — the user does that after iPhone QA passes.

---

## Self-Review

**Spec coverage:**
- §1 background audio → Task 2 (element transport, Media Session, boost degradation, region-loop seek). ✓
- §2 wake lock → Task 3 (acquire on open, release on goHome, re-acquire on visibility). ✓
- §3 sketchpad z-index → Task 4. ✓
- §4 mic tip → Task 5 (iOS-tab gate, once, aA + Home-Screen copy, `startRecord`/`_startCountdown` trigger). ✓
- §Testing headless + iPhone QA + regression → Tasks 1–6. ✓
- §Versioning (copy, diff-confirm, main, no push) → Task 1 + Global Constraints + Task 6. ✓
- Boost casualty → Global Constraints + Task 2 Step 4/6 (`_applyPlayVolume`). ✓

**Placeholder scan:** none — every code step has complete code; every run step has an exact command + expected output.

**Type/name consistency:** `_playEl`, `_playUrl`, `_playRegion`, `_getPlayableSrc`, `_applyPlayVolume`, `_setMediaSession`, `_ensurePlayEl`, `_wakeLock`, `_wakeLockAcquire`, `_wakeLockRelease`, `micTipMaybeShow`, `micTipDismiss`, `_isIOSTab` are used identically across tasks and assertions. Old `_curSource`/`_curGain`/`_phNow`/`_phOffset`/`_phStartCtx`/`_phRegion` are fully removed and Task 2 Step 7 + Task 6 Step 3 grep-guard against orphans. `_playRegion` consistently replaces `_phRegion` at every read site (lines 2479, 2534).
