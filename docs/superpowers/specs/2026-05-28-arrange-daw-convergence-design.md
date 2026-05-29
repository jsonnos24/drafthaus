# Drafthaus — Arrange → DAW Convergence Design Spec

**Date:** 2026-05-28
**Base version:** 1.292
**Working file:** `1.293opus.html` (duplicate of `1.292.html`; all changes applied there)

---

## Overview

Turn Drafthaus's **Arrange** mode into a Logic Pro–style DAW by completing a convergence that has already started: Arrange already renders a unified track list (4 audio tracks `ft0–ft3` + instrument tracks for Chords/Keys/Looper/Drums) with arm-for-record buttons, a section-aligned timeline, a playhead, master VU + fader, and zoom. The missing pieces are **recording into Arrange**, **multi-take + per-section take selection surfaced in Arrange**, and **comping** (net-new). Once Arrange reaches feature parity, the standalone **4-Track drawer UI** retires (its audio engine stays as the shared backend).

This is structured as a **program**, not one change:

- **Spec 1 (this doc): Arrange → DAW Convergence**, in three phases.
- **Spec 2 (separate follow-up): GUI/UX Polish Pass** — seeded as a prioritized punch-list in the Appendix.

### Goals
- Record audio directly on the Arrange timeline (arm → record → take).
- Surface multiple takes and let each **section** pick its best take.
- Add Logic-style **swipe comping** as a power drill-down within a section.
- Keep **sections primary**: dragging a section to reorder it carries its audio + MIDI content with it.
- Retire the redundant 4-Track drawer once Arrange + a mobile capture view replace it.

### Non-goals (this spec)
- The full app-wide visual refactor (that is Spec 2; the DAW work only adopts the new design tokens).
- Full-timeline DAW editing on mobile (mobile gets a focused capture view).

---

## Confirmed design decisions

| Decision | Choice |
|---|---|
| Organizing model | Unified track list (Logic) **with sections as primary, content-carrying blocks**; audio tracks expand to take lanes |
| Section drag | Reordering a section carries its audio takes + MIDI regions with it |
| Comping model | **C** — per-section take picker by default, drill-in swipe comp as power layer; **ship A (picker) first** |
| Recording in Phase 1 | **Record directly in Arrange** (arm + record on the timeline) |
| Mobile | **Desktop DAW + a simplified mobile capture view** (take-pick only; swipe-comp desktop-only) |
| 4-Track retirement | Remove the **drawer UI** only (side-tab, drawer, split-dock, mobile transport bar); **keep** `_mtTracks` engine/takes/`vrRecord`. Gated by a parity checklist |
| Mixer | **Fold into Arrange** as a panel (polish spec, after DAW work) |
| Design tokens | **Adopt during DAW work** — the new DAW sets the visual bar; no retrofit |
| Implementation approach | **Extend Arrange in place, but introduce a unified region/take data model first** |

---

## Data model (the backbone)

The key insight: today's **links** already address audio by **section identity**, not absolute time. We lean into that. Only the `arrComp` field is net-new; everything else reuses existing structures.

```
TRACK (ARR_TRACKS @ ~73757 + _arrTrackState)
  id · group(4track|harmony|looper|drums) · label · color · mute/solo/vol

SECTION (_arrBuildSections)
  partId · label · bars · startBar(recomputed on reorder) · seq (the sequence powering it)

REGION  (derived — NOT stored)
  rendered where a TRACK × SECTION has content:
    - audio track  → exists where the track is *linked* to the section (_seqLinksLoad('4t') @ ~25943)
    - midi/drum    → exists where the section's seq has data
  (_arrRenderLanes @ ~74070, _arrMakeAudioRegion @ ~74198)

TAKE (_mtTracks[i].takes[] — already exists)
  id('take_…') · buffer · blob · downloadUrl · duration

COMP MAP  ★ NET-NEW  (persisted on the song, synced like links)
  song.arrComp[trackId][sectionId] = { slices: [{ takeId, from, to }], xfade }
    - from/to: seconds, relative to the section start; `to: 'end'` allowed for the last slice
    - xfade:   crossfade at slice seams, in milliseconds
    - P1: a single full-section slice  →  "pick a take per section" (model A)
    - P2: multiple slices              →  swipe comp (model B/C)
```

**Why this is the whole ballgame:** `arrComp` is keyed by **sectionId** (stable identity), not bar position. So reordering a section automatically carries its take choices, MIDI, and audio — **no separate move logic**. And P1's single-slice entry is the degenerate case of P2's slice list, so swipe comping **extends the same field** with no migration.

Persistence: store `arrComp` on the song object and persist/sync via the same path as `_seqLinksSave` (`save()` + `scheduleSyncToSheet(song)`).

---

## Phase 1 — Record-to-timeline + per-section take picker (model A)

**Scope:** desktop Arrange only. Ship value fast; no comping splice yet.

### UI changes
- **Transport:** add a real `⏺ REC` state with a recording clock, a **count-in** toggle (default 2 bars), and an **input-monitor** indicator. Reuse the existing Arrange transport.
- **Track headers:** the `R` (arm) button already exists per audio track (`arrArmTrack`); wire its armed/recording visual state. Section under the playhead gets a record outline.
- **Audio regions:** during record, draw a **live waveform** in the region; on stop, commit it to a take.
- **Per-section take picker:** each audio region shows a `Take N ▾` chip (on the region, not the header). Clicking opens a menu of the track's takes (waveform thumb + duration, ✓ = active), plus a greyed **"Comp…"** entry (Phase 2 hook) and Delete/Import. Selecting a take writes `arrComp[trackId][sectionId] = { slices: [full-section slice], xfade: 0 }`.

