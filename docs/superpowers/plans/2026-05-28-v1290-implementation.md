# Drafthaus v1.290 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply 7 UI/UX fixes to produce `1.290.html` from `1.289.html`.

**Architecture:** Single-file HTML app. All changes are surgical edits to `1.290.html`. No new files, no framework. Each task is an independent string replacement — order doesn't matter except Task 1 must run first.

**Tech Stack:** Vanilla JS, HTML, CSS inside one large `.html` file (~77k lines).

---

## Task 1: Create 1.290.html

**Files:**
- Create: `1.290.html` (copy of `1.289.html`)

- [ ] **Step 1: Copy the file**

```bash
cp /Users/jasoncraig/Documents/Claude/Projects/Drafthaus/1.289.html \
   /Users/jasoncraig/Documents/Claude/Projects/Drafthaus/1.290.html
```

- [ ] **Step 2: Verify**

```bash
wc -l /Users/jasoncraig/Documents/Claude/Projects/Drafthaus/1.290.html
```
Expected: `76939`

- [ ] **Step 3: Commit**

```bash
git add 1.290.html
git commit -m "chore: scaffold 1.290 from 1.289"
```

---

## Task 2: Fix — Piano Roll re-renders when bars changed via Sequence Manager

**Files:**
- Modify: `1.290.html` — function `_seqMgrFinishBarsChange` (~line 26396)

**Problem:** `_seqMgrFinishBarsChange` calls `prLoadFromGrid` but never `prRender()`, so the canvas doesn't repaint after a bars change.

- [ ] **Step 1: Locate and edit**

Find this block in `1.290.html`:
```javascript
function _seqMgrFinishBarsChange(song, idx, val) {
  save();
  scheduleSyncToSheet(song);
  if (idx === seqActiveIdx) {
    document.querySelectorAll('[id="kbdBars"]').forEach(function(el) { el.value = val; });
    document.querySelectorAll('[id="seqBars"]').forEach(function(el) { el.value = val; });
    var _mt4tBr = document.getElementById('mt4tBars'); if (_mt4tBr) _mt4tBr.value = val;
    seqBuildGrids(song);
    if (typeof prLoadFromGrid === 'function') prLoadFromGrid();
    if (typeof loopSetBars === 'function') loopSetBars(parseInt(val));
  }
```

Replace with:
```javascript
function _seqMgrFinishBarsChange(song, idx, val) {
  save();
  scheduleSyncToSheet(song);
  if (idx === seqActiveIdx) {
    document.querySelectorAll('[id="kbdBars"]').forEach(function(el) { el.value = val; });
    document.querySelectorAll('[id="seqBars"]').forEach(function(el) { el.value = val; });
    var _mt4tBr = document.getElementById('mt4tBars'); if (_mt4tBr) _mt4tBr.value = val;
    seqBuildGrids(song);
    if (typeof prLoadFromGrid === 'function') prLoadFromGrid();
    if (typeof prRender === 'function') prRender();
    if (typeof loopSetBars === 'function') loopSetBars(parseInt(val));
  }
```

- [ ] **Step 2: Verify the line was inserted**

```bash
grep -n "prRender.*prLoadFromGrid\|prLoadFromGrid\|prRender" \
  /Users/jasoncraig/Documents/Claude/Projects/Drafthaus/1.290.html | grep "26[0-9][0-9][0-9]:"
```
Expected: lines showing both `prLoadFromGrid` and `prRender` near each other.

- [ ] **Step 3: Commit**

```bash
git add 1.290.html
git commit -m "fix(seq-mgr): call prRender after bars change so PR canvas repaints"
```

---

## Task 3: Remove — Dup + Clear buttons from keyboard drawer

**Files:**
- Modify: `1.290.html` — kbd-port toolbar Row 3 (~line 44922)

**Scope:** Remove only from the keyboard drawer's `kbd-port-tbtn` toolbar. The standalone PR toolbar keeps its own buttons.

- [ ] **Step 1: Edit**

