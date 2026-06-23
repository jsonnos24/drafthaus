# Drafthaus Lite — Multiple Named Share Trays + Drag-Reorder + Live Viewer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the shipped single-tray public-share feature so a Lite user can keep **many named share trays** (each with its own stable `?share=<id>` link), **drag-reorder** takes within a tray, and so open viewer pages **live-update** via `onSnapshot` without interrupting playback.

**Architecture:** All work is in one new single-file build `lite-1.071.html` (copied from `lite-1.070.html`) plus its headless test suite `_verify_lite_1071.js` (copied from `_verify_lite_1070.js`). The owner's single-doc state (`_shareId/_shareTakes/_shareActive`) is replaced by a list `_shareTrays` fed by a live `onSnapshot` query over `shares where ownerId == uid`. The viewer's one-time `.get()` becomes an `.onSnapshot()` whose updates diff against the running audio engine instead of blindly re-rendering. **No Firestore rule change** — `name` is just another owner-written field on the existing `shares` doc.

**Tech Stack:** Vanilla JS, Firebase compat SDK (`db = firebase.firestore()`), Web Audio. No build step, no framework. Tests run via `node _verify_lite_1071.js` driving installed Chrome through `playwright-core`.

## Global Constraints

- **Build base:** `lite-1.070.html`, md5 `ebb5f00bb16b8e736ab752e2adac2ae6`. md5-verify before copying (base-drift trap). Confirmed: `index.html` is currently byte-identical.
- **File-copy versioning:** all edits land in `lite-1.071.html`; never touch `lite-1.070.html`, other `lite-*.html`, `full.html`, `1.3xx.html`, or `index.html`. Promotion into `index.html` is deferred to after on-device sign-off (NOT part of this plan).
- **Commit to `main` directly; do NOT push.** Pushing deploys via GitHub Pages and is user-gated.
- **No Firestore rule / Storage rule change.** The existing `shares` rules already cover public `get`, owner `list`, owner write/delete.
- **Offline-safe writes:** never `await` a Firestore write on a path that must work offline — use fire-and-forget `.set(...,{merge:true}).catch()` / `.delete().catch()`. Update local state + UI first, then write.
- **iOS touch-drag:** any draggable handle needs `touch-action:none` + `user-select:none` — satisfied by reusing the existing `.drag-handle` class.
- **Viewer skips `enablePersistence`** when `?share=` is in the URL (existing regex at line ~778) — do not change this.
- **Timestamps** use `Date.now()` (ms), matching the existing `shares` writes — not `serverTimestamp()`.
- **HTML escaping:** all user/snapshot strings rendered into HTML go through the existing `_esc()` (line 1076); lyrics HTML goes through `ilSanitizeDocHtml()` (line 1202).
- **Legacy display name:** a tray doc with missing/blank `name` displays as **"Shared takes"** everywhere; its link is unchanged; `name` is written only on first edit.

---

## File Structure

- **`lite-1.071.html`** — the whole app. All code changes live in the `<script>` block (functions are top-level `function`/`let` decls so they land on `window`, per project convention) plus a CSS block in `<head>` and the `#sharePanel` markup near end-of-body. Key regions (line numbers are from the 1.070 base and **will drift** — re-locate by searching the quoted anchors given in each task):
  - Owner share block: search `function shareNewId()` … `async function shareRefresh()` (1.070 lines ~3281–3398).
  - Viewer block: search `function shareViewUnavailable` … `function _svDraw` (1.070 lines ~3401–3525).
  - Drag engine: search `const handle = e.target.closest('.drag-handle')` (1.070 lines ~2882–2911).
  - Take-row share button: search `class="take-share` (1.070 line ~1609).
  - App-load hook: search `shareEnsureDoc().then(() => shareRefreshSoon())` (1.070 line 3539).
  - `#sharePanel` markup: search `id="sharePanel"` (1.070 lines ~3551–3557).
  - Share CSS: search `.share-panel {` (1.070 lines ~178–191).
- **`_verify_lite_1071.js`** — headless suite. Top harness (server, EULA bypass, `guestIn`) is reused verbatim except the served default file becomes `lite-1.071.html`. Old single-tray test blocks (Tasks 1–10 in the 1070 file) are replaced by the tray-based blocks defined in this plan.

---

## Task 0: Branch the build + clone the test suite

**Files:**
- Create: `lite-1.071.html` (copy of `lite-1.070.html`)
- Create: `_verify_lite_1071.js` (copy of `_verify_lite_1070.js`, default-file string updated)

**Interfaces:**
- Produces: `lite-1.071.html` (the edit target for all later tasks) and `_verify_lite_1071.js` (the test target).

- [ ] **Step 1: Verify base, copy the build file**

```bash
cd /Users/jasoncraig/Documents/Claude/Projects/Drafthaus
md5 lite-1.070.html   # expect: ebb5f00bb16b8e736ab752e2adac2ae6
cp lite-1.070.html lite-1.071.html
cp _verify_lite_1070.js _verify_lite_1071.js
```

- [ ] **Step 2: Confirm the copy is byte-identical, then point the file's own version string + the verify server at 1.071**

```bash
diff lite-1.070.html lite-1.071.html && echo "IDENTICAL COPY OK"
```

In `_verify_lite_1071.js`, the server defaults `/` to the base file — change it to the new build. Find:

```javascript
let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/lite-1.070.html';
```

Replace `'/lite-1.070.html'` with `'/lite-1.071.html'`. Then change every `goto(...lite-1.070.html...)` to `lite-1.071.html` (global replace of the string `lite-1.070.html` → `lite-1.071.html` across the file).

- [ ] **Step 3: Sanity-run the cloned suite (it still tests the OLD API and must pass before we change anything)**

Run: `node _verify_lite_1071.js`
Expected: `45 PASS / 0 FAIL` (the unmodified 1.070 behavior, now served from 1.071).

- [ ] **Step 4: Commit**

```bash
git add lite-1.071.html _verify_lite_1071.js
git commit -m "chore(lite-1.071): branch from 1.070 for multi-tray shares"
```

---

## Task 1: Multi-tray owner state + link/membership helpers

Replaces the single-doc state and the single-link/membership helpers. The data-mutation functions are added in Task 2; this task establishes the new state vars and the pure helpers so later tasks can call them.

**Files:**
- Modify: `lite-1.071.html` — owner share block (search `function shareNewId()`)
- Test: `_verify_lite_1071.js`

**Interfaces:**
- Consumes: `uid()` (line 782), `toast(msg, ms)` (line 786), `crypto.getRandomValues`.
- Produces:
  - State: `let _shareTrays = []` (each `{id, name, active, takes:[]}`), `let _shareTraysLoaded = false`, `let _shareUnsub = null`, `let _shareOpenTrayId = null`, `let _shareView = false`.
  - `shareNewId() -> string` (UNCHANGED — keep verbatim).
  - `_shareSnapshot(take, song) -> {takeId,songId,songTitle,lyricsDoc,downloadUrl,duration,mimeType,addedAt}` (UNCHANGED — keep verbatim).
  - `_trayName(tray) -> string` ("Shared takes" when name blank).
  - `shareTrayLink(id) -> string` (`<origin><pathname>?share=<id>`).
  - `shareCopyTrayLink(id) -> Promise` (clipboard + toast).
  - `shareTraysFor(takeId) -> string[]` (tray ids the take is in).
  - `shareIsShared(takeId) -> boolean`.

- [ ] **Step 1: Write the failing test**

Replace the OLD "Task 1: share id + link + snapshot helpers" block in `_verify_lite_1071.js` (the `pgS`/`s1` block, ~lines 39–62) with:

