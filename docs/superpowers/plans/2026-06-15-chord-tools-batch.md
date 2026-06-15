# Chord-Tools Batch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship three phases of Quick Chords (QC) + Find-a-Chord (FC) improvements in Drafthaus Lite: P1 QC quick wins, P2 shared Standard/E♭ tuning, P3 FC full scrollable neck with mute + tap-to-hear.

**Architecture:** Single-file vanilla-JS app. Each phase = one whole-file snapshot (`cp index.html lite-1.0NN.html`), edited in place, verified by a headless `_verify_lite_10NN.js` (playwright-core + installed Chrome over local HTTP), then promoted (`cp lite-1.0NN.html index.html`), committed, pushed, deploy-polled, memory updated. Base = lite-1.053 (= index).

**Tech Stack:** HTML/CSS/vanilla JS, Web Audio, Firebase (Firestore), playwright-core for headless verification.

**Spec:** `docs/superpowers/specs/2026-06-14-chord-tools-batch-design.md`

**Conventions (from memory `drafthaus-lite.md`):**
- Re-locate code by searching quoted strings/function names (line numbers drift).
- After edits: `python3 -c "d=open(F,'rb').read();print(d.count(b'\x00'));d.decode('utf-8')"` (NUL/utf-8 guard — an Edit once injected a NUL), and `node -e` script-parse check.
- To stop listeners in tests: `_songsUnsub()` / `stopTakesListener()` (no `stopSongsListener` fn).
- Deploy poll: GitHub Pages takes ~4 tries (~80s) before the new file 200s.

---

## Phase 1 — Quick Chords quick wins → lite-1.054

**Files:** `lite-1.054.html` (new, from index), `_verify_lite_1054.js` (new), `index.html` (promote).

- [ ] **Step 1: Snapshot + confirm clean copy**

```bash
cd /Users/jasoncraig/Documents/Claude/Projects/Drafthaus
cp index.html lite-1.054.html && diff index.html lite-1.054.html && echo "CLEAN COPY"
```
Expected: no diff output, then `CLEAN COPY`.

- [ ] **Step 2 (1a): Uke Cm/C#m barre bar** — extend `_DB_OVERRIDE`.

Find `const _DB_OVERRIDE = {` and add a `ukulele` block. Replace:
```js
const _DB_OVERRIDE = {
  guitar: {  // f = [e,B,G,D,A,E] high→low, -1 = mute; b = barre fret(s)
    'Cm':  { f: [3, 4, 5, 5, 3, -1], fi: [1, 2, 4, 3, 1, 0], b: [3] },
    'C#m': { f: [4, 5, 6, 6, 4, -1], fi: [1, 2, 4, 3, 1, 0], b: [4] },
  },
};
```
with:
```js
const _DB_OVERRIDE = {
  guitar: {  // f = [e,B,G,D,A,E] high→low, -1 = mute; b = barre fret(s)
    'Cm':  { f: [3, 4, 5, 5, 3, -1], fi: [1, 2, 4, 3, 1, 0], b: [3] },
    'C#m': { f: [4, 5, 6, 6, 4, -1], fi: [1, 2, 4, 3, 1, 0], b: [4] },
  },
  ukulele: {  // f = [A,E,C,G] per _FB_TUNING.ukulele; same correct shapes, now show the barre
    'Cm':  { f: [3, 3, 3, 0], fi: [3, 2, 1, 0], b: [3] },
    'C#m': { f: [4, 4, 4, 1], fi: [4, 3, 2, 1], b: [4] },
  },
};
```

- [ ] **Step 3 (1b): Auto-play the I chord on key change** — in `_qcSetKey`.

Find `function _qcSetKey(k) {` and replace the whole function:
```js
function _qcSetKey(k) {
  _qcKey = k;
  // Keep a loaded song's key in sync (mirrors the old key-picker behaviour).
  if (_currentSong && _currentSong.key !== k) {
    _currentSong.key = k;
    try { db.collection('songs').doc(_currentSong.id).set({ key: k, updatedAt: Date.now() }, { merge: true }); } catch (e) {}
  }
  // Selecting a new key auto-draws + strums the tonic (I) chord.
  const km = _songKeyMode(k);
  const tonic = seqGetScaleChords(km.key, km.mode)[0];
  if (tonic) { _qcSelected = tonic; qcRender(); playChordOnInstrument(tonic, _qcInstrument); }
  else qcRender();
}
```

