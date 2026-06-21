# Lite Phase 3 — Lyrics Multi-Device Reconciliation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Stop stale-tab lyric overwrites and never lose lyrics across devices, building `lite-1.068.html` from `lite-1.067.html`. Reconcile via content-comparison + inline-append: freshen-on-return, a transactional online save-guard, and an offline pending-lyrics store reconciled on reconnect.

**Architecture:** Track `_lyricsBase` (the lyrics content this device last loaded/synced). The everyday path is **freshen-on-return** (`liteFreshenSong` on visibility/focus/online: re-pull lyrics, verify takes listener, drain). The safety net is a **transactional `flushLyrics`** (online: atomic read-compare-merge) plus an **offline `pendingLyrics` IndexedDB store** drained by `liteLyricsDrain` on reconnect. Divergence → the other version is inline-appended below a divider in the editor. No new Firestore fields.

**Tech Stack:** Vanilla JS, Web Audio, Firebase v10 compat (Firestore transactions + persistence), IndexedDB. Single-file HTML. Headless verify via playwright-core + installed Chrome.

## Global Constraints

- **App file:** all work in `lite-1.068.html` (copy of `lite-1.067.html`). Never touch `index.html`/`full.html`/`1.3xx.html`. Promote into `index.html` only after on-device sign-off (NOT in this plan).
- **Base:** `lite-1.067.html` (md5 `a7e044cf21ea04f5907c4e8886683d6b`). Confirm via `md5 -q lite-1.067.html` before copying; `diff -q` the copy.
- **Data-safety (hard invariants):**
  1. Lyrics are never silently overwritten — every write compares against `_lyricsBase`/server and inline-appends on divergence. The existing blank-guard (`_ilCommitDoc`) is preserved as the first check.
  2. Single-device / no-conflict behavior is byte-identical to 1.067: `remote === _lyricsBase` → normal write, NO divider.
  3. Scalars (title/key/boost/tuning/tile-color/pin) are NOT modified — already offline-safe + per-field LWW.
  4. Existing songs/takes unaffected; the `pendingLyrics` store only holds entries this device created offline; the IndexedDB upgrade is strictly additive (never touches `takeBlobs`/`outbox`).
  5. All Firestore writes additive + `{merge:true}`; `index.html`/`full.html` untouched; clean file-copy snapshot.
- **No new Firestore fields** — reconciliation is content-comparison; the merge lives inline in `lyricsDoc`.
- **IndexedDB-unavailable fallback** (mirror the 1.067 pattern): a `_memPendingLyrics` Map when `_dhAudioOpen()` is null.
- **Verify:** headless `_verify_lite_1068.js` over real HTTP via playwright-core + installed Chrome; run ONCE to a file (anon-auth rate-limit); assert COMPUTED state; reuse the guest/song recipe + real-`setOffline` integration pattern from `_verify_lite_1067.js`.

---

### Task 1: Base tracking + pendingLyrics store + helpers

**Files:**
- Create: `lite-1.068.html` (copy of `lite-1.067.html`).
- Modify in `lite-1.068.html`: the `dhAudio*` module (IndexedDB version bump + new store/helpers, near the `_memOutbox` line ~1608 and the open ~1613); the lyrics block (add `currentEditorHtml`/`_lyricsDivider`/`_lyricsBase` near `flushLyrics`); `_openSongObj` (set base + seed pending). Add CSS for the divider.
- Create: `_verify_lite_1068.js`.

**Interfaces:**
- Consumes: `_dhAudioOpen`, `_dhReq`, `ilSanitizeDocHtml`, `ilGetDocHtml`, `_atomizeLyricChords`.
- Produces: `_lyricsBase` (string), `currentEditorHtml()→string`, `_lyricsDivider(src)→string`; IndexedDB v3 with a `pendingLyrics` store (`keyPath:'songId'`); `dhPendingLyricsPut(e)/Get(id)/All()/Delete(id)` (memory-fallback, never throw); `_memPendingLyrics` Map.

- [ ] **Step 1: Create the working file**

