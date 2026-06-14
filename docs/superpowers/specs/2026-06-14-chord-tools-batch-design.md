# Drafthaus Lite — chord-tools batch (Quick Chords + Find-a-Chord)

**Date:** 2026-06-14 · **App:** Drafthaus Lite (`index.html` / `lite-1.0xx.html`) · single-file, vanilla JS.
Builds ship as numbered Lite snapshots, verified headless, promoted to `index.html`. Base = lite-1.053.

## Context / goal
A batch of chord-tool improvements across the two chord screens (Quick Chords = QC, Find-a-Chord =
FC), driven by on-device use. Six features, grouped into three shippable phases. All are cohesive
chord-UI work; none change the recording/lyrics/export paths.

## Cross-cutting decisions
- **E♭ tuning model:** tuning is a shared setting (`standard` | `eb`) used by **both** QC and FC.
  E♭ = subtract **1 semitone** from every *sounding* note and from every *displayed* chord/string
  **name** (flat-spelled). Fretboard **shapes / fret numbers never change** (you play the same
  positions; they just sound/are-named a semitone lower).
- **Persistence:** tuning is **per-song** (new Lite-only `tuning` field on the song doc, merge-saved
  so full-app fields are untouched). With **no song loaded** (guest/standalone) it remembers the last
  choice in `localStorage` (`dh-lite-tuning`), mirroring how the guitar/uke instrument toggle works.
- **Uke fret count = 15** (covers soprano/concert; tenor ~19 but 15 is the common standard).
- Each phase = its own Lite version, headless-verified + screenshots, promoted to `index.html`.

---

## Phase 1 — Quick Chords quick wins (lite-1.054)

**1a · Uke Cm/C#m barre bar.** The uke shapes are already correct (`Cm`=0333, `C#m`=1444); only the
barre *indicator* is missing. Add ukulele entries to `_DB_OVERRIDE` keeping the same frets/fingers but
with a barre: `Cm` → `{f:[3,3,3,0], fi:[3,2,1,0], b:[3]}`, `C#m` → `{f:[4,4,4,1], fi:[4,3,2,1], b:[4]}`
(f order = `[A,E,C,G]` per `_FB_TUNING.ukulele`). `_fbNeckSVG` already draws a barre when ≥2 strings sit
at the barre fret (3 strings at fret 3 / 4 here), so no renderer change.

**1b · Auto-play the I chord on key change.** In `_qcSetKey(k)` (only called by the root/mode dropdown
handlers, never on screen-open): after setting `_qcKey`, compute the tonic =
`seqGetScaleChords(_songKeyMode(k).key, _songKeyMode(k).mode)[0]`, set `_qcSelected = tonic`, then
`qcRender()` + `playChordOnInstrument(tonic, _qcInstrument)` (tuning-aware via Phase 2). So C→G major
draws+strums G; switching to A minor draws+strums Am.

