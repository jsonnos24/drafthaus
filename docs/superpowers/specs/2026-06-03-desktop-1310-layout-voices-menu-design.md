# Desktop 1.310 — layout, voices, menu/header cleanup

**Date:** 2026-06-03
**Build:** 1.310 (copied from 1.309.html)
**Scope:** Desktop only. 21 changes across the piano-roll layout, the floating
keyboard, the global sequence strip, the side menu/header, side tabs, quantize
default, and the instrument voice list.

---

## Guiding principle

**Settle every structural move first; do the "fill the remaining space" tasks
last.** The piano-roll fill-to-bottom (T1), the grid reclaiming the left column
(T10), and the Quick Chords overlay positioning (T9) are all computed against the
*final* layout. If they run before the structural moves (toolbar edits, floating
keyboard default, keys-column relocation, seq-strip relocation), every later
structural change forces re-tuning. So those three run at the end of the layout
phase, against settled geometry.

## Decisions locked (from brainstorming)

- **Analog synth voices:** hunt for a free *sampled* pad/lead set first; if none
  meets a usable quality/completeness bar, fall back to **oscillator-based**
  Web Audio synth voices. Bass Guitar + Violins use real CDN samples
  (`nbrosowsky/tonejs-instruments` → `bass-electric`, `violin`).
- **PR height:** fill to the window bottom, reactive to resize, **keep the
  manual resize handle** (`#prResizeBar`).
- **Seq strip relocation:** mount under the toolbar **in both the keyboard
  drawer (PR grid) and the drum drawer (step grid)** — both have a grid to align
  to. In all other tool views the strip stays below the header. This mirrors the
  existing Arrange mount/unmount pattern.
- **T9 "default open":** open when there is no saved state; respect an explicit
  user close within a session (do not force-reopen on every PR open).
- **T6 layout:** the vertical 1–9 column becomes **compact horizontal chips** in
  the params bar.
- **T18 alignment:** the strip mounts against two different grid systems (PR
  `PR_COL_W` vs the drum step grid); alignment logic adapts per host drawer.

## Key elements (reference)

- Piano roll: `.pr-overlay` → `.pr-panel` (resize via `#prResizeBar`); toolbar
  `.pr-header`; left "Keys 1-9" column `#prChordPalette`; grid `#prGridScroll` /
  `#prKeys` / `#prGridContainer`; H/V zoom `#prZoomH` / `#prZoomV`
  (`prSetZoomH/V`, `PR_COL_W`).
- **Quick Chords overlay** (distinct from the above): floating `#qcContainer`,
  toggled by `#qcToggleBtn` (`qcToggleView()`), minimize `qcMinimize()`.
- Global sequence strip: `#globalSeqStrip` (`seqStripRender('fit'|'grid', ppb)`),
  play btn `#seqStripPlayBtn` (`seqStripPlayToggle`), `.seq-strip-bar` bars.
- Side menu: `#mobileMenuPanel` (← Song List, `#mobileMenuQuota`,
  `#menuThemeToggle`, MIDI Connect, About, …).
- Header: `#hdrTutorialBtn`, `#hdrHelpBtn`.
- Side tabs: `.side-tab-key` (first letter), `.st-rest` (rest), `.side-tab-label`.
- Instruments: `INSTRUMENTS` array (~line 22088); chord/keys dropdowns
  (`piano2+synth` etc.); samplers from `nbrosowsky/tonejs-instruments` + salamander.

---

## Phase 0 — Container

**T17 — Build 1.310.** Copy `1.309.html` → `1.310.html`. Update the build badge
text (`Build 1.3xx`) to `1.310`. All subsequent work lands in `1.310.html`. Do
**not** touch `index.html` (deploy is a separate, user-approved promote step).

## Phase 1 — Independent quick wins (no layout interaction)

- **T11 — Side-tab opacity invert.** `.side-tab-key` → `opacity: 1`; the rest of
  the word (`.st-rest`, or `.side-tab-label` base) → `0.7` or darker. First
  letter now reads brightest. Verify active/hover states still look right.
- **T12 — Hide header help buttons.** Hide `#hdrTutorialBtn` and `#hdrHelpBtn`
  (CSS `display:none`, reversible).
- **T13/T16/T19/T20 — Menu cleanup.** In `#mobileMenuPanel`: remove/hide About
  item, MIDI Connect item, Theme toggle (`#menuThemeToggle`), and Quota
  (`#mobileMenuQuota`).
- **T14 — Sign-In menu item.** Add a Sign-In button at the **top** of
  `#mobileMenuPanel`, shown **only when the user is signed out** (guest/no auth).
  Clicking it opens the existing login / create-account overlay. Hidden when
  signed in.
- **T21 — Yellow Song List.** The `← Song List` item at the top of the menu:
  text + arrow → yellow (`var(--gold)` / existing gold token).
- **T7 — Quantize off by default.** New songs default `melodyQuantize = false`
  (it already is at the data layer — verify defaults at song-creation paths).
  **Acceptance:** with quantize off, selecting notes and tapping the Quantize
  button still quantizes the selection (`melodyToggleQuantize` /
  `melodyQuantizeNotes`). Confirm the toggle path applies on demand.
- **T8 — Sequence-part borders.** Add visible borders between `.seq-strip-bar`
  sections so section boundaries are legible. Verify in both the below-header
  ('fit') placement and the new under-toolbar (grid) placement (T18).

## Phase 2 — Voices (precedes Phase 3)