```bash
md5 -q lite-1.067.html   # expect a7e044cf21ea04f5907c4e8886683d6b
cp lite-1.067.html lite-1.068.html
diff -q lite-1.067.html lite-1.068.html && echo "COPY OK"
```

- [ ] **Step 2: Write the failing Task-1 asserts**

Create `_verify_lite_1068.js` from `_verify_lite_1067.js` (same harness + guest/song helpers), navigate to `/lite-1.068.html`. Task-1 block (pure infra, no auth):

```js
  const t1 = await pg.evaluate(async () => {
    const hasHelpers = typeof currentEditorHtml === 'function' && typeof _lyricsDivider === 'function' && typeof dhPendingLyricsPut === 'function';
    const div = _lyricsDivider('iPhone');
    await dhPendingLyricsPut({ songId: 's1', lyricsDoc: '<div>A2</div>', base: '<div>A</div>', editedAt: 1 });
    const got = await dhPendingLyricsGet('s1');
    const all = await dhPendingLyricsAll();
    await dhPendingLyricsDelete('s1');
    const afterDel = await dhPendingLyricsGet('s1');
    return { hasHelpers, divHasText: /Also edited on iPhone/.test(div), gotDoc: got && got.lyricsDoc, allLen: all.length, afterDel: afterDel === null };
  });
  ok(t1.hasHelpers, 'T1 lyrics helpers + pendingLyrics helpers exist');
  ok(t1.divHasText, 'T1 _lyricsDivider includes the source label');
  ok(t1.gotDoc === '<div>A2</div>', 'T1 dhPendingLyricsPut/Get round-trips');
  ok(t1.allLen >= 1, 'T1 dhPendingLyricsAll returns entries');
  ok(t1.afterDel, 'T1 dhPendingLyricsDelete removes the entry');
```
Run: `node _verify_lite_1068.js > /tmp/v1068.txt 2>&1; cat /tmp/v1068.txt` → FAIL (helpers undefined / DB still v2).

- [ ] **Step 3: Bump IndexedDB to v3 + add the pendingLyrics store + helpers**

In `_dhAudioOpen`, change `indexedDB.open('dh-lite-audio', 2)` → `3`, and in `onupgradeneeded` add (after the `outbox` line):
```js
      if (!idb.objectStoreNames.contains('pendingLyrics')) idb.createObjectStore('pendingLyrics', { keyPath: 'songId' });
```
Near `const _memOutbox = new Map();`, add `const _memPendingLyrics = new Map();`. After the outbox helpers, add:
```js
function _dhPL(db2, mode) { return db2.transaction('pendingLyrics', mode).objectStore('pendingLyrics'); }
async function dhPendingLyricsPut(e) { const db = await _dhAudioOpen(); if (!db) { _memPendingLyrics.set(e.songId, e); return true; } try { await _dhReq(_dhPL(db, 'readwrite').put(e)); return true; } catch (x) { return false; } }
async function dhPendingLyricsGet(songId) { const db = await _dhAudioOpen(); if (!db) { return _memPendingLyrics.get(songId) || null; } try { return (await _dhReq(_dhPL(db, 'readonly').get(songId))) || null; } catch (x) { return null; } }
async function dhPendingLyricsAll() { const db = await _dhAudioOpen(); if (!db) { return Array.from(_memPendingLyrics.values()); } try { return (await _dhReq(_dhPL(db, 'readonly').getAll())) || []; } catch (x) { return []; } }
async function dhPendingLyricsDelete(songId) { _memPendingLyrics.delete(songId); const db = await _dhAudioOpen(); if (!db) return; try { await _dhReq(_dhPL(db, 'readwrite').delete(songId)); } catch (x) {} }
```

- [ ] **Step 4: Add lyrics base tracking + helpers**