**1c · String names on the QC fretboard.** `_fbNeckSVG(model, nStr)` draws the nut (open position only)
but no string labels. Add string-name labels down the left edge (like `fcRenderNeck`), deriving the
instrument from `nStr` (6=guitar, 4=uke) → `_FB_TUNING`. Place them left of the open/mute ○/✕ markers
(widen the left margin/viewBox a few px so they don't collide). **Tuning-aware** (Phase 2 shifts them).

**1d · Borrowed chords: interval label on top.** Today borrowed pills render `<span class="lab">iv</span>Cm`
inline inside `.qc-borrowed` (cramped). Restructure each into a small column matching the diatonic look —
interval label above, chord pill below — kept under the **Borrowed** heading. New markup per chord:
`<div class="qc-bcol"><div class="qc-ivl">{label}</div><div class="qc-bpill">{name}</div></div>`; update
`.qc-borrowed` CSS to a wrapping row of these columns; drop the inline `.lab`.

---

## Phase 2 — Tuning (shared QC + FC) (lite-1.055)

**2a · Layout.** `.qc-key-row`: root + Major/Minor dropdowns **left-aligned**, a **Tuning** dropdown
(`Standard` / `E♭`) **right-aligned** (`justify-content: space-between`, left group + right select).
Add the same Tuning dropdown to the FC header.

**2b · State + persistence.** Shared `let _tuning = 'standard'` (`'standard'|'eb'`). On QC/FC open: if a
song is loaded, `_tuning = _currentSong.tuning || 'standard'`; else `_tuning = localStorage['dh-lite-tuning'] || 'standard'`.
On change: set `_tuning`; if a song is loaded persist `{tuning}` (merge) on the song doc *and* mirror to
`localStorage`; re-render the active screen. Helper `_tuneShift()` → `-1` for `eb`, else `0`.

**2c · E♭ display + audio.**
- *Names:* `_dispChord(internalName)` = if `eb`, transpose the chord root down 1 semitone → new internal
  name, then `_spellChordName(shifted, true)` (flats); else `_spellChordName(name, _useFlats(_qcKey))`.
  Use it for QC pills + `#qcChordName`, and for FC's identified name. The diatonic scale is still computed
  for the *selected* key (shapes unchanged) — only the display is transposed.
- *String labels:* compute from `_FB_TUNING[inst][r] + _tuneShift()` so they read E♭ A♭ D♭ G♭ B♭ E♭ in E♭.
- *Audio:* QC — in `playChordOnInstrument`, add `_tuneShift()` to each midi. FC — fold `_tuneShift()` into
  `fcPlacedMidis()` (the played/identified pitches) so identification *and* playback drop a semitone while
  the tapped frets stay put. (Apply the shift only at the QC/FC call sites, not blanket inside
  `playNotesStrum`, to avoid affecting any lyrics-chord-popover playback — verify that caller.)

---

## Phase 3 — Find-a-Chord fretboard (lite-1.056)

**3a · Full horizontally-scrollable neck (pinned nut).** Replace the 5-fret window (`_fcBase`) with a
full neck. Layout = a flex row: a **fixed left panel** (string-name labels + the open/mute cell column)
and a **scrollable** (`overflow-x:auto`) panel with frets `1..MAXFRET` (guitar 22, uke 15). Both panels
share `ROWGAP`/row geometry so strings line up. Remove `_fcBase` and the windowing math; selecting a
chord from the dropdowns places dots at absolute frets and may scroll them into view.

**3b · Open / mute toggle.** Extend `_fcPlaced[r]` to `null` (none) | `0` (open) | `'x'` (mute) | `fret>0`.
Tapping the left open/mute cell cycles `null → 0 → 'x' → null`. Tapping a fret cell sets that fret
(clearing any open/mute), tapping the same fret again clears to `null`. Render `0`→○, `'x'`→✕ in the left
column; `fret>0`→dot. `fcPlacedMidis()` includes only numeric frets (`0` and `>0`), excluding `null`/`'x'`,
so mutes are dropped from chord ID + playback.

**3c · Tap-to-hear.** Tapping a fret or open string plays that single note at its pitch
(`tunedTuning[r] + fret`, tuning-aware); muting/clearing plays nothing. Single-note via
`playNotesStrum([midi], _fcInstrument)`.

**3d · Inlays.** Guitar: 3,5,7,9,12,15,17,19,21 (double dot at 12). Uke: 5,7,10,12,15.

---

## Testing
No test runner — headless `_verify_lite_10xx.js` via playwright-core + installed Chrome over local HTTP,
per phase, plus screenshots; promote each to `index.html`.
- **P1:** uke `fbGetVoicing('ukulele','Cm'/'C#m')` barres include 3/4 & frets unchanged; key change sets
  `_qcSelected` to the tonic + triggers a play; QC neck SVG contains string-name text; borrowed chords
  render as label-over-pill columns under Borrowed.
- **P2:** dropdown alignment (root/mode left, tuning right); tuning persists to the song doc +
  localStorage; in E♭ with **A minor** selected the I pill reads **`A♭m`** and the rest of the diatonic +
  variations are all down a semitone; string labels read `E♭ A♭ D♭ G♭ B♭ E♭`; `_tuneShift()` returns −1;
  played midis are −1; **shapes/fret numbers are byte-identical** between Standard and E♭.
- **P3:** neck renders frets up to MAXFRET in a scroll container with a pinned left panel; open/mute cycle
  `null→0→'x'→null`; mutes excluded from `fcPlacedMidis`; tapping a fret calls the single-note play;
  E♭ shifts identification + string labels but not tapped frets.

## Non-goals
Recording/lyrics/export untouched. No change to the chord-resolution engine beyond the `_DB_OVERRIDE`
additions and the display/audio tuning transpose. Tuning is a Lite-only song field.
