# Lite Phase 2 — Offline Recording + Auto-Resync — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make recording (and trimming) work fully offline and auto-sync on reconnect, building `lite-1.066.html` from `lite-1.065.html`. Recordings persist across reloads via a doc-first write + a Storage upload outbox, with a global offline pill, per-take status, and retry-forever.

**Architecture:** Enable Firestore offline persistence (queues metadata writes + serves cached reads). Add an IndexedDB `outbox` store for the Storage uploads Firestore won't queue. `uploadTake`/`_wfReplaceAudio` write the Firestore doc first (`pendingUpload:true`, no `downloadUrl`) — instant render+play from the local blob — and enqueue an upload job. A single-flight `liteSyncDrain()` uploads queued jobs on reconnect/foreground/boot and patches the doc. A `_localBlobIds` in-memory Set lets the take row decide synchronously whether a pending take is local (playable) or from another device.

**Tech Stack:** Vanilla JS, Web Audio, Firebase v10 compat (Firestore + Storage), IndexedDB. Single-file HTML. Headless verify via playwright-core + installed Chrome.

## Global Constraints

- **App file:** all work in `lite-1.066.html` (copy of `lite-1.065.html`). Never touch `index.html`/`full.html`/`1.3xx.html`. Promote into `index.html` only after on-device sign-off (NOT part of this plan).
- **Base:** `lite-1.065.html` (md5 `b4ba3fd0a219939400ab0f1beddf9633`). Confirm via `md5 -q lite-1.065.html` before copying; `diff -q` the copy.
- **Data-safety (hard invariants — uphold in every task + verify):**
  1. The outbox + sync engine only act on takes they newly enqueue; existing takes are never re-uploaded/re-written/patched/deleted.
  2. Existing takes (carry `downloadUrl`, no `pendingUpload`) read exactly as 1.065: no badge, play enabled, served from cached blob or `fetch(downloadUrl)`. New badge/guard/disable trigger ONLY when `downloadUrl` is absent.
  3. `enablePersistence` is non-destructive (caches reads, queues new writes; per-doc LWW; no bulk rewrite). On reject → continue as 1.065.
  4. The IndexedDB upgrade is strictly additive: only `createObjectStore('outbox')` if absent; never delete/clear/rewrite `takeBlobs`.
  5. Trim deletes the old Storage file only AFTER a successful re-upload; on failure nothing is deleted and the take still plays.
  6. All Firestore writes additive + `{merge:true}`; `index.html`/`full.html` untouched; `lite-1.066.html` is a clean file-copy snapshot.
- **Decisions:** uniform doc-first; retry forever + manual `↻ retry`; subtle per-take badge + one-shot resync toast + a persistent header-area "Offline" pill; one milestone.
- **Verify:** headless `_verify_lite_1066.js` over real HTTP via playwright-core + installed Chrome. Run ONCE to a file and parse (anon-auth rate-limit). Assert COMPUTED state. Reuse the guest sign-in + create/open-song recipe from `_verify_lite_1065.js`/`_verify_lite_1064.js`.

---

### Task 1: Boot infra — persistence + outbox store + helpers + local-blob index

**Files:**
- Create: `lite-1.066.html` (copy of `lite-1.065.html`).
- Modify in `lite-1.066.html`: the Firestore boot (after `db.settings(...)`, ~line 715); the `dhAudio*` module (the `Local audio cache (IndexedDB…)` block, ~lines 1567–1622).
- Create: `_verify_lite_1066.js`.

**Interfaces:**
- Consumes: existing `_dhAudioOpen`, `_dhTx`, `_dhReq`, `dhAudioPut`, `dhAudioDelete`.
- Produces:
  - `db.enablePersistence({synchronizeTabs:true}).catch(()=>{})` at boot (once, before first `db.collection()` use).
  - DB version 2 with an `outbox` store (`keyPath:'takeId'`).
  - `dhOutboxPut(job) → Promise<bool>`, `dhOutboxGet(takeId) → Promise<job|null>`, `dhOutboxAll() → Promise<job[]>`, `dhOutboxDelete(takeId) → Promise<void>` (all never throw).
  - `dhAudioSetPending(takeId, bool) → Promise<void>` — flips a cached blob's `pendingUpload` flag.
  - `_localBlobIds` (a `Set`), `dhAudioHasLocal(id) → bool` (synchronous), and `dhAudioSeedIndex() → Promise<void>` (populates the Set from `takeBlobs` keys at boot). `dhAudioPut` adds the id; `dhAudioDelete` removes it.

- [ ] **Step 1: Create the working file**

```bash
md5 -q lite-1.065.html   # expect b4ba3fd0a219939400ab0f1beddf9633
cp lite-1.065.html lite-1.066.html
diff -q lite-1.065.html lite-1.066.html && echo "COPY OK"
```

- [ ] **Step 2: Write the failing test harness + Task-1 asserts**

Create `_verify_lite_1066.js` copying the harness structure + guest/song helpers from `_verify_lite_1065.js` (local HTTP server, installed-Chrome launch, EULA bypass, guest sign-in-with-retry, create/open song), navigating to `/lite-1.066.html`. Task-1 asserts (no auth needed — pure infra):