Just above `async function flushLyrics()`:
```js
let _lyricsBase = '';
function currentEditorHtml() { const ed = document.getElementById('lyricsEditor'); return ed ? ilSanitizeDocHtml(ed.innerHTML) : ''; }
function _lyricsDivider(src) { return '<div class="lyr-merge-divider">—— Also edited on ' + (src || 'another device') + ' ——</div>'; }
```
Add CSS near the `#lyricsEditor` rules:
```css
.lyr-merge-divider { text-align: center; color: var(--text-3); font-size: 12px; margin: 14px 0; user-select: none; }
```
⚠️ Verify `ilSanitizeDocHtml` preserves a `<div class="lyr-merge-divider">…</div>` (run `ilSanitizeDocHtml(_lyricsDivider('x'))` in the page and confirm the text survives). If sanitize strips the class, the divider still works as a plain centered `<div>` with the text — the text is what matters; adjust the CSS selector to `#lyricsEditor div` styling only if needed and note it in the report.

- [ ] **Step 5: Set base on open + seed pending edits**

In `_openSongObj`, right after the `document.getElementById('lyricsEditor').innerHTML = ilSanitizeDocHtml(ilGetDocHtml(s)); _atomizeLyricChords();` lines, add:
```js
  _lyricsBase = ilSanitizeDocHtml(ilGetDocHtml(s));
  _maybeSeedPendingLyrics(s.id);
```
Add the helper near `flushLyrics`:
```js
async function _maybeSeedPendingLyrics(songId) {
  const e = await dhPendingLyricsGet(songId);
  if (!e || !_currentSong || _currentSong.id !== songId) return;
  const ed = document.getElementById('lyricsEditor'); if (!ed) return;
  ed.innerHTML = ilSanitizeDocHtml(e.lyricsDoc); _atomizeLyricChords();
  _lyricsBase = e.base; _currentSong.lyricsDoc = e.lyricsDoc;
}
```

- [ ] **Step 6: Add a Task-1 base assert + run**

Append to the Task-1 block: open a song, assert `_lyricsBase` is a string and `currentEditorHtml()` returns the sanitized editor html. Run once → all Task-1 asserts PASS.

- [ ] **Step 7: Commit**

```bash
git add lite-1.068.html _verify_lite_1068.js
git commit -m "feat(lite-1.068): lyrics base tracking + pendingLyrics IndexedDB store + divider helper"
```

---

### Task 2: Transactional online save-guard (`flushLyrics`)

**Files:** Modify `flushLyrics` (search `async function flushLyrics`). Test: add Task-2 asserts.

**Interfaces:** Consumes `_lyricsBase`, `currentEditorHtml`, `_lyricsDivider`, `_ilCommitDoc`, `dhPendingLyricsPut`, `db.runTransaction`, `_atomizeLyricChords`, `toast`. Produces the conflict-aware save.

- [ ] **Step 1: Write the failing Task-2 asserts**

Drive a signed-in song. Stub `db.runTransaction` to feed a controlled `serverDoc` and capture the written `result`.

```js
  // no-conflict: serverDoc === base → writes editor content, no divider
  const t2a = await pg.evaluate(async () => {
    _currentSong = { id: 'sg', lyricsDoc: '<div>A</div>' }; _lyricsBase = '<div>A</div>';
    document.getElementById('lyricsEditor').innerHTML = '<div>A2</div>';
    let written = null;
    const orig = db.runTransaction.bind(db);
    db.runTransaction = async (fn) => fn({ get: async () => ({ exists: true, data: () => ({ lyricsDoc: '<div>A</div>' }) }), set: (ref, d) => { written = d; } });
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => true });
    await flushLyrics();
    db.runTransaction = orig;
    return { written: written && written.lyricsDoc, base: _lyricsBase, noDivider: !/Also edited/.test(written.lyricsDoc) };
  });
  ok(/A2/.test(t2a.written) && t2a.noDivider, 'T2 no-conflict save writes editor content, no divider');
  ok(t2a.base === t2a.written, 'T2 _lyricsBase updates to the written content');

  // conflict: serverDoc !== base → inline-append merge
  const t2b = await pg.evaluate(async () => {
    _currentSong = { id: 'sg', lyricsDoc: '<div>A</div>' }; _lyricsBase = '<div>A</div>';
    document.getElementById('lyricsEditor').innerHTML = '<div>A2</div>';
    let written = null;
    const orig = db.runTransaction.bind(db);
    db.runTransaction = async (fn) => fn({ get: async () => ({ exists: true, data: () => ({ lyricsDoc: '<div>B</div>' }) }), set: (ref, d) => { written = d; } });
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => true });
    await flushLyrics();
    db.runTransaction = orig;
    return { written: written && written.lyricsDoc };
  });
  ok(/A2/.test(t2b.written) && /Also edited/.test(t2b.written) && /B/.test(t2b.written), 'T2 conflict save inline-appends both versions + divider');

  // offline: no transaction, writes a pendingLyrics entry
  const t2c = await pg.evaluate(async () => {
    _currentSong = { id: 'sgoff', lyricsDoc: '<div>A</div>' }; _lyricsBase = '<div>A</div>';
    document.getElementById('lyricsEditor').innerHTML = '<div>A2</div>';
    let txCalled = false; const orig = db.runTransaction.bind(db); db.runTransaction = async (fn) => { txCalled = true; return orig(fn); };
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => false });
    await flushLyrics();
    const e = await dhPendingLyricsGet('sgoff');
    db.runTransaction = orig; Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => true });
    await dhPendingLyricsDelete('sgoff');
    return { pending: e && e.lyricsDoc, base: e && e.base, noTx: txCalled === false };
  });
  ok(/A2/.test(t2c.pending) && t2c.base === '<div>A</div>' && t2c.noTx, 'T2 offline save stores pendingLyrics, no transaction');
```
Run → FAIL (current flushLyrics does a blind `set`, no transaction/pending).

