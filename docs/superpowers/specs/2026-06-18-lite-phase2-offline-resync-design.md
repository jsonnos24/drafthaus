# Drafthaus Lite — Phase 2: Offline Recording + Auto-Resync

**Date:** 2026-06-18
**App:** Drafthaus Lite. Builds `lite-1.066.html` from `lite-1.065.html`. Never touches `full.html`/`1.3xx.html`.
**Parent spec:** `2026-06-17-lite-local-first-recording-sync-design.md` (this refines its Phase 2 section with the decisions below).
**Status:** Design approved. One milestone (`lite-1.066`).

## Decisions (locked)

- **Uniform doc-first record path** — every recording writes the Firestore doc *first*
  (`pendingUpload:true`, no `downloadUrl`), renders + plays instantly from the local blob,
  then uploads via a background queue. Replaces the 1.065 in-memory optimistic render.
  Survives a reload; relies on Firestore latency-compensation to stay instant.
- **Retry forever + manual retry** — a failed upload stays queued indefinitely and
  auto-retries on every reconnect/foreground/boot; a take stuck pending also shows a small
  `↻ retry`. Never drops a recording.
- **Subtle status + a global offline pill** — per-take badge + a one-shot resync toast,
  *plus* a persistent "Offline" pill in the header whenever there's no connection.
- **One milestone** — persistence + outbox + doc-first + resync + badges/pill all in `lite-1.066`.

## Problem

Phase 1 (`lite-1.063`–`1.065`) made recording feel instant and local, but the take's
*durability* still depends on the upload: the doc is written after the upload, so a take
recorded with no connection (or whose app is closed before upload) is not a persisted,
reload-surviving record. Phase 2 makes recording work fully offline — record on a plane,
close the app, reopen, the take is still there — and auto-syncs when the connection returns.

## Goals / Non-goals

**Goals**
- Record (and trim) with no connection; the take persists across reloads and plays locally.
- Automatic upload when the connection returns, with clear-but-subtle status + an offline pill.
- Never lose a recording to a failed/stuck upload (retry forever + manual retry).

**Non-goals**
- Multi-device *conflict* reconciliation for lyrics (`lyricsVer`/keep-both) — that's Phase 3.
  Phase 2 only ensures a pending take from one device shows a correct "uploading elsewhere"
  state on another.
- Changing anything for already-uploaded takes (see Data-safety).
- Re-encoding audio (native m4a/webm preserved; mp3 only on trim, as today).

## Data-safety: already-recorded files are not touched

**Hard invariants.** Every task + verify script must uphold these.

1. **The new machinery only acts on takes it newly enqueues.** The `outbox` and the sync
   engine only process jobs created for a *new* recording/trim. An existing take has no
   outbox job, so Phase 2 never re-uploads, re-writes, patches, or deletes it.
2. **Existing takes read exactly as today.** They carry a `downloadUrl` and no
   `pendingUpload`, so they render with no badge, play enabled, served from cached blob or
   `fetch(downloadUrl)` — the Phase 1 path, unchanged. The new pending badge / play-disable /
   cross-device guard trigger *only* when `downloadUrl` is absent, which never happens for
   existing files.
3. **`enablePersistence` is non-destructive** — it caches reads and queues *new* writes; it
   never rewrites data at rest. Reconciliation is Firestore's own per-document last-write-wins,
   never a bulk rewrite. If it rejects, the app continues exactly as `lite-1.065`.
4. **The IndexedDB upgrade is strictly additive** — bumping the DB version only *creates* the
   new `outbox` store inside `onupgradeneeded` (guarded by `!objectStoreNames.contains`); it
   never deletes, clears, or rewrites the existing `takeBlobs` store. Even a worst-case upgrade
   failure costs only the *local cache* (cloud is source of truth; takes simply re-download) —
   no recorded audio can be lost.
5. **Trim stays as destructive as today, no more** — the old Storage file is deleted only
   *after* a successful re-upload; on failure nothing is deleted and the take still plays.
6. **All Firestore writes stay additive + `{merge:true}`**; `full.html`/`index.html` untouched;
   `lite-1.066.html` is a clean file-copy snapshot (revert-safe).

