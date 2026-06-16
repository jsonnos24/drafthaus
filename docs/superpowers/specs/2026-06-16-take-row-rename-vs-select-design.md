# Drafthaus Lite — Take-row rename vs. select

**Date:** 2026-06-16
**App:** Drafthaus Lite (`index.html` == `lite-1.061`; ships as new snapshot `lite-1.062.html`)
**Status:** Approved design, ready for implementation plan

## Problem

In the Takes panel, each take row's title (`.nm`) carries an `onclick="startRename(...)"`,
while the surrounding `.take-card` carries `onclick="selectTake(...)"` (load take + show
waveform).

Because `.nm` lives inside `.meta { flex: 1 }` and is itself a full-width block
(`white-space: nowrap; overflow: hidden; text-overflow: ellipsis`), the title element
stretches across **all the empty space beside the (often short) title text**. So:

- **Desktop:** clicking anywhere in the top half of a row — including the empty space
  beside the title — triggers rename. The user has to aim for the `.sub` line / card edges
  to select. Reported as "I have to click the bottom half to load it."
- **Mobile:** the title (rename target) sits right next to the ↻ loop button with little
  separation, making it fiddly to reliably hit "rename" vs. "select."

## Goal

Tapping a take row **anywhere** selects it (loads + shows waveform). Renaming happens
**only** via a dedicated ✎ button. One change fixes both the desktop empty-space bug and
the cramped mobile spacing.

## Approach (chosen)

Dedicated ✎ rename button. The whole card selects; rename moves to its own button. Chosen
over (A) shrinking the title hit-area — which fixed desktop but left mobile cramped — and
(C) a long-press/double-tap gesture — which added no UI but hid the rename affordance.

## Scope

- **File:** `index.html` only (the live Lite root). Built as a new file-copy snapshot
  `lite-1.062.html` per the Lite versioning workflow, promoted into `index.html`.
- **Surface:** `_takeRow()` markup + a small block of CSS + one new SVG constant.
- **Out of scope:** data model, Firestore, Storage, the rename logic itself
  (`startRename`/`commitRename`), loop/pin/trash/swipe behavior, the pinned-row drag grip.
  No behavior change to song rows or any other list.

## Changes

### 1. `_takeRow()` markup (≈ line 1465)

- **Remove** `onclick="startRename('${t.id}', this, event)"` from the `.nm` title div. The
  title becomes inert text that is part of the card → a tap on it bubbles to the card's
  `selectTake`.
- **Insert** a new ✎ button immediately **before** the existing `.loop` button, so the row
  order is: `▶ play · meta(title+sub) · ✎ edit · ↻ loop · [pin · trash (desktop only)]`.

  ```html
  <button class="take-edit"
          onclick="startRename('${t.id}', this.closest('.take-card').querySelector('.nm'), event)"
          title="Rename take" aria-label="Rename take">${PENCIL_SVG}</button>
  ```

  This reuses the exact inline-contenteditable rename flow the title tap used to fire, just
  triggered from the button. `startRename(id, el, ev)` already calls `ev.stopPropagation()`
  at its head, so clicking ✎ enters rename **without** also selecting the row.

### 2. New `PENCIL_SVG` constant

Add alongside `LOOP_SVG` (≈ line 1425), Feather "edit-2", same stroke styling as
`LOOP_SVG`/`TRASH_SVG`:

```js
const PENCIL_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path></svg>';
```

### 3. CSS — `.take-card .take-edit`

Add beside the existing `.take-card .loop` rules (≈ line 360):

```css
.take-card .take-edit { width: 30px; height: 30px; display: flex; align-items: center; justify-content: center; color: var(--text-3); flex: none; }
.take-card .take-edit svg { width: 18px; height: 18px; }
```

Add a desktop hover tint inside the existing `@media (hover: hover) and (pointer: fine)`
block (matching `.take-del-desktop:hover`):

```css
.take-card .take-edit:hover { color: var(--tint); }
```

**Always visible on both mobile and desktop** — it is now the only rename affordance, so it
must not be hover-hidden. (The desktop-only pin/trash stay as-is; ✎ shows everywhere.)

## Unchanged

`selectTake`, `startRename`, `commitRename`, the `.nm[contenteditable]` rename styling, the
loop/pin/trash buttons and mobile swipe actions, and the pinned-row `≡` drag grip (its
`onclick="event.stopPropagation()"` is untouched).

## Verification

Headless Playwright via the existing Lite recipe (real HTTP + installed Chrome; EULA/guest/
song-load bypass; `stopTakesListener()` before injecting `_takes`). Assert:

1. Tapping the `.take-card` body (not the ✎) calls `selectTake` → row gets `.sel` and the
   `.take-wave` host renders.
2. Tapping the title text (`.nm`) no longer enters rename (no `contenteditable`); it selects.
3. Clicking `.take-edit` puts `.nm` into `contenteditable` rename; Enter commits via
   `commitRename` (stub the Firestore `set`).
4. `.take-edit` is present and ordered immediately before `.loop` in both a **pinned** row
   and an **unpinned** row.
5. Layout holds at a phone viewport and at a desktop (hover/fine pointer) viewport — ✎
   visible in both; title no longer overlaps a rename hit-zone.

Then **on-device sign-off** (iPhone Safari): tap card = waveform, tap ✎ = rename with the
keyboard, no accidental renames from empty space, comfortable spacing beside ↻.

## Rollout

New snapshot `lite-1.062.html` → headless verify → commit → promote into `index.html` →
push (GitHub Pages deploy) per the Lite milestone workflow. Update memory `drafthaus-lite.md`.
