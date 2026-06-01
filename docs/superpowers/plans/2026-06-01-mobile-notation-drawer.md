# Mobile Notation Keyboard Drawer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the **mobile-portrait** keyboard drawer body with a dark standard-notation editor (grand staff + Quick Chords overlay + togglable mini-keyboard) over the existing `pianoRoll`/`chordSlots` data — desktop and mobile-landscape untouched, with one sanctioned global change to the sequence-strip ▶.

**Architecture:** A new self-contained `ned*` ("notation editor drawer") module — an IIFE exposing `nedInit/nedCleanup/nedRender` plus `window.ned*` inline handlers — mounted **only** when the keyboard drawer opens in mobile-portrait (`_kbdPortMobile`). It reads/writes `getSongSequences(song)[seqActiveIdx].pianoRoll` (notes `{id,midi,startCol,durCols,chordName,degree,isPencil,vel}`, `prSnap=4` cols/beat) and `.chordSlots`, reusing existing helpers (`_prKeyLockSnap`, `_urStartRecording` count-in, the PR chord-drop writer, `getSongSequences`, `seqGetPartColor`). Rendering is a **relaxed notation-styled piano roll** in SVG: noteheads shaped by duration, rests fill empty beats, over-the-barline notes draw as ties, overlaps stack as chords, colour = scale degree. All bar math derives from the section's time signature (`seq.time`).

**Tech Stack:** Vanilla JS + inline SVG + Web Audio (existing), single-file `1.301.html`. No build, no test runner — verification drives the real app via `playwright-core` against installed Chrome (the `drafthaus-headless-verify` recipe). Versioning = file-copy: work lands in `1.301.html`; `index.html`/`1.3.html` (byte-identical, deployed) stay untouched until promotion.

**Source of truth:** `docs/superpowers/specs/2026-06-01-mobile-notation-drawer-design.md`. Reference mockups (gitignored, on disk): `.superpowers/brainstorm/91902-1780282419/content/layout-v15.html` (chrome) + `keyboard-A-final.html` (Keys mode).

---

## Conventions used by every task

**Working file:** all edits target `/Users/jasoncraig/Documents/Claude/Projects/Drafthaus/1.301.html`. Never edit `index.html` or `1.3.html`.

**Re-locate code by string, not line number** — line numbers in this plan are anchors captured on 2026-06-01 and will drift as you insert code. Always `grep -n "<quoted string>"` to confirm before editing.

**Namespace:** every new symbol is prefixed `ned` (functions/state) or `.ned-`/`#ned` (DOM/CSS) so it cannot collide with the existing `mpr*` (mobile piano roll) or `pr*` (desktop piano roll) code. The new module is **additive** — it does not modify `mprInit`, `prNotes`, or the desktop renderer.

**The shared verification harness.** Several tasks run the app headless. Save this once as `/Users/jasoncraig/Documents/Claude/Projects/Drafthaus/scripts/ned-verify.mjs` in Task 0, then each verification step `require`s/imports it. It boots the app past the onboarding walls in a 390×844 portrait viewport and exposes `page` for assertions.

```js
// scripts/ned-verify.mjs — shared headless boot for notation-drawer verification
import { chromium } from 'playwright-core';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const FILE = 'file://' + path.resolve(
  path.dirname(fileURLToPath(import.meta.url)), '..', '1.301.html');

export async function boot({ portrait = true } = {}) {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const context = await browser.newContext({
    viewport: portrait ? { width: 390, height: 844 } : { width: 1280, height: 800 },
    deviceScaleFactor: 2, isMobile: portrait, hasTouch: portrait,
  });
  await context.addInitScript(() => {
    localStorage['drafthaus-eula-accepted'] = '1';
  });
  const page = await context.newPage();
  const logs = [];
  page.on('console', m => logs.push(m.text()));
  await page.goto(FILE);
  await page.waitForFunction(() => typeof window.signInAsGuest === 'function');
  await page.evaluate(async () => {
    await window.signInAsGuest();
    await window._createAndLoadSong('NED Test');
    document.getElementById('pickFighterOverlay')?.remove();
    if (typeof openSong === 'function') openSong(window._songCurrentId);
  });
  await page.waitForTimeout(400);
  return { browser, context, page, logs };
}
```

**Desktop-untouched discipline.** The hard constraint is that the desktop and mobile-landscape code paths never execute new behaviour — **except** the one sanctioned `seqStripPlayToggle` change (Task 12). The new editor is gated behind `_kbdPortMobile`; if that gate is correct, desktop literally cannot reach the new code. Task 13 proves this by diffing desktop render output before/after.

**Commit cadence:** commit after every task (the step is spelled out per task). Commit messages end with the trailer:
```
Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
```

---

## File structure

This feature is **one new module + small surgical edits to three existing functions**, all inside `1.301.html`:

| Region (find by string) | Responsibility | Tasks |
|---|---|---|
| `function renderKeyboardDrawerHtml` → `if (!isDesktop)` block (`<div class="mpr-wrap" id="mprWrap">`) | Branch portrait → emit new `#nedWrap` markup instead of `#mprWrap` | 2, 7, 9 |
| `function openKeyboardDrawer` → RAF block (`_kbdMobileCompact && typeof mprInit`) | Route `_kbdPortMobile` → `nedInit()` instead of `mprInit()` | 2 |
| `function closeKeyboardDrawer` (`typeof mprCleanup === 'function'`) | Also call `nedCleanup()` | 2 |
| **New** `ned` IIFE (insert immediately after `function mprCleanup` ends) | All editor logic: state, render, entry, transport, chords, keys | 3–11 |
| New `.ned-*` CSS (insert near the `.mpr-*` rules) | Dark chrome styling | 2, 7, 9 |
| `function seqStripPlayToggle` | Sanctioned global change: play-from-selected-onward | 12 |
| `CLAUDE.md` | Update active-build line + strip-▶ note | 12, 13 |

Plus one new helper file: `scripts/ned-verify.mjs` (Task 0).

---

## Milestone A — scaffolding & gate (Tasks 0–2)

### Task 0: Verification harness + scratch baseline

**Files:**
- Create: `scripts/ned-verify.mjs` (content above)
- Create: `scripts/ned-desktop-baseline.mjs`

- [ ] **Step 1: Write the shared boot harness**

Create `scripts/ned-verify.mjs` with the exact content from "The shared verification harness" above.

- [ ] **Step 2: Confirm `playwright-core` + Chrome are available**

Run: `cd /Users/jasoncraig/Documents/Claude/Projects/Drafthaus && node -e "require('playwright-core'); console.log('ok')" && ls "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"`
Expected: prints `ok` and the Chrome path (no error). If `playwright-core` is missing, run `npm i -D playwright-core` first.

- [ ] **Step 3: Write the desktop baseline capture script**

Create `scripts/ned-desktop-baseline.mjs`:

```js
import { boot } from './ned-verify.mjs';
import fs from 'node:fs';
const out = process.argv[2] || 'desktop-before.json';
const { browser, page } = await boot({ portrait: false });
await page.evaluate(() => { if (typeof openKeyboardDrawer === 'function') openKeyboardDrawer(); });
await page.waitForTimeout(400);
const snap = await page.evaluate(() => {
  const b = document.getElementById('keyboardDrawerBody');
  return { bodyHTML: b ? b.innerHTML.length : -1,
           hasMprWrap: !!document.getElementById('mprWrap'),
           hasNedWrap: !!document.getElementById('nedWrap'),
           prPanel: !!document.getElementById('prPanel') };
});
fs.writeFileSync(out, JSON.stringify(snap, null, 2));
console.log('wrote', out, snap);
await browser.close();
```

- [ ] **Step 4: Capture the BEFORE-change desktop baseline**

Run: `cd /Users/jasoncraig/Documents/Claude/Projects/Drafthaus && node scripts/ned-desktop-baseline.mjs desktop-before.json`
Expected: prints a snapshot with `hasNedWrap: false`. This is the reference Task 13 diffs against.

- [ ] **Step 5: Commit**

```bash
git add scripts/ned-verify.mjs scripts/ned-desktop-baseline.mjs
git commit -m "test(ned): add headless verification harness + desktop baseline capture"
```

---

