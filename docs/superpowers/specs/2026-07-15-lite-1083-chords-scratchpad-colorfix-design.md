# Lite 1.083 — +CHORDS rename, mobile scratch pad, lyric-color bleed bugfix

**Date:** 2026-07-15
**App:** Drafthaus Lite (`lite-1.083.html`, branched from `lite-1.082.html` == live root `index.html`)
**Scope:** Three independent items in one build: a button rename, bringing the desktop
sticky-note scratch pad to mobile, and a formatting bug where coloring a lyric line
repaints the line above it red.

---

## Item 1 — Rename "Chordify" → "+CHORDS"

The vertical stacked-letter toggle in the recording rail (`#chordsModeBtn`,
`.rail-chordify`) currently reads `C/H/O/R/D/I/F/Y`.

**Change:**
- Button innerHTML becomes `+<br>C<br>H<br>O<br>R<br>D<br>S` (7 lines, one shorter
  than today).
- `aria-label` becomes `"Add chords"`. The `title` tooltip stays
  `"Add chords by tapping words"`.
- No logic changes: `toggleChordsMode()`, `_chordsMode`, chord-entry flow, and all
  CSS classes are untouched.

---

## Item 2 — Mobile scratch pad (sticky note)

The desktop sticky-note scratch pad (shipped lite-1.077: `#scratchPad`,
`#scratchText`, `#scratchResize`, rail button `#scratchBtn`, Firestore field
`song.scratch`, debounced `scratchInput`/`scratchFlush`, drag-resize, per-device
localStorage state) comes to mobile. Same element, same code paths, same data —
**no migration; every existing scratch pad appears on mobile automatically.**

### Visibility
- Remove `#scratchPad` and `#scratchBtn` from the `@media (max-width: 767px)` hide
  rule. `#inputBtn` (audio-input picker) stays desktop-only in that rule.
- The existing pencil-on-square icon appears in the mobile rail in its current DOM
  order — this is the toggle.

### Position & size (mobile only, `max-width: 767px` override)
- Anchored top-right of the lyrics area: `top: 14px; right: 66px` (14px clear of
  the 52px rail; the pad is absolute inside `.song-body`, which includes the rail).
  Desktop keeps its current `right: calc(50% + 14px)` (top-right of the lyrics
  half, left of the always-open takes panel).
- Width: `min(280px, 70vw)` — roughly 70% of the lyrics area on a phone, so lyrics
  stay partly visible behind the note.
- Default height: 220px (desktop stays 320px). The existing `#scratchResize`
  drag handle still works — it is already pointer-events based with
  `touch-action: none` and `user-select` disabled, the pattern that survives iOS
  Safari. The stored height (`dh-lite-scratch-h`) remains clamped by
  `max-height: calc(100% - 28px)`.

### Open-state default
- Same `dh-lite-scratch-open` localStorage memory as desktop, but the **unset**
  default becomes: open on desktop (unchanged), **closed on mobile**
  (`matchMedia('(max-width: 767px)')` at `scratchApply` time). Once the user
  toggles, the stored value wins on both. localStorage is per-device, so one key
  serves both defaults.

### iOS keyboard
- Bump `#scratchText` font-size to 16px on mobile — iOS Safari auto-zooms the page
  when focusing a text field styled below 16px. Desktop stays 14px.

### Layering / interplay
- Takes panel (`z-index: 7`) already slides over the pad (`z-index: 6`) — correct
  on mobile too, no change.
- No changes to `scratchApply`/`scratchInput`/`scratchFlush`/`scratchResizeStart`
  logic other than the device-aware open default.

---

## Item 3 — Bugfix: applying a lyric color repaints the line above red

### Reported behavior (user, 2026-07-15)
Fresh lyric lines, **no chords in the doc**. Drag-selected a line, tapped a
**non-red** swatch in the format toolbar → the selected line got the chosen color,
and the **line above turned red** (a color never applied).