- [ ] **Step 4 (1c): String names on the QC fretboard** — in `_fbNeckSVG`.

Find the string-lines loop in `_fbNeckSVG`:
```js
  for (let r = 0; r < nStr; r++) { const y = TOP + r * ROWGAP; svg += '<line x1="'+NUTX+'" y1="'+y+'" x2="'+neckRight+'" y2="'+y+'" stroke="#8a8a9a" stroke-width="1.3"/>'; }
```
Immediately AFTER that line, insert a string-name label loop (instrument derived from `nStr`):
```js
  { const _t = (nStr === 4) ? _FB_TUNING.ukulele : _FB_TUNING.guitar;
    for (let r = 0; r < nStr; r++) { const y = TOP + r * ROWGAP; svg += '<text x="10" y="'+(y+4)+'" fill="#9a9aae" font-size="10" font-weight="700" text-anchor="middle">'+SEQ_NOTES[(((_t[r]||0)%12)+12)%12]+'</text>'; } }
```
(`_fbNeckSVG` has `NUTX=46` with ○/✕ markers at `NUTX-16=30`; labels at `x=10` clear them. The viewBox starts at 0, so x=10 is inside it.)

- [ ] **Step 5 (1d): Borrowed chords label-on-top** — markup in `qcRender` + CSS.

In `qcRender`, find the borrowed block:
```js
    borrowed.forEach(b => { bor += '<div class="qc-bpill' + (_qcSelected === b.name ? ' playing' : '') + '" onclick="qcPlayPill(\'' + b.name + '\')"><span class="lab">' + (b.label || '') + '</span>' + _spellChordName(b.name, flats) + '</div>'; });
```
Replace with a label-over-pill column:
```js
    borrowed.forEach(b => { bor += '<div class="qc-bcol"><div class="qc-ivl">' + (b.label || '') + '</div><div class="qc-bpill' + (_qcSelected === b.name ? ' playing' : '') + '" onclick="qcPlayPill(\'' + b.name + '\')">' + _spellChordName(b.name, flats) + '</div></div>'; });
```

Then update the `.qc-borrowed` CSS. Find `.qc-borrowed` rule (search `.qc-borrowed {`); ensure it lays the columns in a wrapping row and add `.qc-bcol`. Add after the existing `.qc-bpill` rule:
```css
.qc-borrowed { display: flex; flex-wrap: wrap; gap: 8px; }
.qc-bcol { display: flex; flex-direction: column; align-items: center; gap: 4px; }
.qc-bcol .qc-ivl { font-size: 10px; font-weight: 800; color: var(--text-2); text-transform: none; }
```
(Remove/neutralize the now-unused `.qc-bpill .lab` rule if present, and drop any `.qc-borrowed` `display` that conflicts. Search `.qc-bpill .lab` and `.qc-borrowed` to confirm before editing.)

- [ ] **Step 6: Validate file (NUL / utf-8 / parse)**

```bash
python3 -c "d=open('lite-1.054.html','rb').read(); print('NUL:',d.count(b'\x00')); d.decode('utf-8'); print('utf8 OK')"
node -e "const h=require('fs').readFileSync('lite-1.054.html','utf8');const m=h.match(/<script>([\s\S]*)<\/script>\s*<\/body>/);try{new Function(m[1]);console.log('parses OK')}catch(e){console.log('SYNTAX ERR:',e.message)}"
```
Expected: `NUL: 0`, `utf8 OK`, `parses OK`.

- [ ] **Step 7: Write headless verify** — `_verify_lite_1054.js`