Find these two consecutive lines in `1.290.html` (inside the kbd-port Row 3 `<div class="kbd-port-toolbar-row">`):
```html
            <button class="kbd-port-tbtn" onclick="seqDupPattern()" title="Duplicate pattern" style="border-color:var(--gold,#f5a623);color:var(--gold,#f5a623);">+Dup</button>
            <button class="kbd-port-tbtn" onclick="seqClearAllChordSlots()" title="Clear all" style="color:#ff5f5f;">Clear ×</button>
```

Delete both lines entirely.

- [ ] **Step 2: Verify they're gone from the kbd-port section**

```bash
grep -n "kbd-port-tbtn.*seqDupPattern\|kbd-port-tbtn.*seqClearAll" \
  /Users/jasoncraig/Documents/Claude/Projects/Drafthaus/1.290.html
```
Expected: no output.

- [ ] **Step 3: Verify the standalone PR toolbar buttons are still present**

```bash
grep -n "pr-tool-btn.*seqDupPattern\|pr-tool-btn.*seqClearAll" \
  /Users/jasoncraig/Documents/Claude/Projects/Drafthaus/1.290.html
```
Expected: 2 lines (one each), around line 67147–67148.

- [ ] **Step 4: Commit**

```bash
git add 1.290.html
git commit -m "feat(kbd-drawer): remove Dup and Clear buttons from keyboard drawer toolbar"
```

---

## Task 4: Remove — Semitone ▼▲ transpose arrows from Piano Roll toolbar

**Files:**
- Modify: `1.290.html` — PR toolbar (~line 67173)

- [ ] **Step 1: Edit**

Find these two consecutive lines in `1.290.html`:
```html
      <button class="pr-tool-btn" onclick="prTranspose(-1)" title="Transpose down 1 semitone" style="padding:2px 6px;font-size:11px;">▼</button>
      <button class="pr-tool-btn" onclick="prTranspose(1)" title="Transpose up 1 semitone" style="padding:2px 6px;font-size:11px;">▲</button>
```

Delete both lines entirely.

- [ ] **Step 2: Verify**

```bash
grep -n "prTranspose(-1)\|prTranspose(1)" \
  /Users/jasoncraig/Documents/Claude/Projects/Drafthaus/1.290.html
```
Expected: no output (the `prTranspose` function definition will remain, just no UI trigger).

- [ ] **Step 3: Commit**

```bash
git add 1.290.html
git commit -m "feat(pr): remove semitone transpose arrows from piano roll toolbar"
```

---

## Task 5: Remove — smaller "Reset to diatonic" button

**Files:**
- Modify: `1.290.html` — kbd-stage layout (~line 44790)

Two `↺` buttons both call `seqResetKeySlots()`. The smaller one (`font-size:8px`, below the finger chord slots) is removed. The one rendered inside the slots grid (`font-size:10px`) stays.

- [ ] **Step 1: Edit**

Find and delete this single line in `1.290.html`:
```html
          <button class="seq-btn" style="font-size:8px;padding:2px 4px;margin-top:4px;background:var(--card2);border:1px solid var(--border2);color:var(--faint);border-radius:3px;cursor:pointer;width:100%;" onclick="seqResetKeySlots()" title="Reset finger chords to diatonic defaults">↺</button>
```

- [ ] **Step 2: Verify exactly one reset button remains**

```bash
grep -c "seqResetKeySlots" \
  /Users/jasoncraig/Documents/Claude/Projects/Drafthaus/1.290.html
```
Expected: `1` (the remaining 10px one inside the slot render function).

- [ ] **Step 3: Commit**

```bash
git add 1.290.html
git commit -m "feat(kbd): remove duplicate smaller reset-to-diatonic button"
```

---

## Task 6: Fix — Bar counter counts continuously across sections

**Files:**
- Modify: `1.290.html` — function `_htTickClock` (~line 33889)

**Problem:** `rawBar = rawBar % _sectionBars` resets the counter to 0 at the start of each section loop.

