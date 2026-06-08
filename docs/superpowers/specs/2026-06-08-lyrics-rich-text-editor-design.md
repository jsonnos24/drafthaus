# Lyrics → Single Rich-Text Editor — Design

**Date:** 2026-06-08
**App:** Drafthaus (`index.html`, single-file vanilla JS + Web Audio + Firestore)
**Status:** Approved design, ready for implementation plan

## Goal

Replace the current per-section lyrics system with a single freeform rich-text
document — a TextEdit-style editor. Remove the overly complex chrome
(Write/Paste button + import modal, Add Section select, Common Arrangements
select, per-section blocks/menus in the lyrics body). Sections themselves stay
everywhere else in the app (structure, sequencer, chords, seq-strip); only
*lyrics* are decoupled from them.

## Approach (chosen)

**Vanilla `contenteditable` WYSIWYG.** One `contenteditable` div is the editor.
Formatting via the Selection API / `document.execCommand`
(`bold`, `italic`, `underline`, `fontSize`, `foreColor`, `hiliteColor`, plus a
monospace wrap). The doc is stored as a sanitized HTML string in a new
`song.lyricsDoc` field. Zero dependencies — fits the single-file, no-build,
vanilla-JS constraint, and is the native rich-text engine browsers already ship.

Rejected: embedding Quill/ProseMirror (too heavy for a 76k-line single HTML file
with no bundler); markdown source + preview (not true WYSIWYG, breaks the
"just like TextEdit" feel).

## Section 1 — Data model & migration

- **New field:** `song.lyricsDoc` — a single sanitized HTML string (the editor's
  `innerHTML`). Canonical lyrics for a song.
- **Old `song.lyrics` (`{partId: text}`)** stays on disk untouched but is no
  longer read/written by the lyrics UI. It is the **migration source only**.
