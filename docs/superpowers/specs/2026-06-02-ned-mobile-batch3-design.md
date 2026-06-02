# ned mobile keyboard drawer — batch 3 design

**Date:** 2026-06-02
**Target build:** copy `1.308.html` → `1.309.html`; promote to `index.html` only after iPhone sign-off.
**Hard rule:** mobile only. All changes live inside the `ned` IIFE, the `@media (max-width:899px)` / `(max-width:768px)` CSS blocks, or new `ned-`prefixed CSS. Desktop render of existing content must stay byte-identical; verify the desktop render path is untouched before promoting.

This batch covers six items for the mobile standard-notation / Quick Chords drawer (`ned`). The lyrics section is explicitly deferred to a later batch.

Two areas are flagged **fragile** and get explicit headless + on-device verification: staff geometry alignment (#1) and the header/strip reflow (#5).

---

## 1. Tighten staff spacing (Moderate)

**Goal:** Reduce the empty halo around noteheads and bring the two staves closer. User picked "Moderate": noticeable tightening that keeps note-tap precision forgiving.

**Current geometry (1.308):**
- `NED_LINE_GAP = 15` (px per diatonic step; adjacent staff lines = 2 steps = 30px apart).
- `NED_TREBLE_TOP = 44`, `NED_BASS_TOP = 254` (literal).
- Note Y comes from `_nedMidiToY(midi) = NED_TREBLE_TOP + (diatonic(77) - diatonic(midi)) * NED_LINE_GAP`.
- Drawn lines: treble `NED_TREBLE_TOP + i*NED_LINE_GAP*2`; bass `NED_BASS_TOP + i*NED_LINE_GAP*2`.
- Staff SVG fixed height `386` (appears in 4 places: staff svg, ghost svg, `_nedApplyQCDefaultTop` height default, etc.).
- Notehead: `rx=7, ry=5` (~10px tall). **Unchanged** in this batch.

**Critical alignment invariant:** `NED_BASS_TOP` (254) equals exactly `NED_TREBLE_TOP + 14*NED_LINE_GAP` (44 + 14×15 = 254). The drawn bass lines (which use the top constants) and the bass *notes* (positioned by `_nedMidiToY`, which uses `NED_LINE_GAP`) only stay aligned because of this relationship. **If `NED_LINE_GAP` changes, `NED_BASS_TOP` must be recomputed from it** or bass notes drift off their lines.

**Changes:**
- `NED_LINE_GAP`: **15 → 11**. Staff space (line→line) becomes 22px; the ~10px notehead now sits with modest breathing room instead of a large halo. Vertical pitch resolution becomes ~11px/step (still forgiving for taps).
- `NED_BASS_TOP`: change the literal `254` to the computed `NED_TREBLE_TOP + 14*NED_LINE_GAP` (= 198 at gap 11). Preserves the bass note/line alignment invariant exactly. Side effect: treble↔bass gap shrinks 90→66px (desired).
- Add `const NED_STAFF_H = 320;` (down from 386) and route the four hardcoded `386` references through it (staff `<svg height>` + `viewBox`, ghost `<svg height>`, `_nedApplyQCDefaultTop` `||386` default, and any other `386` literal in the IIFE). 320 keeps ledger-line room above treble and below the new bass bottom line (bass bottom = 198 + 4×22 = 286; ~34px margin below).

**Out of scope:** notehead size, stem length (`cy-26`), beam offsets, rest glyph (rest Y auto-derives from `(NED_TREBLE_TOP+NED_BASS_TOP)/2`). These stay as-is; they remain visually acceptable at the tighter spacing.

**Verify:** Treble and bass notes land exactly on/between their drawn lines at the new spacing (place a note on each line/space across both clefs, headless + visual). Noteheads visibly fill more of each space. Desktop staff geometry unchanged (these constants are inside the mobile `ned` IIFE).

---

## 2. Bass-clef access — dedicated vertical handle

**Goal:** Reliable way to reach the bass clef. The 1.308 two-finger pan never fires because the Quick Chords overlay covers the lower staff and intercepts the touch. User picked a dedicated handle (same proven pattern as the bar-nav row that replaced staff-swipe).

**Keep (sound infra):**
- `_nedPanY`, `_nedApplyPan()`, `_nedSetPanY()`, the `.ned-pan` `<g transform="translate(0,-_nedPanY)">` wrapper on staff + ghost.
- The pan compensation in `_nedYToMidi` and `_nedHitNote` (`clientY - r.top + _nedPanY`).

**Remove:**
- The two-finger `touchstart`/`touchmove`/`touchend` listeners in `_nedBindPan` (and the `_nedTwoFinger` gate in the pencil handler can stay as a harmless no-op, or be removed — keep removal minimal to avoid churn; leaving the guard is fine since `_nedTwoFinger` simply never becomes true).
- The "✌ two-finger drag → bass clef" tip pill (`_nedEnsurePanTip` / `.ned-pan-tip`) — replaced by the handle's own affordance.

**Add — vertical pan handle:**
- A slim vertical scrollbar-style handle in the **right gutter** of the staff region. Rendered as a sibling element (not inside `#nedStaff`, so it never competes with the pencil pointer handlers), `position:fixed`/absolute over the staff with **z-index above the QC overlay** (`#nedQC`) so it is always reachable even when QC covers the lower staff.
- Drag (pointerdown→move) maps the handle's travel to `_nedSetPanY` proportionally (handle thumb position ∝ `_nedPanY / NED_MAX_PAN`). Use `setPointerCapture` so the drag survives finger drift.
- `NED_MAX_PAN` becomes **dynamic**, computed at drag start (and/or in `_nedApplyPan`): `maxPan = Math.max(0, NED_STAFF_H - staff.clientHeight + 20)` so a full drag brings the bottom bass line just into view above the QC overlay. Clamp `_nedPanY ∈ [0, maxPan]`.
- Handle shows a subtle ↕ glyph; thumb height/position reflects how far panned (optional but nice).
- Re-assert the handle (like the tip was) after each `nedRender` if it lives inside a wiped container; if it's a separate sibling of `#nedStaff`, it survives `staff.innerHTML` wipes and only needs binding once.

**Verify:** On iPhone, dragging the handle slides the staff so the full bass clef comes into view above QC; placed bass notes map to correct pitch (pan-corrected); single-finger pencil placement still works; handle is reachable when QC overlay covers the lower staff. `_nedPanY` resets to 0 on drawer open / `_nedRefresh` / song change.

---

## 3. Remove borrowed chords from the overlay

**Goal:** No borrowed chords in the mobile Quick Chords overlay.

**Change:** In `_nedRenderQC()`, delete the borrowed block (the `getBorrowedChords(key,mode)` call and the `.ned-qc-sectlabel` + `.ned-qc-borrowed` / `.ned-chip-bor` render). The diatonic + variations content (restructured in #4) is all that remains. Leave `getBorrowedChords` itself untouched (still used by desktop). `.ned-chip-bor` / `.ned-qc-borrowed` CSS may remain dormant (harmless) or be removed — removal optional.

**Verify:** No borrowed (teal) chips appear in the mobile overlay; diatonic + variation chips still render and drag/drop; desktop borrowed chips unaffected.

---

## 4. Variations nested under their parent (desktop-style layout)

**Goal:** Organize Quick Chords so each diatonic chord's variations sit directly beneath it (a column), mirroring the desktop stage layout (`.seq-chord-pill-col` + `.seq-chord-var-group`), instead of the current single diatonic row + a separate scrollable band of variation rows.

**Current (1.308) `_nedRenderQC` structure:**
- `.ned-qc-diatonic` — one horizontal row of 7 diatonic chips.
- `.ned-qc-scroll` — a separate area holding per-chord `.ned-qc-varrow`s (disconnected from their parent) + borrowed.

**New structure (mobile, `ned-`prefixed classes — do NOT touch desktop classes):**
- `.ned-qc-cols` — a horizontal flex row (`overflow-x:auto`) of 7 columns.
- `.ned-qc-col` — one column per diatonic degree: the diatonic chip on top, then a vertical `.ned-qc-varstack` of that chord's variation chips beneath it (variants from `_NED_QUAL_VARIANTS`, same as today).
- Overlay body (`#nedQCBody`) scrolls vertically if a column runs taller than the overlay; columns scroll horizontally.
- Reuse existing `.ned-chip` / `.ned-chip-dia` / `.ned-chip-var` styling and the existing post-render chip drag binding (`body.querySelectorAll('.ned-chip')...`), which still matches the new markup.

**Verify:** Each diatonic chord shows its variations stacked directly under it; columns scroll horizontally; tall columns scroll the overlay vertically; tap-preview + drag-to-staff still work for both diatonic and variation chips; desktop chord pills unchanged.

---

## 5. Header → strip stack in tool drawers (mobile)

**Goal:** In the tool drawers the top-down stack should be **sequence strip → drawer** (no site header, no gap). Today it reads header → gap → drawer. The header should remain visible in the song list (and, per scope note below, in the plain song-detail view).

**Scope:** A *tool drawer being open*, on `@media (max-width:899px)`:
`body.keyboard-drawer-open`, `body.seq-drawer-open`, `body.looper-drawer-open`, `body.ft-drawer-open`, `body.mix-drawer-open` (these map to keyboard / drums / looper / 4-track / mix respectively).

**Changes (all media-gated → desktop unaffected):**
- Hide the header in this state: `.site-header { transform: translateY(calc(-100% - 4px)); }` — reuses the header's existing `transition: transform …` (same mechanism as `body.header-scrolled-away`), so it slides away cleanly.
- Pin the strip to the viewport top: in this state set `.global-seq-strip { position:fixed; top:env(safe-area-inset-top,0); left:0; right:0; z-index:975; }` so it sits at the very top once the header is gone (the strip is otherwise `position:sticky;top:0` inside `#viewDetail`, which is offset under the fixed header).
- Reduce drawer `top`: in the existing mobile drawer-clearance block (`@media (max-width:899px)` … `top: calc(43px + var(--dh-strip-h) + safe-area)`), add an override for the drawer-open state so `top: calc(var(--dh-strip-h) + safe-area)` and `height: calc(100dvh - var(--dh-strip-h) - safe-area)`. Net stack: strip (`--dh-strip-h`, 33px) → drawer.

**Edge cases to check:**
- `#seqStripToggleBtn` (▲ collapse button) position relative to the now-fixed strip.
- `body.seq-strip-collapsed` (strip hidden) while a drawer is open — drawer should reclaim the strip's space (top back to safe-area only). Add the collapsed override if needed.
- `body.ucb-state-4` already hides the strip; ensure no conflict.
- Re-show the header correctly on drawer close (the transform is removed when the body class clears).

**Scope note (confirmed with user):** Tied to *drawer-open*, NOT "any song loaded." The plain song-detail view keeps its header so the header-logo back-navigation isn't stranded. (User approved this scoping; revisit only if they later want the header gone in all non-songlist views.)

**Verify:** Open each of the 5 drawers on mobile → header gone, strip flush at top, drawer directly beneath (no gap). Close drawer → header returns. Strip collapse toggle still works. Desktop and song-detail (no drawer) unchanged.

---

## 6. Marquee erase in the keyboard drawer

**Goal:** With the eraser tool active, tap-drag a marquee rectangle to select and erase many notes at once. Single-tap erase of one note is preserved.

**Change — eraser branch of `_nedBindEntry` (`pointerdown` when `_nedTool==='eraser'`):**
- Record start client X/Y.
- On `pointermove` past a small threshold (~6px), enter marquee mode: create/position a `.ned-marquee` rectangle element (absolutely positioned over `#nedStaff`, `pointer-events:none`) that tracks from start to current pointer.
- On `pointerup`:
  - **Marquee mode (moved):** convert the rect's two corners to content bounds via the existing pan-corrected helpers — `_nedXToCol(x,false)` for the col range and `_nedYToMidi(y)` for the midi range — then delete every note whose `startCol`/`midi` fall within the inclusive bounds. `nedRender()` + `_nedSave()`. Remove the marquee element.
  - **No movement (tap):** keep current behavior — `_nedHitNote` under the finger; if a note is hit, delete it; `_nedSave()`.
- Clean up listeners on pointerup/pointercancel; remove the marquee element on cancel.

**New CSS:** `.ned-marquee { position:absolute; border:1px solid #c084fc; background:rgba(192,132,252,0.12); pointer-events:none; z-index:3; }` (mobile/ned-scoped; reuses the purple tool accent).

**Verify:** Eraser + drag over several notes draws a rectangle and deletes all enclosed on release; eraser + tap on a single note still erases just that note; marquee math is pan-correct after using the bass handle (#2); empty marquee deletes nothing; no stray marquee left behind.

---

## Out of scope (deferred)

- **Lyrics section** — user said "worry about that later." Not in this batch.
- No desktop changes. No section-management or transport behavior changes.

## Verification plan

- Headless smoke per the repo's playwright-core recipe (EULA → guest → song-load → `openKeyboardDrawer`) to confirm the drawer mounts and renders without console errors beyond the expected Firestore `permission-denied` guest noise. Probe: new geometry constants, bass note alignment, QC column markup, no borrowed chips, marquee element wiring, drawer-open header/strip classes.
- **Fragile-area focus:** (#1) place notes across every treble/bass line and space and confirm Y alignment; (#5) toggle each of the 5 drawers and assert header hidden + strip at top + drawer top reduced.
- Desktop render path diff-check: confirm no change to desktop rendering (all edits are inside the `ned` IIFE or mobile-gated CSS).
- Primary acceptance is the user's iPhone test of items 1–6.
