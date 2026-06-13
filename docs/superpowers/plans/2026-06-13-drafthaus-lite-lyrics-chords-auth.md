# Drafthaus Lite — chords-above-lyrics + auth gating — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the three lyric-chord bugs and the Safari/DuckDuckGo "no login" bug in Drafthaus Lite by moving chords to a float-above-lyrics render + tap-to-insert entry, and gating auto-login so only real accounts skip the landing.

**Architecture:** Single-file HTML app, versioned by file-copy. Snapshot `lite-1.033.html` → `lite-1.034.html` and make all edits there. Chords stay stored as inline `<span class="chord">` in the shared `lyricsDoc` (full-app compatible); Lite changes only how they render (CSS lifts them above the line) and how they're created (discrete span at caret, caret parked outside it). Auth gating reads `user.isAnonymous` + a per-session "guest chosen" flag.

**Tech Stack:** Vanilla JS, contenteditable, Web Audio, Firebase Auth/Firestore. No test runner — verification is a headless `playwright-core` script driving the installed Chrome over real HTTP (`_verify_lite_1034.js`).

**Reference:** spec at `docs/superpowers/specs/2026-06-13-drafthaus-lite-lyrics-chords-auth-design.md`. Memory: `drafthaus-lite.md`. All work on `main`; **do not push until the user confirms** (push deploys `drafthaus.ca`).

---

## File Structure

- **Create:** `lite-1.034.html` — copy of `lite-1.033.html` with all changes. The only app file touched.
- **Create:** `_verify_lite_1034.js` — headless verification, mirrors `_verify_lite_033.js` harness.
- **Modify:** none of `index.html` (full app) — file isolation per memory.
- **Edit at end:** memory `~/.claude/projects/-Users-jasoncraig-Documents-Claude-Projects-Drafthaus/memory/drafthaus-lite.md` + `MEMORY.md` pointer; `CLAUDE.md` index build pointer (the "deployed build is…" line) only after promote — out of scope here.

All code line numbers below refer to `lite-1.033.html` as the copy source; **re-locate by quoted string, not line number** (they drift once you start editing).

---

## Task 1: Snapshot the build + stand up the verify harness

**Files:**
- Create: `lite-1.034.html` (copy of `lite-1.033.html`)
- Create: `_verify_lite_1034.js`

- [ ] **Step 1: Copy the build and confirm it's byte-identical**

```bash
cd /Users/jasoncraig/Documents/Claude/Projects/Drafthaus
cp lite-1.033.html lite-1.034.html
diff -q lite-1.033.html lite-1.034.html && echo "IDENTICAL COPY OK"
```

Expected: `IDENTICAL COPY OK` (per the base-drift trap in memory — verify every fresh snapshot).

- [ ] **Step 2: Create the verify harness skeleton**

Create `_verify_lite_1034.js`:

```js
// lite-1.034: chords float above lyrics + tap-insert entry; auth gates anonymous resume.
const { chromium } = require('playwright-core');
const path = require('path'); const http = require('http'); const fs = require('fs');
const BUILD = 'lite-1.034.html';
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
// Sign in as guest and open a song with one lyric line, takes listener stopped.
async function openGuestSong(page, lyricsDoc) {
  await page.click('.auth-btn.ghost');
  await page.waitForSelector('body.signed-in', { timeout: 15000 });
  await page.evaluate((doc) => {
    _openSongObj({ id: 'S', title: 'X', key: 'C major', lyricsDoc: doc });
    stopTakesListener();
  }, lyricsDoc || '<div>I walked the line</div>');
  await page.waitForTimeout(60);
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

- [ ] **Step 3: Run the skeleton to confirm the harness boots**

```bash
cd /Users/jasoncraig/Documents/Claude/Projects/Drafthaus
node _verify_lite_1034.js
```

Expected: prints `PASS — no fatal JS errors` (exit 0). If Chrome path differs, fix `executablePath`.

- [ ] **Step 4: Commit**

```bash
git add lite-1.034.html _verify_lite_1034.js
git commit -m "chore(lite-1.034): snapshot lite-1.033 + verify harness skeleton"
```

---

## Task 2: Gate auto-login so resumed guest sessions show the landing (bug 4)

**Files:**
- Modify: `lite-1.034.html` — `authGuest()` (`function authGuest()`), `onAuthStateChanged` (search `auth.onAuthStateChanged`)
- Modify: `_verify_lite_1034.js`

- [ ] **Step 1: Write the failing assertions**

In `_verify_lite_1034.js`, replace the `// (task assertions get appended here…)` line with this block:

```js
  // ── Bug 4: auth gating ──
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 800 }, hasTouch: true, isMobile: true });
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push('PAGEERROR(auth): ' + e.message));
    await page.goto(base, { waitUntil: 'load' });

    // Fresh "Continue as guest" tap → enters the app (real choice this session).
    await page.click('.auth-btn.ghost');
    await page.waitForSelector('body.signed-in', { timeout: 15000 });
    assert('bug4: fresh guest choice enters the app', await page.evaluate(() => document.body.classList.contains('signed-in')));

    // Simulate a RETURNING visit: guest session persists (Firebase IndexedDB) but the
    // per-session "guest chosen" flag is gone. Should show the login landing, not the app.
    await page.evaluate(() => { try { sessionStorage.clear(); } catch(e){} });
    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(1500); // let onAuthStateChanged resolve the persisted anon user
    assert('bug4: resumed guest (no session flag) shows login landing', await page.evaluate(() =>
      !document.body.classList.contains('signed-in') && getComputedStyle(document.getElementById('landing')).display !== 'none'));
    await ctx.close();
  }
```

- [ ] **Step 2: Run to verify it fails**

```bash
node _verify_lite_1034.js
```

Expected: `FAIL — bug4: resumed guest (no session flag) shows login landing` (today a resumed anon user enters the app).

- [ ] **Step 3: Set a per-session flag when guest is explicitly chosen**

In `lite-1.034.html`, find:

```js
function authGuest() { auth.signInAnonymously().catch(_authErr); }
```

Replace with:

```js
function authGuest() { try { sessionStorage.setItem('dh-lite-guest', '1'); } catch (e) {} auth.signInAnonymously().catch(_authErr); }
```

- [ ] **Step 4: Gate the auth-state handler on real account OR fresh guest choice**

In `lite-1.034.html`, find:

```js
auth.onAuthStateChanged(user => {
  if (user) {
    document.body.classList.add('signed-in');
    startSongsListener();
  } else {
```

Replace the `if (user) {` line and its condition so the block reads:

```js
auth.onAuthStateChanged(user => {
  const guestChosen = (() => { try { return sessionStorage.getItem('dh-lite-guest') === '1'; } catch (e) { return false; } })();
  if (user && (!user.isAnonymous || guestChosen)) {
    document.body.classList.add('signed-in');
    startSongsListener();
  } else {
```