### Task 1: Prove the mobile-portrait gate exists and is reachable

No code change — this task pins the integration contract so later tasks insert in the right place.

**Files:**
- Read only: `1.301.html` (`function openKeyboardDrawer`, `renderKeyboardDrawerHtml`)

- [ ] **Step 1: Confirm the portrait detection expression**

Run: `grep -n "_kbdPortMobile" 1.301.html`
Expected: shows `const _kbdPortMobile = window.innerWidth < 768 && !_kbdLandMobile;` in `openKeyboardDrawer`, and its use in the RAF branch. Record the exact expression — Task 2 reuses it verbatim inside `renderKeyboardDrawerHtml`.

- [ ] **Step 2: Confirm the mobile body branch**

Run: `grep -n "if (!isDesktop)" 1.301.html | head` and `grep -n 'id="mprWrap"' 1.301.html`
Expected: the `if (!isDesktop)` block in `renderKeyboardDrawerHtml` returns the `#mprWrap` template literal. This is the branch Task 2 forks on portrait.

- [ ] **Step 3: Verify a portrait boot currently mounts `#mprWrap`**

Run this inline check:
```bash
node --input-type=module -e "
import { boot } from './scripts/ned-verify.mjs';
const { browser, page } = await boot({ portrait: true });
await page.evaluate(() => openKeyboardDrawer());
await page.waitForTimeout(400);
console.log(await page.evaluate(() => ({ mpr: !!document.getElementById('mprWrap'), ned: !!document.getElementById('nedWrap') })));
await browser.close();"
```
Expected: `{ mpr: true, ned: false }`. Confirms the portrait drawer is the surface to replace.

- [ ] **Step 4: Commit** (no source change — record findings in the task checkbox; nothing to commit). Skip if no file changed.

---

### Task 2: Mount an empty `#nedWrap` in portrait + wire init/cleanup

This stands up the new surface with a visible placeholder, proving the gate routes portrait → `ned` and leaves landscape/desktop on `mpr`.

**Files:**
- Modify: `1.301.html` `renderKeyboardDrawerHtml` `if (!isDesktop)` block
- Modify: `1.301.html` `openKeyboardDrawer` RAF branch
- Modify: `1.301.html` `closeKeyboardDrawer`
- Modify: `1.301.html` new `ned` IIFE (insert after `function mprCleanup` closes) + new `.ned-*` CSS

- [ ] **Step 1: Add the `ned` module skeleton**

Find the end of `function mprCleanup` (`grep -n "function mprCleanup" 1.301.html`, then read to its closing brace). Immediately after it, insert:

```js
// ════════════════════════════════════════════════════════════════
//  MOBILE-PORTRAIT NOTATION EDITOR (ned*) — replaces mpr in portrait
//  Same data: getSongSequences(song)[seqActiveIdx].pianoRoll + chordSlots
// ════════════════════════════════════════════════════════════════
(function(){
  let _nedMounted = false;
  let _nedDur = 1;            // selected note length in beats (whole=default per spec)
  let _nedTool = 'pencil';    // 'pointer' | 'pencil' | 'eraser'
  let _nedScrollBar = 0;      // leftmost visible bar (2-bar window)

  function _nedSeq() {
    const song = (typeof getCurrentSong === 'function') ? getCurrentSong() : null;
    if (!song) return null;
    const seqs = getSongSequences(song);
    return seqs[Math.min(seqActiveIdx, seqs.length - 1)] || null;
  }

  function nedInit() {
    const wrap = document.getElementById('nedWrap');
    if (!wrap) return;
    _nedMounted = true;
    nedRender();
  }
  function nedCleanup() { _nedMounted = false; }
  function nedRender() {
    if (!_nedMounted) return;
    const staff = document.getElementById('nedStaff');
    if (staff) staff.innerHTML = '<div style="color:#5a5f72;font-size:11px;text-align:center;padding:40px;">notation editor — staff renders in Milestone B</div>';
  }

  // expose
  window.nedInit = nedInit;
  window.nedCleanup = nedCleanup;
  window.nedRender = nedRender;
  window._nedSetTool = function(t){ _nedTool = t; nedRender(); };
  window._nedSetDur  = function(d){ _nedDur = parseFloat(d); nedRender(); };
})();
```

- [ ] **Step 2: Add the portrait branch + markup in `renderKeyboardDrawerHtml`**

Find `if (!isDesktop) {` inside `renderKeyboardDrawerHtml`. Immediately after that line, insert a portrait fork that returns the new chrome (the full toolbar/tools/UCB chrome is fleshed out in Tasks 7/9 — here it is the minimal shell so the gate is testable):

```js
    const _nedPortrait = window.innerWidth < 768 &&
      !(window.innerWidth < 768 && window.innerHeight <= 500 &&
        window.matchMedia('(orientation: landscape)').matches);
    if (_nedPortrait) {
      return `
      <div class="ned-wrap" id="nedWrap">
        <div class="ned-staff" id="nedStaff"></div>
      </div>`;
    }
```

Leave the existing `#mprWrap` return below untouched (it now serves landscape only).

- [ ] **Step 3: Route the RAF branch to `nedInit` in portrait**

Find in `openKeyboardDrawer` the line `if (_kbdMobileCompact && typeof mprInit === 'function' && document.getElementById('mprWrap')) {`. Replace that whole `if (...) { mprInit(); ... }` head so portrait uses the notation editor:

```js
    if (_kbdPortMobile && document.getElementById('nedWrap') && typeof nedInit === 'function') {
      nedInit();
      _midiUpdateUI();
      seqBuildGrids(song);
      seqRenderChordPills(song);
    } else if (_kbdMobileCompact && typeof mprInit === 'function' && document.getElementById('mprWrap')) {
      mprInit();
      _midiUpdateUI();
      seqBuildGrids(song);
      seqRenderChordPills(song);
      if (_kbdPortMobile && typeof kbdPortUpdatePeek === 'function') { kbdPortUpdatePeek(); kbdPortUpdateBadge(); }
    } else if (!_kbdMobileCompact) {
```

(Keep the existing desktop `else if (!_kbdMobileCompact)` body exactly as-is.)

- [ ] **Step 4: Call `nedCleanup` on close**

Find in `closeKeyboardDrawer` the line `if (typeof mprCleanup === 'function') mprCleanup();`. Add immediately after:

```js
  if (typeof nedCleanup === 'function') nedCleanup();
```

- [ ] **Step 5: Add base `.ned-*` CSS**

Find the `.mpr-wrap` CSS rule (`grep -n "\.mpr-wrap" 1.301.html`). Insert nearby:

```css
.ned-wrap { display:flex; flex-direction:column; height:100%; background:#0d0e13; color:#e8e8ee; font-family:'IBM Plex Mono',monospace; }
.ned-staff { position:relative; flex:1; min-height:0; background:#0d0e13; overflow:hidden; }
```

- [ ] **Step 6: Verify the gate routes correctly**

```bash
node --input-type=module -e "
import { boot } from './scripts/ned-verify.mjs';
const { browser, page } = await boot({ portrait: true });
await page.evaluate(() => openKeyboardDrawer());
await page.waitForTimeout(400);
console.log('portrait', await page.evaluate(() => ({ mpr: !!document.getElementById('mprWrap'), ned: !!document.getElementById('nedWrap') })));
await browser.close();"
```
Expected: `portrait { mpr: false, ned: true }`.

- [ ] **Step 7: Verify landscape + desktop still mount `mpr` / desktop body (no `nedWrap`)**

```bash
node --input-type=module -e "
import { boot } from './scripts/ned-verify.mjs';
const { browser, page } = await boot({ portrait: false });
await page.evaluate(() => openKeyboardDrawer());
await page.waitForTimeout(400);
console.log('desktop', await page.evaluate(() => ({ ned: !!document.getElementById('nedWrap') })));
await browser.close();"
```
Expected: `desktop { ned: false }`.

- [ ] **Step 8: Commit**

```bash
git add 1.301.html
git commit -m "feat(ned): mount portrait notation-editor shell behind _kbdPortMobile gate"
```

---

## Milestone B — staff renderer (Tasks 3–6)