- [ ] **Step 2: Rewrite `flushLyrics`**

```js
async function flushLyrics() {
  clearTimeout(_lyricsTimer);
  const ed = document.getElementById('lyricsEditor');
  if (!_currentSong || !ed) return;
  const html = currentEditorHtml();
  if (!_ilCommitDoc(html, _currentSong)) return; // blank-guard
  const songId = _currentSong.id;
  if (!navigator.onLine) { await dhPendingLyricsPut({ songId, lyricsDoc: html, base: _lyricsBase, editedAt: Date.now() }); return; }
  try {
    const ref = db.collection('songs').doc(songId);
    const res = await db.runTransaction(async tx => {
      const snap = await tx.get(ref);
      const serverDoc = (snap.exists && typeof snap.data().lyricsDoc === 'string') ? snap.data().lyricsDoc : '';
      let result, merged = false;
      if (serverDoc === _lyricsBase) { result = html; }
      else { result = html + _lyricsDivider('another device') + serverDoc; merged = true; }
      tx.set(ref, { lyricsDoc: result, lyricsDocInit: true, updatedAt: Date.now() }, { merge: true });
      return { result, merged };
    });
    _lyricsBase = res.result; _currentSong.lyricsDoc = res.result;
    if (res.merged && _currentSong.id === songId && document.activeElement !== ed) {
      ed.innerHTML = ilSanitizeDocHtml(res.result); _atomizeLyricChords();
    }
    if (res.merged) toast('Merged lyrics from another device — review', 2600, true);
  } catch (e) {
    console.warn('[lyrics] save', e);
    await dhPendingLyricsPut({ songId, lyricsDoc: html, base: _lyricsBase, editedAt: Date.now() }); // e.g. dropped offline mid-save
  }
}
```
Note: on a merge while the editor is focused (actively typing), we DON'T swap the DOM (avoid cursor jump) — `_lyricsBase`/`_currentSong.lyricsDoc` still update to the merged result and the toast fires; the merged content lands in the editor on the next freshen/blur. Not focused → swap immediately.

- [ ] **Step 3: Run Task-2 + full file** → all PASS.
- [ ] **Step 4: Commit**

```bash
git add lite-1.068.html _verify_lite_1068.js
git commit -m "feat(lite-1.068): transactional flushLyrics — inline-append merge online, pending store offline"
```

---

### Task 3: Reconcile-on-reconnect (`liteLyricsDrain`)

**Files:** Add `liteLyricsDrain` (near `liteSyncDrain`). Test: add Task-3 asserts.

**Interfaces:** Consumes `dhPendingLyricsAll/Delete`, `db.runTransaction`, `_lyricsDivider`, `_currentSong`, editor + `_atomizeLyricChords`, `toast`. Produces `liteLyricsDrain()` (single-flight via `_lyricsDraining`).

