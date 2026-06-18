# Lite Optimistic Record Playback — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make a just-recorded take render and play **instantly** from its local IndexedDB blob, without waiting for the cloud upload, by rendering an optimistic take entry in `uploadTake`. Build `lite-1.064.html` from `lite-1.063.html`.

**Architecture:** After caching the recorded blob, `uploadTake` inserts an optimistic in-memory take object (no `downloadUrl`, marked `_pendingLocal`) at the head of `_takes`, selects it, and renders + loads its waveform immediately (served from IndexedDB). The existing background upload + `ref.set` then run unchanged; the `onSnapshot` listener reconciles the optimistic entry with the real server doc on success, and the `catch` cleanly removes it on failure.

**Tech Stack:** Vanilla JS, Web Audio, Firebase v10 compat, IndexedDB. Single-file HTML. Headless verify via playwright-core + installed Chrome.

## Global Constraints

- **App file:** all work in `lite-1.064.html` (a copy of `lite-1.063.html`). Never touch `index.html`/`full.html`/`1.3xx.html`. Promote into `index.html` only after on-device sign-off (NOT part of this plan).
- **Base:** `lite-1.063.html` (md5 `b90df03c33d997ab3d2b122b979fb351`). Confirm via `md5 -q lite-1.063.html` before copying; `diff -q` the copy.
- **Data-safety (hard):** the optimistic entry is transient/in-memory; nothing is persisted until the real `ref.set`. On failure nothing is written to Firestore/Storage and the local blob is removed (`dhAudioDelete`) — no orphan doc, no data loss. Cloud stays source of truth; existing takes/lyrics untouched; all Firestore writes additive + `{merge:true}`.
- **Preserve every existing `uploadTake` behavior:** the `!song || !uid()` guard, the `liteUsageOver()` cap gate, the pre-generated `ref`/`id`, `dhAudioPut`, the full `ref.set` field set, `_liteAddBytes(blob.size)`, the `songs.updatedAt` merge, and all four `recToast` messages (`Saving take…`, `Take saved ✓`, the cap message, `Save failed — check connection`).
- **Verify:** headless `_verify_lite_1064.js` over real HTTP via playwright-core + installed Chrome. Run ONCE to a file and parse (anon-auth rate-limit). Assert COMPUTED state.

---

### Task 1: Optimistic record render + failure rollback + Saving badge

**Files:**
- Create: `lite-1.064.html` (copy of `lite-1.063.html`).
- Modify in `lite-1.064.html`: `uploadTake` (find by searching `async function uploadTake`) and `_takeRow` (find by searching `function _takeRow`).
- Create/Modify: `_verify_lite_1064.js`.

**Interfaces:**
- Consumes (already present): `dhAudioPut`, `dhAudioGet`, `dhAudioDelete`; `renderTakes()`, `updateRail()`, `wfLoad(take)`; module globals `_takes`, `_loadedTakeId`, `_selectNewest`, `_wf`.
- Produces: `uploadTake` renders an optimistic take before the upload; `_takeRow` shows `· Saving…` when `take._pendingLocal`.

- [ ] **Step 1: Create the working file**

```bash
md5 -q lite-1.063.html   # expect b90df03c33d997ab3d2b122b979fb351
cp lite-1.063.html lite-1.064.html
diff -q lite-1.063.html lite-1.064.html && echo "COPY OK"
```
Expected: md5 matches, then `COPY OK`.

- [ ] **Step 2: Write the failing test harness + Task-1 asserts**

Create `_verify_lite_1064.js` by copying the structure of `_verify_lite_1063.js` (same local HTTP server, installed-Chrome launch, EULA bypass, the guest sign-in + create/open-song recipe it already uses — reuse those helpers verbatim, just navigate to `/lite-1.064.html`). Keep the existing 1063 asserts that still apply OR start fresh with the three optimistic asserts below — at minimum include these three, driven on a signed-in page with a loaded `_currentSong`:

```js
  // ── Optimistic instant play: UI + playback do NOT wait on the upload ──
  // Stub Storage .put to hang forever; uploadTake must still render + load the take.
  const o1 = await pg.evaluate(async () => {
    stopTakesListener();               // prevent the live snapshot from clobbering _takes
    _takes = []; _loadedTakeId = null;
    const origRef = firebase.storage().ref.bind(firebase.storage());
    firebase.storage().ref = () => ({ put: () => new Promise(() => {}) , delete: () => Promise.resolve() });
    const blob = new Blob([new Uint8Array(4096)], { type: 'audio/webm' });
    uploadTake(blob, 'audio/webm', 1.0);            // not awaited — upload hangs
    await new Promise(r => setTimeout(r, 250));      // local path completes well within this
    const id = _loadedTakeId;
    const inList = !!_takes.find(t => t.id === id);
    const wfLoaded = _wf.takeId === id;
    let playable = false;
    try { const buf = await dhAudioGet(id); playable = !!buf && buf.size > 0; } catch (e) {}
    firebase.storage().ref = origRef;
    return { hasId: !!id, inList, wfLoaded, playable };
  });
  ok(o1.hasId,    'OPT _loadedTakeId set immediately after record');
  ok(o1.inList,   'OPT optimistic take is in _takes before upload resolves');
  ok(o1.wfLoaded, 'OPT waveform loaded (_wf.takeId) for the optimistic take');
  ok(o1.playable, 'OPT take audio is playable from IndexedDB while upload hangs');

  // ── Clean failure rollback: rejecting upload removes the optimistic take + blob ──
  const o2 = await pg.evaluate(async () => {
    stopTakesListener(); _takes = []; _loadedTakeId = null;
    const origRef = firebase.storage().ref.bind(firebase.storage());
    firebase.storage().ref = () => ({ put: () => Promise.reject(new Error('net down')), delete: () => Promise.resolve() });
    const blob = new Blob([new Uint8Array(4096)], { type: 'audio/webm' });
    await uploadTake(blob, 'audio/webm', 1.0);       // awaited — runs through the catch
    const id0 = _takes.length ? _takes[0].id : null; // should be empty
    // capture the id that was optimistically used by inspecting leftover cache: none should remain
    const removed = _takes.length === 0;
    firebase.storage().ref = origRef;
    return { removed, loadedReset: _loadedTakeId === null };
  });
  ok(o2.removed,      'OPT failed upload removes the optimistic take from _takes');
  ok(o2.loadedReset,  'OPT failed upload resets _loadedTakeId');

  // ── Saving badge: optimistic row shows "Saving…"; a reconciled take does not ──
  const o3 = await pg.evaluate(() => {
    const optHtml = _takeRow({ id: 'x1', duration: 1, bytes: 4096, mimeType: 'audio/webm', _pendingLocal: true }, false);
    const realHtml = _takeRow({ id: 'x1', duration: 1, bytes: 4096, mimeType: 'audio/webm', downloadUrl: 'http://x/y' }, false);
    return { optHasSaving: /Saving/.test(optHtml), realHasSaving: /Saving/.test(realHtml) };
  });
  ok(o3.optHasSaving,  'OPT optimistic take row shows "Saving…"');
  ok(!o3.realHasSaving, 'OPT reconciled (non-pending) take row does not show "Saving…"');
```

Run: `node _verify_lite_1064.js > /tmp/v1064.txt 2>&1; cat /tmp/v1064.txt`
Expected: FAIL — current `uploadTake` does not render an optimistic take (the take only appears after the hung upload), so `inList`/`wfLoaded`/`playable` fail; `_takeRow` has no Saving badge.

- [ ] **Step 3: Modify `_takeRow` to show the Saving badge**

Find the `.sub` info line in `_takeRow` (currently builds `info` from `[dur, _takeFmtLabel(t), _fmtBytes(t.bytes)]` and renders `<div class="sub">${info}${sel ? ' · loaded' : ''}</div>`). Add a pending marker so it reads:

```js
        <div class="sub">${info}${t._pendingLocal ? ' · Saving…' : (sel ? ' · loaded' : '')}</div>
```

(When `_pendingLocal`, show `Saving…` instead of `loaded`; once reconciled the flag is gone and normal `loaded` shows.)

- [ ] **Step 4: Modify `uploadTake` to render optimistically**

Replace `uploadTake`'s body so the optimistic render happens right after `dhAudioPut`, and the `catch` rolls back the optimistic entry. Full function:

```js
async function uploadTake(blob, mime, dur) {
  const song = _currentSong;
  if (!song || !uid()) { recToast('Not signed in'); return; }
  if (liteUsageOver()) { recToast(liteCapMessage(), 3200); return; }
  // Pre-generate the take ID so one ID keys the local blob, the doc, and the Storage path.
  const ref = db.collection('voice_takes').doc();
  const id = ref.id;
  const ext = mime.includes('webm') ? 'webm' : mime.includes('mp4') ? 'm4a' : 'ogg';
  const fname = 'take_' + Date.now() + '.' + ext;
  const path = 'voice_takes/' + song.id + '/' + fname;
  // ── Instant local playback: cache the blob, then OPTIMISTICALLY render the take
  //    from that local blob so the UI + playback do not wait on the upload. ──
  await dhAudioPut(id, blob, { mimeType: mime });
  const optimistic = {
    id, songId: song.id, userId: uid(), filename: fname, storagePath: path,
    duration: Math.round(dur), mimeType: mime, trackNum: 0, bytes: blob.size,
    createdAt: Date.now(), _pendingLocal: true,
  };
  _takes = [optimistic, ..._takes.filter(t => t.id !== id)];
  _selectNewest = false; _loadedTakeId = id;
  renderTakes(); updateRail(); wfLoad(optimistic);
  // ── Background upload + doc write (the real persistence) ──
  recToast('Saving take…', 1500);
  try {
    const snap = await firebase.storage().ref(path).put(blob, { contentType: mime });
    const url = await snap.ref.getDownloadURL();
    await ref.set({
      songId: song.id, userId: uid(), filename: fname, storagePath: path,
      downloadUrl: url, duration: Math.round(dur), mimeType: mime, trackNum: 0,
      bytes: blob.size,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    _liteAddBytes(blob.size);
    db.collection('songs').doc(song.id).set({ updatedAt: Date.now() }, { merge: true }).catch(() => {});
    recToast('Take saved ✓');
  } catch (e) {
    console.warn('[upload]', e);
    dhAudioDelete(id);
    _takes = _takes.filter(t => t.id !== id);
    if (_loadedTakeId === id) _loadedTakeId = _takes[0] ? _takes[0].id : null;
    renderTakes(); updateRail();
    recToast('Save failed — check connection');
  }
}
```

Notes:
- On **success**, the `voice_takes` `onSnapshot` listener fires after `ref.set` and rebuilds `_takes` from the server docs; the optimistic entry (same `id`, no `_pendingLocal`) is replaced by the real doc. Because `_wf.takeId` is already `id`, `wfLoad` re-renders without refetching (it serves from `_bufCache`/IndexedDB).
- On **failure** nothing was persisted; the optimistic entry and the local blob are removed. Identical net effect to today's failure path, plus the UI cleanup.
- `createdAt: Date.now()` (a number) on the optimistic entry sorts newest-first locally; the server doc uses `serverTimestamp()`. The listener's `_ms()` handles both.

- [ ] **Step 5: Run the suite**

Run: `node _verify_lite_1064.js > /tmp/v1064.txt 2>&1; cat /tmp/v1064.txt`
Expected: all optimistic asserts PASS, `N PASS / 0 FAIL` (report the count). If guest sign-in is rate-limited and you can't get a green run after a short wait, report DONE_WITH_CONCERNS with the code applied; do NOT hammer auth.

- [ ] **Step 6: Churn check + commit**

```bash
diff lite-1.063.html lite-1.064.html   # changes confined to uploadTake + _takeRow only
git add lite-1.064.html _verify_lite_1064.js
git commit -m "feat(lite-1.064): optimistic record render — instant play before upload"
```
Confirm the diff shows ONLY the `uploadTake` and `_takeRow` regions changed; report anything else.

---

## Self-Review

**Spec coverage (addendum):**
- Optimistic in-memory take inserted + selected + waveform loaded before upload → Step 4. ✓
- Plays from IndexedDB with zero network → Step 4 (`wfLoad`→`_getBuffer` IDB-first, already in 1.063) + asserted Step 2 (`playable` while upload hangs). ✓
- Success reconciliation via existing snapshot listener (no code needed) → documented Step 4 notes. ✓
- Failure rollback (remove optimistic + `dhAudioDelete` + reset selection) → Step 4 catch + asserted Step 2 (o2). ✓
- `· Saving…` badge → Step 3 + asserted (o3). ✓
- All prior `uploadTake` behavior preserved (guards, cap gate, field set, toasts, bytes) → Step 4 keeps them verbatim. ✓
- Revert-safe file-copy snapshot; `index.html`/`full.html` untouched → Step 1 + churn check Step 6. ✓

**Placeholder scan:** none — every code step shows complete code; commands show expected output.

**Type/name consistency:** `uploadTake`, `_takeRow`, `_takes`, `_loadedTakeId`, `_wf.takeId`, `dhAudioPut/Get/Delete`, `renderTakes/updateRail/wfLoad`, `_pendingLocal` used consistently.

## Verification note

Run `_verify_lite_1064.js` once to a file. The optimistic asserts call `stopTakesListener()` before injecting `_takes` so the live `voice_takes` snapshot (which fires empty for a fresh guest) can't clobber the injected state — same race guard used in the 1.063 suite.
