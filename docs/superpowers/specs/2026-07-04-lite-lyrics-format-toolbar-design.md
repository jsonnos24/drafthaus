# Drafthaus Lite — lyrics selection format toolbar (color / size / B·I·U)

**Date:** 2026-07-04
**Target:** `lite-1.076.html` (copied from `lite-1.075.html`, the current live root)
**Status:** Approved design, pre-implementation

## Problem

Lite's lyrics editor (`#lyricsEditor`, contenteditable) can *display* rich text —
`ilSanitizeDocHtml` already whitelists `color`, `font-size`, B/I/U tags, and `FONT`
elements for full-app compatibility — but Lite has no UI to *apply* formatting. The
user wants to select text and change its color or size, with one specific behavior:
a color chosen as **black in light mode must automatically render white in dark
mode** (and vice versa).

## Scope (user-confirmed)

- **In:** text color, text size, bold, italic, underline — applied to the current
  selection via a popover toolbar.
- **Out:** monospace, highlight/background color (full-app-only remains fine; Lite
  displays them), free-form color picker, any full-app (`full.html`) changes, any
  Firestore rules/sanitizer changes, PDF-export color support (export ignores
  color/size today for full-app content too — unchanged).

## UX

A compact pill toolbar (`#fmtBar`), styled like Lite's existing `.popover` /
`.tray-picker`, appears when the user selects a non-collapsed range inside
`#lyricsEditor`:

```
┌─────────────────────────┐
│ B  I  U │ Aa ▾ │ ● ▾    │
└─────────────────────────┘
```

- **B / I / U** — toggle buttons; active state reflects `queryCommandState`.
- **Aa** — expands four size choices matching the full app's `IL_FMT_SIZES`
  exactly: Title 28px, Heading 20px, Body 16px, Small 13px.
- **●** (color) — expands 8 swatches:
  - **Default** — black in light mode, white in dark mode (the auto-switch).
  - **7 accents** — fixed mid-tones, each readable on both white and black
    backgrounds (they never need theme adaptation): red `#d94848`, orange
    `#d97a1f`, gold `#b8860b`, green `#2f9e44`, blue `#2f6fd0`, purple
    `#9d5fe0`, pink `#d6408b`. Values may be nudged during implementation if a
    contrast check against `#fff` (light card bg) or `#000` (dark bg) fails,
    but the set stays 7 fixed literal hexes.

Behavior:

- Positioned above the selection via `range.getBoundingClientRect()`; flips below
  when near the viewport top; clamped horizontally (same pattern as the full app's
  `ilFmtOpenSwatches` fixed-position popover).
- Shown from a debounced (~150 ms) `selectionchange` listener; hidden when the
  selection collapses, the editor blurs, the page scrolls, or the song screen
  closes.
- **Suppressed while Chordify mode is active** (word-taps there mean "add chord").
- Every button uses `onmousedown="event.preventDefault()"` so tapping never
  destroys the selection (existing Lite/full-app trick).
- Second-level panels (sizes, swatches) render inside the same popover node
  (swap content or expand a row) — no nested floating elements.

## Architecture

All new code in one `fmt*`-prefixed block near the existing lyrics section of
`lite-1.076.html`. No changes to `ilSanitizeDocHtml`, the save/merge/offline
pipeline, Firestore rules, or `full.html`.

### Applying formats (execCommand on the contenteditable)

- **B/I/U:** `document.execCommand('bold'|'italic'|'underline')`.
- **Size:** the full app's proven trick copied as-is — `execCommand('fontSize',
  false, '7')`, then rewrite every resulting `font[size="7"]` inside
  `#lyricsEditor` to `style="font-size:<px>"` and strip the `size` attribute.
- **Accent color:** `execCommand('foreColor', false, '<hex>')` (stored as the
  literal color; readable in both themes by palette design).
- **Default color:** `execCommand('foreColor', false, SENTINEL)` where SENTINEL is
  an exotic rgb value used nowhere else (e.g. `rgb(1,2,3)`), then rewrite every
  element inside `#lyricsEditor` whose inline color computes to the sentinel to
  `style="color:var(--fmtText,#ffffff)"`. (execCommand normalizes colors to
  `rgb()` and cannot emit `var()` directly — hence sentinel + rewrite, mirroring
  the fontSize post-processing pattern.)

### The auto-switching default color

Stored in `lyricsDoc` as `color:var(--fmtText,#ffffff)`:

- **Lite:** CSS defines `--fmtText: #111` under `:root` and `--fmtText: #fff`
  under `html.dark`. Text flips live with the theme toggle — editor and share
  viewer both (define the var wherever the share viewer's root styles live if it
  does not inherit `:root`/`html.dark`; verify at implementation).
- **Full app:** `--fmtText` is undefined → CSS falls back to `#ffffff`, which is
  the full app's normal lyrics text color on its dark-only UI. Zero full-app work.
- **Sanitizers:** both apps' `ilSanitizeDocHtml` filter style declarations by
  property name only and pass values through untouched — `var(--fmtText,#ffffff)`
  survives round-trips (verified by reading both implementations; note the value
  contains no `;` so the split-on-`;` filter is safe).

Pre-existing issue explicitly NOT fixed here: text colored literal `#ffffff` in
the full app is invisible in Lite light mode today. A render-time normalization
was considered (Approach C) and deferred as an optional follow-up.

### Persistence

After every toolbar action: call the existing `onLyricsInput()`. Save-on-blur
(`flushLyrics`), offline outbox, and multi-device reconciliation all apply
unchanged because formatting *is* the lyrics document.

### Chord-span safety

Chord spans are `contenteditable=false` atoms (`_atomizeLyricChords`). Formatting
a selection that straddles a chord span must leave the chord span's own styling
and atomicity intact; the verify script covers this case. If execCommand proves
destructive to chord spans in practice, constrain the fix to the `fmt*` block
(e.g. re-run `_atomizeLyricChords()` after applying) — do not touch chord code.

## Verification

`_verify_lite_1076.js` (playwright-core + installed Chrome, existing recipe)
asserts at minimum:

1. Popover appears on selection inside the editor; hidden on collapse/blur.
2. Popover suppressed while Chordify mode is on.
3. B, I, U each apply, toggle off, and survive `ilSanitizeDocHtml`.
4. Each of the 4 sizes writes the exact px value; sanitizer round-trip keeps it.
5. Accent swatch writes literal color; default swatch writes the
   `var(--fmtText,#ffffff)` form (assert on saved `lyricsDoc` HTML).
6. Theme toggle flips the *computed* color of default-swatch text
   (getComputedStyle black-ish ↔ white).
7. Save → reload round-trip preserves all formatting.
8. Formatting a selection spanning a chord span leaves the chord span intact
   (still `contenteditable=false`, class/text unchanged).
9. Share-viewer render of a doc containing the var color computes to white.

On-device iPhone QA (only thing headless can't prove): the popover coexists
sanely with the native iOS selection callout; buttons are tappable without
losing the selection.

## Release

Standard Lite flow: build/verify `lite-1.076.html` → push (deploys to
`drafthaus.ca/lite-1.076.html`) → on-device QA → promote into `index.html` on
milestone. Confirm with the user before pushing.