- [ ] **Step 1: Write the failing Task-3 asserts**

```js
  // pending entry reconciles: serverDoc moved → inline-append; entry cleared
  const t3 = await pg.evaluate(async () => {
    await dhPendingLyricsPut({ songId: 'sd', lyricsDoc: '<div>A2</div>', base: '<div>A</div>', editedAt: 1 });
    let written = null;
    const orig = db.runTransaction.bind(db);
    db.runTransaction = async (fn) => fn({ get: async () => ({ exists: true, data: () => ({ lyricsDoc: '<div>B</div>' }) }), set: (ref, d) => { written = d; } });
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => true });
    await liteLyricsDrain();
    const left = await dhPendingLyricsGet('sd');
    db.runTransaction = orig;
    return { written: written && written.lyricsDoc, cleared: left === null };
  });
  ok(/A2/.test(t3.written) && /Also edited/.test(t3.written) && /B/.test(t3.written), 'T3 drain inline-appends on server divergence');
  ok(t3.cleared, 'T3 drain clears the pending entry on success');

  // no-divergence reconcile: serverDoc === base → writes clean
  const t3b = await pg.evaluate(async () => {
    await dhPendingLyricsPut({ songId: 'sd2', lyricsDoc: '<div>A2</div>', base: '<div>A</div>', editedAt: 1 });
    let written = null;
    const orig = db.runTransaction.bind(db);
    db.runTransaction = async (fn) => fn({ get: async () => ({ exists: true, data: () => ({ lyricsDoc: '<div>A</div>' }) }), set: (ref, d) => { written = d; } });
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => true });
    await liteLyricsDrain();
    db.runTransaction = orig;
    await dhPendingLyricsDelete('sd2');
    return { written: written && written.lyricsDoc, noDivider: written && !/Also edited/.test(written.lyricsDoc) };
  });
  ok(/A2/.test(t3b.written) && t3b.noDivider, 'T3 drain writes clean when server unchanged');
```
Run → FAIL (`liteLyricsDrain` undefined).

- [ ] **Step 2: Implement `liteLyricsDrain`** (place after `liteSyncDrain`)

```js
let _lyricsDraining = false;
async function liteLyricsDrain() {
  if (_lyricsDraining || !navigator.onLine) return;
  const entries = await dhPendingLyricsAll();
  if (!entries.length) return;
  _lyricsDraining = true;
  try {
    for (const e of entries) {
      if (!navigator.onLine) break;
      try {
        const ref = db.collection('songs').doc(e.songId);
        const res = await db.runTransaction(async tx => {
          const snap = await tx.get(ref);
          const serverDoc = (snap.exists && typeof snap.data().lyricsDoc === 'string') ? snap.data().lyricsDoc : '';
          let result, merged = false;
          if (serverDoc === e.base) { result = e.lyricsDoc; }
          else { result = e.lyricsDoc + _lyricsDivider('another device') + serverDoc; merged = true; }
          tx.set(ref, { lyricsDoc: result, lyricsDocInit: true, updatedAt: Date.now() }, { merge: true });
          return { result, merged };
        });
        await dhPendingLyricsDelete(e.songId);
        if (_currentSong && _currentSong.id === e.songId) {
          _lyricsBase = res.result; _currentSong.lyricsDoc = res.result;
          const ed = document.getElementById('lyricsEditor');
          if (ed && document.activeElement !== ed && currentEditorHtml() !== res.result) { ed.innerHTML = ilSanitizeDocHtml(res.result); _atomizeLyricChords(); }
          if (res.merged) toast('Merged lyrics from another device — review', 2600, true);
        }
      } catch (x) { console.warn('[lyrics drain]', x); } // keep entry, retry next trigger
    }
  } finally { _lyricsDraining = false; }
}
```

- [ ] **Step 3: Wire it into the connectivity + boot handlers**

Add `liteLyricsDrain();` next to the existing `liteSyncDrain();` calls in: the `online` listener, the `visibilitychange` (visible) listener, and the boot/auth seed block (where `liteSyncDrain()` was added in Phase 2). (Freshen — Task 4 — will also call it.)