Derive from the latest verify and add a P1 block:
```bash
sed 's/lite-1\.053/lite-1.054/g; s/_shot_lite_1053/_shot_lite_1054/g' _verify_lite_1053.js > _verify_lite_1054.js
```
Then insert this block before the `// ── Screenshots ──` block:
```js
  // ── Phase 1: uke barre bar, auto-play I chord, QC string names, borrowed layout ──
  {
    const page = await (await desktopCtx()).newPage();
    page.on('pageerror', e => errors.push('PAGEERROR(p1): ' + e.message));
    await page.goto(base, { waitUntil: 'load' });
    await page.click('.auth-card .auth-btn.ghost');
    await page.waitForSelector('body.signed-in', { timeout: 15000 });
    assert('uke: Cm/C#m keep correct shapes + now carry a barre bar', await page.evaluate(() => {
      const cm = fbGetVoicing('ukulele', 'Cm'), csm = fbGetVoicing('ukulele', 'C#m');
      return JSON.stringify(cm.strings.map(s => s.fret)) === JSON.stringify([3, 3, 3, 0]) && cm.barres.includes(3)
        && JSON.stringify(csm.strings.map(s => s.fret)) === JSON.stringify([4, 4, 4, 1]) && csm.barres.includes(4);
    }));
    await page.evaluate(() => openQuickChords());
    await page.waitForTimeout(60);
    assert('autoplay: changing the key sets _qcSelected to the tonic I chord', await page.evaluate(() => {
      let played = null; const orig = playChordOnInstrument; playChordOnInstrument = (n) => { played = n; };
      qcOnRoot({ value: 'G major' });
      const r = (_qcSelected === 'G' && played === 'G');
      playChordOnInstrument = orig; return r;
    }));
    assert('autoplay: switching to A minor selects + would play Am', await page.evaluate(() => {
      let played = null; const orig = playChordOnInstrument; playChordOnInstrument = (n) => { played = n; };
      qcOnRoot({ value: 'A minor' }); qcOnMode('minor'); // ensure minor mode + A
      const r = (_qcSelected === 'Am' && played === 'Am');
      playChordOnInstrument = orig; return r;
    }));
    assert('qcstrings: QC fretboard shows string-name labels (E A D G B)', await page.evaluate(() => {
      const t = document.getElementById('qcNeck').textContent;
      return /E/.test(t) && /A/.test(t) && /D/.test(t) && /G/.test(t) && /B/.test(t);
    }));
    assert('borrowed: each borrowed chord is a label-over-pill .qc-bcol', await page.evaluate(() => {
      const cols = document.querySelectorAll('#qcPills .qc-borrowed .qc-bcol');
      if (!cols.length) return false;
      const c = cols[0];
      const ivl = c.querySelector('.qc-ivl'), pill = c.querySelector('.qc-bpill');
      return !!ivl && !!pill && ivl.compareDocumentPosition(pill) & Node.DOCUMENT_POSITION_FOLLOWING; // label before pill (stacked)
    }));
  }
```

- [ ] **Step 8: Run verify**

```bash
node _verify_lite_1054.js 2>&1 | grep -E "uke:|autoplay:|qcstrings:|borrowed:|FAIL|fatal"
echo "PASS: $(node _verify_lite_1054.js 2>&1 | grep -c PASS) FAIL: $(node _verify_lite_1054.js 2>&1 | grep -c FAIL)"
```
Expected: all new asserts PASS, `FAIL: 0`. Fix code/tests until green.

- [ ] **Step 9: Screenshot QC (open chord shows string names; borrowed stacked)** — render `_shot_1054_qc.png` (mobile ctx, open QC, select a borrowed chord) and visually confirm string names + stacked borrowed + uke barre (toggle uke, select Cm).

- [ ] **Step 10: Promote + commit + push**

```bash
cp lite-1.054.html index.html && diff lite-1.054.html index.html && echo "index == lite-1.054"
git add lite-1.054.html _verify_lite_1054.js index.html
git commit -m "feat(lite-1.054): uke barre bar, auto-play I chord on key change, QC string names, borrowed label-on-top"
git push origin main
```

- [ ] **Step 11: Poll deploy + update memory**

```bash
for i in $(seq 1 10); do v=$(curl -s -o /dev/null -w '%{http_code}' https://drafthaus.ca/lite-1.054.html); [ "$v" = 200 ] && { echo live; break; }; echo "wait $i"; sleep 20; done
```
Then append a `1.054` bullet to memory `drafthaus-lite.md` and bump "Latest Lite".

---

## Phase 2 — Shared Standard/E♭ tuning → lite-1.055

**Files:** `lite-1.055.html` (from index), `_verify_lite_1055.js`, `index.html`.

