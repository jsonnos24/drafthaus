# Mobile Notation Keyboard Drawer — design

**Status:** design complete (brainstorm). Awaiting final spec review → implementation plan.
**Date:** 2026-06-01
**Scope constraint:** **MOBILE PORTRAIT ONLY. Desktop must be untouched.**

## Overview & goal

Replace the current **mobile** keyboard drawer (the piano-roll grid body rendered by
`openKeyboardDrawer()`) with a **dark standard-notation editor**: a grand staff you
tap/draw notes onto, with a Quick Chords overlay you drag chords from, plus a togglable
mini-keyboard for live play/record. It is a new *editing surface* over the **same data**
the app already uses, so playback + Firestore sync are unchanged.

## Hard constraints

- **Mobile portrait only.** `openKeyboardDrawer()` already branches mobile-portrait /
  mobile-landscape / desktop. We replace **only the mobile-portrait body**. Desktop
  keyboard drawer, desktop piano roll (`prBodyInner`), and the existing desktop Notation
  View (`#notationContainer`, `.nt-*`) stay exactly as-is. Gate the new code behind a
  width check (same pattern Arrange uses: it fully stubs when `innerWidth < 900`).
  **Verification: diff desktop rendering before/after — zero change** (except the one
  sanctioned change below).
  - **One sanctioned exception:** the **shared sequence-strip ▶ Play** behavior changes
    *globally* (desktop included) to "play from the selected section onward" — see
    Transport. That's the only intentional desktop change; everything else stays untouched.
- **Same data model, "replace, same data."** Reads/writes the existing per-section
  `pianoRoll` notes (`{id, midi, startCol, durCols, chordName, degree, isPencil, vel}`,
  on a 1/16 grid: `prSnap=4` cols/beat → 16 cols/bar in 4/4) and `chordSlots`. No new
  persistence; playback + sync untouched. A song edited on mobile opens on desktop and
  vice-versa.

## Layout (top → bottom, iPhone-16e reference 390×844)

1. **Sequence strip** — the existing global proportional section strip, reused at top.
2. **Toolbar (single row):** five **note-length buttons** left (whole/half/quarter/eighth/
   sixteenth — reuse the desktop `pr-dur-btn` SVG noteheads + `prSetDuration`); on the
   right **🔒 Key** (KeyLock, `_prKeyLock`) sitting beside **🎲 Vel** (randomize velocity,
   `prRandomizeVelocity`; shows toast "randomized velocity").
3. **Tools + Close row:** **pointer · ✎ pencil · ✕ erase** left-aligned & large
   (~46×38, easily tappable); **⌄ Close** (closes drawer) right-aligned.
   - **Pointer icon = a mouse-cursor arrow** (classic angled cursor, e.g. an SVG arrow
     pointing up-left). **NOT** a `▸` play/triangle glyph — that reads as Play.
4. **Stripped UCB transport:** **Click** (metronome toggle, text only) left · **● REC**
   (red) · **▶ Play** (centered, wider; toggles to **■ Stop** while playing — no separate
   stop button) · **TAP** (tap tempo, wide) · **BPM** (manual entry). Maps to
   `rtTapTempo` / `rtMetroSetBpm` / `htBpmInput` and play/record transport.
   See **Transport, looping & timing** below for Play/REC behavior.
5. **Grand staff** — dark (black bg, white lines). **Clefs & time signature REMOVED**
   (unicode glyphs rendered badly; bars get full width). **2 bars at a time**, smooth
   **horizontal scroll** for more. Green **bar numbers** at each bar start. Notes
   **coloured by scale degree** (rainbow palette, below).
6. **Quick Chords overlay** — bottom overlay over the staff (see below).

> Reference mockups (gitignored, persist on disk): `.superpowers/brainstorm/91902-*/content/`
> — `layout-v15.html` (full chrome) and `keyboard-A-final.html` (keyboard mode).

## Transport, looping & timing

- **UCB ▶ Play = loop the SELECTED section.** Plays only the currently selected
  section, looping it (section-scoped playback — cf. `arrStripPlayToggle` /
  `window._arrSetSelectedSec(i)`). Toggles to ■ Stop while playing.