- [ ] **Step 4: Run Task-3 + full file** → all PASS.
- [ ] **Step 5: Commit**

```bash
git add lite-1.068.html _verify_lite_1068.js
git commit -m "feat(lite-1.068): liteLyricsDrain — reconcile offline lyric edits on reconnect (inline-append)"
```

---

### Task 4: Freshen-on-return (`liteFreshenSong`)

**Files:** Add `liteFreshenSong` (near `liteLyricsDrain`); extend the connectivity/focus handlers. Test: add Task-4 asserts.

**Interfaces:** Consumes `_currentSong`, `db.collection('songs').doc().get`, `_lyricsBase`, `currentEditorHtml`, `_lyricsDivider`, `startTakesListener`/`_takesSongId`/`_takesUnsub`, `liteSyncDrain`/`liteLyricsDrain`, editor + `_atomizeLyricChords`, `toast`, `onLyricsInput`. Produces `liteFreshenSong()`.

- [ ] **Step 1: Write the failing Task-4 asserts**

```js
  // adopt: remote moved, no local edits → editor becomes remote, base updates
  const t4a = await pg.evaluate(async () => {
    _currentSong = { id: 'sf', lyricsDoc: '<div>A</div>' }; _lyricsBase = '<div>A</div>';
    document.getElementById('lyricsEditor').innerHTML = '<div>A</div>'; // == base (no local edits)
    document.getElementById('lyricsEditor').blur();
    const orig = db.collection.bind(db);
    db.collection = (n) => n === 'songs' ? { doc: () => ({ get: async () => ({ exists: true, data: () => ({ lyricsDoc: '<div>B</div>' }) }) }) } : orig(n);
    await liteFreshenSong();
    db.collection = orig;
    return { editor: currentEditorHtml(), base: _lyricsBase };
  });
  ok(/B/.test(t4a.editor) && !/A<\/div>/.test(t4a.editor) && t4a.base === '<div>B</div>', 'T4 freshen adopts remote when no local edits');

  // merge: remote moved AND local edits → inline-append
  const t4b = await pg.evaluate(async () => {
    _currentSong = { id: 'sf2', lyricsDoc: '<div>A</div>' }; _lyricsBase = '<div>A</div>';
    document.getElementById('lyricsEditor').innerHTML = '<div>Alocal</div>'; // != base (local edits)
    const orig = db.collection.bind(db);
    db.collection = (n) => n === 'songs' ? { doc: () => ({ get: async () => ({ exists: true, data: () => ({ lyricsDoc: '<div>B</div>' }) }) }) } : orig(n);
    await liteFreshenSong();
    db.collection = orig;
    return { editor: currentEditorHtml(), base: _lyricsBase };
  });
  ok(/Alocal/.test(t4b.editor) && /Also edited/.test(t4b.editor) && /B/.test(t4b.editor) && t4b.base === '<div>B</div>', 'T4 freshen inline-appends when both moved');

  // no-op: remote == base → nothing changes
  const t4c = await pg.evaluate(async () => {
    _currentSong = { id: 'sf3', lyricsDoc: '<div>A</div>' }; _lyricsBase = '<div>A</div>';
    document.getElementById('lyricsEditor').innerHTML = '<div>A2</div>';
    const orig = db.collection.bind(db);
    db.collection = (n) => n === 'songs' ? { doc: () => ({ get: async () => ({ exists: true, data: () => ({ lyricsDoc: '<div>A</div>' }) }) }) } : orig(n);
    await liteFreshenSong();
    db.collection = orig;
    return { editor: currentEditorHtml() };
  });
  ok(/A2/.test(t4c.editor) && !/Also edited/.test(t4c.editor), 'T4 freshen no-ops when remote unchanged (keeps local edits)');
```
Run → FAIL (`liteFreshenSong` undefined).

- [ ] **Step 2: Implement `liteFreshenSong`**

