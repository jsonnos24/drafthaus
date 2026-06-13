# Drafthaus Lite — chords-above-lyrics + auth gating

**Date:** 2026-06-13
**App:** Drafthaus Lite (separate single-file companion; follows memory `drafthaus-lite.md`, NOT `index.html`)
**Base build:** `lite-1.033.html` → new snapshot `lite-1.034.html`
**Deploy:** `drafthaus.ca/lite-1.034.html` (file-copy version, commit to `main`, push, on-device sign-off)

## Problem

Four user-reported issues in Lite, all in the lyrics/chord editor and auth landing:

1. **Chord bleeds into typing.** Marking text as a chord leaves the caret inside the
   `.chord` span, so subsequently typed lyrics become part of the chord (tappable/hoverable).
2. **Adjacent chords merge.** Two chords added on the same line fuse into one when
   hovered/tapped.
3. **Double-space → period.** To position a following chord the user spaces across; iOS/Safari
   smart-punctuation turns a double space into ". ".
4. **No login on Safari / DuckDuckGo.** Visiting while not signed in opens the app shell with an
   empty song list instead of the login landing. New users and returning-but-unsigned users
   should always land on login.

Root cause of 1–3 is one design choice: chords are created by **selecting typed lyric text and
wrapping it inline** (`applyChordFormat()` → `range.surroundContents(span)` in `lite-1.033.html`
~line 965). The chord text lives *in the lyric baseline*, the caret ends up *inside* the span,
and positioning requires spacing-over.

Root cause of 4: LOCAL auth persistence auto-resumes a previously chosen **anonymous (guest)**
session, so `onAuthStateChanged` fires with a user and the app enters directly
(`lite-1.033.html` ~line 2115).

## Constraint: shared `lyricsDoc`

Lite and the full Drafthaus app share the same Firestore `lyricsDoc` field, both using inline
`<span class="chord">` markup. Any change must keep `lyricsDoc` readable/writable by the full
app. Therefore we **keep inline `.chord` spans as the stored representation** and change only how
Lite *renders* and *creates* them. (ChordPro-bracket source and a separate `chordPositions` field
were both rejected: they diverge from the shared field and break cross-app visibility.)

## Design (Approach A — keep data, change render + entry)

### 1. Chords render above the lyric line

`.chord` spans become zero-width inline anchors; the chord label is lifted above the line:

- `.chord { position: relative; display: inline-block; width: 0; }`
- chord label drawn in an absolutely-positioned child / `::before`, `bottom: 100%` (above the
  word that immediately follows the span in document order — ChordPro `[G]word` semantics).
- lyric lines get enough top padding / line spacing that a chord never collides with the line
  above.
- existing chord styling (monospace, tappable affordance) preserved.

The full app still reads the same spans; it renders them inline (degraded but not broken), which
is acceptable.

### 2. Chord entry (fixes bugs 1 & 2)

Replace "select text → 🎵 wraps it":

- Tap 🎵 (or tap a word) → a small chord input/picker appears (reuse the existing chord engine /
  `_normChordName` + chordPop UI where practical).
- On confirm, insert a **discrete** `.chord` span at the caret position (anchored above the
  following word), then **restore the caret into normal lyric text, outside any span** (insert/
  move to a trailing text node so the next keystroke is plain lyric text).
- Each chord is its own anchored span → cannot bleed into typing (bug 1) and cannot merge with a
  neighbour (bug 2).
- Tapping an existing chord opens the chordPop overlay (already present) extended with
  **edit** and **remove** actions.

The old select-and-wrap path is removed.

### 3. Double-space → period (bug 3)

- Primary trigger removed: chords float above automatically, so the user no longer spaces-over to
  position them.
- Belt-and-suspenders in the lyrics editor: set `autocorrect="off"` and `autocapitalize="off"`
  on the editor, and intercept `beforeinput` to cancel the smart-punctuation period substitution
  (when the input would replace a trailing space with ". ", keep the two spaces).

### 4. Auth gating (bug 4)

- On `onAuthStateChanged`, auto-enter the app **only for a real (non-anonymous) account**.
- If the resumed `user.isAnonymous` and the user did **not** choose "Continue as guest" in the
  current session (tracked via a `sessionStorage` flag set by `authGuest()`), show the login
  landing instead of the app.
- Real Google/email accounts behave exactly as today.
- Additionally verify Google popup sign-in works on Safari/iOS; if popups are blocked by ITP,
  fall back to `signInWithRedirect`. (Flagged as a check; only implemented if the popup path
  actually fails.)

## Testing

Headless `_verify_lite_1034.js` via playwright-core + installed Chrome over **real HTTP**
(not `file://`), using the established bypasses. Assert:

- chord labels render **above** the lyric baseline (computed geometry: chord top < lyric top;
  chord occupies ~0 horizontal space in the line flow);
- new chord entry produces a discrete `.chord` span and the **caret lands outside it** — typing
  after it yields plain lyric text, not chord text (bug 1);
- two chords created in sequence remain **two separate spans** and resolve independently on tap
  (bug 2);
- a double space in the editor stays two spaces, not ". " (bug 3);
- boot with a resumed **anonymous** user shows the login landing; boot with a real account enters
  the app (bug 4).

Also assert the stored `lyricsDoc` still uses `<span class="chord">` so the full app stays
compatible.

## Out of scope

- No changes to `index.html` (full app) — file isolation per memory.
- No re-architecture of the shared `lyricsDoc` machinery (sanitize/migrate/commit-guard) beyond
  the render/entry changes above.
- No new chord-theory features; reuse the existing Lite chord engine.

## Ship

Snapshot `lite-1.033.html` → `lite-1.034.html`, apply changes, headless-verify, commit to `main`,
push, poll deploy, then user on-device sign-off (esp. chord entry on iPhone Safari + login
gating on Safari/DuckDuckGo). Update memory `drafthaus-lite.md`.
