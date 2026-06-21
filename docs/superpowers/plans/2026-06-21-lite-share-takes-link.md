# Drafthaus Lite — Shareable Takes Link Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a public, no-login "share link" to Drafthaus Lite: an owner maintains one persistent tray of takes (with lyrics) reachable at `?share=<id>`, where friends play each take, scrub it, and expand its lyrics.

**Architecture:** One new public Firestore collection `shares` holding a single per-user doc with denormalized take snapshots. Owner-side helpers create/edit that doc; an auto-refresh re-snapshots lyrics/audio while the owner is active. A read-only viewer mode (`body.share-view`, mirroring the existing no-login `body.chord-preview` state) renders the doc with its own minimal audio engine. Audio plays via each take's existing public Storage download URL — no Storage rule change.

**Tech Stack:** Single-file vanilla-JS HTML app (`lite-1.070.html`), Firebase compat SDK (Firestore + Storage), Web Audio. Headless verification via `playwright-core` + installed Chrome over real HTTP.

## Global Constraints

- **Build base:** branch from `lite-1.069.html` (md5 `3a1a1d1529f2b8f551c3e815edad03f9`) → `lite-1.070.html`. NEVER edit `index.html` directly. Diff every fresh copy against its source.
- **Single file:** all app code lives in `lite-1.070.html`. No new runtime files except the verify script and the spec/plan docs.
- **Shared-data contract:** takes are `voice_takes` docs (`songId`,`userId`,`downloadUrl`,`duration`,`mimeType`,`bytes`,`pendingUpload`); songs are `songs` docs (`title`,`lyricsDoc`,`ownerId`). NEVER overwrite or add fields to those collections for this feature. All new data lives only in `shares`.
- **Offline tolerance:** never `await` a Firestore write on a user-facing path; use fire-and-forget `.set(..,{merge:true}).catch(()=>{})` (Lite offline lesson).
- **Public read safety:** the `shares` rule must allow `get` (single doc) but NOT `list` to the public; only the owner may `list`/`create`/`update`/`delete`. Lyrics rendered in the viewer MUST pass through `ilSanitizeDocHtml(...)`.
- **Expose for tests:** share functions are top-level `function` declarations (so they appear on `window` and are `waitForFunction`-able); state is top-level `let` (reachable by bare name inside `page.evaluate`).
- **Verify harness:** model `_verify_lite_1070.js` on `_verify_lite_1068.js` (local `http` server, `executablePath` = installed Chrome, `addInitScript` sets `drafthaus-eula-accepted`, `guestIn(page)` helper). Run ONCE per check to a file; assert COMPUTED visibility, not just classes. Each anon sign-in counts toward Firebase rate limits — minimize guest sign-ins.
- **Deferred (do NOT build):** multiple named shares; drag-reorder of tray rows; tap-a-chord-in-viewer; live onSnapshot updates in the viewer; comments/reactions/download/expiry.

**Reference anchors in `lite-1.069.html` (line numbers drift — search the quoted string):**
- `function uploadTake(blob, mime, dur)` (~2139) — take fields + `_currentSong`.
- `function renderTakes()` (~1564) and the take-card template (~1532–1560) — where the per-take "Add to share" button goes; `PENCIL_SVG`/`LOOP_SVG`/`TRASH_SVG` (~1473).
- `<div class="lg-title">…<span class="lg-actions">` markup (~586) — header action cluster.
- `.lg-export`/`.lg-signout`/`body.export-select .lg-…` CSS (~163–173).
- `body.chord-preview #app{display:block}` / `#landing{display:none}` (~148) — no-login state precedent.
- `function ilSanitizeDocHtml(html)` (~1150) — lyrics sanitizer.
- `function _computePeaks(buffer, n)` (~1939) — reuse for viewer waveform.
- `function flushLyrics()` (~1239), `async function _wfReplaceAudio(...)` (~2027) — auto-refresh hook points.
- `auth.onAuthStateChanged(user => {…})` (~3217) — viewer guard + app-load refresh hook.
- `function startSongsListener()` (~930) — `_songs[]` carry `title`+`lyricsDoc`.
- `function uid()` (~730), `let _currentSong` (~1083), `let _takes` (~1475), `function toast(...)`/`recToast(...)` (~734/741).

---

### Task 1: Snapshot base + share state + ID/link helpers

**Files:**
- Create: `lite-1.070.html` (copy of `lite-1.069.html`)
- Create: `_verify_lite_1070.js`
- Modify: `lite-1.070.html` — add the share state block + helpers near the end of the main `<script>` (just before `auth.onAuthStateChanged`).

**Interfaces:**
- Produces:
  - `let _shareId=null, _shareTakes=[], _shareActive=true, _shareUnsub=null, _shareView=false;`
  - `function shareNewId()` → 22-char URL-safe random string.
  - `function shareLink()` → `string` (`<origin><pathname>?share=<_shareId>`), or `''` if no `_shareId`.
  - `function _shareSnapshot(take, song)` → `{takeId,songId,songTitle,lyricsDoc,downloadUrl,duration,mimeType,addedAt}`.

- [ ] **Step 1: Create the base file and confirm the copy**

```bash
cd /Users/jasoncraig/Documents/Claude/Projects/Drafthaus
md5 -q lite-1.069.html          # expect 3a1a1d1529f2b8f551c3e815edad03f9
cp lite-1.069.html lite-1.070.html
diff -q lite-1.069.html lite-1.070.html && echo "identical copy OK"
```

- [ ] **Step 2: Write the failing test (`_verify_lite_1070.js`)**

Create `_verify_lite_1070.js` with the harness copied from `_verify_lite_1068.js` (the `serve()`/`ok()`/`guestIn()` boilerplate), but serving `lite-1.070.html` (change the `/` default and the two `goto` URLs). Then add this no-auth infra page at the end of the IIFE:

```js
  // ── Task 1: share id + link + snapshot helpers (no auth needed) ──
  const pgS = await ctx.newPage();
  await pgS.goto(`http://localhost:${port}/lite-1.070.html`, { waitUntil: 'domcontentloaded' });
  await pgS.waitForFunction(() => typeof window.shareNewId === 'function', { timeout: 10000 });
  const s1 = await pgS.evaluate(() => {
    const a = shareNewId(), b = shareNewId();
    const snap = _shareSnapshot(
      { id: 'T1', downloadUrl: 'https://x/y', duration: 12, mimeType: 'audio/mp3' },
      { id: 'S1', title: 'My Song', lyricsDoc: '<div>Hi</div>' });
    _shareId = 'ABC123';
    const link = shareLink();
    return {
      idLen: a.length, idsDiffer: a !== b, urlSafe: /^[A-Za-z0-9_-]+$/.test(a),
      snapOK: snap.takeId === 'T1' && snap.songId === 'S1' && snap.songTitle === 'My Song'
              && snap.lyricsDoc === '<div>Hi</div>' && snap.downloadUrl === 'https://x/y'
              && snap.duration === 12 && typeof snap.addedAt === 'number',
      linkOK: /\?share=ABC123$/.test(link),
    };
  });
  ok(s1.idLen >= 20, 'T1 shareNewId is >=20 chars');
  ok(s1.idsDiffer, 'T1 shareNewId is random (two differ)');
  ok(s1.urlSafe, 'T1 shareNewId is URL-safe');
  ok(s1.snapOK, 'T1 _shareSnapshot builds a correct entry');
  ok(s1.linkOK, 'T1 shareLink returns <origin><path>?share=<id>');