```js
async function liteFreshenSong() {
  if (!_currentSong) return;
  const songId = _currentSong.id;
  if (!_takesUnsub || _takesSongId !== songId) startTakesListener(songId); // ensure take list is current
  liteSyncDrain(); liteLyricsDrain();
  let snap;
  try { snap = await db.collection('songs').doc(songId).get(); }
  catch (e) { return; } // offline / denied → nothing fresher
  if (!_currentSong || _currentSong.id !== songId) return; // song switched while awaiting
  const remote = (snap.exists && typeof snap.data().lyricsDoc === 'string') ? snap.data().lyricsDoc : _lyricsBase;
  if (remote === _lyricsBase) return; // no remote change
  const ed = document.getElementById('lyricsEditor'); if (!ed) return;
  const local = currentEditorHtml();
  if (local === _lyricsBase) {
    if (document.activeElement === ed) return; // don't yank the cursor mid-focus; next return/blur freshens
    ed.innerHTML = ilSanitizeDocHtml(remote); _atomizeLyricChords(); _lyricsBase = remote; _currentSong.lyricsDoc = remote;
    clearTimeout(_lyricsTimer);
  } else {
    ed.innerHTML = ilSanitizeDocHtml(local + _lyricsDivider('another device') + remote); _atomizeLyricChords();
    _lyricsBase = remote; _ilCommitDoc(currentEditorHtml(), _currentSong);
    toast('Merged lyrics from another device — review', 2600, true);
    onLyricsInput(); // schedule a save of the merged doc
  }
}
```

- [ ] **Step 3: Wire freshen into return events**

Replace the Phase-2 handlers so returning to the app runs a full freshen:
```js
window.addEventListener('online', () => { _liteUpdateOnline(); liteFreshenSong(); });
document.addEventListener('visibilitychange', () => { if (!document.hidden) liteFreshenSong(); });
window.addEventListener('focus', () => liteFreshenSong());
```
(`liteFreshenSong` internally calls `liteSyncDrain` + `liteLyricsDrain` + ensures the takes listener, so those stay covered.) Keep the boot/auth `liteSyncDrain()`/`liteLyricsDrain()` seed calls as-is.

- [ ] **Step 4: Run Task-4 + full file** → all PASS.
- [ ] **Step 5: Commit**

```bash
git add lite-1.068.html _verify_lite_1068.js
git commit -m "feat(lite-1.068): liteFreshenSong — freshen lyrics + takes on return; wire visibility/focus/online"
```

---

### Task 5: No-harm regression + real-offline integration