- [ ] **Step 1: Edit**

Find this block in `_htTickClock`:
```javascript
    var rawBar = Math.floor(totalBeats / timeSig);
    if (_sectionBars > 0) rawBar = rawBar % _sectionBars;
    const bar  = rawBar + 1 + _barOffset;
```

Replace with (remove the modulo line):
```javascript
    var rawBar = Math.floor(totalBeats / timeSig);
    const bar  = rawBar + 1 + _barOffset;
```

- [ ] **Step 2: Verify**

```bash
grep -n "_sectionBars.*rawBar\|rawBar.*_sectionBars" \
  /Users/jasoncraig/Documents/Claude/Projects/Drafthaus/1.290.html
```
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add 1.290.html
git commit -m "fix(ucb): bar counter now increments continuously across sections"
```

---

## Task 7: Move — Keyboard instrument dropdown to FKB header

**Files:**
- Modify: `1.290.html` — `fkbInit()` function (~line 35130) + two desktop template locations (~lines 44745, 44899)

**Summary:** Remove `#melodyInstrumentSelect` from the desktop keyboard drawer templates and add it to the floating keyboard header. Mobile paths keep their existing select.

### Step 7a — Remove from desktop stage toolbar

- [ ] **Step 1: Edit**

In the `if (isDesktop)` template block, find and delete these 3 lines (they appear together in Row 1 of the stage toolbar):
```html
          <span class="seq-label" style="font-size:8px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--gold);margin-left:4px;">Keys</span>
          <select class="seq-select" id="melodyInstrumentSelect" onchange="melodyInstrumentChanged()" style="font-size:10px;max-width:120px;">
            ${_melodyInstrumentOptions}
          </select>
          <span id="melodyInstrumentLoading" style="display:none;font-family:'IBM Plex Mono',monospace;font-size:9px;color:var(--faint);">loading…</span>
```

### Step 7b — Remove from kbd-port fallback toolbar

- [ ] **Step 2: Edit**

In the kbd-port view (the fallback `return` block), find and delete these 3 lines:
```html
            <span class="seq-label">Keys</span>
            <select class="seq-select" id="melodyInstrumentSelect" onchange="melodyInstrumentChanged()" style="max-width:90px;" title="Keys instrument">
              ${_melodyInstrumentOptions}
            </select>
            <span id="melodyInstrumentLoading" style="display:none;font-size:9px;color:var(--faint);">…</span>
```

### Step 7c — Add to FKB header

- [ ] **Step 3: Edit `fkbInit()`**

Find the FKB header HTML in `fkbInit()`:
```javascript
  wrap.innerHTML =
    '<div class="fkb-panel" id="fkbPanel">' +
      '<div class="fkb-header" id="fkbHeader">' +
        '<span class="fkb-title">Keyboard</span>' +
        '<span class="fkb-spacer"></span>' +
        '<button class="fkb-oct-btn" id="fkbShrink" title="Remove octave">−</button>' +
        '<span class="fkb-oct-label" id="fkbOctLabel">2 oct</span>' +
        '<button class="fkb-oct-btn" id="fkbGrow" title="Add octave">+</button>' +
        '<button class="fkb-oct-btn" id="fkbMinBtn" title="Minimize keyboard" style="margin-left:6px;font-size:13px;">▾</button>' +
      '</div>' +
      '<div class="fkb-body" id="fkbBody"></div>' +
    '</div>';
```

