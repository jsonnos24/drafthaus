# Notation drawer: fix bar-flip rubber-band + add flip animation

**Date:** 2026-06-01
**File:** `index.html` (single-file app; deployed build)
**Scope:** Mobile notation drawer (`ned`) — bar paging gesture.

## Problem

On iPhone, the mobile notation drawer lets you swipe horizontally across the
staff to flip between bar windows (bars 1–2 → 3–4, etc.). The paging itself
works, but two things are wrong:

1. **Rubber-band.** During the swipe, the whole drawer (toolbars, UCB, staff)
   translates with the finger and snaps back — an unwanted rubber-band feel.
2. **Chord-pill drag dismisses the drawer.** Dragging a chord pill horizontally
   flings the entire keyboard drawer closed.

There is also a missing nicety:

3. **No flip feedback.** When bars change, the staff repaints instantly with no
   cue that anything paged.

## Root cause (shared by #1 and #2)

The shared swipe-to-dismiss handler `_swipeToDismiss(...)` (index.html ~line
67107, attached to `keyboardDrawer`) tracks touches on the drawer and, on a
"deliberate horizontal swipe" (`adx > ady*4`), translates the whole drawer and
dismisses it past a 140px threshold.

Its `touchstart` has an **allow-list** of selectors it ignores so it won't fight
elements with their own gestures (`.seq-key`, `.qc-pill`, `.mpr-chord-overlay`,
inputs, buttons, …). The notation drawer's interactive surfaces — `.ned-staff`
(the bar-flip swipe target, its own handler at ~line 46784) and `.ned-chip`
(chord pills, `touch-action:none` drag) — are **not on that list**.

So:
- A staff bar-flip swipe is also read as a dismiss swipe → drawer translateX →
  snap-back rubber-band (the flip swipe of 40–140px never crosses the 140px
  dismiss threshold, so it always snaps back).
- A `.ned-chip` horizontal drag is read as a dismiss swipe → past 140px the
  drawer flings closed.

## Design

### Part 1 — Exclude ned surfaces from the dismiss handler

Add `.ned-staff`, `.ned-chip`, `.ned-qc`, and `.ned-keys` to the
`e.target.closest(...)` allow-list in `_swipeToDismiss`'s `touchstart`
(index.html ~67109). One-line edit.

Effect: the dismiss handler ignores touches anywhere inside the notation tool.
The drawer no longer moves during a bar-flip swipe (kills the rubber-band) and
chord-pill drags can no longer dismiss it. The bar-flip handler (46784) and the
chord-pill drag are untouched and keep working.

**Trade-off (accepted):** you can no longer swipe the staff to dismiss the whole
keyboard drawer. Dismiss via the drag handle / header instead. The staff swipe
is now exclusively "flip bars," which is the intent.

### Part 2 — Directional slide + fade on flip

When `_nedScrollBar` changes and `nedRender()` repaints, briefly animate
`#nedStaff`: the new bars slide in from the direction the user swiped toward,
with a quick fade.

- Duration ~130ms, ease-out.
- Direction: swipe left (advance) → new content enters from the right; swipe
  right (back) → enters from the left.
- Implementation: pure CSS. A keyframe (e.g. `translateX(±12px)` + `opacity
  0→1`) applied via a class toggled on `#nedStaff` at render time, keyed to the
  flip direction. Remove/re-add the class so it re-triggers each flip
  (force reflow or use `animationend` cleanup).
- Only animate on an actual bar change (not on every `nedRender()` — e.g. note
  entry, key changes, resize should not flip-animate). The bar-flip swipe
  handler is the single place that knows direction, so it sets a one-shot
  direction flag that `nedRender()` consumes and clears.

## Out of scope

- Desktop (Arrange is desktop-only; ned is mobile-only).
- Changing the 2-bar window size or paging step (stays ±2 bars).
- Any other drawer's dismiss behavior.

## Verification

Per CLAUDE.md "Verifying changes," drive on a real iPhone / touch device on the
deployed build after push:
1. Open a song → notation drawer.
2. Swipe staff left/right → bars page, **drawer does not move**, brief
   directional slide+fade plays.
3. Drag a chord pill horizontally → pill drag works, **drawer does not dismiss**.
4. Confirm the drawer still dismisses via the drag handle / header swipe.
