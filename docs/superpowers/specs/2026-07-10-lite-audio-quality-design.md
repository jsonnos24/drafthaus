# Lite audio quality for new takes — design (lite-1.078)

**Date:** 2026-07-10
**Goal:** New recorded takes in Drafthaus Lite should sound as good as the browser can
capture. Applies from here forward only — existing takes are untouched.

## Problem

Two quality problems in the current (lite-1.077) recording pipeline, confirmed by ear
("processed / underwater" + "compressed / muffled"):

1. **Voice-call processing on the mic.** Both `getUserMedia` call sites request
   `{ echoCancellation: true, noiseSuppression: true }`, and `autoGainControl`
   defaults to on. For music (the primary use — singing + instrument), noise
   suppression chews sustained notes and instrument tails, auto-gain pumps levels,
   and echo cancellation filters/ducks. Echo cancellation is unnecessary anyway:
   Lite calls `stopPlayback()` before recording, so there is nothing to cancel.
2. **Unspecified encoder bitrate.** `MediaRecorder` is constructed with only a
   mimeType (Opus/webm on Chrome/Android, AAC/mp4 on Safari/iPhone); browsers
   default well below transparent quality for mono voice-style streams.

Secondary: trim/edit-save and ZIP export re-encode through `_encodeMp3` at
128 kbps MP3 — a lossy generation that will now sit below the improved originals.

## Decision

Raw, music-grade capture becomes the default for everyone. No Voice/Music toggle
(takes are music; YAGNI), no stereo/48 kHz constraint attempts (phone "stereo" is
unpredictable, doubles size, little audible win for sketches).

## Changes

All in a new snapshot `lite-1.078.html`, copied from `lite-1.077.html`
(md5-verified equal to `index.html`, `dfea9f35a8028e25f4f7da8534699f5e`).

1. **Capture constraints** — both `getUserMedia` call sites (countdown pre-acquire
   in `_startCountdown`, fallback in `startRecord`) change to
   `{ echoCancellation: false, noiseSuppression: false, autoGainControl: false }`.
   "Off" requests are always satisfiable — no new failure path.
2. **Encoder bitrate** — `MediaRecorder` options in `startRecord` gain
   `audioBitsPerSecond: 128000` alongside the existing mimeType pick. This is a
   hint the browser clamps if unsupported; the existing try/catch stays.
3. **MP3 re-encode bitrate** — `_encodeMp3`: `new lamejs.Mp3Encoder(ch, sr, 128)`
   → `192`. Raises trim/edit-save and ZIP-export quality in one place.

## Not changing

Existing takes (no migration), Firestore schema, storage rules, UI,
upload/outbox/local-first paths — the recorded blob flows through
`uploadTake`/`dhAudioPut`/`dhOutboxPut` unchanged, carrying whatever
mimeType/bytes it has.

## Trade-offs accepted

- **Honest levels:** with auto-gain off, quiet performances record quiet — turn up
  on playback (per-take boost already exists). Gained: dynamics without pumping.
- **Size:** ~1 MB/min at 128 kbps. Registered 120 MB cap ≈ 2 h of takes; guest
  10 MB ≈ 10 min. Trimmed takes ~50% larger at 192 kbps MP3.

## Verification

- New headless script `_verify_lite_1078.js` (playwright-core + installed Chrome,
  standard Lite bypasses) asserting:
  - (a) the constraints object passed to a stubbed `getUserMedia` has all three
    processing flags `false` (both call sites);
  - (b) `MediaRecorder` is constructed with `audioBitsPerSecond: 128000`;
  - (c) `Mp3Encoder` is constructed with bitrate 192 (stubbed lamejs);
  - (d) record → take appears (regression of the optimistic-render path).
- Re-run the existing lite verify suite (regression).
- Real-ear QA on iPhone after push — the only place the audible improvement is
  truly confirmed.

## Ship

Commit + push `lite-1.078.html` (confirm before push — Pages deploy), user QA at
`drafthaus.ca/lite-1.078.html`, then promote into `index.html` on sign-off.