Replace with (select inserted between title and spacer):
```javascript
  wrap.innerHTML =
    '<div class="fkb-panel" id="fkbPanel">' +
      '<div class="fkb-header" id="fkbHeader">' +
        '<span class="fkb-title">Keyboard</span>' +
        '<select id="melodyInstrumentSelect" onchange="melodyInstrumentChanged()" style="font-size:10px;background:var(--card2,#1e1e2e);color:var(--text,#eee);border:1px solid var(--border2,#333);border-radius:4px;padding:2px 4px;cursor:pointer;margin-left:8px;" title="Keys instrument">' +
          '<option value="synth">Synth</option>' +
          '<option value="piano">Grand Piano</option>' +
          '<option value="piano2">Upright Piano</option>' +
          '<option value="piano+piano2">Grand + Upright</option>' +
          '<option value="guitar">Guitar</option>' +
          '<option value="guitar+piano">Guitar + Grand</option>' +
          '<option value="guitar+piano2">Guitar + Upright</option>' +
          '<option value="guitar+synth">Guitar + Synth</option>' +
          '<option value="piano+synth">Grand + Synth</option>' +
          '<option value="piano2+synth">Upright + Synth</option>' +
          '<option value="guitar+piano+synth">Guitar + Grand + Synth</option>' +
          '<option value="guitar+piano2+synth">Guitar + Upright + Synth</option>' +
        '</select>' +
        '<span id="melodyInstrumentLoading" style="display:none;font-size:9px;color:var(--faint,#666);margin-left:4px;">…</span>' +
        '<span class="fkb-spacer"></span>' +
        '<button class="fkb-oct-btn" id="fkbShrink" title="Remove octave">−</button>' +
        '<span class="fkb-oct-label" id="fkbOctLabel">2 oct</span>' +
        '<button class="fkb-oct-btn" id="fkbGrow" title="Add octave">+</button>' +
        '<button class="fkb-oct-btn" id="fkbMinBtn" title="Minimize keyboard" style="margin-left:6px;font-size:13px;">▾</button>' +
      '</div>' +
      '<div class="fkb-body" id="fkbBody"></div>' +
    '</div>';
```

- [ ] **Step 4: Sync the select value after init**

After `_fkbEl = wrap;` in `fkbInit()`, add value sync:

Find:
```javascript
  document.body.appendChild(wrap);
  _fkbEl = wrap;

  document.getElementById('fkbShrink').addEventListener('click', function() { fkbResize(-1); });
```

Replace with:
```javascript
  document.body.appendChild(wrap);
  _fkbEl = wrap;

  // Sync instrument select to current value
  var _fkbInstrSel = document.getElementById('melodyInstrumentSelect');
  if (_fkbInstrSel && typeof _kbdMelodyInstrument !== 'undefined') {
    _fkbInstrSel.value = _kbdMelodyInstrument;
  }

  document.getElementById('fkbShrink').addEventListener('click', function() { fkbResize(-1); });
```

- [ ] **Step 5: Exclude SELECT from FKB drag handler**

In `fkbInit()` find:
```javascript
  hdr.addEventListener('pointerdown', function(e) {
    if (e.target.tagName === 'BUTTON') return;
```

Replace with:
```javascript
  hdr.addEventListener('pointerdown', function(e) {
    if (e.target.tagName === 'BUTTON' || e.target.tagName === 'SELECT') return;
```

- [ ] **Step 6: Verify**

```bash
grep -c "melodyInstrumentSelect" \
  /Users/jasoncraig/Documents/Claude/Projects/Drafthaus/1.290.html
```
Expected: `4` — one in `fkbInit` HTML, one in `melodyInstrumentLoading` area, two in mobile paths (portrait + landscape). Count `id="melodyInstrumentSelect"` specifically:

```bash
grep -c 'id="melodyInstrumentSelect"' \
  /Users/jasoncraig/Documents/Claude/Projects/Drafthaus/1.290.html
```
Expected: `3` — fkbInit (desktop), mobile portrait (~44512), mobile landscape (~44625).

- [ ] **Step 7: Commit**

```bash
git add 1.290.html
git commit -m "feat(fkb): move keyboard instrument dropdown from drawer toolbar to FKB header"
```

---

## Task 8: Upgrade — Chord pill drag to Piano Roll with ghost note preview

**Files:**
- Modify: `1.290.html` — PR HTML (~line 67229) + PR script IIFE (~lines 69388–69555)

