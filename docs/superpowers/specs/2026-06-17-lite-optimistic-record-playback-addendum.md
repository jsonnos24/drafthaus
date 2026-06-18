# Lite — Optimistic Record Playback (addendum to the local-first spec)

**Date:** 2026-06-17
**App:** Drafthaus Lite. Builds `lite-1.064.html` from `lite-1.063.html`. Never touches `full.html`/`1.3xx.html`/`index.html`.
**Parent spec:** `2026-06-17-lite-local-first-recording-sync-design.md`.

## Why

Phase 1 (`lite-1.063`) caches the recorded blob in IndexedDB, but on-device testing showed
**no felt speed difference** when recording. Root cause: in `uploadTake` the Firestore doc
(`ref.set`) is written *after* `await firebase.storage().ref(path).put(...)`, and the take
row / waveform / Play button are all driven by the `voice_takes` `onSnapshot` listener. So
the just-recorded take does not render — and isn't playable — until the **upload finishes**.
The cached blob is never reached on first-play because the UI hasn't rendered the take yet.
(Recording is NOT re-encoded before playback — it's stored in its native `MediaRecorder`
codec: `audio/mp4`/m4a on iOS, `audio/webm;opus` on desktop/Android. The only mp3 encode is
on trim/edit-save. So codec is not the bottleneck; the upload-gated UI is.)

## Change: optimistic local render

Decouple the take's appearance + playback from the upload, **without** pulling Phase 2's
durable doc-first / outbox forward (which would create stuck half-states on upload failure
absent a retry mechanism).

In `uploadTake`, after `dhAudioPut(id, blob, …)`:
1. Build an **optimistic take object** from the known local data (`id`, `songId`, `userId`,
   `filename`, `storagePath`, `duration`, `mimeType`, `trackNum:0`, `bytes`,
   `createdAt: Date.now()`, plus a transient `_pendingLocal:true` marker) — **no
   `downloadUrl`** (it doesn't exist yet).
2. Insert it at the head of `_takes` (deduped by id), set `_loadedTakeId = id`, and call
   `renderTakes(); updateRail(); wfLoad(optimistic)` **immediately**. `wfLoad` → `_getBuffer`
   serves the audio from IndexedDB (already cached), so the waveform renders and the take is
   playable with **zero network**.
3. Then run the existing background upload + `ref.set(full doc)` unchanged.

**Reconciliation (success):** when `ref.set` completes, the `onSnapshot` listener rebuilds
`_takes` from the server docs — the optimistic entry (same `id`) is replaced by the real doc
(now with `downloadUrl`, no `_pendingLocal`). `wfLoad` sees `_wf.takeId` unchanged and does
not refetch. Seamless.

**Reconciliation (failure):** the `catch` removes the optimistic entry from `_takes`,
`dhAudioDelete(id)`, resets `_loadedTakeId`, re-renders, and toasts the failure — exactly the
clean rollback `uploadTake` already does for the blob, now extended to the optimistic UI
entry. No persisted half-state.

**Saving indicator:** the take row's `.sub` info line shows `· Saving…` while
`_pendingLocal` is set (it clears automatically when the server snapshot reconciles), giving
the user feedback that the local take is still uploading.

## Data-safety (unchanged invariants)

- The optimistic entry is a transient in-memory object; nothing is persisted until the real
  `ref.set`. On failure nothing was written to Firestore/Storage, and the local blob is
  removed — no orphan doc, no data loss.
- Cloud stays source of truth; existing takes/lyrics untouched; writes still additive+merge;
  `index.html`/`full.html` untouched (clean file-copy snapshot, revert-safe).

## Known limitation (acceptable for this increment; resolved by Phase 2)

If an *unrelated* `voice_takes` snapshot fires during the brief upload window (e.g. a pin
change on another take), it rebuilds `_takes` from server docs and the optimistic entry
momentarily disappears until our `ref.set` lands. Low probability; the take reappears within
~1–2s. Phase 2's durable doc-first + outbox removes this entirely.

## Verification

Headless `_verify_lite_1064.js` (playwright-core + installed Chrome), extending the 1.063
suite. Key asserts:
- **Decoupled instant play:** stub Storage `.put` to hang forever → call `uploadTake` →
  within a short window assert the take is in `_takes`, `_loadedTakeId===id`, `_wf.takeId===id`
  (waveform loaded), and the buffer is decodable from IndexedDB — all while the upload hangs.
- **Clean failure rollback:** stub `.put` to reject → assert the optimistic take is removed
  from `_takes`, the local blob is deleted, and `_loadedTakeId` is reset.
- **Saving badge:** the optimistic row renders `· Saving…`; a reconciled (server-shaped, no
  `_pendingLocal`) take does not.

On-device sign-off still required (real getUserMedia round-trip; iOS Safari).