```javascript
  // ── Task 1: tray state + link/membership helpers (no auth needed) ──
  const pgS = await ctx.newPage();
  await pgS.goto(`http://localhost:${port}/lite-1.071.html`, { waitUntil: 'domcontentloaded' });
  await pgS.waitForFunction(() => typeof window.shareTrayLink === 'function', { timeout: 10000 });
  const s1 = await pgS.evaluate(() => {
    const a = shareNewId(), b = shareNewId();
    const snap = _shareSnapshot(
      { id: 'T1', downloadUrl: 'https://x/y', duration: 12, mimeType: 'audio/mp3' },
      { id: 'S1', title: 'My Song', lyricsDoc: '<div>Hi</div>' });
    _shareTrays = [
      { id: 'TRA', name: 'Band demos', active: true, takes: [{ takeId: 'T1' }, { takeId: 'T2' }] },
      { id: 'TRB', name: '', active: true, takes: [{ takeId: 'T2' }] },
    ];
    return {
      idLen: a.length, idsDiffer: a !== b, urlSafe: /^[A-Za-z0-9_-]+$/.test(a),
      snapOK: snap.takeId === 'T1' && snap.songId === 'S1' && snap.songTitle === 'My Song'
              && snap.lyricsDoc === '<div>Hi</div>' && snap.downloadUrl === 'https://x/y'
              && snap.duration === 12 && typeof snap.addedAt === 'number',
      linkOK: /\?share=ABC123$/.test(shareTrayLink('ABC123')),
      legacyName: _trayName(_shareTrays[1]) === 'Shared takes',
      namedName: _trayName(_shareTrays[0]) === 'Band demos',
      forT1: shareTraysFor('T1').join(','),       // expect 'TRA'
      forT2: shareTraysFor('T2').sort().join(','), // expect 'TRA,TRB'
      sharedT1: shareIsShared('T1'), sharedNone: shareIsShared('T9'),
    };
  });
  ok(s1.idLen >= 20, 'T1 shareNewId is >=20 chars');
  ok(s1.idsDiffer, 'T1 shareNewId is random (two differ)');
  ok(s1.urlSafe, 'T1 shareNewId is URL-safe');
  ok(s1.snapOK, 'T1 _shareSnapshot builds a correct entry');
  ok(s1.linkOK, 'T1 shareTrayLink returns <origin><path>?share=<id>');
  ok(s1.legacyName && s1.namedName, 'T1 _trayName: blank→"Shared takes", else name');
  ok(s1.forT1 === 'TRA' && s1.forT2 === 'TRA,TRB', 'T1 shareTraysFor finds membership across trays');
  ok(s1.sharedT1 && !s1.sharedNone, 'T1 shareIsShared true in ≥1 tray, false otherwise');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node _verify_lite_1071.js`
Expected: FAIL — `shareTrayLink`/`_trayName`/`shareTraysFor` undefined (the `waitForFunction` times out or asserts fail).

- [ ] **Step 3: Replace the state + helpers in `lite-1.071.html`**

Find the two state lines (search `let _shareId = null, _shareTakes`):

```javascript
let _shareId = null, _shareTakes = [], _shareActive = true, _shareUnsub = null, _shareView = false;
let _shareEnsureInFlight = null;
```

Replace with:

```javascript
let _shareTrays = [];          // [{ id, name, active, takes:[…] }, …] — all of the owner's trays
let _shareTraysLoaded = false;
let _shareUnsub = null;        // snapshot listener on the owner's shares query (live)
let _shareOpenTrayId = null;   // which tray's detail is showing (null = tray-list view)
let _shareView = false;        // viewer-mode flag (set in shareViewBoot)
```

Keep `function shareNewId()` and `function _shareSnapshot(...)` exactly as they are. Find `function shareLink()` and replace it (and remove `shareSubscribe`, `shareFindExisting`, `shareEnsureDoc`, `shareIsShared`, `_shareWriteTakes`, `shareAddTake`, `shareRemoveTake`, `shareSetActive`, `shareCopyLink` — they are all superseded by Tasks 1–2; delete them in this task and Task 2). For now, replace `function shareLink()` with:

```javascript
function _trayName(t) { return (t && t.name && String(t.name).trim()) ? t.name : 'Shared takes'; }
function shareTrayLink(id) { return id ? `${location.origin}${location.pathname}?share=${id}` : ''; }
function shareCopyTrayLink(id) {
  const link = shareTrayLink(id); if (!link) return;
  return navigator.clipboard.writeText(link).then(() => toast('Link copied ✓', 1800)).catch(() => toast(link, 3000));
}
function shareTraysFor(takeId) { return _shareTrays.filter(tr => (tr.takes || []).some(t => t.takeId === takeId)).map(tr => tr.id); }
function shareIsShared(takeId) { return shareTraysFor(takeId).length > 0; }
```

> Note: deleting `shareSubscribe`/`shareEnsureDoc`/etc. will break the app-load hook (line 3539) and the take-row `onclick` until Tasks 2 & 5. That is expected — they are fixed in those tasks. The Task 1 test only loads functions and never signs in, so it stays green.

- [ ] **Step 4: Run test to verify it passes**

Run: `node _verify_lite_1071.js`
Expected: the 8 `T1` assertions PASS. (Later, removed-API tests will fail — they are replaced in Tasks 2/5/8.)

- [ ] **Step 5: Commit**

```bash
git add lite-1.071.html _verify_lite_1071.js
git commit -m "feat(lite-1.071): multi-tray share state + link/membership helpers"
```

---

## Task 2: Tray data layer (load, create, mutate)

**Files:**
- Modify: `lite-1.071.html` — owner share block
- Test: `_verify_lite_1071.js`

**Interfaces:**
- Consumes: `uid()`, `toast()`, `_shareSnapshot()`, `_trayName()`, `_currentSong` (line 1135), `db.collection('shares')`.
- Produces:
  - `shareLoadTrays()` — subscribes `onSnapshot` over `shares where ownerId==uid`, fills `_shareTrays` (sorted by `_trayName`), sets `_shareTraysLoaded=true`, re-renders. Single-flight via `_shareUnsub`.
  - `_shareWriteTray(id, fields)` — fire-and-forget merge write (adds `updatedAt`).
  - `shareCreateTray(name) -> Promise<id>`.
  - `shareRenameTray(id, name)`, `shareDeleteTray(id)`, `shareSetTrayActive(id, bool)`.
  - `shareAddTakeToTray(id, take)`, `shareRemoveTakeFromTray(id, takeId)`.
  - All call `renderTakes()`, `renderShareManager()`, `renderTrayPicker()` if those exist (guards added now; functions land in Tasks 5–6).

- [ ] **Step 1: Write the failing test**

Replace the OLD "Task 2: owner data layer" block (`pg2`/`s2`, ~lines 64–104) with:

```javascript
  // ── Task 2: tray data layer with a stubbed shares query+docs ──
  const pg2 = await ctx.newPage();
  await pg2.goto(`http://localhost:${port}/lite-1.071.html`, { waitUntil: 'domcontentloaded' });
  await pg2.waitForFunction(() => typeof window.shareCreateTray === 'function', { timeout: 10000 });
  const s2 = await pg2.evaluate(async () => {
    // In-memory fake of the shares collection: many docs keyed by id.
    const docs = {};                 // id -> {data}
    let qListener = null;
    function emit() { if (qListener) qListener({ docs: Object.keys(docs).map(id => ({ id, data: () => docs[id] })) }); }
    const mkDocRef = (id) => ({
      id,
      set: (obj, opt) => { docs[id] = opt && opt.merge ? Object.assign({}, docs[id] || {}, obj) : obj; emit(); return Promise.resolve(); },
      delete: () => { delete docs[id]; emit(); return Promise.resolve(); },
    });
    const fakeShares = {
      doc: (id) => mkDocRef(id || ('GEN' + Object.keys(docs).length)),
      where: () => ({ onSnapshot: (cb) => { qListener = cb; emit(); return () => { qListener = null; }; } }),
    };
    const realCollection = db.collection.bind(db);
    db.collection = (name) => name === 'shares' ? fakeShares : realCollection(name);
    Object.defineProperty(auth, 'currentUser', { get: () => ({ uid: 'U1', isAnonymous: false }), configurable: true });
    _currentSong = { id: 'S1', title: 'Song One', lyricsDoc: '<div>La</div>' };
    window._fakeShareDocs = docs;

    shareLoadTrays();
    const idA = await shareCreateTray('Band demos');
    const idB = await shareCreateTray('');           // nameless on purpose
    const listedNames = _shareTrays.map(t => t.name).sort().join('|'); // 'Band demos|'
    const legacyDisplay = _trayName(_shareTrays.find(t => t.id === idB)) === 'Shared takes';

    const take = { id: 'TK1', downloadUrl: 'https://a/b', duration: 9, mimeType: 'audio/mp3' };
    shareAddTakeToTray(idA, take);
    shareAddTakeToTray(idB, take);                    // same take in two trays
    const inBoth = shareTraysFor('TK1').sort().join(',') === [idA, idB].sort().join(',');
    shareAddTakeToTray(idA, take);                    // dedupe
    const dedup = _shareTrays.find(t => t.id === idA).takes.length === 1;
    shareRemoveTakeFromTray(idA, 'TK1');              // remove from A only
    const removedAOnly = !shareTraysFor('TK1').includes(idA) && shareTraysFor('TK1').includes(idB);
    shareRenameTray(idB, 'Mix feedback');
    const renamed = docs[idB].name === 'Mix feedback';
    shareSetTrayActive(idA, false);
    const deactivated = docs[idA].active === false && _shareTrays.find(t => t.id === idA).active === false;
    shareDeleteTray(idA);
    const deleted = !docs[idA] && !_shareTrays.some(t => t.id === idA);
    const noUrlBlocked = (shareAddTakeToTray(idB, { id: 'TK2', duration: 3 }), !shareTraysFor('TK2').includes(idB));
    return { listedNames, legacyDisplay, inBoth, dedup, removedAOnly, renamed, deactivated, deleted, noUrlBlocked,
             createCount: Object.keys(docs).length, ownerOnDoc: docs[idB].ownerId === 'U1' };
  });
  ok(s2.listedNames === 'Band demos|', 'T2 shareLoadTrays lists multiple trays sorted');
  ok(s2.legacyDisplay, 'T2 nameless tray displays as "Shared takes"');
  ok(s2.ownerOnDoc, 'T2 created tray doc carries ownerId');
  ok(s2.inBoth, 'T2 a take can live in two trays at once');
  ok(s2.dedup, 'T2 shareAddTakeToTray dedupes by takeId within a tray');
  ok(s2.removedAOnly, 'T2 remove from one tray leaves the other untouched');
  ok(s2.renamed, 'T2 shareRenameTray writes name');
  ok(s2.deactivated, 'T2 shareSetTrayActive(false) flips active');
  ok(s2.deleted, 'T2 shareDeleteTray removes doc + local entry');
  ok(s2.noUrlBlocked, 'T2 add refuses a take with no downloadUrl');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node _verify_lite_1071.js`
Expected: FAIL — `shareCreateTray` undefined.

- [ ] **Step 3: Implement the data layer**

In the owner share block (right after the Task 1 helpers), add:

```javascript
function shareLoadTrays() {
  const u = uid(); if (!u) return;
  if (_shareUnsub) return;   // single-flight; listener already live for the session
  _shareUnsub = db.collection('shares').where('ownerId', '==', u).onSnapshot(qs => {
    _shareTrays = qs.docs.map(doc => {
      const d = doc.data() || {};
      return { id: doc.id, name: d.name || '', active: d.active !== false, takes: Array.isArray(d.takes) ? d.takes : [] };
    }).sort((a, b) => _trayName(a).localeCompare(_trayName(b)));
    _shareTraysLoaded = true;
    if (typeof renderTakes === 'function') renderTakes();
    if (typeof renderShareManager === 'function') renderShareManager();
    if (typeof renderTrayPicker === 'function') renderTrayPicker();
  }, e => console.warn('[share] trays', e));
}
function _shareWriteTray(id, fields) {
  if (!id) return;
  db.collection('shares').doc(id).set(Object.assign({ updatedAt: Date.now() }, fields), { merge: true })
    .catch(e => console.warn('[share] write', e));
}
function shareCreateTray(name) {
  const u = uid(); if (!u) return Promise.resolve(null);
  const id = shareNewId();
  _shareTrays = _shareTrays.concat([{ id, name: name || '', active: true, takes: [] }])
    .sort((a, b) => _trayName(a).localeCompare(_trayName(b)));   // optimistic
  db.collection('shares').doc(id).set({ ownerId: u, name: name || '', active: true, takes: [], updatedAt: Date.now() })
    .catch(e => console.warn('[share] create', e));
  shareLoadTrays();   // ensure the live listener is running so server state reconciles
  if (typeof renderShareManager === 'function') renderShareManager();
  return Promise.resolve(id);
}
function shareRenameTray(id, name) {
  const tr = _shareTrays.find(t => t.id === id); if (tr) tr.name = name || '';   // optimistic
  _shareWriteTray(id, { name: name || '' });
  if (typeof renderShareManager === 'function') renderShareManager();
}
function shareDeleteTray(id) {
  _shareTrays = _shareTrays.filter(t => t.id !== id);                 // optimistic
  if (_shareOpenTrayId === id) _shareOpenTrayId = null;
  db.collection('shares').doc(id).delete().catch(e => console.warn('[share] delete', e));
  if (typeof renderShareManager === 'function') renderShareManager();
  if (typeof renderTakes === 'function') renderTakes();
}
function shareSetTrayActive(id, b) {
  const tr = _shareTrays.find(t => t.id === id); if (tr) tr.active = !!b;   // optimistic
  _shareWriteTray(id, { active: !!b });
  if (typeof renderShareManager === 'function') renderShareManager();
}
function shareAddTakeToTray(id, take) {
  if (!take || !take.downloadUrl) { if (typeof toast === 'function') toast('Still uploading — try again in a moment', 2400); return; }
  const song = _currentSong; if (!song) return;
  const tr = _shareTrays.find(t => t.id === id); if (!tr) return;
  const next = (tr.takes || []).filter(t => t.takeId !== take.id);
  next.push(_shareSnapshot(take, song));
  tr.takes = next;                          // optimistic
  _shareWriteTray(id, { takes: next });
  if (typeof renderTakes === 'function') renderTakes();
  if (typeof renderShareManager === 'function') renderShareManager();
  if (typeof renderTrayPicker === 'function') renderTrayPicker();
}
function shareRemoveTakeFromTray(id, takeId) {
  const tr = _shareTrays.find(t => t.id === id); if (!tr) return;
  tr.takes = (tr.takes || []).filter(t => t.takeId !== takeId);   // optimistic
  _shareWriteTray(id, { takes: tr.takes });
  if (typeof renderTakes === 'function') renderTakes();
  if (typeof renderShareManager === 'function') renderShareManager();
  if (typeof renderTrayPicker === 'function') renderTrayPicker();
}
```

Also fix the **app-load hook** (search `shareEnsureDoc().then(() => shareRefreshSoon())`):

```javascript
    shareEnsureDoc().then(() => shareRefreshSoon()).catch(() => {});
