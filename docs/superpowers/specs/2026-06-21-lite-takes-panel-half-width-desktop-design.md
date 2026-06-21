# Drafthaus Lite — half-width takes panel on desktop

**Date:** 2026-06-21
**App:** Drafthaus Lite (`index.html` == `lite-1.068.html` == `drafthaus.ca`)
**Next build:** `lite-1.069.html`

## Problem

On desktop the takes panel slides out over the **entire** song body, fully
covering the lyrics. Once a take is open you can't see or edit the lyrics —
including while a take is playing. The user wants the panel to stop at the
**halfway point** of the screen on desktop so the left half of the lyrics stays
visible and editable during playback.

## Current behavior

`#takesPanel` (CSS ~lines 335–341 in `index.html`):

```css
/* takes panel (slides over lyrics) */
#takesPanel {
  position: absolute; top: 0; left: 0; bottom: 0; right: 52px; background: var(--bg-elev);
  box-shadow: -2px 0 20px rgba(0,0,0,.14);
  transform: translateX(calc(100% + 52px));
  transition: transform .26s cubic-bezier(.2,.8,.2,1);
  display: flex; flex-direction: column; z-index: 7;
}
#takesPanel.open { transform: translateX(0); }
```

- Spans `left: 0` → `right: 52px` (full song body minus the 52px record rail).
- Closed: `translateX(calc(100% + 52px))` pushes it fully off-screen to the right
  (`100%` = panel's own width, `+52px` = clears the rail).
- Open (`.open`): `translateX(0)`.
- Toggled by `toggleTakes()` (~line 1581), which toggles `.open` and calls
  `wfRender()`. No backdrop element is added.
- No media queries affect the panel — behavior is identical at all widths.

## Design

Add **one desktop-only CSS rule**. No JS changes.

```css
@media (min-width: 768px) {
  #takesPanel { left: 50%; }
}
```

This makes the panel occupy only the **right half** of the song body on desktop
(from 50% to the 52px rail), sliding in from the right.

### Why this is sufficient

- **Closed transform unchanged:** `translateX(calc(100% + 52px))` is relative to
  the panel's *own* width. With the panel now half-width, it still slides fully
  off-screen — no other rule needs to change.
- **Open state unchanged:** `translateX(0)` now anchors the half-width panel to
  `left: 50%`.
- **Mobile/narrow (<768px) untouched:** still the full-width overlay.
- **Lyrics editable during playback:** the panel is a `position: absolute`
  overlay with **no backdrop**, so the uncovered left half of the lyrics stays
  fully clickable/editable, including while a take plays. (Decision: lyrics
  **do not reflow** — they keep full-width layout and the panel simply overlays
  the right half. The left half is enough to read and edit.)
- **Waveform:** `toggleTakes()` already calls `wfRender()` on open, so the
  waveform redraws to the new half-width automatically.

### Breakpoint

`768px` — matches the full app's desktop cutoff (the `fkbInit` 768px bail).

## Scope / non-goals

- No lyrics reflow (explicit user decision — overlay only).
- No mobile change.
- No JS change.

## Verification

Drive `lite-1.069.html` in a real browser (per CLAUDE.md headless recipe):

1. At width ≥768px, create/load a song, open the takes panel — confirm it
   covers only the **right half**; the left half of the lyrics is visible.
2. Confirm the left-half lyrics are **clickable and editable** with the panel
   open (no invisible blocker over the left half).
3. Start a take playing, then edit lyrics on the left half — confirm editing
   works during playback.
4. Confirm the closed panel is fully hidden (no sliver visible) at ≥768px.
5. At width <768px, confirm the panel still covers the **full** song body
   (unchanged).
6. Confirm the waveform renders correctly at the new half-width.

## Release

Per the file-copy versioning workflow: `cp index.html lite-1.069.html`
(after `md5`-confirming `index.html` == `lite-1.068.html`), apply the change to
`lite-1.069.html`, verify, commit to `main`. Promote into `index.html` (the
root) after on-device sign-off.