Pre-task: `grep -n "playNotesStrum(" index.html` to confirm callers. Only QC (`playChordOnInstrument`) and FC (`fcPlay`, tap) should get the tuning shift — verify no lyrics-chordPop caller needs it; if chordPop uses `playChordOnInstrument`, gate the shift behind the QC/FC screen instead (see Step note).

- [ ] **Step 1: Snapshot**
```bash
cp index.html lite-1.055.html && diff index.html lite-1.055.html && echo CLEAN
```

- [ ] **Step 2: Tuning state + helpers** — add near `let _qcKey = 'C major';`:
```js
let _tuning = (function(){ try { return localStorage.getItem('dh-lite-tuning') || 'standard'; } catch(e){ return 'standard'; } })();
function _tuneShift() { return _tuning === 'eb' ? -1 : 0; }
function _tunedTuning(inst) { const s = _tuneShift(); return _FB_TUNING[inst].map(m => m + s); }
// Display a chord internal name with the active tuning + flat spelling in E♭.
function _dispChord(name) {
  if (_tuning !== 'eb') return _spellChordName(name, _useFlats(_qcKey));
  const clean = String(name).replace('_viii', '');
  let root, qual;
  if (clean.length >= 2 && clean[1] === '#') { root = clean.slice(0, 2); qual = clean.slice(2); } else { root = clean[0]; qual = clean.slice(1); }
  const pc = SEQ_NOTES.indexOf(root); if (pc < 0) return clean;
  return _spellNote(((pc - 1) % 12 + 12) % 12, true) + qual; // down a semitone, flat-spelled
}
function _setTuning(t) {
  _tuning = t;
  try { localStorage.setItem('dh-lite-tuning', t); } catch (e) {}
  if (_currentSong) { _currentSong.tuning = t; try { db.collection('songs').doc(_currentSong.id).set({ tuning: t, updatedAt: Date.now() }, { merge: true }); } catch (e) {} }
  if (document.getElementById('screen-qc').classList.contains('active')) qcRender();
  if (document.getElementById('screen-fc').classList.contains('active')) fcUpdate();
}
function qcOnTuning(sel) { _setTuning(sel.value); }
function fcOnTuning(sel) { _setTuning(sel.value); }
```

- [ ] **Step 3: QC header layout + tuning dropdown** — markup. Find the `.qc-key-row` div and replace:
```html
    <div class="qc-key-row">
      <select class="key-sel" id="qcKeyRoot" onchange="qcOnRoot(this)" aria-label="Key root"></select>
      <select class="key-sel" id="qcKeyMode" onchange="qcOnMode(this.value)" aria-label="Major or minor"></select>
    </div>
```
with:
```html
    <div class="qc-key-row">
      <div class="qc-key-left">
        <select class="key-sel" id="qcKeyRoot" onchange="qcOnRoot(this)" aria-label="Key root"></select>
        <select class="key-sel" id="qcKeyMode" onchange="qcOnMode(this.value)" aria-label="Major or minor"></select>
      </div>
      <select class="key-sel tuning-sel" id="qcTuning" onchange="qcOnTuning(this)" aria-label="Tuning">
        <option value="standard">Standard</option><option value="eb">E♭</option>
      </select>
    </div>
```
CSS — change `.qc-key-row` to `justify-content: space-between; align-items: center; padding: 6px 12px 10px;` and add `.qc-key-left { display: flex; gap: 10px; }`.

- [ ] **Step 4: FC tuning dropdown** — add to FC header. Find the FC `<div class="seg" id="fcSeg">` block; after the seg add (or place in the `.fc-picker` row):
```html
      <select class="key-sel tuning-sel" id="fcTuning" onchange="fcOnTuning(this)" aria-label="Tuning" style="margin-left:auto">
        <option value="standard">Standard</option><option value="eb">E♭</option>
      </select>
```
(Adjust placement to match the FC header fl/layout; ensure both `#qcTuning` and `#fcTuning` reflect `_tuning` on render — set `.value = _tuning` in `qcRender`/`fcRender`.)

