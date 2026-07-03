# Lite 1.074 — playback & takes-panel fixes (design)

**Date:** 2026-07-03
**App:** Drafthaus Lite (NOT the full app)
**Base file:** `lite-1.073.html` (latest pushed Lite; `index.html` is still 1.072)
**New file:** `lite-1.074.html` (whole-file copy, per the versioning workflow)

Three user-reported issues, all in the takes/playback area. Root causes were
confirmed before design: #1 statically in code, #2 by headless reproduction
(playwright-core against installed Chrome), #3 statically in code.

## Issue 1 — playhead invisible after the first loop pass

**Symptom:** with a take's loop button on, the red playhead line only moves
across the waveform on the first pass; on every repeat it is gone.

**Root cause:** `_phNow()` computes playhead time as
`_phOffset + (ctx.currentTime - _phStartCtx)` and only wraps it when a
*region* loop (`_phRegion`) is active. A whole-take loop (the take-row loop
button) sets `src.loop = true` with no region, so the computed time grows past
the buffer duration and `_wfDraw` paints the playhead off the right edge of
the canvas forever.

**Fix:** in `_phNow()`, add a branch: when there is no `_phRegion` but the
current source is looping, wrap by the buffer duration —
`else if (_curSource && _curSource.loop && _curSource.buffer) t = t % _curSource.buffer.duration;`
Reading `loop` live off `_curSource` means toggling the loop button **on**
mid-play starts wrapping with no extra bookkeeping.

**Edge case — loop toggled OFF mid-play after a wrap:** the un-wrapped clock
value is then far past the duration, so the playhead would jump off-canvas
while audio finishes its final pass. In `toggleLoop`, when turning loop off
for the currently playing take, rebase the clock to the current wrapped
position: set `_phOffset = _phNow()` (computed before flipping `src.loop`)
and `_phStartCtx = _audioCtx.currentTime`.

**Non-goal:** region-loop (`_phRegion`) behavior is unchanged — it already
wraps correctly.

## Issue 2 — waveform needs a "second select" to appear

**Symptom (both desktop and iPhone):** selecting a take doesn't show its
waveform; selecting it again does.

**Confirmed root cause (headless repro):** clicking a take's *title* works on
the first click, even with slow buffer loads ("Loading waveform…" → canvas).
The failure is the **play button**: `playTake` sets `_loadedTakeId = id` and
re-renders (card highlights as selected, an empty `.take-wave` host div is
rendered) but never calls `wfLoad`, so `_wf.takeId` still points at the
previous take and nothing paints into the new row — and the previously
visible waveform disappears. The user's "first select" is the ▶ press; the
title click is the "second select" that finally loads the waveform.

**Fix:** in `playTake`, after the existing end-of-function
`updateRailPlayBtn(); renderTakes();` calls, add `wfLoad(take);`
(fire-and-forget). Playing a take then always selects it *with* its waveform,
from every entry point (take-row ▶, bottom-rail ▶).

**Safety:** `wfLoad` is idempotent — for the already-loaded take
(`_wf.takeId === id && _wf.buffer`) it early-returns to a re-render, so the
scrub-restart and loop-region-restart paths (which call `playTake` with
offset/region opts) don't reload or add flicker beyond the full row re-render
`playTake` already performs today. The buffer is already in `_bufCache` by
this point (playTake awaited `_getBuffer` itself), so the wfLoad fast path is
synchronous-fast. When the takes panel is closed, `wfRender` no-ops but `_wf`
still loads, so opening the panel later shows the waveform immediately.

## Issue 3 — takes panel closed by default on desktop

**Symptom:** on desktop the takes list must be opened manually on every song
open.

**Root cause:** `_openSongObj` unconditionally runs
`document.getElementById('takesPanel').classList.remove('open')`.

**Fix (per user decision — "always open on song open"):** replace that line
with a width check using the app's existing takes-panel breakpoint:

```js
document.getElementById('takesPanel').classList.toggle('open', matchMedia('(min-width: 768px)').matches);
```

- Desktop (≥768px, where the panel covers only the right half and lyrics stay
  visible): panel starts open on every song open.
- Mobile: unchanged — starts closed, slide-over behavior as today.
- The Done button and Takes rail button still toggle it within a visit; no
  persistence of manual state (explicitly rejected in favor of
  always-open-on-song-open).
- No extra `wfRender()` call is needed: the waveform renders via the takes
  snapshot → `renderTakes`/`wfLoad` flow after takes arrive, and the host
  exists only once take rows render.

## Testing

New `_verify_lite_1074.js` (playwright-core + installed Chrome, same recipe as
`_verify_lite_m2.js`: guest sign-in, `_openSongObj` synthetic song, inject
`_takes` by bare-name assignment, prefill `_bufCache` with generated
AudioBuffers):

1. **Loop wrap:** with a looping source, assert `_phNow()` returns a value
   `< dur` after simulated elapsed time `> dur` (stub `_curSource`/clock
   values); assert loop-off rebase keeps the value in range.
2. **Play shows waveform:** press a take row's ▶ (never its title); assert
   that row's `.take-wave` contains a `canvas.wave-canvas` and
   `_wf.takeId` === that take. Assert the title-click path still works.
3. **Desktop default-open:** at a 1280px viewport, open a song → assert
   `#takesPanel.open`. At 390px → assert not open.
4. Re-run the existing 1.073 suite against the new file (regression).

Then the usual on-device iPhone QA before promoting.

## Versioning / deploy

- `cp lite-1.073.html lite-1.074.html` after md5-confirming 1.073 is the true
  base; diff the copy against its source before editing.
- Work lands on `main`; push deploys to `drafthaus.ca/lite-1.074.html`.
  **Confirm with the user before pushing** (Pages deploy) and before any
  promotion to `index.html`.