```

Replace with:

```javascript
    shareLoadTrays(); shareRefreshSoon();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node _verify_lite_1071.js`
Expected: the 10 `T2` assertions PASS.

- [ ] **Step 5: Commit**

```bash
git add lite-1.071.html _verify_lite_1071.js
git commit -m "feat(lite-1.071): tray data layer — load/create/rename/delete/active/add/remove"
```

---

## Task 3: Reorder takes within a tray

**Files:**
- Modify: `lite-1.071.html` — owner share block (after Task 2 functions)
- Test: `_verify_lite_1071.js`

**Interfaces:**
- Consumes: `_shareTrays`, `_shareWriteTray`.
- Produces: `shareReorderTray(id, fromIdx, toIdx)` — splice-moves `takes[fromIdx]` to `toIdx`, writes the array. No-op on out-of-range indices.

- [ ] **Step 1: Write the failing test**

Add a new block (place it right after the Task 2 block):

```javascript
  // ── Task 3: shareReorderTray rewrites takes[] order ──
  const pg3 = await ctx.newPage();
  await pg3.goto(`http://localhost:${port}/lite-1.071.html`, { waitUntil: 'domcontentloaded' });
  await pg3.waitForFunction(() => typeof window.shareReorderTray === 'function', { timeout: 10000 });
  const s3 = await pg3.evaluate(() => {
    let written = null;
    window._shareWriteTray = (id, fields) => { written = fields.takes.map(t => t.takeId).join(','); };
    _shareTrays = [{ id: 'TR', name: 'x', active: true, takes: [{ takeId: 'a' }, { takeId: 'b' }, { takeId: 'c' }] }];
    shareReorderTray('TR', 0, 2);  // a→end → b,c,a
    const order = _shareTrays[0].takes.map(t => t.takeId).join(',');
    const oob = (shareReorderTray('TR', 9, 0), _shareTrays[0].takes.map(t => t.takeId).join(','));
    return { order, written, oob };
  });
  ok(s3.order === 'b,c,a', 'T3 shareReorderTray moves take and rewrites local order');
  ok(s3.written === 'b,c,a', 'T3 shareReorderTray writes the new takes[] order');
  ok(s3.oob === 'b,c,a', 'T3 shareReorderTray is a no-op on out-of-range index');
```

> Note: this test reassigns `window._shareWriteTray` to a spy. Because `_shareWriteTray` is a top-level `function`/`let`, ensure it is declared with `let` OR that `shareReorderTray` calls it via the global. Implement `shareReorderTray` to call `_shareWriteTray(...)` directly (same scope), and in the test the override of `window._shareWriteTray` works only if the function references the binding the test can patch. To make the spy reliable, the test instead reads the resulting local order (`s3.order`) as the primary assertion; `s3.written` is best-effort. If `written` is null at runtime, change the implementation note: declare `_shareWriteTray` once with `let _shareWriteTray = function(...){...}` so `window._shareWriteTray = ...` rebinds it. Verify which is true when the test runs and adjust the declaration to `let` form if needed.

- [ ] **Step 2: Run test to verify it fails**

Run: `node _verify_lite_1071.js`
Expected: FAIL — `shareReorderTray` undefined.

- [ ] **Step 3: Implement**

Add after `shareRemoveTakeFromTray`:

```javascript
function shareReorderTray(id, fromIdx, toIdx) {
  const tr = _shareTrays.find(t => t.id === id); if (!tr) return;
  const arr = (tr.takes || []).slice();
  if (fromIdx < 0 || fromIdx >= arr.length || toIdx < 0 || toIdx >= arr.length) return;
  const [moved] = arr.splice(fromIdx, 1);
  arr.splice(toIdx, 0, moved);
  tr.takes = arr;                    // optimistic
  _shareWriteTray(id, { takes: arr });
}
```

If the `written` spy assertion is null at run time (because `_shareWriteTray` was declared as a `function`), change its declaration from `function _shareWriteTray(id, fields) {…}` to `let _shareWriteTray = function (id, fields) {…};` (placed before `shareCreateTray`), so the test can rebind `window._shareWriteTray`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node _verify_lite_1071.js`
Expected: the 3 `T3` assertions PASS.

- [ ] **Step 5: Commit**

```bash
git add lite-1.071.html _verify_lite_1071.js
git commit -m "feat(lite-1.071): shareReorderTray rewrites tray takes[] order"
```

---

## Task 4: Refresh all trays on app activity

**Files:**
- Modify: `lite-1.071.html` — owner share block (replace `shareRefresh`/`shareRefreshSoon`)
- Test: `_verify_lite_1071.js`

