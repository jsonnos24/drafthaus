# Fix chord-pill drag-to-staff on iPhone (notation drawer)

**Date:** 2026-06-01
**Status:** Approved — ready for implementation plan
**Scope:** Mobile-portrait notation editor (`ned`) chord-chip drag. iPhone Safari only.

## Problem

In the mobile notation drawer (`ned` IIFE), the Quick Chords chips (`.ned-chip`) can be
dragged onto the staff to drop a chord. This works on desktop. On **iPhone Safari** it is
broken in three linked ways:

1. The drag **ghost** (`#nedGhost` SVG overlay) never appears.
2. Pressing and holding a chip raises a **native text-selection box** ("selected text"
   highlight) around the chip.
3. The **iOS callout magnifier (loupe)** pops up as if to magnify what's being tapped.

Desktop behavior is correct and **must not change**.

## Root cause

The chips are selectable elements (a `<button>` containing text / a `<span>`). On iPhone
Safari, press-and-hold on selectable content starts the OS **text-selection + callout
(magnifier)** gesture. That gesture:

- draws the selection box (symptom 2),
- shows the loupe (symptom 3), and
- **cancels the pointer-event stream**, so the existing `pointermove` handler in
  `_nedChipDragStart` never fires → the ghost never renders and the drop never happens
  (symptom 1).

The chips already set `touch-action:none` (CSS line ~4851), but `touch-action` only
suppresses scrolling/pan gestures. It does **not** suppress text selection or the callout
magnifier — those require the `user-select` / `-webkit-touch-callout` properties, which are
currently missing.

## The change

Add four declarations to the existing `.ned-chip` rule (CSS ~line 4851), alongside the
current `touch-action:none`:

```css
user-select: none;
-webkit-user-select: none;
-webkit-touch-callout: none;
-webkit-tap-highlight-color: transparent;
```

With selection and callout suppressed at the source, iOS stops hijacking the touch. The
pointer stream survives, and the **existing** `_nedChipDragStart` → `_nedShowGhost` →
`_nedDropChordAt` flow runs on iPhone exactly as it already does on desktop.

**No JavaScript changes.** Because the fix is CSS only and the added properties are either
no-ops on desktop (`user-select:none` on a button) or mobile-only
(`-webkit-touch-callout`, `-webkit-tap-highlight-color`), desktop drag behavior is
guaranteed unchanged.

## Fallback (do not implement unless device testing proves it necessary)

If, after the CSS fix, some iOS version still pops the callout, add a belt-and-suspenders
JS guard: `preventDefault()` on `selectstart` / `contextmenu` on the chip during drag.
Held in reserve only — not part of the initial change.

## Out of scope

- Desktop drag (works; do not touch).
- Any change to the ghost rendering, drop logic, or chord-chip layout.
- The `selectstart`/`contextmenu` JS fallback (reserved; see above).

## Verification

- **On-device (authoritative):** iPhone Safari. After promoting the build, confirm:
  press-and-hold a chord chip shows **no** selection box and **no** loupe; dragging shows
  the ghost following the finger; releasing over the staff drops the chord.
- **Headless (regression only):** `scripts/ned-verify.mjs` (desktop Chrome via
  playwright-core) cannot reproduce iOS selection/callout, but should confirm desktop
  chord-chip drag still works (no regression).

## Versioning / rollout

Per the Drafthaus file-copy workflow: make the edit in a copy `1.302.html`, verify, then
promote (`cp 1.302.html index.html`) and push **only after the user confirms it works on
their iPhone**. Pushing `main` deploys `drafthaus.ca` via GitHub Pages.