- [ ] **Step 5: Apply tuning to QC render + audio**
  - In `qcRender`, set `document.getElementById('qcTuning').value = _tuning;`, and replace the chord-name display calls `_spellChordName(name, flats)` / `_spellChordName(v, flats)` / `_spellChordName(b.name, flats)` and `#qcChordName` text with `_dispChord(name)` etc. (the diatonic scale is still computed for `_qcKey`; only display changes).
  - In `playChordOnInstrument`, apply the shift: change
    `if (model && model.strings) model.strings.forEach((s, i) => { if (s.fret != null) midis.push(tuning[i] + s.fret); });`
    to add `+ _tuneShift()`:
    `... midis.push(tuning[i] + s.fret + _tuneShift());` and likewise the `_chordToMidi` fallback `.forEach(m => midis.push(m + _tuneShift()))`.
  - Init `_tuning` on open: in `openQuickChords`, before `qcRender()`, add
    `_tuning = _currentSong && _currentSong.tuning ? _currentSong.tuning : (localStorage.getItem('dh-lite-tuning') || 'standard');`

- [ ] **Step 6: Apply tuning to FC** — string labels, identity, play, init.
  - In `fcRenderNeck`, set `document.getElementById('fcTuning').value = _tuning;` (or in `fcRender`), and change the string-label note source from `tuning[r]` to the tuned tuning: replace `SEQ_NOTES[((tuning[r]%12)+12)%12]` with `SEQ_NOTES[(((tuning[r]+_tuneShift())%12)+12)%12]`.
  - In `fcPlacedMidis`, add the shift: `out.push(t[i] + f + _tuneShift());` so identification + playback drop a semitone.
  - In `openFindChord`, init `_tuning` the same way as `openQuickChords`.

- [ ] **Step 7: Validate file (NUL/utf-8/parse)** — same commands as P1 Step 6 on `lite-1.055.html`.

- [ ] **Step 8: Write verify** — `_verify_lite_1055.js` (derive from 1054). Add:
```js
  // ── Phase 2: tuning layout + E♭ relabel + audio shift + persistence ──
  {
    const page = await (await desktopCtx()).newPage();
    page.on('pageerror', e => errors.push('PAGEERROR(p2): ' + e.message));
    await page.goto(base, { waitUntil: 'load' });
    await page.click('.auth-card .auth-btn.ghost');
    await page.waitForSelector('body.signed-in', { timeout: 15000 });
    await page.evaluate(() => openQuickChords());
    await page.waitForTimeout(60);
    assert('layout: root/mode left, tuning right', await page.evaluate(() => {
      const left = document.querySelector('.qc-key-left'), tun = document.getElementById('qcTuning');
      return !!left && !!tun && left.getBoundingClientRect().right <= tun.getBoundingClientRect().left + 1;
    }));
    await page.evaluate(() => { qcOnRoot({ value: 'A minor' }); });
    await page.waitForTimeout(40);
    const std = await page.evaluate(() => document.querySelector('#qcPills .qc-col .qc-pill').textContent.trim());
    assert('relabel: A minor I reads "Am" in Standard', std === 'Am');
    await page.selectOption('#qcTuning', 'eb');
    await page.waitForTimeout(40);
    assert('relabel: E♭ shifts A minor I to A♭m', await page.evaluate(() =>
      document.querySelector('#qcPills .qc-col .qc-pill').textContent.trim() === 'A♭m'));
    assert('audio: played midis drop a semitone in E♭', await page.evaluate(() => {
      let got = null; const orig = playNotesStrum; playNotesStrum = (m) => { got = m; };
      const stdMidis = (() => { _tuning = 'standard'; const c = []; const v = fbGetVoicing('guitar', 'Am'); const t = _FB_TUNING.guitar; v.strings.forEach((s, i) => { if (s.fret != null) c.push(t[i] + s.fret); }); return c.sort((a,b)=>a-b); })();
      _tuning = 'eb'; playChordOnInstrument('Am', 'guitar'); playNotesStrum = orig;
      const eb = got.slice().sort((a, b) => a - b);
      return eb.length === stdMidis.length && eb.every((m, i) => m === stdMidis[i] - 1);
    }));
    assert('shapes: fret numbers identical between tunings', await page.evaluate(() => {
      _tuning = 'standard'; const a = fbGetVoicing('guitar', 'Am').strings.map(s => s.fret);
      _tuning = 'eb'; const b = fbGetVoicing('guitar', 'Am').strings.map(s => s.fret);
      return JSON.stringify(a) === JSON.stringify(b);
    }));
    assert('persist: tuning written to localStorage', await page.evaluate(() => {
      _setTuning('eb'); return localStorage.getItem('dh-lite-tuning') === 'eb';
    }));
  }
```

