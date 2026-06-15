# Drafthaus Lite — Storage Caps + WAV→mp3 Edit-Save

**Date:** 2026-06-15
**Target file:** `index.html` (== `lite-1.056.html`; promote per the Lite milestone workflow)
**Scope:** Lite only. Does not touch `full.html`/`1.3xx.html`.

## Goal

Add per-account audio-storage caps to Drafthaus Lite, and shrink the worst-case
storage path by switching waveform edit-saves from WAV to mp3.

## Background / findings

- Lite uses the same Firebase project as the full app (`projectId: drafthaus-ca18c`)
  — same Auth, same `songs` / `voice_takes` collections, same Storage bucket.
- Audio is the only meaningful storage cost. Lyrics/chords/song metadata are tiny
  Firestore docs and are **not** counted.
- Two upload paths exist:
  - **Live recording** (`startRecord`, ~line 1727): uploads the raw `MediaRecorder`
    blob as **webm/opus** (mp4 on Safari). ~0.7 MB/min. Common path; adds new takes.
  - **Waveform edit-save** (`_wfReplaceAudio`, ~line 1628): re-encodes the edited
    `AudioBuffer` to **WAV** (`_encodeWav`) — ~5–10 MB/min — and **overwrites** the
    take, deleting the old file (line 1632). Less common, much larger per minute.
- `_encodeMp3(buffer)` (lamejs 128 kbps, ~line 2503) already exists, lazy-loaded from
  CDN for export (`_ensureExportLibs`, ~line 2487/2500). It can be reused for edit-save.
- Inactive-account deletion is **already handled** by the live, scheduled v2 Cloud
  Function `cleanupInactiveAccounts` (confirmed in the Firebase console — clock trigger,
  ~1 run/24h). Because it runs project-wide on the shared backend, it already covers
  Lite data. **No Lite work required.** (Optional console check: confirm it keys off
  Firebase Auth `lastSignInTime` and cleans up `voice_takes` docs + Storage files, not
  just `songs` docs.)

## Enforcement model

Client-side enforcement (the same model as `full.html`'s quota). Firebase Storage
Security Rules cannot sum a user's aggregate usage, so the cap is advisory at the
client layer. Optional backstop: a per-file size limit in Storage rules
(`request.resource.size`) as defense-in-depth — rejects a single oversized upload but
does not enforce the aggregate total.

## Tiers (audio bytes only)

| User | Detection | Cap |
|---|---|---|
| Admin (you) | `uid === 'FMskbD7caYYHdpnHRT4Vw41vqNf2'` | Unlimited (∞) |
| Registered | signed in, `!isAnonymous`, not admin | 120 MB |
| Guest | `isAnonymous` (anonymous auth) | 10 MB |

Constants (define once, near the auth/uid helpers):

```js
const LITE_ADMIN_UID = 'FMskbD7caYYHdpnHRT4Vw41vqNf2';
const LITE_CAP_BYTES = { guest: 10 * 1024 * 1024, registered: 120 * 1024 * 1024 };
function liteStorageCap() {
  const u = auth.currentUser;
  if (!u) return 0;                              // not signed in → no storage
  if (u.uid === LITE_ADMIN_UID) return Infinity; // me → unlimited
  if (u.isAnonymous) return LITE_CAP_BYTES.guest;
  return LITE_CAP_BYTES.registered;
}
```

## Byte tracking — Approach B (running total + recompute self-heal)

**Per-take bytes.** Every upload records the encoded blob size on the take doc as
`bytes`:
- `startRecord` upload: `bytes: blob.size`.
- `_wfReplaceAudio` (now mp3): `bytes: <mp3 blob>.size`.

**Running total.** Maintain `users/{uid}.liteStorageBytes` (Firestore;
`users/{uid}` is already writable by its owner per existing rules):
- On new take upload: `liteStorageBytes += blob.size`.
- On take delete: `liteStorageBytes -= take.bytes` (floor at 0).
- On edit-save overwrite: `liteStorageBytes += (newBytes - oldBytes)`.

Use `FieldValue.increment(...)` for atomic, multi-device-safe updates where possible.

**Self-heal / backfill.** On login (or first time the field is missing/`undefined`),
recompute once and persist:
1. Query the user's songs: `songs where ownerId == uid`.
2. Query their takes in `songId in [...]` chunks (reuse the existing chunked pattern
   at line 845 / 2652).
3. Sum `bytes`. For legacy takes missing `bytes`, fetch Storage `getMetadata().size`
   and write it back to the take doc (lazy backfill), or estimate from `duration` as a
   fallback if metadata is unavailable.
4. Write the total to `users/{uid}.liteStorageBytes`.

Keep an in-memory mirror (`_liteUsageBytes`) for synchronous checks and the meter.

## Enforcement points

- **Record start** (`startRecord`): if `_liteUsageBytes >= liteStorageCap()`, block
  before recording and show the appropriate message (below). Otherwise proceed; on
  upload completion, add the finished take's bytes. A single in-progress recording is
  allowed to finish even if it tips over the cap (size is unknown until done); the
  *next* recording is then blocked. (Confirmed acceptable.)
- **Edit-save** (`_wfReplaceAudio`): block only if
  `_liteUsageBytes - oldBytes + newBytes > liteStorageCap()`. Trims usually shrink the
  take, so this rarely triggers.

## UI / messaging

Reuse the existing guest-banner styling and the in-place guest→account upgrade flow
(`linkWithPopup` / `linkWithCredential`), which already preserves a guest's takes.

- A small usage meter near the Songs title / takes area: `"84 / 120 MB"` (hidden /
  `∞` for admin).
- **Guest at cap:** "Sign in to get 120 MB" → triggers the existing guest upgrade, so
  their ≤10 MB of takes carry over to the registered account.
- **Registered at cap:** "Storage full — delete takes to free space."

## WAV → mp3 edit-save

In `_wfReplaceAudio`:
- `await` lazy-load of lamejs (reuse `_ensureExportLibs` or load `lame.min.js`) before
  encoding.
- Replace `_encodeWav(buffer)` with `_encodeMp3(buffer)`.
- Filename `take_<ts>.mp3`; `contentType: 'audio/mp3'`; take doc `mimeType: 'audio/mp3'`.
- Keep the existing "Saving…" toast to cover the slightly longer mp3 encode.
- Result: edited takes drop from ~5–10 MB/min (WAV) to ~1 MB/min (mp3), no new
  dependency.

## Out of scope

- Inactive-account deletion / Resend warnings — already live via `cleanupInactiveAccounts`.
- True server-enforced aggregate caps (would require a Cloud Function).
- Any change to `full.html` beyond the already-applied "3hr"→"1hr" comment fix.

## Verification

Drive `index.html` headlessly per the Lite verify recipe (playwright-core + installed
Chrome; EULA/guest bypass). Assert:
1. Guest tier resolves to 10 MB, registered to 120 MB, admin to ∞.
2. A recording adds `bytes` to the take doc and bumps `liteStorageBytes`.
3. Deleting a take decrements the total.
4. At/over cap, record-start is blocked with the correct message per tier.
5. Edit-save writes an `audio/mp3` take and adjusts the total by the delta.
6. Recompute self-heal produces the same total as the running tally.