This rules out the two easy explanations: chord-span color bleed (no chords
present) and simple selection-boundary bleed (that would paint the neighbor with
the *same* color chosen, not red). Red is `FMT_ACCENTS[0]` (`#d94848`) but nothing
in the code should apply it unprompted. **Root cause is unknown — reproduce
before fixing.**

### Step 1 — Reproduce headlessly (gate for any fix)
Drive lite in headless Chrome (standard Lite verify recipe) with exactly the
reported recipe, plus variants:
- new lines typed via Enter, drag-select one line (both drag directions), apply a
  non-red swatch;
- line above previously styled vs pristine;
- light and dark theme;
- repeat after a save/reload cycle (does the red come from saved HTML or appear
  live?).

Assert on the resulting editor HTML: no element outside the selection gains a
color, and no `#d94848`/`rgb(217, 72, 72)` appears anywhere unless that swatch was
tapped. No fix is written until a failing repro exists.

### Step 2 — Root-cause and fix
Suspects, in rough order:
1. Leftover `<font>`/style wrappers from an earlier edit that Chrome's
   `execCommand('foreColor')` extends or re-anchors when the selection touches the
   neighboring line's boundary.
2. Chrome style inheritance on line split/merge — Enter can silently clone
   formatting wrappers from an earlier red edit into new lines, revealed when a
   nearby edit renormalizes the DOM.
3. The toolbar's post-processing passes that scan the **whole editor** instead of
   the selection: `fmtColor`'s default-swatch rewrite
   (`querySelectorAll('[style*="color"]')`) and `fmtSetSize`'s
   `font[size="7"]` restyle. These whole-editor scans are a smell and get
   tightened to the affected range as part of the fix regardless of which suspect
   is guilty.

Fix whatever the repro convicts, at the root — no symptom-patching (e.g. no "strip
red after the fact" unless the repro proves the red is genuinely orphaned residue).

### Step 3 — Self-heal decision
After the root cause is known: if the bug wrote bad color wrappers into saved
`lyricsDoc` HTML, decide between a load-time cleanup (only if it can be made
provably safe — it must never touch deliberate red styling) or a one-off manual
fix of the affected song. Manual fix is acceptable if the damage is limited to
one song.

---

## Verification

Headless suite `_verify_lite_1083.js` (playwright-core + installed Chrome, Lite
verify recipe), covering:

1. **+CHORDS**: rail button text renders `+CHORDS` stacked; `aria-label` is
   "Add chords"; `toggleChordsMode` still toggles `.active` and chords-mode class.
2. **Mobile scratch pad** (mobile viewport, e.g. 390×844):
   - `#scratchBtn` visible in rail; `#scratchPad` hidden by default (no stored
     key);
   - tap toggles pad open/closed and persists `dh-lite-scratch-open`;
   - pad positioned top-right of lyrics area (right of pad ≈ 66px from
     `.song-body` right edge), width ≤ 70vw, height 220px default;
   - typing persists to `song.scratch` (existing debounce path);
   - `#scratchText` computed font-size is 16px;
   - `#inputBtn` still hidden on mobile.
3. **Desktop regression** (≥768px viewport): pad default-open, 280×320, position
   unchanged, 14px font — desktop behavior byte-for-byte identical.
4. **Color bugfix**: the Step-1 repro assertions, now passing; plus a sweep that
   applying each swatch to a drag-selected middle line never changes any other
   line's computed color.
5. **Regression**: run `_verify_lite_1082.js` (15/15) against the new build
   (⚠️ per memory: the 1.080 suite's A3 block is timing-flaky — re-run before
   trusting a fail).

## Versioning / deploy

Standard Lite flow: `cp lite-1.082.html lite-1.083.html` (diff the copy against
its source before editing), work lands on `main`, push deploys
`drafthaus.ca/lite-1.083.html`, promote to root `index.html` on sign-off.
Confirm with the user before pushing.