- **Sequence-strip ▶ Play = play from the SELECTED section ONWARD** (through the rest of
  the song, not looping a single section, and not always-from-the-top). Uses the
  start-section index (`_startSectionIdx` / `seqActiveIdx`).
  - **DECIDED — apply GLOBALLY.** Change `seqStripPlayToggle()` so it plays from the
    selected section onward on **both mobile and desktop** (replaces today's always-
    `sharedPlaySong`/play-everything behavior). This is the **one sanctioned desktop
    behavior change** (see Hard constraints). When implemented, **update CLAUDE.md**'s
    "Buttons & playhead" note (it currently documents the strip ▶ as "always plays
    everything").
- **Recording = 2-bar count-in.** Pressing ● REC gives a **2-bar count-in** (metronome)
  before capture starts, so you can prepare.
- **Time-signature-aware everywhere.** All bar math uses the section's actual time
  signature (`seq.time`: 4/4, 3/4, 6/8, 5/4, …), NOT a hard-coded 4/4 — bar width, the
  "2 bars" window, rest filling, tie/barline crossing, beat snapping, count-in length, and
  beaming groups (e.g. compound 6/8 beams in threes). One bar = `time × prSnap` columns
  for simple meters; compound meters handled per their beat grouping.

## Grand staff rendering — relaxed "notation-styled piano roll"

NOT strict multi-voice engraving. It reads as a grand staff but follows relaxed rules:

- Real **noteheads** where **shape = duration** (open whole/half, filled quarter, flags/
  **beams** for eighths/sixteenths). Stems on quarters/halves; beam runs of 8ths/16ths.
- **Rests fill empty beats.** **Notes past the barline render as ties.**
- **Polyphonic:** overlapping notes **stack vertically like a chord** (no strict voice
  separation). Grid-exact (mathematically sound), readable, far less code than engraving.
- Notes are **NOT locked to bar start** — a whole note can begin mid-bar (placeable/
  draggable to any valid beat).
- **Colour = scale degree**, rainbow like desktop: `_prRbW = ['#e53e3e','#ed8936',
  '#ecc94b','#48bb78','#4fd1c5','#4299e1','#9f7aea']` (I=red…vii=purple); chromatic/black
  use `_prRbB` darker variants.

## Note entry mechanics

- **Placement model = free placement.** Pencil places exactly the tapped note at the
  selected length; other notes untouched. (NOT smart bar-fill / auto-repartition.)
- **Tools:** pencil = tap to place (plays audio) / drag to live-scrub pitch+beat / tapping
  an occupied spot **adds** a stacked note. Pointer = tap-select, drag-move, **marquee
  drag-select** multiple (reuse PR engine `prMultiSelected` + group ops). Eraser = tap to
  delete / drag to wipe.
- **Snapping:** pencil snaps note **start to the selected note-length grid** (tidy);
  **pointer drag** moves on the fine **1/16 grid** (precise nudge). Pitch snaps to nearest
  line/space, or nearest **in-scale** pitch when **Key Lock** on (`_prKeyLockSnap`).
- **Resize:** select note(s) → tap a length button to resize (works on a marquee
  selection too).
- **Added notes inherit the tapped pitch.** Audio feedback on place/drag/drop.

### OPEN — pencil note-length / bar-fill deep-dive (revisit before building this part)
User's lean: when adding a shorter note, **if it lands where it mathematically fits, keep
its length and leave the others alone** (free placement, not auto-redistribute). Earlier
idea (whole→half→quarter cascade) was softened. Exact rule still to be pinned down
(replace-from-tap vs subdivide-uniform vs free-placement-if-valid) — needs a short
working session.

## Quick Chords overlay

- **Bottom overlay over the staff.** Resting top edge covers the **bottom 3 bass-staff
  lines** (full treble + top 2 bass lines stay visible). **Gold drag-handle**: drag UP =
  reveal more, DOWN = less.
- **Header (two rows):** a **label row** — `KEY` left · the gold **drag-handle** +
  "drag to resize" centered · `VOICE` right — sitting above a **controls row** —
  **Key dropdown** left · **Chords | Keys** toggle center · **Voice dropdown** right.
  Labels go *above* their dropdowns (not inline) so the Voice value (e.g. "Drafthaus")
  doesn't wrap.
- **Content (Chords mode):** desktop Quick Chords palette — **Diatonic** row fixed on top
  (purple), then a **scrollable** list of **Variations** (cream) and a labeled
  **Borrowed** section (teal). Everything reachable by scroll; nothing stranded.
- **Voice = renamed "Chords"; the Synth instrument option renamed "Drafthaus."**

### Chord-pill drag-with-ghost
Press a pill → drag toward staff → Quick Chords **slides down/hides** to reveal the staff
→ a **ghost** of the chord's noteheads (semi-transparent, category-coloured) snaps to the
beat under the finger (selected-length grid). Release → writes the chord at that beat with
the **selected note length**, lands in the **bass clef**, **auto-voiced root position in a
consistent register** (vertical drag does nothing — only picks the beat), plays, panel
slides back. Writes to `chordSlots` (playback/sync unchanged). Penciled notes + dropped
chords both take the selected note length.

## Mini-keyboard (Keys mode — Option A)

- Access = **Chords | Keys toggle** in the overlay header. "Keys" turns the SAME panel
  into a playable mini-piano; Voice dropdown then shows the **treble/melody** instrument.
  Same gold drag-handle to resize; never covers the staff.
- **Respects Key Lock:** out-of-scale keys dimmed/disabled when on.
- **Press-and-drag glissando:** slide across keys for legato runs, white→black & black→white.
- **Keys coloured by scale degree** (same rainbow `_prRbW`/`_prRbB` as the staff/desktop:
  root + intervals).
- Enables live play + **record** (REC in UCB) — preserves the "noodle and capture a
  melody" capability the old keyboard had.

## Instruments / defaults (per clef)

Map to existing `melodyInstrument` / `chordInstrument`:
- **Treble clef = melody** (penciled notes) → default **Upright piano** (`piano2`) for new songs.
- **Bass clef = chords** (Quick Chords) → default **Drafthaus** (renamed synth) for new
  songs, changeable via the Voice dropdown.
- These are **defaults for new songs only.** Mobile must **read existing saved instrument
  values** (e.g. set on desktop) and reflect them, never overwrite.

## Verification

- No test runner — drive in a real browser (see `CLAUDE.md` + memory `drafthaus-headless-verify`).
- **Desktop-unchanged check:** render the desktop keyboard drawer / piano roll / notation
  view before & after; confirm zero diff.
- Confirm mobile staff round-trips `pianoRoll`/`chordSlots` (edit on mobile → correct on
  desktop and in playback).

## Build sequencing (suggested)

1. Mobile-portrait gate + drawer chrome (strip, toolbar, tools+close, UCB w/ REC).
2. Staff renderer (relaxed notation from `pianoRoll`: noteheads/rests/ties/beams, colours,
   2-bar window + h-scroll, bar numbers).
3. Note entry (pencil/pointer/eraser, snapping, marquee resize, audio) — *resolve the
   open bar-fill rule first*.
4. Quick Chords overlay (toggle header, scroll list, drag-handle resize).
5. Chord-pill drag-with-ghost.
6. Keys mode (coloured keyboard, Key Lock, glissando, record).
7. Polish + desktop-untouched verification.