```js
  const t1 = await pg.evaluate(async () => {
    const persistenceCalled = typeof db.enablePersistence === 'function';
    // outbox round-trip
    await dhOutboxPut({ takeId: 'job-A', op: 'upload', storagePath: 'p/a.webm', mimeType: 'audio/webm', songId: 's', bytes: 10, duration: 1, tries: 0, createdAt: 1 });
    const got = await dhOutboxGet('job-A');
    const all = await dhOutboxAll();
    await dhOutboxDelete('job-A');
    const afterDel = await dhOutboxGet('job-A');
    // takeBlobs preserved across the v2 upgrade + local index
    await dhAudioPut('blob-A', new Blob([new Uint8Array(8)], { type: 'audio/webm' }), { mimeType: 'audio/webm', pendingUpload: true });
    const hasLocal = dhAudioHasLocal('blob-A');
    await dhAudioSetPending('blob-A', false);
    await dhAudioDelete('blob-A');
    const hasLocalAfter = dhAudioHasLocal('blob-A');
    return { persistenceCalled, gotOp: got && got.op, allLen: all.length, afterDel: afterDel === null, hasLocal, hasLocalAfter };
  });
  ok(t1.persistenceCalled, 'T1 enablePersistence is available + invoked at boot');
  ok(t1.gotOp === 'upload', 'T1 dhOutboxPut/Get round-trips a job');
  ok(t1.allLen >= 1, 'T1 dhOutboxAll returns jobs');
  ok(t1.afterDel, 'T1 dhOutboxDelete removes the job');
  ok(t1.hasLocal === true, 'T1 dhAudioHasLocal true after put (local index synced)');
  ok(t1.hasLocalAfter === false, 'T1 dhAudioHasLocal false after delete');
```
Run: `node _verify_lite_1066.js > /tmp/v1066.txt 2>&1; cat /tmp/v1066.txt`
Expected: FAIL — `dhOutboxPut`/`dhAudioHasLocal` undefined (and the DB is still v1).

- [ ] **Step 3: Add `enablePersistence` at boot**

In `lite-1.066.html`, immediately after `try { db.settings({ experimentalForceLongPolling: true }); } catch(e) {}` (line ~715):

```js
// Offline persistence: queue writes + serve cached reads when offline. Must precede any db use.
try { db.enablePersistence({ synchronizeTabs: true }).catch(() => {}); } catch (e) {}
```

- [ ] **Step 4: Upgrade the IndexedDB to v2 + add outbox/index helpers**

In the `dhAudio*` module, change the open to version 2 and add the `outbox` store additively. Replace the `_dhAudioOpen` `indexedDB.open(...)` + `onupgradeneeded` lines:

```js
    try { req = indexedDB.open('dh-lite-audio', 2); }
    catch (e) { resolve(null); return; }
    req.onupgradeneeded = () => {
      const idb = req.result;
      if (!idb.objectStoreNames.contains('takeBlobs')) idb.createObjectStore('takeBlobs', { keyPath: 'id' });
      if (!idb.objectStoreNames.contains('outbox')) idb.createObjectStore('outbox', { keyPath: 'takeId' });
    };
```

Then add, after `dhAudioEvict` (end of the module), the new helpers:

```js
// ── Local-blob index (synchronous membership for row rendering) ──
const _localBlobIds = new Set();
function dhAudioHasLocal(id) { return _localBlobIds.has(id); }
async function dhAudioSeedIndex() {
  const db2 = await _dhAudioOpen(); if (!db2) return;
  try { const keys = await _dhReq(_dhTx(db2, 'readonly').getAllKeys()); _localBlobIds.clear(); (keys || []).forEach(k => _localBlobIds.add(k)); } catch (e) {}
}
async function dhAudioSetPending(id, pending) {
  const db2 = await _dhAudioOpen(); if (!db2) return;
  try { const st = _dhTx(db2, 'readwrite'); const rec = await _dhReq(st.get(id)); if (rec) { rec.pendingUpload = !!pending; await _dhReq(_dhTx(db2, 'readwrite').put(rec)); } } catch (e) {}
}
// ── Outbox (pending Storage uploads Firestore won't queue) ──
function _dhOut(db2, mode) { return db2.transaction('outbox', mode).objectStore('outbox'); }
async function dhOutboxPut(job) {
  const db2 = await _dhAudioOpen(); if (!db2) return false;
  try { await _dhReq(_dhOut(db2, 'readwrite').put(job)); return true; } catch (e) { return false; }
}
async function dhOutboxGet(takeId) {
  const db2 = await _dhAudioOpen(); if (!db2) return null;
  try { return (await _dhReq(_dhOut(db2, 'readonly').get(takeId))) || null; } catch (e) { return null; }
}
async function dhOutboxAll() {
  const db2 = await _dhAudioOpen(); if (!db2) return [];
  try { return (await _dhReq(_dhOut(db2, 'readonly').getAll())) || []; } catch (e) { return []; }
}
async function dhOutboxDelete(takeId) {
  const db2 = await _dhAudioOpen(); if (!db2) return;
  try { await _dhReq(_dhOut(db2, 'readwrite').delete(takeId)); } catch (e) {}
}
```

Wire the index into the existing `dhAudioPut` and `dhAudioDelete`: in `dhAudioPut`, after a successful `put`, add `_localBlobIds.add(id);`. In `dhAudioDelete`, after the delete, add `_localBlobIds.delete(id);`. (Add these inside their existing `try` blocks.)

Seed the index at boot: find where the app seeds state after auth (search `onAuthStateChanged` → its signed-in branch, and/or `liteUsageRecompute()` call site) and add `dhAudioSeedIndex();` (fire-and-forget) alongside it.

- [ ] **Step 5: Run the Task-1 asserts**

Run: `node _verify_lite_1066.js > /tmp/v1066.txt 2>&1; cat /tmp/v1066.txt`
Expected: all 6 Task-1 asserts PASS.

⚠️ The DB version bump means a browser profile holding a v1 `dh-lite-audio` must upgrade cleanly. The test runs in a fresh context (v2 from scratch); separately confirm the upgrade is additive by reading the `onupgradeneeded` code (guards on `!contains`). Do not delete the user's DB.

- [ ] **Step 6: Commit**

```bash
git add lite-1.066.html _verify_lite_1066.js
git commit -m "feat(lite-1.066): offline infra — enablePersistence, IndexedDB outbox store + helpers, local-blob index"
```

---

### Task 2: Sync engine `liteSyncDrain()`

