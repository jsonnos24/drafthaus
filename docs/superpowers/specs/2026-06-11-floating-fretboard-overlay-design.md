# Floating fretboard overlay — design spec

**Date:** 2026-06-11
**Base build:** `1.313.html` (= `index.html`, md5 `505b1cea1bbe6188ed6d7c6fb3a8f37e`). Implementation lands in a fresh `cp 1.313.html 1.314.html`.
**Scope:** desktop-only addition to the existing floating keyboard (`fkb*`) overlay.

## Goal

Add a selectable guitar/ukulele/bass **fretboard** directly beneath the keys in the
floating keyboard panel. Clicking any chord pill (diatonic, variation, or borrowed)
shows an accurate, playable voicing on the fretboard. The display is **sticky** — it
stays until the next chord is clicked — and so is the keyboard's key glow.

## Decisions (locked during brainstorming)

1. **Instruments:** selectable Guitar / Ukulele / Bass, default **Guitar**. Lives in
   the same floating overlay, stacked under the keys.
2. **Voicing source — hybrid:** reuse the existing hand-tuned `getChordTab` open
   voicings + barre fallback where they exist; fall back to a new algorithmic engine
   for everything else (and all of bass).
3. **Bass is root-focused:** mark the **root, 3rd, and 5th** on the neck (labeled
   R / 3 / 5), not a strummed shape.
4. **Diagram style:** **horizontal neck** (strings left→right, matching the keyboard
   orientation above it), low string at the bottom, nut at left.
5. **Sticky:** both the keyboard glow and the fretboard persist until the next chord.
6. **Empty state:** plain neck with string labels; chord name shows "—".
7. **Dot labels:** finger numbers (1–4) for guitar/uke; R / 3 / 5 for bass. Neck inlay
   markers (frets 3/5/7/9/12) + fret-number labels shown.

## Out of scope (YAGNI)

Mobile (the floating keyboard is desktop-only and bails under 768px), left-handed
necks, alternate tunings, capo, multiple-voicing cycling, strum/audio from the
fretboard itself (audio already fires from the pill press).

## Architecture

### Module & placement
- New `fb*` functions added beside the existing `fkb*` code (~line 35745+ in 1.313).
- `fkbInit()` gains one addition: append a `#fkbFretboard` section **inside
  `#fkbPanel`, after `#fkbBody`**. Same floating overlay; keyboard on top, fretboard
  beneath. It is part of the draggable panel and is hidden whenever the panel is
  minimized to the inline strip (it shares the panel's show/minimize lifecycle).
- Desktop-only: guarded the same way `fkbInit` already is (`innerWidth < 768` → no
  fretboard).

### Integration hook (single chokepoint)
- `seqShowChordOnKeyboard(chordName)` runs on every pill press (it is the existing
  funnel from `seqPillPress`). Add one call at its end:
  `if (typeof fbShowChord === 'function') fbShowChord(chordName);`
- `fbShowChord(name)` stores `_fbCurrentChord = name` and calls `fbRender()`.
- No chord-pill markup changes anywhere.

### Sticky behavior (the one behavior change)
- Remove the `seqHideChordOnKeyboard()` call inside `seqPillRelease()` (1.313 line
  ~31995). After release, the keyboard glow and fretboard stay on the last chord.
- The existing clear at the **top** of `seqShowChordOnKeyboard()` still wipes the
  previous chord when a new one is pressed, so "sticky until next chord" holds.
- `seqHideChordOnKeyboard()` stays defined and still runs on sweep-mode-off
  (`seqToggleSweepMode`) and at the top of `seqShowChordOnKeyboard`. Sweep mode is
  unaffected.
- **Known scope consequence:** the keyboard glow becomes sticky *everywhere chord
  pills are used* (seq drawer, quick chords, mobile portrait), not only under the
  floating keyboard. This is intended.

## Voicing engine — `fbGetVoicing(instrument, chordName)`

Returns a render model:
```
{
  strings: [ {fret:int|null, open:bool, label:string|null}, ... ],  // high→low, matching getChordTab order
  baseFret: int,        // leftmost fret shown in the window (0 = open position)
  root, third, fifth    // pitch classes, for bass labels / coloring
}
```
`fret:null` = muted (✕). `open:true` = ○ left of nut. Order is **high→low string** to
match the existing `getChordTab` arrays (`[e,B,G,D,A,E]` guitar; `[A,E,C,G]` uke).

### Step 1 — parse name → root + quality suffix
Reuse the parsing `_chordToMidi` already uses: strip `_viii`; root = first 1–2 chars
(2 if second char is `#`); `qual` = remainder. Get pitch classes from
`_chordToMidi(name)` (mod 12). Root pc = `_chordToMidi` first note; 3rd/5th derived
from `_CHORD_INTERVALS[qual]` (3rd = the [1] interval if present, 5th = [2]).

### Step 2 — library first (guitar & uke only)
Map the suffix to the `getChordTab` quality label and try `getChordTab(instrument,
root, label)`:

| suffix | getChordTab quality |
|--------|--------------------|
| `''`   | Major |
| `m`    | Minor |
| `7`    | Dom 7 |
| `maj7` | Maj 7 |
| `m7`   | Min 7 |
| `sus2` | Sus2 |
| `sus4`, `msus4` | Sus4 |
| `dim`  | Diminished |

If `getChordTab` returns a fret array, convert it to the render model (compute
`baseFret` from the min non-open fret; finger labels per Step 4).

### Step 3 — algorithmic fallback (everything else + all bass)
Covers `add9, m9, madd9, dim7, m7b5, dimM7`, any future quality, and bass.

Open-string tunings (low→high, MIDI):
- Guitar: `[40,45,50,55,59,64]` (E A D G B E)
- Ukulele gCEA (reentrant high G): `[67,60,64,69]` (G C E A)
- Bass: `[28,33,38,43]` (E A D G)

**Guitar/uke algorithm:**
- For candidate base positions `b` in `0..9`: for each string find the lowest fret in
  `[b, b+4]` whose note pc ∈ chord pcs; record it, else mute.
- Score each `b` by: chord-tone coverage (bonus for including the root on a low
  string), then by lowest position, then by smallest fret span. Pick the best.
- Cap span to 4 frets; mute strings that don't fit. `baseFret = max(0, minFret)` (0 if
  any open/low-position notes present → show open window 0–4).

