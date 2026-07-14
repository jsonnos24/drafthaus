# Drafthaus Lite — audio input device picker (lite-1.079)

**Date:** 2026-07-14
**Status:** Approved design
**Base:** `lite-1.078.html` (current live root; md5-verify against `index.html` before copying)

## Problem

Lite always records from the browser's default audio input. Both `getUserMedia`
call sites (countdown pre-acquire and `startRecord`) request `{ audio: { raw
constraints } }` with no `deviceId`, so recording through a USB audio interface
requires changing the OS/browser default input outside the app. There is no way
to see which input is active or whether it has signal.

## Scope (decided in brainstorming)

- **In scope:** an in-app input-device picker so a recording captures through a
  chosen interface. Desktop-only (≥768px). Takes stay **mono, single-file** —
  Chrome downmixes the interface's channels exactly as it does today.
- **Out of scope:** stereo capture, true multichannel/multitrack (4 discrete
  channels), mobile/iOS device picking, any change to the take data model,
  Firestore rules, upload/trim/mp3 paths, or the share viewer.

## UI & behavior

- New **input-source rail button** (mic/jack icon) in the recording rail on the
  song screen, next to the scratch-pad button. Hidden below 768px via CSS media
  query (same desktop-only treatment as the scratch pad).
- Click opens an **anchored popover** reusing the existing `.tray-picker`
  visual pattern:
  - **Live level meter** at the top: thin horizontal bar driven by a temporary
    stream (raw constraints + currently selected deviceId) through an
    `AnalyserNode`. Selecting a different device re-acquires the meter stream
    for that device. The stream and audio context stop when the popover closes;
    the meter never runs in the background.
  - **Device list** below: "System default" first, then every
    `enumerateDevices()` entry with `kind === 'audioinput'` by label. The
    active choice shows a checkmark. Tapping a row selects it immediately (no
    confirm) and persists it; it applies to the next recording.
  - A `devicechange` listener refreshes the list while the popover is open, so
    plugging the interface in makes it appear live. Listener removed on close.
- Opening the picker performs the `getUserMedia` call that grants mic
  permission, which is what makes device labels non-blank; the list renders
  after that acquisition resolves. If permission is denied, the popover shows
  the existing "Microphone blocked" message style instead of a list.
- **Persistence:** the chosen `deviceId` (and its label, for display/toast use)
  is stored in `localStorage` key `dh-lite-input-device` (matching the
  codebase's `dh-lite-*` key convention). "System default" clears the key. Per-browser persistence is acceptable since the setting is
  per-machine hardware.

## Capture plumbing

- New helper `recAudioConstraints()` returns the audio constraint object:
  the existing raw trio (`echoCancellation: false, noiseSuppression: false,
  autoGainControl: false`) plus `deviceId: { ideal: <saved id> }` only when a
  device is saved. **Both** `getUserMedia` call sites switch to this helper —
  single source of truth for capture constraints.
- **`ideal`, not `exact`:** an unplugged saved device must not break recording.
  `ideal` silently falls back to the system default. To avoid a *silent* wrong-
  mic recording, after the stream is acquired compare
  `stream.getAudioTracks()[0].getSettings().deviceId` to the saved id; on
  mismatch show `recToast('Saved input not found — using default mic')` once
  per session (module flag). The check runs in `startRecord` (covers both the
  pre-acquired and fallback streams).
- Nothing downstream changes: mono take, same MediaRecorder mime selection and
  `audioBitsPerSecond: 128000`, same `uploadTake`/trim/mp3 flow.
- Mobile: rail button hidden; a stale saved id on a mobile browser simply never
  matches and falls back to default via `ideal` (no toast spam — the toast
  code path lives with the desktop-only feature but is harmless if reached;
  once-per-session flag caps it regardless).

## Error handling summary

| Case | Behavior |
| --- | --- |
| Saved device unplugged | Records via system default; one toast per session |
| Mic permission denied in picker | Popover shows blocked message, no list |
| Labels blank (no prior grant) | Picker's own acquisition grants + populates |
| Device plugged in while popover open | `devicechange` refreshes list |
| Popover closed | Meter stream + analyser + listener torn down |

## Testing & release

- New `_verify_lite_1079.js` (playwright-core + installed Chrome, per Lite
  convention — stub top-level `function`s via `window.fn=`, top-level `let`
  vars by bare-name assignment). Asserts:
  1. `recAudioConstraints()` has the raw trio and no `deviceId` when nothing
     saved; includes `deviceId: { ideal }` when `lite-input-device` is set.
  2. Both capture call sites use the helper (stub `getUserMedia`, assert
     received constraints during countdown pre-acquire and direct record).
  3. Popover renders a stubbed `enumerateDevices` list with "System default"
     first and the saved device checked; selection writes
     `dh-lite-input-device`.
  4. Mismatch toast fires exactly once per session when the acquired track's
     `deviceId` differs from the saved one.
  5. Rail button hidden at a <768px viewport, visible at desktop width.
- Regression: existing lite verify suite for 1.078 must stay green.
- Manual QA (user): with the interface selected, meter shows signal; a recorded
  take plays back with interface audio; unplug-and-record shows the fallback
  toast.
- Versioning: `cp lite-1.078.html lite-1.079.html`, **diff the copy against the
  source** before editing (base-drift trap), work lands on `main`, no push or
  promotion to `index.html` without explicit user confirmation.
