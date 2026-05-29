# Drafthaus — Global Sequence Strip Unification Design Spec

**Date:** 2026-05-29
**Working file:** `1.293opus.html`

---

## Overview

Make the **proportional sections-row** (today an Arrange-only widget) the **single, always-visible global sequence strip**, affixed in a fixed band directly **below the site header in every view**. It takes over the job of the current pill strip (`#globalSeqStrip` / `.seq-part-btn`), which is **retired**. One render path, one data source, one consistent position app-wide — so switching between Arrange and any tool never moves the strip.

**Why:** the strip is a primary, foundational element of Drafthaus; its behavior (select / reorder / playback position) should be identical everywhere, and its placement should be constant.

---

## Confirmed decisions

| Topic | Decision |
|---|---|
| Winning visual | The **Arrange proportional sections-row style** (bars sized to bar-length), promoted to the one global strip. Pill strip retired. |
| Layout | **Header → Strip → content** (tool drawer *or* Arrange). |
| Strip content | **Proportional bars + a live playhead** in every view (no full ruler outside Arrange). |
| Tap | **Select/activate** the section: loads it into the current tool, sets `seqActiveIdx`, and it's the playback-start + Phase-2a record-loop target. |
| Double-tap | **Solo-play** that section (replaces Arrange's old single-click solo). |
| Drag | **Reorder** (reuses `arrSecDrop` logic; audio/comp travel via `seqLinks4t`/`arrComp` keyed by `seq.id`). |
| Add / rename / delete | **Via the Sequence Manager** (not inline). Strip exposes one compact entry point to open it. |
| Mobile sizing | **Proportional + min-width floor + horizontal scroll.** |
| UCB | **Untouched internally; repositioned to a fixed bottom-center island.** |
| Mobile triangle (`ucbToggleCycle`, 4 states) | **Kept.** Change: state 3 no longer hides the strip; **only state 4** hides it (fullscreen editing). |
| Visibility | Visible whenever a song is loaded. **Hidden on the song list** and **in perf mode** (`il-perf-active`). |
| Implementation approach | **One shared component rendered into a single persistent element** (approach #1). |

---

## Architecture

**One renderer, one element, one data source.**

- **Renderer:** `seqStripRender(mode)` replaces `seqRenderSequenceTabs()` (≈ line 25853). It paints the proportional sections-row markup (the `.arr-section` style: a bar per active section, width by bar-length, drag-reorderable, active highlight, plus a playhead overlay). `_arrRenderSections` (≈ 74218) folds into it.
- **Element:** the existing `#globalSeqStrip` (≈ 18073) is kept (same id) but repurposed — pills out, proportional bars in. It lives in a fixed band **directly under the site header**, always present when a song is loaded.
- **Data source (unchanged):** `getActiveParts(song)` / `song.sectionOrder` / `song.sequences`; active section = `seqActiveIdx`; playhead position from `TL` (`TL.getCurrentBeat`, etc.).
- **Arrange structural change:** Arrange's ruler + track lanes render **below** the persistent strip; `#arrSectionsRow` is retired. The strip is the shared element (not Arrange-private). Visually Arrange is unchanged — the same strip sits at its top with lanes beneath.

---

## Sizing modes & scroll-sync

`seqStripRender(mode)` has two width modes:

- **`fit` (everywhere except Arrange):** strip spans the container; each bar's width is proportional to its bar-length, with a **min-width floor** (tap target). Overflow → **horizontal scroll**. This is also the mobile rule.
- **`grid` (in Arrange):** bar widths = `bars × ARR_PPB` so each bar sits exactly above its lane region; the strip **scroll-syncs** with the lanes (`_arrSyncScroll` drives both).

Entering Arrange re-renders the strip in `grid`; leaving re-renders in `fit`. Only width-computation and scroll-sync differ between modes.

**Playhead:** a thin overlay positioned from the current beat — `fit` mode by proportion across the strip, `grid` mode by `bar × ARR_PPB` (matching lanes). A single RAF (generalized from `_arrTick`) updates it during playback in **all** views.

---

## Interactions (app-wide)

- **Tap → select/activate.** Sets `seqActiveIdx`, loads the section into the current tool, highlights it, becomes playback-start + record-loop target.
- **Double-tap → solo-play** the section.
- **Drag → reorder** (existing `arrSecDrop` logic).
- **Trailing control → open Sequence Manager** (the only entry on the strip; all create/rename/delete happen there). The Manager's existing open path is preserved.
- **Active highlight is global** — one strip bound to `seqActiveIdx`, identical in every view; tool switches preserve it.

---

## UCB relocation

- `#ucBar` (≈ 67050) becomes a **fixed, bottom-centered floating island**: `position:fixed; left:50%; transform:translateX(-50%); bottom:<clearance>`. **Internals unchanged.**
- This is compatible with the triangle: states 3/4 already bottom-anchor `.uc-bar` — preserve that state-driven vertical positioning and layer horizontal centering on top.
- **Mobile clearance:** the bottom-center UCB sits **above the bottom-nav** (bottom→top: bottom-nav → UCB island → content). Add clearance so they never overlap.

---

## Mobile triangle (`ucbToggleCycle` / `_ucbApplyState`)

- The **4-state cycler stays** (`_ucbToggleState` 1→2→3→4, arrow rotates; mobile `< 900px`).
- **Only change:** state **3 keeps the strip visible**; **state 4** still hides the strip (plus header/nav/toolbars) for true fullscreen editing. (Today both 3 and 4 hide it — see lines ≈ 8209–8246.)
- Everything else about the cycler (UCB bottom-anchoring, header/toolbar hiding at state 4, QC-state hijack via `_qcMobileCycle`) is unchanged.

---

## Cleanup / retirement

- Replace `seqRenderSequenceTabs` internals with `seqStripRender`; retire `.seq-part-btn` pill styles.
- Retire `#arrSectionsRow` + `_arrRenderSections` (fold into `seqStripRender('grid')`); render Arrange lanes below the persistent strip.
- Triangle: edit only the state-3 strip-hide rule (keep state-4).
- **Visibility-coupling audit (main risk):** `.global-seq-strip` currently has many context rules that hide/reposition it (`split-active`, `il-perf-active`, `seq-drawer-open`, `qc-state-*`, `ucb-state-*`). Remove the hide/reposition couplings so the strip is constant under the header, **keeping only** the deliberate hides: triangle **state-4**, **perf mode**, and **song list**. This audit is the fiddliest part and the most likely source of regressions; do it methodically.

---

## Visibility & edge cases

- **Song loaded →** strip visible. **Song list →** hidden (no sections).
- **Perf mode (`il-perf-active`) →** hidden (fullscreen performance).
- **Split view →** strip stays in its under-header band (split-specific repositioning removed).
- **Playback →** strip playhead animates in all views via the shared RAF.

---

## Risks
- **Visibility-coupling audit** (above) — the strip's many existing context rules must be reconciled carefully; a missed rule causes the strip to vanish/jump in some mode.
- **Arrange scroll-sync** — the strip must stay pixel-locked to the lanes in `grid` mode (no drift); regression risk if the sync isn't preserved exactly.
- **UCB ↔ bottom-nav clearance on mobile** — overlap if clearance is wrong.
- **Single-file size** (77K lines) — keep new code cohesive near the existing strip/arr code.

## Relationship to other work
- Compatible with **Phase 1** (per-section take attribution) and **Phase 2a** (punch/linear recording): "tap = select = record-loop target" is exactly Phase-2a's section-loop arm.
- This is its own spec → plan → implementation cycle, independent of the Phase-2a recording plan.

## Key anchors
- Strip: `#globalSeqStrip` (≈18073), `seqRenderSequenceTabs` (≈25853).
- Arrange row: `#arrSectionsRow` (≈66073), `_arrRenderSections` (≈74218), `_arrSyncScroll` (≈75064), `ARR_PPB`.
- UCB: `#ucBar`/`.uc-bar` (≈67050).
- Triangle: `ucbToggleCycle` (≈33490), `_ucbApplyState` (≈33496); state CSS ≈8208–8255.
- Model: `seqActiveIdx`, `getActiveParts`, `song.sectionOrder`, `arrSecDrop`, `seqLinks4t`/`arrComp`.