**Files:**
- Modify in `lite-1.066.html`: add `liteSyncDrain` + its state, placed right after the `dhAudio*`/outbox module.
- Test: `_verify_lite_1066.js` — add Task-2 asserts.

**Interfaces:**
- Consumes: `dhOutboxAll`, `dhOutboxDelete`, `dhAudioGet`, `dhAudioSetPending`; `firebase.storage()`, `db.collection('voice_takes')`; `toast`.
- Produces: `liteSyncDrain() → Promise<void>` (single-flight via `_syncing`; uploads each queued job, patches its doc, deletes the job, clears the blob pending flag; retry-forever on failure; fires the resync toast on offline→synced transition). Module state `_syncing=false`, `_syncToastPending=false`.

- [ ] **Step 1: Write the failing Task-2 asserts**

```js
  // Drain uploads a queued job, patches the doc, empties the outbox, clears pending.
  const t2 = await pg.evaluate(async () => {
    // seed a blob + outbox job + a take doc stub via stubs
    await dhAudioPut('drain1', new Blob([new Uint8Array(16)], { type: 'audio/webm' }), { mimeType: 'audio/webm', pendingUpload: true });
    await dhOutboxPut({ takeId: 'drain1', op: 'upload', storagePath: 'voice_takes/s/drain1.webm', mimeType: 'audio/webm', songId: 's', bytes: 16, duration: 1, tries: 0, createdAt: 1 });
    let patched = null;
    const origRef = firebase.storage().ref.bind(firebase.storage());
    firebase.storage().ref = () => ({ put: async () => ({ ref: { getDownloadURL: async () => 'http://x/drain1.webm' } }), delete: async () => {} });
    const origColl = db.collection.bind(db);
    db.collection = (n) => n === 'voice_takes' ? { doc: () => ({ set: async (data) => { patched = data; } }) } : origColl(n);
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => true });
    await liteSyncDrain();
    const jobGone = (await dhOutboxGet('drain1')) === null;
    const rec = await (async () => { const d = await _dhAudioOpen(); return _dhReq(_dhTx(d, 'readonly').get('drain1')); })();
    firebase.storage().ref = origRef; db.collection = origColl;
    await dhAudioDelete('drain1');
    return { patchedUrl: patched && patched.downloadUrl, patchedPending: patched && patched.pendingUpload, jobGone, pendingCleared: rec ? rec.pendingUpload === false : false };
  });
  ok(t2.patchedUrl === 'http://x/drain1.webm', 'T2 drain patches the doc with downloadUrl');
  ok(t2.patchedPending === false, 'T2 drain sets pendingUpload:false on the doc');
  ok(t2.jobGone, 'T2 drain removes the outbox job on success');
  ok(t2.pendingCleared, 'T2 drain clears the blob pendingUpload flag');

  // Failure keeps the job queued + increments tries (retry forever).
  const t2b = await pg.evaluate(async () => {
    await dhAudioPut('drain2', new Blob([new Uint8Array(16)], { type: 'audio/webm' }), { mimeType: 'audio/webm', pendingUpload: true });
    await dhOutboxPut({ takeId: 'drain2', op: 'upload', storagePath: 'p/d2.webm', mimeType: 'audio/webm', songId: 's', bytes: 16, duration: 1, tries: 0, createdAt: 2 });
    const origRef = firebase.storage().ref.bind(firebase.storage());
    firebase.storage().ref = () => ({ put: async () => { throw new Error('net'); } });
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => true });
    await liteSyncDrain();
    const job = await dhOutboxGet('drain2');
    firebase.storage().ref = origRef;
    await dhOutboxDelete('drain2'); await dhAudioDelete('drain2');
    return { stillQueued: !!job, tries: job ? job.tries : -1 };
  });
  ok(t2b.stillQueued, 'T2 failed upload keeps the job queued');
  ok(t2b.tries >= 1, 'T2 failed upload increments tries (retry forever)');
```
Run once → expect FAIL (`liteSyncDrain` undefined).

- [ ] **Step 2: Implement `liteSyncDrain`**

Add after the outbox helpers:

```js
let _syncing = false, _syncAnnounce = false;
async function liteSyncDrain() {
  if (_syncing) return;
  if (!navigator.onLine) return;
  const jobs = await dhOutboxAll();
  if (!jobs.length) return;
  _syncing = true;
  if (_syncAnnounce) { toast('Connection restored — syncing recordings…', 2000); _syncAnnounce = false; }
  jobs.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  let uploadedAny = false;
  try {
    for (const job of jobs) {
      if (!navigator.onLine) break;
      const blob = await dhAudioGet(job.takeId);
      if (!blob) { await dhOutboxDelete(job.takeId); continue; } // blob gone — nothing to upload
      try {
        const snap = await firebase.storage().ref(job.storagePath).put(blob, { contentType: job.mimeType });
        const url = await snap.ref.getDownloadURL();
        await db.collection('voice_takes').doc(job.takeId).set({ downloadUrl: url, storagePath: job.storagePath, bytes: job.bytes, pendingUpload: false }, { merge: true });
        if (job.op === 'replace' && job.oldPath && job.oldPath !== job.storagePath) firebase.storage().ref(job.oldPath).delete().catch(() => {});
        await dhOutboxDelete(job.takeId);
        await dhAudioSetPending(job.takeId, false);
        uploadedAny = true;
      } catch (e) {
        job.tries = (job.tries || 0) + 1; job.lastTry = Date.now();
        await dhOutboxPut(job); // keep queued — retry forever on next trigger
      }
    }
  } finally { _syncing = false; }
  if (uploadedAny && !(await dhOutboxAll()).length) toast('Synced ✓', 1500);
}
```

- [ ] **Step 3: Run Task-2 asserts** → expect all PASS.

- [ ] **Step 4: Commit**

