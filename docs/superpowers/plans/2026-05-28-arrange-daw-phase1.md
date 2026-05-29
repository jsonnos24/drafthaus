# Arrange → DAW Convergence — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In Drafthaus's Arrange view, let each song section pick its best recorded take (comping model A), record audio directly on the timeline, and have section reordering carry take choices with it — all in `1.293opus.html`.

**Architecture:** Extend the existing `arr*` Arrange code in place. Introduce one net-new persisted field, `song.arrComp[trackId][sectionId] = { slices:[{takeId,from,to}], xfade }`, keyed by `sectionId = sequence.id` (the same identity the existing `seqLinks4t` map uses, so it survives reordering). Phase 1 writes a single full-section slice per region = "pick a take." Playback resolution hooks `_seqTriggerMtTracksForPart`; recording hooks the existing `_mtFinishRecording` take finalizer; the picker UI attaches to `_arrMakeAudioRegion`. New UI adopts a small CSS design-token + button system.

**Tech Stack:** Single-file vanilla-JS HTML app (no build, no test runner). Web Audio API, a global `TL` timeline object, Firestore sync via `save()` + `scheduleSyncToSheet(song)`. Verification is by browser interaction + DevTools console assertions (there is no automated test harness).

**Conventions for this plan:**
- All edits are in `1.293opus.html` unless noted. Line numbers are from the `1.292.html` baseline and will drift as you edit — always re-locate by searching for the quoted anchor string, not the raw line number.
- "Verify" steps are run in the browser DevTools console with the app loaded and a song open in Arrange, unless stated otherwise.
- Commit after every task. Use `git add 1.293opus.html docs/` and the message shown.

---

## File map

| File | Responsibility | Change |
|---|---|---|
| `1.293opus.html` | The entire app | Created (copy of `1.292.html`); all code changes land here |
| `docs/superpowers/plans/2026-05-28-arrange-daw-phase1.md` | This plan | Already created |

All Phase-1 code lives in cohesive blocks added near the existing `arr*` functions (≈ line 73750–75300) and the data-helper region near `_seqLinksLoad` (≈ line 25940), with the playback hook in `_seqTriggerMtTracksForPart` (≈ line 23472) and the record hook in the `_mtFinishRecording` finalizer (search for it).

---

## Task 0: Create working file + dev verification helper

**Files:**
- Create: `1.293opus.html` (copy of `1.292.html`)

- [ ] **Step 1: Duplicate the baseline file**

Run:
```bash
cd "/Users/jasoncraig/Documents/Claude/Projects/Drafthaus"
cp "1.292.html" "1.293opus.html"
```

- [ ] **Step 2: Verify the copy is byte-identical**

Run:
```bash
cmp "1.292.html" "1.293opus.html" && echo "IDENTICAL"
```
Expected: `IDENTICAL`

- [ ] **Step 3: Add a tiny dev assertion helper**

Search for the anchor `var ARR_TRACKS = [` and insert the following block on the line **immediately above** it (so it sits inside the same script scope as the `arr*` code):

```javascript
  // ── DEV: Phase-1 verification helper (safe to keep; no UI) ──
  window.__arrAssert = function(name, cond) {
    var ok = !!cond;
    console.log((ok ? '%cPASS' : '%cFAIL') + ' — ' + name, 'color:' + (ok ? '#22c55e' : '#ef4444') + ';font-weight:700');
    return ok;
  };
```

- [ ] **Step 4: Verify the app still boots and the helper exists**

Open `1.293opus.html` in a browser. In the console run:
```javascript
__arrAssert('helper present', typeof window.__arrAssert === 'function');
```
Expected: `PASS — helper present`, and the app loads with no console errors.

- [ ] **Step 5: Commit**

```bash
git add 1.293opus.html docs/superpowers/plans/2026-05-28-arrange-daw-phase1.md
git commit -m "feat(daw): create 1.293opus working file + dev assert helper"
```

---

## Task 1: Design tokens + button system

Adopt tokens now so all new DAW UI uses them (per spec decision).

**Files:**
- Modify: `1.293opus.html` (main `<style>` block; the `:root` selector and a new button class set)

- [ ] **Step 1: Locate the stylesheet root**

Search for the first occurrence of `:root {`. You'll insert a new token block; if no `:root` rule exists near the top of the main `<style>`, add one. Confirm you are inside a `<style>...</style>` block (not JS).