The renderer is the core. Build it bottom-up: time-signature bar math → empty staff + bars → noteheads/rests/ties → beams. Simple meters (4/4, 3/4, 2/4, 5/4) ship first; compound-meter beaming (6/8 in threes) is isolated in Task 6 so it can't block.

### Task 3: Time-signature-aware bar math

**Files:**
- Modify: `1.301.html` `ned` IIFE (add the math helpers)

- [ ] **Step 1: Add `seq.time` parsing + bar/column helpers**

Inside the `ned` IIFE (before `nedInit`), add:

```js
  const NED_SNAP = 4; // cols per beat — MUST equal prSnap (1/16 grid)

  // Parse seq.time → { beatsPerBar, beatUnit, compound, groups }
  // seq.time is stored as a string: '4' meaning 4/4, or 'n/d' like '6/8','3/4','5/4'.
  function _nedMeter(seq) {
    const raw = String((seq && seq.time) || '4');
    let num, den;
    if (raw.indexOf('/') >= 0) { const p = raw.split('/'); num = parseInt(p[0]); den = parseInt(p[1]); }
    else { num = parseInt(raw) || 4; den = 4; }
    const compound = (den === 8 && num % 3 === 0 && num > 3); // 6/8, 9/8, 12/8
    // beatsPerBar in QUARTER-NOTE beats (prSnap is per quarter): each 1/den note = 4/den quarters
    const beatsPerBar = num * (4 / den);
    // beaming groups, in quarter-beats: compound → groups of 3 eighths (1.5 quarters); simple → per beat
    const groups = compound ? Array(num / 3).fill(1.5) : Array(num).fill(4 / den);
    return { num, den, compound, beatsPerBar, beatUnit: 4 / den, groups };
  }

  // columns per bar (integer, for the grid)
  function _nedColsPerBar(seq) { return Math.round(_nedMeter(seq).beatsPerBar * NED_SNAP); }
  // selected note length (beats) → columns
  function _nedDurToCols(seq) { return Math.max(1, Math.round(_nedDur * NED_SNAP)); }
  // total bars in the section (from seq.bars), min 1
  function _nedBarCount(seq) { return Math.max(1, parseInt((seq && seq.bars) || '4') || 4); }
```

- [ ] **Step 2: Verify the math against known meters**

```bash
node --input-type=module -e "
import { boot } from './scripts/ned-verify.mjs';
const { browser, page } = await boot({ portrait: true });
const r = await page.evaluate(() => {
  // exercise the private helpers via a temporary global the module can expose for test
  return window.__nedMeterTest ? window.__nedMeterTest() : 'no-test-hook';
});
console.log(r);
await browser.close();"
```

To make this assertable, temporarily expose a test hook at the end of the IIFE:
```js
  window.__nedMeterTest = function(){
    return ['4','3/4','6/8','5/4'].map(t => { const m=_nedMeter({time:t}); return t+'→bpb='+m.beatsPerBar+' cols='+_nedColsPerBar({time:t})+' compound='+m.compound+' groups='+m.groups.join(','); });
  };
```
Expected: `4→bpb=4 cols=16 compound=false groups=1,1,1,1`, `3/4→bpb=3 cols=12 ... groups=1,1,1`, `6/8→bpb=3 cols=12 compound=true groups=1.5,1.5`, `5/4→bpb=5 cols=20 ... groups=1,1,1,1,1`.

- [ ] **Step 3: Commit**

```bash
git add 1.301.html
git commit -m "feat(ned): time-signature-aware bar/column math (simple + compound meters)"
```

---

### Task 4: Render the empty grand staff (2-bar window + bar numbers + h-scroll)

**Files:**
- Modify: `1.301.html` `ned` IIFE (`nedRender` → real SVG), `.ned-*` CSS

- [ ] **Step 1: Add staff geometry constants + pitch↔y mapping**

Inside the IIFE, add (values match the mockup `layout-v15.html`: 5 treble lines, gap to bass, 30px line spacing):

```js
  // staff geometry (per the layout-v15 mockup)
  const NED_LINE_GAP = 15;   // px per diatonic step (line→space); adjacent staff LINES are 2 steps = NED_LINE_GAP*2 apart
  const NED_TREBLE_TOP = 44; // y of top treble line (F5)
  const NED_BASS_TOP   = 254;// y of top bass line
  const NED_BAR_PAD = 12;    // left/right inset
  // Diatonic staff position: treble top line = F5(MIDI 77); each step = a line/space (semitone-agnostic, diatonic).
  // Map MIDI → diatonic staff index using C-major letter positions; sharps share the line below.
  const _NED_LETTER = [0,0,1,1,2,3,3,4,4,5,5,6]; // C C# D D# E F F# G G# A A# B → letter index
  function _nedDiatonic(midi){ const oct=Math.floor(midi/12)-1; const l=_NED_LETTER[((midi%12)+12)%12]; return oct*7 + l; }
  // F5 (midi 77) sits at NED_TREBLE_TOP; each diatonic step = NED_LINE_GAP px, so line→line (2 steps) = NED_LINE_GAP*2 (matches the drawn staff lines at i*NED_LINE_GAP*2). Verified: F5→44, D5→74, E4→164.
  function _nedMidiToY(midi){ const ref=_nedDiatonic(77); const steps=ref-_nedDiatonic(midi); return NED_TREBLE_TOP + steps*NED_LINE_GAP; }
```

- [ ] **Step 2: Replace `nedRender` with the empty-staff SVG painter**

```js
  function nedRender() {
    if (!_nedMounted) return;
    const staff = document.getElementById('nedStaff');
    const seq = _nedSeq();
    if (!staff || !seq) return;
    const cpb = _nedColsPerBar(seq);
    const totalBars = _nedBarCount(seq);
    const W = staff.clientWidth || 390;
    const barW = (W - NED_BAR_PAD*2) / 2;      // 2 bars across the viewport
    const winBars = Math.min(2, totalBars);
    let svg = `<svg width="${W}" height="386" viewBox="0 0 ${W} 386" class="ned-svg">`;
    // staff lines (treble 5 + bass 5)
    svg += `<g stroke="#fff" stroke-width="1.1">`;
    for (let i=0;i<5;i++){ const y=NED_TREBLE_TOP+i*NED_LINE_GAP*2; svg+=`<line x1="${NED_BAR_PAD}" y1="${y}" x2="${W-NED_BAR_PAD}" y2="${y}"/>`; }
    for (let i=0;i<5;i++){ const y=NED_BASS_TOP+i*NED_LINE_GAP*2; svg+=`<line x1="${NED_BAR_PAD}" y1="${y}" x2="${W-NED_BAR_PAD}" y2="${y}"/>`; }
    svg += `</g>`;
    // barlines + green bar numbers for the visible window
    svg += `<g stroke="#fff" stroke-width="1.1">`;
    for (let b=0;b<=winBars;b++){ const x=NED_BAR_PAD+b*barW; svg+=`<line x1="${x}" y1="${NED_TREBLE_TOP}" x2="${x}" y2="${NED_BASS_TOP+4*NED_LINE_GAP*2}"/>`; }
    svg += `</g>`;
    for (let b=0;b<winBars;b++){ const x=NED_BAR_PAD+b*barW+4; svg+=`<text x="${x}" y="27" font-size="14" fill="#6ee89a" font-family="monospace" font-weight="700">${_nedScrollBar+b+1}</text>`; }
    svg += `</svg>`;
    staff.innerHTML = svg
      + `<div class="ned-scrollhint">‹ bars ${_nedScrollBar+1}–${Math.min(_nedScrollBar+winBars,totalBars)} of ${totalBars} · swipe ›</div>`;
    // expose px-per-column for the entry layer
    staff.dataset.barw = barW; staff.dataset.cpb = cpb;
  }
```

- [ ] **Step 3: Add the scroll-hint CSS**

```css
.ned-scrollhint { position:absolute; left:0; right:0; bottom:6px; text-align:center; color:#5a5f72; font-size:10px; pointer-events:none; }
.ned-svg { display:block; position:absolute; top:0; left:0; }
```

- [ ] **Step 4: Add horizontal-swipe paging of the 2-bar window**

Append inside `nedInit` (after the first `nedRender()`):