```

- [ ] **Step 3: Run the test, verify it fails**

Run: `node _verify_lite_1070.js 2>&1 | grep 'T1 '`
Expected: FAILs / a timeout on `window.shareNewId` (helpers not defined yet).

- [ ] **Step 4: Add the share state + helpers**

In `lite-1.070.html`, immediately before the `auth.onAuthStateChanged(user => {` line, insert:

```js
/* ═══════════════════════════ Share (public takes tray) ═══════════════════════════ */
let _shareId = null, _shareTakes = [], _shareActive = true, _shareUnsub = null, _shareView = false;

function shareNewId() {
  const al = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const buf = new Uint8Array(22); (crypto || window.crypto).getRandomValues(buf);
  let s = ''; for (let i = 0; i < buf.length; i++) s += al[buf[i] % al.length];
  return s;
}
function shareLink() {
  return _shareId ? `${location.origin}${location.pathname}?share=${_shareId}` : '';
}
function _shareSnapshot(take, song) {
  return {
    takeId: take.id, songId: song.id, songTitle: song.title || 'Untitled',
    lyricsDoc: song.lyricsDoc || '', downloadUrl: take.downloadUrl || '',
    duration: take.duration || 0, mimeType: take.mimeType || '', addedAt: Date.now(),
  };
}
```

- [ ] **Step 5: Run the test, verify it passes**

Run: `node _verify_lite_1070.js 2>&1 | grep 'T1 '`
Expected: 5× PASS.

- [ ] **Step 6: Commit**

```bash
git add lite-1.070.html _verify_lite_1070.js
git commit -m "feat(lite-1.070): share state + id/link/snapshot helpers"
```

---

### Task 2: Owner data layer — ensure/find/subscribe + add/remove/active

**Files:**
- Modify: `lite-1.070.html` — extend the Share block from Task 1.
- Modify: `_verify_lite_1070.js` — add Task-2 asserts (stubbed `db`, no real network).

**Interfaces:**
- Consumes: `_shareSnapshot`, `shareNewId`, `_currentSong`, `_takes`, `uid()`, `toast`.
- Produces:
  - `async function shareEnsureDoc()` → `Promise<string>` (the `_shareId`; creates the doc + subscribes if needed).
  - `async function shareFindExisting()` → `Promise<string|null>` (query `shares where ownerId==uid` limit 1; caches to `localStorage['dh-lite-shareId']`).
  - `function shareSubscribe(id)` → attaches an `onSnapshot` that sets `_shareTakes`/`_shareActive` and calls `renderTakes()` + `renderShareManager()`.
  - `async function shareAddTake(take)` / `async function shareRemoveTake(takeId)` / `async function shareSetActive(bool)`.
  - `function shareIsShared(takeId)` → `bool`.

- [ ] **Step 1: Write the failing test**

Add to `_verify_lite_1070.js` (this page stubs Firestore, so no auth/network):

```js
  // ── Task 2: owner data layer with a stubbed shares doc ──
  const pg2 = await ctx.newPage();
  await pg2.goto(`http://localhost:${port}/lite-1.070.html`, { waitUntil: 'domcontentloaded' });
  await pg2.waitForFunction(() => typeof window.shareAddTake === 'function', { timeout: 10000 });
  const s2 = await pg2.evaluate(async () => {
    // In-memory fake of the one shares doc.
    let store = { exists: false, data: { takes: [], active: true, ownerId: 'U1' } };
    let listener = null;
    const fakeDocRef = {
      id: 'SHID',
      get: async () => ({ exists: store.exists, data: () => store.data }),
      set: (obj, opt) => { store.exists = true; store.data = opt && opt.merge ? Object.assign({}, store.data, obj) : obj; if (listener) listener({ exists: true, data: () => store.data }); return Promise.resolve(); },
      onSnapshot: (cb) => { listener = cb; cb({ exists: store.exists, data: () => store.data }); return () => { listener = null; }; },
    };
    const fakeShares = {
      doc: () => fakeDocRef,
      where: () => ({ limit: () => ({ get: async () => ({ empty: true, docs: [] }) }) }),
    };
    const realCollection = db.collection.bind(db);
    db.collection = (name) => name === 'shares' ? fakeShares : realCollection(name);
    auth.currentUser = { uid: 'U1', isAnonymous: false };  // uid() reads this
    _currentSong = { id: 'S1', title: 'Song One', lyricsDoc: '<div>La</div>' };

    const take = { id: 'TK1', downloadUrl: 'https://a/b', duration: 9, mimeType: 'audio/mp3' };
    await shareAddTake(take);
    const afterAdd = { shared: shareIsShared('TK1'), n: _shareTakes.length, title: _shareTakes[0] && _shareTakes[0].songTitle };
    await shareAddTake(take);                 // dedupe
    const afterDup = _shareTakes.length;
    await shareSetActive(false);
    const activeFlag = _shareActive;
    await shareRemoveTake('TK1');
    const afterRemove = { shared: shareIsShared('TK1'), n: _shareTakes.length };
    const noUrlBlocked = await shareAddTake({ id: 'TK2', duration: 3 }).then(() => shareIsShared('TK2'));
    return { afterAdd, afterDup, activeFlag, afterRemove, noUrlBlocked };
  });
  ok(s2.afterAdd.shared && s2.afterAdd.n === 1, 'T2 shareAddTake adds + shareIsShared true');
  ok(s2.afterAdd.title === 'Song One', 'T2 added entry carries song title snapshot');
  ok(s2.afterDup === 1, 'T2 shareAddTake dedupes by takeId');
  ok(s2.activeFlag === false, 'T2 shareSetActive(false) flips _shareActive');
  ok(!s2.afterRemove.shared && s2.afterRemove.n === 0, 'T2 shareRemoveTake removes the entry');
  ok(s2.noUrlBlocked === false, 'T2 shareAddTake refuses a take with no downloadUrl');
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `node _verify_lite_1070.js 2>&1 | grep 'T2 '`
Expected: timeout on `window.shareAddTake` (not defined yet).

- [ ] **Step 3: Implement the data layer**

Append inside the Share block (after `_shareSnapshot`):

```js
function shareSubscribe(id) {
  if (_shareUnsub) { _shareUnsub(); _shareUnsub = null; }
  _shareId = id;
  _shareUnsub = db.collection('shares').doc(id).onSnapshot(snap => {
    const d = (snap && snap.exists) ? snap.data() : null;
    _shareTakes = (d && Array.isArray(d.takes)) ? d.takes : [];
    _shareActive = d ? (d.active !== false) : true;
    if (typeof renderTakes === 'function') renderTakes();
    if (typeof renderShareManager === 'function') renderShareManager();
  }, e => console.warn('[share] snapshot', e));
}
async function shareFindExisting() {
  const u = uid(); if (!u) return null;
  try {
    const cached = localStorage['dh-lite-shareId'];
    if (cached) return cached;
  } catch (e) {}
  try {
    const q = await db.collection('shares').where('ownerId', '==', u).limit(1).get();
    if (!q.empty) { const id = q.docs[0].id; try { localStorage['dh-lite-shareId'] = id; } catch (e) {} return id; }
  } catch (e) { console.warn('[share] find', e); }
  return null;
}
async function shareEnsureDoc() {
  if (_shareId) return _shareId;
  const u = uid(); if (!u) return null;
  let id = await shareFindExisting();
  if (!id) {
    id = shareNewId();
    db.collection('shares').doc(id).set({ ownerId: u, active: true, takes: [], updatedAt: Date.now() })
      .catch(e => console.warn('[share] create', e));
    try { localStorage['dh-lite-shareId'] = id; } catch (e) {}
  }
  shareSubscribe(id);
  return id;
}
function shareIsShared(takeId) { return _shareTakes.some(t => t.takeId === takeId); }
async function _shareWriteTakes(takes) {
  const id = await shareEnsureDoc(); if (!id) return;
  _shareTakes = takes;  // optimistic local mirror
  db.collection('shares').doc(id).set({ takes, updatedAt: Date.now() }, { merge: true })
    .catch(e => console.warn('[share] write', e));
  if (typeof renderTakes === 'function') renderTakes();
  if (typeof renderShareManager === 'function') renderShareManager();
}
async function shareAddTake(take) {
  if (!take || !take.downloadUrl) { if (typeof toast === 'function') toast('Still uploading — try again in a moment', 2400); return; }
  const song = _currentSong; if (!song) return;
  const next = _shareTakes.filter(t => t.takeId !== take.id);
  next.push(_shareSnapshot(take, song));
  await _shareWriteTakes(next);
}
async function shareRemoveTake(takeId) {
  await _shareWriteTakes(_shareTakes.filter(t => t.takeId !== takeId));
}
async function shareSetActive(b) {
  const id = await shareEnsureDoc(); if (!id) return;
  _shareActive = !!b;
  db.collection('shares').doc(id).set({ active: !!b, updatedAt: Date.now() }, { merge: true })
    .catch(e => console.warn('[share] active', e));
  if (typeof renderShareManager === 'function') renderShareManager();
}
```

> Note: `renderShareManager` and `renderTakes`' share-button bits are added in Tasks 4–5; the `typeof … === 'function'` guards keep this task runnable on its own.

- [ ] **Step 4: Run the test, verify it passes**

Run: `node _verify_lite_1070.js 2>&1 | grep 'T2 '`
Expected: 6× PASS.

- [ ] **Step 5: Commit**

```bash
git add lite-1.070.html _verify_lite_1070.js
git commit -m "feat(lite-1.070): share doc ensure/find/subscribe + add/remove/active"
```

---

### Task 3: Auto-refresh snapshots + wiring

**Files:**
- Modify: `lite-1.070.html` — add `shareRefresh`/`shareRefreshSoon`; call from app-load, `flushLyrics`, `_wfReplaceAudio`.
- Modify: `_verify_lite_1070.js` — Task-3 asserts.

**Interfaces:**
- Consumes: `_shareTakes`, `_songs`, `_takes`, `_shareWriteTakes`, `_shareSnapshot`.
- Produces:
  - `async function shareRefresh()` → re-snapshots every tray entry from current `_songs`/`_takes`; drops entries whose song no longer exists; writes only if something changed.
  - `function shareRefreshSoon()` → debounced (1500ms) wrapper.

- [ ] **Step 1: Write the failing test**

Add to `_verify_lite_1070.js` (extends the Task-2 page state is gone; build a fresh stubbed page):

```js
  // ── Task 3: shareRefresh re-snapshots from _songs/_takes ──
  const pg3 = await ctx.newPage();
  await pg3.goto(`http://localhost:${port}/lite-1.070.html`, { waitUntil: 'domcontentloaded' });
  await pg3.waitForFunction(() => typeof window.shareRefresh === 'function', { timeout: 10000 });
  const s3 = await pg3.evaluate(async () => {
    let written = null;
    _shareId = 'SH';
    _shareWriteTakes = async (takes) => { written = takes; _shareTakes = takes; };  // spy
    _shareTakes = [
      { takeId: 'TK1', songId: 'S1', songTitle: 'OLD TITLE', lyricsDoc: '<div>old</div>', downloadUrl: 'u1', duration: 5, mimeType: 'audio/mp3', addedAt: 1 },
      { takeId: 'TK9', songId: 'GONE', songTitle: 'Ghost', lyricsDoc: '', downloadUrl: 'u9', duration: 2, mimeType: 'audio/mp3', addedAt: 1 },
    ];
    _songs = [{ id: 'S1', title: 'NEW TITLE', lyricsDoc: '<div>new</div>' }];
    _takes = [{ id: 'TK1', downloadUrl: 'u1b', duration: 7, mimeType: 'audio/mp3' }];
    await shareRefresh();
    return {
      n: written && written.length,
      kept: written && written[0],
      droppedGhost: written && !written.some(t => t.takeId === 'TK9'),
    };
  });
  ok(s3.droppedGhost, 'T3 shareRefresh drops entries whose song is gone');
  ok(s3.n === 1, 'T3 shareRefresh keeps the live entry only');
  ok(s3.kept && s3.kept.songTitle === 'NEW TITLE' && s3.kept.lyricsDoc === '<div>new</div>', 'T3 refreshes title + lyrics from _songs');
  ok(s3.kept && s3.kept.downloadUrl === 'u1b' && s3.kept.duration === 7, 'T3 refreshes audio fields from loaded _takes');
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `node _verify_lite_1070.js 2>&1 | grep 'T3 '`
Expected: timeout on `window.shareRefresh`.

- [ ] **Step 3: Implement refresh + wiring**

Append to the Share block:

```js
let _shareRefreshTimer = null;
function shareRefreshSoon() { clearTimeout(_shareRefreshTimer); _shareRefreshTimer = setTimeout(() => { shareRefresh().catch(() => {}); }, 1500); }
async function shareRefresh() {
  if (!_shareId || !_shareTakes.length) return;
  let changed = false;
  const next = [];
  for (const e of _shareTakes) {
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
  if (changed) await _shareWriteTakes(next);
}
```

Then add the three call sites:

1. In `auth.onAuthStateChanged`, inside the signed-in branch, AFTER `startSongsListener();`, add:
```js
    shareEnsureDoc().then(() => shareRefreshSoon()).catch(() => {});
```
2. At the end of a successful `flushLyrics()` (after the doc write resolves / state is updated), add:
```js
  shareRefreshSoon();
```
3. At the end of `_wfReplaceAudio(...)` (after the take doc/blob is updated), add:
```js
  shareRefreshSoon();
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `node _verify_lite_1070.js 2>&1 | grep 'T3 '`
Expected: 4× PASS.

- [ ] **Step 5: Commit**

```bash
git add lite-1.070.html _verify_lite_1070.js
git commit -m "feat(lite-1.070): auto-refresh tray snapshots on load/lyrics/trim"
```

---

### Task 4: Per-take "Add to share" toggle in take rows

**Files:**
- Modify: `lite-1.070.html` — take-card template + `SHARE_SVG`/`SHARED_SVG` icons + CSS + click handler.
- Modify: `_verify_lite_1070.js` — Task-4 asserts (DOM presence + toggle wiring).

**Interfaces:**
- Consumes: `shareIsShared`, `shareAddTake`, `shareRemoveTake`, `_takes`.
- Produces: `function takeShareToggle(takeId, ev)` (adds if not shared else removes; refuses when no `downloadUrl`).

- [ ] **Step 1: Write the failing test**

Add to `_verify_lite_1070.js`, on the existing guest page used for take rendering (create one like the 1068 `pg2` song-open flow). Minimal DOM-level assert:

```js
  // ── Task 4: per-take share toggle button ──
  const pg4 = await ctx.newPage();
  await pg4.goto(`http://localhost:${port}/lite-1.070.html`, { waitUntil: 'domcontentloaded' });
  await pg4.waitForFunction(() => typeof window.takeShareToggle === 'function', { timeout: 10000 });
  const s4 = await pg4.evaluate(() => {
    // Render a take row directly via renderTakes with a stubbed _takes/_loadedTakeId.
    let added = null, removed = null;
    shareAddTake = async (t) => { added = t.id; _shareTakes = [{ takeId: t.id }]; };
    shareRemoveTake = async (id) => { removed = id; _shareTakes = []; };
    _currentSong = { id: 'S1', title: 'S', lyricsDoc: '' };
    _takes = [{ id: 'TK1', downloadUrl: 'u', duration: 4, mimeType: 'audio/mp3', createdAt: { toMillis: () => 1 } }];
    _loadedTakeId = 'TK1';
    renderTakes();
    const btn = document.querySelector('.take-card[data-id="TK1"] .take-share, .take-row[data-id="TK1"] .take-share');
    const present = !!btn;
    if (btn) btn.click();
    return { present, added };
  });
  ok(s4.present, 'T4 take row has a .take-share button');
  ok(s4.added === 'TK1', 'T4 tapping share adds the take to the tray');
```

> If `renderTakes()` requires the takes panel/host present, follow the 1068 pattern of opening a song first; otherwise stub the host element. Match whatever the existing take tests do.

- [ ] **Step 2: Run the test, verify it fails**

Run: `node _verify_lite_1070.js 2>&1 | grep 'T4 '`
Expected: FAIL (no `.take-share` button / no handler).

- [ ] **Step 3: Add the icons, handler, button, and CSS**

Near `PENCIL_SVG` (~1474) add:
```js
const SHARE_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"></circle><circle cx="6" cy="12" r="3"></circle><circle cx="18" cy="19" r="3"></circle><line x1="8.6" y1="13.5" x2="15.4" y2="17.5"></line><line x1="15.4" y1="6.5" x2="8.6" y2="10.5"></line></svg>';
```

In the take-card action buttons (next to `.take-edit`, ~1555), add a share toggle button:
```js
        <button class="take-share ${shareIsShared(t.id) ? 'on' : ''}" onclick="takeShareToggle('${t.id}', event)" title="${shareIsShared(t.id) ? 'Shared — tap to remove' : 'Add to share link'}" aria-label="Share take">${SHARE_SVG}</button>
```

Add the handler near `selectTake` (~1584):
```js
function takeShareToggle(id, ev) {
  if (ev) ev.stopPropagation();
  const t = _takes.find(x => x.id === id); if (!t) return;
  if (shareIsShared(id)) shareRemoveTake(id);
  else if (!t.downloadUrl) toast('Still uploading — try again in a moment', 2400);
  else shareAddTake(t);
}
```

Add CSS near `.take-edit` styles:
```css
.take-share { display: flex; align-items: center; justify-content: center; color: var(--text-2); }
.take-share svg { width: 18px; height: 18px; }
.take-share.on { color: var(--tint); }
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `node _verify_lite_1070.js 2>&1 | grep 'T4 '`
Expected: 2× PASS.

- [ ] **Step 5: Commit**

```bash
git add lite-1.070.html _verify_lite_1070.js
git commit -m "feat(lite-1.070): per-take Add-to-share toggle on take rows"
```

---

### Task 5: Header share icon + "My Shared Takes" manager panel

**Files:**
- Modify: `lite-1.070.html` — header button, panel markup, `renderShareManager`, open/close/copy/active handlers, CSS.
- Modify: `_verify_lite_1070.js` — Task-5 asserts.

**Interfaces:**
- Consumes: `_shareTakes`, `_shareActive`, `shareLink`, `shareSetActive`, `shareRemoveTake`, `shareEnsureDoc`, `toast`.
- Produces: `function openShareManager()`, `function closeShareManager()`, `function renderShareManager()`, `function shareCopyLink()`.

- [ ] **Step 1: Write the failing test**

```js
  // ── Task 5: share manager panel ──
  const pg5 = await ctx.newPage();
  await pg5.goto(`http://localhost:${port}/lite-1.070.html`, { waitUntil: 'domcontentloaded' });
  await pg5.waitForFunction(() => typeof window.openShareManager === 'function', { timeout: 10000 });
  const s5 = await pg5.evaluate(async () => {
    shareEnsureDoc = async () => { _shareId = 'SH'; return 'SH'; };  // avoid network
    let copied = null;
    navigator.clipboard.writeText = (s) => { copied = s; return Promise.resolve(); };
    _shareId = 'SH';
    _shareTakes = [{ takeId: 'TK1', songTitle: 'Song A', duration: 12 }, { takeId: 'TK2', songTitle: 'Song B', duration: 30 }];
    _shareActive = true;
    openShareManager();
    const panel = document.getElementById('sharePanel');
    const open = panel && getComputedStyle(panel).display !== 'none';
    const rows = document.querySelectorAll('#sharePanel .sm-row').length;
    await shareCopyLink();
    const hdrBtn = !!document.querySelector('.lg-actions .lg-share');
    return { open, rows, copied, copiedOK: /\?share=SH$/.test(copied || ''), hdrBtn };
  });
  ok(s5.hdrBtn, 'T5 header has a .lg-share button');
  ok(s5.open, 'T5 openShareManager shows #sharePanel');
  ok(s5.rows === 2, 'T5 manager lists one row per tray take');
  ok(s5.copiedOK, 'T5 shareCopyLink copies the share URL');
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `node _verify_lite_1070.js 2>&1 | grep 'T5 '`
Expected: timeout on `window.openShareManager`.

- [ ] **Step 3: Add header button, panel markup, handlers, CSS**

In the `.lg-actions` span (~586), add LEFT of `.lg-signout`:
```html
<button class="lg-share" onclick="openShareManager()" aria-label="Share takes" title="Share takes"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"></circle><circle cx="6" cy="12" r="3"></circle><circle cx="18" cy="19" r="3"></circle><line x1="8.6" y1="13.5" x2="15.4" y2="17.5"></line><line x1="15.4" y1="6.5" x2="8.6" y2="10.5"></line></svg></button>
```
Add `.lg-share` to the `body.export-select` hide rule (~173) so it hides in select mode.

Add the panel markup just before `</body>` (a fixed overlay):
```html
<div id="sharePanel" class="share-panel" style="display:none;" onclick="if(event.target===this)closeShareManager()">
  <div class="sm-card">
    <div class="sm-head"><span class="sm-title">My Shared Takes</span><button class="sm-x" onclick="closeShareManager()" aria-label="Close">✕</button></div>
    <div class="sm-link-row"><button class="sm-copy" onclick="shareCopyLink()">Copy Link</button><label class="sm-toggle"><input type="checkbox" id="smActive" onchange="shareSetActive(this.checked)"> <span>Link on</span></label></div>
    <div id="smList" class="sm-list"></div>
  </div>
</div>
```

Add the handlers in the Share block:
```js
function openShareManager() { shareEnsureDoc().catch(() => {}); document.getElementById('sharePanel').style.display = 'flex'; renderShareManager(); }
function closeShareManager() { document.getElementById('sharePanel').style.display = 'none'; }
function shareCopyLink() {
  const link = shareLink(); if (!link) { toast('Add a take to share first', 2200); return; }
  navigator.clipboard.writeText(link).then(() => toast('Link copied ✓', 1800)).catch(() => toast(link, 3000));
}
function renderShareManager() {
  const panel = document.getElementById('sharePanel'); if (!panel || panel.style.display === 'none') return;
  const chk = document.getElementById('smActive'); if (chk) chk.checked = _shareActive;
  const list = document.getElementById('smList'); if (!list) return;
  if (!_shareTakes.length) { list.innerHTML = '<div class="sm-empty">No shared takes yet. Open a song and tap the share icon on a take.</div>'; return; }
  list.innerHTML = _shareTakes.map(t => `<div class="sm-row" data-id="${t.takeId}"><span class="sm-name">${(t.songTitle || 'Untitled')}</span><button class="sm-remove" onclick="shareRemoveTake('${t.takeId}')" aria-label="Remove">Remove</button></div>`).join('');
}
```

Add CSS (near the export overlay styles):
```css
.lg-share { display: inline-flex; align-items: center; justify-content: center; color: var(--text-2); flex: none; }
.lg-share svg { width: 20px; height: 20px; }
.share-panel { position: fixed; inset: 0; background: rgba(0,0,0,0.35); z-index: 9000; align-items: flex-end; justify-content: center; }
.sm-card { background: var(--bg-elev); width: 100%; max-width: 480px; border-radius: 16px 16px 0 0; padding: 16px; max-height: 70vh; display: flex; flex-direction: column; }
.sm-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
.sm-title { font-weight: 700; font-size: 17px; }
.sm-x { color: var(--text-2); font-size: 18px; }
.sm-link-row { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
.sm-copy { background: var(--tint); color: #fff; border-radius: 8px; padding: 8px 14px; font-weight: 600; }
.sm-toggle { display: flex; align-items: center; gap: 6px; color: var(--text-2); font-size: 14px; }
.sm-list { overflow-y: auto; }
.sm-row { display: flex; align-items: center; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid var(--border); }
.sm-name { font-size: 15px; }
.sm-remove { color: var(--red, #ff3b30); font-size: 14px; }
.sm-empty { color: var(--text-2); font-size: 14px; padding: 12px 0; }
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `node _verify_lite_1070.js 2>&1 | grep 'T5 '`
Expected: 4× PASS.

- [ ] **Step 5: Commit**

```bash
git add lite-1.070.html _verify_lite_1070.js
git commit -m "feat(lite-1.070): share manager panel (list/copy/remove/on-off)"
```

---

### Task 6: Viewer boot/routing + unavailable states

**Files:**
- Modify: `lite-1.070.html` — `#shareViewer` markup, `body.share-view` CSS, `shareViewBoot`/`shareViewLoad`/`shareViewUnavailable`, `onAuthStateChanged` guard, boot call.
- Modify: `_verify_lite_1070.js` — Task-6 asserts (stubbed public get, no auth).

**Interfaces:**
- Consumes: `ilSanitizeDocHtml`, `db`.
- Produces:
  - `function shareViewBoot()` → `bool` (true if `?share=` present; sets `_shareView`, `body.share-view`, kicks `shareViewLoad`).
  - `async function shareViewLoad(id)` → fetch `shares/<id>`; route to render or unavailable.
  - `function shareViewUnavailable(msg)` → fills `#shareViewer` with a message + "make your own" link.
  - `function shareViewRender(data)` → stub here (full body in Task 7); render the song-title rows shell.

- [ ] **Step 1: Write the failing test**

```js
  // ── Task 6: viewer routing + unavailable ──
  const pg6 = await ctx.newPage();
  await pg6.addInitScript(() => {
    // Stub Firestore get for the shares doc BEFORE app code runs is hard (db not ready);
    // instead we drive shareViewLoad directly below after load.
  });
  await pg6.goto(`http://localhost:${port}/lite-1.070.html?share=ZZZ`, { waitUntil: 'domcontentloaded' });
  await pg6.waitForFunction(() => typeof window.shareViewLoad === 'function', { timeout: 10000 });
  const s6 = await pg6.evaluate(async () => {
    const inView = document.body.classList.contains('share-view');
    const viewerVisible = getComputedStyle(document.getElementById('shareViewer')).display !== 'none';
    const landingHidden = getComputedStyle(document.getElementById('landing')).display === 'none';
    // revoked
    db.collection = ((real) => (n) => n === 'shares' ? { doc: () => ({ get: async () => ({ exists: true, data: () => ({ active: false, takes: [] }) }) }) } : real(n))(db.collection.bind(db));
    await shareViewLoad('ZZZ');
    const revokedMsg = /unavailable/i.test(document.getElementById('shareViewer').textContent);
    // missing
    db.collection = (n) => n === 'shares' ? { doc: () => ({ get: async () => ({ exists: false }) }) } : null;
    await shareViewLoad('NOPE');
    const missingMsg = /unavailable/i.test(document.getElementById('shareViewer').textContent);
    return { inView, viewerVisible, landingHidden, revokedMsg, missingMsg };
  });
  ok(s6.inView, 'T6 ?share= sets body.share-view');
  ok(s6.viewerVisible && s6.landingHidden, 'T6 viewer shown, landing hidden');
  ok(s6.revokedMsg, 'T6 revoked (active:false) shows unavailable');
  ok(s6.missingMsg, 'T6 missing doc shows unavailable');
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `node _verify_lite_1070.js 2>&1 | grep 'T6 '`
Expected: timeout on `window.shareViewLoad`.

- [ ] **Step 3: Add viewer markup, CSS, boot, guard**

Add the viewer container just before `</body>` (sibling of `#app`/`#landing`):
```html
<div id="shareViewer" class="share-viewer"></div>
```

Add CSS:
```css
.share-viewer { display: none; }
body.share-view #landing, body.share-view #app, body.share-view #sharePanel { display: none !important; }
body.share-view .share-viewer { display: block; min-height: 100vh; background: var(--bg); }
.sv-header { padding: 18px 16px; text-align: center; }
.sv-brand { font-weight: 800; font-size: 18px; color: var(--text); }
.sv-sub { color: var(--text-2); font-size: 13px; margin-top: 2px; }
.sv-make { display: inline-block; margin-top: 6px; font-size: 13px; color: var(--tint); }
.sv-msg { padding: 40px 20px; text-align: center; color: var(--text-2); }
```

Add the viewer functions to the Share block:
```js
function shareViewUnavailable(msg) {
  document.getElementById('shareViewer').innerHTML =
    `<div class="sv-header"><div class="sv-brand">Drafthaus</div></div>` +
    `<div class="sv-msg">${msg || "This share isn't available."}<br><a class="sv-make" href="./">Make your own →</a></div>`;
}
async function shareViewLoad(id) {
  try {
    const snap = await db.collection('shares').doc(id).get();
    if (!snap.exists) return shareViewUnavailable("This share isn't available.");
    const d = snap.data();
    if (d.active === false) return shareViewUnavailable("This share isn't available.");
    shareViewRender(d);
  } catch (e) { console.warn('[shareView]', e); shareViewUnavailable("This share couldn't be loaded."); }
}
function shareViewBoot() {
  const id = new URLSearchParams(location.search).get('share');
  if (!id) return false;
  _shareView = true;
  document.body.classList.add('share-view');
  document.getElementById('shareViewer').innerHTML = '<div class="sv-msg">Loading…</div>';
  shareViewLoad(id);
  return true;
}
// Task-6 placeholder; replaced by the full renderer in Task 7.
function shareViewRender(d) {
  document.getElementById('shareViewer').innerHTML =
    `<div class="sv-header"><div class="sv-brand">Drafthaus</div><div class="sv-sub">Shared with you</div></div>` +
    `<div class="sv-list">${(d.takes || []).map(t => `<div class="sv-row"><span class="sv-title">${t.songTitle || 'Untitled'}</span></div>`).join('')}</div>`;
}
```

Guard `onAuthStateChanged` — add as the FIRST line inside the callback:
```js
  if (_shareView) return;
```

Kick the boot — add right AFTER the `auth.onAuthStateChanged(...)` block closes (end of script):
```js
shareViewBoot();
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `node _verify_lite_1070.js 2>&1 | grep 'T6 '`
Expected: 4× PASS.

- [ ] **Step 5: Commit**

```bash
git add lite-1.070.html _verify_lite_1070.js
git commit -m "feat(lite-1.070): viewer routing (?share=) + unavailable states"
```

---

### Task 7: Viewer rendering — rows, player, auto-advance, lyrics expand

**Files:**
- Modify: `lite-1.070.html` — full `shareViewRender`, viewer player (`svPlay`/`svStop`/`svSeek`), `svToggleLyrics`, waveform draw, CSS.
- Modify: `_verify_lite_1070.js` — Task-7 asserts.

**Interfaces:**
- Consumes: `ilSanitizeDocHtml`, `_computePeaks`.
- Produces: `function svPlay(idx)`, `function svStop()`, `function svToggleLyrics(idx)`, `function svRowPlay(idx)`, viewer state `let _svTakes=[], _svIdx=-1, _svCtx=null, _svSource=null, _svBuffers={}`.

- [ ] **Step 1: Write the failing test**

```js
  // ── Task 7: viewer rows + lyrics expand + auto-advance wiring ──
  const pg7 = await ctx.newPage();
  await pg7.goto(`http://localhost:${port}/lite-1.070.html?share=ABC`, { waitUntil: 'domcontentloaded' });
  await pg7.waitForFunction(() => typeof window.svToggleLyrics === 'function', { timeout: 10000 });
  const s7 = await pg7.evaluate(() => {
    shareViewRender({ active: true, takes: [
      { takeId: 'TK1', songTitle: 'Alpha', lyricsDoc: '<div>Verse one</div>', downloadUrl: 'u1', duration: 10 },
      { takeId: 'TK2', songTitle: 'Beta',  lyricsDoc: '<div>Verse two</div>', downloadUrl: 'u2', duration: 20 },
    ]});
    const rows = document.querySelectorAll('#shareViewer .sv-row');
    const r0 = rows[0];
    const playLeftOfTitle = r0 && r0.querySelector('.sv-play') && r0.querySelector('.sv-play').compareDocumentPosition(r0.querySelector('.sv-title')) & Node.DOCUMENT_POSITION_FOLLOWING;
    const lyr0 = r0.querySelector('.sv-lyrics');
    const collapsed = getComputedStyle(lyr0).display === 'none';
    svToggleLyrics(0);
    const expanded = getComputedStyle(lyr0).display !== 'none';
    const lyrText = /Verse one/.test(lyr0.textContent);
    const autoAdvances = typeof svPlay === 'function';
    return { count: rows.length, playLeftOfTitle: !!playLeftOfTitle, collapsed, expanded, lyrText, autoAdvances };
  });
  ok(s7.count === 2, 'T7 renders one row per take');
  ok(s7.playLeftOfTitle, 'T7 play button precedes the song title');
  ok(s7.collapsed, 'T7 lyrics start collapsed');
  ok(s7.expanded && s7.lyrText, 'T7 Lyrics toggle expands and shows lyrics inline');
  ok(s7.autoAdvances, 'T7 svPlay exists for auto-advance');
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `node _verify_lite_1070.js 2>&1 | grep 'T7 '`
Expected: timeout on `window.svToggleLyrics`.

- [ ] **Step 3: Implement the full viewer**

Replace the Task-6 placeholder `shareViewRender` with the full renderer + player. Add to the Share block:

```js
let _svTakes = [], _svIdx = -1, _svCtx = null, _svSource = null, _svBuffers = {}, _svPeaks = {}, _svRaf = null, _svPlayhead = 0, _svStartCtx = 0;

function shareViewRender(d) {
  _svTakes = (d.takes || []).filter(t => t.downloadUrl);
  const rows = _svTakes.map((t, i) => `
    <div class="sv-row" data-i="${i}">
      <div class="sv-main">
        <button class="sv-play" onclick="svRowPlay(${i})" aria-label="Play">▶</button>
        <div class="sv-meta">
          <span class="sv-title">${t.songTitle || 'Untitled'}</span>
          <div class="sv-wave-wrap"><canvas class="sv-canvas" data-i="${i}" onclick="svSeekEvt(${i}, event)"></canvas></div>
        </div>
        <button class="sv-lyrbtn" onclick="svToggleLyrics(${i})">Lyrics</button>
      </div>
      <div class="sv-lyrics" data-i="${i}" style="display:none;"></div>
    </div>`).join('');
  document.getElementById('shareViewer').innerHTML =
    `<div class="sv-header"><div class="sv-brand">Drafthaus</div><div class="sv-sub">Shared with you</div><a class="sv-make" href="./">Make your own →</a></div>` +
    `<div class="sv-list">${rows || '<div class="sv-msg">Nothing shared yet.</div>'}</div>`;
}
function svToggleLyrics(i) {
  const el = document.querySelector(`#shareViewer .sv-lyrics[data-i="${i}"]`); if (!el) return;
  if (el.dataset.filled !== '1') { el.innerHTML = ilSanitizeDocHtml(_svTakes[i].lyricsDoc || ''); el.dataset.filled = '1'; }
  el.style.display = (el.style.display === 'none') ? 'block' : 'none';
}
function _svEnsureCtx() { if (!_svCtx) _svCtx = new (window.AudioContext || window.webkitAudioContext)(); return _svCtx; }
async function _svGetBuffer(i) {
  if (_svBuffers[i]) return _svBuffers[i];
  const resp = await fetch(_svTakes[i].downloadUrl);
  const ab = await resp.arrayBuffer();
  const buf = await _svEnsureCtx().decodeAudioData(ab);
  _svBuffers[i] = buf; _svPeaks[i] = _computePeaks(buf, 800); _svDraw(i);
  return buf;
}
function svRowPlay(i) { if (_svIdx === i && _svSource) { svStop(); } else { svPlay(i); } }
async function svStop() {
  if (_svSource) { try { _svSource.onended = null; _svSource.stop(); } catch (e) {} _svSource = null; }
  if (_svRaf) cancelAnimationFrame(_svRaf); _svRaf = null;
  const prev = _svIdx; _svIdx = -1; _svPlayhead = 0;
  _svUpdateBtns(); if (prev >= 0) _svDraw(prev);
}
async function svPlay(i, offset) {
  await svStop();
  let buf; try { buf = await _svGetBuffer(i); } catch (e) { console.warn('[sv play]', e); return; }
  const ctx = _svEnsureCtx();
  const src = ctx.createBufferSource(); src.buffer = buf; src.connect(ctx.destination);
  const off = offset || 0;
  src.onended = () => { if (_svIdx === i) { if (i + 1 < _svTakes.length) svPlay(i + 1); else svStop(); } };
  src.start(0, off);
  _svSource = src; _svIdx = i; _svStartCtx = ctx.currentTime - off; _svPlayhead = off;
  _svUpdateBtns();
  const tick = () => { if (_svIdx !== i) return; _svPlayhead = ctx.currentTime - _svStartCtx; _svDraw(i); _svRaf = requestAnimationFrame(tick); };
  _svRaf = requestAnimationFrame(tick);
}
function svSeekEvt(i, ev) {
  const c = ev.currentTarget, r = c.getBoundingClientRect();
  const frac = Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width));
  const dur = (_svBuffers[i] && _svBuffers[i].duration) || _svTakes[i].duration || 0;
  svPlay(i, frac * dur);
}
function _svUpdateBtns() {
  document.querySelectorAll('#shareViewer .sv-play').forEach((b, idx) => { b.textContent = (idx === _svIdx) ? '⏹' : '▶'; });
}
function _svDraw(i) {
  const c = document.querySelector(`#shareViewer .sv-canvas[data-i="${i}"]`); const peaks = _svPeaks[i];
  if (!c || !peaks) return;
  const dpr = window.devicePixelRatio || 1, w = c.clientWidth || 300, h = c.clientHeight || 40;
  if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
  const x2 = c.getContext('2d'); x2.setTransform(dpr, 0, 0, dpr, 0, 0); x2.clearRect(0, 0, w, h);
  const mid = h / 2, n = peaks.length;
  x2.strokeStyle = '#8a8a9a'; x2.lineWidth = 1; x2.beginPath();
  for (let x = 0; x < w; x++) { const a = peaks[Math.floor((x / w) * n)] || 0; const y = a * mid * 0.92; x2.moveTo(x + 0.5, mid - y); x2.lineTo(x + 0.5, mid + y); }
  x2.stroke();
  const dur = (_svBuffers[i] && _svBuffers[i].duration) || _svTakes[i].duration || 0;
  if (i === _svIdx && dur) { const px = (_svPlayhead / dur) * w; x2.strokeStyle = '#ff3b30'; x2.lineWidth = 2; x2.beginPath(); x2.moveTo(px, 0); x2.lineTo(px, h); x2.stroke(); }
}
```

Add CSS:
```css
.sv-list { max-width: 560px; margin: 0 auto; padding: 0 12px 40px; }
.sv-row { border-bottom: 1px solid var(--border); padding: 10px 0; }
.sv-main { display: flex; align-items: center; gap: 12px; }
.sv-play { flex: none; width: 40px; height: 40px; border-radius: 50%; background: var(--green, #34c759); color: #fff; font-size: 16px; display: flex; align-items: center; justify-content: center; }
.sv-meta { flex: 1; min-width: 0; }
.sv-title { display: block; font-weight: 600; font-size: 15px; margin-bottom: 4px; }
.sv-wave-wrap { height: 40px; }
.sv-canvas { width: 100%; height: 40px; display: block; }
.sv-lyrbtn { flex: none; font-size: 13px; color: var(--tint); }
.sv-lyrics { padding: 10px 4px 4px 52px; font-size: 15px; line-height: 2.2; white-space: pre-wrap; }
```

> The `.sv-lyrics` block reuses the global `.chord` span styling already in the file, so chords float above words as in the editor.

- [ ] **Step 4: Run the test, verify it passes**

Run: `node _verify_lite_1070.js 2>&1 | grep 'T7 '`
Expected: 5× PASS.

- [ ] **Step 5: Run the FULL verify suite**

Run: `node _verify_lite_1070.js 2>&1 | tail -40`
Expected: all T1–T7 PASS, 0 FAIL. (Anon-auth-gated pages — if any — may need a real guest; re-run once if rate-limited.)

- [ ] **Step 6: Commit**

```bash
git add lite-1.070.html _verify_lite_1070.js
git commit -m "feat(lite-1.070): viewer rows + player + auto-advance + lyrics expand"
```

---

### Task 8: Firestore rules doc, regression sweep, ship prep

**Files:**
- Create: `docs/superpowers/specs/2026-06-21-lite-share-firestore-rules.md` (the exact rules block + deploy instructions).
- Modify: `_verify_lite_1070.js` — add a no-harm regression assert + an access-shape assert.
- Modify: memory `drafthaus-lite.md` + `MEMORY.md` (after on-device sign-off; see Step 5).

**Interfaces:** none new.

- [ ] **Step 1: Write the rules doc**

Create `docs/superpowers/specs/2026-06-21-lite-share-firestore-rules.md`:

```markdown
# Lite Share — Firestore rules to deploy (owner action)

Add this block inside `match /databases/{database}/documents { … }` in the
Firestore rules, then Publish in the Firebase console. NO Storage rule change.

    match /shares/{shareId} {
      allow get:    if true;
      allow list:   if request.auth != null && request.auth.uid == resource.data.ownerId;
      allow create: if request.auth != null
                    && request.auth.uid == request.resource.data.ownerId;
      allow update,
            delete: if request.auth != null && request.auth.uid == resource.data.ownerId;
    }

Why `get` public but not `list`: viewers open a share by exact ID (`get`); the
public must never be able to enumerate/query the collection (`list`). Audio is
unaffected — it streams from each take's existing public Storage download URL.
Until this is published, the viewer link returns "unavailable".
```

- [ ] **Step 2: Add the access-shape + no-harm asserts**

Add to `_verify_lite_1070.js`: assert the viewer path touched ONLY the `shares` collection (spy on `db.collection` names during a `shareViewLoad`), and that opening a normal song + recording UI still renders (carry the relevant slice of the prior suite, or at minimum assert `typeof renderTakes==='function'` + a guest song-open still shows the rail — reuse the 1068 song-open pattern).

```js
  // ── Task 8: viewer reads ONLY the shares collection ──
  const pg8 = await ctx.newPage();
  await pg8.goto(`http://localhost:${port}/lite-1.070.html?share=ABC`, { waitUntil: 'domcontentloaded' });
  await pg8.waitForFunction(() => typeof window.shareViewLoad === 'function', { timeout: 10000 });
  const s8 = await pg8.evaluate(async () => {
    const seen = [];
    db.collection = ((real) => (n) => { seen.push(n); return n === 'shares'
      ? { doc: () => ({ get: async () => ({ exists: true, data: () => ({ active: true, takes: [] }) }) }) }
      : real(n); })(db.collection.bind(db));
    await shareViewLoad('ABC');
    return { only: seen.every(n => n === 'shares'), touchedShares: seen.includes('shares') };
  });
  ok(s8.touchedShares && s8.only, 'T8 viewer reads only the shares collection');
```

- [ ] **Step 3: Run the full suite**

Run: `node _verify_lite_1070.js 2>&1 | tee /tmp/v1070.txt | tail -50; grep -c '^PASS' /tmp/v1070.txt; grep -c '^FAIL' /tmp/v1070.txt`
Expected: FAIL count = 0.

- [ ] **Step 4: Commit + push, then deploy rules**

```bash
git add docs/superpowers/specs/2026-06-21-lite-share-firestore-rules.md _verify_lite_1070.js
git commit -m "feat(lite-1.070): share Firestore rules doc + access-shape/no-harm asserts"
git log --oneline -8
```
Confirm with the user before `git push` (Pages deploy). After push, **the user deploys the rules block** from the doc in the Firebase console.

- [ ] **Step 5: On-device sign-off (post-deploy QA — NOT automatable)**

Have the user verify on a real device:
- Add 2 takes → Share panel → Copy Link → open on a **second device / incognito (no login)**: rows render, audio plays, waveform scrub seeks, Lyrics expand/collapse pushes rows, auto-advance to the next take.
- Edit lyrics / trim a take → reload the link → viewer shows the update.
- Toggle "Link on" off → link shows "unavailable"; on again → works.
- Remove a take in the panel → it disappears from the link on reload.

Only after sign-off: promote into the root and update memory:
```bash
cp lite-1.070.html index.html
diff -q lite-1.070.html index.html && echo "promote OK"
git add index.html && git commit -m "release(lite-1.070): promote shareable takes link into index.html (root)"
```
Then update `drafthaus-lite.md` (1.070 entry + the manual rules-deploy note) and `MEMORY.md` pointer.

---

## Self-Review

**Spec coverage:**
- §1 goal / §3 data model → Tasks 1–2 (state, ID, snapshot, doc CRUD). ✓
- §2 decisions (one tray, per-take add, revoke + per-take remove, auto-refresh, header manager, auto-advance) → Tasks 2 (one tray via `shareFindExisting`/cache), 4 (per-take add), 5 (revoke + remove + manager), 3 (auto-refresh), 7 (auto-advance). ✓
- §4 backend rules → Task 8 doc (owner deploys). ✓
- §5 owner UI → Tasks 4–5. ✓
- §6 viewer (routing, layout, playback, isolation) → Tasks 6–7 + Task 8 access-shape assert. ✓
- §7 edge cases (revoked, missing, removed, local-only, empty, guest) → Task 6 (revoked/missing), Task 2/4 (downloadUrl guard), Task 5/7 (empty states), Task 3 (drop stale). ✓
- §9 testing → per-task headless + Task 8 regression/access asserts + Step-5 device QA. ✓
- §10 ship → Task 8 Steps 4–5. ✓

**Placeholder scan:** the only intentional placeholder is Task 6's stub `shareViewRender`, explicitly replaced in Task 7 Step 3. No TBD/TODO/"handle edge cases" left.

**Type consistency:** snapshot shape `{takeId,songId,songTitle,lyricsDoc,downloadUrl,duration,mimeType,addedAt}` is identical in `_shareSnapshot` (T1), `shareRefresh` (T3), manager rows (T5), and viewer (T7). `_shareTakes` is the single owner-side mirror; `_svTakes` is the viewer-side copy (distinct on purpose — viewer has no owner state). `shareEnsureDoc`/`shareSubscribe`/`shareAddTake`/`shareRemoveTake`/`shareSetActive`/`shareIsShared`/`renderShareManager`/`shareViewLoad`/`svPlay`/`svToggleLyrics` names are used identically across tasks. ✓