- [ ] **Step 2: Add the token + button block**

Insert this at the end of the existing `:root { ... }` rule's stylesheet (immediately after its closing `}`), or as a new rule if none exists:

```css
:root {
  /* DAW design tokens (Phase 1) */
  --dh-space-1: 4px;  --dh-space-2: 8px;  --dh-space-3: 12px;  --dh-space-4: 16px;
  --dh-radius-sm: 4px; --dh-radius-md: 6px; --dh-radius-lg: 10px;
  --dh-font-xs: 10px; --dh-font-sm: 11px; --dh-font-md: 13px;
  --dh-color-rec: #ef4444;
  --dh-color-take: #fbbf24;
  --dh-color-audio: #ec4899;
  --dh-color-surface: #11141c;
  --dh-color-surface-2: #0c0f16;
  --dh-color-border: #2a3242;
  --dh-color-text: #cbd5e1;
  --dh-color-text-dim: #64748b;
}
/* DAW button system — 3 variants */
.dh-btn {
  font: 600 var(--dh-font-sm)/1 ui-monospace, monospace;
  border: 1px solid var(--dh-color-border);
  background: var(--dh-color-surface);
  color: var(--dh-color-text);
  border-radius: var(--dh-radius-sm);
  padding: var(--dh-space-1) var(--dh-space-2);
  cursor: pointer;
}
.dh-btn:hover { border-color: var(--dh-color-text-dim); }
.dh-btn.dh-btn-rec { color: #fff; background: var(--dh-color-rec); border-color: var(--dh-color-rec); }
.dh-btn.dh-btn-ghost { background: transparent; }
.dh-btn[disabled] { opacity: .45; cursor: default; }
```

- [ ] **Step 3: Verify tokens resolve**

Reload. In console:
```javascript
__arrAssert('token --dh-color-take resolves',
  getComputedStyle(document.documentElement).getPropertyValue('--dh-color-take').trim() === '#fbbf24');
```
Expected: `PASS`.

- [ ] **Step 4: Verify button class renders**

In console:
```javascript
var b = document.createElement('button'); b.className = 'dh-btn dh-btn-rec'; document.body.appendChild(b);
__arrAssert('dh-btn-rec is red',
  getComputedStyle(b).backgroundColor === 'rgb(239, 68, 68)');
b.remove();
```
Expected: `PASS`.

- [ ] **Step 5: Commit**

```bash
git add 1.293opus.html
git commit -m "feat(daw): add CSS design tokens + dh-btn button system"
```

---

## Task 2: `arrComp` data model + helpers

**Files:**
- Modify: `1.293opus.html` (song defaults near `seqLinks4t: {}`; new helper functions near `_seqLinksLoad`)

- [ ] **Step 1: Add `arrComp` to the new-song default shape**

Search for the anchor `seqLinks4t: {}, seqLinksLoop: {}` (the new-song template, ≈ line 40124). Change it to also initialise `arrComp`:

```javascript
    chords: {}, structure: {}, sectionOrder: [], loopTracks: [], mtTracks: [], arrComp: {},
```
(That line currently lists `mtTracks: []` — add `arrComp: {}` right after it. If the two anchors are on different lines, add `arrComp: {}` immediately after the `mtTracks: []` initialiser.)

- [ ] **Step 2: Add the helper functions**

Search for the anchor `function _seqLinksField(type) {`. Insert this block immediately **above** it:

```javascript
// ── Arrange comp map: song.arrComp[trackId][sectionId] = { slices:[{takeId,from,to}], xfade } ──
// Phase 1 stores exactly one full-section slice per region (= "pick a take per section").
function arrCompLoad() {
  const song = getCurrentSong();
  if (!song) return {};
  if (!song.arrComp) song.arrComp = {};
  return song.arrComp;
}
function arrCompSave() {
  const song = getCurrentSong();
  if (!song) return;
  if (typeof save === 'function') save();
  if (typeof scheduleSyncToSheet === 'function') scheduleSyncToSheet(song);
}
// Set the chosen take for one (track, section). takeId === null clears the choice.
function arrCompSetTake(trackId, sectionId, takeId) {
  if (!trackId || !sectionId) return;
  const map = arrCompLoad();
  if (!map[trackId]) map[trackId] = {};
  if (takeId === null) {
    delete map[trackId][sectionId];
  } else {
    map[trackId][sectionId] = { slices: [{ takeId: takeId, from: 0, to: 'end' }], xfade: 0 };
  }
  arrCompSave();
}
// Read the chosen takeId for a (track, section), or null if none chosen.
function arrCompGetTakeId(trackId, sectionId) {
  const map = arrCompLoad();
  const entry = map[trackId] && map[trackId][sectionId];
  if (!entry || !entry.slices || !entry.slices.length) return null;
  return entry.slices[0].takeId || null;
}
// Resolve a (4-track index, sectionId) to a take INDEX for playback.
// Falls back to the track's existing activeTakeIdx, then take 0.
function arrCompResolveTakeIdx(ftIdx, sectionId) {
  const t = (typeof _mtTracks !== 'undefined') ? _mtTracks[ftIdx] : null;
  if (!t || !t.takes || !t.takes.length) return -1;
  const takeId = arrCompGetTakeId('ft' + ftIdx, sectionId);
  if (takeId) {
    const i = t.takes.findIndex(function(tk) { return tk && tk.id === takeId; });
    if (i >= 0) return i;
  }
  if (typeof t.activeTakeIdx === 'number' && t.activeTakeIdx >= 0 && t.activeTakeIdx < t.takes.length) {
    return t.activeTakeIdx;
  }
  return 0;
}
// Expose on window so the arr* closure (Tasks 3 & 5) can reach these regardless of script scope.
window.arrCompLoad = arrCompLoad;
window.arrCompSave = arrCompSave;
window.arrCompSetTake = arrCompSetTake;
window.arrCompGetTakeId = arrCompGetTakeId;
window.arrCompResolveTakeIdx = arrCompResolveTakeIdx;
```

- [ ] **Step 3: Verify set/get round-trip**

Reload with a song open. In console:
```javascript
arrCompSetTake('ft0', 'sec-test', 'take_abc');
__arrAssert('get returns set takeId', arrCompGetTakeId('ft0', 'sec-test') === 'take_abc');
arrCompSetTake('ft0', 'sec-test', null);
__arrAssert('clear removes choice', arrCompGetTakeId('ft0', 'sec-test') === null);
__arrAssert('persisted on song', !!getCurrentSong().arrComp);
```
Expected: three `PASS` lines.

- [ ] **Step 4: Verify resolve fallback**

In console:
```javascript
// With no comp choice, resolve should fall back to activeTakeIdx or 0 when takes exist.
__arrAssert('resolve falls back without crashing',
  typeof arrCompResolveTakeIdx(0, 'sec-none') === 'number');
```
Expected: `PASS`.

- [ ] **Step 5: Commit**

```bash
git add 1.293opus.html
git commit -m "feat(daw): add arrComp data model + take-resolution helpers"
```

---

## Task 3: Per-section take picker on audio regions

**Files:**
- Modify: `1.293opus.html` (`_arrMakeAudioRegion` ≈ 74198; new `arrTakePickerOpen`/`arrTakePickerPick` functions; CSS for chip + menu)

- [ ] **Step 1: Render the take chip inside audio regions**

In `_arrMakeAudioRegion(sec, track, idx, muted, linked)`, locate the `return '<div class="arr-region ...` template. Just before the closing `+ '</div>';`, insert a take-chip element. Replace the trailing:

```javascript
      + '<div class="arr-handle arr-handle-r"></div>'
      + '</div>';
```
with:

```javascript
      + '<div class="arr-handle arr-handle-r"></div>'
      + (track.group === '4track'
          ? '<span class="arr-take-chip" onclick="event.stopPropagation();arrTakePickerOpen(event,\'' + track.id + '\',\'' + (sec.seq && sec.seq.id ? sec.seq.id : '') + '\')">'
            + arrTakeChipLabel(track.id, sec.seq && sec.seq.id) + ' &#9662;</span>'
          : '')
      + '</div>';
```

- [ ] **Step 2: Add the chip-label + picker functions**

Search for the anchor `function _arrSectionIndexOf(sec) {` and insert this block immediately **above** it:

```javascript
  // Label shown on a region's take chip, e.g. "Take 2" or "—".
  window.arrTakeChipLabel = function(trackId, sectionId) {
    var ftIdx = parseInt(String(trackId).replace('ft', ''), 10);
    var t = (typeof _mtTracks !== 'undefined') ? _mtTracks[ftIdx] : null;
    if (!t || !t.takes || !t.takes.length) return 'No takes';
    var i = (typeof arrCompResolveTakeIdx === 'function') ? arrCompResolveTakeIdx(ftIdx, sectionId) : 0;
    return 'Take ' + (i + 1);
  };

  // Open the per-section take picker menu anchored to the clicked chip.
  window.arrTakePickerOpen = function(ev, trackId, sectionId) {
    document.querySelectorAll('.arr-take-menu').forEach(function(m) { m.remove(); });
    var ftIdx = parseInt(String(trackId).replace('ft', ''), 10);
    var t = (typeof _mtTracks !== 'undefined') ? _mtTracks[ftIdx] : null;
    var menu = document.createElement('div');
    menu.className = 'arr-take-menu';
    var activeIdx = (typeof arrCompResolveTakeIdx === 'function') ? arrCompResolveTakeIdx(ftIdx, sectionId) : -1;
    var html = '';
    if (t && t.takes && t.takes.length) {
      t.takes.forEach(function(tk, i) {
        var dur = tk && tk.duration ? (' · ' + tk.duration + 's') : '';
        html += '<div class="arr-take-row' + (i === activeIdx ? ' active' : '') + '"'
              + ' onclick="arrTakePickerPick(\'' + trackId + '\',\'' + sectionId + '\',\'' + (tk.id || '') + '\')">'
              + (i === activeIdx ? '✓ ' : '') + 'Take ' + (i + 1) + dur + '</div>';
      });
    } else {
      html += '<div class="arr-take-row dim">No takes recorded</div>';
    }
    html += '<div class="arr-take-row dim sep">⎘ Comp… (Phase 2)</div>';
    menu.innerHTML = html;
    document.body.appendChild(menu);
    var r = ev.target.getBoundingClientRect();
    menu.style.left = Math.min(r.left, window.innerWidth - 200) + 'px';
    menu.style.top = (r.bottom + 4) + 'px';
    setTimeout(function() {
      document.addEventListener('click', function _close() {
        menu.remove(); document.removeEventListener('click', _close);
      });
    }, 0);
  };

  // Apply a take choice, persist, and re-render the timeline.
  window.arrTakePickerPick = function(trackId, sectionId, takeId) {
    if (typeof arrCompSetTake === 'function') arrCompSetTake(trackId, sectionId, takeId || null);
    document.querySelectorAll('.arr-take-menu').forEach(function(m) { m.remove(); });
    if (typeof arrRenderAll === 'function') arrRenderAll();
  };

```

- [ ] **Step 3: Add chip + menu CSS**

Search for the anchor `.arr-region {` in the stylesheet. Immediately after that rule's closing `}`, add:

```css
.arr-take-chip {
  position: absolute; right: 4px; bottom: 2px;
  font: 600 var(--dh-font-xs)/1 ui-monospace, monospace;
  color: var(--dh-color-take);
  background: rgba(0,0,0,0.45);
  border-radius: var(--dh-radius-sm);
  padding: 1px 4px; cursor: pointer; z-index: 3;
}
.arr-take-menu {
  position: fixed; z-index: 100000;
  min-width: 160px; background: var(--dh-color-surface);
  border: 1px solid var(--dh-color-border); border-radius: var(--dh-radius-md);
  font: var(--dh-font-sm)/1.3 ui-monospace, monospace; color: var(--dh-color-text);
  box-shadow: 0 8px 24px rgba(0,0,0,0.5); overflow: hidden;
}
.arr-take-row { padding: 6px 10px; cursor: pointer; }
.arr-take-row:hover { background: var(--dh-color-surface-2); }
.arr-take-row.active { color: var(--dh-color-take); }
.arr-take-row.dim { color: var(--dh-color-text-dim); cursor: default; }
.arr-take-row.sep { border-top: 1px solid var(--dh-color-border); }
```

- [ ] **Step 4: Verify the chip appears (browser)**

Reload. Open a song that has at least one 4-track take linked to a section, open Arrange. Expected: each audio region shows a `Take N ▾` chip in its bottom-right. If a track has no takes, the chip reads `No takes`.

- [ ] **Step 5: Verify picking persists (browser + console)**