**Files:** Test only — `_verify_lite_1068.js`. (If an assert fails, fix the offending earlier task; don't silently patch.)

- [ ] **Step 1: Write the no-harm + integration asserts**

```js
  // No-harm: single-device edit+save inserts NO divider, exact round-trip
  const t5 = await pg.evaluate(async () => {
    _currentSong = { id: 'nh', lyricsDoc: '<div>verse one</div>' }; _lyricsBase = '<div>verse one</div>';
    document.getElementById('lyricsEditor').innerHTML = '<div>verse one</div><div>verse two</div>';
    let written = null;
    const orig = db.runTransaction.bind(db);
    db.runTransaction = async (fn) => fn({ get: async () => ({ exists: true, data: () => ({ lyricsDoc: '<div>verse one</div>' }) }), set: (ref, d) => { written = d; } });
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => true });
    await flushLyrics();
    db.runTransaction = orig;
    return { written: written && written.lyricsDoc, noDivider: written && !/Also edited|lyr-merge-divider/.test(written.lyricsDoc), base: _lyricsBase };
  });
  ok(t5.noDivider && /verse two/.test(t5.written), 'T5 no-harm: single-device save has NO divider, content intact');
  ok(t5.base === t5.written, 'T5 no-harm: base tracks the saved content');

  // No-harm: rename writes only title (merge), never touches lyrics
  const t5b = await pg.evaluate(async () => {
    _currentSong = { id: 'nh2', title: 'Old', lyricsDoc: '<div>x</div>' };
    let setData = null; const orig = db.collection.bind(db);
    db.collection = (n) => n === 'songs' ? { doc: () => ({ set: async (d) => { setData = d; } }) } : orig(n);
    window.prompt = () => 'New Title';
    await renameSongPrompt();
    db.collection = orig;
    return { keys: setData ? Object.keys(setData).sort().join(',') : '', title: setData && setData.title };
  });
  ok(t5b.title === 'New Title' && !/lyricsDoc/.test(t5b.keys), 'T5 no-harm: rename writes title only, not lyrics');

  // ── Real-offline integration (ctx.setOffline + real Firebase): offline lyric edit + remote change → reconnect merges both ──
  // Faithful test, like the 1.067 Bug-B test: guest sign-in; create+open a song ONLINE; capture base; set a known remote
  // lyricsDoc directly (db write) to simulate the "other device"; ctx.setOffline(true); edit the editor + flushLyrics (→ pending);
  // ctx.setOffline(false); poll liteLyricsDrain(); assert the server lyricsDoc ends up containing BOTH the local edit and the
  // remote text (inline-append). Skip (not fail) if anon-auth is rate-limited. Filter Firestore/WebChannel console noise.
```
Implement the real-offline block with `ctx.setOffline`, reusing the harness pattern from `_verify_lite_1067.js`. Assert the final server `lyricsDoc` (`.get({source:'server'})`) contains both sides.

- [ ] **Step 2: Run the full suite + churn check**

Run: `node _verify_lite_1068.js > /tmp/v1068.txt 2>&1; cat /tmp/v1068.txt` → all PASS.
Churn: `diff lite-1.067.html lite-1.068.html` — confirm changes are confined to: the `dhAudio*` module (v3 + pendingLyrics helpers + `_memPendingLyrics`), the lyrics block (`_lyricsBase`/`currentEditorHtml`/`_lyricsDivider`/`_maybeSeedPendingLyrics`/`flushLyrics`), `_openSongObj`, `liteLyricsDrain`/`liteFreshenSong`, the connectivity/focus handlers, and the divider CSS. Report anything outside these.

- [ ] **Step 3: Commit**

```bash
git add _verify_lite_1068.js
git commit -m "test(lite-1.068): no-harm (single-device + rename) + real-offline lyric reconcile integration"
```

---

## Self-Review

**Spec coverage:**
- `_lyricsBase` content tracking → Task 1 (+ set on open). ✓
- pendingLyrics store (additive v3 + memory fallback) + helpers → Task 1. ✓
- Inline-append divider helper + CSS + sanitize-survival check → Task 1. ✓
- Freshen-on-return (lyrics adopt/merge + takes health + drains) → Task 4. ✓
- Transactional online save-guard (merge vs clean) + offline→pending → Task 2. ✓
- Reconcile-on-reconnect (`liteLyricsDrain`, single-flight, refresh open editor) → Task 3. ✓
- Seed editor from pending on open → Task 1 (`_maybeSeedPendingLyrics`). ✓
- Data-safety invariants + no-harm (single-device no divider; rename title-only) + real-offline integration → Task 5. ✓
- Scalars untouched (rename/key/etc. not modified) — confirmed by Task 5b + no edits to those functions. ✓
- Revert-safe file copy + churn check → Task 1 Step 1 + Task 5 Step 2. ✓

**Placeholder scan:** none — every code step has complete code; commands show expected output. (The real-offline block in Task 5 is described with the exact harness to reuse from `_verify_lite_1067.js`.)

**Type/name consistency:** `_lyricsBase`, `currentEditorHtml`, `_lyricsDivider`, `_maybeSeedPendingLyrics`, `dhPendingLyricsPut/Get/All/Delete`, `_memPendingLyrics`, `liteLyricsDrain`, `_lyricsDraining`, `liteFreshenSong` used consistently. `flushLyrics`/`_openSongObj`/`_ilCommitDoc`/`ilSanitizeDocHtml`/`ilGetDocHtml`/`startTakesListener`/`_takesSongId`/`_takesUnsub` reused as-is.

## Verification note

Run `_verify_lite_1068.js` once to a file. Most asserts stub `db.runTransaction`/`db.collection`/`navigator.onLine` and need no auth; the real-offline integration block reuses the signed-in guest page and `ctx.setOffline`. Always restore stubs + reset `navigator.onLine` inside each evaluate. The `_lyricsBase`/editor comparisons rely on `ilSanitizeDocHtml` being idempotent — if a comparison flakes, sanitize both sides before comparing.
