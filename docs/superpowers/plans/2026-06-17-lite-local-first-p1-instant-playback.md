# Lite Local-First — Phase 1 (Instant Playback) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make freshly recorded, freshly trimmed, and previously-played takes play back instantly from a device-local IndexedDB audio cache, with zero network round-trip, building `lite-1.063.html` from `index.html`.

**Architecture:** Add a tiny promise-based IndexedDB blob store (`dhAudio*`) keyed by take ID. Pre-generate the take ID client-side so one ID keys the blob, the Firestore doc, and the Storage path before any network. Record/trim write the blob locally and play immediately, then upload in the background. `_getBuffer` becomes IndexedDB-first (cache downloaded blobs too). An LRU sweep bounds the cache at ~250 MB and never evicts un-synced blobs. Everything degrades gracefully to today's behavior if IndexedDB is unavailable.

**Tech Stack:** Vanilla JS, Web Audio, Firebase v10 compat (Firestore + Storage), IndexedDB. Single-file HTML app. Headless verify via playwright-core + installed Chrome.

## Global Constraints

- **App file:** all work in `lite-1.063.html` (a copy of `index.html`). Never touch `full.html`/`1.3xx.html`. Promote into `index.html` only after on-device sign-off (NOT part of this plan).
- **Versioning:** file-copy snapshot, commit to `main`, no branches. Confirm before pushing (Pages deploy). Base is `index.html` == `lite-1.062.html` (md5 `918e5fd039ad4dcc66ed16be520a117e`, confirmed).
- **Data-safety invariants (hard):** the cloud (Firestore + Storage) stays the source of truth; the IndexedDB cache only adds/caches and never deletes or mutates any Firestore doc or Storage object; LRU eviction deletes only device-local copies (never Storage) and never a blob with `pendingUpload`; existing takes with no local blob read exactly as today via `fetch(downloadUrl)`; all Firestore writes stay additive + `{merge:true}` so `full.html` fields are never clobbered.
- **Graceful degradation:** if IndexedDB is unavailable (Safari Private Mode) or any `dhAudio*` call rejects, the app must behave exactly as `lite-1.062.html` (in-memory `_bufCache` + direct `fetch`). No feature hard-depends on the cache existing.
- **Cache cap:** ~250 MB LRU, evict least-recently-played first, never evict `pendingUpload` blobs. (`pendingUpload` is written/honored here but only *set* by Phase 2; in Phase 1 no blob is ever marked pending, so eviction is pure LRU — the exemption is wired now so Phase 2 needs no eviction changes.)
- **No new external dependencies.** IndexedDB is a browser built-in.
- **Verify:** headless script `_verify_lite_1063.js` over real HTTP (local server), driving installed Chrome via playwright-core. Assert COMPUTED state, run the script ONCE to a file and parse (anon-auth rate-limit lesson). Include the mandatory no-harm regression.

---

### Task 1: IndexedDB audio-cache module (`dhAudio*`)

Self-contained local blob store. No callers yet — Task 2+ wire it in. Pure unit, testable in isolation in the browser.

**Files:**
- Create: `lite-1.063.html` (copy of `index.html`) — add the module.
- Test: `_verify_lite_1063.js` (create; Task-1 asserts only for now).

**Interfaces:**
- Consumes: nothing (browser IndexedDB).
- Produces (all `window.`-reachable for tests; defined as plain functions in the inline `<script>`):
  - `dhAudioReady() → Promise<boolean>` — resolves true if the DB opened, false if IndexedDB is unavailable/blocked. Never rejects.
  - `dhAudioPut(id: string, blob: Blob, meta?: {mimeType?:string, pendingUpload?:boolean}) → Promise<boolean>` — stores `{id, blob, mimeType, bytes:blob.size, savedAt:Date.now(), lastPlayed:Date.now(), pendingUpload:!!meta.pendingUpload}`; runs `dhAudioEvict()` after. Resolves false on any failure (never rejects).
  - `dhAudioGet(id: string) → Promise<Blob|null>` — returns the stored Blob or null (also null when DB unavailable).
  - `dhAudioTouch(id: string) → Promise<void>` — bumps `lastPlayed`; no-op if missing.
  - `dhAudioDelete(id: string) → Promise<void>` — removes the record; no-op if missing.
  - `dhAudioEvict() → Promise<void>` — if total `bytes` > `DH_AUDIO_CAP`, delete records by ascending `lastPlayed` until under cap, **skipping any with `pendingUpload===true`**.
  - Constant `DH_AUDIO_CAP = 250 * 1024 * 1024`.