**T15 — Add voices to chords + keys dropdowns.**
1. **Research step (first):** look for free *sampled* analog **pad** and **lead**
   sets on public CDNs (jsDelivr GitHub mirrors etc.). Document the chosen source
   URLs in the build. If nothing usable, implement **oscillator-based** pad/lead
   voices (saw/square + filter + envelope) — analog character, instant load.
2. **Bass Guitar:** `nbrosowsky/tonejs-instruments` → `bass-electric` samples
   (same loader pattern as `GUITAR_BASE_URL`).
3. **Violins:** `nbrosowsky/tonejs-instruments` → `violin` samples.
4. Register all four in `INSTRUMENTS` and the **chord** and **keys** instrument
   dropdowns (the `<option>` lists at ~35302, ~44618, ~44632, ~46735). Treat as
   standalone single voices (not combos) unless a combo is trivially free.
5. **Acceptance:** each new voice selectable in both dropdowns; plays audibly;
   no console errors beyond expected guest Firestore noise.

*Dependency:* done before T2 so the relocated "Keyboard Voice" dropdown already
carries the new options.

## Phase 3 — Layout cluster (strict order)

1. **T4 — Remove Q-Flam.** Delete `#prQFlamBtn` and `#prQFlamAmt` (the ticks
   dropdown) from `.pr-header`. Leave `prToggleQFlam`/`prApplyQFlam` code dormant
   or remove cleanly; ensure nothing else calls them in a way that breaks.
2. **T5 — Zoom label.** Add a **"Zoom"** label centered **above** the H/V sliders
   (`#prZoomH` / `#prZoomV`). Wrap the two slider `<span>`s in a small column with
   the label on top, centered between them.
3. **T2 + T3 — Floating keyboard.**
   - Default to the **minimized** position on load.
   - Range **C1–C6** (currently C1–C7).
   - Inline layout order: `[C1–C6 keyboard] [Pop-Out btn] [Keyboard Voice: ▾]`.
     Move the keyboard-voice (keys instrument) dropdown **out of** the floating
     keyboard body to sit beside Pop-Out, labeled "Keyboard Voice:".
   - Flip the drawer toggle **triangle to point up** (the direction the floating
     keyboard travels when popping).
4. **T6 — Relocate Keys 1-9.** Move `#prChordPalette` (the 1–9 scale-degree
   slots) out of the PR body into the **params bar**, between the Key dropdown and
   the Time Signature: `Key ▾ · "Use Keys" label · [1][2]…[9] chips · Time Sig`.
   Render the slots as compact horizontal chips. Preserve their existing
   click/keyboard (number-key) behavior and per-degree colors.
5. **T18 — Seq strip under toolbar (keyboard + drum drawers).**
   - Hide `#seqStripPlayBtn` (Play Sequence) — its width was pushing the bars out
     of alignment.
   - Mount `#globalSeqStrip` under the toolbar inside the **keyboard drawer**
     (above the PR grid) and the **drum drawer** (above the step grid), using the
     Arrange-style mount/unmount pattern (`_arrMountStrip`/`_arrUnmountStrip` as
     the reference). On leaving those drawers, return it below the header.
   - Render in a **grid-aligned** mode so each section's width = its bar-count ×
     the host grid's pixels-per-bar, offset by the key-label gutter (44px in PR).
   - **Resize on horizontal zoom:** when `prSetZoomH` (or the drum grid zoom)
     changes, re-render the strip so sections grow/shrink to stay aligned. Hook
     the strip re-render into the existing zoom handlers.
   - Alignment math adapts per host: PR uses `PR_COL_W`; the drum drawer uses its
     own step-grid column width.
6. **T10 — Grid reclaims left column.** With `#prChordPalette` gone from the PR
   body, the grid (`.pr-grid-wrap`) expands to the full horizontal frame.
7. **T1 — PR fills to window bottom.** `.pr-panel` extends to the bottom of the
   viewport, reactive to window resize (recompute on `resize`), accounting for
   the final stack height (header + relocated strip + params bar + minimized
   floating keyboard + transport). **Keep `#prResizeBar`** so the user can still
   shrink it.
8. **T9 — Quick Chords overlay.** `#qcContainer` defaults **open** and
   **right-aligned**, positioned so it clears the right-edge side tabs
   (`#sideTabs`, ~28px). Default-open only when no saved state; an explicit close
   in a session is respected (not force-reopened).

## Phase 4 — Verify

Drive the desktop `1.310.html` headless (playwright-core + installed Chrome, per
CLAUDE.md bypasses: EULA → `signInAsGuest()` → `_createAndLoadSong` →
`openSong`). Confirm:
- Layout cluster: PR fills to bottom + resizable; grid full-width; Keys 1-9 in
  params bar; Zoom label present; Q-Flam gone; floating keyboard minimized/C1–C6
  with reordered controls + up triangle.
- Seq strip: under toolbar in keyboard + drum drawers, sections aligned to grid,
  resize correctly on H zoom; Play Sequence hidden; borders legible.
- QC overlay: open + right-aligned, clears side tabs.
- Menu/header: About/MIDI/Theme removed, Quota hidden, Sign-In shown when signed
  out, Song List yellow, header help buttons hidden.
- Side tabs: first letter brightest.
- Voices: four new voices load + play in both dropdowns.
- Quantize: off by default; tap-to-quantize on a selection still works.

## Out of scope

- Mobile (this batch is desktop-only).
- Promoting 1.310 → `index.html` (separate user-approved deploy step).
- Any unrelated refactor of the PR/strip engines beyond what these tasks require.
