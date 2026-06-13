# Drafthaus Lite — Chords mode: tap a word to add a chord

**Date:** 2026-06-13
**App:** Drafthaus Lite (separate single-file companion; follows memory `drafthaus-lite.md`)
**Base build:** `lite-1.034.html` → new snapshot `lite-1.035.html`
**Deploy:** `drafthaus.ca/lite-1.035.html` (file-copy version, commit to `main`, push on user OK)

## Problem

The `lite-1.034` chord-entry flow (tap 🎵 → type in a toolbar field → chord drops at the text
caret) feels "wonky": the insertion point is wherever the caret happens to be, not the word the
user is thinking about. Desired model: after writing lyrics, **tap a word** → a chord field opens
**right above that word** → the chord is placed over that word.

The float-above rendering and the inline `<span class="chord">NAME</span>` storage (shared with
the full Drafthaus app via `lyricsDoc`) already work and are NOT changing. Only the **entry
interaction** changes.

## Constraint: contenteditable tap conflict

`#lyricsEditor` is contenteditable, so a tap normally places the text caret for editing lyrics.
Tapping a word to add a chord would collide with that. Resolution (user-approved): a **Chords
mode** toggle. In Chords mode the editor is non-editable and taps add chords; out of it, the
editor is for writing lyrics as normal.

## Design (mode toggle + tap-word + floating field)

### 1. Chords mode toggle
- State: `_chordsMode` (boolean).
- The `🎵 Chords` toolbar button calls `toggleChordsMode()`.
- **On:** set `#lyricsEditor` `contentEditable='false'`; add a `chords-mode` class to the editor
  (subtle visual cue — e.g. faint highlight that words are tappable); button shows an active
  "✓ Done" state; the toolbar hint reads "Tap a word to add a chord."
- **Off:** restore `contentEditable='true'`; remove the class and active state; restore the
  normal hint; close any open chord field.
- Leaving the song (`goHome`) or opening another song resets `_chordsMode` to off.

### 2. Tap a word → floating chord field
- In Chords mode, a tap/click on the editor:
  - Uses `document.caretRangeFromPoint(clientX, clientY)` to get `{textNode, offset}`.
  - Expands the offset to the surrounding **word** within that text node's data (word = run of
    non-whitespace characters; apostrophes/hyphens kept). Yields `wordStart` (offset of the
    word's first char) and the target text node.
  - Opens a small floating text input (`#chordEntry`, repositioned absolutely just **above** the
    tapped word using the word's client rect, mirroring the `_cpPosition` approach), focused.
- On **Enter**: place the chord (see §3), close the field.
- **Escape** or tapping the backdrop/outside: cancel, close the field.

### 3. Place / edit / remove (one gesture)
Target resolution for the tapped word:
- If `wordStart === 0` and the text node's `previousSibling` is a `.chord` span → that span is the
  word's existing chord (**edit/remove target**); open the field pre-filled with its text.
- Otherwise → no existing chord; the field opens empty (**add**).

On Enter:
- **Add** (no existing chord, field non-empty): if `wordStart > 0`, `splitText(wordStart)` so the
  word starts a fresh text node; insert `<span class="chord">NAME</span>`
  (`contentEditable='false'`) immediately before the word's text node.
- **Edit** (existing chord, field non-empty): replace the existing span's `textContent` with the
  new name.
- **Remove** (existing chord, field **empty**): remove the existing span.
- After any change: call `onLyricsInput()` (debounced save) and re-`_atomizeLyricChords()`.

### 4. Removed / unchanged
- **Removed:** the old caret-based entry plumbing — `_savedLyricRange`, the `selectionchange`
  tracker, the caret-insert path in `commitChordEntry`, `_lyricCaretRange`, and the popover's
  ✎ edit button (`cpEditChord`). Edit/remove now happen via tap-word.
- **Kept unchanged:** the "how to play this chord" popover (`#chordPop` — fretboard, guitar/uke,
  Play) that opens when you tap a chord to learn it; the float-above CSS; inline `<span
  class="chord">` storage and the sanitizer that strips `contenteditable` on save;
  `_atomizeLyricChords()`.
- The popover's 🗑 remove (`cpRemoveChord`) may be kept (harmless) or dropped; not required.

## Testing

Headless `_verify_lite_1035.js` (playwright-core + Chrome over real HTTP):
- toggling Chords mode sets the editor non-editable and adds `chords-mode`; toggling off restores
  editable.
- a simulated word-tap (drive the placement directly via the resolved target, since
  `caretRangeFromPoint` geometry is environment-sensitive) inserts a `<span class="chord">` immediately
  before the tapped word's first character, and it renders above the line (top above baseline).
- tapping a word that already has a chord opens the field pre-filled with that chord's text.
- empty-submit on a word with a chord removes the span.
- saved `lyricsDoc` (`ilSanitizeDocHtml(editor.innerHTML)`) still matches `<span class="chord">`
  with no `contenteditable`.
- no fatal JS errors.

**On-device (cannot verify headless):** `caretRangeFromPoint` word-hit accuracy on iPhone Safari,
floating-field placement vs. the on-screen keyboard, and the overall feel of tap-to-chord.

## Out of scope
- No change to `index.html` (full app) — file isolation per memory.
- No change to chord rendering, storage, the play-this-chord popover, or auth.
- No chord auto-suggest/validation beyond accepting the typed name (reuse existing engine for the
  play popover only).

## Ship
Snapshot `lite-1.034.html` → `lite-1.035.html`, implement, headless-verify, commit to `main`,
**stop before push** (push deploys `drafthaus.ca`); user on-device sign-off, then push + poll +
update memory `drafthaus-lite.md`.