- [ ] **Step 9: Run verify** — `node _verify_lite_1055.js`; all PASS, FAIL 0. Fix until green.

- [ ] **Step 10: Screenshot** — `_shot_1055_qc_eb.png`: QC in E♭ with A minor, confirm dropdowns (left) + tuning (right) and A♭m diatonic.

- [ ] **Step 11: Promote + commit + push + poll + memory** — same pattern as P1 Steps 10–11, version 1.055, message `feat(lite-1.055): shared Standard/E♭ tuning (names + audio −1 semitone, shapes unchanged, per-song)`.

---

## Phase 3 — Find-a-Chord full scrollable neck → lite-1.056

**Files:** `lite-1.056.html` (from index), `_verify_lite_1056.js`, `index.html`.

- [ ] **Step 1: Snapshot** — `cp index.html lite-1.056.html && diff … && echo CLEAN`.

- [ ] **Step 2: Fret counts + placed-state semantics** — add near `let _fcPlaced = [];`:
```js
const FC_MAXFRET = { guitar: 22, ukulele: 15 };
const FC_INLAYS = { guitar: [3,5,7,9,12,15,17,19,21], ukulele: [5,7,10,12,15] };
```
Keep `_fcPlaced[r]` ∈ `null | 0 | 'x' | fret>0`. Remove uses of `_fcBase` (no windowing).

- [ ] **Step 3: Tap handlers** — replace `fcTapCell`:
```js
// Left nut cell: cycle none → open(0) → mute('x') → none.
function fcCycleNut(r) {
  const cur = _fcPlaced[r];
  _fcPlaced[r] = (cur === null || cur === undefined) ? 0 : (cur === 0 ? 'x' : (cur === 'x' ? null : 0));
  fcUpdate();
  if (_fcPlaced[r] === 0) fcHearString(r, 0);
}
// Fret cell: set/clear the fret (clears any open/mute), and play the note.
function fcTapFret(r, f) {
  _fcPlaced[r] = (_fcPlaced[r] === f) ? null : f;
  fcUpdate();
  if (_fcPlaced[r] === f) fcHearString(r, f);
}
function fcHearString(r, f) {
  const midi = _tunedTuning(_fcInstrument)[r] + f; // _tunedTuning from P2; if P3 lands first, use _FB_TUNING[...][r]+(typeof _tuneShift==='function'?_tuneShift():0)
  playNotesStrum([midi], _fcInstrument);
}
```

- [ ] **Step 4: `fcPlacedMidis` excludes mutes** — replace:
```js
function fcPlacedMidis() { const t = _tunedTuning(_fcInstrument); const out = []; _fcPlaced.forEach((f, i) => { if (typeof f === 'number') out.push(t[i] + f); }); return out; }
```
(`typeof f === 'number'` includes `0` open and frets, excludes `null` and `'x'`.)

