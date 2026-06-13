# Drafthaus Lite — Chords mode (tap a word) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `lite-1.034` tap-🎵-type-at-cursor chord entry with a Chords mode where the user taps a word and a floating field places/edits/removes a chord above that word.

**Architecture:** Single-file HTML app, file-copy versioned on `main` (no branches). Snapshot `lite-1.034.html` → `lite-1.035.html`. A `_chordsMode` toggle makes `#lyricsEditor` non-editable; in that mode a tap resolves the word under the pointer via `caretRangeFromPoint`, opens a floating `#chordEntry` input above the word, and on Enter inserts/edits/removes an inline `<span class="chord">` (unchanged storage, full-app compatible; existing CSS floats it above the word). The play-this-chord popover, float-above CSS, sanitizer, and `_atomizeLyricChords()` are unchanged.

**Tech Stack:** Vanilla JS, contenteditable, `document.caretRangeFromPoint`, Firebase. No test runner — verification is a headless `playwright-core` script driving installed Chrome over real HTTP (`_verify_lite_1035.js`).

**Reference:** spec `docs/superpowers/specs/2026-06-13-drafthaus-lite-chords-mode-tap-word-design.md`. Memory `drafthaus-lite.md`. All work on `main`; **do not push until the user confirms** (push deploys `drafthaus.ca`). Re-locate code by quoted string, not line number.

---

## File Structure

- **Create:** `lite-1.035.html` — copy of `lite-1.034.html` with the entry interaction rewritten.
- **Create:** `_verify_lite_1035.js` — headless verification, mirrors `_verify_lite_1034.js` harness.
- **Unchanged:** `index.html`, samples, other builds.

---

## Task 1: Snapshot the build + verify harness skeleton

**Files:**
- Create: `lite-1.035.html` (copy of `lite-1.034.html`)
- Create: `_verify_lite_1035.js`

- [ ] **Step 1: Copy the build and confirm it's byte-identical**

```bash
cd /Users/jasoncraig/Documents/Claude/Projects/Drafthaus
cp lite-1.034.html lite-1.035.html
diff -q lite-1.034.html lite-1.035.html && echo "IDENTICAL COPY OK"
```

Expected: `IDENTICAL COPY OK`.

- [ ] **Step 2: Create the verify harness skeleton**

Create `_verify_lite_1035.js`:

```js
// lite-1.035: Chords mode — tap a word to add/edit/remove a chord above it.
const { chromium } = require('playwright-core');
const path = require('path'); const http = require('http'); const fs = require('fs');
const BUILD = 'lite-1.035.html';
function startServer() {
  return new Promise(resolve => {
    const srv = http.createServer((req, res) => {
      const file = path.join(__dirname, decodeURIComponent(req.url.split('?')[0]));
      fs.readFile(file, (err, buf) => { if (err) { res.writeHead(404); res.end('nf'); return; }
        const ct = file.endsWith('.html') ? 'text/html' : file.endsWith('.mp3') ? 'audio/mpeg' : 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': ct }); res.end(buf); });
    });
    srv.listen(0, '127.0.0.1', () => resolve({ srv, port: srv.address().port }));
  });
}
async function openGuestSong(page, lyricsDoc) {
  await page.click('.auth-btn.ghost');
  await page.waitForSelector('body.signed-in', { timeout: 15000 });
  await page.evaluate((doc) => {
    _openSongObj({ id: 'S', title: 'X', key: 'C major', lyricsDoc: doc });
    stopTakesListener();
  }, lyricsDoc || '<div>I walked the line</div>');
  await page.waitForTimeout(60);
}
// Return the viewport-center point of a substring inside the first editor line's last text node.
async function wordCenter(page, word) {
  return await page.evaluate((w) => {
    const line = document.querySelector('#lyricsEditor div');
    // find the text node containing the word
    let node = null, idx = -1;
    for (const n of line.childNodes) { if (n.nodeType === 3 && (idx = n.data.indexOf(w)) >= 0) { node = n; break; } }
    if (!node) return null;
    const r = document.createRange(); r.setStart(node, idx); r.setEnd(node, idx + w.length);
    const rect = r.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }, word);
}
(async () => {
  const { srv, port } = await startServer();
  const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
  const results = []; const assert = (n, c) => results.push((c ? 'PASS' : 'FAIL') + ' — ' + n);
  const errors = [];
  const base = `http://127.0.0.1:${port}/${BUILD}`;

  // (task assertions get appended here in later tasks)

  const fatal = errors.filter(e => !/permission|insufficient|FirebaseError|Failed to load resource|net::ERR|storage\//i.test(e));
  assert('no fatal JS errors', fatal.length === 0);
  console.log(results.join('\n'));
  await browser.close(); srv.close();
  if (results.some(r => r.startsWith('FAIL'))) process.exit(1);
})();
```

- [ ] **Step 3: Run the skeleton**

```bash
cd /Users/jasoncraig/Documents/Claude/Projects/Drafthaus
node _verify_lite_1035.js
```

Expected: `PASS — no fatal JS errors` (exit 0).

- [ ] **Step 4: Commit**

```bash
git add lite-1.035.html _verify_lite_1035.js
git commit -m "chore(lite-1.035): snapshot lite-1.034 + verify harness skeleton"
```

---

## Task 2: Chords mode entry — toggle, tap-a-word, floating field (the whole rewrite)

This task replaces the entire `lite-1.034` caret-based entry module with the Chords-mode tap-a-word
module, updates the toolbar/CSS, removes the popover's ✎ edit, and resets mode on song open/close.

**Files:**
- Modify: `lite-1.035.html`
- Modify: `_verify_lite_1035.js`

- [ ] **Step 1: Write the failing assertions**

In `_verify_lite_1035.js`, replace the line `  // (task assertions get appended here in later tasks)` with:

```js
  // ── Chords mode toggle ──
  {
    const page = await (await browser.newContext({ viewport: { width: 390, height: 800 }, hasTouch: true, isMobile: true })).newPage();
    page.on('pageerror', e => errors.push('PAGEERROR(toggle): ' + e.message));
    await page.goto(base, { waitUntil: 'load' });
    await openGuestSong(page, '<div>I walked the line</div>');
    assert('toggle: editor starts editable, not in chords-mode', await page.evaluate(() => {
      const ed = document.getElementById('lyricsEditor');
      return ed.getAttribute('contenteditable') === 'true' && !ed.classList.contains('chords-mode');
    }));
    await page.evaluate(() => toggleChordsMode());
    assert('toggle: chords mode makes editor non-editable + adds class + button active', await page.evaluate(() => {
      const ed = document.getElementById('lyricsEditor');
      return ed.getAttribute('contenteditable') === 'false' && ed.classList.contains('chords-mode')
        && document.getElementById('chordsModeBtn').classList.contains('active');
    }));
    await page.evaluate(() => toggleChordsMode());
    assert('toggle: toggling off restores editable + removes class', await page.evaluate(() => {
      const ed = document.getElementById('lyricsEditor');
      return ed.getAttribute('contenteditable') === 'true' && !ed.classList.contains('chords-mode');
    }));
  }

  // ── Tap a word: add / pre-fill / remove a chord ──
  {
    const page = await (await browser.newContext({ viewport: { width: 390, height: 800 }, hasTouch: true, isMobile: true })).newPage();
    page.on('pageerror', e => errors.push('PAGEERROR(tap): ' + e.message));
    await page.goto(base, { waitUntil: 'load' });
    await openGuestSong(page, '<div>I walked the line</div>');
    await page.evaluate(() => toggleChordsMode());

    // Tap the word "walked" → field opens → type G → Enter places chord before "walked".
    const c1 = await wordCenter(page, 'walked');
    await page.mouse.click(c1.x, c1.y);
    assert('tap: chord field is shown after tapping a word', await page.evaluate(() =>
      getComputedStyle(document.getElementById('chordEntry')).display !== 'none'));
    await page.evaluate(() => { document.getElementById('chordEntry').value = 'G'; commitChordEntry(); });
    assert('tap: a chord span "G" now sits immediately before "walked"', await page.evaluate(() => {
      const spans = [...document.querySelectorAll('#lyricsEditor .chord')];
      if (spans.length !== 1 || spans[0].textContent !== 'G') return false;
      const next = spans[0].nextSibling;
      return next && next.nodeType === 3 && next.data.indexOf('walked') === 0;
    }));
    assert('tap: the chord renders ABOVE the baseline (zero advance width)', await page.evaluate(() =>
      document.querySelector('#lyricsEditor .chord').offsetWidth === 0));

    // Tap "walked" again → field pre-fills with the existing chord "G".
    const c2 = await wordCenter(page, 'walked');
    await page.mouse.click(c2.x, c2.y);
    assert('tap: tapping a word with a chord pre-fills the field', await page.evaluate(() =>
      document.getElementById('chordEntry').value === 'G'));

    // Empty-submit removes the chord.
    await page.evaluate(() => { document.getElementById('chordEntry').value = ''; commitChordEntry(); });
    assert('tap: empty submit removes the chord', await page.evaluate(() =>
      document.querySelectorAll('#lyricsEditor .chord').length === 0));
  }

  // ── Compatibility: stored form stays <span class="chord"> with no contenteditable ──
  {
    const page = await (await browser.newContext({ viewport: { width: 390, height: 800 }, hasTouch: true, isMobile: true })).newPage();
    page.on('pageerror', e => errors.push('PAGEERROR(compat): ' + e.message));
    await page.goto(base, { waitUntil: 'load' });
    await openGuestSong(page, '<div>I walked the line</div>');
    await page.evaluate(() => toggleChordsMode());
    const c = await wordCenter(page, 'line');
    await page.mouse.click(c.x, c.y);
    await page.evaluate(() => { document.getElementById('chordEntry').value = 'Cmaj7'; commitChordEntry(); });
    assert('compat: saved lyricsDoc keeps <span class="chord"> and strips contenteditable', await page.evaluate(() => {
      const out = ilSanitizeDocHtml(document.getElementById('lyricsEditor').innerHTML);
      return /<span class="chord">Cmaj7<\/span>/.test(out) && !/contenteditable/i.test(out);
    }));
  }

  // ── Old caret-entry API is gone ──
  {
    const page = await (await browser.newContext({ viewport: { width: 390, height: 800 }, hasTouch: true, isMobile: true })).newPage();
    await page.goto(base, { waitUntil: 'load' });
    assert('cleanup: old startChordEntry/_lyricCaretRange/cpEditChord are removed', await page.evaluate(() =>
      typeof window.startChordEntry === 'undefined' && typeof window._lyricCaretRange === 'undefined' && typeof window.cpEditChord === 'undefined'));
  }
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd /Users/jasoncraig/Documents/Claude/Projects/Drafthaus
node _verify_lite_1035.js
```