**Summary:**
1. Add a `#prChordGhost` container div to the PR HTML.
2. Add a document-level `dragstart` listener to cache chord data (can't read dataTransfer in `dragover`).
3. Replace the full-height column indicator in the HTML5 `dragover` handler with per-note ghost divs.
4. Upgrade the pointer/touch `prPalDragStart` `onMove` handler similarly.

### Step 8a — Add ghost container to PR HTML

- [ ] **Step 1: Edit**

Find:
```html
            <div class="pr-drop-indicator" id="prDropIndicator"></div>
```

Replace with:
```html
            <div class="pr-drop-indicator" id="prDropIndicator"></div>
            <div id="prChordGhost" style="position:absolute;top:0;left:0;pointer-events:none;z-index:5;"></div>
```

### Step 8b — Add dragstart cache + ghost helpers

- [ ] **Step 2: Edit**

Find the start of the chord palette drag section inside the PR IIFE:
```javascript
  // ── Chord palette drag & drop ──
  let _prPalDrag = null;
```

Replace with:
```javascript
  // ── Chord palette drag & drop ──
  let _prPalDrag = null;

  // Cache chord data from dragstart (can't read dataTransfer in dragover due to browser security)
  var _prDragChord = null;
  document.addEventListener('dragstart', function(e) {
    var chord = e.target && (e.target.dataset.chord || e.target.getAttribute('data-chord'));
    _prDragChord = chord ? { chord: chord, degree: e.target.dataset.degree || '' } : null;
  });
  document.addEventListener('dragend', function() { _prDragChord = null; _clearPrDragGhost(); });

  function _renderPrDragGhost(col) {
    var ghost = document.getElementById('prChordGhost');
    if (!ghost || !_prDragChord) return;
    ghost.innerHTML = '';
    var song = (typeof getCurrentSong === 'function') ? getCurrentSong() : null;
    var kp = prParseKey(song);
    var midiMap = (typeof seqGenChordMidi === 'function') ? seqGenChordMidi(kp.key, kp.mode) : {};
    var midiNotes = midiMap[_prDragChord.chord] || ((typeof _chordVariantToMidi === 'function') ? _chordVariantToMidi(_prDragChord.chord) : []);
    if (!midiNotes.length) return;
    var durCols = prDurToCols();
    var x = PR_KEY_W + colToX(col);
    var w = durCols * PR_COL_W;
    midiNotes.forEach(function(midi) {
      if (midi < PR_MIN_MIDI || midi > PR_MAX_MIDI) return;
      var row = midiToRow(midi);
      var div = document.createElement('div');
      div.style.cssText = 'position:absolute;pointer-events:none;'
        + 'left:' + x + 'px;top:' + (row * PR_ROW_H) + 'px;'
        + 'width:' + w + 'px;height:' + (PR_ROW_H - 1) + 'px;'
        + 'background:#c084fc;opacity:0.55;border-radius:3px;'
        + 'border:1px solid #e9d5ff;box-sizing:border-box;';
      ghost.appendChild(div);
    });
  }

  function _clearPrDragGhost() {
    var ghost = document.getElementById('prChordGhost');
    if (ghost) ghost.innerHTML = '';
    var _ind = document.getElementById('prDropIndicator');
    if (_ind) _ind.style.display = 'none';
  }
```

### Step 8c — Upgrade HTML5 dragover handler

- [ ] **Step 3: Edit**

Find the HTML5 dragover handler (inside the `(function() { var notesLayer = document.getElementById('prNotesLayer');` IIFE near the bottom of the PR script):
```javascript
    notesLayer.addEventListener('dragover', function(e) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      // Show vertical drop guide line
      var _ind = document.getElementById('prDropIndicator');
      if (_ind) {
        var _r = notesLayer.getBoundingClientRect();
        var _gx = e.clientX - (window._prChordGrabOffsetX || 0) - _r.left;
        var _gc = xToColSnap(Math.max(0, _gx));
        _ind.style.display = 'block';
        _ind.style.left = (PR_KEY_W + colToX(_gc)) + 'px';
        _ind.style.top = '0px';
        _ind.style.width = (prDurToCols() * PR_COL_W) + 'px';
        _ind.style.height = '100%';
        _ind.style.opacity = '0.4';
      }
    });
    notesLayer.addEventListener('dragleave', function(e) {
      var _ind = document.getElementById('prDropIndicator');
      if (_ind) _ind.style.display = 'none';
    });
```

Replace with:
```javascript
    notesLayer.addEventListener('dragover', function(e) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      var _r = notesLayer.getBoundingClientRect();
      var _gx = e.clientX - (window._prChordGrabOffsetX || 0) - _r.left;
      var _gc = xToColSnap(Math.max(0, _gx));
      _renderPrDragGhost(_gc);
    });
    notesLayer.addEventListener('dragleave', function(e) {
      _clearPrDragGhost();
    });
```

### Step 8d — Upgrade pointer/touch `prPalDragStart` onMove

- [ ] **Step 4: Edit**

Find the `onMove` handler inside `window.prPalDragStart`:
```javascript
      if (x >= 0 && y >= 0 && x <= rect.width && y <= rect.height) {
        const col = xToColSnap(x);
        const row = Math.floor(y / PR_ROW_H);
        // Show drop indicator spanning the chord's range
        if (indicator && midiNotes.length) {
          const minMidi = Math.min(...midiNotes);
          const maxMidi = Math.max(...midiNotes);
          const topRow = midiToRow(maxMidi);
          const botRow = midiToRow(minMidi);
          indicator.style.display = 'block';
          indicator.style.left = (PR_KEY_W + colToX(col)) + 'px';
          indicator.style.top = (topRow * PR_ROW_H) + 'px';
          indicator.style.width = (prDurToCols() * PR_COL_W) + 'px';
          indicator.style.height = ((botRow - topRow + 1) * PR_ROW_H) + 'px';
        }
      } else {
        if (indicator) indicator.style.display = 'none';
      }
```

Replace with:
```javascript
      if (x >= 0 && y >= 0 && x <= rect.width && y <= rect.height) {
        const col = xToColSnap(x);
        _prDragChord = { chord: chordName, degree: degree };
        _renderPrDragGhost(col);
      } else {
        _clearPrDragGhost();
      }
```

- [ ] **Step 5: Also clear ghost in the `onUp` cleanup**

Find the `onUp` handler in `prPalDragStart` (just before `cleanup()`):
```javascript
      if (indicator) indicator.style.display = 'none';
```

Replace with:
```javascript
      _clearPrDragGhost();
```

- [ ] **Step 6: Verify ghost container exists in HTML**

```bash
grep -n "prChordGhost" /Users/jasoncraig/Documents/Claude/Projects/Drafthaus/1.290.html | head -10
```
Expected: at least 3 lines — the HTML div, `_renderPrDragGhost`, and `_clearPrDragGhost`.

- [ ] **Step 7: Commit**

```bash
git add 1.290.html
git commit -m "feat(pr): chord pill drag shows per-note ghost preview over piano roll"
```

---

## Self-Review

**Spec coverage:**
1. ✅ PR re-render on bars change — Task 2
2. ✅ Remove Dup/Clear from keyboard drawer — Task 3
3. ✅ Remove semitone arrows — Task 4
4. ✅ Ghost drag preview — Task 8
5. ✅ Move instrument dropdown to FKB header — Task 7
6. ✅ Remove smaller diatonic reset button — Task 5
7. ✅ Bar counter continuous — Task 6

**Placeholder scan:** All tasks have exact code. No TBDs.

**Type consistency:**
- `_renderPrDragGhost(col)` — defined in Task 8b, called in 8c and 8d ✅
- `_clearPrDragGhost()` — defined in Task 8b, called in 8c, 8d, and dragend ✅
- `_prDragChord` — defined in Task 8b, set in dragstart and 8d ✅
- `melodyInstrumentSelect` ID — same in fkbInit (Task 7) and `melodyInstrumentChanged()` ✅
