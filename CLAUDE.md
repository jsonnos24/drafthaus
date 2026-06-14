# Drafthaus — developer guide

> **Two separate apps live in this repo.** This guide is for the **full Drafthaus**
> app. ⚠️ **As of 2026-06-14 the full app is `full.html` (== `1.3xx.html` snapshots),
> NOT `index.html`.** `index.html` was reassigned to **Drafthaus Lite** — `drafthaus.ca`
> (the site root) now serves Lite, and the full app moved to `drafthaus.ca/full.html`.
> Lite is a separate single-file companion (`lite-*.html` + `samples/` + `_verify_lite_*.js`)
> that shares the same Firebase backend but is otherwise independent code. Full-app work
> touches `full.html`/`1.3xx.html` and never `lite-*.html`/`index.html`, and vice-versa.
> If the task is about Lite, follow memory `drafthaus-lite.md`, not this file. Lite is
> versioned `lite-1.0xx.html`, deploys to `drafthaus.ca/lite-<ver>.html`, pushed per
> milestone, and promoted into `index.html` (the root) on milestones.

Single-file HTML web app (vanilla JS + Web Audio + Firestore sync). The deployed
full-app build is `full.html`, currently byte-identical to `1.314.html` (= `1.313.html` —
the 1.310 desktop/mobile batch + rich-text lyrics + white desktop lyrics-split pane —
**plus a floating guitar/uke/bass fretboard overlay** under the keys in the floating
keyboard panel: click any chord pill and it shows an accurate, sticky voicing.
⚠️ That build also made the chord highlight **sticky** — `seqPillRelease` no longer
clears, so the keyboard glow (and fretboard) persist until the next chord *everywhere
chord pills are used*; the fretboard engine lives in the `fb*` block right after the
`/* @lock:end — Chord Resolution */` anchor and rides `fkbInit`'s desktop-only 768px
bail). `1.313.html`/`1.312.html`/`1.310.html` are prior snapshots and `1.307.html` an
older stable one. **Heads-up:** `full.html` is NOT always
the highest-numbered file (e.g. 1.310 was pushed but never promoted) — before
branching a new build, `md5` `full.html` against the `1.3xx.html` files to find the true
base, and diff every fresh `cp` snapshot against its source to confirm it copied
what you meant. Versioning is by
**copying the whole file** to a new numbered name, not branching; work lands
directly on `main` (pushing `main` deploys via GitHub Pages — full app at
`drafthaus.ca/full.html`, Lite/root `index.html` at `drafthaus.ca`). The file is ~76k lines — **re-locate code by
searching quoted strings / function names, not line numbers** (they drift).

There is no test runner; verify changes by driving the app in a real browser
(see "Verifying changes" below).

## Global sequence strip architecture

One proportional strip — the canonical row of song sections — rendered into a
single element and reused in every view. It replaced the old pill-tab strip and
Arrange's separate sections row (the "global sequence strip unification").

**Element & renderer**
- `#globalSeqStrip` (`.global-seq-strip`) — one element, lives at top level just
  after `<header>` (before `#seqStripToggleBtn`).
- `seqStripRender(mode, ppbArg)` paints `.seq-strip-bar` bars + an inline
  playhead into it. Bars come from `getSongSequences(song)` (each carries
  `partId` + `bars`); labels/colours via `seqGetPartLabel`/`seqGetPartColor`.
  - **`'fit'`** (everywhere except Arrange): each bar `flex: bars bars auto;
    min-width: MIN_W(64px)` — proportional to bar-count, floored so it stays
    tappable; overflow scrolls.
  - **`'grid'`** (Arrange only): each bar `width: bars × ARR_PPB px`, pixel-locked
    to the lanes/ruler. `ppb = ppbArg || window._arrPPB() || 40`; `_arrPPB()` is a
    getter exposing Arrange's module-scoped `ARR_PPB` (the zoom level) across the
    `<script>` boundary.
- `seqRenderSequenceTabs()` is a thin **delegate** → `seqStripRender(arrIsOpen()
  ? 'grid' : 'fit')`; keep it (many callers re-render through it).