(The `else` branch — clearing `signed-in`, unsubscribing songs, resetting the spinner — is unchanged and now also covers a resumed anonymous user that wasn't chosen this session.)

- [ ] **Step 5: Run to verify it passes**

```bash
node _verify_lite_1034.js
```

Expected: both `bug4:` lines PASS, plus `no fatal JS errors` PASS.

- [ ] **Step 6: Commit**

```bash
git add lite-1.034.html _verify_lite_1034.js
git commit -m "fix(lite-1.034): show login for resumed guest sessions, not a blank song list (bug 4)"
```

---

## Task 3: Stop iOS double-space-period in the lyrics editor (bug 3)

**Files:**
- Modify: `lite-1.034.html` — the `#lyricsEditor` element (search `id="lyricsEditor"`) and add a `beforeinput` guard near the lyrics JS (search `function onLyricsInput`).
- Modify: `_verify_lite_1034.js`

> Note: headless Chrome does **not** perform iOS smart-punctuation, so the meaningful automated check is that the mitigations are wired (attributes present + guard registered). Real validation is the on-device sign-off.

- [ ] **Step 1: Write the failing assertion**

In `_verify_lite_1034.js`, append inside the IIFE, before the `const fatal =` line:

```js
  // ── Bug 3: double-space-period mitigations wired ──
  {
    const page = await (await browser.newContext({ viewport: { width: 390, height: 800 }, hasTouch: true, isMobile: true })).newPage();
    page.on('pageerror', e => errors.push('PAGEERROR(bug3): ' + e.message));
    await page.goto(base, { waitUntil: 'load' });
    await openGuestSong(page);
    assert('bug3: editor disables autocorrect/autocapitalize', await page.evaluate(() => {
      const ed = document.getElementById('lyricsEditor');
      return ed.getAttribute('autocorrect') === 'off' && ed.getAttribute('autocapitalize') === 'off';
    }));
    assert('bug3: a ". " smart-punctuation beforeinput is cancelled to stay two spaces', await page.evaluate(() => {
      const ed = document.getElementById('lyricsEditor'); ed.focus();
      ed.innerHTML = '<div>hi </div>'; // a trailing space already present
      const ev = new InputEvent('beforeinput', { inputType: 'insertText', data: '. ', cancelable: true, bubbles: true });
      const notCancelled = ed.dispatchEvent(ev); // returns false if preventDefault() was called
      return notCancelled === false;
    }));
  }
```

- [ ] **Step 2: Run to verify it fails**

```bash
node _verify_lite_1034.js
```

Expected: both `bug3:` assertions FAIL (no attributes, no guard yet).

- [ ] **Step 3: Add the attributes to the editor element**

In `lite-1.034.html`, find:

```html
        <div id="lyricsEditor" contenteditable="true" spellcheck="true"
             data-placeholder="Tap to write your lyrics…"
             oninput="onLyricsInput()" onblur="flushLyrics()"></div>
```

Replace with:

```html
        <div id="lyricsEditor" contenteditable="true" spellcheck="true"
             autocorrect="off" autocapitalize="off"
             data-placeholder="Tap to write your lyrics…"
             oninput="onLyricsInput()" onblur="flushLyrics()"></div>
```

- [ ] **Step 4: Register the beforeinput guard**

In `lite-1.034.html`, find:

```js
let _lyricsTimer = null;
function onLyricsInput() { clearTimeout(_lyricsTimer); _lyricsTimer = setTimeout(flushLyrics, 900); }
```

Immediately after that `onLyricsInput` line, add:

```js
// iOS/Safari "double space → '. '" substitution: cancel it so a double space stays two
// spaces in lyrics. The substitution surfaces as a beforeinput whose data is "<period><space>".
(function bindNoSmartPeriod() {
  const ed = document.getElementById('lyricsEditor');
  if (!ed || ed._noSmartPeriod) return; ed._noSmartPeriod = true;
  ed.addEventListener('beforeinput', e => {
    if ((e.inputType === 'insertText' || e.inputType === 'insertReplacementText') && /^\.\s$/.test(e.data || '')) {
      e.preventDefault();
      try { document.execCommand('insertText', false, ' '); } catch (err) {}
    }
  });
})();
```

- [ ] **Step 5: Run to verify it passes**

```bash
node _verify_lite_1034.js
```

Expected: both `bug3:` assertions PASS.

- [ ] **Step 6: Commit**

```bash
git add lite-1.034.html _verify_lite_1034.js
git commit -m "fix(lite-1.034): cancel iOS double-space-period in lyrics editor (bug 3)"
```

---

## Task 4: Render chords floating above the lyric line (CSS)

**Files:**
- Modify: `lite-1.034.html` — the `#lyricsEditor` line-height (search `#lyricsEditor {`) and the `.chord` rules (search `#lyricsEditor .chord`).
- Modify: `_verify_lite_1034.js`

- [ ] **Step 1: Write the failing assertion**

In `_verify_lite_1034.js`, append inside the IIFE, before the `const fatal =` line:

```js
  // ── Chords render ABOVE the lyric line, taking zero advance width ──
  {
    const page = await (await browser.newContext({ viewport: { width: 390, height: 800 }, hasTouch: true, isMobile: true })).newPage();
    page.on('pageerror', e => errors.push('PAGEERROR(render): ' + e.message));
    await page.goto(base, { waitUntil: 'load' });
    await openGuestSong(page, '<div><span class="chord">G</span>walked the line</div>');
    assert('render: chord takes ~0 advance width in the lyric line', await page.evaluate(() =>
      document.querySelector('#lyricsEditor .chord').offsetWidth === 0));
    assert('render: chord label sits ABOVE the lyric baseline', await page.evaluate(() => {
      const ch = document.querySelector('#lyricsEditor .chord').getBoundingClientRect();
      // the lyric word after it
      const line = document.querySelector('#lyricsEditor div');
      const word = line.lastChild; // text node "walked the line"
      const r = document.createRange(); r.selectNodeContents(word);
      const lyr = r.getBoundingClientRect();
      return ch.top < lyr.top - 4; // chord is meaningfully higher than the words
    }));
  }
```

- [ ] **Step 2: Run to verify it fails**

```bash
node _verify_lite_1034.js
```

Expected: both `render:` assertions FAIL (today `.chord` is inline text on the baseline with non-zero width).

- [ ] **Step 3: Give the editor room and lift the chord above the line**

In `lite-1.034.html`, find:

```css
#lyricsEditor {
  flex: 1; overflow-y: auto; padding: 18px 16px 40vh; outline: none;
  font-size: 16px; line-height: 1.7; color: var(--text); -webkit-overflow-scrolling: touch;
}
```

Change `line-height: 1.7` to `line-height: 2.5` (room for the floating chord row):

```css
#lyricsEditor {
  flex: 1; overflow-y: auto; padding: 18px 16px 40vh; outline: none;
  font-size: 16px; line-height: 2.5; color: var(--text); -webkit-overflow-scrolling: touch;
}
```

Then find:

```css
#lyricsEditor .chord { font-family: ui-monospace, "SF Mono", Menlo, monospace; font-weight: 700; color: var(--tint); cursor: pointer; }
@media (hover: hover) { #lyricsEditor .chord:hover { background: var(--tint-bg); border-radius: 4px; } }
```

Replace both lines with:

```css
#lyricsEditor .chord {
  display: inline-block; width: 0; position: relative; vertical-align: baseline;
  white-space: nowrap; overflow: visible;
  font-family: ui-monospace, "SF Mono", Menlo, monospace; font-weight: 700; font-size: 0.82em;
  color: var(--tint); cursor: pointer; transform: translateY(-1.25em);
}
```

(The chord box contributes 0 width to the lyric flow; its text overflows to the right and is lifted into the leading above the word that follows it — ChordPro semantics.)

- [ ] **Step 4: Run to verify it passes**

```bash
node _verify_lite_1034.js
```

Expected: both `render:` assertions PASS.

- [ ] **Step 5: Commit**

```bash
git add lite-1.034.html _verify_lite_1034.js
git commit -m "feat(lite-1.034): render lyric chords floating above the line (zero advance width)"
```

---

## Task 5: Tap-to-insert chord entry — discrete spans, caret parked outside (bugs 1 & 2)

**Files:**
- Modify: `lite-1.034.html` — toolbar markup (search `class="lyr-toolbar"`), chord JS (replace `function applyChordFormat()`), chordPop head (search `id="chordPop"` head / `cpName`), `openChordPop`, and `_bindChordLyrics`.
- Modify: `_verify_lite_1034.js`

- [ ] **Step 1: Write the failing assertions**

In `_verify_lite_1034.js`, append inside the IIFE, before the `const fatal =` line:

```js
  // ── Bugs 1 & 2: discrete chord entry, caret never trapped in the span ──
  {
    const page = await (await browser.newContext({ viewport: { width: 390, height: 800 }, hasTouch: true, isMobile: true })).newPage();
    page.on('pageerror', e => errors.push('PAGEERROR(entry): ' + e.message));
    await page.goto(base, { waitUntil: 'load' });
    await openGuestSong(page, '<div>verse</div>');

    // Insert one chord at the caret, then type lyrics — typing must land OUTSIDE the chord.
    const r1 = await page.evaluate(() => {
      const ed = document.getElementById('lyricsEditor'); ed.focus();
      const sel = window.getSelection(); const r = document.createRange();
      r.selectNodeContents(ed.querySelector('div')); r.collapse(true); // caret at line start
      sel.removeAllRanges(); sel.addRange(r);
      document.dispatchEvent(new Event('selectionchange'));
      startChordEntry();
      document.getElementById('chordEntry').value = 'G'; commitChordEntry();
      document.execCommand('insertText', false, 'sing');
      const chords = ed.querySelectorAll('.chord');
      const typedNode = window.getSelection().anchorNode;
      const typedInChord = !!(typedNode && (typedNode.nodeType === 1 ? typedNode : typedNode.parentElement).closest('.chord'));
      return { count: chords.length, chordText: chords[0] && chords[0].textContent, typedInChord };
    });
    assert('bug1: chord entry creates exactly one .chord span', r1.count === 1 && r1.chordText === 'G');
    assert('bug1: text typed after a chord is NOT inside the chord span', r1.typedInChord === false);

    // Insert a second chord further along — must stay a separate span.
    const r2 = await page.evaluate(() => {
      const ed = document.getElementById('lyricsEditor');
      const sel = window.getSelection(); const r = document.createRange();
      r.selectNodeContents(ed.querySelector('div')); r.collapse(false); // caret at line end
      sel.removeAllRanges(); sel.addRange(r);
      document.dispatchEvent(new Event('selectionchange'));
      startChordEntry();
      document.getElementById('chordEntry').value = 'C'; commitChordEntry();
      return ed.querySelectorAll('.chord').length;
    });
    assert('bug2: a second chord is a separate span (2 total, not merged)', r2 === 2);

    // Stored form stays full-app compatible: inline <span class="chord">.
    assert('compat: saved lyricsDoc still uses <span class="chord">', await page.evaluate(() => {
      const ed = document.getElementById('lyricsEditor');
      return /<span class="chord">/.test(ilSanitizeDocHtml(ed.innerHTML));
    }));
  }
```

- [ ] **Step 2: Run to verify it fails**

```bash
node _verify_lite_1034.js
```

Expected: FAIL with a pageerror like `startChordEntry is not defined` (the new entry functions don't exist yet).

- [ ] **Step 3: Replace the toolbar with a tap-to-insert chord control**

In `lite-1.034.html`, find:

```html
    <div class="lyr-toolbar">
      <button class="lyr-btn" onmousedown="event.preventDefault()" onclick="applyChordFormat()" title="Mark selection as a chord (monospace, tappable)">🎵 Chord</button>
      <button class="lyr-btn" onmousedown="event.preventDefault()" onclick="applyBold()" title="Bold"><b>B</b></button>
      <span class="lyr-hint">Select text → Chord to add tappable chords above your lyrics</span>
    </div>
```

Replace with:

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

- [ ] **Step 4: Add the chord-entry input styling**

In `lite-1.034.html`, find the lyrics toolbar style rule:

```css
.lyr-toolbar { display: flex; align-items: center; gap: 8px; padding: 6px 12px; border-bottom: .5px solid var(--sep); background: var(--bg); flex: none; }
```

Add immediately after it:

```css
.chord-entry { font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 15px; font-weight: 700; color: var(--tint); background: var(--bg-input); border: 1px solid var(--tint); border-radius: 8px; padding: 5px 9px; width: 150px; outline: none; }
```

- [ ] **Step 5: Replace `applyChordFormat` with the caret-safe insert engine**

In `lite-1.034.html`, find the whole `applyChordFormat` function:

```js
/* ── Lyrics formatting: mark selection as a chord (monospace + tappable) ── */
function applyChordFormat() {
  const ed = document.getElementById('lyricsEditor');
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) { toast('Select some text first'); return; }
  const range = sel.getRangeAt(0);
  if (!ed.contains(range.commonAncestorContainer)) return;
  let node = range.commonAncestorContainer; if (node.nodeType === 3) node = node.parentElement;
  const existing = node && node.closest ? node.closest('.chord') : null;
  if (existing && ed.contains(existing)) {
    const p = existing.parentNode; while (existing.firstChild) p.insertBefore(existing.firstChild, existing); p.removeChild(existing); // unwrap
  } else {
    const span = document.createElement('span'); span.className = 'chord';
    try { range.surroundContents(span); }
    catch (e) { span.appendChild(range.extractContents()); range.insertNode(span); }
  }
  sel.removeAllRanges();
  onLyricsInput();
}
```

Replace the entire function (keep the comment banner) with:

```js
/* ── Lyrics chords: insert a discrete chord span at the caret, floating above lyrics ── */
let _savedLyricRange = null, _cpEl = null;
document.addEventListener('selectionchange', () => {
  const ed = document.getElementById('lyricsEditor'); if (!ed) return;
  const sel = window.getSelection();
  if (sel && sel.rangeCount && ed.contains(sel.getRangeAt(0).commonAncestorContainer)) {
    _savedLyricRange = sel.getRangeAt(0).cloneRange();
  }
});
function _lyricCaretRange() {
  const ed = document.getElementById('lyricsEditor');
  if (_savedLyricRange && ed.contains(_savedLyricRange.commonAncestorContainer)) return _savedLyricRange.cloneRange();
  const r = document.createRange(); r.selectNodeContents(ed); r.collapse(false); return r; // fall back to end
}
function startChordEntry() {
  document.getElementById('lyricsEditor').focus(); // ensures selectionchange captured a range
  const inp = document.getElementById('chordEntry');
  inp.style.display = ''; inp.value = ''; inp.focus();
}
function cancelChordEntry() { const inp = document.getElementById('chordEntry'); inp.value = ''; inp.style.display = 'none'; }
function chordEntryKey(ev) {
  if (ev.key === 'Enter') { ev.preventDefault(); commitChordEntry(); }
  else if (ev.key === 'Escape') { ev.preventDefault(); cancelChordEntry(); }
}
function commitChordEntry() {
  const inp = document.getElementById('chordEntry');
  const name = inp.value.trim(); inp.value = ''; inp.style.display = 'none';
  if (!name) return;
  const ed = document.getElementById('lyricsEditor'); ed.focus();
  const range = _lyricCaretRange(); range.collapse(true);
  const span = document.createElement('span'); span.className = 'chord'; span.textContent = name;
  range.insertNode(span);
  // Park the caret immediately AFTER the span, in plain lyric flow — never inside the chord.
  const after = document.createRange(); after.setStartAfter(span); after.collapse(true);
  const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(after);
  _savedLyricRange = after.cloneRange();
  onLyricsInput();
}
```

- [ ] **Step 6: Add edit/remove actions to the chord popover and track the open chord**

In `lite-1.034.html`, find the `openChordPop` function opening lines:

```js
function openChordPop(rawName, anchorEl, pinned) {
  _cpRaw = String(rawName).trim(); _cpName = _normChordName(_cpRaw); _cpPinned = !!pinned;
  document.getElementById('cpName').textContent = _cpRaw;
```

Insert one line so it records which chord span is open (only when the anchor IS a chord span):

```js
function openChordPop(rawName, anchorEl, pinned) {
  _cpRaw = String(rawName).trim(); _cpName = _normChordName(_cpRaw); _cpPinned = !!pinned;
  _cpEl = (anchorEl && anchorEl.classList && anchorEl.classList.contains('chord')) ? anchorEl : null;
  document.getElementById('cpName').textContent = _cpRaw;
```

Then find the chordPop header markup (search for `id="cpName"` inside the `#chordPop` `.cp-head`). It looks like:

```html
      <div class="cp-name" id="cpName"></div>
```

Add edit + remove buttons right after that `cpName` div, still inside `.cp-head`:

```html
      <div class="cp-name" id="cpName"></div>
      <div class="cp-edit-actions">
        <button class="cp-edit-btn" onclick="cpEditChord()" title="Edit chord">✎</button>
        <button class="cp-edit-btn" onclick="cpRemoveChord()" title="Remove chord">🗑</button>
      </div>
```

Add the styling next to the other `#chordPop` rules (search `#chordPop .cp-name`):

```css
#chordPop .cp-edit-actions { display: flex; gap: 4px; }
#chordPop .cp-edit-btn { font-size: 14px; padding: 4px 7px; border-radius: 7px; color: var(--text-2); background: var(--bg-input); }
```

Now add the two handlers. Find `function closeChordPop()`:

```js
function closeChordPop() { document.getElementById('chordPop').classList.remove('open'); document.getElementById('chordPopBackdrop').classList.remove('open'); _cpPinned = false; }
```

Immediately after it, add:

```js
function cpRemoveChord() { if (_cpEl) { _cpEl.remove(); onLyricsInput(); } _cpEl = null; closeChordPop(); }
function cpEditChord() {
  if (!_cpEl) { closeChordPop(); return; }
  const name = _cpEl.textContent;
  const ed = document.getElementById('lyricsEditor'); ed.focus();
  const r = document.createRange(); r.setStartBefore(_cpEl); r.collapse(true); _savedLyricRange = r.cloneRange();
  _cpEl.remove(); _cpEl = null; onLyricsInput(); closeChordPop();
  const inp = document.getElementById('chordEntry'); inp.style.display = ''; inp.value = name; inp.focus(); inp.select();
}
```

- [ ] **Step 7: Run to verify the entry assertions pass**

```bash
node _verify_lite_1034.js
```

Expected: `bug1:`, `bug2:`, and `compat:` assertions all PASS, and no `entry` pageerror.

- [ ] **Step 8: Commit**

```bash
git add lite-1.034.html _verify_lite_1034.js
git commit -m "feat(lite-1.034): tap-to-insert chords (discrete spans, caret parked outside) + edit/remove (bugs 1 & 2)"
```

---

## Task 6: Full verification, dead-code sweep, and ship prep

**Files:**
- Modify: `lite-1.034.html` (confirm no orphaned references)
- Modify: memory `drafthaus-lite.md` + `MEMORY.md`

- [ ] **Step 1: Confirm `applyChordFormat` is fully gone (no orphan calls)**

```bash
cd /Users/jasoncraig/Documents/Claude/Projects/Drafthaus
grep -n "applyChordFormat" lite-1.034.html || echo "NO ORPHAN REFERENCES — OK"
```

Expected: `NO ORPHAN REFERENCES — OK` (it was the only caller; Task 5 replaced both the button and the function).

- [ ] **Step 2: Run the full verify suite**

```bash
node _verify_lite_1034.js; echo "exit=$?"
```

Expected: every line `PASS`, `exit=0`. If any `FAIL`, fix in `lite-1.034.html` and re-run before proceeding.

- [ ] **Step 3: Sanity-check the diff against the base**

```bash
git --no-pager diff --stat 9031ba8 -- lite-1.034.html 2>/dev/null || true
diff <(git show HEAD:lite-1.033.html 2>/dev/null || cat lite-1.033.html) lite-1.034.html | head -120
```

Expected: changes are confined to the chord CSS/JS, toolbar, editor attributes, auth handler, and chordPop — nothing unrelated (guards against the base-drift trap in memory).

- [ ] **Step 4: Update memory**

Edit `~/.claude/projects/-Users-jasoncraig-Documents-Claude-Projects-Drafthaus/memory/drafthaus-lite.md`: add a `lite-1.034` bullet under Progress summarizing — chords now float above lyrics (stored unchanged as inline `<span class="chord">` for full-app compat); chord entry is tap-🎵-type-Enter (discrete span, caret parked outside → fixes typing-bleed + merge); edit/remove in chordPop; iOS double-space-period cancelled; auth gates resumed anonymous sessions to the login landing (real accounts unchanged). Note: not yet pushed; awaiting user confirm + on-device sign-off (esp. iPhone Safari chord tap-target on the zero-width span, and Safari/DuckDuckGo login gating). No `MEMORY.md` content change needed beyond confirming the pointer still describes the file.

- [ ] **Step 5: Commit the memory update**

```bash
git -C /Users/jasoncraig/Documents/Claude/Projects/Drafthaus add -A
cd /Users/jasoncraig/Documents/Claude/Projects/Drafthaus
git add lite-1.034.html _verify_lite_1034.js
git commit -m "chore(lite-1.034): verified all four fixes; update Lite memory"
```

- [ ] **Step 6: Stop — do NOT push**

Report to the user: all four fixes implemented and headless-verified in `lite-1.034.html`. **Pushing deploys `drafthaus.ca`, so wait for explicit confirmation.** When confirmed: `git push`, then poll the deploy and ask the user to sign off on-device (iPhone Safari chord entry + Safari/DuckDuckGo login gating). Promotion to a clean `lite.html` is a separate, later step.

---

## Self-Review

**Spec coverage:**
- Bug 1 (typing bleeds into chord) → Task 5 (caret parked after span) ✓
- Bug 2 (chords merge) → Task 5 (discrete spans, separate-span assert) ✓
- Bug 3 (double-space-period) → Task 3 ✓
- Bug 4 (no login on Safari/DDG) → Task 2 ✓
- Chords-above rendering → Task 4 ✓
- Shared `lyricsDoc` compatibility → Task 5 `compat:` assert ✓
- Edit/remove existing chord → Task 5 Step 6 ✓
- Headless verification over real HTTP → Tasks 1–6 ✓
- File-copy version + no-push gate + memory update → Tasks 1, 6 ✓

**Placeholder scan:** No TBD/TODO; every code step shows full code and exact commands. ✓

**Type/name consistency:** `startChordEntry`, `chordEntryKey`, `cancelChordEntry`, `commitChordEntry`, `_savedLyricRange`, `_lyricCaretRange`, `_cpEl`, `cpEditChord`, `cpRemoveChord`, `#chordEntry`, `.chord-entry` used consistently across markup, JS, CSS, and tests. `openChordPop`/`closeChordPop` extended, not renamed. ✓

**One risk flagged for execution:** the zero-width `.chord` box relies on overflow-visible text being hit-testable for taps on mobile; if the on-device sign-off shows the chord is hard to tap, widen the hit area (e.g. a transparent padded child or `min-width`) — but that's a polish follow-up, not a blocker for the four fixes.