```bash
git add lite-1.066.html _verify_lite_1066.js
git commit -m "feat(lite-1.066): liteSyncDrain — single-flight upload outbox drain, retry-forever, resync toast"
```

---

### Task 3: Doc-first `uploadTake`

**Files:** Modify `uploadTake` (search `async function uploadTake`) in `lite-1.066.html`. Test: add Task-3 asserts.

**Interfaces:** Consumes `dhAudioPut`, `dhOutboxPut`, `liteSyncDrain`, `_liteAddBytes`. Produces the doc-first record path.

- [ ] **Step 1: Write the failing Task-3 asserts** (offline record → doc pendingUpload + outbox job + plays locally + no upload)

```js
  const t3 = await pg.evaluate(async () => {
    stopTakesListener(); _takes = []; _loadedTakeId = null;
    let docData = null, putCalled = false;
    const origColl = db.collection.bind(db);
    db.collection = (n) => n === 'voice_takes'
      ? { doc: (id) => ({ id: id || ('genid_' + Math.random().toString(36).slice(2)), set: async (d) => { docData = d; } }) }
      : origColl(n);
    const origRef = firebase.storage().ref.bind(firebase.storage());
    firebase.storage().ref = () => ({ put: async () => { putCalled = true; return { ref: { getDownloadURL: async () => 'http://x/y' } }; } });
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => false }); // OFFLINE
    const blob = new Blob([new Uint8Array(2048)], { type: 'audio/webm' });
    await uploadTake(blob, 'audio/webm', 1.0);
    const id = _loadedTakeId;
    const job = await dhOutboxGet(id);
    const localBlob = await dhAudioGet(id);
    db.collection = origColl; firebase.storage().ref = origRef;
    if (id) { await dhOutboxDelete(id); await dhAudioDelete(id); }
    return { pendingTrue: docData && docData.pendingUpload === true, noUrl: docData && !docData.downloadUrl, jobQueued: !!job, playableLocal: !!localBlob, noUpload: putCalled === false, selected: id === _loadedTakeId };
  });
  ok(t3.pendingTrue, 'T3 offline record writes doc pendingUpload:true');
  ok(t3.noUrl, 'T3 offline record writes doc with NO downloadUrl');
  ok(t3.jobQueued, 'T3 offline record enqueues an outbox job');
  ok(t3.playableLocal, 'T3 offline record blob is in IndexedDB (plays locally)');
  ok(t3.noUpload, 'T3 offline record attempts NO Storage upload');
```
Run → expect FAIL (current `uploadTake` uploads first / writes downloadUrl / no outbox).

- [ ] **Step 2: Rewrite `uploadTake`**

```js
async function uploadTake(blob, mime, dur) {
  const song = _currentSong;
  if (!song || !uid()) { recToast('Not signed in'); return; }
  if (liteUsageOver()) { recToast(liteCapMessage(), 3200); return; }
  const ref = db.collection('voice_takes').doc();
  const id = ref.id;
  const ext = mime.includes('webm') ? 'webm' : mime.includes('mp4') ? 'm4a' : 'ogg';
  const fname = 'take_' + Date.now() + '.' + ext;
  const path = 'voice_takes/' + song.id + '/' + fname;
  const duration = Math.round(dur);
  // Cache locally (LRU-exempt while pending).
  await dhAudioPut(id, blob, { mimeType: mime, pendingUpload: true });
  // Doc-first: write the take doc now (no downloadUrl). Firestore echoes it back
  // instantly (latency compensation) → renders + plays from the local blob.
  _selectNewest = false; _loadedTakeId = id;
  try {
    await ref.set({
      songId: song.id, userId: uid(), filename: fname, storagePath: path,
      duration, mimeType: mime, trackNum: 0, bytes: blob.size, pendingUpload: true,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    _liteAddBytes(blob.size);
    db.collection('songs').doc(song.id).set({ updatedAt: Date.now() }, { merge: true }).catch(() => {});
  } catch (e) { console.warn('[uploadTake doc]', e); }
  // Queue the Storage upload + kick the sync engine (uploads now if online).
  await dhOutboxPut({ takeId: id, op: 'upload', storagePath: path, mimeType: mime, songId: song.id, bytes: blob.size, duration, tries: 0, createdAt: Date.now() });
  liteSyncDrain();
}
```

Note: the `voice_takes` `onSnapshot` listener renders the take (it now has `pendingUpload:true`, no `downloadUrl`). `wfLoad`→`_getBuffer` serves the local blob (Task 6 adds the missing-url guard for OTHER devices; on THIS device the blob is present so it plays). `_liteAddBytes` keeps usage consistent with the recompute sum.

- [ ] **Step 3: Run Task-3 asserts** → all PASS. Also re-run the whole file; confirm prior tasks still green.

- [ ] **Step 4: Commit**

```bash
git add lite-1.066.html _verify_lite_1066.js
git commit -m "feat(lite-1.066): doc-first uploadTake — offline-durable record via outbox"
```

---

### Task 4: Trim path → outbox (`_wfReplaceAudio`)

**Files:** Modify `_wfReplaceAudio` (search `async function _wfReplaceAudio`). Test: add Task-4 asserts.

**Interfaces:** Consumes `dhAudioPut`, `dhOutboxPut`, `liteSyncDrain`. Produces the doc-first trim path (keeps old `downloadUrl` until re-upload; enqueues `op:'replace'`).

- [ ] **Step 1: Write the failing Task-4 asserts** (offline trim → doc pendingUpload + bytes/duration updated + outbox replace job + old url retained + no upload)

