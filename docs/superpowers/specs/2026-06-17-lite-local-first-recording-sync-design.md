# Drafthaus Lite — Local-First Recording & Sync

**Date:** 2026-06-17
**App:** Drafthaus Lite (`index.html` == `lite-1.0xx.html`). **Does NOT touch `full.html`/`1.3xx.html`.**
**Status:** Design approved. To be built in three phased milestones.

## Problem

Today, after you stop recording, Lite uploads the blob to Firebase Storage, gets a
`downloadUrl`, writes a `voice_takes` doc, then — to play back the take you *just*
recorded — **re-downloads it** via `fetch(take.downloadUrl)` in `_getBuffer`. The
in-memory blob is discarded after upload. So hearing your own recording costs a full
upload **and** a full re-download round-trip. There is no offline support, no local
cache across reloads, and no multi-device reconciliation.

The user wants:
1. **Instant playback** of just-recorded and just-trimmed audio — no cloud round-trip.
2. **Offline recording** that queues and resyncs when the connection returns (with a
   "Connection restored — syncing…" toast).
3. **Multi-device "latest wins"** — opening a song checks local first, then reconciles
   with the cloud — **without erasing** work done offline on another device.

## Goals / Non-goals

**Goals**
- Zero-network playback of freshly recorded/trimmed takes.
- A persistent on-device audio cache so reopening a song is instant.
- Offline-tolerant recording + automatic resync.
- Multi-device reconciliation that never loses recordings, and never silently erases lyrics.

**Non-goals**
- True character-level lyrics merge (CRDT/OT). Too heavy for a single-file app; we do
  conflict *detection* + keep-both instead.
- Changing the shared Firebase data contract in a way that breaks `full.html`
  interop. New fields are additive and ride alongside via merge-save, exactly like the
  existing Lite-only fields (`boost`, `pinned`, `tuning`, take `bytes`, etc.).
- Offline support for the chord engines (already fully self-contained / no Firebase).

## Architecture

Two local layers sit in front of Firebase:

1. **Audio blobs → our own IndexedDB store.** Firebase Storage has **no** offline
   queue, so this is the layer we build. One object store `takeBlobs`, keyed by take ID,
   value `{ blob, mimeType, bytes, savedAt, lastPlayed, pendingUpload }`.
2. **Metadata → Firestore's built-in IndexedDB persistence** (`enablePersistence`).
   Once enabled, the SDK handles offline reads, the write queue, and auto-resync for all
   `voice_takes` and `songs` docs — including `lyricsDoc`. This is free and replaces most
   hand-rolled offline-metadata work.

**Key enabler — client-generated take IDs.** Today `uploadTake` calls
`db.collection('voice_takes').add({...})`, so the doc ID isn't known until the network
round-trip resolves. We switch to **pre-generating the ID**:

```js
const ref = db.collection('voice_takes').doc(); // local, no network
const id  = ref.id;
```

That single stable ID keys the IndexedDB blob, the Firestore doc (`ref.set(...)`), and
the Storage path from the instant of recording — before any network. This is what makes
instant local playback and the offline outbox coherent.

**Graceful degradation.** If IndexedDB is unavailable (e.g. Safari Private Mode) or
`enablePersistence` rejects, the app falls back to today's behavior (in-memory
`_bufCache` + direct `fetch`). No feature hard-depends on local persistence existing.

---

## Phase 1 — Instant playback

Milestone: ~`lite-1.063`.

**New module: a tiny IndexedDB wrapper** (`dhAudio*` helpers): `dhAudioOpen()`,
`dhAudioPut(id, blob, meta)`, `dhAudioGet(id)`, `dhAudioDelete(id)`, `dhAudioTouch(id)`
(update `lastPlayed`), and `dhAudioEvict()` (LRU sweep — see Cache policy). All
promise-based, all no-op/fallback if IndexedDB is missing.

**Record flow** (`onRecStop` → `uploadTake`):
1. Build the blob (unchanged).
2. Pre-generate the take ID.
3. `dhAudioPut(id, blob, …)` — write to IndexedDB.
4. Decode into `_bufCache[id]`, set `_loadedTakeId = id`, render the waveform —
   **user hears it instantly, zero network.**
5. *Then* upload to Storage + `ref.set(doc)` in the background (existing upload code,
   now keyed by the pre-gen ID and using `.set()` instead of `.add()`).

**Trim flow** (`_wfReplaceAudio`): same pattern — `dhAudioPut(takeId, newBlob)` (overwrite),
update `_bufCache`, play instantly, then upload + doc update in the background.

