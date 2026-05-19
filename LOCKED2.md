# Locked Systems Registry (v2 — updated for 1.195)

All systems below are protected by `/* @lock:start */` / `/* @lock:end */` markers in the source.
Do NOT edit code inside locked regions without explicit unlock from Jason.

If a request touches a locked system:
1. Flag it before proceeding
2. Wait for explicit "unlock X" approval
3. Re-lock when done

---

## Core Engine

| # | System | Key Functions | Status |
|---|--------|--------------|--------|
| 1 | Sequencer Scheduler | `seqPlay`, `seqScheduleNotes`, `seqScheduleMelody`, `seqStop`, timing engine | LOCKED |
| 2 | 4-Track Recorder Core | `_mtStartPlayback`, `_mtStopAll`, `_mtStopRecording`, `_vrStartTakesListener`, RAF playhead | LOCKED |
| 3 | 4-Track UI / Strip Sync | `ftSyncAllStrips`, `ftDrawWaveform`, `ftTickStart`, `ftTick`, VU meters | LOCKED |
| 4 | Chord Resolution | `_chordToMidi`, `_chordVariantToMidi` | LOCKED |
| 5 | UCB — Unified Control Bar | `ucPlay`, `ucStop`, `ucRec`, `ucEverything`, `sharedPlay`, undo/redo | LOCKED |
| 6 | Firestore Sync / State Persistence | `startSyncPolling`, `_bootFastRestore`, `uiStateSave`, `_uiRestoreFromState` | LOCKED |

## Instrument Systems

| # | System | Key Functions | Status |
|---|--------|--------------|--------|
| 7 | Piano Sampler | `loadPianoSamples`, `playPianoNote`, `_pianoClosestMidi` | LOCKED |
| 8 | MIDI Input | `initMidi`, `_midiHandleMessage`, `_midiNoteOn`, `_midiNoteOff` | LOCKED |
| 9 | Loop Station | `loopStartRecording`, `loopFinishRecording`, `loopStartPlayback`, `loopMasterStop` | LOCKED |

## UI Systems

| # | System | Key Functions | Status |
|---|--------|--------------|--------|
| 10 | Sequencer Grid Rendering | `renderSequencerHtml`, `seqBuildGrids`, `_seqSlotSetText` | LOCKED |
| 11 | Song Manager | `save`, `newSong`, `openSong`, `populateSongFields` | LOCKED |
| 12 | Waveform Rendering | `_mtDrawTrackWaveform`, `ftDrawWaveform`, `_drawTakeWaveformBuffer` | LOCKED |
| 13 | Piano Roll | `prRender`, `prRenderNotes`, `prLoadFromGrid`, `prSyncToGrid` | LOCKED |
| 14 | Mixer / Master Output | `buildMixerChannels`, `_mixApplyMain`, `_mixMeterRAF` | LOCKED |
| 15 | Dropdown System (pattern) | All dropdowns: `position:fixed` + `getBoundingClientRect()` | LOCKED |

## Infrastructure

| # | System | Key Functions | Status |
|---|--------|--------------|--------|
| 16 | Auth Lifecycle | `auth.onAuthStateChanged`, session clear, `initApp` | LOCKED |
| 17 | Subscription / Tier Logic | `getTierLimits`, `TIER_LIMITS`, trial nudge, quota | LOCKED |
| 18 | Collaboration / Sharing | `openShareModal`, `submitShare`, `removeShare` | LOCKED |
| 19 | Export / Bounce Engine | `exportBounce`, `exportMidiZip`, `exportPDF`, `encodeWAV` | LOCKED |
| 20 | Unified Timeline Engine | `window.TL`, transport-mode event scheduler | LOCKED |

## New Systems (added in 1.195)

| # | System | Key Functions | Status |
|---|--------|--------------|--------|
| 21 | Universal Record Engine | `_urStartRecording`, `_urStopRecording`, `_urCancelRecording`, `_urCaptureEvent` | UNLOCKED |

---

## v1.195 Change Log (UCB Record Rework)

**What was unlocked:** UCB (#5), 4-Track Core (#2), MIDI Input (#8) — for surgical edits only.

**Changes made:**

### UCB (#5) — `ucRec` reworked
- `ucRec()` now enters universal record mode (no picker, no long-press, no scoped mode)
- Tap = start recording, tap again = stop (keep take), cancel available via `_urCancelRecording`
- `_recMode`, `recPickerShow`, `recPickerSelect` → no-ops (dead code, HTML overlay still in DOM)
- `_ucRecDown` / `_ucRecUp` → no-ops (long-press removed)
- `_ucSyncRecLabel` → always shows "REC" (no mode suffix)
- `sharedRec()` → delegates to `ucRec()`
- `ucStop()` → checks `_urIsRecording` first, stops recording on first press

### 4-Track Core (#2) — `vrToggleRec` patched
- Removed `showToast('Arm a track first.')` — now silently returns if `_mtArmedTrack < 0`
- Universal record calls `ftRecClick()` / `vrToggleRec()` only if a track is armed

### MIDI Input (#8) — capture hooks added
- `_midiNoteOn` → adds `_urCaptureEvent('midi', ...)` during universal recording
- `_midiNoteOff` → adds `_urCaptureEvent('midi', ...)` during universal recording

### New: Universal Record Engine (#21)
- `_urStartRecording()` — 2-bar countdown with full playback, arms melody recording, optional 4-track
- `_urStopRecording()` — finalizes take, saves melody/chords, stores take in `_urTakes`
- `_urCancelRecording()` — discards current take
- `_urCaptureEvent(type, data)` — timestamped event capture (chord/key/drum/midi)
- `_urStartStep` — set by ruler click for seek-to-position recording
- Multiple takes stored, nothing overwritten

### Other touched areas
- `_drumPreviewHit` → capture hook added for drum pad hits during recording
- `kbdPlayNote` → capture hook added for on-screen keyboard during recording
- `_ckPlaceChordAtBeat` → now checks `_urIsRecording || _ckIsRecording` and uses `_urRecStartTime || _ckRecStartTime`
- `_ckStartRecording` / `_ckStopRecording` → redirect to `_urStartRecording` / `_urStopRecording`
- Keyboard 1-8 handler → checks `_urIsRecording || _ckIsRecording`
- Compose-mode guard → checks `_urIsRecording || _ckIsRecording`
- Loop orbital click (idle+empty) → calls `loopStartRecording(i)` instead of `ucRec()`
- Drum roll ruler + PR ruler → set `_urStartStep` on click

### Re-lock status
All systems should be re-locked. UCB (#5), 4-Track Core (#2), MIDI Input (#8) edits are complete.

---

## Notes

- Chord Resolution (#4) is physically nested inside Export / Bounce Engine (#19) — both are independently locked.
- Waveform Rendering (#12) overlaps with 4-Track Recorder Core (#2) and 4-Track UI (#3) — nested locks are intentional.
- Piano Sampler (#7) and MIDI Input (#8) are nested inside Sequencer Scheduler (#1) — independently locked subsystems.
- Dropdown System (#15) is a pattern lock, not a region lock.
- Universal Record Engine (#21) is new as of 1.195 — not yet locked, pending stabilization.