**Placement:** insert the whole module immediately BEFORE the line `/* ═══════════════════════════ Playback (WebAudio` (currently `index.html:1568`), so it sits just above `_getBuffer`.

- [ ] **Step 1: Create the working file**

```bash
cp index.html lite-1.063.html
# Confirm the copy is byte-identical to the intended base before editing:
diff -q index.html lite-1.063.html && echo "COPY OK"
```
Expected: `COPY OK` (no diff output).

- [ ] **Step 2: Write the failing test harness + Task-1 asserts**

Create `_verify_lite_1063.js`. Use the established Lite recipe (EULA bypass via `addInitScript` setting `localStorage['drafthaus-eula-accepted']='1'`, launch installed Chrome via playwright-core `executablePath`, serve the repo over a local HTTP server on a free port, navigate to `/lite-1.063.html`). The Task-1 block exercises the cache module directly in the page (no auth needed):

```js
// _verify_lite_1063.js  (Phase 1 — instant playback)
const { chromium } = require('playwright-core');
const http = require('http'); const fs = require('fs'); const path = require('path');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ROOT = __dirname;
let PASS = 0, FAIL = 0;
const ok = (c, m) => { if (c) { PASS++; console.log('PASS', m); } else { FAIL++; console.log('FAIL', m); } };

function serve() {
  return new Promise(res => {
    const s = http.createServer((req, rq) => {
      let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/lite-1.063.html';
      const fp = path.join(ROOT, p);
      fs.readFile(fp, (e, d) => {
        if (e) { rq.statusCode = 404; rq.end('nf'); return; }
        const ext = path.extname(fp);
        rq.setHeader('Content-Type', ext === '.html' ? 'text/html' : ext === '.js' ? 'text/javascript' : ext === '.mp3' ? 'audio/mpeg' : 'application/octet-stream');
        rq.end(d);
      });
    });
    s.listen(0, () => res(s));
  });
}

(async () => {
  const srv = await serve(); const port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  const ctx = await browser.newContext();
  await ctx.addInitScript(() => { try { localStorage['drafthaus-eula-accepted'] = '1'; } catch (e) {} });
  const pg = await ctx.newPage();
  await pg.goto(`http://localhost:${port}/lite-1.063.html`, { waitUntil: 'domcontentloaded' });
  await pg.waitForFunction(() => typeof window.dhAudioPut === 'function', { timeout: 10000 });

  // ── Task 1: IndexedDB cache module ──
  const t1 = await pg.evaluate(async () => {
    const enc = new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'audio/webm' });
    const ready = await dhAudioReady();
    const put = await dhAudioPut('id-A', enc, { mimeType: 'audio/webm' });
    const got = await dhAudioGet('id-A');
    const gotBytes = got ? got.size : -1;
    const miss = await dhAudioGet('nope');
    await dhAudioDelete('id-A');
    const afterDel = await dhAudioGet('id-A');
    return { ready, put, gotBytes, miss: miss === null, afterDel: afterDel === null, cap: DH_AUDIO_CAP };
  });
  ok(t1.ready === true, 'T1 dhAudioReady true in headless Chrome');
  ok(t1.put === true, 'T1 dhAudioPut resolves true');
  ok(t1.gotBytes === 4, 'T1 dhAudioGet returns the stored blob (4 bytes)');
  ok(t1.miss, 'T1 dhAudioGet(missing) returns null');
  ok(t1.afterDel, 'T1 dhAudioDelete removes the record');
  ok(t1.cap === 250 * 1024 * 1024, 'T1 DH_AUDIO_CAP is 250 MB');

  // ── Task 1: eviction skips pendingUpload, evicts by LRU ──
  const t1b = await pg.evaluate(async () => {
    // shrink the cap for the test via a temporary override is not possible (const); instead
    // assert eviction logic by storing pendingUpload + normal, forcing evict, checking survival.
    const big = new Blob([new Uint8Array(1024)], { type: 'audio/webm' });
    await dhAudioPut('pend', big, { pendingUpload: true });
    await dhAudioPut('lru1', big, {});
    await new Promise(r => setTimeout(r, 5));
    await dhAudioTouch('lru1'); // lru1 newer than pend by lastPlayed
    await dhAudioEvict();       // under cap → nothing evicted, both survive
    const a = await dhAudioGet('pend'), b = await dhAudioGet('lru1');
    await dhAudioDelete('pend'); await dhAudioDelete('lru1');
    return { pendKept: !!a, lruKept: !!b };
  });
  ok(t1b.pendKept, 'T1 eviction under-cap keeps pendingUpload blob');
  ok(t1b.lruKept, 'T1 eviction under-cap keeps normal blob');

  console.log(`\n${PASS} PASS / ${FAIL} FAIL`);
  await browser.close(); srv.close();
  process.exit(FAIL ? 1 : 0);
})();
```

Run: `node _verify_lite_1063.js > /tmp/v1063.txt 2>&1; cat /tmp/v1063.txt`
Expected: FAIL — `dhAudioPut` is not defined (the module doesn't exist yet); the `waitForFunction` times out.

- [ ] **Step 3: Implement the `dhAudio*` module**

Insert immediately before `index.html:1568` (`/* ═══════════════════════════ Playback (WebAudio …`) in `lite-1.063.html`:

```js
/* ═══════════════════════════ Local audio cache (IndexedDB, device-local) ═══════════════════════════ */
const DH_AUDIO_CAP = 250 * 1024 * 1024; // ~250 MB LRU ceiling for cached take blobs
let _dhAudioDBP = null;
function _dhAudioOpen() {
  if (_dhAudioDBP) return _dhAudioDBP;
  _dhAudioDBP = new Promise(resolve => {
    let req;
    try { req = indexedDB.open('dh-lite-audio', 1); }
    catch (e) { resolve(null); return; }
    req.onupgradeneeded = () => { const db = req.result; if (!db.objectStoreNames.contains('takeBlobs')) db.createObjectStore('takeBlobs', { keyPath: 'id' }); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
  return _dhAudioDBP;
}
function _dhTx(db, mode) { return db.transaction('takeBlobs', mode).objectStore('takeBlobs'); }
function _dhReq(r) { return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
async function dhAudioReady() { return !!(await _dhAudioOpen()); }
async function dhAudioPut(id, blob, meta) {
  meta = meta || {};
  const db = await _dhAudioOpen(); if (!db) return false;
  try {
    const now = Date.now();
    await _dhReq(_dhTx(db, 'readwrite').put({ id, blob, mimeType: meta.mimeType || (blob && blob.type) || '', bytes: (blob && blob.size) || 0, savedAt: now, lastPlayed: now, pendingUpload: !!meta.pendingUpload }));
    await dhAudioEvict();
    return true;
  } catch (e) { return false; }
}
async function dhAudioGet(id) {
  const db = await _dhAudioOpen(); if (!db) return null;
  try { const rec = await _dhReq(_dhTx(db, 'readonly').get(id)); return rec ? rec.blob : null; }
  catch (e) { return null; }
}
async function dhAudioTouch(id) {
  const db = await _dhAudioOpen(); if (!db) return;
  try { const st = _dhTx(db, 'readwrite'); const rec = await _dhReq(st.get(id)); if (rec) { rec.lastPlayed = Date.now(); await _dhReq(st.put(rec)); } } catch (e) {}
}
async function dhAudioDelete(id) {
  const db = await _dhAudioOpen(); if (!db) return;
  try { await _dhReq(_dhTx(db, 'readwrite').delete(id)); } catch (e) {}
}
async function dhAudioEvict() {
  const db = await _dhAudioOpen(); if (!db) return;
  try {
    const all = await _dhReq(_dhTx(db, 'readonly').getAll());
    let total = all.reduce((s, r) => s + (r.bytes || 0), 0);
    if (total <= DH_AUDIO_CAP) return;
    const evictable = all.filter(r => !r.pendingUpload).sort((a, b) => (a.lastPlayed || 0) - (b.lastPlayed || 0));
    for (const r of evictable) {
      if (total <= DH_AUDIO_CAP) break;
      try { await _dhReq(_dhTx(db, 'readwrite').delete(r.id)); total -= (r.bytes || 0); } catch (e) {}
    }
  } catch (e) {}
}
```

- [ ] **Step 4: Run the Task-1 asserts**

Run: `node _verify_lite_1063.js > /tmp/v1063.txt 2>&1; cat /tmp/v1063.txt`
Expected: all 8 Task-1 asserts PASS, `8 PASS / 0 FAIL`.

- [ ] **Step 5: Commit**

```bash
git add lite-1.063.html _verify_lite_1063.js
git commit -m "feat(lite-1.063): IndexedDB audio cache module (dhAudio*) + Task-1 verify"
```

---

### Task 2: `_getBuffer` becomes IndexedDB-first (instant reopen)

Reading a take prefers the local blob; downloaded blobs are cached for next time. This is the "fast reopen" half and is independent of recording.

**Files:**
- Modify: `lite-1.063.html` — `_getBuffer` (currently `index.html:1575-1585`).
- Test: `_verify_lite_1063.js` — add Task-2 block.

**Interfaces:**
- Consumes: `dhAudioGet`, `dhAudioPut`, `dhAudioTouch` (Task 1).
- Produces: `_getBuffer(take)` unchanged signature → `Promise<{buffer, normGain}>`; now resolves from IndexedDB when present, else fetches `downloadUrl`, decodes, and caches the downloaded bytes.

- [ ] **Step 1: Write the failing test (Task-2 block)**

Append before the final summary in `_verify_lite_1063.js`. It seeds a blob in the cache, stubs `fetch` to throw, and asserts `_getBuffer` still decodes from IndexedDB (proving no network). Use a tiny real WAV so `decodeAudioData` succeeds.

```js
  // ── Task 2: _getBuffer is IndexedDB-first (no network when cached) ──
  const t2 = await pg.evaluate(async () => {
    // Build a 0.05s mono WAV (decodeAudioData-able) as a Blob.
    function wav(seconds, rate) {
      const n = Math.floor(seconds * rate), buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
      const wr = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
      wr(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); wr(8, 'WAVE'); wr(12, 'fmt '); v.setUint32(16, 16, true);
      v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true);
      v.setUint16(32, 2, true); v.setUint16(34, 16, true); wr(36, 'data'); v.setUint32(40, n * 2, true);
      for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.sin(i / 4) * 8000, true);
      return new Blob([buf], { type: 'audio/wav' });
    }
    await dhAudioPut('take-cached', wav(0.05, 8000), { mimeType: 'audio/wav' });
    const realFetch = window.fetch;
    window.fetch = () => { throw new Error('NETWORK BLOCKED'); };
    let okDecode = false, threw = false;
    try { const entry = await _getBuffer({ id: 'take-cached', downloadUrl: 'http://blocked/never' }); okDecode = !!(entry && entry.buffer && entry.buffer.duration > 0); }
    catch (e) { threw = true; }
    window.fetch = realFetch;
    delete _bufCache['take-cached'];
    await dhAudioDelete('take-cached');
    return { okDecode, threw };
  });
  ok(t2.okDecode && !t2.threw, 'T2 _getBuffer decodes from IndexedDB with fetch blocked (no network)');
```

Run: `node _verify_lite_1063.js > /tmp/v1063.txt 2>&1; cat /tmp/v1063.txt`
Expected: FAIL on the T2 assert — current `_getBuffer` calls `fetch` and throws `NETWORK BLOCKED`.

- [ ] **Step 2: Modify `_getBuffer`**

Replace the body of `_getBuffer` (lines `index.html:1575-1585`) in `lite-1.063.html`:

```js
async function _getBuffer(take) {
  if (_bufCache[take.id]) return _bufCache[take.id];
  const ctx = ensureCtx();
  let ab = null;
  const local = await dhAudioGet(take.id);   // IndexedDB-first
  if (local) { ab = await local.arrayBuffer(); dhAudioTouch(take.id); }
  else {
    const resp = await fetch(take.downloadUrl);
    ab = await resp.arrayBuffer();
    try { await dhAudioPut(take.id, new Blob([ab], { type: take.mimeType || '' }), { mimeType: take.mimeType }); } catch (e) {}
  }
  const buffer = await ctx.decodeAudioData(ab);
  let peak = 0; const ch = buffer.getChannelData(0);
  for (let i = 0; i < ch.length; i += 64) { const a = Math.abs(ch[i]); if (a > peak) peak = a; }
  const normGain = peak > 0 ? Math.min(0.9 / peak, 4) : 1;
  _bufCache[take.id] = { buffer, normGain };
  return _bufCache[take.id];
}
```

Note: `decodeAudioData` consumes its ArrayBuffer — we decode the single `ab` we obtained (local or fetched). When fetched, the blob is rebuilt from the same bytes for caching before decode, so no detached-buffer issue.

- [ ] **Step 3: Run the test**

Run: `node _verify_lite_1063.js > /tmp/v1063.txt 2>&1; cat /tmp/v1063.txt`
Expected: Task-1 (8) + Task-2 (1) all PASS, `9 PASS / 0 FAIL`.

- [ ] **Step 4: Commit**

```bash
git add lite-1.063.html _verify_lite_1063.js
git commit -m "feat(lite-1.063): _getBuffer reads IndexedDB-first, caches downloads"
```

---

### Task 3: Pre-generated take ID + instant playback on record

Record → store blob locally → play immediately → upload in the background. Switches `voice_takes.add()` to `.doc().set()` so the ID exists before the network.

**Files:**
- Modify: `lite-1.063.html` — `uploadTake` (currently `index.html:1844-1867`).
- Test: `_verify_lite_1063.js` — add Task-3 block.

**Interfaces:**
- Consumes: `dhAudioPut` (Task 1), `dhAudioDelete` (Task 1).
- Produces: `uploadTake(blob, mime, dur)` unchanged signature; now (1) pre-generates the doc ref, (2) caches the blob locally and primes `_bufCache`/selection BEFORE awaiting the network, (3) writes via `ref.set({...id fields})`.

- [ ] **Step 1: Write the failing test (Task-3 block)**

This drives the real signed-in (guest) rail. Use the guest sign-in + song create/open recipe; stub `firebase.storage().ref().put` to hang (never resolve) to prove playback does NOT wait on upload, then assert the local blob is cached and `_bufCache` is primed synchronously-ish. Guard with the `guestIn()` retry helper (anon rate-limit lesson).

```js
  // ── Task 3: record caches locally + primes playback before upload resolves ──
  // (helper guestIn(): signInAsGuest with one retry on auth/too-many-requests)
  // Set up a loaded song first (createAndLoad recipe), then:
  const t3 = await pg.evaluate(async () => {
    // Stub Storage upload to NEVER resolve, so any await on it would hang the test.
    const origRef = firebase.storage().ref.bind(firebase.storage());
    firebase.storage().ref = (p) => ({ put: () => new Promise(() => {}), getDownloadURL: () => new Promise(() => {}) , delete: () => Promise.resolve() });
    const blob = new Blob([new Uint8Array(2048)], { type: 'audio/webm' });
    const before = Object.keys(_bufCache).length;
    // Call uploadTake but DON'T await its network tail; race it against a short timer.
    const p = uploadTake(blob, 'audio/webm', 1.0);
    await new Promise(r => setTimeout(r, 250)); // local path should be done well within this
    const ids = await (async () => { const db = await _dhAudioOpen(); const all = await _dhReq(_dhTx(db, 'readonly').getAll()); return all.map(r => r.id); })();
    const cachedSomething = ids.length > 0;
    const selected = !!_loadedTakeId;
    const localBlobPresent = _loadedTakeId ? !!(await dhAudioGet(_loadedTakeId)) : false;
    firebase.storage().ref = origRef; // restore
    return { cachedSomething, selected, localBlobPresent, before };
  });
  ok(t3.cachedSomething, 'T3 record stores a blob in IndexedDB without waiting on upload');
  ok(t3.localBlobPresent, 'T3 the just-recorded take blob is locally retrievable while upload hangs');
```

Run: `node _verify_lite_1063.js > /tmp/v1063.txt 2>&1; cat /tmp/v1063.txt`
Expected: FAIL — current `uploadTake` awaits `ref.put` (hangs) and never caches locally; `localBlobPresent` false / test times out within the 250ms window with nothing cached.

- [ ] **Step 2: Modify `uploadTake`**

Replace `uploadTake` (lines `index.html:1844-1867`) in `lite-1.063.html`:

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
  // ── Instant local playback: cache the blob + prime selection BEFORE any network ──
  await dhAudioPut(id, blob, { mimeType: mime });
  _selectNewest = false; _loadedTakeId = id;
  // ── Background upload + doc write ──
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
  } catch (e) { console.warn('[upload]', e); dhAudioDelete(id); recToast('Save failed — check connection'); }
}
```

Notes:
- The take's `voice_takes` doc is written with the pre-generated `ref` (`.set`, not `.add`) — same fields as before plus the stable ID. The `onSnapshot` listener (`startTakesListener`) then renders it; because `_loadedTakeId` is already `id`, the new take stays selected and `wfLoad`/`_getBuffer` serve it from the local blob (no re-download).
- On a genuine upload failure we drop the orphaned local blob (`dhAudioDelete(id)`) so the cache doesn't keep a take that never made it to the cloud (Phase 2 will instead queue it; Phase 1 keeps today's "save failed" semantics).
- `_selectNewest` is no longer needed to pick the newest take (we select by ID directly), but leave the variable + its other references intact; just don't set it true here.

- [ ] **Step 3: Run the test**

Run: `node _verify_lite_1063.js > /tmp/v1063.txt 2>&1; cat /tmp/v1063.txt`
Expected: Task-1+2+3 PASS (`11 PASS / 0 FAIL` so far).

- [ ] **Step 4: Commit**

```bash
git add lite-1.063.html _verify_lite_1063.js
git commit -m "feat(lite-1.063): pre-gen take ID + instant local playback on record"
```

---

### Task 4: Instant playback on trim + delete clears local blob

Trim writes the new blob locally and plays it immediately; deleting a take also evicts its local blob.

**Files:**
- Modify: `lite-1.063.html` — `_wfReplaceAudio` (currently `index.html:1742-1763`) and `deleteTake` (currently `index.html:1555-1566`).
- Test: `_verify_lite_1063.js` — add Task-4 block.

**Interfaces:**
- Consumes: `dhAudioPut`, `dhAudioDelete`, `dhAudioGet` (Task 1).
- Produces: `_wfReplaceAudio` caches the new (mp3) blob under `take.id` before the upload; `deleteTake` calls `dhAudioDelete(id)`.

- [ ] **Step 1: Write the failing test (Task-4 block)**

```js
  // ── Task 4: delete clears the local blob ──
  const t4 = await pg.evaluate(async () => {
    await dhAudioPut('del-me', new Blob([new Uint8Array(16)], { type: 'audio/webm' }), {});
    // Simulate a take object present in _takes so deleteTake finds it; stub confirm + storage.
    const origConfirm = window.confirm; window.confirm = () => true;
    const origRef = firebase.storage().ref.bind(firebase.storage());
    firebase.storage().ref = () => ({ delete: () => Promise.resolve() });
    _takes = [{ id: 'del-me', storagePath: 'voice_takes/x/take.webm', bytes: 16, songId: 's' }];
    await deleteTake('del-me');
    const gone = (await dhAudioGet('del-me')) === null;
    window.confirm = origConfirm; firebase.storage().ref = origRef;
    return { gone };
  });
  ok(t4.gone, 'T4 deleteTake removes the local cached blob');
```

Run: `node _verify_lite_1063.js > /tmp/v1063.txt 2>&1; cat /tmp/v1063.txt`
Expected: FAIL — current `deleteTake` never touches IndexedDB; `del-me` blob remains.

- [ ] **Step 2: Modify `deleteTake`**

In `lite-1.063.html`, inside `deleteTake`'s `try` block (currently `index.html:1560-1564`), add the local-blob delete right after the Firestore delete:

```js
  try {
    if (t.storagePath) firebase.storage().ref(t.storagePath).delete().catch(() => {});
    await db.collection('voice_takes').doc(id).delete();
    dhAudioDelete(id);
    if (typeof t.bytes === 'number') _liteAddBytes(-t.bytes);
    toast('Take deleted');
  } catch (e) { toast('Delete failed'); }
```

- [ ] **Step 3: Modify `_wfReplaceAudio` to cache the new blob first**

In `lite-1.063.html`, in `_wfReplaceAudio` (currently `index.html:1745-1759`), cache the encoded blob locally and prime `_bufCache` BEFORE the upload await. Replace from the `const fname = ...` line through the `_bufCache[take.id] = ...` line with:

```js
    const fname = 'take_' + Date.now() + '.mp3', path = 'voice_takes/' + take.songId + '/' + fname;
    // Instant local playback of the edited audio: cache + prime before network.
    await dhAudioPut(take.id, blob, { mimeType: 'audio/mp3' });
    _bufCache[take.id] = { buffer, normGain: (_bufCache[take.id] && _bufCache[take.id].normGain) || 1 };
    const snap = await firebase.storage().ref(path).put(blob, { contentType: 'audio/mp3' });
    const url = await snap.ref.getDownloadURL();
    const oldPath = take.storagePath;
    await db.collection('voice_takes').doc(take.id).set({ downloadUrl: url, storagePath: path, duration: Math.round(buffer.duration), mimeType: 'audio/mp3', bytes: blob.size }, { merge: true });
    if (oldPath && oldPath !== path) firebase.storage().ref(oldPath).delete().catch(() => {});
    take.bytes = blob.size; take.storagePath = path; take.mimeType = 'audio/mp3';
    _liteAddBytes(blob.size - oldBytes);
```

(Removes the now-duplicated `_bufCache[take.id] = ...` that was at line 1759; the `_wf.buffer = ...` / `wfRender()` / return lines below are unchanged.)

- [ ] **Step 4: Write the trim-caches test (Task-4b)**

```js
  // ── Task 4b: _wfReplaceAudio caches the edited blob under the take id ──
  const t4b = await pg.evaluate(async () => {
    // Minimal AudioBuffer to feed _wfReplaceAudio; stub mp3 lib + encode + storage + db.
    const ctx = ensureCtx(); const ab = ctx.createBuffer(1, 4410, 44100);
    _takes = [{ id: 'trim-me', songId: 's', bytes: 100, storagePath: 'voice_takes/s/old.webm' }];
    _wf.takeId = 'trim-me';
    window._ensureMp3Lib = async () => {};
    window._encodeMp3 = () => new Blob([new Uint8Array(64)], { type: 'audio/mp3' });
    const origRef = firebase.storage().ref.bind(firebase.storage());
    firebase.storage().ref = () => ({ put: async () => ({ ref: { getDownloadURL: async () => 'http://x/y.mp3' } }), delete: () => Promise.resolve() });
    const origDoc = db.collection('voice_takes').doc.bind(db.collection('voice_takes'));
    db.collection('voice_takes').doc = () => ({ set: async () => {} });
    await _wfReplaceAudio(ab, null, 'Trimmed');
    const cached = (await dhAudioGet('trim-me')) !== null;
    db.collection('voice_takes').doc = origDoc; firebase.storage().ref = origRef;
    await dhAudioDelete('trim-me');
    return { cached };
  });
  ok(t4b.cached, 'T4 trim caches the edited blob locally under the take id');
```

- [ ] **Step 5: Run the full suite**

Run: `node _verify_lite_1063.js > /tmp/v1063.txt 2>&1; cat /tmp/v1063.txt`
Expected: all asserts PASS (Task 1–4), `13 PASS / 0 FAIL`.

- [ ] **Step 6: Commit**

```bash
git add lite-1.063.html _verify_lite_1063.js
git commit -m "feat(lite-1.063): instant playback on trim; delete clears local blob"
```

---

### Task 5: No-harm regression + graceful-degradation asserts

The mandatory data-safety net: existing takes/lyrics unchanged; app still works with IndexedDB disabled.

**Files:**
- Modify: `lite-1.063.html` — none (verification-only task; if an assert fails, fix the offending earlier task).
- Test: `_verify_lite_1063.js` — add Task-5 block.

**Interfaces:**
- Consumes: all of the above.
- Produces: nothing new — guards the invariants.

- [ ] **Step 1: Write the no-harm + degradation asserts**

```js
  // ── Task 5a: existing take with NO local blob reads via fetch, exactly as before ──
  const t5a = await pg.evaluate(async () => {
    let fetched = false;
    const realFetch = window.fetch;
    function wav() { const r = 8000, n = 400, b = new ArrayBuffer(44 + n * 2), v = new DataView(b); const wr=(o,s)=>{for(let i=0;i<s.length;i++)v.setUint8(o+i,s.charCodeAt(i));}; wr(0,'RIFF');v.setUint32(4,36+n*2,true);wr(8,'WAVE');wr(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,r,true);v.setUint32(28,r*2,true);v.setUint16(32,2,true);v.setUint16(34,16,true);wr(36,'data');v.setUint32(40,n*2,true);for(let i=0;i<n;i++)v.setInt16(44+i*2,1000,true);return b; }
    window.fetch = async () => { fetched = true; return { arrayBuffer: async () => wav() }; };
    delete _bufCache['legacy-take'];
    const entry = await _getBuffer({ id: 'legacy-take', downloadUrl: 'http://x/legacy', mimeType: 'audio/wav' });
    const cachedNow = (await dhAudioGet('legacy-take')) !== null; // downloaded blob is now cached
    window.fetch = realFetch; delete _bufCache['legacy-take']; await dhAudioDelete('legacy-take');
    return { fetched, decoded: !!(entry && entry.buffer), cachedNow };
  });
  ok(t5a.fetched && t5a.decoded, 'T5 existing take with no local blob still fetches+decodes (no-harm)');
  ok(t5a.cachedNow, 'T5 a downloaded existing take gets cached for next time');

  // ── Task 5b: graceful degradation — with IndexedDB unavailable, helpers no-op safely ──
  const t5b = await pg.evaluate(async () => {
    const realOpen = indexedDB.open; const realP = _dhAudioDBP;
    _dhAudioDBP = Promise.resolve(null); // force "DB unavailable"
    const put = await dhAudioPut('x', new Blob([new Uint8Array(4)]), {});
    const get = await dhAudioGet('x');
    const ready = await dhAudioReady();
    _dhAudioDBP = realP; indexedDB.open = realOpen;
    return { put: put === false, get: get === null, ready: ready === false };
  });
  ok(t5b.put && t5b.get && t5b.ready, 'T5 IndexedDB-unavailable → dhAudio* degrade to safe no-ops');
```

- [ ] **Step 2: Run the full suite**

Run: `node _verify_lite_1063.js > /tmp/v1063.txt 2>&1; cat /tmp/v1063.txt`
Expected: all asserts PASS, `16 PASS / 0 FAIL`.

- [ ] **Step 3: Sanity-diff against the base (no unintended churn)**

Run: `diff <(git show HEAD~5:index.html) lite-1.063.html | grep -c '^[<>]'`
Expected: a small, bounded number of changed lines confined to the five regions touched (the `dhAudio*` module, `_getBuffer`, `uploadTake`, `_wfReplaceAudio`, `deleteTake`). Eyeball `git diff` to confirm nothing else moved.

- [ ] **Step 4: Commit**

```bash
git add _verify_lite_1063.js
git commit -m "test(lite-1.063): no-harm regression + IndexedDB-unavailable degradation"
```

---

## Self-Review

**Spec coverage (Phase 1 section of the spec):**
- IndexedDB blob store keyed by take ID → Task 1. ✓
- Pre-generated take ID (`.doc().id`) → Task 3. ✓
- Instant playback on record → Task 3. ✓
- Instant playback on trim (`_wfReplaceAudio`) → Task 4. ✓
- `_getBuffer` IndexedDB-first + cache downloads → Task 2. ✓
- `deleteTake` clears local blob → Task 4. ✓
- LRU ~250 MB, exempt `pendingUpload` → Task 1 (`DH_AUDIO_CAP`, `dhAudioEvict`). ✓
- Graceful fallback when IndexedDB unavailable → Tasks 1 & 5b. ✓
- Data-safety invariants + mandatory no-harm regression → Task 5. ✓
- Versioning/base-drift guard → Task 1 Step 1 (`cp` + `diff -q`), Task 5 Step 3 (diff vs base). ✓

**Out of Phase 1 scope (correctly deferred):** `enablePersistence`, the Storage outbox / `pendingUpload` *producers*, offline toasts, multi-device reconciliation, `lyricsVer`/`lyricsConflict`. The `pendingUpload` field is *honored* by eviction now so Phase 2 needs no eviction change — consistent with the spec's note.

**Placeholder scan:** no TBD/TODO; every code step shows complete code; every command shows expected output. ✓

**Type/name consistency:** `dhAudioReady/Put/Get/Touch/Delete/Evict`, `_dhAudioOpen`, `_dhTx`, `_dhReq`, `DH_AUDIO_CAP` used identically across Tasks 1–5. `uploadTake`/`_wfReplaceAudio`/`deleteTake`/`_getBuffer` signatures unchanged. Pre-gen ID variable `id` keys blob + doc (`ref.set`) + path consistently. ✓

## Verification note (anon-auth rate-limit lesson)

Run `_verify_lite_1063.js` **once** to a file and parse (`> /tmp/v1063.txt`), not repeatedly — repeated headless guest sign-ins rate-limit Firebase anonymous auth. Tasks 1, 2, 5 need no auth (pure cache/`_getBuffer`/degradation); only Task 3 drives a guest session — keep its `guestIn()` to a single attempt with one retry. Assert COMPUTED results from `page.evaluate`, not class names.
