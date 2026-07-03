# Lite 1.074 — Playback & Takes-Panel Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `lite-1.074.html` with three fixes: the playhead stays visible on every loop pass, pressing ▶ on a take shows its waveform (no "second select" needed), and the takes panel opens by default on desktop.

**Architecture:** Drafthaus Lite is a single-file vanilla-JS web app (`lite-*.html`) versioned by whole-file copy. All three fixes are small surgical edits inside the one file, each verified by a headless playwright-core script driving the real app in the installed Chrome. Spec: `docs/superpowers/specs/2026-07-03-lite-playback-takes-fixes-design.md`.

**Tech Stack:** Vanilla JS + Web Audio + Firestore (single HTML file); playwright-core + installed Chrome for verification (no test runner exists).

## Global Constraints

- Work only on **Drafthaus Lite**: edit `lite-1.074.html` only. NEVER touch `index.html`, `full.html`, or `1.3xx.html`.
- Base file is `lite-1.073.html` (verify by md5 in Task 1 before copying — base-drift has caused regressions before).
- The file is large — **locate code by searching the quoted strings given in each task, never by line number**. Before each Edit, confirm the anchor string is unique in the file (`grep -c`).
- All work lands on `main` as commits. **Do NOT `git push`** — pushing deploys to GitHub Pages; the user must approve any push.
- Run all node commands **from the repo root** `/Users/jasoncraig/Documents/Claude/Projects/Drafthaus` (playwright-core resolves from its `node_modules`; the verify script serves files from `__dirname`).
- Headless-verify facts (hard-won, do not rediscover): app top-level `let` variables (`_takes`, `_bufCache`, `_wf`, `_audioCtx`, `_curSource`, `_playingTakeId`, `_phOffset`, `_phStartCtx`, `_phRegion`, `_loopTakes`, `_loadedTakeId`) are global *lexical* bindings — read/assign them by **bare name** inside `page.evaluate`, not `window.x`. Top-level `function`s (`renderTakes`, `wfLoad`, `toggleLoop`, `_phNow`, `_openSongObj`, `stopPlayback`, `updateRail`) ARE `window` properties. Firestore `permission-denied` console errors in guest mode are expected noise.
- There is no in-file version string to bump — the filename is the version (in-file `lite-1.073` mentions are historical comments; leave them).
- Commit messages use the repo's style: `fix(lite-1.074): <what>` / `test(lite-1.074): <what>`.

---

### Task 1: Snapshot the new version file + verify-script scaffold

**Files:**
- Create: `lite-1.074.html` (byte-identical copy of `lite-1.073.html`)
- Create: `_verify_lite_1074.js` (harness scaffold, zero assertions, exits 0)

**Interfaces:**
- Produces: `lite-1.074.html` — the only app file later tasks edit.
- Produces: `_verify_lite_1074.js` with helpers later tasks call verbatim: `ok(cond, msg)`, `boot(browser, port, viewport) → page` (EULA bypass + guest sign-in), `seedSong(page)` (opens synthetic song `TESTSONG`, injects takes `t1`/`t2` with pre-decoded 2-second buffers in `_bufCache`, auto-selects `t1` and `wfLoad`s it), `waveState(page, id) → 'CANVAS'|'TEXT'|'EMPTY'|'NONE'`, and a marker line `// ── [test blocks: appended by tasks 2–4 above this line] ──` where test blocks get inserted.

- [ ] **Step 1: Confirm the base and copy it**

```bash
cd /Users/jasoncraig/Documents/Claude/Projects/Drafthaus
ls lite-1.0*.html          # highest-numbered must be lite-1.073.html
md5 -q lite-1.073.html index.html   # MUST differ (index is 1.072 — if identical, STOP and ask the user)
cp lite-1.073.html lite-1.074.html
cmp lite-1.073.html lite-1.074.html && echo IDENTICAL
```

Expected: `IDENTICAL`. If `cmp` reports a difference, the copy failed — stop.

- [ ] **Step 2: Write the verify-script scaffold**

Create `_verify_lite_1074.js` with exactly:

```js
// _verify_lite_1074.js — lite-1.074: loop playhead wrap, play-loads-waveform, desktop default-open takes panel
const { chromium } = require('playwright-core');
const http = require('http'); const fs = require('fs'); const path = require('path');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ROOT = __dirname;
let PASS = 0, FAIL = 0;
const ok = (c, m) => { if (c) { PASS++; console.log('PASS', m); } else { FAIL++; console.log('FAIL', m); } };

function serve() {
  return new Promise(res => {
    const s = http.createServer((req, rq) => {
      let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/lite-1.074.html';
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

async function boot(browser, port, viewport) {
  const ctx = await browser.newContext({ viewport });
  await ctx.addInitScript(() => { try { localStorage['drafthaus-eula-accepted'] = '1'; } catch (e) {} });
  const page = await ctx.newPage();
  await page.goto(`http://localhost:${port}/lite-1.074.html`, { waitUntil: 'domcontentloaded' });
  await page.click('.auth-btn.ghost');
  await page.waitForSelector('body.signed-in', { timeout: 15000 });
  return page;
}

// Open a synthetic song and inject two takes with pre-decoded buffers (no network/Firestore).
async function seedSong(page) {
  await page.evaluate(() => {
    window._openSongObj({ id: 'TESTSONG', ownerId: 'guest', title: 'Verify Song', key: '', lyricsDoc: '<div>la</div>' });
    const d1 = new Date(2026, 5, 6, 15, 42), d2 = new Date(2026, 5, 5, 21, 30);
    _takes = [
      { id: 't1', duration: 2, storagePath: 'x.mp3', downloadUrl: '', createdAt: { toDate: () => d1 } },
      { id: 't2', duration: 2, name: 'Chorus idea', storagePath: 'y.mp3', downloadUrl: '', createdAt: { toDate: () => d2 } },
    ];
    const ac = new (window.AudioContext || window.webkitAudioContext)();
    const mk = () => { const b = ac.createBuffer(1, 88200, 44100); const ch = b.getChannelData(0); for (let i = 0; i < ch.length; i++) ch[i] = Math.sin(i / 20) * 0.5; return b; };
    _bufCache['t1'] = { buffer: mk(), normGain: 1 };
    _bufCache['t2'] = { buffer: mk(), normGain: 1 };
    _loadedTakeId = 't1';
    renderTakes(); updateRail();
    wfLoad(_takes[0]);   // mirrors what the takes snapshot listener does for the auto-selected take
  });
  await page.waitForTimeout(300);
}

// What's inside a take row's waveform host right now?
const waveState = (page, id) => page.evaluate((id) => {
  const w = document.querySelector('.take-row[data-id="' + id + '"] .take-wave');
  return w ? (w.querySelector('canvas.wave-canvas') ? 'CANVAS' : (w.textContent.trim() ? 'TEXT' : 'EMPTY')) : 'NONE';
}, id);

