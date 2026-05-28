---
title: Drum Drawer — Popover Fix & Toolbar Reorder
date: 2026-05-28
version: 1.291
---

## Problem

1. **Probability Roll popover cut off** — on desktop the popover clips at the top of the viewport; on mobile the bottom is cut off. Root cause: `seqProbPopover` and `seqFillPopover` use `position: fixed` in CSS but neither `seqProbToggle()` nor `seqFillToggle()` sets `top`/`left` via `getBoundingClientRect()`. Without explicit coordinates the browser places the element at its natural flow position, which is wrong on both platforms.

2. **Toolbar button order and labels** — "Randomize Velocity" is buried in the ⋯ more panel. It should be a first-class toolbar button. "Prob" text is too terse.

---

## Design

### A — Popover positioning

Add positioning logic to `seqProbToggle()` and `seqFillToggle()` following the codebase-locked pattern (line 9: *all dropdowns use `position:fixed` + `getBoundingClientRect()`*).

When the popover is shown:
1. Get the button's rect via `getBoundingClientRect()`.
2. Set `pop.style.left` to `rect.left`, clamped so the right edge stays within `window.innerWidth - 8`.
3. Set `pop.style.top` to `rect.bottom + 4` (below the button).
4. After positioning, check if the bottom of the popover exceeds `window.innerHeight - 8`. If so, flip above: `pop.style.top = rect.top - popoverHeight - 4`.

No CSS changes needed beyond what's already there.

### B — Toolbar reorder and rename

**Rename:** `seqProbBtn` button text changes from `🎲 Prob` to `🎲 Probability Roll`. Tooltip stays unchanged.

**Move:** The "Randomize Velocity" button is removed from `drMobMorePanel` and inserted into the main `dr-mob-top-row` HTML, between `seqFillBtn` and `drMobMoreBtn`. It uses the same `seq-gen-btn dr-stage-btn` class and styling as Prob/Fill. Label: `🎲 Random Vel`.

**Result (both platforms):**

| Slot | Desktop | Mobile |
|------|---------|--------|
| 1 | 🎲 Probability Roll | 🎲 Probability Roll |
| 2 | 🥁 Fill | 🥁 Fill |
| 3 | 🎲 Random Vel | 🎲 Random Vel |
| 4 | *(⋯ hidden)* | ⋯ |

The `drMobMorePanel` retains all other controls (Pattern, My Beats, Save, Time, +Dup, Clear).

---

## Files Changed

- `1.291.html` — all changes are in this single file:
  - `seqProbToggle()` — add positioning
  - `seqFillToggle()` — add positioning
  - HTML toolbar row — rename Prob button, add Random Vel button, remove from more panel
