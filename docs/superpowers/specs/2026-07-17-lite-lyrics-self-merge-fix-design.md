# Lite lyrics same-device self-merge fix (lite-1.084) — design

**Date:** 2026-07-17
**App:** Drafthaus Lite (`lite-1.084.html`, branched from `lite-1.083.html` == live root)
**Type:** Bugfix — data-corrupting

## Bug

Editing lyrics on one device, then backgrounding the app (phone call, home
screen) and returning, shows the "Merged lyrics from another device — review"
toast and **duplicates the lyrics** under a "—— Also edited on another device ——"
divider — with no second device involved.

## Root cause

Backgrounding catches a `flushLyrics()` Firestore transaction in flight (the
900 ms debounce timer or the editor `blur` fired it). The write commits
**server-side**, but iOS freezes the page before the client continuation runs,
so `_lyricsBase` stays stale. On return, `visibilitychange`/`focus` fire
`liteFreshenSong()`, which sees remote ≠ `_lyricsBase` and local ≠
`_lyricsBase`, and takes the merge branch — even though local and remote are
**byte-identical** (both are the device's own flushed text). The merge decision
is made on bad evidence; the divider and toast downstream are working as
designed on a wrong premise.

The same missing guard exists at all three merge sites:

1. `flushLyrics()` transaction (`serverDoc !== _lyricsBase` → merge)
2. `liteLyricsDrain()` transaction (`serverDoc !== e.base` → merge)
3. `liteFreshenSong()` else-branch (`local !== _lyricsBase` → merge)

None of them ever compare the two documents to each other.

## Fix (three parts)

### 1. Recognize-your-own-text guard — all three merge sites

Before merging, compare the two documents directly. If the local doc and the
server doc are string-identical, adopt the server copy as the new base — no
divider, no toast. Identical content is never a conflict, regardless of how it
got identical. (Within one session the sanitizer `ilSanitizeDocHtml` is
deterministic — same DOM → same string — so plain string equality is
sufficient for the same-device case; cross-browser serialization differences
only arise in the genuine cross-device case, where merging is correct anyway.)

- `flushLyrics`: in the transaction, `if (serverDoc === html)` → result = html,
  merged = false.
- `liteLyricsDrain`: in the transaction, `if (serverDoc === e.lyricsDoc)` →
  result = e.lyricsDoc, merged = false.
- `liteFreshenSong`: in the else-branch, `if (local === remote)` → set
  `_lyricsBase = remote`, `_currentSong.lyricsDoc = remote`, clear the pending
  save timer, return. No editor rewrite needed (content already matches).

### 2. Let in-flight saves settle before judging

`flushLyrics` stores its in-flight promise in a module var (`_lyricsFlushP`),
cleared/settled when the flush completes. `liteFreshenSong` awaits it (wrapped
in a catch) **before** fetching and comparing. When the user returns from a
call, any save that was mid-flight when the page froze completes first and
updates `_lyricsBase`; the freshen then sees remote === base and does nothing.

This also closes the wider window part 1 alone cannot: text typed *after* the
flush started makes local ≠ remote, and an equality guard would still
duplicate the shared portion — awaiting the settled base prevents the merge
branch from firing at all in that case.

### 3. Don't trust cached reads for merge decisions

`liteFreshenSong` bails (returns) if its `.get()` snapshot has
`snap.metadata.fromCache === true`. Right after a call the network is often
not yet re-established, and Firestore persistence can hand back an **older**
`lyricsDoc`; today that can silently replace the editor with stale text via
the `local === _lyricsBase` branch (a quieter cousin of this bug). Freshening
is only meaningful against the actual server; a later `online`/`focus`
freshen will run once connectivity is back.

## Explicitly out of scope

- No schema changes, no new Firestore fields, no security-rule changes.
- Genuine cross-device merges (divergent content) behave exactly as before —
  divider + toast preserved.
- No auto-healing of already-duplicated docs; the user deletes the divider and
  duplicate copy by hand once.
- Toast/divider wording unchanged.

## Verification

New `_verify_lite_1084.js` headless suite (playwright-core + installed Chrome,
per repo recipe):

1. **Frozen-flush race:** delay the flush transaction's client-side resolution,
   fire `liteFreshenSong()` mid-flight with server already holding the flushed
   text → assert no divider inserted, no merge toast, `_lyricsBase` settles to
   the flushed text.
2. **Identical-content adopt:** server doc == editor doc but ≠ `_lyricsBase` →
   freshen adopts silently (base updated, no divider/toast). Same assert for
   the `flushLyrics` and `liteLyricsDrain` transaction paths.
3. **Genuine merge regression:** server doc truly divergent from local →
   divider + toast still produced at each of the three sites.
4. **fromCache bail:** snapshot stubbed `metadata.fromCache = true` with a
   stale doc → freshen makes no editor change.
5. Full regression run of the 1.083 suite (19/19) + 1.082 (15/15).

Test-harness lessons that apply (from project memory): app top-level `let`
vars are not `window` props — stub by bare-name assignment; never stub
Firestore writes as instant-resolving when testing the race; don't stub
`navigator.onLine` for offline-adjacent asserts.

## Release

Standard Lite flow: `cp lite-1.083.html lite-1.084.html` (diff snapshot vs
source before editing), work lands on `main`, confirm with user before any
push (GitHub Pages deploys), promote to root `index.html` on sign-off.