**Bass algorithm (root-focused):**
- Find a compact cluster (≤4-fret span, prefer lowest) that places the **root**, then
  the **3rd** and **5th** if they fall within the window, across the 4 strings. Open
  strings allowed. Do not force all three if they don't fit compactly — root is
  mandatory, 3rd/5th best-effort.
- Labels: root→`R`, 3rd→`3`, 5th→`5`. Render root gold, 3rd/5th green.

### Step 4 — finger numbering (guitar/uke)
Heuristic: collect fretted (non-open) notes, sort by fret ascending; assign finger =
rank starting at 1, capped at 4. Notes sharing the same fret get the same finger
(barre). Open strings have no number (○). Best-effort, not a guitar-pedagogy solver.

## Rendering — `fbRender()`

- Reads `_fbCurrentChord` + `_fbInstrument`; if no chord, draws the **empty state**
  (plain neck + string labels, chord name "—").
- Horizontal neck SVG: 6 string rows (guitar) / 4 (uke, bass), low string at bottom,
  nut bar at left, ~5 fret columns.
- **Window:** `baseFret = 0` → frets 0–4 with ○/✕ markers left of the nut. `baseFret
  > 0` → no nut bar, columns labeled from `baseFret`, a `"<baseFret>fr"` tag at top-left.
- **Inlay markers** at absolute frets 3/5/7/9 (single) and 12 (double) when in window.
- **Fret-number labels** under each column.
- **Dots:** filled circle with finger number (guitar/uke) or R/3/5 (bass). Open ○ and
  mute ✕ at the left edge.
- Chord name shown in the toolbar (`_fbCurrentChord` or "—").

## Instrument toggle

- Toolbar above the neck: segmented control `[ Guitar | Uke | Bass ]` (left) + chord
  name (right).
- State in `_fbInstrument`, persisted to `localStorage['drafthaus-fb-instrument']`,
  default `'guitar'`.
- `fbSetInstrument(id)` updates state, persists, re-renders the current sticky chord on
  the new instrument immediately.

## Edge cases

- **Unparseable / empty chord name:** render empty state, don't throw.
- **No voicing found** (algorithm fails to seat anything): render the neck with all
  strings muted + a small "no shape" note rather than a blank/crash.
- **Panel minimized:** fretboard hidden with `#fkbBody` (shares lifecycle); on restore
  it re-renders `_fbCurrentChord`.
- **Octave/enharmonic roots** (e.g. `F#` vs `Gb`): rely on `_chordToMidi`'s existing
  `SEQ_NOTES` handling; sharps are canonical there.

## Verification checklist (the pass/fail bar — no unit runner)

Driven headless via playwright-core + installed Chrome using the standard bootstrap
(EULA localStorage flag → `signInAsGuest()` → `_createAndLoadSong` → open the keyboard
drawer / floating keyboard). All must pass:

1. **Renders & stacks:** floating keyboard open on desktop shows the `#fkbFretboard`
   below the keys with the `[Guitar|Uke|Bass]` toggle and an empty neck ("—").
2. **Open chord:** clicking a `C` pill shows guitar C major (A=3, D=2, B=1, G/e open,
   low-E muted) with finger numbers.
3. **Rich quality (algorithmic):** clicking a `Cmaj7` / `Am7b5` / `Gdim7` pill shows a
   non-empty, in-window voicing (not "no shape").
4. **Up-the-neck windowing:** a chord that seats above fret 4 shows a `"Nfr"` start
   label and shifted fret numbers.
5. **Toggle:** switching to Uke then Bass re-renders the *same* current chord; bass
   shows R/3/5 labels (gold root, green 3rd/5th), 4 strings.
6. **Persistence:** the instrument choice survives a reload (localStorage).
7. **Sticky:** after releasing a chord pill, the keyboard glow **and** fretboard remain
   lit; clicking a different pill replaces both; sweep-mode-off still clears.
8. **No regressions:** keyboard play, octave +/−, minimize-to-inline, and drag-move of
   the floating panel still work; no new console errors beyond the expected guest-mode
   Firestore `permission-denied` noise.
9. **Mobile untouched:** under 768px no fretboard is created and nothing throws.

## Implementation notes

- File is ~76k lines — locate by quoted strings / function names, not line numbers.
- After `cp 1.313.html 1.314.html`, diff the copy against 1.313 to confirm a clean base
  before editing. Update CLAUDE.md to point at 1.314 and promote to `index.html` only
  after the verification checklist passes and the user signs off (Pages deploys on
  push to `main`).