**Interaction** (all `window.`-scoped, wired as inline handlers on each bar)
- `seqStripSelect(i, ev)` — **tap**: `seqTabClick(i)` (canonical select; loads the
  section into the current tool) + re-render Arrange. Active highlight is driven
  by `seqActiveIdx` → `.seq-strip-bar-active` (not a separate selection flag).
- `seqStripSolo(i)` — **double-tap**: select, then scope playback to that section
  via `window._arrSetSelectedSec(i)` → `arrStripPlayToggle()` → reset to `-1`
  (one-shot, so the spacebar/▶ transport reverts to play-all). Off-Arrange it
  falls back to `sharedPlaySong()`.
- `seqStripDragStart/Over/Drop/End` — **drag-reorder** via `moveSectionInOrder`
  (carries `seqLinks4t`/`arrComp` with the section).

**Buttons & playhead**
- `#seqStripPlayBtn` (▶, `seqStripPlayToggle()`) now plays **from the selected
  section onward** (`sharedPlaySong({fromSelected:true})` → `seqPlaySong` slices
  the play list at `seqActiveIdx`), on **both mobile and desktop** — the one
  sanctioned global behavior change for the mobile notation drawer. Hidden in
  `'grid'` mode so bars start at x=0 and align with the ruler.
- `.seq-strip-mgr-btn` (≡, `seqOpenManagerModal()`) — section CRUD (add / rename /
  delete). This is the only "add a section" entry point (the old inline `+` is gone).
- `#seqStripPlayhead` is positioned by the `_seqStripUpdatePlayhead()` RAF:
  proportional across bars in fit mode, `bar × ppb` in grid mode.

**Placement & visibility**
- Sticky directly under the site header: `position: sticky; top: <header>;
  z-index: 975` (above tool drawers ~940–970, below the site header 9950).
- Hidden only on: the song list (`body.songlist-active` / `body:not(.song-loaded)`),
  perf mode (`body.il-perf-active`), UCB triangle state 4 (`body.ucb-state-4`),
  and the manual collapse toggle (`body.seq-strip-collapsed`, the ▲ button).
- Fixed tool drawers clear the strip via the `--dh-strip-h` token (currently
  **33px** = the strip's real height); each drawer adds it to its `top` and
  subtracts it from its `height`.

**Arrange integration (grid mode)**
- Arrange is **desktop-only** — when `innerWidth < 900` the whole Arrange module is
  stubbed (`arrOpen`/`arrClose`/etc. become no-ops and `ARR_PPB` never loads).
- `arrOpen()` → `arrRenderAll()` calls `_arrMountStrip()`, which moves
  `#globalSeqStrip` into `#arrTimelineInner` as its first child (where the retired
  `#arrSectionsRow` used to sit) and renders `'grid'`. Because the strip then lives
  **inside the timeline's scroll container**, it scrolls horizontally with the lanes
  with zero drift and pins (sticky `top:0`) on vertical scroll — no JS scroll-sync.
- `arrClose()` → `_arrUnmountStrip()` returns it to its home spot (before
  `#seqStripToggleBtn`) and renders `'fit'`.
- `_arrSelectedSecIdx` (module-scoped in the Arrange IIFE) is the playback-scope
  index read by `arrStripPlayToggle` (the Arrange transport — also bound to the ▶
  `arrPlayToggle` and spacebar). Nothing reads it for rendering. Cross-module writes
  **must** go through `window._arrSetSelectedSec(i)`; a direct `window._arrSelectedSecIdx = i`
  is a no-op (different scope) — that was the cause of the old "solo plays the whole
  song" bug.

## Verifying changes

No test runner — drive the app in a real browser. Use `playwright-core` against the
already-installed Chrome (`/Applications/Google Chrome.app/Contents/MacOS/Google
Chrome`, no browser download). To reach a usable state past the onboarding walls:
`addInitScript` to set `localStorage['drafthaus-eula-accepted']='1'` before load,
`signInAsGuest()` after boot, then `_createAndLoadSong(title)` →
remove `#pickFighterOverlay` → `openSong(_songCurrentId)`. Open tools via
`openSeqDrawer`/`openKeyboardDrawer`/`openLooperDrawer`/`navToolTap('4track')`, and
`arrOpen()` for Arrange. Firestore `permission-denied` console errors in guest mode
are expected noise.