### Recording flow
1. Click `R` on a track → armed, input monitor on.
2. Position playhead / select a section.
3. Hit `⏺` → 2-bar count-in → transport rolls.
4. Sing/play → waveform draws live in the region.
5. `⏹` → a new **take** is created and **auto-linked to the section(s) the playhead crossed**, set active for those sections.

Reuses `_arrStartRecording` (@ ~75166), `_mtArmTrack`, and `vrRecord`. The new work is: section-aware take assignment on stop, live waveform rendering into the region, and the take-picker UI + `arrComp` read/write.

### Playback (P1)
For each audio region, resolve `arrComp[trackId][sectionId].slices[0].takeId` (fallback: track `activeTakeIdx` / first take) and schedule that take's buffer for the section's bar span.

---

## Phase 2 — Swipe comping (models B/C) + region editing

**Entry:** the take picker's **"Comp…"** expands the region into a **takes folder** scoped to that section's bar span.

### Comping UI
- A **★ COMP lane** (top) auto-assembles, color-coded by source take.
- One lane per take, each showing its waveform across the section's bars.
- **Swipe** across a take lane → that time-range becomes that take's slice in the comp. Overlapping swipes: last swipe wins the contested range.
- Seams get an **equal-power crossfade** (default 10 ms, draggable handle).
- Collapse → region shows the comp as one block labeled `Take✦ ▾`.

Data: grows `arrComp[track][section].slices` from one entry to many, e.g.
`slices: [{takeId:T1,0,2.0},{takeId:T3,2.0,5.0},{takeId:T2,5.0,end}], xfade:10`.

### Also in Phase 2
- Region **trim** handles (L/R) + **drag-move** within a track.
- Region **crossfade** handles between adjacent regions.
- Take **rename / color / delete**; **"promote comp to a take."**
- **Playback engine** that renders the slice list with sample-accurate crossfades.

### Hard part (called out)
Sample-accurate slice playback with crossfades in Web Audio — scheduling per-slice `AudioBufferSourceNode`s with equal-power gain ramps at seams — is the real engineering in P2. Doable, but the highest-risk task; plan it as its own milestone with an isolated audio-scheduling prototype.

---

## Phase 3 — Mobile capture view + 4-Track retirement

### Mobile capture view
A **section-oriented vertical recorder** (full timeline won't fit a phone), same data as desktop:
- Track chips at top (pick the track being recorded).
- The song's sections as a vertical list; each row: section name, current take, `Take ▾` picker, and a record button (`⏺`).
- Transport (play / ⏺ / ⏹) + monitor indicator.
- **Take-pick only (model A)**; swipe-comp stays desktop-only.

### Retirement path (staged, reversible)
- **Today:** 4-Track drawer = recorder everywhere; Arrange visualizes.
- **P1–P2:** Arrange becomes the desktop recorder + comper; 4-Track drawer stays in parallel (zero removals).
- **P3 gate — parity checklist** (port first, then remove): input-gain pill, monitor toggle, take import/export, per-take trim, storage management.
- **P3 retire:** ship mobile capture → remove the 4-Track **side-tab + drawer + split-dock + mobile transport bar**. **Keep** `_mtTracks` engine, takes, `vrRecord`. Old songs' takes still load.

**"Retiring 4-Track" = deleting redundant UI, not the audio engine.**

---

## Risks & mitigations
- **Web Audio comp playback** (P2) — isolate as a prototype milestone before UI build.
- **Single-file size** (77K lines) — extend in place; keep new code in cohesive, clearly-commented blocks near the existing `arr*` code.
- **Data migration** — none required: `arrComp` is additive; absence falls back to existing `activeTakeIdx`/first-take behavior. Old songs load unchanged.
- **Parity gate** — 4-Track removal blocked until the checklist passes, so nothing is lost.
- **Mobile scope creep** — capture view is intentionally take-pick only.

---

## Appendix — GUI/UX Polish punch-list (seeds Spec 2)

Tags: **P1** high / **P2** med / **P3** low. Spins out into its own spec; the DAW work adopts the tokens early.

**① Navigation & drawer sprawl**
- P1 Define top IA: Write → Make → Record/Arrange → Mix → Songs.
- P1 **Fold Mixer into Arrange** as a panel (Arrange already has vol/mute/solo + master) → −1 tab.
- P2 Group keys/drums/chords/loop "make the backing" surfaces; fewer top-level modes.
- P2 4-Track tab removed at DAW P3 → −1 tab.
- P3 Audit practice/inspo drawers for merge/relocate.

**② Visual consistency / theming**
- P1 **Design tokens** as CSS vars: spacing scale, radii, type scale, color roles.
- P1 Unify button system (seq-btn / ucb / one-offs) → 3–4 variants.
- P2 Consolidate slate/warm theme one-offs onto tokens.
- P2 Consistent iconography + sizing across drawers.
- P3 Sweep inline styles → classes incrementally.

**③ Mobile experience**
- P1 Rationalize the stacked bottom bars (transport + seqStrip + nav clearance hacks).
- P1 Mobile capture view sets the pattern other mobile drawers follow.
- P2 Touch-target + drawer open/close consistency pass.
- P3 Revisit "Arrange hidden on mobile" once capture view exists.

**④ Onboarding & discoverability**
- P1 Teaching empty states (empty Arrange/section → "arm + record").
- P2 Unify tour/tooltip system into one first-run flow.
- P2 Focused coachmark introducing the new DAW/comping.
- P3 Contextual hints when a feature is first reachable.

**Sequencing:** tokens + buttons → nav consolidation (after Mixer-fold + 4-Track retire) → mobile → onboarding.

---

## Files changed
- `1.292.html` → copied to `1.293opus.html`; all DAW-convergence changes applied there.