- **Migration (lazy, once per song):** when a song is opened and `lyricsDoc` is
  empty/undefined but `song.lyrics` has content:
  - Walk sections in arrangement order (`song.sectionOrder` / active parts).
  - For each section with non-empty lyrics: emit a **heading** line with the
    section name (styled with the section's color/bold), then the lyric text as
    paragraphs.
  - Set `song.lyricsDoc` to that HTML and `save()`. Guarded by `lyricsDoc`
    existing, so it runs exactly once. Old object is never destroyed.
- **Persistence & sync:** saves through existing `save()` +
  `scheduleSyncToSheet()` (debounced on input). Serialized in the Firestore song
  payload alongside the existing `lyrics:` field (~line 37673).

## Section 2 — Editor component

Lyrics body (`#rtBodyInlineInner`) becomes:
- The editable title `<h1>` (kept — already works).
- A **persistent format bar** (`.il-fmt-bar`) pinned at the top of the editor
  area, sticky to the top of the lyrics scroll region.
- One **`contenteditable` doc** (`#ilLyricsDoc`, `.il-lyrics-doc`) filling the
  rest — white "page" surface reusing the existing Google-Docs page CSS
  (~line 8715).

**Format bar:** `B · I · U · Mono · Size · Color · Highlight`
- **B / I / U** — toggle buttons; active state read via
  `document.queryCommandState` on `selectionchange`.
- **Mono** — wraps the selection in a monospace span (for chord-over-lyric lines).
- **Size** — small dropdown with presets: Title / Heading / Body / Small.
- **Color** + **Highlight** — two swatch popovers (~8 swatches each + "none"),
  applied via `foreColor` / `hiliteColor`.

**Engine:** `document.execCommand` for all operations, scoped to the selection
inside `#ilLyricsDoc`. `ilDocInput()` fires on `input`, sanitizes `innerHTML` →
`song.lyricsDoc`, debounce-saves. A `selectionchange` listener updates toolbar
active states.

**Chords-as-text:** user types chord names directly; can size/color/mono them
like any text. No structured chord overlay in the lyrics doc.

## Section 3 — Cleanup / removal

Remove from the lyrics view:
- **Write/Paste** button (`ilOpenImportModal`) + the import modal and its
  auto-split logic (`ilRenderSplitPreview`, split-into-sections code).
- **Add Section** select (`ilAddSel` / `ilAddSection` / `ilBuildAddOptions`).
- **Common Arrangements** select (`ilArrangeSel` / `ilApplyArrangement` /
  `ilBuildArrangementOptions` / `COMMON_ARRANGEMENTS`).
- **Per-section blocks**: `ilMakePartHtml`, section labels/dots, the `···`
  section menu (`ilToggleSectionMenu`), Reassign (`ilRelabelPart` /
  `ilApplyRelabel`), per-section Delete, per-section notes inputs, and the
  per-section chord-chart/palette rendering inside the lyrics view.

**Boundaries:**
- Functions also called from outside the lyrics view (e.g. `seqDeleteByPartId`,
  structure/sequencer chord rendering) stay; only lyrics-view call sites and
  now-orphaned helpers are removed.
- The mobile full-screen lyrics modal (`#ilMobLyricsModal`) is folded into the
  new shared editor (Section 5).
- Dead-code sweep after wiring the editor: remove only helpers that grep-verify
  to zero remaining callers (matches the repo's prior sweep practice).

## Section 4 — Repointing consumers

Everything reading `song.lyrics[partId]` repoints to `song.lyricsDoc` via a
single helper `ilGetDocHtml(song)` — returns `lyricsDoc` if present, else lazily
runs the Section-1 migration. Guards un-migrated songs viewed in perform mode
before the editor was ever opened.

- **Perform / rehearse views** (`il-perf-mode`, run-through): render the one
  `lyricsDoc` HTML read-only into the perform surface as-is (larger type via
  existing perf-mode CSS). No injected section headers.
- **Practice view** (`practice-lyrics`, ~39677/42597): show the doc, or hide the
  lyrics block if empty.
- **"Has lyrics" badges** (~19451, 19651, 21451): change to "`lyricsDoc` has
  non-whitespace text content" (strip tags → check length).
- **Export / share / sheet sync** (~37673, 41817, 42592): serialize `lyricsDoc`;
  where plain text is needed, derive by stripping HTML to text.

## Section 5 — Desktop & mobile layout

**One editor, both platforms.** Remove the separate mobile modal
(`#ilMobLyricsModal`) and its textarea; both share `#ilLyricsDoc` + the format
bar.

- **Desktop:** title `<h1>`, persistent `.il-fmt-bar` pinned under it, then the
  white page doc filling the column (existing Google-Docs surround ~line 8715).
  Format bar sticks to the top of the lyrics scroll area.
- **Mobile:** same stacked layout; format bar is a single
  horizontally-scrollable row of compact icon buttons, sized within the existing
  `--dh-strip-h` / drawer-offset conventions so it doesn't collide with the
  global seq strip or bottom nav. Color/highlight/size poppers open as small
  anchored sheets above the bar. Mono + sizing stay first-class for
  chord-over-lyric lines.
- **Reused chrome:** the bottom-nav lyrics toggle (`nav-lyrics-toggle`, orange
  edit / white perform states) is unchanged — flips between editing and
  performing the doc.

## Section 6 — Edge cases & safety

- **Sanitization:** `contenteditable` output is still untrusted (paste, cross-
  device sync). On save and on render into perform mode, run a whitelist
  sanitizer — allow only `b/i/u/strong/em/span/div/br/h1-h3/p/font` and safe
  attrs (`style` limited to color/background/font-size/font-family, plus
  `class`); strip `script`, event handlers, `<img>`, etc. Paste handler routes
  through the same filter.
- **Empty doc:** placeholder ("Write your lyrics…") via CSS `:empty::before`;
  "has lyrics" treats whitespace/tag-only as empty.
- **Migration safety:** migration only populates `lyricsDoc`, never destroys
  `song.lyrics`; runs once, guarded by `lyricsDoc` existing.
- **Undo:** native `contenteditable` undo/redo within the field; not wired into
  the global `ucPushUndo` stack. Acceptable simplification.
- **Save cadence:** debounced `input` → `save()` + `scheduleSyncToSheet()`;
  flush on blur and on view-close.
- **Cross-device sync:** `lyricsDoc` is last-write-wins like other song fields;
  no merge logic.

## Out of scope

- Alignment & lists (left/center/right, bullets/numbers).
- Structured chord-chart overlay on lyric lines (chords are plain text now).
- Wiring lyrics edits into the global app undo stack.

## Verification

No test runner — drive the app in a real browser via playwright-core + installed
Chrome (see CLAUDE.md "Verifying changes"). Check: migration of an existing song
with per-section lyrics; B/I/U/Mono/size/color/highlight all apply and persist
through save + reload; perform/rehearse/practice render the doc; "has lyrics"
badge correctness; empty-doc placeholder; mobile format-bar layout. Verify on
both desktop and an iPhone-width viewport.