- [ ] **Step 5: Rebuild `fcRenderNeck` as pinned-nut + scrollable frets** — replace the whole function:
```js
function fcRenderNeck() {
  const inst = _fcInstrument, tuning = _tunedTuning(inst), nStr = tuning.length;
  const MAX = FC_MAXFRET[inst], INLAYS = FC_INLAYS[inst];
  const ROWGAP = 26, TOP = 24, COLW = 46, OPENW = 34, LBLW = 22;
  const H = TOP + (nStr - 1) * ROWGAP + 34;
  const tsel = document.getElementById('fcTuning'); if (tsel) tsel.value = _tuning;
  // Left pinned panel: string labels + open/mute column.
  const leftW = LBLW + OPENW;
  let L = '<svg width="' + leftW + '" height="' + Math.min(H, 240) + '" viewBox="0 0 ' + leftW + ' ' + H + '" style="display:block;flex:none">';
  L += '<rect x="' + (leftW - 4) + '" y="' + (TOP - 7) + '" width="6" height="' + ((nStr - 1) * ROWGAP + 14) + '" fill="#cfcfdf"/>'; // nut
  for (let r = 0; r < nStr; r++) { const y = TOP + r * ROWGAP;
    L += '<line x1="' + LBLW + '" y1="' + y + '" x2="' + leftW + '" y2="' + y + '" stroke="#8a8a9a" stroke-width="1.3"/>';
    L += '<text x="' + (LBLW / 2) + '" y="' + (y + 4) + '" fill="#9a9aae" font-size="10" font-weight="700" text-anchor="middle">' + SEQ_NOTES[(((tuning[r]) % 12) + 12) % 12] + '</text>';
    const f = _fcPlaced[r];
    if (f === 0) L += '<circle cx="' + (LBLW + OPENW / 2) + '" cy="' + y + '" r="8" fill="none" stroke="#7aa2ff" stroke-width="2.5"/>';
    else if (f === 'x') L += '<text x="' + (LBLW + OPENW / 2) + '" y="' + (y + 4) + '" fill="#e0556e" font-size="13" text-anchor="middle">✕</text>';
    L += '<rect x="' + LBLW + '" y="' + (y - ROWGAP / 2) + '" width="' + OPENW + '" height="' + ROWGAP + '" fill="transparent" style="cursor:pointer" onclick="fcCycleNut(' + r + ')"/>';
  }
  L += '</svg>';
  // Scrollable fret panel: frets 1..MAX.
  const W = MAX * COLW + 10;
  let R = '<svg width="' + W + '" height="' + Math.min(H, 240) + '" viewBox="0 0 ' + W + ' ' + H + '" style="display:block">';
  R += '<rect x="0" y="' + (TOP - 7) + '" width="' + (MAX * COLW) + '" height="' + ((nStr - 1) * ROWGAP + 14) + '" fill="#241a12" rx="3"/>';
  for (let c = 1; c <= MAX; c++) { const fx = c * COLW; R += '<line x1="' + fx + '" y1="' + (TOP - 7) + '" x2="' + fx + '" y2="' + (TOP + (nStr - 1) * ROWGAP + 7) + '" stroke="#5a4a38" stroke-width="2"/>'; }
  INLAYS.forEach(fr => { if (fr <= MAX) { const cx = (fr - 0.5) * COLW, cy = TOP + ((nStr - 1) * ROWGAP) / 2; if (fr === 12) { R += '<circle cx="' + cx + '" cy="' + (TOP + ROWGAP * 0.6) + '" r="5" fill="#3a2c1c"/><circle cx="' + cx + '" cy="' + (TOP + (nStr - 1) * ROWGAP - ROWGAP * 0.6) + '" r="5" fill="#3a2c1c"/>'; } else R += '<circle cx="' + cx + '" cy="' + cy + '" r="5" fill="#3a2c1c"/>'; } });
  for (let r = 0; r < nStr; r++) { const y = TOP + r * ROWGAP; R += '<line x1="0" y1="' + y + '" x2="' + (MAX * COLW) + '" y2="' + y + '" stroke="#8a8a9a" stroke-width="1.3"/>'; }
  for (let c = 1; c <= MAX; c++) { R += '<text x="' + ((c - 0.5) * COLW) + '" y="' + (TOP + (nStr - 1) * ROWGAP + 22) + '" fill="#6a6a7a" font-size="10" text-anchor="middle">' + c + '</text>'; }
  _fcPlaced.forEach((f, r) => { if (typeof f === 'number' && f > 0) { const y = TOP + r * ROWGAP, cx = (f - 0.5) * COLW; R += '<circle cx="' + cx + '" cy="' + y + '" r="10" fill="#e0b450"/>'; } });
  for (let r = 0; r < nStr; r++) { const y = TOP + r * ROWGAP; for (let c = 1; c <= MAX; c++) { R += '<rect x="' + ((c - 1) * COLW) + '" y="' + (y - ROWGAP / 2) + '" width="' + COLW + '" height="' + ROWGAP + '" fill="transparent" style="cursor:pointer" onclick="fcTapFret(' + r + ',' + c + ')"/>'; } }
  R += '</svg>';
  document.getElementById('fcNeck').innerHTML =
    '<div style="display:flex;align-items:flex-start">' + L +
    '<div style="overflow-x:auto;flex:1">' + R + '</div></div>';
}
```

