# Floating Fretboard Overlay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a selectable guitar/ukulele/bass fretboard beneath the keys in the floating keyboard overlay that shows an accurate, sticky voicing for any clicked chord pill.

**Architecture:** A new `fb*` module is added to the single-file app. Pure voicing functions (parse → library-first → algorithmic fallback → bass root-focus → finger numbering) feed a horizontal-neck SVG renderer mounted inside the existing `#fkbPanel`. One hook in `seqShowChordOnKeyboard` drives it; deleting one clear-call in `seqPillRelease` makes both keyboard glow and fretboard sticky.

**Tech Stack:** Vanilla JS + inline-styled SVG inside the existing single-file HTML app (`1.314.html`). No build step. Verification via `playwright-core` driving the already-installed Google Chrome (no browser download).

---

## Conventions used throughout

- **String order in all voicing models is high→low**, matching the existing `getChordTab` arrays: guitar `[e,B,G,D,A,E]`, uke `[A,E,C,G]`, bass `[G,D,A,E]`. Index 0 = highest string (top row when rendered), last index = lowest string (bottom row).
- A string entry is `{fret, label}` where `fret`: `null` = muted (✕), `0` = open (○), `>0` = fretted. `label` is the finger number (`'1'`–`'4'`) or bass interval (`'R'`/`'3'`/`'5'`), or `null`.
- Pitch classes are `0–11` with `C=0`, matching `SEQ_NOTES` (confirm `SEQ_NOTES[0]==='C'`).
- All new UI uses **inline styles** (no separate CSS block) to avoid hunting CSS insertion points in the 76k-line file.
- **Locate code by the quoted anchor strings given**, never by line number (they drift).

## File structure

- **Create `1.314.html`** — `cp 1.313.html 1.314.html`; all edits land here. Promoted to `index.html` only in the final task.
- **Create `_verify_fb.js`** — playwright-core harness; grows one assertion block per task. Run with `node _verify_fb.js`.
- **Modify `CLAUDE.md`** — repoint to 1.314 in the final task.
- **Modify `index.html`** — overwritten by the promoted 1.314 in the final task.

All new JS lives in **one cohesive block** inserted immediately after this anchor line (the end of the chord-resolution lock region):

```
/* @lock:end — Chord Resolution */
```

Insert the engine functions (Tasks 1–6) and the runtime functions (Tasks 7–9) right after that line, in order. Do **not** edit inside the `@lock` region.

---

## Task 0: Branch base + verify harness

**Files:**
- Create: `1.314.html` (copy of `1.313.html`)
- Create: `_verify_fb.js`

- [ ] **Step 1: Copy the base build and confirm it's clean**

Run:
```bash
cp 1.313.html 1.314.html && diff -q 1.313.html 1.314.html && md5 -q 1.314.html
```
Expected: no diff output, md5 `505b1cea1bbe6188ed6d7c6fb3a8f37e`.

- [ ] **Step 2: Confirm the JS insertion anchor exists exactly once**

Run:
```bash
grep -c '/\* @lock:end — Chord Resolution \*/' 1.314.html
```
Expected: `1`.

- [ ] **Step 3: Create the verify harness**