```js
    const staffEl = document.getElementById('nedStaff');
    if (staffEl && !staffEl._nedSwipeBound) {
      staffEl._nedSwipeBound = true;
      let sx=0;
      staffEl.addEventListener('touchstart', e=>{ sx=e.touches[0].clientX; }, {passive:true});
      staffEl.addEventListener('touchend', e=>{
        const dx=(e.changedTouches[0].clientX)-sx; if (Math.abs(dx)<40) return;
        const seq=_nedSeq(); const total=_nedBarCount(seq);
        _nedScrollBar = Math.max(0, Math.min(total-2, _nedScrollBar - Math.sign(dx)*2));
        nedRender();
      }, {passive:true});
    }
```

- [ ] **Step 5: Verify the empty staff renders with correct bar numbers**

```bash
node --input-type=module -e "
import { boot } from './scripts/ned-verify.mjs';
const { browser, page } = await boot({ portrait: true });
await page.evaluate(() => { const s=getCurrentSong(); getSongSequences(s)[seqActiveIdx].bars='4'; openKeyboardDrawer(); });
await page.waitForTimeout(500);
console.log(await page.evaluate(() => {
  const svg=document.querySelector('#nedStaff .ned-svg');
  const nums=[...document.querySelectorAll('#nedStaff text')].map(t=>t.textContent);
  return { lines: document.querySelectorAll('#nedStaff line').length, barNums: nums };
}));
await browser.close();"
```
Expected: `lines: 13` (10 staff + 3 barlines for a 2-bar window) and `barNums: ['1','2']`.

- [ ] **Step 6: Commit**

```bash
git add 1.301.html
git commit -m "feat(ned): render empty dark grand staff — 2-bar window, green bar numbers, swipe paging"
```

---

### Task 5: Render notes — noteheads by duration, rainbow by degree, rests, ties

**Files:**
- Modify: `1.301.html` `ned` IIFE (note-drawing inside `nedRender`)

- [ ] **Step 1: Add the rainbow palette + notehead/rest builders**

Inside the IIFE add (palette values copied from `1.301.html:68239`):

```js
  const _NED_RBW = ['#e53e3e','#ed8936','#ecc94b','#48bb78','#4fd1c5','#4299e1','#9f7aea'];
  const _NED_RBB = ['#7f1d1d','#7c2d12','#713f12','#14532d','#134e4a','#1e3a5f','#3b1f6e'];
  function _nedColor(n){
    const deg = (typeof n.degree==='number' && n.degree>=0) ? n.degree : 0;
    const isBlack = [1,3,6,8,10].indexOf(((n.midi%12)+12)%12) >= 0;
    return (isBlack ? _NED_RBB : _NED_RBW)[deg % 7];
  }
  // notehead SVG at (cx,cy), coloured, shaped by durCols (in 1/16 cols): >=16 whole(open),
  // 8 half(open+stem), 4 quarter(filled+stem), 2 eighth(+flag), 1 sixteenth(+2 flags)
  function _nedNotehead(cx, cy, durCols, color){
    const open = durCols >= 8;
    const fill = open ? 'none' : color;
    let s = `<ellipse cx="${cx}" cy="${cy}" rx="7" ry="5" fill="${fill}" stroke="${color}" stroke-width="2.2" transform="rotate(-15,${cx},${cy})"/>`;
    if (durCols < 16) s += `<line x1="${cx+6}" y1="${cy}" x2="${cx+6}" y2="${cy-26}" stroke="${color}" stroke-width="1.8"/>`; // stem (not on whole)
    if (durCols === 2) s += `<path d="M${cx+6},${cy-26} c5,2 7,6 4,11" fill="none" stroke="${color}" stroke-width="1.8"/>`; // 8th flag (single notes; beams handled in Task 6)
    if (durCols === 1) s += `<path d="M${cx+6},${cy-26} c5,2 7,6 4,11 M${cx+6},${cy-19} c5,2 7,6 4,11" fill="none" stroke="${color}" stroke-width="1.8"/>`;
    return s;
  }
  function _nedRest(cx, durCols){ // simple rest glyph centred in its slot, mid-staff
    const y = (NED_TREBLE_TOP + NED_BASS_TOP)/2;
    return `<text x="${cx-4}" y="${y+5}" font-size="18" fill="#6a6f82" font-family="serif">𝄽</text>`;
  }
```

- [ ] **Step 2: Draw notes + rests + ties inside `nedRender`**

Just before the closing `svg += \`</svg>\`;` in `nedRender`, insert the note pass. It reads `seq.pianoRoll`, clips to the visible 2-bar window, colours by degree, and renders a tie arc + continuation when a note crosses the right barline of the window or a bar boundary:

```js
    const cols = (seq.pianoRoll || []);
    const winStartCol = _nedScrollBar * cpb;
    const winEndCol   = winStartCol + winBars * cpb;
    const colPx = barW / cpb;
    cols.forEach(n => {
      const start = n.startCol|0, end = start + (n.durCols|0);
      if (end <= winStartCol || start >= winEndCol) return; // off-window
      const cx = NED_BAR_PAD + (start - winStartCol) * colPx + colPx/2;
      const cy = _nedMidiToY(n.midi);
      const color = _nedColor(n);
      svg += _nedNotehead(cx, cy, n.durCols|0, color);
      // tie: if the note crosses a barline within the window, draw a tie arc to the bar start
      const crossesBar = Math.floor(start / cpb) !== Math.floor((end-1) / cpb);
      if (crossesBar) {
        const barX = NED_BAR_PAD + (Math.ceil(start/cpb)*cpb - winStartCol) * colPx;
        svg += `<path d="M${cx},${cy+8} Q${(cx+barX)/2},${cy+16} ${barX},${cy+8}" fill="none" stroke="${color}" stroke-width="1.6" opacity="0.8"/>`;
      }
    });
    // rests: for each beat slot in the window with no note onset, draw a rest
    for (let b=0;b<winBars;b++){
      for (let beat=0; beat<_nedMeter(seq).num; beat++){
        const slotCol = winStartCol + b*cpb + beat*_nedMeter(seq).beatUnit*NED_SNAP;
        const occupied = cols.some(n => n.startCol <= slotCol && (n.startCol+n.durCols) > slotCol);
        if (!occupied) svg += _nedRest(NED_BAR_PAD + (slotCol - winStartCol)*colPx + colPx/2, _nedMeter(seq).beatUnit*NED_SNAP);
      }
    }
```

- [ ] **Step 3: Verify a placed note renders coloured at the right beat**

```bash
node --input-type=module -e "
import { boot } from './scripts/ned-verify.mjs';
const { browser, page } = await boot({ portrait: true });
await page.evaluate(() => {
  const seq=getSongSequences(getCurrentSong())[seqActiveIdx];
  seq.bars='2'; seq.time='4';
  seq.pianoRoll=[{id:1,midi:60,startCol:0,durCols:16,degree:0,isPencil:true,vel:0.8}]; // whole note C
  openKeyboardDrawer();
});
await page.waitForTimeout(500);
console.log(await page.evaluate(() => {
  const e=document.querySelector('#nedStaff ellipse');
  return { hasNote: !!e, stroke: e && e.getAttribute('stroke'), fill: e && e.getAttribute('fill') };
}));
await browser.close();"
```
Expected: `{ hasNote: true, stroke: '#e53e3e', fill: 'none' }` (degree 0 = red, whole note = open/no fill).

- [ ] **Step 4: Commit**

```bash
git add 1.301.html
git commit -m "feat(ned): draw noteheads (shape=duration), rainbow-by-degree, rests, barline ties"
```

---

### Task 6: Beaming runs of 8ths/16ths (simple + compound meters)

**Files:**
- Modify: `1.301.html` `ned` IIFE

- [ ] **Step 1: Group consecutive short notes per beaming group and draw beams**

This replaces single-flag drawing for runs. Add a beaming pass that, per beaming group (from `_nedMeter().groups`), collects notes whose `durCols` ≤ 2 and joins their stem-tops with a beam line. For compound meters the groups are already in threes (Task 3), so 6/8 beams in threes for free.

Add inside `nedRender`, after the note pass:

```js
    // BEAMING: within each beaming group, join runs of 8ths/16ths (durCols<=2) with a beam
    (function(){
      const m = _nedMeter(seq);
      let groupStartCol = 0;
      for (let b=0;b<winBars;b++){
        m.groups.forEach(gBeats => {
          const gCols = Math.round(gBeats*NED_SNAP);
          const gStart = winStartCol + b*cpb + groupStartCol;
          const run = (seq.pianoRoll||[]).filter(n => n.durCols<=2 && n.startCol>=gStart && n.startCol<gStart+gCols)
                                          .sort((a,b)=>a.startCol-b.startCol);
          if (run.length>=2){
            const colPx = barW/cpb;
            const x1 = NED_BAR_PAD+(run[0].startCol-winStartCol)*colPx+colPx/2+6;
            const xN = NED_BAR_PAD+(run[run.length-1].startCol-winStartCol)*colPx+colPx/2+6;
            const yTop = Math.min(...run.map(n=>_nedMidiToY(n.midi)))-26;
            svg += `<line x1="${x1}" y1="${yTop}" x2="${xN}" y2="${yTop}" stroke="${_nedColor(run[0])}" stroke-width="3"/>`;
            if (run.every(n=>n.durCols===1)) svg += `<line x1="${x1}" y1="${yTop+5}" x2="${xN}" y2="${yTop+5}" stroke="${_nedColor(run[0])}" stroke-width="3"/>`;
          }
          groupStartCol += gCols;
        });
        groupStartCol = 0;
      }
    })();
```

- [ ] **Step 2: Suppress single flags on beamed notes**

In `_nedNotehead`, the flag is only correct for an isolated short note. Add a `beamed` param defaulting false and skip the flag when true; pass `true` from the note pass when the note is part of a run of ≥2. (Simplest: in the note pass, compute a `Set` of beamed note ids first, then pass `beamed = beamedIds.has(n.id)`.)

```js
  function _nedNotehead(cx, cy, durCols, color, beamed){
    /* ...notehead + stem as before... */
    if (!beamed && durCols === 2) s += /* single 8th flag */;
    if (!beamed && durCols === 1) s += /* double 16th flag */;
    return s;
  }
```

- [ ] **Step 3: Verify two adjacent 8ths beam in 4/4**

```bash
node --input-type=module -e "
import { boot } from './scripts/ned-verify.mjs';
const { browser, page } = await boot({ portrait: true });
await page.evaluate(() => {
  const seq=getSongSequences(getCurrentSong())[seqActiveIdx];
  seq.bars='2'; seq.time='4';
  seq.pianoRoll=[{id:1,midi:60,startCol:0,durCols:2,degree:0,isPencil:true},{id:2,midi:62,startCol:2,durCols:2,degree:1,isPencil:true}];
  openKeyboardDrawer();
});
await page.waitForTimeout(500);
console.log(await page.evaluate(() => ({ beams: [...document.querySelectorAll('#nedStaff line')].filter(l=>l.getAttribute('stroke-width')==='3').length })));
await browser.close();"
```
Expected: `{ beams: 1 }` (one beam joining the two 8ths).

- [ ] **Step 4: Verify 6/8 beams the six 8ths as two groups of three**

```bash
node --input-type=module -e "
import { boot } from './scripts/ned-verify.mjs';
const { browser, page } = await boot({ portrait: true });
await page.evaluate(() => {
  const seq=getSongSequences(getCurrentSong())[seqActiveIdx];
  seq.bars='1'; seq.time='6/8';
  seq.pianoRoll=[0,1,2,3,4,5].map(i=>({id:i+1,midi:60+i,startCol:i*2,durCols:2,degree:i%7,isPencil:true}));
  openKeyboardDrawer();
});
await page.waitForTimeout(500);
console.log(await page.evaluate(() => ({ beams: [...document.querySelectorAll('#nedStaff line')].filter(l=>l.getAttribute('stroke-width')==='3').length })));
await browser.close();"
```
Expected: `{ beams: 2 }` (two beam groups of three).

- [ ] **Step 5: Commit**

```bash
git add 1.301.html
git commit -m "feat(ned): beam runs of 8ths/16ths per beat group (compound meters beam in threes)"
```

---

## Milestone C — note entry (Tasks 7–8)

### Task 7: Toolbar + tools row + UCB chrome (portrait)

**Files:**
- Modify: `1.301.html` `renderKeyboardDrawerHtml` portrait return (flesh out `#nedWrap`), `.ned-*` CSS

- [ ] **Step 1: Replace the minimal `#nedWrap` shell with the full chrome**

Using the markup/colours from `layout-v15.html` (the source mockup), expand the portrait return to include, top→bottom: five note-length buttons (left) + 🔒 Key + 🎲 Vel (right); tools row (mouse-cursor-arrow pointer, ✎ pencil, ✕ erase + ⌄ Close); the stripped UCB (Click · ● REC · ▶ Play · TAP · BPM); then `#nedStaff`. Wire each control to the `window._ned*` handlers (added in later steps). **Pointer icon must be the mouse-cursor SVG arrow** from the mockup (`<path d="M3 2 L3 17 L7 13 L9.6 18.4 L11.7 17.4 L9.1 12 L14 12 Z"/>`), NOT a triangle.

Note-length buttons reuse the desktop `pr-dur-btn` notehead SVGs (copy from `1.301.html:67204`–`67208`) and call `window._nedSetDur('1'|'0.5'|'0.25'|'0.125'|'0.0625')`. (Default selected = whole, per spec.)

- [ ] **Step 2: Wire 🔒 Key + 🎲 Vel to existing engine state**