```js
  const t4 = await pg.evaluate(async () => {
    const ctx = ensureCtx(); const ab = ctx.createBuffer(1, 4410, 44100);
    _takes = [{ id: 'trim1', songId: 's', bytes: 100, storagePath: 'voice_takes/s/old.webm', downloadUrl: 'http://x/old.webm', mimeType: 'audio/webm' }];
    _wf.takeId = 'trim1';
    window._ensureMp3Lib = async () => {}; window._encodeMp3 = () => new Blob([new Uint8Array(64)], { type: 'audio/mp3' });
    let docData = null, putCalled = false;
    const origColl = db.collection.bind(db);
    db.collection = (n) => n === 'voice_takes' ? { doc: () => ({ set: async (d) => { docData = Object.assign(docData || {}, d); } }) } : origColl(n);
    const origRef = firebase.storage().ref.bind(firebase.storage());
    firebase.storage().ref = () => ({ put: async () => { putCalled = true; return { ref: { getDownloadURL: async () => 'http://x/new.mp3' } }; }, delete: async () => {} });
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => false });
    await _wfReplaceAudio(ab, null, 'Trimmed');
    const job = await dhOutboxGet('trim1');
    db.collection = origColl; firebase.storage().ref = origRef;
    await dhOutboxDelete('trim1'); await dhAudioDelete('trim1');
    return { pending: docData && docData.pendingUpload === true, keptUrl: !docData || docData.downloadUrl === undefined, jobReplace: job && job.op === 'replace', jobOldPath: job && job.oldPath === 'voice_takes/s/old.webm', noUpload: putCalled === false };
  });
  ok(t4.pending, 'T4 offline trim sets doc pendingUpload:true');
  ok(t4.keptUrl, 'T4 offline trim does NOT overwrite downloadUrl (other devices keep old)');
  ok(t4.jobReplace, 'T4 offline trim enqueues an op:replace job');
  ok(t4.jobOldPath, 'T4 replace job carries oldPath for post-upload delete');
  ok(t4.noUpload, 'T4 offline trim attempts NO Storage upload');
```

- [ ] **Step 2: Rewrite `_wfReplaceAudio`** (doc-first; enqueue replace; keep instant local playback + the failure rollback)