Create `_verify_fb.js`:
```js
// Headless verify harness for the floating fretboard. Drives installed Chrome via playwright-core.
const { chromium } = require('playwright-core');
const path = require('path');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const FILE = 'file://' + path.resolve(__dirname, '1.314.html');

let pass = 0, fail = 0;
function assert(name, cond, extra) {
  if (cond) { pass++; console.log('  ok  ' + name); }
  else { fail++; console.log('FAIL  ' + name + (extra ? '  -> ' + JSON.stringify(extra) : '')); }
}

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  await page.addInitScript(() => { try { localStorage.setItem('drafthaus-eula-accepted','1'); } catch(e){} });
  page.on('pageerror', e => { fail++; console.log('FAIL  pageerror -> ' + e.message); });
  await page.goto(FILE, { waitUntil: 'load' });
  await page.waitForTimeout(400);

  // === ENGINE ASSERTIONS ===

  // === DOM ASSERTIONS ===

  console.log(`\n${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
```

- [ ] **Step 4: Run the harness to confirm it boots**

Run: `node _verify_fb.js`
Expected: `0 passed, 0 failed` (no pageerror lines). If `playwright-core` is missing, run `npm ls playwright-core` to confirm it's installed (per the headless-verify recipe it should be).

- [ ] **Step 5: Commit**

```bash
git add 1.314.html _verify_fb.js
git commit -m "chore(1.314): branch base + fretboard verify harness"
```

---

## Task 1: `_fbParseChord` — name → root + pitch classes

**Files:**
- Modify: `1.314.html` (insert after `/* @lock:end — Chord Resolution */`)
- Modify: `_verify_fb.js`

- [ ] **Step 1: Add the failing assertions**

In `_verify_fb.js`, replace the `// === ENGINE ASSERTIONS ===` line with:
```js
  // === ENGINE ASSERTIONS ===
  const t1 = await page.evaluate(() => ({
    c:   _fbParseChord('C'),
    fs7: _fbParseChord('F#7'),
    m7b5:_fbParseChord('Bm7b5'),
    bad: _fbParseChord('H'),
    nul: _fbParseChord(''),
    cnote0: (typeof SEQ_NOTES !== 'undefined' && SEQ_NOTES[0]),
  }));
  assert('SEQ_NOTES[0] is C', t1.cnote0 === 'C', t1.cnote0);
  assert('parse C -> root C, pcs[0,4,7]', t1.c && t1.c.root==='C' && t1.c.rootPc===0 && JSON.stringify(t1.c.pcs)==='[0,4,7]', t1.c);
  assert('parse F#7 -> root F#, 4 pcs', t1.fs7 && t1.fs7.root==='F#' && t1.fs7.pcs.length===4, t1.fs7);
  assert('parse Bm7b5 -> qual m7b5', t1.m7b5 && t1.m7b5.qual==='m7b5' && t1.m7b5.pcs.length===4, t1.m7b5);
  assert('parse junk -> null', t1.bad === null && t1.nul === null, t1);
```

- [ ] **Step 2: Run to verify it fails**

Run: `node _verify_fb.js`
Expected: FAIL lines for the parse asserts (`_fbParseChord is not defined` pageerror or failing conds).

- [ ] **Step 3: Insert the implementation**

In `1.314.html`, immediately after `/* @lock:end — Chord Resolution */`, insert:
```js

/* ───────────────────── Floating fretboard (fb*) ───────────────────── */
// Voicing model string order is HIGH→LOW: guitar [e,B,G,D,A,E], uke [A,E,C,G], bass [G,D,A,E].
var _FB_TUNING = {
  guitar:  [64, 59, 55, 50, 45, 40], // e B G D A E (MIDI)
  ukulele: [69, 64, 60, 67],         // A E C G (reentrant high-G)
  bass:    [43, 38, 33, 28],         // G D A E
};
var _FB_QUAL_MAP = {
  '':'Major', 'm':'Minor', '7':'Dom 7', 'maj7':'Maj 7', 'm7':'Min 7',
  'sus2':'Sus2', 'sus4':'Sus4', 'msus4':'Sus4', 'dim':'Diminished'
};

function _fbParseChord(name) {
  if (!name) return null;
  var s = String(name).replace('_viii', '');
  var root, qual;
  if (s.length >= 2 && s[1] === '#') { root = s.slice(0, 2); qual = s.slice(2); }
  else { root = s[0]; qual = s.slice(1); }
  var rootPc = (typeof SEQ_NOTES !== 'undefined') ? SEQ_NOTES.indexOf(root) : -1;
  if (rootPc < 0) return null;
  var ivs = (_CHORD_INTERVALS[qual] || [0, 4, 7]);
  var pcs = ivs.map(function (iv) { return (rootPc + iv) % 12; });
  return {
    root: root, qual: qual, pcs: pcs, rootPc: rootPc % 12,
    thirdPc: ivs.length > 1 ? (rootPc + ivs[1]) % 12 : null,
    fifthPc: ivs.length > 2 ? (rootPc + ivs[2]) % 12 : null
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node _verify_fb.js`
Expected: the 5 Task-1 asserts print `ok`.

- [ ] **Step 5: Commit**

```bash
git add 1.314.html _verify_fb.js
git commit -m "feat(1.314): _fbParseChord chord-name parser"
```

---

## Task 2: `_fbLibraryVoicing` — reuse existing open/barre voicings

**Files:**
- Modify: `1.314.html`, `_verify_fb.js`

- [ ] **Step 1: Add the failing assertions** (append below the Task-1 asserts):
```js
  const t2 = await page.evaluate(() => ({
    cmaj: _fbLibraryVoicing('guitar', _fbParseChord('C')),
    add9: _fbLibraryVoicing('guitar', _fbParseChord('Cadd9')),
    bass: _fbLibraryVoicing('bass', _fbParseChord('C')),
  }));
  // GUITAR_OPEN_VOICINGS 'C Major' = [0,1,0,2,3,'x'] (e B G D A E)
  assert('lib C major matches open voicing', t2.cmaj &&
    JSON.stringify(t2.cmaj.strings.map(s=>s.fret)) === '[0,1,0,2,3,null]', t2.cmaj);
  assert('lib add9 -> null (not in map)', t2.add9 === null, t2.add9);
  assert('lib bass -> null (algo handles bass)', t2.bass === null, t2.bass);
```

- [ ] **Step 2: Run to verify it fails**

Run: `node _verify_fb.js`  →  Task-2 asserts FAIL (`_fbLibraryVoicing is not defined`).

- [ ] **Step 3: Insert the implementation** (after `_fbParseChord` in `1.314.html`):
```js
function _fbLibraryVoicing(instrument, p) {
  if (!p) return null;
  if (instrument !== 'guitar' && instrument !== 'ukulele') return null;
  var q = _FB_QUAL_MAP[p.qual];
  if (!q) return null;
  if (typeof getChordTab !== 'function') return null;
  var arr = getChordTab(instrument, p.root, q); // [high..low] frets, 'x' = mute
  if (!arr) return null;
  return { strings: arr.map(function (f) { return { fret: (f === 'x' ? null : f), label: null }; }) };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node _verify_fb.js`  →  Task-2 asserts `ok`.

- [ ] **Step 5: Commit**

```bash
git add 1.314.html _verify_fb.js
git commit -m "feat(1.314): _fbLibraryVoicing reuses getChordTab open/barre shapes"
```

---

## Task 3: `_fbAlgoVoicing` — algorithmic guitar/uke engine

**Files:**
- Modify: `1.314.html`, `_verify_fb.js`

- [ ] **Step 1: Add the failing assertions** (append):
```js
  const t3 = await page.evaluate(() => {
    function pcsOf(strings, tuning) {
      return strings.map((s,i)=> s.fret==null?null:(((tuning[i]+s.fret)%12)+12)%12);
    }
    var p = _fbParseChord('Cadd9');           // pcs include 0,4,7,2
    var v = _fbAlgoVoicing('guitar', p.pcs, p.rootPc);
    var guitarHL = [64,59,55,50,45,40];
    return { ok: !!v, base: v && v.base,
      pcs: v && pcsOf(v.strings, guitarHL),
      span: v && (function(){ var fs=v.strings.map(s=>s.fret).filter(f=>f>0); return fs.length?Math.max.apply(null,fs)-Math.min.apply(null,fs):0; })(),
      sounding: v && v.strings.filter(s=>s.fret!=null).length };
  });
  assert('algo returns a voicing', t3.ok, t3);
  assert('algo notes are all chord tones', t3.ok && t3.pcs.filter(p=>p!=null).every(p=>[0,2,4,7].includes(p)), t3.pcs);
  assert('algo span <= 4 frets', t3.span <= 4, t3.span);
  assert('algo sounds >= 3 strings', t3.sounding >= 3, t3.sounding);
```

- [ ] **Step 2: Run to verify it fails** — `node _verify_fb.js` → Task-3 asserts FAIL.

- [ ] **Step 3: Insert the implementation** (after `_fbLibraryVoicing`):
```js
function _fbAlgoVoicing(instrument, pcs, rootPc) {
  var tuning = _FB_TUNING[instrument];
  if (!tuning) return null;
  var pcSet = {};
  pcs.forEach(function (p) { pcSet[((p % 12) + 12) % 12] = true; });
  var best = null;
  for (var base = 0; base <= 9; base++) {
    var strings = tuning.map(function (openMidi) {
      for (var f = base; f <= base + 4; f++) {
        var pc = (((openMidi + f) % 12) + 12) % 12;
        if (pcSet[pc]) return { fret: f, label: null, pc: pc };
      }
      var op = (((openMidi) % 12) + 12) % 12;
      if (base <= 4 && pcSet[op]) return { fret: 0, label: null, pc: op };
      return { fret: null, label: null, pc: null };
    });
    var soundPcs = {}, mutes = 0, rootLow = false, lowestSeen = false;
    for (var i = strings.length - 1; i >= 0; i--) { // low string first
      var s = strings[i];
      if (s.fret === null) { mutes++; continue; }
      soundPcs[s.pc] = true;
      if (!lowestSeen) { lowestSeen = true; if (s.pc === rootPc) rootLow = true; }
    }
    var coverage = Object.keys(soundPcs).length;
    var score = coverage * 10 + (rootLow ? 5 : 0) - mutes * 2 - base * 0.5;
    if (!best || score > best.score) best = { score: score, base: base, strings: strings };
  }
  if (best) best.strings.forEach(function (s) { delete s.pc; });
  return best;
}
```

- [ ] **Step 4: Run to verify it passes** — `node _verify_fb.js` → Task-3 asserts `ok`.

- [ ] **Step 5: Commit**
```bash
git add 1.314.html _verify_fb.js
git commit -m "feat(1.314): _fbAlgoVoicing algorithmic guitar/uke engine"
```

---

## Task 4: `_fbBassVoicing` — root-focused R/3/5

**Files:**
- Modify: `1.314.html`, `_verify_fb.js`

- [ ] **Step 1: Add the failing assertions** (append):
```js
  const t4 = await page.evaluate(() => {
    var p = _fbParseChord('C'); // rootPc 0, third 4 (E), fifth 7 (G)
    var v = _fbBassVoicing(p.pcs, p.rootPc, p.thirdPc, p.fifthPc);
    var labels = v ? v.strings.map(s=>s.label).filter(Boolean) : [];
    return { ok: !!v, labels: labels, hasR: labels.indexOf('R')>=0 };
  });
  assert('bass returns a voicing', t4.ok, t4);
  assert('bass marks the root (R)', t4.hasR, t4.labels);
  assert('bass labels are subset of R/3/5', t4.labels.every(l=>['R','3','5'].includes(l)), t4.labels);
```

- [ ] **Step 2: Run to verify it fails** — `node _verify_fb.js` → Task-4 asserts FAIL.

- [ ] **Step 3: Insert the implementation** (after `_fbAlgoVoicing`):
```js
function _fbBassVoicing(pcs, rootPc, thirdPc, fifthPc) {
  var tuning = _FB_TUNING.bass; // [G,D,A,E] high->low
  var targets = [
    { pc: rootPc, label: 'R' },
    { pc: thirdPc, label: '3' },
    { pc: fifthPc, label: '5' }
  ].filter(function (t) { return t.pc != null; });
  var best = null;
  for (var base = 0; base <= 7; base++) {
    var strings = tuning.map(function () { return { fret: null, label: null }; });
    var placed = {};
    targets.forEach(function (t) {
      for (var i = tuning.length - 1; i >= 0; i--) { // low string first
        if (strings[i].fret !== null) continue;
        for (var f = base; f <= base + 3; f++) {
          if ((((tuning[i] + f) % 12) + 12) % 12 === (((t.pc % 12) + 12) % 12)) {
            strings[i] = { fret: f, label: t.label };
            placed[t.label] = true;
            return;
          }
        }
      }
    });
    var count = Object.keys(placed).length;
    var score = count * 10 + (placed['R'] ? 5 : 0) - base * 0.3;
    if (!best || score > best.score) best = { score: score, base: base, strings: strings };
  }
  return best;
}
```

- [ ] **Step 4: Run to verify it passes** — `node _verify_fb.js` → Task-4 asserts `ok`.

- [ ] **Step 5: Commit**
```bash
git add 1.314.html _verify_fb.js
git commit -m "feat(1.314): _fbBassVoicing root-focused R/3/5 engine"
```

---

## Task 5: `_fbAssignFingers` — finger numbers for guitar/uke

**Files:**
- Modify: `1.314.html`, `_verify_fb.js`

- [ ] **Step 1: Add the failing assertions** (append):
```js
  const t5 = await page.evaluate(() => {
    // strings high->low; frets: open, open, open, f2, f3, mute  (C major-ish)
    var strings = [{fret:0,label:null},{fret:1,label:null},{fret:0,label:null},
                   {fret:2,label:null},{fret:3,label:null},{fret:null,label:null}];
    _fbAssignFingers(strings);
    return strings.map(s=>s.label);
  });
  // strings high->low: open, f1, open, f2, f3, mute -> labels null,"1",null,"2","3",null
  assert('fingers ascend by fret', JSON.stringify(t5) === JSON.stringify([null,"1",null,"2","3",null]), t5);
```

- [ ] **Step 2: Run to verify it fails** — `node _verify_fb.js` → Task-5 assert FAIL.

- [ ] **Step 3: Insert the implementation** (after `_fbBassVoicing`):
```js
function _fbAssignFingers(strings) {
  var fretted = [];
  strings.forEach(function (s, i) { if (s.fret && s.fret > 0) fretted.push({ i: i, fret: s.fret }); });
  if (!fretted.length) return strings;
  var byFret = {};
  fretted.forEach(function (f) { (byFret[f.fret] = byFret[f.fret] || []).push(f); });
  var frets = Object.keys(byFret).map(Number).sort(function (a, b) { return a - b; });
  var finger = 1;
  frets.forEach(function (fr) {
    byFret[fr].forEach(function (f) { strings[f.i].label = String(Math.min(finger, 4)); });
    finger++;
  });
  return strings;
}
```

- [ ] **Step 4: Run to verify it passes** — `node _verify_fb.js` → Task-5 assert `ok`. (If the assert expression is awkward, simplify it to `assert('fingers', JSON.stringify(t5)===JSON.stringify([null,"1",null,"2","3",null]), t5);`.)

- [ ] **Step 5: Commit**
```bash
git add 1.314.html _verify_fb.js
git commit -m "feat(1.314): _fbAssignFingers heuristic fingering"
```

---

## Task 6: `fbGetVoicing` — orchestrator + window calc

**Files:**
- Modify: `1.314.html`, `_verify_fb.js`

- [ ] **Step 1: Add the failing assertions** (append):
```js
  const t6 = await page.evaluate(() => ({
    cOpen:  fbGetVoicing('guitar', 'C'),
    cmaj7:  fbGetVoicing('guitar', 'Cmaj7'),
    m7b5:   fbGetVoicing('guitar', 'Bm7b5'),
    bassC:  fbGetVoicing('bass', 'C'),
    junk:   fbGetVoicing('guitar', 'H'),
  }));
  assert('orch C open -> baseFret 0', t6.cOpen && t6.cOpen.baseFret === 0, t6.cOpen);
  assert('orch C has finger labels', t6.cOpen && t6.cOpen.strings.some(s=>s.label && '1234'.includes(s.label)), t6.cOpen);
  assert('orch Cmaj7 non-empty', t6.cmaj7 && t6.cmaj7.strings.some(s=>s.fret!=null), t6.cmaj7);
  assert('orch m7b5 (algo) non-empty', t6.m7b5 && t6.m7b5.strings.some(s=>s.fret!=null), t6.m7b5);
  assert('orch bass has R label', t6.bassC && t6.bassC.strings.some(s=>s.label==='R'), t6.bassC);
  assert('orch junk -> empty model', t6.junk && t6.junk.empty === true, t6.junk);
```

- [ ] **Step 2: Run to verify it fails** — `node _verify_fb.js` → Task-6 asserts FAIL.

- [ ] **Step 3: Insert the implementation** (after `_fbAssignFingers`):
```js
function fbGetVoicing(instrument, name) {
  var p = _fbParseChord(name);
  if (!p) return { strings: [], baseFret: 0, empty: true, root: null };
  var model;
  if (instrument === 'bass') {
    var bv = _fbBassVoicing(p.pcs, p.rootPc, p.thirdPc, p.fifthPc);
    model = { strings: bv ? bv.strings.slice() : [], root: p.rootPc };
  } else {
    var raw = _fbLibraryVoicing(instrument, p) || _fbAlgoVoicing(instrument, p.pcs, p.rootPc);
    if (!raw || !raw.strings) return { strings: [], baseFret: 0, empty: true, root: p.rootPc };
    var strings = raw.strings.map(function (s) { return { fret: s.fret, label: s.label || null }; });
    _fbAssignFingers(strings);
    model = { strings: strings, root: p.rootPc };
  }
  var fs = model.strings.map(function (s) { return s.fret; }).filter(function (f) { return f && f > 0; });
  var minF = fs.length ? Math.min.apply(null, fs) : 0;
  var maxF = fs.length ? Math.max.apply(null, fs) : 0;
  model.baseFret = (maxF <= 4) ? 0 : minF;
  if (!model.strings.some(function (s) { return s.fret != null; })) model.empty = true;
  return model;
}
```

- [ ] **Step 4: Run to verify it passes** — `node _verify_fb.js` → Task-6 asserts `ok`.

- [ ] **Step 5: Commit**
```bash
git add 1.314.html _verify_fb.js
git commit -m "feat(1.314): fbGetVoicing orchestrator + window calc"
```

---

## Task 7: Panel DOM + instrument toggle + state

**Files:**
- Modify: `1.314.html` — `fkbInit()` markup + runtime functions block
- Modify: `_verify_fb.js`

- [ ] **Step 1: Add the failing DOM assertions**

In `_verify_fb.js`, replace `// === DOM ASSERTIONS ===` with:
```js
  // === DOM ASSERTIONS ===
  await page.evaluate(() => { signInAsGuest && signInAsGuest(); });
  await page.waitForTimeout(300);
  const d7 = await page.evaluate(() => {
    fkbInit(); fkbShow();
    var sec = document.getElementById('fkbFretboard');
    var btns = document.querySelectorAll('#fbSeg button[data-fbi]');
    var def = (function(){ try { return localStorage.getItem('drafthaus-fb-instrument'); } catch(e){ return null; } })();
    fbSetInstrument('bass');
    var bassDef = (function(){ try { return localStorage.getItem('drafthaus-fb-instrument'); } catch(e){ return null; } })();
    fbSetInstrument('guitar');
    return { hasSec: !!sec, nBtns: btns.length, def: def, bassDef: bassDef,
             insideePanel: !!(sec && sec.closest('#fkbPanel')) };
  });
  assert('fretboard section exists', d7.hasSec, d7);
  assert('section is inside #fkbPanel', d7.insideePanel, d7);
  assert('three instrument buttons', d7.nBtns === 3, d7.nBtns);
  assert('default instrument guitar', (d7.def === null || d7.def === 'guitar'), d7.def);
  assert('toggle persists to localStorage', d7.bassDef === 'bass', d7.bassDef);
```

- [ ] **Step 2: Run to verify it fails** — `node _verify_fb.js` → Task-7 asserts FAIL (`fkbFretboard` null / `fbSetInstrument` undefined).

- [ ] **Step 3a: Append the fretboard section to the panel markup**

In `1.314.html`, find this exact anchor inside `fkbInit()`:
```
        '<div class="fkb-body" id="fkbBody"></div>' +
      '</div>';
```
Replace it with:
```
        '<div class="fkb-body" id="fkbBody"></div>' +
        '<div class="fkb-fretboard" id="fkbFretboard" style="border-top:1px solid var(--border2,#333);padding:8px 10px;">' +
          '<div id="fbToolbar" style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">' +
            '<div id="fbSeg" style="display:inline-flex;border:1px solid #34344a;border-radius:7px;overflow:hidden;">' +
              '<button type="button" data-fbi="guitar" onclick="fbSetInstrument(\'guitar\')" style="background:#1a1a26;color:#9a9aae;border:none;padding:4px 12px;font-size:11px;cursor:pointer;">Guitar</button>' +
              '<button type="button" data-fbi="ukulele" onclick="fbSetInstrument(\'ukulele\')" style="background:#1a1a26;color:#9a9aae;border:none;border-left:1px solid #34344a;padding:4px 12px;font-size:11px;cursor:pointer;">Uke</button>' +
              '<button type="button" data-fbi="bass" onclick="fbSetInstrument(\'bass\')" style="background:#1a1a26;color:#9a9aae;border:none;border-left:1px solid #34344a;padding:4px 12px;font-size:11px;cursor:pointer;">Bass</button>' +
            '</div>' +
            '<span id="fbChordName" style="font-size:13px;color:#e0b450;font-weight:700;">—</span>' +
          '</div>' +
          '<div id="fbNeck"></div>' +
        '</div>' +
      '</div>';
```

- [ ] **Step 3b: Add the state + toggle runtime** (in the `fb*` block in `1.314.html`, after `fbGetVoicing`):
```js
var _fbInstrument = (function () { try { return localStorage.getItem('drafthaus-fb-instrument') || 'guitar'; } catch (e) { return 'guitar'; } })();
var _fbCurrentChord = null;

function fbSetInstrument(id) {
  _fbInstrument = id;
  try { localStorage.setItem('drafthaus-fb-instrument', id); } catch (e) {}
  fbUpdateToggle();
  if (typeof fbRender === 'function') fbRender(); // fbRender lands in Task 8; guard is permanent + harmless
}
function fbUpdateToggle() {
  var seg = document.getElementById('fbSeg');
  if (!seg) return;
  seg.querySelectorAll('button[data-fbi]').forEach(function (b) {
    var on = b.getAttribute('data-fbi') === _fbInstrument;
    b.style.background = on ? '#e0b450' : '#1a1a26';
    b.style.color = on ? '#1a1a1a' : '#9a9aae';
    b.style.fontWeight = on ? '700' : '400';
  });
}
function fbShowChord(name) { _fbCurrentChord = name; if (typeof fbRender === 'function') fbRender(); }
```
> Both `fbSetInstrument` and `fbShowChord` guard the `fbRender` call with `typeof` because `fbRender` isn't defined until Task 8. The Task-7 asserts call `fbSetInstrument`, which must not throw. The guard is permanent and harmless.

- [ ] **Step 4: Run to verify it passes** — `node _verify_fb.js` → Task-7 asserts `ok`.

- [ ] **Step 5: Commit**
```bash
git add 1.314.html _verify_fb.js
git commit -m "feat(1.314): fretboard panel section + instrument toggle + persistence"
```

---

## Task 8: `fbRender` + `_fbNeckSVG` — horizontal neck rendering

**Files:**
- Modify: `1.314.html`, `_verify_fb.js`

- [ ] **Step 1: Add the failing assertions** (append, after Task-7 block):
```js
  const d8 = await page.evaluate(() => {
    fbSetInstrument('guitar');
    fbShowChord(null);
    var empty = document.getElementById('fbNeck').innerHTML;
    var nameEmpty = document.getElementById('fbChordName').textContent;
    fbShowChord('C');
    var neck = document.getElementById('fbNeck').innerHTML;
    var nameC = document.getElementById('fbChordName').textContent;
    fbSetInstrument('bass'); fbShowChord('C');
    var bassNeck = document.getElementById('fbNeck').innerHTML;
    fbSetInstrument('guitar');
    return {
      emptyHasSvg: /<svg/.test(empty), nameEmpty: nameEmpty,
      cHasDot: (neck.match(/<circle/g)||[]).length > 0, nameC: nameC,
      cHasFretNums: /<text[^>]*>1<\/text>/.test(neck),
      bassHasR: />R<\/text>/.test(bassNeck),
    };
  });
  assert('empty state renders a neck svg', d8.emptyHasSvg, d8);
  assert('empty chord name is dash', d8.nameEmpty === '—', d8.nameEmpty);
  assert('C renders finger dots', d8.cHasDot, d8);
  assert('C chord name shown', d8.nameC === 'C', d8.nameC);
  assert('neck shows fret numbers', d8.cHasFretNums, d8);
  assert('bass C renders an R label', d8.bassHasR, d8);
```

- [ ] **Step 2: Run to verify it fails** — `node _verify_fb.js` → Task-8 asserts FAIL (`fbRender` undefined).

- [ ] **Step 3: Insert the implementation** (after `fbShowChord` in `1.314.html`):
```js
function fbRender() {
  var host = document.getElementById('fbNeck');
  if (!host) return;
  fbUpdateToggle();
  var nameEl = document.getElementById('fbChordName');
  if (nameEl) nameEl.textContent = _fbCurrentChord || '—';
  var nStr = (_fbInstrument === 'guitar') ? 6 : 4;
  var model = _fbCurrentChord ? fbGetVoicing(_fbInstrument, _fbCurrentChord) : null;
  host.innerHTML = _fbNeckSVG(model, nStr);
}

function _fbNeckSVG(model, nStr) {
  var COLS = 5, COLW = 60, NUTX = 46, ROWGAP = 22, TOP = 20, LEFTPAD = 30;
  var neckRight = NUTX + COLS * COLW;
  var bottom = TOP + (nStr - 1) * ROWGAP;
  var W = neckRight + 14, H = bottom + 34;
  var base = (model && !model.empty) ? (model.baseFret || 0) : 0;
  var firstFret = base === 0 ? 1 : base;
  var INLAYS = { 3:1, 5:1, 7:1, 9:1, 12:2 };

  var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" height="' + Math.min(H, 200) + '" style="display:block">';
  // fretboard
  svg += '<rect x="' + NUTX + '" y="' + (TOP - 6) + '" width="' + (COLS * COLW) + '" height="' + ((nStr - 1) * ROWGAP + 12) + '" fill="#241a12" rx="3"/>';
  // nut (only in open window) or start-fret label
  if (base === 0) svg += '<rect x="' + (NUTX - 4) + '" y="' + (TOP - 6) + '" width="6" height="' + ((nStr - 1) * ROWGAP + 12) + '" fill="#cfcfdf"/>';
  else svg += '<text x="' + (NUTX - 8) + '" y="' + (TOP - 9) + '" fill="#e0b450" font-size="11" font-weight="700" text-anchor="end">' + firstFret + 'fr</text>';
  // fret lines
  for (var c = 1; c <= COLS; c++) {
    var fx = NUTX + c * COLW;
    svg += '<line x1="' + fx + '" y1="' + (TOP - 6) + '" x2="' + fx + '" y2="' + (bottom + 6) + '" stroke="#5a4a38" stroke-width="2"/>';
  }
  // inlays
  for (var c2 = 0; c2 < COLS; c2++) {
    var absF = firstFret + c2;
    if (INLAYS[absF]) {
      var cx = NUTX + c2 * COLW + COLW / 2;
      if (INLAYS[absF] === 2) {
        svg += '<circle cx="' + cx + '" cy="' + (TOP + ROWGAP * 0.7) + '" r="4" fill="#3a2c1c"/>';
        svg += '<circle cx="' + cx + '" cy="' + (bottom - ROWGAP * 0.7) + '" r="4" fill="#3a2c1c"/>';
      } else {
        svg += '<circle cx="' + cx + '" cy="' + ((TOP + bottom) / 2) + '" r="5" fill="#3a2c1c"/>';
      }
    }
  }
  // strings
  for (var r = 0; r < nStr; r++) {
    var y = TOP + r * ROWGAP;
    svg += '<line x1="' + NUTX + '" y1="' + y + '" x2="' + neckRight + '" y2="' + y + '" stroke="#8a8a9a" stroke-width="1.3"/>';
  }
  // fret numbers
  for (var c3 = 0; c3 < COLS; c3++) {
    var nx = NUTX + c3 * COLW + COLW / 2;
    svg += '<text x="' + nx + '" y="' + (bottom + 22) + '" fill="#6a6a7a" font-size="9" text-anchor="middle">' + (firstFret + c3) + '</text>';
  }
  // dots / markers
  if (model && model.strings && model.strings.length) {
    model.strings.forEach(function (s, r) {
      var y = TOP + r * ROWGAP;
      if (s.fret === null) {
        svg += '<text x="' + (NUTX - 16) + '" y="' + (y + 4) + '" fill="#e0556e" font-size="12" text-anchor="middle">✕</text>';
      } else if (s.fret === 0) {
        svg += '<text x="' + (NUTX - 16) + '" y="' + (y + 4) + '" fill="#7aa2ff" font-size="12" text-anchor="middle">○</text>';
        if (s.label) svg += '<text x="' + (NUTX - 16) + '" y="' + (y - 8) + '" fill="#5fd3a3" font-size="9" font-weight="700" text-anchor="middle">' + s.label + '</text>';
      } else {
        var col = s.fret - firstFret;
        if (col < 0 || col >= COLS) return;
        var dx = NUTX + col * COLW + COLW / 2;
        var isBass = (s.label === 'R' || s.label === '3' || s.label === '5');
        var fill = (s.label === 'R') ? '#e0b450' : (isBass ? '#5fd3a3' : '#e0b450');
        svg += '<circle cx="' + dx + '" cy="' + y + '" r="10" fill="' + fill + '"/>';
        if (s.label) svg += '<text x="' + dx + '" y="' + (y + 4) + '" fill="#1a1a1a" font-size="11" font-weight="700" text-anchor="middle">' + s.label + '</text>';
      }
    });
  }
  svg += '</svg>';
  return svg;
}
```

- [ ] **Step 4: Run to verify it passes** — `node _verify_fb.js` → Task-8 asserts `ok`.

- [ ] **Step 5: Sanity screenshot** (optional manual check)

Add temporarily to the harness before `browser.close()` (then remove):
```js
await page.evaluate(() => { fbSetInstrument('guitar'); fbShowChord('Cmaj7'); });
await page.screenshot({ path: '_fb_shot.png' });
```
Run `node _verify_fb.js`, open `_fb_shot.png`, confirm the neck looks right, then delete those two lines and `_fb_shot.png`.

- [ ] **Step 6: Commit**
```bash
git add 1.314.html _verify_fb.js
git commit -m "feat(1.314): fbRender + horizontal-neck SVG renderer"
```

---

## Task 9: Hook the renderer into chord clicks

**Files:**
- Modify: `1.314.html` — `seqShowChordOnKeyboard`
- Modify: `_verify_fb.js`

- [ ] **Step 1: Add the failing assertion** (append):
```js
  const d9 = await page.evaluate(() => {
    fbSetInstrument('guitar'); fbShowChord(null);
    seqShowChordOnKeyboard('G');
    return { name: document.getElementById('fbChordName').textContent,
             hasDot: (document.getElementById('fbNeck').innerHTML.match(/<circle/g)||[]).length > 0 };
  });
  assert('seqShowChordOnKeyboard drives the fretboard', d9.name === 'G' && d9.hasDot, d9);
```

- [ ] **Step 2: Run to verify it fails** — `node _verify_fb.js` → Task-9 assert FAIL (name still `—`).

- [ ] **Step 3: Insert the hook**

In `1.314.html`, find this exact line (inside `seqShowChordOnKeyboard`):
```
  fkbHighlightChord(midiNotes);
```
Replace with:
```
  fkbHighlightChord(midiNotes);
  if (typeof fbShowChord === 'function') fbShowChord(chordName);
```

- [ ] **Step 4: Run to verify it passes** — `node _verify_fb.js` → Task-9 assert `ok`.

- [ ] **Step 5: Commit**
```bash
git add 1.314.html _verify_fb.js
git commit -m "feat(1.314): drive fretboard from seqShowChordOnKeyboard"
```

---

## Task 10: Make keyboard + fretboard sticky

**Files:**
- Modify: `1.314.html` — `seqPillRelease`
- Modify: `_verify_fb.js`

- [ ] **Step 1: Add the failing assertion** (append):
```js
  const d10 = await page.evaluate(() => {
    fbSetInstrument('guitar');
    seqPillPress('A', 5);   // press
    seqPillRelease();       // release — should NOT clear
    var afterRelease = {
      name: document.getElementById('fbChordName').textContent,
      kbHl: document.querySelectorAll('#seqKeyboard .seq-key.chord-highlight').length,
    };
    seqPillPress('D', 1); seqPillRelease(); // next chord replaces
    return { afterRelease: afterRelease, replacedName: document.getElementById('fbChordName').textContent };
  });
  assert('fretboard stays after release', d10.afterRelease.name === 'A', d10);
  assert('keyboard glow stays after release', d10.afterRelease.kbHl > 0, d10);
  assert('next chord replaces previous', d10.replacedName === 'D', d10);
```

- [ ] **Step 2: Run to verify it fails** — `node _verify_fb.js` → "stays after release" asserts FAIL (currently cleared).

- [ ] **Step 3: Remove the clear-on-release**

In `1.314.html`, find this exact block:
```
function seqPillRelease() {
  seqHideChordOnKeyboard();
```
Replace with:
```
function seqPillRelease() {
  // v1.314: sticky — keyboard glow + fretboard persist until the next chord is pressed
  // (the new-chord clear at the top of seqShowChordOnKeyboard handles replacement).
```

- [ ] **Step 4: Run to verify it passes** — `node _verify_fb.js` → Task-10 asserts `ok`, all prior asserts still `ok`.

- [ ] **Step 5: Commit**
```bash
git add 1.314.html _verify_fb.js
git commit -m "feat(1.314): sticky chord highlight — keyboard glow + fretboard persist"
```

---

## Task 11: Full acceptance run + regression sweep

**Files:**
- Modify: `_verify_fb.js` (add regression checks)

- [ ] **Step 1: Add regression assertions** (append):
```js
  const d11 = await page.evaluate(() => {
    var errs = [];
    // octave +/- still work
    try { fkbResize(1); fkbResize(-1); } catch(e){ errs.push('resize:'+e.message); }
    // minimize/restore still works and hides/shows fretboard with the body
    try { fkbToggleMinimize(); fkbToggleMinimize(); } catch(e){ errs.push('min:'+e.message); }
    // up-the-neck windowing produces an 'fr' label for a high voicing
    fbSetInstrument('guitar'); fbShowChord('G#m7');
    var hasFr = /fr<\/text>/.test(document.getElementById('fbNeck').innerHTML) || (fbGetVoicing('guitar','G#m7').baseFret > 0);
    return { errs: errs, hasFr: hasFr };
  });
  assert('no errors from resize/minimize', d11.errs.length === 0, d11.errs);
  assert('up-the-neck shows start-fret window', d11.hasFr, d11);
```

- [ ] **Step 2: Run the full harness**

Run: `node _verify_fb.js`
Expected: every assert prints `ok`, final line `N passed, 0 failed`, exit code 0, **no `pageerror` lines** other than expected guest-mode Firestore `permission-denied` noise (those surface as console messages, not pageerror — the harness only fails on `pageerror`).

- [ ] **Step 3: Mobile no-op check**

Run a quick mobile-viewport check:
```bash
node -e "const{chromium}=require('playwright-core');const path=require('path');(async()=>{const b=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});const p=await b.newPage({viewport:{width:390,height:800}});let err=0;p.on('pageerror',e=>{err++;console.log('ERR',e.message)});await p.addInitScript(()=>{try{localStorage.setItem('drafthaus-eula-accepted','1')}catch(e){}});await p.goto('file://'+path.resolve('1.314.html'));await p.waitForTimeout(400);const r=await p.evaluate(()=>{fkbInit&&fkbInit();return!!document.getElementById('fkbFretboard')});console.log('mobile fretboard present:',r,'errors:',err);await b.close();process.exit((r===false&&err===0)?0:1)})()"
```
Expected: `mobile fretboard present: false errors: 0` (fkbInit bails under 768px).

- [ ] **Step 4: Map back to the spec's 9-point checklist**

Confirm each spec verification point is now covered by an asserted check:
1 renders/stacks → Task7 · 2 open chord → Task6/8 · 3 rich quality → Task6 · 4 windowing → Task11 · 5 toggle/bass → Task7/8 · 6 persistence → Task7 · 7 sticky → Task10 · 8 no regressions → Task11 · 9 mobile → Task11 Step3. If any is unchecked, add the assert before proceeding.

- [ ] **Step 5: Commit**
```bash
git add _verify_fb.js
git commit -m "test(1.314): regression sweep + mobile no-op check"
```

---

## Task 12: Promote 1.314 → index + docs (gated on user sign-off)

**Files:**
- Modify: `index.html` (overwrite with 1.314)
- Modify: `CLAUDE.md`

- [ ] **Step 1: STOP — get user sign-off**

Per the versioning workflow, promotion + push deploys `drafthaus.ca`. Do **not** run the remaining steps until the user has tested 1.314 (iPhone/desktop) and explicitly approves promoting. Surface the verify results and ask.

- [ ] **Step 2: Promote and confirm byte-identical**

Run:
```bash
cp 1.314.html index.html && diff -q 1.314.html index.html && echo OK
```
Expected: `OK`.

- [ ] **Step 3: Update CLAUDE.md**

In `CLAUDE.md`, update the deployed-build sentence to point at `1.314.html` and note the new floating fretboard overlay + the sticky-highlight behavior change (chord pills now leave the keyboard glow on until the next chord). Keep the base-drift heads-up.

- [ ] **Step 4: Commit (do not push without explicit confirmation)**
```bash
git add index.html 1.314.html CLAUDE.md
git commit -m "feat: promote 1.314 (floating guitar/uke/bass fretboard + sticky chord highlight) to index"
```

- [ ] **Step 5: Push only after the user says so**

Run (only on explicit go-ahead): `git push origin main`
Expected: GitHub Pages redeploys `drafthaus.ca`.

---

## Self-review notes

- **Spec coverage:** parse (T1), library-first hybrid (T2), algorithmic fallback (T3), bass root-focus R/3/5 (T4), fingering (T5), orchestrator+window (T6), panel/toggle/persistence (T7), horizontal-neck render incl. inlays/fret-numbers/empty-state (T8), single hook (T9), sticky behavior change (T10), 9-point verification + mobile no-op (T11), promote+docs (T12). All spec sections map to a task.
- **Cleanup reminder:** the `_fb_shot.png` and temp screenshot lines from Task 8 Step 5 must be removed before Task 8 commit. `_verify_fb.js` is a tracked helper (matches existing `_verify_13xx.js` convention) and stays.
- **Type consistency:** model shape `{strings:[{fret,label}], baseFret, root, empty?}` is produced by `fbGetVoicing` (T6) and consumed by `_fbNeckSVG` (T8); intermediate engines return `{base, strings}` normalized inside `fbGetVoicing`. Instrument ids `'guitar'|'ukulele'|'bass'` used consistently in `_FB_TUNING`, `_FB_QUAL_MAP` lookups, toggle `data-fbi`, and `getChordTab` calls.
```