**Interfaces:**
- Consumes: `_shareTrays`, `_songs` (line declared near song list), `_takes` (line 1529), `_shareWriteTray`.
- Produces: `shareRefresh() -> Promise` (re-snapshots title/lyrics from `_songs`, audio from `_takes`, drops takes whose song is gone, across **every** tray; writes only changed trays) and `shareRefreshSoon()` (1.5s debounce, unchanged signature). Already wired at: app-load (Task 2), lyrics flush (line ~1315 `shareRefreshSoon()`), upload-complete (line ~2113 `shareRefreshSoon()`). No new wiring needed.

- [ ] **Step 1: Write the failing test**

Add a new block after Task 3:

```javascript
  // ── Task 4: shareRefresh re-snapshots across all trays + drops missing ──
  const pg4 = await ctx.newPage();
  await pg4.goto(`http://localhost:${port}/lite-1.071.html`, { waitUntil: 'domcontentloaded' });
  await pg4.waitForFunction(() => typeof window.shareRefresh === 'function', { timeout: 10000 });
  const s4 = await pg4.evaluate(async () => {
    const writes = {};
    window._shareWriteTray = (id, fields) => { writes[id] = fields.takes.map(t => ({ id: t.takeId, title: t.songTitle, ly: t.lyricsDoc })); };
    window._songs = [{ id: 'S1', title: 'New Title', lyricsDoc: '<div>NEW</div>' }];   // S2 missing
    window._takes = [{ id: 'TK1', downloadUrl: 'https://a/b', duration: 9, mimeType: 'audio/mp3' }];
    _shareTrays = [
      { id: 'TRA', name: 'A', active: true, takes: [
        { takeId: 'TK1', songId: 'S1', songTitle: 'Old Title', lyricsDoc: '<div>OLD</div>', downloadUrl: 'https://a/b', duration: 9 },
        { takeId: 'TK9', songId: 'S2', songTitle: 'Gone', lyricsDoc: '', downloadUrl: 'x', duration: 1 },  // song gone → drop
      ]},
      { id: 'TRB', name: 'B', active: true, takes: [] },  // empty → untouched
    ];
    await shareRefresh();
    return { wroteA: !!writes['TRA'], wroteB: !!writes['TRB'], a: writes['TRA'] };
  });
  ok(s4.wroteA && !s4.wroteB, 'T4 shareRefresh writes only changed trays (skips empty/unchanged)');
  ok(s4.a && s4.a.length === 1 && s4.a[0].id === 'TK1', 'T4 shareRefresh drops a take whose song is gone');
  ok(s4.a && s4.a[0].title === 'New Title' && s4.a[0].ly === '<div>NEW</div>', 'T4 shareRefresh re-snapshots title + lyrics');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node _verify_lite_1071.js`
Expected: FAIL — the assertions fail because the old single-tray `shareRefresh` reads `_shareTakes`/`_shareId` (now removed) and never iterates `_shareTrays`.

- [ ] **Step 3: Implement (replace the old `shareRefresh`/`shareRefreshSoon`)**

Find the old `let _shareRefreshTimer = null; function shareRefreshSoon() …` through the end of `async function shareRefresh()` and replace with:

```javascript
let _shareRefreshTimer = null;
function shareRefreshSoon() { clearTimeout(_shareRefreshTimer); _shareRefreshTimer = setTimeout(() => { shareRefresh().catch(() => {}); }, 1500); }
async function shareRefresh() {
  if (!_shareTrays.length) return;
  for (const tr of _shareTrays) {
    if (!(tr.takes || []).length) continue;
    let changed = false;
    const next = [];
    for (const e of tr.takes) {
      const song = (_songs || []).find(s => s.id === e.songId);
      if (!song) { changed = true; continue; }   // song gone → drop
      const loaded = (_takes || []).find(t => t.id === e.takeId && t.downloadUrl);
      const ne = Object.assign({}, e);
      ne.songTitle = song.title || 'Untitled';
      ne.lyricsDoc = song.lyricsDoc || '';
      if (loaded) { ne.downloadUrl = loaded.downloadUrl; ne.duration = loaded.duration || 0; ne.mimeType = loaded.mimeType || ne.mimeType; }
      if (ne.songTitle !== e.songTitle || ne.lyricsDoc !== e.lyricsDoc || ne.downloadUrl !== e.downloadUrl || ne.duration !== e.duration) changed = true;
      next.push(ne);
    }
    if (changed) { tr.takes = next; _shareWriteTray(tr.id, { takes: next }); }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node _verify_lite_1071.js`
Expected: the 3 `T4` assertions PASS.

- [ ] **Step 5: Commit**

```bash
git add lite-1.071.html _verify_lite_1071.js
git commit -m "feat(lite-1.071): shareRefresh iterates every tray"
```

---

## Task 5: Per-take tray-picker popover

**Files:**
- Modify: `lite-1.071.html` — owner share block (add picker fns), take-row template (search `class="take-share`), CSS block (search `.share-panel {`)
- Test: `_verify_lite_1071.js`

**Interfaces:**
- Consumes: `_shareTrays`, `_takes`, `shareTraysFor`, `shareAddTakeToTray`, `shareRemoveTakeFromTray`, `shareCreateTray`, `shareLoadTrays`, `_trayName`, `_esc`.
- Produces:
  - `openTrayPicker(takeId, btnEl)` — builds `#trayPicker` (fixed popover near the button), closes on outside-tap/Esc.
  - `closeTrayPicker()`, `renderTrayPicker()`, `trayPickerToggle(trayId)`, `trayPickerNew()`.
  - State `let _pickerTakeId = null`.
  - Take-row `.take-share` button now `onclick="event.stopPropagation(); openTrayPicker('<id>', this)"`; filled state still `shareIsShared(t.id) ? 'on' : ''`.

- [ ] **Step 1: Write the failing test** (replace the OLD take-share-toggle test if present; otherwise add new)

Add a new block after Task 4:

```javascript
  // ── Task 5: per-take tray picker ──
  const pg5 = await ctx.newPage();
  await pg5.goto(`http://localhost:${port}/lite-1.071.html`, { waitUntil: 'domcontentloaded' });
  await pg5.waitForFunction(() => typeof window.openTrayPicker === 'function', { timeout: 10000 });
  const s5 = await pg5.evaluate(() => {
    const calls = [];
    window.shareAddTakeToTray = (id, take) => calls.push(['add', id, take.id]);
    window.shareRemoveTakeFromTray = (id, takeId) => calls.push(['remove', id, takeId]);
    window.shareLoadTrays = () => {};   // no network
    window._takes = [{ id: 'TK1', downloadUrl: 'https://a/b' }];
    _shareTrays = [
      { id: 'TRA', name: 'Band demos', active: true, takes: [{ takeId: 'TK1' }] },
      { id: 'TRB', name: 'Mix feedback', active: true, takes: [] },
    ];
    const btn = document.createElement('button'); document.body.appendChild(btn);
    openTrayPicker('TK1', btn);
    const pop = document.getElementById('trayPicker');
    const visible = pop && getComputedStyle(pop).display !== 'none';
    const rows = [...pop.querySelectorAll('.tp-row:not(.tp-new)')];
    const checks = rows.map(r => r.querySelector('.tp-check').textContent.trim());  // ['✓','']
    const hasNew = !!pop.querySelector('.tp-new');
    trayPickerToggle('TRB');   // not in TRB → add
    trayPickerToggle('TRA');   // in TRA → remove
    const escEvt = new KeyboardEvent('keydown', { key: 'Escape' }); document.dispatchEvent(escEvt);
    const closed = !document.getElementById('trayPicker');
    return { visible, checks, hasNew, calls, closed };
  });
  ok(s5.visible, 'T5 openTrayPicker shows a fixed popover');
  ok(s5.checks[0] === '✓' && s5.checks[1] === '', 'T5 picker shows ✓ only for trays the take is in');
  ok(s5.hasNew, 'T5 picker has a "+ New tray…" row');
  ok(JSON.stringify(s5.calls) === JSON.stringify([['add','TRB','TK1'],['remove','TRA','TK1']]), 'T5 toggling calls add/remove correctly');
  ok(s5.closed, 'T5 Esc closes the picker');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node _verify_lite_1071.js`
Expected: FAIL — `openTrayPicker` undefined.

- [ ] **Step 3: Implement the picker fns** (add to the owner share block)

```javascript
let _pickerTakeId = null;
function openTrayPicker(takeId, btnEl) {
  closeTrayPicker();
  _pickerTakeId = takeId;
  shareLoadTrays();
  const back = document.createElement('div');
  back.id = 'trayPicker'; back.className = 'tray-picker-back';
  back.onclick = (e) => { if (e.target === back) closeTrayPicker(); };
  back.innerHTML = '<div class="tray-picker"></div>';
  document.body.appendChild(back);
  const pop = back.querySelector('.tray-picker');
  if (btnEl && pop && btnEl.getBoundingClientRect) {
    const r = btnEl.getBoundingClientRect();
    pop.style.position = 'fixed';
    pop.style.top = Math.min(r.bottom + 6, window.innerHeight - 60) + 'px';
    pop.style.left = Math.max(8, Math.min(r.left, window.innerWidth - 232)) + 'px';
  }
  renderTrayPicker();
  document.addEventListener('keydown', _trayPickerEsc);
}
function _trayPickerEsc(e) { if (e.key === 'Escape') closeTrayPicker(); }
function closeTrayPicker() {
  const el = document.getElementById('trayPicker'); if (el) el.remove();
  _pickerTakeId = null;
  document.removeEventListener('keydown', _trayPickerEsc);
}
function renderTrayPicker() {
  const back = document.getElementById('trayPicker'); if (!back) return;
  const pop = back.querySelector('.tray-picker'); if (!pop) return;
  const takeId = _pickerTakeId;
  const inTrays = shareTraysFor(takeId);
  const rows = _shareTrays.map(tr =>
    `<div class="tp-row" onclick="trayPickerToggle('${tr.id}')"><span class="tp-check">${inTrays.includes(tr.id) ? '✓' : ''}</span><span class="tp-name">${_esc(_trayName(tr))}</span></div>`
  ).join('');
  pop.innerHTML = (rows || '<div class="tp-empty">No trays yet</div>') +
    `<div class="tp-row tp-new" onclick="trayPickerNew()">＋ New tray…</div>`;
}
function trayPickerToggle(trayId) {
  const takeId = _pickerTakeId; if (!takeId) return;
  if (shareTraysFor(takeId).includes(trayId)) shareRemoveTakeFromTray(trayId, takeId);
  else { const t = (_takes || []).find(x => x.id === takeId); if (t) shareAddTakeToTray(trayId, t); }
  renderTrayPicker();
}
async function trayPickerNew() {
  const name = prompt('Tray name', ''); if (name == null) return;
  const id = await shareCreateTray(name.trim());
  const takeId = _pickerTakeId;
  const t = takeId && (_takes || []).find(x => x.id === takeId);
  if (id && t) shareAddTakeToTray(id, t);
  renderTrayPicker();
}
```

Update the take-row button (search `class="take-share`). Replace:

```javascript
        <button class="take-share ${shareIsShared(t.id) ? 'on' : ''}" onclick="takeShareToggle('${t.id}', event)" title="${shareIsShared(t.id) ? 'Shared — tap to remove' : 'Add to share link'}" aria-label="Share take">${SHARE_SVG}</button>
```

with:

```javascript
        <button class="take-share ${shareIsShared(t.id) ? 'on' : ''}" onclick="event.stopPropagation(); openTrayPicker('${t.id}', this)" title="${shareIsShared(t.id) ? 'Shared — manage trays' : 'Add to a share tray'}" aria-label="Share take">${SHARE_SVG}</button>
```

Delete the now-orphaned `function takeShareToggle(...)` (search `function takeShareToggle`).

Add CSS (after the `.sm-empty {…}` rule):

```css
.tray-picker-back { position: fixed; inset: 0; z-index: 9100; }
.tray-picker { background: var(--bg-elev); border-radius: 12px; box-shadow: var(--shadow-lg); padding: 6px; width: 224px; max-height: 50vh; overflow-y: auto; }
.tp-row { display: flex; align-items: center; gap: 8px; padding: 9px 8px; border-radius: 8px; cursor: pointer; font-size: 15px; }
.tp-row:active { background: var(--bg-2, rgba(127,127,127,0.12)); }
.tp-check { width: 16px; color: var(--tint); font-weight: 700; flex: none; text-align: center; }
.tp-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tp-new { color: var(--tint); font-weight: 600; border-top: 1px solid var(--border); margin-top: 2px; }
.tp-empty { color: var(--text-2); font-size: 13px; padding: 10px 8px; }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node _verify_lite_1071.js`
Expected: the 5 `T5` assertions PASS.

- [ ] **Step 5: Commit**

```bash
git add lite-1.071.html _verify_lite_1071.js
git commit -m "feat(lite-1.071): per-take tray-picker popover"
```

---

## Task 6: Two-level share manager

**Files:**
- Modify: `lite-1.071.html` — `#sharePanel` markup (search `id="sharePanel"`), owner share block (replace `openShareManager`/`closeShareManager`/`renderShareManager`), CSS block
- Test: `_verify_lite_1071.js`

**Interfaces:**
- Consumes: `_shareTrays`, `_shareOpenTrayId`, `_trayName`, `_esc`, `shareCopyTrayLink`, `shareSetTrayActive`, `shareRenameTray`, `shareDeleteTray`, `shareRemoveTakeFromTray`, `shareCreateTray`, `shareLoadTrays`.
- Produces: `openShareManager()`, `closeShareManager()`, `openTrayDetail(id)`, `shareBackToList()`, `renderShareManager()` (branches on `_shareOpenTrayId`), `renderTrayList()`, `renderTrayDetail(tr)`, `shareManagerNewTray()`, `shareManagerDeleteTray(id)`. The tray-detail takes list is `<div class="sm-list" data-reorder="tray" data-tray="<id>">` (consumed by Task 7's drag engine), each row `<div class="sm-row tray-take" data-id="<takeId>">` with a `.drag-handle`.

- [ ] **Step 1: Write the failing test**

Replace the OLD manager test block (the single-tray `#sharePanel` test, if present) and add:

```javascript
  // ── Task 6: two-level manager ──
  const pg6m = await ctx.newPage();
  await pg6m.goto(`http://localhost:${port}/lite-1.071.html`, { waitUntil: 'domcontentloaded' });
  await pg6m.waitForFunction(() => typeof window.openShareManager === 'function', { timeout: 10000 });
  const s6m = await pg6m.evaluate(async () => {
    window.shareLoadTrays = () => {};   // no network
    let copied = null; window.shareCopyTrayLink = (id) => { copied = id; };
    _shareTrays = [
      { id: 'TRA', name: 'Band demos', active: true, takes: [{ takeId: 'TK1', songTitle: 'One' }, { takeId: 'TK2', songTitle: 'Two' }] },
      { id: 'TRB', name: '', active: false, takes: [] },
    ];
    openShareManager();
    const panel = document.getElementById('sharePanel');
    const panelVisible = getComputedStyle(panel).display !== 'none';
    const listRows = [...panel.querySelectorAll('.tray-row')];
    const listShows = listRows.length === 2;
    const legacyRowName = listRows[1].querySelector('.sm-name').textContent.trim() === 'Shared takes';
    // Copy Link on the first list row
    listRows[0].querySelector('.sm-copy-icon').click();
    const copiedA = copied === 'TRA';
    // open detail
    openTrayDetail('TRA');
    const detailTakes = panel.querySelectorAll('.tray-take').length === 2;
    const hasReorderList = !!panel.querySelector('.sm-list[data-reorder="tray"][data-tray="TRA"]');
    const hasHandle = !!panel.querySelector('.tray-take .drag-handle');
    // back to list
    shareBackToList();
    const backToList = panel.querySelectorAll('.tray-row').length === 2;
    return { panelVisible, listShows, legacyRowName, copiedA, detailTakes, hasReorderList, hasHandle, backToList };
  });
  ok(s6m.panelVisible && s6m.listShows, 'T6 manager opens to a visible tray list');
  ok(s6m.legacyRowName, 'T6 nameless tray row shows "Shared takes"');
  ok(s6m.copiedA, 'T6 Copy Link on a list row copies that tray');
  ok(s6m.detailTakes && s6m.hasReorderList && s6m.hasHandle, 'T6 tray detail lists drag-reorderable takes');
  ok(s6m.backToList, 'T6 back arrow returns to the tray list');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node _verify_lite_1071.js`
Expected: FAIL — `openTrayDetail` undefined / old single-tray manager markup.

- [ ] **Step 3: Replace `#sharePanel` markup**

Find (search `id="sharePanel"`):

```html
<div id="sharePanel" class="share-panel" style="display:none;" onclick="if(event.target===this)closeShareManager()">
  <div class="sm-card">
    <div class="sm-head"><span class="sm-title">My Shared Takes</span><button class="sm-x" onclick="closeShareManager()" aria-label="Close">✕</button></div>
    <div class="sm-link-row"><button class="sm-copy" onclick="shareCopyLink()">Copy Link</button><label class="sm-toggle"><input type="checkbox" id="smActive" onchange="shareSetActive(this.checked)"> <span>Link on</span></label></div>
    <div id="smList" class="sm-list"></div>
  </div>
</div>
```

Replace with:

```html
<div id="sharePanel" class="share-panel" style="display:none;" onclick="if(event.target===this)closeShareManager()">
  <div class="sm-card">
    <div class="sm-head"><span class="sm-title" id="smTitle">My Shared Takes</span><button class="sm-x" onclick="closeShareManager()" aria-label="Close">✕</button></div>
    <div id="smBody"></div>
  </div>
</div>
```

- [ ] **Step 4: Replace `openShareManager`/`closeShareManager`/`renderShareManager`**

```javascript
function openShareManager() { _shareOpenTrayId = null; shareLoadTrays(); document.getElementById('sharePanel').style.display = 'flex'; renderShareManager(); }
function closeShareManager() { document.getElementById('sharePanel').style.display = 'none'; _shareOpenTrayId = null; }
function openTrayDetail(id) { _shareOpenTrayId = id; renderShareManager(); }
function shareBackToList() { _shareOpenTrayId = null; renderShareManager(); }
function renderShareManager() {
  const panel = document.getElementById('sharePanel'); if (!panel || panel.style.display === 'none') return;
  const body = document.getElementById('smBody'); if (!body) return;
  const titleEl = document.getElementById('smTitle');
  if (_shareOpenTrayId === null) {
    if (titleEl) titleEl.textContent = 'My Shared Takes';
    body.innerHTML = renderTrayList();
  } else {
    const tr = _shareTrays.find(t => t.id === _shareOpenTrayId);
    if (!tr) { _shareOpenTrayId = null; if (titleEl) titleEl.textContent = 'My Shared Takes'; body.innerHTML = renderTrayList(); return; }
    if (titleEl) titleEl.textContent = _trayName(tr);
    body.innerHTML = renderTrayDetail(tr);
  }
}
function renderTrayList() {
  const head = `<div class="sm-list-head"><button class="sm-newtray" onclick="shareManagerNewTray()">＋ New tray</button></div>`;
  if (!_shareTrays.length) return head + '<div class="sm-empty">No share trays yet. Open a song and tap the share icon on a take.</div>';
  const rows = _shareTrays.map(tr => `
    <div class="sm-row tray-row" onclick="openTrayDetail('${tr.id}')">
      <span class="sm-name">${_esc(_trayName(tr))}</span>
      <span class="sm-count">${(tr.takes || []).length}</span>
      <button class="sm-copy-icon" onclick="event.stopPropagation();shareCopyTrayLink('${tr.id}')" aria-label="Copy link" title="Copy link">🔗</button>
      <label class="sm-toggle" onclick="event.stopPropagation()"><input type="checkbox" ${tr.active ? 'checked' : ''} onchange="shareSetTrayActive('${tr.id}', this.checked)"> <span>On</span></label>
    </div>`).join('');
  return head + `<div class="sm-list">${rows}</div>`;
}
function renderTrayDetail(tr) {
  const takes = (tr.takes || []).map((t, i) => `
    <div class="sm-row tray-take" data-id="${t.takeId}" data-idx="${i}">
      <span class="drag-handle" aria-label="Reorder">⠿</span>
      <span class="sm-name">${_esc(t.songTitle || 'Untitled')}</span>
      <button class="sm-remove" onclick="shareRemoveTakeFromTray('${tr.id}','${t.takeId}')" aria-label="Remove">Remove</button>
    </div>`).join('');
  return `
    <div class="sm-detail-head">
      <button class="sm-back" onclick="shareBackToList()" aria-label="Back">←</button>
      <input class="sm-name-input" value="${_esc(_trayName(tr))}" onchange="shareRenameTray('${tr.id}', this.value)">
    </div>
    <div class="sm-link-row">
      <button class="sm-copy" onclick="shareCopyTrayLink('${tr.id}')">Copy Link</button>
      <label class="sm-toggle"><input type="checkbox" ${tr.active ? 'checked' : ''} onchange="shareSetTrayActive('${tr.id}', this.checked)"> <span>Link on</span></label>
      <button class="sm-delete" onclick="shareManagerDeleteTray('${tr.id}')">Delete</button>
    </div>
    <div class="sm-list" data-reorder="tray" data-tray="${tr.id}">${takes || '<div class="sm-empty">No takes in this tray yet.</div>'}</div>`;
}
function shareManagerNewTray() {
  const name = prompt('Tray name', ''); if (name == null) return;
  shareCreateTray(name.trim()).then(id => { if (id) openTrayDetail(id); });
}
function shareManagerDeleteTray(id) {
  if (!confirm('Delete this tray? Its share link will stop working.')) return;
  shareDeleteTray(id);
  shareBackToList();
}
```

Add CSS (after the picker CSS from Task 5):

```css
.sm-list-head { display: flex; justify-content: flex-end; margin-bottom: 10px; }
.sm-newtray { background: var(--tint); color: #fff; border-radius: 8px; padding: 7px 12px; font-weight: 600; }
.tray-row { cursor: pointer; gap: 10px; }
.sm-count { color: var(--text-2); font-size: 13px; min-width: 18px; text-align: right; }
.sm-copy-icon { font-size: 16px; padding: 4px; }
.sm-detail-head { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; }
.sm-back { font-size: 20px; color: var(--text); padding: 2px 6px; }
.sm-name-input { flex: 1; background: transparent; border: none; border-bottom: 1.5px solid var(--border); font-size: 16px; font-weight: 700; color: var(--text); padding: 4px 2px; }
.sm-name-input:focus { outline: none; border-bottom-color: var(--tint); }
.sm-delete { color: var(--red, #ff3b30); font-size: 14px; margin-left: auto; }
.tray-take { gap: 10px; }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node _verify_lite_1071.js`
Expected: the 5 `T6` assertions PASS.

- [ ] **Step 6: Commit**

```bash
git add lite-1.071.html _verify_lite_1071.js
git commit -m "feat(lite-1.071): two-level share manager (tray list ↔ detail)"
```

---

## Task 7: Drag-reorder takes in the tray detail

**Files:**
- Modify: `lite-1.071.html` — drag engine (search `const handle = e.target.closest('.drag-handle')` and the `_endReorder` function)
- Test: `_verify_lite_1071.js`

**Interfaces:**
- Consumes: existing `_reorder` state + `pointerdown`/`pointermove`/`_endReorder` engine; `shareReorderTray`, `renderShareManager`.
- Produces: the engine handles `container.dataset.reorder === 'tray'` — captures `fromIdx` at pointerdown, computes `toIdx` at drop, calls `shareReorderTray(trayId, fromIdx, toIdx)` then `renderShareManager()`. (Existing 'songs'/'takes' behavior unchanged.)

- [ ] **Step 1: Write the failing test**

Add after Task 6 (drives the engine via synthetic DOM + pointer events; verifies the tray branch commits a reorder):

```javascript
  // ── Task 7: drag-reorder commits via shareReorderTray ──
  const pg7 = await ctx.newPage();
  await pg7.goto(`http://localhost:${port}/lite-1.071.html`, { waitUntil: 'domcontentloaded' });
  await pg7.waitForFunction(() => typeof window.shareReorderTray === 'function', { timeout: 10000 });
  const s7 = await pg7.evaluate(() => {
    let reorder = null; window.shareReorderTray = (id, from, to) => { reorder = { id, from, to }; };
    window.renderShareManager = () => {};
    // Build a minimal tray-detail list in the DOM
    const list = document.createElement('div');
    list.className = 'sm-list'; list.dataset.reorder = 'tray'; list.dataset.tray = 'TRA';
    list.innerHTML = ['a', 'b', 'c'].map(id =>
      `<div class="sm-row tray-take" data-id="${id}"><span class="drag-handle">⠿</span><span>${id}</span></div>`).join('');
    document.body.appendChild(list);
    const rows = [...list.querySelectorAll('.tray-take')];
    const handle = rows[0].querySelector('.drag-handle');     // drag 'a'
    const r2 = rows[2].getBoundingClientRect();
    handle.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, bubbles: true }));
    // move below row c, then drop
    document.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientY: r2.bottom + 20, bubbles: true }));
    document.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, bubbles: true }));
    return { reorder, domOrder: [...list.querySelectorAll('.tray-take')].map(e => e.dataset.id).join(',') };
  });
  ok(s7.reorder && s7.reorder.id === 'TRA', 'T7 tray drag commits to the right tray');
  ok(s7.reorder && s7.reorder.from === 0, 'T7 drag captures the original index');
  ok(s7.reorder && s7.reorder.to === 2, 'T7 drag computes the drop index (moved to end)');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node _verify_lite_1071.js`
Expected: FAIL — `reorder` stays null (the engine has no 'tray' branch; it would try `_commitOrder` paths only).

- [ ] **Step 3: Extend the drag engine**

In the `pointerdown` handler (search `_reorder = { row, container, type: container.dataset.reorder, pointerId: e.pointerId };`), append a `fromIdx` capture for tray reorders. Replace that line with:

```javascript
    _reorder = { row, container, type: container.dataset.reorder, pointerId: e.pointerId };
    if (container.dataset.reorder === 'tray') _reorder.fromIdx = [...container.querySelectorAll(':scope > [data-id]')].indexOf(row);