Expected: FAIL — `toggleChordsMode is not defined` pageerror (the new API doesn't exist yet).

- [ ] **Step 3: Update the toolbar markup**

In `lite-1.035.html`, find:

```html
    <div class="lyr-toolbar">
      <button class="lyr-btn" onmousedown="event.preventDefault()" onclick="startChordEntry()" title="Add a chord above your lyrics">🎵 Chord</button>
      <button class="lyr-btn" onmousedown="event.preventDefault()" onclick="applyBold()" title="Bold"><b>B</b></button>
      <input id="chordEntry" class="chord-entry" type="text" placeholder="Chord (e.g. G, Cmaj7) — Enter"
             autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false"
             style="display:none" onkeydown="chordEntryKey(event)" onblur="cancelChordEntry()">
      <span class="lyr-hint">Tap 🎵, type a chord, press Enter — it floats above your lyrics</span>
    </div>
```

Replace with:

```html
    <div class="lyr-toolbar">
      <button class="lyr-btn" id="chordsModeBtn" onmousedown="event.preventDefault()" onclick="toggleChordsMode()" title="Add chords by tapping words">🎵 Chords</button>
      <button class="lyr-btn" onmousedown="event.preventDefault()" onclick="applyBold()" title="Bold"><b>B</b></button>
      <input id="chordEntry" class="chord-entry" type="text" placeholder="Chord — Enter"
             autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false"
             style="display:none" onkeydown="chordEntryKey(event)" onblur="cancelChordEntry()">
      <span class="lyr-hint" id="lyrHint">Tap 🎵 Chords, then tap a word to place a chord above it</span>
    </div>
```

- [ ] **Step 4: Update the chord-entry CSS to float + add toggle/mode styling**

In `lite-1.035.html`, find:

```css
.chord-entry { font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 15px; font-weight: 700; color: var(--tint); background: var(--bg-input); border: 1px solid var(--tint); border-radius: 8px; padding: 5px 9px; width: 150px; outline: none; }
```

Replace with:

```css
.chord-entry { position: fixed; z-index: 1300; font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 15px; font-weight: 700; color: var(--tint); background: var(--bg-elev); border: 1px solid var(--tint); border-radius: 8px; padding: 5px 9px; width: 140px; outline: none; box-shadow: 0 4px 14px rgba(0,0,0,.18); }
.lyr-btn.active { background: var(--tint); color: #fff; border-color: var(--tint); }
#lyricsEditor.chords-mode { cursor: pointer; }
#lyricsEditor.chords-mode .chord { cursor: pointer; }
```

- [ ] **Step 5: Remove the popover's ✎ edit button (keep 🗑 remove)**

In `lite-1.035.html`, find:

```html
      <div class="cp-edit-actions">
        <button class="cp-edit-btn" onclick="cpEditChord()" title="Edit chord">✎</button>
        <button class="cp-edit-btn" onclick="cpRemoveChord()" title="Remove chord">🗑</button>
      </div>
```

Replace with:

```html
      <div class="cp-edit-actions">
        <button class="cp-edit-btn" onclick="cpRemoveChord()" title="Remove chord">🗑</button>
      </div>
```

- [ ] **Step 6: Replace the entire caret-based entry module with the Chords-mode module**

In `lite-1.035.html`, find the block that begins with:

```js
let _savedLyricRange = null, _cpEl = null;
document.addEventListener('selectionchange', () => {
```

…and continues through the end of `commitChordEntry`, i.e. ending with:

```js
  _savedLyricRange = after.cloneRange();
  onLyricsInput();
}
```

Replace that ENTIRE span (from `let _savedLyricRange = null, _cpEl = null;` through the closing brace of `commitChordEntry`) with:

```js
/* ── Chords mode: tap a word to add / edit / remove a chord above it ── */
let _cpEl = null;            // chord span currently open in the play-popover
let _chordsMode = false;     // whether tapping a word adds a chord
let _chordTarget = null;     // { node, wordStart, wordEnd, span } for the word being chorded

function toggleChordsMode(on) {
  _chordsMode = (on === undefined) ? !_chordsMode : !!on;
  const ed = document.getElementById('lyricsEditor');
  const btn = document.getElementById('chordsModeBtn');
  const hint = document.getElementById('lyrHint');
  cancelChordEntry();
  if (_chordsMode) {
    ed.setAttribute('contenteditable', 'false');
    ed.classList.add('chords-mode');
    if (btn) { btn.classList.add('active'); btn.textContent = '✓ Done'; }
    if (hint) hint.textContent = 'Tap a word to add a chord (empty = remove)';
  } else {
    ed.setAttribute('contenteditable', 'true');
    ed.classList.remove('chords-mode');
    if (btn) { btn.classList.remove('active'); btn.textContent = '🎵 Chords'; }
    if (hint) hint.textContent = 'Tap 🎵 Chords, then tap a word to place a chord above it';
  }
}

// Resolve the word under a viewport point inside #lyricsEditor.
// Returns { node, wordStart, wordEnd, span, anchorRect } or null.
function _wordAtPoint(x, y) {
  let node = null, offset = 0;
  if (document.caretRangeFromPoint) {
    const r = document.caretRangeFromPoint(x, y); if (!r) return null;
    node = r.startContainer; offset = r.startOffset;
  } else if (document.caretPositionFromPoint) {
    const p = document.caretPositionFromPoint(x, y); if (!p) return null;
    node = p.offsetNode; offset = p.offset;
  } else return null;
  // If the point resolved onto a chord label, edit that chord directly.
  if (node.nodeType === 1 && node.classList && node.classList.contains('chord')) {
    return { node, wordStart: 0, wordEnd: 0, span: node, anchorRect: node.getBoundingClientRect() };
  }
  if (node.nodeType !== 3) {
    const t = node.childNodes[offset] || node.lastChild;
    if (t && t.nodeType === 1 && t.classList && t.classList.contains('chord'))
      return { node: t, wordStart: 0, wordEnd: 0, span: t, anchorRect: t.getBoundingClientRect() };
    if (t && t.nodeType === 3) { node = t; offset = 0; } else return null;
  }
  if (node.parentNode && node.parentNode.classList && node.parentNode.classList.contains('chord')) {
    const span = node.parentNode;
    return { node: span, wordStart: 0, wordEnd: 0, span, anchorRect: span.getBoundingClientRect() };
  }
  const text = node.data || '';
  const isWord = c => c != null && /\S/.test(c);
  let s = offset, e = offset;
  if (!isWord(text[s]) && s > 0 && isWord(text[s - 1])) { s = e = s - 1; }
  while (s > 0 && isWord(text[s - 1])) s--;
  while (e < text.length && isWord(text[e])) e++;
  if (s === e) return null;
  const span = (s === 0 && node.previousSibling && node.previousSibling.classList
    && node.previousSibling.classList.contains('chord')) ? node.previousSibling : null;
  const rng = document.createRange(); rng.setStart(node, s); rng.setEnd(node, e);
  return { node, wordStart: s, wordEnd: e, span, anchorRect: rng.getBoundingClientRect() };
}

function _editorTap(ev) {
  if (!_chordsMode) return;
  const w = _wordAtPoint(ev.clientX, ev.clientY);
  if (!w) { cancelChordEntry(); return; }
  if (ev.preventDefault) ev.preventDefault();
  _chordTarget = w;
  const inp = document.getElementById('chordEntry');
  inp.value = w.span ? w.span.textContent : '';
  inp.style.display = '';
  const r = w.anchorRect;
  const wd = 140, h = 34;
  let left = Math.min(Math.max(8, r.left - 6), innerWidth - wd - 8);
  let top = r.top - h - 6; if (top < 8) top = r.bottom + 6;
  inp.style.left = left + 'px'; inp.style.top = top + 'px';
  inp.focus(); inp.select();
}

function cancelChordEntry() {
  const inp = document.getElementById('chordEntry');
  if (inp) { inp.value = ''; inp.style.display = 'none'; }
  _chordTarget = null;
}

function chordEntryKey(ev) {
  if (ev.key === 'Enter') { ev.preventDefault(); commitChordEntry(); }
  else if (ev.key === 'Escape') { ev.preventDefault(); cancelChordEntry(); }
}

function commitChordEntry() {
  const inp = document.getElementById('chordEntry');
  const name = inp.value.trim();
  const t = _chordTarget;
  inp.value = ''; inp.style.display = 'none'; _chordTarget = null;
  if (!t) return;
  if (t.span) {
    if (name) t.span.textContent = name;
    else { const p = t.span.parentNode; t.span.remove(); if (p) p.normalize(); }
  } else if (name) {
    let wordNode = t.node;
    if (t.wordStart > 0) wordNode = t.node.splitText(t.wordStart);
    const span = document.createElement('span'); span.className = 'chord'; span.textContent = name; span.contentEditable = 'false';
    wordNode.parentNode.insertBefore(span, wordNode);
  }
  _atomizeLyricChords();
  onLyricsInput();
}
```

NOTE: `_atomizeLyricChords` (defined just below this block) and `onLyricsInput` are unchanged and still referenced. `_cpEl` is still declared here (used by `openChordPop`/`cpRemoveChord`).

- [ ] **Step 7: Delete the now-orphaned `cpEditChord` function**

In `lite-1.035.html`, find and DELETE this entire function (it referenced the removed `_savedLyricRange`):

```js
function cpEditChord() {
  if (!_cpEl) { closeChordPop(); return; }
  const name = _cpEl.textContent;
  // Capture the chord's position BEFORE removing it; assign _savedLyricRange LAST (after all
  // focus changes settle) so a deferred selectionchange can't clobber it.
  const r = document.createRange(); r.setStartBefore(_cpEl); r.collapse(true);
  const savedPos = r.cloneRange();
  _cpEl.remove(); _cpEl = null; onLyricsInput(); closeChordPop();
  const inp = document.getElementById('chordEntry'); inp.style.display = ''; inp.value = name; inp.focus(); inp.select();
  _savedLyricRange = savedPos;
}
```

- [ ] **Step 8: Route editor clicks through `_editorTap` when in chords mode**

In `lite-1.035.html`, find (inside `_bindChordLyrics`):

```js
  ed.addEventListener('click', e => { const c = e.target.closest('.chord'); if (c) { e.stopPropagation(); openChordPop(c.textContent, c, true); } });
```

Replace with:

```js
  ed.addEventListener('click', e => {
    if (_chordsMode) { _editorTap(e); return; }
    const c = e.target.closest('.chord'); if (c) { e.stopPropagation(); openChordPop(c.textContent, c, true); }
  });
```

- [ ] **Step 9: Reset chords mode off when opening or leaving a song**

In `lite-1.035.html`, find (inside `_openSongObj`):

```js
  document.getElementById('lyricsEditor').innerHTML = ilSanitizeDocHtml(ilGetDocHtml(s));
  _atomizeLyricChords();
```

Replace with:

```js
  document.getElementById('lyricsEditor').innerHTML = ilSanitizeDocHtml(ilGetDocHtml(s));
  _atomizeLyricChords();
  toggleChordsMode(false);
```

Then find (the `goHome` function):

```js
function goHome() {
  flushLyrics(); stopPlayback(); stopTakesListener();
  _currentSong = null; _wfReset(); wfRender();
  showScreen('songlist');
}
```

Replace with:

```js
function goHome() {
  toggleChordsMode(false);
  flushLyrics(); stopPlayback(); stopTakesListener();
  _currentSong = null; _wfReset(); wfRender();
  showScreen('songlist');
}
```

- [ ] **Step 10: Run to verify everything passes**

```bash
node _verify_lite_1035.js
```

Expected: every `toggle:`, `tap:`, `compat:`, and `cleanup:` assertion PASS, plus `no fatal JS errors`.

If `tap:` geometry asserts are flaky (the `wordCenter`/`mouse.click` path depends on layout), re-run once; if still failing, STOP and report — do not weaken the assertions.

- [ ] **Step 11: Commit**

```bash
git add lite-1.035.html _verify_lite_1035.js
git commit -m "feat(lite-1.035): Chords mode — tap a word to add/edit/remove a chord above it"
```

---

## Task 3: Dead-code sweep, full verify, memory, stop before push

**Files:**
- Modify: `lite-1.035.html` (only if orphans found)
- Modify: memory `drafthaus-lite.md` + `MEMORY.md`

- [ ] **Step 1: Confirm all removed symbols are gone (no orphans)**

```bash
cd /Users/jasoncraig/Documents/Claude/Projects/Drafthaus
for sym in startChordEntry _savedLyricRange _lyricCaretRange cpEditChord selectionchange; do
  echo -n "$sym: "; grep -c "$sym" lite-1.035.html;
done
```

Expected: every count is `0`. If any is non-zero, locate it (`grep -n "$sym" lite-1.035.html`) and remove the orphan reference, then re-run.

- [ ] **Step 2: Confirm the kept symbols are present exactly where expected**

```bash
grep -n "function toggleChordsMode\|function _wordAtPoint\|function _editorTap\|function commitChordEntry\|function _atomizeLyricChords\|function cpRemoveChord" lite-1.035.html
```

Expected: one hit each (six lines). `cpRemoveChord` still present; `cpEditChord` absent.

- [ ] **Step 3: Run the full verify suite**

```bash
node _verify_lite_1035.js; echo "exit=$?"
```

Expected: every line `PASS`, `exit=0`.

- [ ] **Step 4: Sanity-check the change scope vs the base**

```bash
diff <(git show HEAD~2:lite-1.034.html 2>/dev/null || cat lite-1.034.html) lite-1.035.html | grep -c '^[<>]'
```

Expected: a modest number of changed lines confined to the toolbar, chord-entry CSS, the entry JS module, the popover ✎ removal, and `_openSongObj`/`goHome` — nothing unrelated.

- [ ] **Step 5: Update memory**

Edit `/Users/jasoncraig/.claude/projects/-Users-jasoncraig-Documents-Claude-Projects-Drafthaus/memory/drafthaus-lite.md`: add a `lite-1.035` bullet under Progress — chord entry reworked from tap-🎵-at-cursor to a **Chords mode** toggle (`toggleChordsMode`): editor goes non-editable, tapping a word (`_wordAtPoint` via `caretRangeFromPoint`) opens a floating `#chordEntry` above the word; Enter adds/edits, empty Enter removes; storage/render unchanged (inline `<span class="chord">`, float-above CSS, atomic spans). Removed the old caret plumbing (`_savedLyricRange`, `selectionchange`, `_lyricCaretRange`, `cpEditChord`) and the popover ✎ edit (kept 🗑 remove + the play-this-chord popover). Mode resets off on song open/close. N/N headless. ⚠️ on-device sign-off needed: `caretRangeFromPoint` word-hit accuracy + floating field vs the iOS keyboard. Update the "Latest = lite-1.034" line to lite-1.035 and the Open-requests line. Also update the `MEMORY.md` one-line pointer to say "thru lite-1.035 (Chords-mode tap-a-word entry)".

- [ ] **Step 6: Stop — do NOT push**

Report to the user: Chords mode implemented and headless-verified in `lite-1.035.html`, committed to `main`, **not pushed**. Pushing deploys `drafthaus.ca`, so wait for explicit confirmation. Ask them to sanity-check on iPhone (tap 🎵 Chords → tap a word → type a chord → it lands above; tap it again to edit; empty to remove). When they confirm: `git push`, poll the deploy, done.

---

## Self-Review

**Spec coverage:**
- Chords mode toggle (editor non-editable, class, button/hint state) → Task 2 Steps 3,4,6 + `toggle:` asserts ✓
- Tap a word → floating field above the word → Task 2 Step 6 (`_editorTap`/`_wordAtPoint`) + `tap:` asserts ✓
- Add / edit / remove on one gesture (pre-fill + empty-removes) → Task 2 Step 6 (`commitChordEntry`) + `tap:` asserts ✓
- Word resolution incl. existing-chord detection + chord-label tap → Task 2 Step 6 (`_wordAtPoint`) ✓
- Removed old caret plumbing + popover ✎ → Task 2 Steps 5,6,7 + `cleanup:` assert + Task 3 Step 1 ✓
- Storage/render/play-popover/atomize unchanged → kept; `compat:` assert ✓
- Mode resets on open/close → Task 2 Step 9 ✓
- Testing over real HTTP → Tasks 1–3 ✓
- File-copy + no-push gate + memory → Tasks 1, 3 ✓

**Placeholder scan:** No TBD/TODO; all code + commands concrete. ✓

**Type/name consistency:** `toggleChordsMode`, `_chordsMode`, `_chordTarget`, `_wordAtPoint` (returns `{node,wordStart,wordEnd,span,anchorRect}`), `_editorTap`, `cancelChordEntry`, `chordEntryKey`, `commitChordEntry`, `_atomizeLyricChords`, `cpRemoveChord`, `#chordsModeBtn`, `#chordEntry`, `#lyrHint`, `.chords-mode`, `.lyr-btn.active` used consistently across markup, CSS, JS, tests. `_cpEl` declared once (in the Step 6 block). ✓

**Risks flagged for execution:** (1) the `tap:` asserts depend on `caretRangeFromPoint` resolving headless layout — Step 10 says re-run once, else stop (don't weaken asserts). (2) `splitText` on the tapped word node is the insert mechanism; the `tap:` "before walked" assert guards it. (3) On-device `caretRangeFromPoint` accuracy + keyboard overlap is the genuine unknown — explicitly deferred to user sign-off.