Click a chip → the menu lists takes. Click a non-active take. Expected: menu closes, the timeline re-renders, the chip label updates. Then in console:
```javascript
// Replace ftX / secId with a track id + sectionId you just set (read from getCurrentSong().arrComp)
__arrAssert('a comp choice was written', Object.keys(getCurrentSong().arrComp || {}).length > 0);
```
Expected: `PASS`.

- [ ] **Step 6: Commit**

```bash
git add 1.293opus.html
git commit -m "feat(daw): per-section take picker on audio regions"
```

---

## Task 4: Playback resolves the per-section take

Make the section-by-section player honor `arrComp` instead of always using the global `activeTakeIdx`.

**Files:**
- Modify: `1.293opus.html` (`_seqTriggerMtTracksForPart` ≈ 23472)

- [ ] **Step 1: Read the current trigger function**

Re-read `_seqTriggerMtTracksForPart` (search for `function _seqTriggerMtTracksForPart(partId) {`). Confirm it (a) builds `_matchingSeqIds` for the part, (b) finds linked track indices from `_seqLinksLoad('4t')`, and (c) calls `_mtSeqPlayTrack(tidx)` for newly-active tracks. The take played is whatever `_mtTracks[tidx].activeTakeIdx` points at.

- [ ] **Step 2: Set the resolved take active before playing**

Inside `_seqTriggerMtTracksForPart`, find the block:

```javascript
    _nextActive.forEach(function(tidx) {
      if (!window._mtSeqActiveTracks || !window._mtSeqActiveTracks.has(tidx)) {
        if (typeof _mtSeqPlayTrack === 'function') _mtSeqPlayTrack(tidx);
      }
    });
```
Replace it with:

```javascript
    // Resolve the chosen take for THIS section (Phase-1 comping model A) before playing.
    // The section's identity is its sequence id; pick the first matching seq for this part.
    var _secSeqId = null;
    for (var _si = 0; _si < _allSeqs.length; _si++) {
      if ((_allSeqs[_si].partId || _allSeqs[_si].part) === partId) { _secSeqId = _allSeqs[_si].id; break; }
    }
    _nextActive.forEach(function(tidx) {
      if (typeof arrCompResolveTakeIdx === 'function' && _secSeqId && _mtTracks[tidx] && _mtTracks[tidx].takes && _mtTracks[tidx].takes.length) {
        var _wantIdx = arrCompResolveTakeIdx(tidx, _secSeqId);
        if (_wantIdx >= 0 && _wantIdx !== _mtTracks[tidx].activeTakeIdx) {
          _mtTracks[tidx].activeTakeIdx = _wantIdx;
          var _wantTake = _mtTracks[tidx].takes[_wantIdx];
          // If that take's buffer is already decoded, point the track at it so playback uses it.
          if (_wantTake && _wantTake._localBuffer) { _mtTracks[tidx].buffer = _wantTake._localBuffer; }
        }
      }
      if (!window._mtSeqActiveTracks || !window._mtSeqActiveTracks.has(tidx)) {
        if (typeof _mtSeqPlayTrack === 'function') _mtSeqPlayTrack(tidx);
      }
    });
```

- [ ] **Step 3: Verify resolution is invoked (console)**

Reload. In console, stub the resolver to log, then trigger a part that has a linked audio track:
```javascript
var _orig = arrCompResolveTakeIdx; var hit = false;
window.arrCompResolveTakeIdx = function(a,b){ hit = true; return _orig(a,b); };
_seqTriggerMtTracksForPart(getCurrentSong().sectionOrder[0]);
__arrAssert('playback consulted arrComp resolver', hit);
window.arrCompResolveTakeIdx = _orig;
```
Expected: `PASS` (assuming the first section has a linked 4-track track; if not, link one first or pick a section that does).

- [ ] **Step 4: Verify audibly (browser)**

Record/confirm two takes on one audio track (Task 5 covers recording; for now you can use the 4-Track drawer to make two takes). Link the track to two different sections. Use the take picker to choose Take 1 for section A and Take 2 for section B. Press Play in Arrange. Expected: section A plays Take 1, section B plays Take 2.

- [ ] **Step 5: Commit**

```bash
git add 1.293opus.html
git commit -m "feat(daw): playback resolves per-section take via arrComp"
```

---

## Task 5: Record-to-timeline — arm, count-in, auto-link take to section