🔒 Key toggles `_prKeyLock` (reuse — `grep -n "_prKeyLock = !_prKeyLock" 1.301.html` shows the toggler at ~`45961`; call it and re-render the button active state + `nedRender()`). 🎲 Vel calls `prRandomizeVelocity` if present and shows the existing toast "randomized velocity" (reuse the app's toast helper — `grep -n "function showToast\|toast(" 1.301.html`).

- [ ] **Step 3: Wire tool buttons to `_nedSetTool`**

Pointer/pencil/eraser call `window._nedSetTool('pointer'|'pencil'|'eraser')` and toggle an `.ned-tool-active` class. ⌄ Close calls `closeKeyboardDrawer()`.

- [ ] **Step 4: Add `.ned-*` chrome CSS** (toolbar/tools/UCB rows) mirroring the mockup's dark palette and the spec's sizes (tools ~46×38, Play centered & wider, REC red ●).

- [ ] **Step 5: Verify the chrome renders with the correct controls**

```bash
node --input-type=module -e "
import { boot } from './scripts/ned-verify.mjs';
const { browser, page } = await boot({ portrait: true });
await page.evaluate(() => openKeyboardDrawer());
await page.waitForTimeout(500);
console.log(await page.evaluate(() => ({
  durBtns: document.querySelectorAll('#nedWrap .ned-dur-btn').length,
  hasRec: !!document.querySelector('#nedWrap .ned-rec'),
  hasPlay: !!document.querySelector('#nedWrap .ned-play'),
  pointerIsArrow: !!document.querySelector('#nedWrap .ned-tool-pointer path'),
})));
await browser.close();"
```
Expected: `{ durBtns: 5, hasRec: true, hasPlay: true, pointerIsArrow: true }`.

- [ ] **Step 6: Commit**

```bash
git add 1.301.html
git commit -m "feat(ned): portrait chrome — note-length btns, KeyLock/Vel, tools (cursor-arrow pointer), UCB"
```

---

### Task 8: Pencil / pointer / eraser note entry (free-placement + same-pitch de-dupe)

This is the decided bar-fill rule. **Pure free-placement: placement only ADDS a note; the sole exception is same-pitch de-dupe** (a tap on the exact same `midi` whose time overlaps replaces the old note). Reuses the engine's existing append pattern and `_prKeyLockSnap`.

**Files:**
- Modify: `1.301.html` `ned` IIFE (pointer event handlers on `#nedStaff`), `_nedSeq` save path

- [ ] **Step 1: Add coordinate→(col,midi) mapping**

```js
  function _nedXToCol(staff, clientX){
    const r = staff.getBoundingClientRect();
    const seq=_nedSeq(); const cpb=_nedColsPerBar(seq);
    const barW = parseFloat(staff.dataset.barw)||((r.width-NED_BAR_PAD*2)/2);
    const colPx = barW/cpb;
    const raw = (clientX - r.left - NED_BAR_PAD)/colPx + _nedScrollBar*cpb;
    const snapCols = _nedDurToCols(seq); // pencil snaps start to selected-length grid
    return Math.max(0, Math.round(raw/snapCols)*snapCols);
  }
  function _nedYToMidi(staff, clientY){
    const r = staff.getBoundingClientRect();
    // invert _nedMidiToY: find midi whose y is nearest
    let best=60, bestd=1e9;
    for (let mi=36; mi<=96; mi++){ const d=Math.abs((_nedMidiToY(mi)) - (clientY - r.top)); if (d<bestd){bestd=d;best=mi;} }
    return (typeof _prKeyLockSnap==='function') ? _prKeyLockSnap(best) : best;
  }
  function _nedSave(){ const seq=_nedSeq(); if (seq && typeof prSavePianoRoll==='function') prSavePianoRoll(); else if (typeof save==='function') save(); }
```

- [ ] **Step 2: Add the pencil place handler (free-placement + same-pitch de-dupe)**

```js
  function _nedPencilPlace(staff, clientX, clientY){
    const seq=_nedSeq(); if (!seq) return;
    if (!seq.pianoRoll) seq.pianoRoll=[];
    const col=_nedXToCol(staff,clientX), midi=_nedYToMidi(staff,clientY);
    const durCols=_nedDurToCols(seq);
    const end=col+durCols;
    // SAME-PITCH DE-DUPE (the one exception): drop the exact same midi overlapping in time → remove old, new wins
    seq.pianoRoll = seq.pianoRoll.filter(n => !(n.midi===midi && n.startCol < end && (n.startCol+n.durCols) > col));
    const deg = (typeof _prDegreeForMidi==='function') ? _prDegreeForMidi(midi) : -1; // reuse degree calc if present
    seq.pianoRoll.push({ id: (window.prNextId? prNextId++ : Date.now()), midi, startCol:col, durCols,
      chordName:'', degree:deg, isPencil:true, vel:0.85 });
    if (typeof prPreviewNote==='function') prPreviewNote({midi}); // audio feedback
    nedRender(); _nedSave();
  }
```

Note on `degree`: confirm the existing degree helper name with `grep -n "function _prDegree\|degreeForMidi\|_prScaleDegree" 1.301.html`; if none, compute degree from `song.key` the same way the desktop renderer does (it already sets `degree` on placed notes — reuse that exact code).

- [ ] **Step 3: Bind tap (and drag-paint) for pencil; tap-select/move for pointer; tap/drag-delete for eraser**

Bind `pointerdown` on `#nedStaff`. Branch on `_nedTool`:
- `pencil`: `_nedPencilPlace` on down; on move past an 8px threshold, paint at each new (col,midi) (mirror the desktop paint loop at `1.301.html:68977`).
- `pointer`: hit-test nearest note → set a `_nedSelected` id; drag moves it on the **fine 1/16 grid** (`Math.round(raw)` not snapped to selected length); marquee when starting on empty space (reuse `prMultiSelected` Set for group ops).
- `eraser`: hit-test → remove note; drag wipes intersecting notes.

- [ ] **Step 4: Verify pencil places a note and same-pitch de-dupes**

```bash
node --input-type=module -e "
import { boot } from './scripts/ned-verify.mjs';
const { browser, page } = await boot({ portrait: true });
await page.evaluate(() => { const s=getSongSequences(getCurrentSong())[seqActiveIdx]; s.bars='2'; s.time='4'; s.pianoRoll=[]; openKeyboardDrawer(); window._nedSetDur('0.25'); window._nedSetTool('pencil'); });
await page.waitForTimeout(400);
// tap twice at the same staff point → de-dupe keeps 1 note at that midi/col
const box = await page.evaluate(() => { const r=document.getElementById('nedStaff').getBoundingClientRect(); return {x:r.left+60,y:r.top+150}; });
await page.mouse.click(box.x, box.y); await page.waitForTimeout(50); await page.mouse.click(box.x, box.y);
await page.waitForTimeout(100);
console.log(await page.evaluate(() => { const pr=getSongSequences(getCurrentSong())[seqActiveIdx].pianoRoll; return { count: pr.length, sameMidi: pr.length? pr.every(n=>n.midi===pr[0].midi):true }; }));
await browser.close();"
```
Expected: `{ count: 1, sameMidi: true }` — second identical tap replaced the first (de-dupe), not stacked.

- [ ] **Step 5: Verify a different pitch at the same beat STACKS (polyphony preserved)**

Repeat the harness but click two different y positions at the same x; expect `count: 2`.

- [ ] **Step 6: Verify round-trip — note edited on mobile reads back in `pianoRoll`**

Confirm the placed note persists in `getSongSequences(song)[seqActiveIdx].pianoRoll` with the expected `{midi,startCol,durCols,isPencil:true}` shape (same data the desktop reads).

- [ ] **Step 7: Commit**

```bash
git add 1.301.html
git commit -m "feat(ned): pencil/pointer/eraser entry — free-placement + same-pitch de-dupe, KeyLock pitch snap"
```

---

## Milestone D — Quick Chords overlay (Tasks 9–10)

### Task 9: Quick Chords overlay panel (two-row header, scroll list, drag-resize)

**Files:**
- Modify: `1.301.html` portrait `#nedWrap` markup (append `#nedQC` overlay), `.ned-*` CSS, `ned` IIFE (resize handler, Voice/Chords toggle)

- [ ] **Step 1: Append the overlay markup** mirroring `layout-v15.html` lines 90–121: label row (`KEY` left · gold drag-handle + "drag ↕ to resize" center · `VOICE` right) above a controls row (Key dropdown · **Chords | Keys** toggle · Voice dropdown). Then the Diatonic row (fixed, purple) + a scrollable list of Variations (cream) and a labeled Borrowed section (teal). Resting top edge covers the bottom 3 bass lines.

- [ ] **Step 2: Populate chords from the existing palette source.** Find how the desktop Quick Chords palette is built (`grep -n "Diatonic\|Borrowed\|seqRenderChordPills\|quickChord" 1.301.html`) and reuse the same diatonic/variation/borrowed generation for the current `song.key` so the mobile list matches desktop exactly.

- [ ] **Step 3: Voice dropdown reads existing instrument, renames Synth→"Drafthaus" (mobile only).** Build the Voice `<option>` list from `chordInstrument` (reuse the option set at `1.301.html:44442`) but **relabel the `synth` option text to "Drafthaus"** in this dropdown only — value stays `synth`, desktop selects untouched. `onchange` writes `seq.instrument` via the existing setter so playback/sync is unchanged. Key dropdown mirrors `#seqKeySelect`.

- [ ] **Step 4: Gold drag-handle resize.** Pointer-drag on the handle adjusts the overlay's `top` (UP = reveal more, DOWN = less), clamped so it never fully covers the staff and never goes below the panel's min header height.

- [ ] **Step 5: Chords | Keys toggle** flips a `_nedQCMode` ('chords'|'keys') and re-renders the panel body (Keys mode built in Task 11). In Chords mode the Voice dropdown shows the **chord** instrument; in Keys mode the **melody** instrument.

- [ ] **Step 6: Verify the overlay renders diatonic chords for C major + resizes**

```bash
node --input-type=module -e "
import { boot } from './scripts/ned-verify.mjs';
const { browser, page } = await boot({ portrait: true });
await page.evaluate(() => { getCurrentSong().key='C'; openKeyboardDrawer(); });
await page.waitForTimeout(500);
console.log(await page.evaluate(() => ({
  diatonic: [...document.querySelectorAll('#nedQC .ned-qc-diatonic .ned-chip')].map(c=>c.textContent.replace(/\\s+/g,'')),
  hasHandle: !!document.querySelector('#nedQC .ned-qc-handle'),
  voiceHasDrafthaus: !!document.querySelector('#nedQC select option[value=synth]') && [...document.querySelectorAll('#nedQC select option')].some(o=>o.textContent.includes('Drafthaus')),
})));
await browser.close();"
```
Expected: diatonic chips include `IC`/`Dm`/`Em`/`F`/`G`/`Am`/`B°` (label text), `hasHandle: true`, `voiceHasDrafthaus: true`.

- [ ] **Step 7: Commit**

```bash
git add 1.301.html
git commit -m "feat(ned): Quick Chords overlay — two-row header, diatonic/variations/borrowed, drag-resize, Voice=Drafthaus"
```

---

### Task 10: Chord-pill drag-with-ghost → write to the roll

**Files:**
- Modify: `1.301.html` `ned` IIFE (pill drag handlers, ghost render, chord-drop writer)

- [ ] **Step 1: Press-drag a pill** → set `_nedDragChord = {name, degree, category}`, slide the QC overlay down/hide (`.ned-qc-hidden` class) to reveal the staff.

- [ ] **Step 2: Render a ghost** of the chord's auto-voiced noteheads (semi-transparent, category-coloured) snapped to the beat under the finger on the **selected-length grid** (`_nedXToCol`). Vertical position is fixed (bass clef, root-position, consistent register) — vertical drag does nothing.

- [ ] **Step 3: On release, write the chord to the roll** at that beat with the **selected note length**, auto-voiced root position in the bass register. **Reuse the existing PR chord-drop writer** — `grep -n "prNotes.push" 1.301.html` around `1.301.html:69631` shows the drop path that pushes `pianoRoll` notes with `chordName/degree/isPencil:false`. Call the same code path (or replicate its voicing) so playback + Firestore sync are unchanged. Play the chord on drop (audio feedback). Slide the QC panel back.

  Resolve during implementation: spec says "writes to `chordSlots`"; the existing mobile/desktop chord-drop writes `pianoRoll` chord-notes (`isPencil:false`, `chordName` set). Use whichever the **existing engine** uses for a roll-placed chord so it round-trips identically to desktop — confirm by inspecting `1.301.html:69631` and the chord playback scheduler (`1.301.html:70371`, `if (!n.isPencil && n.chordName)`).

- [ ] **Step 4: Verify a dropped chord writes chord notes the scheduler will play**

```bash
node --input-type=module -e "
import { boot } from './scripts/ned-verify.mjs';
const { browser, page } = await boot({ portrait: true });
await page.evaluate(() => { const s=getSongSequences(getCurrentSong())[seqActiveIdx]; s.pianoRoll=[]; getCurrentSong().key='C'; openKeyboardDrawer(); window._nedSetDur('1'); });
await page.waitForTimeout(400);
// simulate the drop programmatically via the writer the handler calls
await page.evaluate(() => window._nedDropChordAt && window._nedDropChordAt('C', 0, /*col*/0));
console.log(await page.evaluate(() => { const pr=getSongSequences(getCurrentSong())[seqActiveIdx].pianoRoll; const chord=pr.filter(n=>!n.isPencil && n.chordName==='C'); return { chordNotes: chord.length, allBass: chord.every(n=>n.midi<=60) }; }));
await browser.close();"
```
Expected: `chordNotes >= 3` (a triad), `allBass: true`. (Expose `window._nedDropChordAt(name,degree,col)` as the release writer so it is unit-checkable.)

- [ ] **Step 5: Commit**

```bash
git add 1.301.html
git commit -m "feat(ned): chord-pill drag-with-ghost → auto-voiced bass-clef chord written to roll"
```

---

## Milestone E — Keys mode + transport (Tasks 11–12)

### Task 11: Keys mode — rainbow mini-keyboard, Key Lock, glissando, record

**Files:**
- Modify: `1.301.html` `ned` IIFE (Keys-mode panel render + key event handlers)

- [ ] **Step 1: Render the mini-piano** into the QC panel body when `_nedQCMode==='keys'` (markup from `keyboard-A-final.html` lines 79–99): two octaves of white keys coloured by scale degree using `_NED_RBW`, black keys offset, coloured `_NED_RBB` (or dimmed when out-of-scale & Key Lock on).

- [ ] **Step 2: Key Lock dims/disables out-of-scale keys** — read `_prKeyLock`; when on, out-of-scale keys get `.ned-key-dim` and ignore input. Reuse `_prKeyLockSnap` / the scale set the desktop uses.

- [ ] **Step 3: Press + press-drag glissando** — `pointerdown` plays the key (reuse the app's note-on, e.g. `prPreviewNote`/`seqPlayNote` — confirm name via `grep -n "function prPreviewNote\|playNoteMidi\|seqPlayNote" 1.301.html`); dragging across keys plays each newly-entered key (white→black & black→white), like the desktop keyboard glide.

- [ ] **Step 4: Record (● REC)** — wire UCB ● REC to the existing recorder with its **2-bar count-in** (`_urStartRecording` at `1.301.html:33022` already does `countInBeats = timeSig*2`). Confirm it captures into the active section's `pianoRoll` via `prRecordNoteOn`/`prRecordNoteOff`/`prRecordChord`; played keys during record are captured. After stop, `nedRender()` shows the captured notes. ▶ Play toggles to ■ Stop (Task 12).

- [ ] **Step 5: Verify Keys mode renders rainbow keys and dims out-of-scale under Key Lock**

```bash
node --input-type=module -e "
import { boot } from './scripts/ned-verify.mjs';
const { browser, page } = await boot({ portrait: true });
await page.evaluate(() => { getCurrentSong().key='C'; if(typeof _prKeyLock!=='undefined'){} openKeyboardDrawer(); window._nedSetQCMode && window._nedSetQCMode('keys'); });
await page.waitForTimeout(500);
console.log(await page.evaluate(() => ({
  whiteKeys: document.querySelectorAll('#nedQC .ned-key-white').length,
  firstWhite: (document.querySelector('#nedQC .ned-key-white')||{}).style && document.querySelector('#nedQC .ned-key-white').style.background,
  dimmedBlacks: document.querySelectorAll('#nedQC .ned-key-dim').length,
})));
await browser.close();"
```
Expected: `whiteKeys: 10` (two octaves C–E), first white key red-ish (`#e53e3e`), `dimmedBlacks: > 0` when Key Lock on for C major.

- [ ] **Step 6: Commit**

```bash
git add 1.301.html
git commit -m "feat(ned): Keys mode — rainbow mini-piano, KeyLock dimming, glissando, REC w/ 2-bar count-in"
```

---

### Task 12: Transport — UCB Play loops selected section; sequence-strip Play = play-from-selected-onward (GLOBAL)

**Files:**
- Modify: `1.301.html` `ned` IIFE (UCB Play/Stop), `function seqStripPlayToggle` (sanctioned global change), `CLAUDE.md`

- [ ] **Step 1: Investigate the section-scoped play path on mobile**

Arrange (and `arrStripPlayToggle`/`_arrSetSelectedSec`) is **stubbed when `innerWidth < 900`** (CLAUDE.md), so the UCB "loop selected section" needs a mobile path. Run `grep -n "function seqPlaySong\|function seqPlaySection\|loop.*section\|_seqLoopSection\|playSection" 1.301.html` and read `seqPlaySong` (`1.301.html:34201`) to find how a single section is scheduled/looped. Record the function that plays one section looping (or the loop flag) — the UCB Play binds to it scoped to `seqActiveIdx`.

- [ ] **Step 2: Wire UCB ▶ Play** to play **only the selected section, looping**, toggling its label to **■ Stop** while playing (no separate stop button). Use the path found in Step 1; on stop call `sharedStop()`. Reflect playing state on the `.ned-play` button.

- [ ] **Step 3: Change `seqStripPlayToggle` to play-from-selected-onward (GLOBAL — the one sanctioned desktop change).**

Find `function seqStripPlayToggle` (`1.301.html:25804`). It currently calls `sharedPlaySong()` (plays all from the top, looping). Change it to start from `seqActiveIdx` through the rest of the song (not looping a single section, not always-from-top). Investigate `seqPlaySong` for a start-index parameter; if absent, add an optional `startIdx` arg threaded to the section loop, defaulting to 0 to preserve all existing callers. Then:

```js
function seqStripPlayToggle() {
  if (seqIsPlaying) { sharedStop(); return; }
  _seqStripPlaying = true;
  // v1.301: play from the SELECTED section onward (global change — mobile + desktop)
  const startIdx = (typeof seqActiveIdx === 'number') ? seqActiveIdx : 0;
  if (typeof sharedPlaySong === 'function') sharedPlaySong({ startIdx });
  _seqStripSyncPlayBtn();
}
```

(`sharedPlaySong`/`seqPlaySong` must accept `{startIdx}` and begin the section sequence there. Keep looping behaviour as today but starting at `startIdx`.)

- [ ] **Step 4: Update `_seqStripSyncPlayBtn` copy** — its title text "Play everything — all sections in order" is now wrong; change to "Play from the selected section onward".

- [ ] **Step 5: Update CLAUDE.md.** In the "Buttons & playhead" section, replace the note that `#seqStripPlayBtn` "always plays everything (`sharedPlaySong`); it ignores any section selection" with the new behaviour (plays from the selected section onward, both mobile and desktop). Also update the "active build" line (currently `1.293opus.html`) to reflect `index.html`/`1.3.html` as stable and `1.301.html` as the in-progress build.

- [ ] **Step 6: Verify strip Play starts from the selected section (desktop + mobile)**

```bash
node --input-type=module -e "
import { boot } from './scripts/ned-verify.mjs';
for (const portrait of [false, true]) {
  const { browser, page } = await boot({ portrait });
  const r = await page.evaluate(() => {
    // add a 2nd section, select it, capture the startIdx seqStripPlayToggle passes
    const s=getCurrentSong(); if (s.sequences.length<2 && typeof seqDuplicateSequence==='function') seqDuplicateSequence();
    seqActiveIdx = Math.min(1, (s.sequences||[]).length-1);
    let captured=-1; const orig=window.sharedPlaySong; window.sharedPlaySong=(o)=>{ captured=o&&o.startIdx; return Promise.resolve(); };
    seqStripPlayToggle(); window.sharedPlaySong=orig; return { captured, seqActiveIdx };
  });
  console.log(portrait?'portrait':'desktop', r);
  await browser.close();
}"
```
Expected (both): `captured === seqActiveIdx` (the selected index, e.g. `1`) — proving play-from-selected-onward on desktop too.

- [ ] **Step 7: Commit**

```bash
git add 1.301.html CLAUDE.md
git commit -m "feat(ned): UCB Play loops selected section; seq-strip Play = play-from-selected-onward (global) + docs"
```

---

## Milestone F — verification & polish (Task 13)

### Task 13: Desktop-untouched proof + instrument defaults + full round-trip

**Files:**
- Modify: `1.301.html` (instrument defaults for new songs, if not already correct), `CLAUDE.md` (if not done in Task 12)

- [ ] **Step 1: Desktop-unchanged diff.** Re-run the desktop baseline and diff against `desktop-before.json` (captured in Task 0):

```bash
cd /Users/jasoncraig/Documents/Claude/Projects/Drafthaus
node scripts/ned-desktop-baseline.mjs desktop-after.json
diff desktop-before.json desktop-after.json && echo "DESKTOP UNCHANGED ✓"
```
Expected: `DESKTOP UNCHANGED ✓` (`hasNedWrap` stays false; desktop body identical). The only intended desktop behaviour change (`seqStripPlayToggle`) is logic, not drawer render, so this snapshot is unaffected.

- [ ] **Step 2: Mobile-landscape unchanged.** Boot landscape (`width:812,height:375` via a portrait:false variant or a dedicated viewport) and confirm `#mprWrap` still mounts and `#nedWrap` does not.

- [ ] **Step 3: Instrument defaults for NEW songs only.** Confirm a brand-new song's treble/melody defaults to `piano2` (Upright) and bass/chords to `synth` (displayed "Drafthaus"), while a song with **existing** saved `melodyInstrument`/`instrument` (e.g. set on desktop) is **read and reflected, never overwritten**. Find the new-song default (`grep -n "_defSeq\|instrument:'piano+synth'" 1.301.html` → `1.301.html:20653`) and adjust the default only if the spec's `piano2`/`synth` split isn't already produced. Do not change how existing songs load.

- [ ] **Step 4: Full mobile→desktop round-trip.** On mobile portrait: place pencil notes + drop a chord, then reopen on a desktop viewport and confirm the desktop piano roll / notation view shows the same notes, and `sharedPlaySong` plays them (no console errors beyond the expected guest-mode `permission-denied`).

```bash
node --input-type=module -e "
import { boot } from './scripts/ned-verify.mjs';
const { browser, page } = await boot({ portrait: true });
await page.evaluate(() => { const s=getSongSequences(getCurrentSong())[seqActiveIdx]; s.pianoRoll=[]; openKeyboardDrawer(); window._nedSetTool('pencil'); window._nedSetDur('0.25'); });
const box = await page.evaluate(() => { const r=document.getElementById('nedStaff').getBoundingClientRect(); return {x:r.left+50,y:r.top+150}; });
await page.mouse.click(box.x, box.y);
await page.waitForTimeout(150);
console.log(await page.evaluate(() => ({ saved: getSongSequences(getCurrentSong())[seqActiveIdx].pianoRoll.length })));
await browser.close();"
```
Expected: `{ saved: 1 }` and the note shape matches the desktop `pianoRoll` contract.

- [ ] **Step 5: Update the spec + memory status to "implemented".** Mark the spec doc status implemented; update the `drafthaus-notation-drawer-spec` memory to point at this plan and note completion. Do NOT push (per `drafthaus-versioning-workflow` — pushing `main` deploys; promotion of `1.301.html`→`index.html` and push is a separate, user-confirmed step).

- [ ] **Step 6: Commit**

```bash
git add 1.301.html CLAUDE.md docs/superpowers/specs/2026-06-01-mobile-notation-drawer-design.md
git commit -m "test(ned): verify desktop untouched + mobile round-trip; instrument defaults; docs"
```

---

## Promotion (after user sign-off — NOT part of automated execution)

Per `drafthaus-versioning-workflow`: when the user has driven `1.301.html` in a real browser and approved, copy it to `index.html` (`cp 1.301.html index.html`) and commit + push — that push deploys `drafthaus.ca`. **Confirm with the user before pushing.**

---

## Self-review notes (author checklist run against the spec)

- **Layout (spec §Layout 1–6):** strip reused (existing) ✓; toolbar/tools/UCB chrome → Task 7; staff → Tasks 4–6; Quick Chords → Task 9. Pointer = mouse-cursor arrow explicitly enforced (Task 7 Step 1).
- **Transport/looping/timing (spec §Transport):** UCB Play loops selected section → Task 12 Step 2; seq-strip Play global change → Task 12 Step 3 (+ CLAUDE.md Step 5); 2-bar count-in reuses `_urStartRecording` → Task 11 Step 4; time-signature-aware math → Task 3 (used by every render/entry task).
- **Grand staff rendering (spec §Grand staff):** noteheads by duration, rests, ties, beams, rainbow degree colours, stacked polyphony, not-locked-to-bar-start → Tasks 5–6.
- **Note entry (spec §Note entry + DECIDED bar-fill):** pure free-placement + same-pitch de-dupe → Task 8 (Steps 2,4,5 assert both the de-dupe and that different pitches stack); KeyLock pitch snap, selected-length start snap vs fine 1/16 pointer drag, marquee resize → Task 8 Step 3.
- **Quick Chords (spec §Quick Chords + chord ghost):** two-row header, scroll list, drag-resize, Voice=Drafthaus rename (mobile only) → Task 9; drag-with-ghost auto-voiced bass drop → Task 10.
- **Keys mode (spec §Mini-keyboard):** rainbow keys, KeyLock dim, glissando, record → Task 11.
- **Instruments/defaults (spec §Instruments):** new-song defaults piano2/synth, read-don't-overwrite existing → Task 13 Step 3.
- **Hard constraint — desktop untouched:** gate (Task 2), proof (Task 13 Steps 1–2); one sanctioned exception isolated in Task 12.
- **Open items:** none — the pencil bar-fill rule is DECIDED (free-placement + same-pitch de-dupe) and encoded in Task 8.
- **Known investigate-then-implement spots** (named, not placeholders): degree helper name (Task 8 Step 2), existing chord-drop writer + chordSlots-vs-pianoRoll (Task 10 Step 3), mobile section-loop path + `seqPlaySong` start-index (Task 12 Steps 1,3), note-on function name (Task 11 Step 3). Each names the exact function and the exact change.