- [ ] **Step 6: Update `fcSelectFromDropdown` + `fcClear`** — remove `_fcBase` references. In `fcSelectFromDropdown`, after building `_fcPlaced`, drop the `_fcBase` line; keep `fcUpdate(); fcPlay();`. In `fcClear`, remove `_fcBase = 0;`. In `fcSetInstrument`, remove `_fcBase = 0;`.

- [ ] **Step 7: Validate file (NUL/utf-8/parse)** on `lite-1.056.html`.

- [ ] **Step 8: Write verify** — `_verify_lite_1056.js` (derive from 1055). Add:
```js
  // ── Phase 3: FC scrollable neck, open/mute cycle, tap-to-hear ──
  {
    const page = await (await mobileCtx()).newPage();
    page.on('pageerror', e => errors.push('PAGEERROR(p3): ' + e.message));
    await page.goto(base, { waitUntil: 'load' });
    await page.click('.landing-tools .ltool-btn:nth-child(2)'); // Find a Chord (no-account)
    await page.waitForTimeout(120);
    assert('fcneck: frets render up to 22 for guitar in a scroll container', await page.evaluate(() => {
      const t = document.getElementById('fcNeck').textContent;
      const scroll = document.querySelector('#fcNeck div[style*="overflow-x"]');
      return !!scroll && /\b22\b/.test(t);
    }));
    assert('mute: nut cell cycles none→open(0)→mute(x)→none', await page.evaluate(() => {
      fcInitPlaced();
      fcCycleNut(0); const a = _fcPlaced[0];
      fcCycleNut(0); const b = _fcPlaced[0];
      fcCycleNut(0); const c = _fcPlaced[0];
      return a === 0 && b === 'x' && c === null;
    }));
    assert('mute: muted strings excluded from fcPlacedMidis', await page.evaluate(() => {
      fcInitPlaced(); _fcPlaced[0] = 'x'; _fcPlaced[1] = 0; _fcPlaced[2] = 3;
      const ms = fcPlacedMidis();
      return ms.length === 2; // open(0) + fret(3) count, mute excluded
    }));
    assert('hear: tapping a fret plays a single note', await page.evaluate(() => {
      let n = null; const orig = playNotesStrum; playNotesStrum = (m) => { n = m; };
      fcInitPlaced(); fcTapFret(0, 5);
      playNotesStrum = orig; return Array.isArray(n) && n.length === 1;
    }));
    assert('uke: neck renders up to 15 frets', await page.evaluate(() => {
      fcSetInstrument('ukulele'); const t = document.getElementById('fcNeck').textContent;
      fcSetInstrument('guitar'); return /\b15\b/.test(t);
    }));
  }
```

- [ ] **Step 9: Run verify** — `node _verify_lite_1056.js`; all PASS, FAIL 0.

- [ ] **Step 10: Screenshot** — `_shot_1056_fc.png` (guitar neck scrolled, a mute ✕ + open ○ + a fretted dot up the neck) and `_shot_1056_fc_uke.png`. Visually confirm pinned nut + scroll.

- [ ] **Step 11: Promote + commit + push + poll + memory** — version 1.056, message `feat(lite-1.056): Find-a-Chord full scrollable neck (guitar 22 / uke 15), open/mute toggle, tap-to-hear`.

---

## Self-Review notes
- **Spec coverage:** 1a Step2 · 1b Step3 · 1c Step4 · 1d Step5 · 2a Step3-4 · 2b Step2,5,6 · 2c Step2,5,6 · 3a Step5 · 3b Step3-5 · 3c Step3 · 3d Step5. All covered.
- **Cross-phase dependency:** `_tuneShift`/`_tunedTuning` are defined in P2 and used in P3 (`fcHearString`, `fcPlacedMidis`, `fcRenderNeck`). Since P2 ships before P3, they exist. If phases are reordered, define `_tuneShift`/`_tunedTuning` in P3 instead (Step 3 note flags this).
- **P1 1c string labels are standard-tuning until P2** — acceptable; P2 Step 6 switches FC labels to `_tunedTuning`, and the QC label loop should be updated in P2 to use the tuned tuning too (add to P2 Step 5: change the `_t[r]` source in `_fbNeckSVG` to add `_tuneShift()`).