**Files:**
- Modify: `1.293opus.html` (`arrRecToggle` ≈ 74692; `_arrStartRecording` ≈ 75166; the `_mtFinishRecording` finalizer — search for it; new `_arrSectionIdAtBeat` helper)

- [ ] **Step 1: Read the record finalizer**

Search for `function _mtFinishRecording` (it is the `mediaRecorder.onstop` handler referenced near `mtCancelRecording`). Read it fully and confirm where it creates the new take object and pushes it with `_mtTracks[trackIdx].takes.push(...)` and sets `activeTakeIdx`. Note the local variable holding the new take's `id` (it is generated like `'take_' + Date.now() + ...`). You will add a post-push hook here.

- [ ] **Step 2: Add a "section id at a given beat" helper**

Search for `function _arrSectionIndexOf(sec) {` and insert immediately **above** it:

```javascript
  // Resolve which section (by sequence id) contains a given absolute beat on the Arrange timeline.
  window._arrSectionIdAtBeat = function(beat) {
    var song = typeof getCurrentSong === 'function' ? getCurrentSong() : null;
    if (!song) return null;
    var seqs = typeof getSongSequences === 'function' ? getSongSequences(song) : [];
    var sections = _arrBuildSections(song, seqs);
    var timeSig = parseInt(song.sequences && song.sequences[0] ? (song.sequences[0].time || 4) : 4, 10);
    var bar = beat / timeSig;
    for (var i = 0; i < sections.length; i++) {
      var s = sections[i];
      if (bar >= s.startBar && bar < s.startBar + s.bars) return s.seq && s.seq.id ? s.seq.id : null;
    }
    return sections.length ? (sections[sections.length - 1].seq && sections[sections.length - 1].seq.id) : null;
  };
```

- [ ] **Step 3: Capture the record-start section on arm/record**

In `arrRecToggle` (search `window.arrRecToggle = function() {`), in the **else** branch (arming), after `btn.classList.add('armed');`, add a snapshot of the section under the playhead so the finalizer knows where to file the take:

```javascript
      btn.classList.add('armed');
      // Snapshot the section under the playhead at arm time → finalizer links the new take here.
      try {
        var _beat = (typeof TL !== 'undefined' && TL.getCurrentBeat) ? TL.getCurrentBeat() : 0;
        window._arrRecSectionId = (typeof _arrSectionIdAtBeat === 'function') ? _arrSectionIdAtBeat(_beat) : null;
        window._arrRecTrackId = (typeof _mtArmedTrack !== 'undefined' && _mtArmedTrack >= 0) ? ('ft' + _mtArmedTrack) : 'ft0';
      } catch(e) { window._arrRecSectionId = null; }
```

- [ ] **Step 4: Link the finished take to that section in the finalizer**

In `_mtFinishRecording`, immediately **after** the line that sets `t.activeTakeIdx = t.takes.length - 1;` (the newly-pushed take), add:

```javascript
    // Phase-1: auto-link this take to the section that was under the playhead at record start.
    try {
      if (window._arrRecSectionId && typeof arrCompSetTake === 'function') {
        var _newTake = t.takes[t.takes.length - 1];
        var _trkId = window._arrRecTrackId || ('ft' + trackIdx);
        if (_newTake && _newTake.id) arrCompSetTake(_trkId, window._arrRecSectionId, _newTake.id);
      }
      window._arrRecSectionId = null;
      if (typeof arrIsOpen === 'function' && arrIsOpen() && typeof arrRenderAll === 'function') arrRenderAll();
    } catch(e) { console.warn('[ARR] take auto-link error:', e); }
```
(If the finalizer's track variable is named differently than `t`/`trackIdx`, use whatever it actually uses for the armed track and its index — confirm from Step 1.)

- [ ] **Step 5: Give the REC button its visual state**

In `arrRecToggle`, ensure the armed/recording visual uses the rec token. The button element is `#arrRecBtn`. Confirm the stylesheet has a rule for `#arrRecBtn.armed`; if not, search for `#arrRecBtn` in the CSS and add:

```css
#arrRecBtn.armed { color: #fff; background: var(--dh-color-rec); border-color: var(--dh-color-rec); }
```

- [ ] **Step 6: Verify arm snapshot (console)**

Reload, open Arrange, arm a track (click the REC button so it shows `armed`). In console:
```javascript
__arrAssert('arm captured a section id', typeof window._arrRecSectionId !== 'undefined');
__arrAssert('arm captured a track id', /^ft\d$/.test(window._arrRecTrackId || ''));
```
Expected: two `PASS` lines.

- [ ] **Step 7: Verify a real recording auto-links (browser)**

Arm an audio track, position the playhead inside a specific section, press Play → 2-bar count-in → record a few seconds → Stop. Expected: a new take is created, the region's `Take N ▾` chip updates to the new take, and `getCurrentSong().arrComp['ftX'][<that section's seq id>]` exists. Confirm in console:
```javascript
__arrAssert('record auto-linked a take',
  JSON.stringify(getCurrentSong().arrComp).indexOf('take_') > -1 || JSON.stringify(getCurrentSong().arrComp).indexOf('local_') > -1);