**Playback** (`_getBuffer`) becomes **IndexedDB-first**:
`_bufCache[id]` → `dhAudioGet(id)` (decode + cache) → else `fetch(downloadUrl)` → decode,
**and `dhAudioPut` the downloaded blob** so the next open is instant. `dhAudioTouch(id)`
on every play to drive LRU.

**Delete** (`deleteTake`): also `dhAudioDelete(id)`.

**Cache policy — LRU ~250 MB.** `dhAudioEvict()` runs after each `dhAudioPut`: if total
cached bytes exceed ~250 MB, evict least-recently-played blobs first. **Never evict a
blob with `pendingUpload:true`** (it's the only copy until it syncs). This bounds device
storage without re-downloading hot takes.

**Acceptance:** record a take with the network throttled to offline at the Storage layer
→ waveform + playback are immediate; reopening a previously-played song renders audio
with no `fetch` to `downloadUrl` (served from IndexedDB).

---

## Phase 2 — Offline recording + resync

Milestone: ~`lite-1.064`.

**Enable Firestore persistence.** Immediately after `const db = firebase.firestore();`:

```js
db.enablePersistence({ synchronizeTabs: true })
  .catch(err => { /* failed-precondition (multi-tab) | unimplemented (browser) → continue */ });
```

Must run before any other Firestore call. Once on, `voice_takes`/`songs` writes queue
while offline and flush automatically; `onSnapshot` serves from cache offline. This gives
us the metadata half of offline for free.

**Storage upload outbox** (the half Firestore won't do). A second IndexedDB object store
`outbox`: `{ id, takeId, op: 'upload'|'replace', storagePath, mimeType, songId, tries, createdAt }`.

- Recording (or trimming) while offline, or when an upload throws, writes the Firestore
  doc with `pendingUpload: true` and **no `downloadUrl`** (the take is fully usable
  locally — it plays from the IndexedDB blob), and enqueues an outbox op.
- **Sync engine** `liteSyncDrain()`: triggered on `window 'online'`, on app foreground
  (`visibilitychange`), and on boot. For each outbox op: read the blob from `takeBlobs`,
  upload to Storage, `getDownloadURL`, patch the doc (`downloadUrl`, `storagePath`,
  `bytes`, `pendingUpload: false`), then remove the outbox entry. Failures increment
  `tries` and back off; the op stays queued.

**Connection detection.** `navigator.onLine` + `window` `online`/`offline` events, plus
Firestore snapshot `metadata.fromCache` as a secondary signal. A global offline pill
reflects state.

**UI.**
- Per-take **"on this device only / uploading…"** badge in the take row, reusing the
  `.sub` line (same slot as the existing `dur · FORMAT · size` badge).
- Toast **"Connection restored — syncing recordings…"** when a drain starts with a
  non-empty outbox; **"Synced ✓"** when it empties.

**Cross-device note:** a take recorded offline has a Firestore doc (queued by persistence)
that syncs to other devices with `pendingUpload:true` and no playable URL. Those devices
show an **"uploading from another device…"** state until the origin device drains its
outbox and patches the doc with the `downloadUrl`.

**Storage-cap interaction.** The existing client-side caps (`liteUsageOver()` / 10 MB
guest / 120 MB registered / admin ∞) still gate at `uploadTake`'s head. An in-progress
recording always finishes and lands locally; the cap blocks the *cloud upload* of the
next one. The local LRU cache (~250 MB) is independent of the cloud account cap.

---

## Phase 3 — Multi-device reconciliation & conflict handling

Milestone: ~`lite-1.065`.

**Open = local-first, then reconcile — automatic.** With persistence on, `onSnapshot`
fires from cache first (instant render) then from server (reconciled). Audio is
IndexedDB-first then Storage. We render the cached state immediately and update in place
when the server snapshot arrives. No bespoke "check local then compare cloud" code is
needed — it's the SDK's native behavior; we just make the UI tolerant of the two-stage
render.

**Reconciliation policy (the answer to "merge, don't erase"):**

| What diverged across devices | Resolution |
|---|---|
| **New recordings** (offline on phone + online on desktop) | **Always merge.** Unique IDs → both docs survive and both appear. The user's main fear — losing a recording — effectively can't happen. |
| **Rename / pin / reorder a take** | Per-field last-write-wins (`merge`-set). Low stakes. |
| **Trim the *same* take on two devices** | Last upload wins (rare). Documented; not special-cased. |
| **Lyrics** (`lyricsDoc`, one rich-text string) | **Conflict detection + keep-both** (below). Never silently overwritten. |
| **Song scalars** (key, boost, tuning, title, color, pin) | Independent fields, per-field LWW via merge. |

**Lyrics conflict detection + keep-both.**
- Add a monotonic `lyricsVer` (int) to the song doc, plus the `lyricsBaseVer` each device
  recorded when it last loaded/saved.
- `flushLyrics` saves inside a Firestore **transaction**: read the live doc; if the
  server's `lyricsVer` is greater than this device's `lyricsBaseVer`, the two genuinely
  diverged → **do not overwrite**. Instead write the incoming text to a `lyricsConflict`
  field (with a small label, e.g. source device + time) and leave the server `lyricsDoc`
  intact. Otherwise commit normally and bump `lyricsVer`.
- We use the **version counter, not `updatedAt`** — `updatedAt` is `Date.now()` (a
  skew-prone client clock) and unreliable for ordering.
- **UX — keep-both + banner (chosen):** when `lyricsConflict` is present, show a
  non-blocking banner on the song screen: *"Lyrics were edited on another device — review."*
  The user can view both and pick/merge manually; clearing the conflict deletes the
  `lyricsConflict` field. No modal, no interruption, no data loss.

---

## Data model changes (additive, full-app-safe)

- `voice_takes` doc: `pendingUpload: boolean` (transient; cleared on sync). Existing
  `downloadUrl`/`storagePath` are simply absent until the upload completes.
- `songs` doc: `lyricsVer: int`, `lyricsConflict: { text, from, at } | absent`.
- IndexedDB (device-local, not in Firebase): store `takeBlobs` (audio + meta) and store
  `outbox` (pending uploads).

`full.html` ignores all of these; Lite continues to merge-save so full-app fields are
never clobbered.

## Testing

No test runner — headless verify scripts (`_verify_lite_1063.js` … `_1065.js`) over real
HTTP via playwright-core + installed Chrome (the established Lite recipe: EULA bypass,
`signInAsGuest`, song create/open). Per phase:
- **P1:** stub Storage `.put`/`fetch` to reject or hang → assert playback + waveform still
  render from IndexedDB; assert `_getBuffer` hits IndexedDB on the second open (no
  `downloadUrl` fetch); assert LRU eviction respects `pendingUpload`.
- **P2:** force `navigator.onLine=false` / dispatch `offline` → record → assert doc has
  `pendingUpload:true` and an outbox entry; dispatch `online` → assert drain uploads,
  patches the doc, empties the outbox, fires the toast.
- **P3:** simulate a server `lyricsVer` ahead of the device's base → assert the
  transaction writes `lyricsConflict` instead of overwriting `lyricsDoc`, and the banner
  shows. Assert two takes with distinct IDs both survive a merge.

Caveats that need on-device sign-off (headless can't reproduce): real `getUserMedia`
recording + Storage round-trip, iOS Safari IndexedDB quota/eviction behavior, true
airplane-mode→reconnect timing, and real two-device reconciliation.

## Risks / gotchas

- **`enablePersistence` is one-shot and pre-everything** — must be called before any
  other Firestore use, and only once. Multi-tab needs `synchronizeTabs`; Safari Private
  Mode rejects → must fall through cleanly.
- **`.add()` → `.doc().set()` migration** in `uploadTake` (and the trim re-upload path)
  must preserve every existing field write.
- **IndexedDB quota** varies by browser/platform; the ~250 MB LRU target is advisory and
  must tolerate `QuotaExceededError` by evicting harder, then degrading to memory-only.
- **Pending-upload blobs are the only copy** — eviction and "clear cache" paths must
  exempt them, or recordings made offline could be lost before they sync.
- **Guest sessions** are single-device by nature (anonymous uid isn't re-signin-able);
  local-first still helps, but there's no multi-device story for guests — expected.

## Phasing summary

| Milestone | Scope | User-visible win |
|---|---|---|
| `lite-1.063` (P1) | IndexedDB audio cache, instant local playback, LRU 250 MB | Hear takes instantly; fast reopen |
| `lite-1.064` (P2) | Firestore persistence + Storage outbox + resync toast | Record offline; auto-sync on reconnect |
| `lite-1.065` (P3) | Local-first open, take append-merge, lyrics conflict keep-both | Multi-device, nothing erased |

Each milestone ships independently and is useful on its own.