```

In `_endReorder` (search `function _endReorder()`), replace:

```javascript
function _endReorder() {
  if (!_reorder) return;
  const { row, container, type } = _reorder; row.classList.remove('dragging');
  const ids = [...container.querySelectorAll(':scope > [data-id]')].map(el => el.dataset.id);
  _reorder = null;
  if (type === 'songs') _commitOrder('songs', ids);
  else if (type === 'takes') _commitOrder('voice_takes', ids);
}
```

with:

```javascript
function _endReorder() {
  if (!_reorder) return;
  const { row, container, type, fromIdx } = _reorder; row.classList.remove('dragging');
  const ids = [...container.querySelectorAll(':scope > [data-id]')].map(el => el.dataset.id);
  _reorder = null;
  if (type === 'songs') _commitOrder('songs', ids);
  else if (type === 'takes') _commitOrder('voice_takes', ids);
  else if (type === 'tray') {
    const trayId = container.dataset.tray;
    const toIdx = ids.indexOf(row.dataset.id);
    if (fromIdx != null && toIdx >= 0 && toIdx !== fromIdx) shareReorderTray(trayId, fromIdx, toIdx);
    if (typeof renderShareManager === 'function') renderShareManager();
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node _verify_lite_1071.js`
Expected: the 3 `T7` assertions PASS.

- [ ] **Step 5: Commit**

```bash
git add lite-1.071.html _verify_lite_1071.js
git commit -m "feat(lite-1.071): drag-reorder takes within a tray"
```

---

## Task 8: Live viewer (`onSnapshot` + non-disruptive diff)

**Files:**
- Modify: `lite-1.071.html` — viewer block (replace `shareViewLoad`, extract `_svListHtml`, add `shareViewApply`, update header in `shareViewRender`)
- Test: `_verify_lite_1071.js`

**Interfaces:**
- Consumes: `db.collection('shares').doc(id)`, `_svTakes`, `_svIdx`, `_svLyricsIdx`, `_svSource`, `_svCtx`, `_svStartCtx`, `_svPlayhead`, `_svBuffers`, `_svPeaks`, `_svRaf`, `svStop`, `_svUpdateBtns`, `_svDraw`, `svRenderLyrics`, `_esc`.
- Produces:
  - `shareViewLoad(id)` — `onSnapshot`; first snapshot missing/`active:false` → `shareViewUnavailable`, else `shareViewRender(d)`; later snapshots → missing/`active:false` → `svStop()` + `shareViewUnavailable`, else `shareViewApply(d)`.
  - `_svListHtml() -> string` (row template, used by render + apply).
  - `shareViewApply(d)` — rebuilds `_svTakes`, repaints `.sv-col-list`, remaps `_svBuffers`/`_svPeaks`/`_svIdx`/`_svLyricsIdx` by `takeId`, **does not** restart audio; re-binds the RAF + `onended` to the new index; updates header tray name; if the lyrics take vanished, leaves the lyrics DOM as-is.
  - `shareViewRender(d)` header gains a `.sv-trayname` element (always present, empty when no name).

- [ ] **Step 1: Write the failing test** (replace the OLD `pg6`/`s6` viewer routing block with an onSnapshot-driven version)

```javascript
  // ── Task 8: live viewer (onSnapshot diff) ──
  const pg8 = await ctx.newPage();
  await pg8.goto(`http://localhost:${port}/lite-1.071.html?share=ZZZ`, { waitUntil: 'domcontentloaded' });
  await pg8.waitForFunction(() => typeof window.shareViewLoad === 'function', { timeout: 10000 });
  const s8 = await pg8.evaluate(async () => {
    const inView = document.body.classList.contains('share-view');
    const viewerVisible = getComputedStyle(document.getElementById('shareViewer')).display !== 'none';
    const landingHidden = getComputedStyle(document.getElementById('landing')).display === 'none';

    // Controllable fake onSnapshot for the shares doc.
    let cb = null;
    db.collection = ((real) => (n) => n === 'shares'
      ? { doc: () => ({ onSnapshot: (fn) => { cb = fn; return () => {}; } }) }
      : real(n))(db.collection.bind(db));

    // First (good) snapshot: two takes, named tray.
    shareViewLoad('ZZZ');
    cb({ exists: true, data: () => ({ name: 'Band demos', active: true, takes: [
      { takeId: 'A', songTitle: 'Aaa', lyricsDoc: '<div>la</div>', downloadUrl: 'https://x/a', duration: 5 },
      { takeId: 'B', songTitle: 'Bbb', lyricsDoc: '', downloadUrl: 'https://x/b', duration: 6 },
    ] }) });
    const firstRows = document.querySelectorAll('#shareViewer .sv-row').length;
    const headerName = (document.querySelector('#shareViewer .sv-trayname') || {}).textContent;
    // Simulate "A is playing" without real audio.
    _svIdx = 0; _svLyricsIdx = 0; _svSource = { onended: null }; _svCtx = { currentTime: 0 }; _svStartCtx = 0; _svPlayhead = 1.5;
    const playingBefore = _svTakes[_svIdx].takeId;
    // Second snapshot: reorder (B,A) + add C. Playing take A must be preserved.
    cb({ exists: true, data: () => ({ name: 'Band demos', active: true, takes: [
      { takeId: 'B', songTitle: 'Bbb', lyricsDoc: '', downloadUrl: 'https://x/b', duration: 6 },
      { takeId: 'A', songTitle: 'Aaa', lyricsDoc: '<div>la</div>', downloadUrl: 'https://x/a', duration: 5 },
      { takeId: 'C', songTitle: 'Ccc', lyricsDoc: '', downloadUrl: 'https://x/c', duration: 7 },
    ] }) });
    const rowsAfter = document.querySelectorAll('#shareViewer .sv-row').length;
    const playingAfter = _svIdx >= 0 ? _svTakes[_svIdx].takeId : null;
    const playheadKept = _svPlayhead === 1.5;     // audio not restarted
    const sourceKept = !!_svSource;                // source not stopped
    // Third snapshot: revoke → unavailable + stop.
    let stopped = false; const realStop = window.svStop; window.svStop = () => { stopped = true; return realStop && realStop(); };
    cb({ exists: true, data: () => ({ active: false, takes: [] }) });
    const unavail = /unavailable/i.test(document.getElementById('shareViewer').textContent);
    return { inView, viewerVisible, landingHidden, firstRows, headerName, playingBefore, rowsAfter, playingAfter, playheadKept, sourceKept, unavail, stopped };
  });
  ok(s8.inView && s8.viewerVisible && s8.landingHidden, 'T8 ?share= enters viewer mode');
  ok(s8.firstRows === 2 && s8.headerName === 'Band demos', 'T8 first snapshot renders rows + tray name');
  ok(s8.rowsAfter === 3, 'T8 second snapshot live-updates the list (added a take)');
  ok(s8.playingBefore === 'A' && s8.playingAfter === 'A', 'T8 playing take preserved across reorder/add');
  ok(s8.playheadKept && s8.sourceKept, 'T8 audio not restarted on live update (playhead + source kept)');
  ok(s8.unavail && s8.stopped, 'T8 active:false snapshot → unavailable + playback stopped');
```

> Keep the existing "missing doc shows unavailable" coverage: add a tiny separate page that loads `?share=NOPE`, stubs `onSnapshot` to immediately `cb({ exists: false })`, and asserts `unavailable`. (Mirror the structure above; one `ok(...)`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `node _verify_lite_1071.js`
Expected: FAIL — `shareViewApply` undefined; old `shareViewLoad` uses `.get()` so `cb` is never wired.

- [ ] **Step 3: Replace `shareViewLoad`, extract `_svListHtml`, add `shareViewApply`, update header**

Replace `shareViewLoad` (search `async function shareViewLoad`):

```javascript
function shareViewLoad(id) {
  let first = true;
  try {
    db.collection('shares').doc(id).onSnapshot(snap => {
      const d = (snap && snap.exists) ? snap.data() : null;
      if (!d || d.active === false) {
        if (!first) svStop();
        shareViewUnavailable(first ? "This share is unavailable." : "This share is no longer available.");
        first = false; return;
      }
      if (first) { shareViewRender(d); first = false; }
      else shareViewApply(d);
    }, e => { console.warn('[shareView]', e); if (first) { shareViewUnavailable("This share couldn't be loaded."); first = false; } });
  } catch (e) { console.warn('[shareView]', e); shareViewUnavailable("This share couldn't be loaded."); }
}
```

In `shareViewRender` (search `function shareViewRender(d)`), extract the rows into `_svListHtml()` and add the always-present `.sv-trayname` to the header. Replace the whole function with:

```javascript
function _svListHtml() {
  return _svTakes.map((t, i) => `
    <div class="sv-row" data-i="${i}">
      <div class="sv-main">
        <button class="sv-play" data-i="${i}" onclick="svRowPlay(${i})" aria-label="Play">▶</button>
        <div class="sv-meta">
          <span class="sv-title">${_esc(t.songTitle || 'Untitled')}</span>
          <div class="sv-wave-wrap"><canvas class="sv-canvas" data-i="${i}" onclick="svSeekEvt(${i}, event)"></canvas></div>
        </div>
      </div>
    </div>`).join('');
}
function shareViewRender(d) {
  _svTakes = (d.takes || []).filter(t => t.downloadUrl);
  const name = d.name && String(d.name).trim() ? _esc(d.name) : '';
  document.getElementById('shareViewer').innerHTML =
    `<div class="sv-header"><div class="sv-brand">Drafthaus</div><div class="sv-trayname">${name}</div><div class="sv-sub">Shared with you</div><a class="sv-make" href="./">Make your own →</a></div>` +
    `<div class="sv-2col">` +
      `<div class="sv-col-list">${_svListHtml() || '<div class="sv-msg">Nothing shared yet.</div>'}</div>` +
      `<div class="sv-col-lyrics" id="svLyrics"></div>` +
    `</div>`;
  _svLyricsIdx = -1;
  svRenderLyrics();
}
function shareViewApply(d) {
  // Header tray name
  const tn = document.querySelector('#shareViewer .sv-trayname');
  if (tn) tn.textContent = d.name && String(d.name).trim() ? d.name : '';
  // Remember what's playing / shown by takeId
  const playingId = (_svIdx >= 0 && _svTakes[_svIdx]) ? _svTakes[_svIdx].takeId : null;
  const lyricsId = (_svLyricsIdx >= 0 && _svTakes[_svLyricsIdx]) ? _svTakes[_svLyricsIdx].takeId : null;
  const oldTakes = _svTakes, oldBuffers = _svBuffers, oldPeaks = _svPeaks;
  _svTakes = (d.takes || []).filter(t => t.downloadUrl);
  // Remap decode caches to new indices by takeId
  const nb = {}, np = {};
  _svTakes.forEach((t, ni) => {
    const oi = oldTakes.findIndex(o => o.takeId === t.takeId);
    if (oi >= 0) { if (oldBuffers[oi]) nb[ni] = oldBuffers[oi]; if (oldPeaks[oi]) np[ni] = oldPeaks[oi]; }
  });
  _svBuffers = nb; _svPeaks = np;
  // Repaint list column only (header + lyrics column persist)
  const listEl = document.querySelector('#shareViewer .sv-col-list');
  if (listEl) listEl.innerHTML = _svListHtml() || '<div class="sv-msg">Nothing shared yet.</div>';
  // Preserve playing index + keep audio running
  _svIdx = playingId ? _svTakes.findIndex(t => t.takeId === playingId) : -1;
  if (_svIdx >= 0) {
    const i = _svIdx, ctx = _svCtx;
    if (_svSource) _svSource.onended = () => { if (_svIdx === i) svStop(); };
    _svUpdateBtns(); _svDraw(i);
    if (_svRaf) cancelAnimationFrame(_svRaf);
    if (ctx) { const tick = () => { if (_svIdx !== i) return; _svPlayhead = ctx.currentTime - _svStartCtx; _svDraw(i); _svRaf = requestAnimationFrame(tick); }; _svRaf = requestAnimationFrame(tick); }
  } else { _svUpdateBtns(); }
  // Lyrics: re-render at new index if the shown take survived; else leave the DOM untouched
  const newLyricsIdx = lyricsId ? _svTakes.findIndex(t => t.takeId === lyricsId) : -1;
  if (lyricsId && newLyricsIdx >= 0) { _svLyricsIdx = newLyricsIdx; svRenderLyrics(); }
  else if (lyricsId && newLyricsIdx < 0) { _svLyricsIdx = -1; /* keep current lyrics DOM */ }
  else { _svLyricsIdx = newLyricsIdx; }
}
```

Add CSS for `.sv-trayname` (near the other `.sv-*` rules):

```css
.sv-trayname { font-weight: 700; font-size: 15px; color: var(--text); margin-top: 4px; }
.sv-trayname:empty { display: none; }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node _verify_lite_1071.js`
Expected: the `T8` assertions (incl. the extra missing-doc one) PASS.

- [ ] **Step 5: Commit**

```bash
git add lite-1.071.html _verify_lite_1071.js
git commit -m "feat(lite-1.071): live viewer — onSnapshot + non-disruptive diff"
```

---

## Task 9: Migration + no-harm regression coverage

**Files:**
- Test: `_verify_lite_1071.js` (assertions only; no app change expected — if an assertion fails, fix the relevant prior task)

**Interfaces:**
- Consumes: all owner + viewer functions; the existing no-harm test scaffolding carried over from `_verify_lite_1070.js`.

- [ ] **Step 1: Add the migration + no-harm block**

```javascript
  // ── Task 9: legacy migration + no-harm ──
  const pg9 = await ctx.newPage();
  await pg9.goto(`http://localhost:${port}/lite-1.071.html`, { waitUntil: 'domcontentloaded' });
  await pg9.waitForFunction(() => typeof window.shareTrayLink === 'function', { timeout: 10000 });
  const s9 = await pg9.evaluate(() => {
    // Legacy nameless tray: link by id unchanged + displays "Shared takes".
    const legacy = { id: 'LEG123', name: '', active: true, takes: [] };
    _shareTrays = [legacy];
    const linkUnchanged = /\?share=LEG123$/.test(shareTrayLink('LEG123'));
    const display = _trayName(legacy) === 'Shared takes';
    return { linkUnchanged, display };
  });
  ok(s9.linkUnchanged, 'T9 legacy nameless tray keeps its ?share= link');
  ok(s9.display, 'T9 legacy nameless tray renders "Shared takes"');
```

Carry forward the existing no-harm regression block from `_verify_lite_1070.js` (the songlist/record/lyrics/export checks) verbatim if present — keep its `ok(...)` lines so the suite still guards unrelated paths.

- [ ] **Step 2: Run the full suite**

Run: `node _verify_lite_1071.js`
Expected: all blocks PASS; the final line prints `N PASS / 0 FAIL` (N should be ≥ 37 across T1–T9 plus carried-over no-harm checks).

- [ ] **Step 3: Commit**

```bash
git add _verify_lite_1071.js
git commit -m "test(lite-1.071): legacy migration + no-harm regression"
```

---

## Task 10: Ship (commit; promotion deferred)

**Files:**
- Verify: `lite-1.071.html`, `_verify_lite_1071.js`

- [ ] **Step 1: Confirm the build differs from the base only as intended + full green run**

```bash
cd /Users/jasoncraig/Documents/Claude/Projects/Drafthaus
md5 lite-1.070.html lite-1.071.html         # the two MUST differ now
git --no-pager diff --stat lite-1.070.html lite-1.071.html  # sanity: only the share regions changed
node _verify_lite_1071.js                    # expect: N PASS / 0 FAIL
```

- [ ] **Step 2: Final commit (do NOT push; promotion to index.html is deferred to on-device sign-off)**

```bash
git add -A
git commit -m "feat(lite-1.071): multiple named share trays + drag-reorder + live viewer" || echo "nothing to commit"
git --no-pager log --oneline -8
```

- [ ] **Step 3: Report the deferred manual steps to the user** (do not perform them)

- Push `main` (Pages deploy) — user-gated.
- On-device QA (second device / incognito): create 2 named trays, add a take to both via the picker, drag-reorder one tray, Copy Link from a list row + from detail, open each link on another device, leave one playing while the owner reorders/adds/removes/renames → viewer updates live without restarting audio, revoke → "unavailable".
- Promote into `index.html` after sign-off (`cp lite-1.071.html index.html`), commit, push.
- Update memory `drafthaus-lite.md` + `MEMORY.md` with the 1.071 entry.

---

## Self-Review

**1. Spec coverage** (spec §-by-§):
- §1 goals (multi-tray / drag-reorder / live viewer) → Tasks 2, 7, 8. ✓
- §2 decisions: many trays (T2), tray picker + multi-membership (T5/T2), two-level manager (T6), Copy Link on row + detail (T6), order = array (T3), legacy → "Shared takes" (T1/T2/T9), live viewer preserve playback (T8), header name (T8). ✓
- §3 data model: `name` field, owner query discovery, no rule change → T2 (constraints note no rule change). ✓
- §4 owner state/functions: all listed functions appear (`shareLoadTrays`, `shareCreateTray`, `shareRename/Delete/SetTrayActive`, `shareAddTakeToTray`/`shareRemoveTakeFromTray`, `shareReorderTray`, `_shareWriteTray`, `shareTraysFor`/`shareIsShared`, `shareTrayLink`/`shareCopyTrayLink`, `shareRefresh`). ✓
- §5 owner UI: picker (T5), two-level manager (T6), drag-reorder (T7). ✓
- §6 viewer live: onSnapshot, diff-apply, header name, unavailable+stop (T8). ✓
- §7 edge cases: empty tray (T6 empty state / viewer "Nothing shared yet" in T8 render), take removed while playing (T8 keeps audio), tray deleted while viewing (T8 missing→unavailable), legacy nameless (T9), guest owner (uses uid() — unchanged), many trays (list scrolls — `.sm-card max-height:70vh` + `.sm-list` scroll, preserved). ✓
- §9 testing: model/tray-ops/reorder/picker/manager/viewer-live/migration/no-harm all mapped to T1–T9. ✓
- §10 ship: T10 (promotion deferred). ✓

**2. Placeholder scan:** No "TBD"/"add error handling"/"similar to Task N" — every code step shows full code. The one conditional (Task 3 `let` vs `function` for the spy) is a concrete, decidable instruction, not a placeholder.

**3. Type consistency:** Function/property names are consistent across tasks — `_shareTrays` items are `{id,name,active,takes}` everywhere; take snapshots use `takeId`; viewer caches keyed by index and remapped by `takeId`; `_shareWriteTray(id, fields)`, `shareReorderTray(id, fromIdx, toIdx)`, `shareAddTakeToTray(id, take)` signatures match their call sites in the picker, manager, and drag engine.