**Mandatory no-harm regression** (in `_verify_lite_1066.js`): seed an existing take (has
`downloadUrl`, no `pendingUpload`) + existing lyrics, run them through every new Phase 2 path
(boot with persistence on, open song, render, play, trigger a drain, toggle offline/online),
then assert the existing take's doc fields (`downloadUrl`/`storagePath`/`bytes`) and the
`lyricsDoc` are byte-unchanged, the take has no pending badge, its play is enabled, and it
plays via the normal cached/`fetch` path — not via the outbox.

## Architecture

### 1. Firestore offline persistence
Insert immediately after `db.settings({...})` (currently `lite-1.065.html:715`), before any
`db.collection()` use:
```js
db.enablePersistence({ synchronizeTabs: true })
  .catch(() => { /* failed-precondition (multi-tab) | unimplemented (Safari Private) → continue */ });
```
Effect: `voice_takes`/`songs` writes queue offline + auto-flush on reconnect; `onSnapshot`
serves from cache offline; a local write echoes back to its own `onSnapshot` immediately
(latency compensation) — the mechanism that keeps doc-first instant.

### 2. IndexedDB: add the `outbox` store
Bump `dh-lite-audio` from version 1 → 2. In `onupgradeneeded`, additively create an `outbox`
object store (`keyPath:'takeId'` — one pending job per take) if absent; leave `takeBlobs`
untouched. New helpers: `dhOutboxPut(job)`, `dhOutboxGet(takeId)`, `dhOutboxAll()`,
`dhOutboxDelete(takeId)`. Also `dhAudioSetPending(takeId, bool)` to flip a cached blob's
`pendingUpload` flag (the LRU-eviction exemption from Phase 1 already honors it).

**Outbox job shape:** `{ takeId, op:'upload'|'replace', storagePath, mimeType, songId, bytes,
duration, oldPath?, tries, lastTry, createdAt }`. The job carries everything needed to write
the *complete* doc on drain, so the doc is finalized correctly even if persistence was
unavailable when recording offline.

### 3. Doc-first record path (`uploadTake` rewrite)
1. Guards (`!song || !uid()` → toast), cap gate (`liteUsageOver()` → toast). *(unchanged)*
2. Pre-gen `ref`/`id`, `fname`, `path`. *(unchanged)*
3. `dhAudioPut(id, blob, { mimeType, pendingUpload:true })` — cache locally, exempt from LRU.
4. **Write the doc first:** `ref.set({ songId, userId, filename, storagePath, duration,
   mimeType, trackNum:0, bytes, pendingUpload:true, createdAt: serverTimestamp() })` — **no
   `downloadUrl`**. With persistence, `onSnapshot` fires immediately → take renders →
   `wfLoad` → `_getBuffer` serves the local blob. Set `_loadedTakeId = id`.
5. `dhOutboxPut({ takeId:id, op:'upload', storagePath:path, mimeType, songId:song.id, bytes,
   duration, tries:0, createdAt:Date.now() })`.
6. `_liteAddBytes(blob.size)` (usage reflects the intended file, consistent with recompute
   summing `bytes`); `songs.updatedAt` merge. *(as today)*
7. `liteSyncDrain()` — uploads now if online; no-op if offline.
8. No success toast (1.065 decision); failure handling lives in the drain, not here.

### 4. Trim path (`_wfReplaceAudio`) → outbox
Cache the new mp3 blob (`pendingUpload:true`), patch the doc with new `bytes`/`duration`/
`mimeType` + `pendingUpload:true` (keep the old `downloadUrl` so it still plays from cloud on
other devices until re-upload), enqueue `op:'replace'` with `oldPath`, kick `liteSyncDrain()`.
The drain uploads, patches `downloadUrl`/`storagePath`/`pendingUpload:false`, then deletes
`oldPath`. Works offline; preserves "delete old only after successful upload".

### 5. Sync engine `liteSyncDrain()`
Triggers: `window 'online'`, `document visibilitychange` (foreground), boot (after auth),
and right after each enqueue. **Single-flight** via a `_syncing` guard. Tracks an
`_wasOffline`/pending transition to drive the toast.

Per job (ordered by `createdAt`):
- If `!navigator.onLine` → stop; leave queued.
- `blob = await dhAudioGet(takeId)`. If missing (shouldn't happen — pending blobs are
  LRU-exempt) → drop the job + log; do not error.