```js
async function _wfReplaceAudio(buffer, undoBuffer, msg) {
  const take = _takes.find(t => t.id === _wf.takeId); if (!take || !uid()) { toast('Not signed in'); return false; }
  stopPlayback();
  let _prevBufEntry;
  try {
    await _ensureMp3Lib();
    const blob = _encodeMp3(buffer);
    const oldBytes = (typeof take.bytes === 'number') ? take.bytes : 0;
    if (_liteUsageBytes - oldBytes + blob.size > liteStorageCap()) { toast(liteCapMessage()); return false; }
    const fname = 'take_' + Date.now() + '.mp3', path = 'voice_takes/' + take.songId + '/' + fname;
    const duration = Math.round(buffer.duration);
    // Instant local playback of the edited audio.
    _prevBufEntry = _bufCache[take.id];
    await dhAudioPut(take.id, blob, { mimeType: 'audio/mp3', pendingUpload: true });
    _bufCache[take.id] = { buffer, normGain: (_prevBufEntry && _prevBufEntry.normGain) || 1 };
    // Doc-first: mark pending + new metadata; KEEP the old downloadUrl so other
    // devices keep playing the previous version until re-upload.
    const oldPath = take.storagePath;
    await db.collection('voice_takes').doc(take.id).set({ duration, mimeType: 'audio/mp3', bytes: blob.size, pendingUpload: true }, { merge: true });
    take.bytes = blob.size; take.mimeType = 'audio/mp3'; take.duration = duration;
    _liteAddBytes(blob.size - oldBytes);
    // Queue the re-upload (replaces storage + clears pending + deletes oldPath on success).
    await dhOutboxPut({ takeId: take.id, op: 'replace', storagePath: path, mimeType: 'audio/mp3', songId: take.songId, bytes: blob.size, duration, oldPath, tries: 0, createdAt: Date.now() });
    _wf.buffer = buffer; _wf.dur = buffer.duration; _wf.peaks = _computePeaks(buffer, 1400); _wf.sel = null; _wf.loopSel = false; _wf.playhead = 0; _wf.undo = undoBuffer ? { buffer: undoBuffer } : null;
    wfRender(); liteSyncDrain(); return true;
  } catch (e) {
    console.warn('[wf] replace', e);
    dhAudioDelete(take.id);
    if (_prevBufEntry) _bufCache[take.id] = _prevBufEntry; else delete _bufCache[take.id];
    toast(msg + ' failed'); return false;
  }
}
```
Note: on success the drain (Task 2) sets the new `storagePath`+`downloadUrl` and deletes `oldPath`. The local `take.storagePath` is updated by the snapshot when the doc is patched. Removed the inline upload + the `toast(msg+' ✓')`/`toast(msg+'…')` (the take row's pending badge now signals progress, consistent with the 1.065 toast removal); keep the failure toast.

- [ ] **Step 3: Run Task-4 asserts + full file** → all PASS.

- [ ] **Step 4: Commit**

```bash
git add lite-1.066.html _verify_lite_1066.js
git commit -m "feat(lite-1.066): doc-first trim via outbox (op:replace) — works offline, old file kept until re-upload"
```

---

### Task 5: Connection detection + offline pill

**Files:** Modify `lite-1.066.html` — add a `#offlinePill` element + CSS + `online`/`offline` listeners + boot drain. Test: add Task-5 asserts.

**Interfaces:** Produces `body.is-offline` toggling on connectivity; `online` fires `liteSyncDrain()` (with `_syncAnnounce=true`); a persistent "Offline" pill.

- [ ] **Step 1: Write the failing Task-5 asserts**

```js
  const t5 = await pg.evaluate(() => {
    const pill = document.getElementById('offlinePill');
    window.dispatchEvent(new Event('offline'));
    const offState = document.body.classList.contains('is-offline');
    window.dispatchEvent(new Event('online'));
    const onState = document.body.classList.contains('is-offline');
    return { pillExists: !!pill, offState, onCleared: onState === false };
  });
  ok(t5.pillExists, 'T5 #offlinePill element exists');
  ok(t5.offState, 'T5 offline event sets body.is-offline');
  ok(t5.onCleared, 'T5 online event clears body.is-offline');
```

- [ ] **Step 2: Add the pill element + CSS**

Add a body-level fixed pill (visible on any screen). Insert the element just inside `<body>` (or near the top-level app container) — find `<body` / the app root and add as a direct child:

```html
<div id="offlinePill" class="offline-pill">Offline</div>
```

CSS (add near the other top-level rules):

```css
.offline-pill { position: fixed; top: 8px; left: 50%; transform: translateX(-50%); z-index: 9960;
  background: #b3261e; color: #fff; font-size: 12px; font-weight: 600; padding: 4px 12px;
  border-radius: 999px; box-shadow: 0 2px 8px rgba(0,0,0,.25); display: none; pointer-events: none; }
body.is-offline .offline-pill { display: block; }
```

- [ ] **Step 3: Wire connectivity + boot drain**

Add (near boot, after `dhAudioSeedIndex()` / auth seed):

```js
function _liteUpdateOnline() { document.body.classList.toggle('is-offline', !navigator.onLine); }
window.addEventListener('offline', () => { _syncAnnounce = true; _liteUpdateOnline(); });
window.addEventListener('online', () => { _liteUpdateOnline(); liteSyncDrain(); });
document.addEventListener('visibilitychange', () => { if (!document.hidden) liteSyncDrain(); });
_liteUpdateOnline();
```

In the auth signed-in branch (where `dhAudioSeedIndex()` was added in Task 1), also call `liteSyncDrain();` (drain leftovers from a previous offline session on boot). Set `_syncAnnounce=true` when going offline so the next successful drain announces "Connection restored…".

- [ ] **Step 4: Run Task-5 asserts + full file** → all PASS.

- [ ] **Step 5: Commit**

```bash
git add lite-1.066.html _verify_lite_1066.js
git commit -m "feat(lite-1.066): offline pill + connectivity listeners + boot/foreground drain"
```

---

### Task 6: Per-take badge + manual retry + cross-device guard

**Files:** Modify `_takeRow` (search `function _takeRow`) and `_getBuffer` (search `async function _getBuffer`) in `lite-1.066.html`; add a `retryTake` global. Test: add Task-6 asserts.

**Interfaces:** Consumes `dhAudioHasLocal`, `liteSyncDrain`, the doc `pendingUpload` field. Produces the pending badge, the `↻` retry control, and a `_getBuffer` guard against `fetch(undefined)`.

- [ ] **Step 1: Write the failing Task-6 asserts**

```js
  const t6 = await pg.evaluate(async () => {
    // local pending (mine): has local blob → "Uploading…/On this device" + retry, NOT play-disabled
    await dhAudioPut('mine1', new Blob([new Uint8Array(4)]), { mimeType: 'audio/webm', pendingUpload: true });
    const mineHtml = _takeRow({ id: 'mine1', duration: 1, bytes: 4, mimeType: 'audio/webm', pendingUpload: true }, false);
    // remote pending (other device): no local blob, no downloadUrl → "uploading from another device" + play disabled
    const remoteHtml = _takeRow({ id: 'remote1', duration: 1, bytes: 4, mimeType: 'audio/webm', pendingUpload: true }, false);
    // normal existing take: no pending → no badge, normal
    const normalHtml = _takeRow({ id: 'norm1', duration: 1, bytes: 4, mimeType: 'audio/webm', downloadUrl: 'http://x/y' }, false);
    // _getBuffer guard: remote pending must NOT fetch(undefined)
    let fetched = false; const realFetch = window.fetch; window.fetch = () => { fetched = true; throw new Error('should not fetch'); };
    let threwGuard = false;
    try { await _getBuffer({ id: 'remote1', pendingUpload: true }); } catch (e) { threwGuard = true; }
    window.fetch = realFetch;
    await dhAudioDelete('mine1');
    return {
      mineBadge: /On this device|Uploading/.test(mineHtml), mineRetry: /retryTake/.test(mineHtml), mineNotDisabled: !/disabled/.test(mineHtml.split('class="play"')[0] + (mineHtml.match(/<button class="play"[^>]*>/) || [''])[0]),
      remoteAnother: /another device/.test(remoteHtml), remoteDisabled: /<button class="play"[^>]*disabled/.test(remoteHtml),
      normalClean: !/On this device|another device|Uploading/.test(normalHtml),
      guardNoFetch: fetched === false && threwGuard,
    };
  });
  ok(t6.mineBadge, 'T6 local pending take shows On this device/Uploading badge');
  ok(t6.mineRetry, 'T6 local pending take shows a ↻ retry control');
  ok(t6.remoteAnother, 'T6 remote pending take shows "uploading from another device"');
  ok(t6.remoteDisabled, 'T6 remote pending take has Play disabled');
  ok(t6.normalClean, 'T6 normal existing take shows no pending UI');
  ok(t6.guardNoFetch, 'T6 _getBuffer does not fetch(undefined) for a remote pending take');
```

- [ ] **Step 2: Add the `_getBuffer` guard**

In `_getBuffer`, replace the `else { fetch... }` branch guard so a missing `downloadUrl` with no local blob throws cleanly instead of `fetch(undefined)`:

```js
  const local = await dhAudioGet(take.id);   // IndexedDB-first
  if (local) { ab = await local.arrayBuffer(); dhAudioTouch(take.id); }
  else {
    if (!take.downloadUrl) throw new Error('pending-remote'); // pending upload from another device — not playable yet
    const resp = await fetch(take.downloadUrl);
    ab = await resp.arrayBuffer();
    dhAudioPut(take.id, new Blob([ab], { type: take.mimeType || '' }), { mimeType: take.mimeType }).catch(() => {});
  }
```

- [ ] **Step 3: Update `_takeRow` for pending state + retry**

Replace the `.sub` line and the Play button. A take is **pending-mine** when `t.pendingUpload && dhAudioHasLocal(t.id)` (playable locally); **pending-remote** when `t.pendingUpload && !dhAudioHasLocal(t.id)` (not playable here). Compute once at the top of `_takeRow`:

```js
function _takeRow(t, isPinned) {
  const playing = _playingTakeId === t.id, sel = _loadedTakeId === t.id, looping = _loopTakes.has(t.id);
  const dur = t.duration ? _fmtClock(t.duration) : '';
  const info = [dur, _takeFmtLabel(t), _fmtBytes(t.bytes)].filter(Boolean).join(' · ');
  const pendMine = !!t.pendingUpload && dhAudioHasLocal(t.id);
  const pendRemote = !!t.pendingUpload && !dhAudioHasLocal(t.id);
  const statusSub = pendRemote ? ' · uploading from another device…'
    : pendMine ? (navigator.onLine ? ' · Uploading…' : ' · On this device')
    : (sel ? ' · loaded' : '');
  const retryBtn = pendMine ? `<button class="take-retry" onclick="retryTake('${t.id}',event)" title="Retry upload" aria-label="Retry upload">↻</button>` : '';
  return `<div class="take-row" data-id="${t.id}">
    <div class="take-swipe">
      <div class="take-actions">
        <button class="act-pin-take" onclick="toggleTakePin('${t.id}',event)">📌<span>${isPinned ? 'Unpin' : 'Pin'}</span></button>
        <button onclick="deleteTake('${t.id}',event)">🗑<span>Delete</span></button>
      </div>
      <div class="take-card ${sel ? 'sel' : ''} ${playing ? 'playing' : ''}" onclick="selectTake('${t.id}')">
        ${isPinned ? '<span class="drag-handle take-grip" onclick="event.stopPropagation()" aria-label="Reorder">≡</span>' : ''}
        <button class="play" onclick="takeRowPlay('${t.id}',event)" ${pendRemote ? 'disabled' : ''}>${playing ? '⏹' : '▶'}</button>
        <div class="meta">
          <div class="nm">${esc(takeDisplayName(t, true))}</div>
          <div class="sub">${info}${statusSub}</div>
        </div>
        ${retryBtn}
        <button class="take-edit" onclick="startRename('${t.id}', this.closest('.take-card').querySelector('.nm'), event)" title="Rename take" aria-label="Rename take">${PENCIL_SVG}</button>
        <button class="loop ${looping ? 'on' : ''}" onclick="toggleLoop('${t.id}',event)" aria-label="Loop">${LOOP_SVG}</button>
        <button class="take-pin-desktop" onclick="toggleTakePin('${t.id}',event)" title="${isPinned ? 'Unpin' : 'Pin'}" style="opacity:${isPinned ? 1 : 0.4}">📌</button>
        <button class="take-del-desktop" onclick="deleteTake('${t.id}',event)" title="Delete take" aria-label="Delete take">${TRASH_SVG}</button>
      </div>
    </div>
    ${sel ? '<div class="take-wave" data-wave-host="row"></div>' : ''}
  </div>`;
}
```

Add the `retryTake` global (near `selectTake`/`toggleLoop`):

```js
function retryTake(id, ev) { if (ev) ev.stopPropagation(); _syncAnnounce = false; liteSyncDrain(); }
```

Add CSS for `.take-retry` (mirror `.take-edit` sizing; a tappable icon button).

Also guard play: in `takeRowPlay`/`selectTake` (or `wfLoad`), a `_getBuffer` that throws `pending-remote` must be caught so the UI shows the not-playable state instead of an unhandled rejection — confirm `wfLoad`'s existing `try/catch` (it has one: `catch (e) { console.warn('[wf] load', e); }`) already swallows it; the disabled Play button prevents `takeRowPlay`. Name this check in the report.

- [ ] **Step 4: Run Task-6 asserts + full file** → all PASS.

- [ ] **Step 5: Commit**

```bash
git add lite-1.066.html _verify_lite_1066.js
git commit -m "feat(lite-1.066): per-take pending badge + retry + cross-device play guard"
```

---

### Task 7: No-harm regression + integration

**Files:** Test only — `_verify_lite_1066.js`. (If an assert fails, fix the offending earlier task; do not silently patch.)

- [ ] **Step 1: Write the no-harm + integration asserts**

```js
  // ── No-harm: existing take (downloadUrl, no pendingUpload) unchanged through new paths ──
  const t7 = await pg.evaluate(async () => {
    const existing = { id: 'legacy1', songId: 's', bytes: 500, storagePath: 'voice_takes/s/legacy.webm', downloadUrl: 'http://x/legacy.webm', mimeType: 'audio/webm', duration: 3 };
    const before = JSON.stringify(existing);
    const row = _takeRow(existing, false);
    // existing take: no pending UI, play enabled, served via fetch (not outbox)
    const noPendingUI = !/uploading|On this device|Uploading/i.test(row);
    const playEnabled = !/<button class="play"[^>]*disabled/.test(row);
    const job = await dhOutboxGet('legacy1'); // never enqueued
    const unchanged = JSON.stringify(existing) === before;
    // _getBuffer for an existing take still fetches its downloadUrl
    let fetched = false; const realFetch = window.fetch;
    window.fetch = async () => { fetched = true; return { arrayBuffer: async () => { const r=8000,n=400,b=new ArrayBuffer(44+n*2),v=new DataView(b);const wr=(o,s)=>{for(let i=0;i<s.length;i++)v.setUint8(o+i,s.charCodeAt(i));};wr(0,'RIFF');v.setUint32(4,36+n*2,true);wr(8,'WAVE');wr(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,r,true);v.setUint32(28,r*2,true);v.setUint16(32,2,true);v.setUint16(34,16,true);wr(36,'data');v.setUint32(40,n*2,true);for(let i=0;i<n;i++)v.setInt16(44+i*2,1000,true);return b; } }; };
    delete _bufCache['legacy1'];
    const entry = await _getBuffer(existing);
    window.fetch = realFetch; delete _bufCache['legacy1']; await dhAudioDelete('legacy1');
    return { noPendingUI, playEnabled, jobNever: job === null, unchanged, fetched, decoded: !!(entry && entry.buffer) };
  });
  ok(t7.noPendingUI, 'T7 existing take shows no pending UI');
  ok(t7.playEnabled, 'T7 existing take Play is enabled');
  ok(t7.jobNever, 'T7 existing take never gets an outbox job');
  ok(t7.unchanged, 'T7 existing take object is not mutated by render');
  ok(t7.fetched && t7.decoded, 'T7 existing take still fetches+decodes via downloadUrl (no-harm)');

  // ── Integration: offline record → online drain → take becomes synced ──
  const t8 = await pg.evaluate(async () => {
    stopTakesListener(); _takes = []; _loadedTakeId = null;
    let docState = {};
    const origColl = db.collection.bind(db);
    db.collection = (n) => n === 'voice_takes' ? { doc: (id) => { const did = id || ('g_' + Math.random().toString(36).slice(2)); return { id: did, set: async (d) => { docState[did] = Object.assign(docState[did] || {}, d); } }; } } : origColl(n);
    const origRef = firebase.storage().ref.bind(firebase.storage());
    let uploads = 0;
    firebase.storage().ref = () => ({ put: async () => { uploads++; return { ref: { getDownloadURL: async () => 'http://x/synced.webm' } }; }, delete: async () => {} });
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => false });
    await uploadTake(new Blob([new Uint8Array(1024)], { type: 'audio/webm' }), 'audio/webm', 1.0);
    const id = _loadedTakeId; const offlineNoUpload = uploads === 0;
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => true });
    _syncAnnounce = true;
    await liteSyncDrain();
    const jobGone = (await dhOutboxGet(id)) === null;
    db.collection = origColl; firebase.storage().ref = origRef; await dhAudioDelete(id);
    return { offlineNoUpload, uploadedOnReconnect: uploads === 1, synced: docState[id] && docState[id].downloadUrl === 'http://x/synced.webm' && docState[id].pendingUpload === false, jobGone };
  });
  ok(t8.offlineNoUpload, 'T8 record offline attempts no upload');
  ok(t8.uploadedOnReconnect, 'T8 reconnect drains + uploads exactly once');
  ok(t8.synced, 'T8 after drain the doc has downloadUrl + pendingUpload:false');
  ok(t8.jobGone, 'T8 outbox empties after successful drain');
```

- [ ] **Step 2: Run the full suite + churn check**

Run: `node _verify_lite_1066.js > /tmp/v1066.txt 2>&1; cat /tmp/v1066.txt`
Expected: all asserts PASS (Tasks 1–7).
Churn: `diff lite-1.065.html lite-1.066.html` — confirm changes confined to: boot (persistence + listeners + pill element/CSS + seed/drain), the `dhAudio*`/outbox module, `liteSyncDrain`, `uploadTake`, `_wfReplaceAudio`, `_takeRow`, `_getBuffer`, `retryTake`/`_localBlobIds`. Report anything outside these.

- [ ] **Step 3: Commit**

```bash
git add _verify_lite_1066.js
git commit -m "test(lite-1.066): no-harm regression (existing takes) + offline→reconnect integration"
```

---

## Self-Review

**Spec coverage:**
- enablePersistence at boot, before first use, reject-safe → Task 1 (+ asserted). ✓
- Outbox store (additive v2 upgrade) + helpers + `dhAudioSetPending` + local-blob index → Task 1. ✓
- Sync engine (single-flight, upload→patch→delete→clear pending, retry-forever, resync toast) → Task 2. ✓
- Doc-first `uploadTake` (pendingUpload, no url, outbox, kick drain) → Task 3. ✓
- Doc-first trim `op:'replace'` (keeps old url, deletes old file post-upload) → Task 4. ✓
- Offline pill + connectivity listeners + foreground/boot drain → Task 5. ✓
- Per-take badge (mine vs remote via `dhAudioHasLocal`) + `↻` retry + `_getBuffer` cross-device guard + Play disable → Task 6. ✓
- Data-safety invariants + mandatory no-harm regression + offline→reconnect integration → Task 7. ✓
- Cap gate preserved (Task 3 keeps `liteUsageOver()`); revert-safe file copy (Task 1 Step 1 + Task 7 churn). ✓

**Placeholder scan:** none — every code step has complete code; commands show expected output.

**Type/name consistency:** `dhOutboxPut/Get/All/Delete`, `dhAudioSetPending`, `dhAudioHasLocal`, `dhAudioSeedIndex`, `_localBlobIds`, `liteSyncDrain`, `_syncing`, `_syncAnnounce`, `_liteUpdateOnline`, `retryTake`, `pendingUpload`, job fields (`takeId/op/storagePath/mimeType/songId/bytes/duration/oldPath/tries/createdAt`) used consistently across tasks.

## Verification note

Run `_verify_lite_1066.js` once to a file. Stub `navigator.onLine` via `Object.defineProperty(window.navigator,'onLine',{configurable:true,get:...})` and restore by redefining `get:()=>true` (don't leave it stuck offline between blocks). Stub `db.collection` directly (not `db.collection('x').doc`) since `collection()` returns a fresh object per call (the 1.064 lesson). Call `stopTakesListener()` before injecting `_takes`. Drain/outbox/persistence asserts need no auth; doc-first record/trim blocks reuse the signed-in guest page.