```
Expected: `PASS`.

- [ ] **Step 8: Commit**

```bash
git add 1.293opus.html
git commit -m "feat(daw): record-to-timeline auto-links take to section under playhead"
```

---

## Task 6: Sections-primary content-carrying drag (verify + guard)

Because `arrComp` is keyed by `sequence.id`, reordering sections must carry take choices automatically. This task verifies that and guards the one edge case (region drag between sections).

**Files:**
- Modify: `1.293opus.html` (`arrRegionDragStart` / region drop handler — search for `function arrRegionDragStart`)

- [ ] **Step 1: Verify reorder preserves comp choices (browser + console)**

With a song where two sections have different chosen takes (from Task 3/5), note the choices:
```javascript
var before = JSON.stringify(getCurrentSong().arrComp);
```
Drag a section to reorder it (sections row in Arrange). Then:
```javascript
__arrAssert('comp choices survive section reorder', JSON.stringify(getCurrentSong().arrComp) === before);
```
Expected: `PASS` — the `arrComp` map is unchanged because it is keyed by sequence id, not position.

- [ ] **Step 2: Read the region drag handler**

Search for `function arrRegionDragStart`. Find its corresponding drop handler (search for `data-arr-region` drop logic or `ondrop` on lanes). Determine whether dragging an audio region from one section to another currently moves anything. In Phase 1, audio regions are section-bound (one per linked section), so cross-section region drag is **out of scope** — it must not silently corrupt `arrComp`.

- [ ] **Step 3: Guard cross-section audio-region drag**

If a drop handler exists that could move an audio region to a different section, add a guard at the top of that handler so audio regions are not moved in Phase 1 (take placement is via the picker, not drag):

```javascript
    // Phase 1: audio-region take placement is via the take picker, not drag-move.
    if (draggedEl && draggedEl.classList && draggedEl.classList.contains('arr-region')
        && draggedEl.getAttribute('data-arr-region') && /^ft\d$/.test(draggedEl.getAttribute('data-arr-region'))) {
      return;
    }
```
(Use the actual variable name the handler uses for the dragged element in place of `draggedEl`. If no such handler moves regions between sections, skip the code change and note that in the commit.)

- [ ] **Step 4: Verify guard (browser)**

Try to drag an audio region onto a different section's lane. Expected: nothing moves; `arrComp` is unchanged (re-run the Step 1 assertion).

- [ ] **Step 5: Commit**

```bash
git add 1.293opus.html
git commit -m "feat(daw): verify section reorder carries comp choices; guard audio-region drag"
```

---

## Phase 1 acceptance (run all)

Open `1.293opus.html`, open a song in Arrange, and confirm:
- [ ] Audio regions show a `Take N ▾` chip; clicking lists takes and lets you pick one per section.
- [ ] Picking a take persists (survives reload) and updates the chip + playback.
- [ ] Arming a track + Play does a 2-bar count-in and records; Stop creates a take auto-linked to the section under the playhead.
- [ ] Two sections can play two different takes of the same track.
- [ ] Reordering sections carries take choices with them (no `arrComp` change).
- [ ] No regressions: existing sequencer/drum/keys/looper playback, the 4-Track drawer, and save/sync all still work.

---

## Deferred to later plans (do NOT build here)
- **Phase 2:** swipe comping (multi-slice `arrComp`), the sample-accurate slice playback engine, region trim/move/crossfade, real waveform-from-buffer rendering. Its own plan.
- **Phase 3:** mobile capture view, Mixer-fold, 4-Track drawer retirement + parity checklist. Its own plan.
- **Spec 2:** the broader GUI/UX polish punch-list. Its own spec + plan.