(async () => {
  const srv = await serve(); const port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await boot(browser, port, { width: 390, height: 780 });   // mobile-size main page
  await seedSong(page);

  // ── [test blocks: appended by tasks 2–4 above this line] ──

  console.log(`\n${PASS}/${PASS + FAIL} passed, ${FAIL} failed`);
  await browser.close(); srv.close();
  process.exit(FAIL ? 1 : 0);
})();
```

- [ ] **Step 3: Run the scaffold — it must boot cleanly**

```bash
node _verify_lite_1074.js
```

Expected: `0/0 passed, 0 failed`, exit code 0, no `PAGEERROR`. (Firestore permission warnings are fine.)

- [ ] **Step 4: Commit**

```bash
git add lite-1.074.html _verify_lite_1074.js
git commit -m "chore(lite-1.074): snapshot from lite-1.073 + verify harness scaffold"
```

---

### Task 2: Loop playhead wraps every pass (`_phNow` + `toggleLoop` rebase)

**Files:**
- Modify: `lite-1.074.html` — functions `_phNow` (search `if (_phRegion) { const len = _phRegion.b - _phRegion.a;`) and `toggleLoop` (search `_curSource.loop = _loopTakes.has(id);`)
- Modify: `_verify_lite_1074.js` — add block T1

**Interfaces:**
- Consumes: scaffold helpers from Task 1 (`ok`, `page`).
- Produces: `_phNow()` now wraps whole-take loops; `toggleLoop(id)` rebases `_phOffset`/`_phStartCtx` and clears `_phRegion` when turning loop off mid-play. No signature changes.

- [ ] **Step 1: Add failing test block T1**

In `_verify_lite_1074.js`, insert immediately **above** the `// ── [test blocks: …] ──` marker:

```js
  // ── T1: playhead wraps on whole-take loop; toggleLoop-off rebases the clock ──
  const t1 = await page.evaluate(() => {
    const saved = { pt: _playingTakeId, ctx: _audioCtx, src: _curSource, sc: _phStartCtx, off: _phOffset, reg: _phRegion, loops: _loopTakes };
    _audioCtx = { currentTime: 5 };
    _curSource = { loop: true, buffer: { duration: 2 } };
    _playingTakeId = 'LT'; _phStartCtx = 0; _phOffset = 0; _phRegion = null;
    const wrapped = _phNow();                       // 5s into a 2s whole-take loop → 1s
    _phRegion = { a: 0.5, b: 1.0 };
    const regionWrapped = _phNow();                 // region branch must still win → 0.5
    _phRegion = null;
    _loopTakes = new Set(['LT']);
    toggleLoop('LT');                               // turns loop OFF mid-play → rebase
    const r = { wrapped, regionWrapped, rebasedOffset: _phOffset, rebasedStart: _phStartCtx, loopOff: _curSource.loop === false, regionCleared: _phRegion === null, after: _phNow() };
    _playingTakeId = saved.pt; _audioCtx = saved.ctx; _curSource = saved.src;
    _phStartCtx = saved.sc; _phOffset = saved.off; _phRegion = saved.reg; _loopTakes = saved.loops;
    renderTakes();
    return r;
  });
  const near = (a, b) => Math.abs(a - b) < 1e-9;
  ok(near(t1.wrapped, 1), 'T1 _phNow wraps whole-take loop (5s into 2s take → 1s)');
  ok(near(t1.regionWrapped, 0.5), 'T1 region loop still wraps via the region branch');
  ok(near(t1.rebasedOffset, 1) && near(t1.rebasedStart, 5), 'T1 toggleLoop-off rebases clock to wrapped position');
  ok(t1.loopOff && t1.regionCleared, 'T1 toggleLoop-off clears src.loop and _phRegion');
  ok(near(t1.after, 1), 'T1 playhead continuous across the loop-off toggle');
```

- [ ] **Step 2: Run — expect the new asserts to FAIL**

```bash
node _verify_lite_1074.js
```

Expected: `FAIL T1 _phNow wraps whole-take loop …` (wrapped = 5, not 1) and `FAIL … rebases clock …`. Exit 1.

- [ ] **Step 3: Implement in `lite-1.074.html`**

Edit 1 — in `_phNow` (anchor is unique; verify with `grep -c 'const len = _phRegion.b - _phRegion.a' lite-1.074.html` → 1). Replace:

```js
  if (_phRegion) { const len = _phRegion.b - _phRegion.a; if (len > 0 && t > _phRegion.b) t = _phRegion.a + ((t - _phRegion.a) % len); }
  return t;
```

with:

```js
  if (_phRegion) { const len = _phRegion.b - _phRegion.a; if (len > 0 && t > _phRegion.b) t = _phRegion.a + ((t - _phRegion.a) % len); }
  else if (_curSource && _curSource.loop && _curSource.buffer) { const d = _curSource.buffer.duration; if (d > 0) t = t % d; }   // whole-take loop: wrap every pass
  return t;
```

Edit 2 — in `toggleLoop` (anchor unique; `grep -c '_curSource.loop = _loopTakes.has(id);' lite-1.074.html` → 1). Replace:

```js
  if (_playingTakeId === id && _curSource) _curSource.loop = _loopTakes.has(id);
```

with:

```js
  if (_playingTakeId === id && _curSource) {
    const on = _loopTakes.has(id);
    // Turning loop OFF mid-play: rebase the playhead clock to the current wrapped position
    // (computed while src.loop is still true) so the line doesn't jump off-canvas.
    if (!on && _audioCtx) { _phOffset = _phNow(); _phStartCtx = _audioCtx.currentTime; _phRegion = null; }
    _curSource.loop = on;
  }
```

- [ ] **Step 4: Run — expect PASS**

```bash
node _verify_lite_1074.js
```

Expected: `5/5 passed, 0 failed`, exit 0.

- [ ] **Step 5: Commit**

```bash
git add lite-1.074.html _verify_lite_1074.js
git commit -m "fix(lite-1.074): playhead stays visible on every loop pass (wrap whole-take loops, rebase on loop-off)"
```

---

### Task 3: Pressing ▶ on a take loads its waveform (`playTake` → `wfLoad`)

**Files:**
- Modify: `lite-1.074.html` — end of `playTake` (search `updateRailPlayBtn(); renderTakes(); updateRail();`)
- Modify: `_verify_lite_1074.js` — add block T2

**Interfaces:**
- Consumes: scaffold helpers (`ok`, `page`, `waveState`); `seedSong` already ran on `page`.
- Produces: `playTake(id, opts)` now ends by calling `wfLoad(take)` — selecting-by-play always shows the waveform. No signature changes.

- [ ] **Step 1: Add failing test block T2**

In `_verify_lite_1074.js`, insert **above** the marker (after the T1 block):

```js
  // ── T2: pressing ▶ on a take shows its waveform (the "select twice" bug) ──
  await page.click('.takes-btn');                       // open the takes panel like a user
  await page.waitForTimeout(400);
  ok(await waveState(page, 't1') === 'CANVAS', 'T2 sanity: auto-selected take shows its waveform');
  await page.click('.take-row[data-id="t2"] .take-card .play');
  await page.waitForTimeout(600);
  const t2 = await page.evaluate(() => ({ wfId: _wf.takeId, playing: _playingTakeId }));
  ok(t2.playing === 't2', 'T2 ▶ press starts playback of t2');
  ok(t2.wfId === 't2', 'T2 ▶ press loads t2 into the waveform state');
  ok(await waveState(page, 't2') === 'CANVAS', 'T2 ▶ press renders t2 waveform canvas (one interaction)');
  await page.evaluate(() => stopPlayback());
  await page.click('.take-row[data-id="t1"] .take-card .nm');   // title-click path must still work
  await page.waitForTimeout(400);
  ok(await waveState(page, 't1') === 'CANVAS', 'T2 title click still shows waveform first time');
```

- [ ] **Step 2: Run — expect the two t2-waveform asserts to FAIL**

```bash
node _verify_lite_1074.js
```

Expected: `FAIL T2 ▶ press loads t2 into the waveform state` (wfId still `t1`) and `FAIL T2 ▶ press renders t2 waveform canvas` (state `EMPTY`). Others pass. Exit 1.

- [ ] **Step 3: Implement in `lite-1.074.html`**

In `playTake` (anchor unique; `grep -c 'updateRailPlayBtn(); renderTakes(); updateRail();' lite-1.074.html` → 1). Replace:

```js
  updateRailPlayBtn(); renderTakes(); updateRail();
```

with:

```js
  updateRailPlayBtn(); renderTakes(); updateRail();
  wfLoad(take);   // playing selects the take — show its waveform too (buffer already in _bufCache)
```

(`wfLoad` is idempotent: for an already-loaded take it early-returns to a re-render, so scrub/loop-region restarts that call `playTake` with opts don't reload or flicker.)

- [ ] **Step 4: Run — expect PASS**

```bash
node _verify_lite_1074.js
```

Expected: `10/10 passed, 0 failed`, exit 0.

- [ ] **Step 5: Commit**

```bash
git add lite-1.074.html _verify_lite_1074.js
git commit -m "fix(lite-1.074): pressing play on a take loads its waveform (no more second select)"
```

---

### Task 4: Takes panel opens by default on desktop (`_openSongObj`)

**Files:**
- Modify: `lite-1.074.html` — in `_openSongObj` (search `classList.remove('open')`)
- Modify: `_verify_lite_1074.js` — add block T3

**Interfaces:**
- Consumes: scaffold helpers (`ok`, `boot`, `browser`, `port`).
- Produces: on song open, `#takesPanel` gets `.open` iff `matchMedia('(min-width: 768px)')` matches. Mobile behavior unchanged.

- [ ] **Step 1: Add failing test block T3**

In `_verify_lite_1074.js`, insert **above** the marker (after the T2 block):

```js
  // ── T3: takes panel default-open on desktop, closed on mobile ──
  const pgD = await boot(browser, port, { width: 1280, height: 800 });
  await pgD.evaluate(() => { window._openSongObj({ id: 'S2', ownerId: 'guest', title: 'Desk Song', key: '', lyricsDoc: '<div>x</div>' }); });
  ok(await pgD.evaluate(() => document.getElementById('takesPanel').classList.contains('open')), 'T3 desktop (1280px): takes panel open on song open');
  const pgM = await boot(browser, port, { width: 390, height: 780 });
  await pgM.evaluate(() => { window._openSongObj({ id: 'S3', ownerId: 'guest', title: 'Phone Song', key: '', lyricsDoc: '<div>x</div>' }); });
  ok(await pgM.evaluate(() => !document.getElementById('takesPanel').classList.contains('open')), 'T3 mobile (390px): takes panel still closed on song open');
```

- [ ] **Step 2: Run — expect the desktop assert to FAIL**

```bash
node _verify_lite_1074.js
```

Expected: `FAIL T3 desktop (1280px): takes panel open on song open`; the mobile assert passes. Exit 1.

- [ ] **Step 3: Implement in `lite-1.074.html`**

In `_openSongObj` (anchor unique; `grep -c "takesPanel').classList.remove('open')" lite-1.074.html` → 1). Replace:

```js
  document.getElementById('takesPanel').classList.remove('open');
```

with:

```js
  // Desktop (≥768px: panel covers only the right half) starts with the takes list open;
  // mobile keeps the closed-by-default slide-over.
  document.getElementById('takesPanel').classList.toggle('open', matchMedia('(min-width: 768px)').matches);
```

- [ ] **Step 4: Run — expect PASS**

```bash
node _verify_lite_1074.js
```

Expected: `12/12 passed, 0 failed`, exit 0.

- [ ] **Step 5: Commit**

```bash
git add lite-1.074.html _verify_lite_1074.js
git commit -m "feat(lite-1.074): takes panel opens by default on desktop song open"
```

---

### Task 5: Regression run of the 1.073 suite against 1.074

**Files:**
- Create + delete: `_verify_lite_1073_on_1074.js` (throwaway sed copy, not committed)

**Interfaces:**
- Consumes: `_verify_lite_1073.js` (existing 73-assert suite for the base build) and `lite-1.074.html`.
- Produces: evidence that 1.074 doesn't regress 1.073 behavior.

- [ ] **Step 1: Baseline — the 1.073 suite must be green against 1.073**

```bash
node _verify_lite_1073.js | tail -3
```

Expected: all asserts pass, 0 failed. Note the exact PASS count (should be 73). If the baseline itself fails, STOP — report to the user; do not chase failures introduced before this work.

- [ ] **Step 2: Run the same suite against 1.074**

```bash
sed 's/lite-1\.073\.html/lite-1.074.html/g' _verify_lite_1073.js > _verify_lite_1073_on_1074.js
node _verify_lite_1073_on_1074.js | tail -3
rm _verify_lite_1073_on_1074.js
```

Expected: identical PASS count to Step 1, 0 failed. Any new failure = a regression from Tasks 2–4; fix before proceeding.

- [ ] **Step 3: Full new-suite rerun (final evidence)**

```bash
node _verify_lite_1074.js
```

Expected: `12/12 passed, 0 failed`, exit 0.

- [ ] **Step 4: Confirm nothing else changed and report**

```bash
git status --short          # should be clean (throwaway file removed)
git log --oneline main -5   # the 4 commits from tasks 1–4
```

Report results to the user. **Do not push** — the user decides when to deploy (`drafthaus.ca/lite-1.074.html`) and when to do iPhone QA / promote to `index.html`.