- Upload `firebase.storage().ref(storagePath).put(blob, {contentType:mimeType})` →
  `getDownloadURL()`.
- `voice_takes/{takeId}.set({ downloadUrl, storagePath, bytes, pendingUpload:false }, {merge:true})`
  (for `op:'replace'`, this is the same patch; then `if oldPath delete oldPath`).
- `dhOutboxDelete(takeId)`; `dhAudioSetPending(takeId, false)` (blob now LRU-reclaimable).
- On failure: `tries++`, `lastTry=now`, keep the job; move on. **Retry forever** on the next
  trigger (no give-up). Optional light backoff: skip a job whose `lastTry` is < a few seconds ago.

**Toasts:** when a drain begins with a non-empty outbox after being offline → "Connection
restored — syncing recordings…"; when the outbox transitions to empty → "Synced ✓".

### 6. Connection detection + offline pill
`navigator.onLine` + `window` `online`/`offline` listeners toggle `body.is-offline`. CSS shows
a small persistent **"Offline"** pill in the header (alongside the existing `.lg-head`/song
header chrome). `online` also fires `liteSyncDrain()`.

### 7. Per-take badge + manual retry
`_takeRow` reads the doc's `pendingUpload`:
- `pendingUpload` + online + actively uploading → `· Uploading…`.
- `pendingUpload` + offline (or queued, not uploading) → `· On this device` + a small
  `↻` retry control that calls `liteSyncDrain()`.
- No `pendingUpload` → normal (this is every existing take). The 1.065 `_pendingLocal`
  in-memory marker is removed; the badge is now driven by the real persisted field.

### 8. Cross-device guard
A pending take syncs to other devices with `pendingUpload:true` and no `downloadUrl`. Guard
`_getBuffer`/`wfLoad`/play so a missing `downloadUrl` with no local blob never does
`fetch(undefined)`: show **"uploading from another device…"**, disable that take's Play. Once
the origin device's drain patches the `downloadUrl`, the snapshot updates and Play enables.

## Error handling

- `enablePersistence` rejects → continue; offline metadata simply unavailable. Online
  recording still works (doc-first write succeeds online without persistence); offline-recorded
  docs won't appear until reconnect+drain (the drain writes the full doc via merge regardless).
- Upload fails → job stays queued, retried forever; the blob is LRU-exempt so it survives.
- Blob missing for a queued job → drop job, log, no crash.
- Drain is single-flight; concurrent triggers coalesce.

## Testing (headless `_verify_lite_1066.js`)

- `enablePersistence` called exactly once, before the first `db.collection()` use; a rejection
  is swallowed and the app still boots.
- **Offline record:** stub `navigator.onLine=false` → `uploadTake` writes a doc with
  `pendingUpload:true` and no `downloadUrl`, an `outbox` job exists, the take renders +
  plays from the local blob, and **no** Storage upload is attempted.
- **Drain on reconnect:** go online + dispatch `online` → drain uploads, patches the doc
  (`downloadUrl`, `pendingUpload:false`), empties the outbox, clears the blob pending flag,
  and fires the "syncing…"→"Synced ✓" toast.
- **Retry forever:** stub `.put` to reject → `tries` increments, job stays; a later drain
  retries (no give-up).
- **Offline pill:** dispatch `offline`/`online` → `body.is-offline` toggles.
- **Per-take badge:** a `pendingUpload` doc renders `Uploading…`/`On this device` + `↻`; a
  normal take does not.
- **Cross-device guard:** a take with `pendingUpload:true`, no `downloadUrl`, no local blob →
  Play disabled + "uploading from another device…"; `_getBuffer` does not `fetch(undefined)`.
- **Cap still gates** at `uploadTake`'s head.
- **No-harm regression** (the mandatory one above): existing take + lyrics unchanged through
  all new paths; existing take plays via the normal path, no pending badge.

Caveats needing on-device sign-off (headless can't reproduce): true airplane-mode →
reconnect timing, iOS Safari persistence availability + multi-tab, real two-device pending
state.

## Versioning & revert safety

File-copy snapshot: `cp lite-1.065.html lite-1.066.html` (confirm base md5 first; diff the
copy). Promote into `index.html` only after on-device sign-off. Prior numbered files stay
frozen → any regression is a one-line revert.
