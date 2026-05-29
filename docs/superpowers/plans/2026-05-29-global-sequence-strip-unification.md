# Global Sequence Strip Unification — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement task-by-task with review between tasks. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Replace the pill-based global strip with the Arrange proportional sections-row, promoted to a single always-visible strip in a fixed band below the header in every view, with the UCB moved to a bottom-center island.

**Architecture:** One renderer `seqStripRender(mode)` paints proportional section bars + a playhead into the existing `#globalSeqStrip` element. `mode='fit'` (proportional-to-container + min-width + scroll) everywhere except Arrange; `mode='grid'` (`bars×ARR_PPB`, scroll-synced to lanes) in Arrange, where it replaces `#arrSectionsRow` and the lanes render below it. Tap=select, double-tap=solo, drag=reorder; CRUD via the Sequence Manager (`seqOpenManagerModal()`). The mobile triangle (`ucbToggleCycle`) keeps the strip through state 3, hides it only at state 4.

**Tech stack:** Single-file vanilla JS (`1.293opus.html`), Web Audio, `TL` timeline, Firestore sync. No test runner — verify in-browser (DevTools + the live `drafthaus.ca/1.293opus.html`). Commit after each task; we work directly on `main` (user convention).

**Sequencing note:** Tasks are ordered so the app stays usable after each. The strip becomes proportional *in place* (Task 1–3), then moves under the header (Task 4), then the UCB drops (Task 5), then Arrange folds onto the shared strip last (Task 6), then dead code is removed (Task 7). Spec: `docs/superpowers/specs/2026-05-29-global-sequence-strip-unification-design.md`.

**Conventions:** Re-locate anchors by searching quoted strings (line numbers drift). "Verify" = browser/DevTools. Each task is a commit.

---

## Task 1: `seqStripRender('fit')` — proportional bars replace pills

**Files:** Modify `1.293opus.html` — new `seqStripRender`; make `seqRenderSequenceTabs` delegate to it; add strip-bar CSS.

- [ ] **Step 1 — read the two current renderers.** Read `seqRenderSequenceTabs` (≈25853, fills `#globalSeqStrip` with `.seq-tab` pills, a play btn `seqStripPlayToggle`, a manager btn `seqOpenManagerModal`, dup `seqDuplicateActive`, add `seqAddNewSequence`) and `_arrRenderSections` (≈74218, proportional `.arr-section` bars). Note the trailing controls in the pill strip you must preserve (play, manager, add).

- [ ] **Step 2 — add `seqStripRender`.** Insert immediately above `function seqRenderSequenceTabs() {`:

```javascript
// Unified proportional sequence strip. mode: 'fit' (proportional-to-container + min-width + scroll)
// or 'grid' (bars×ARR_PPB, used inside Arrange and scroll-synced to the lanes).
function seqStripRender(mode) {
  mode = mode || 'fit';
  var strip = document.getElementById('globalSeqStrip');
  if (!strip) return;
  var song = getCurrentSong();
  if (!song) { strip.innerHTML = ''; return; }
  var seqs = getSongSequences(song);
  var ppb = (typeof ARR_PPB !== 'undefined') ? ARR_PPB : 16;
  var MIN_W = 64; // min tap width per section in fit mode
  var nowIdx = (typeof _seqPlayMode !== 'undefined' && _seqPlayMode === 'song' && seqIsPlaying
                && _seqSongSectionIdx < _seqSongSections.length) ? _seqSongSections[_seqSongSectionIdx]._seqIdx : -1;

  var bars = seqs.map(function(seq, i) {
    var pid = seq.partId || seq.part;
    var label = seqGetPartLabel(pid);
    var color = seqGetPartColor(pid);
    var secBars = parseInt(seq.bars || 4, 10) || 4;
    // grid (Arrange): exact pixel width per bar. fit (elsewhere): flex-grow by bar-count, floored at MIN_W.
    var widthStyle = (mode === 'grid')
      ? ('width:' + (secBars * ppb) + 'px;')
      : ('flex:' + secBars + ' ' + secBars + ' auto;min-width:' + MIN_W + 'px;');
    var active = (i === seqActiveIdx) ? ' seq-strip-bar-active' : '';
    var playing = (i === nowIdx) ? ' seq-strip-bar-playing' : '';
    return '<div class="seq-strip-bar' + active + playing + '" style="' + widthStyle + 'background:' + _seqStripBarBg(color) + ';color:' + color + '"'
      + ' data-seq-bar="' + i + '" draggable="true"'
      + ' onclick="seqStripSelect(' + i + ',event)"'
      + ' ondblclick="seqStripSolo(' + i + ')"'
      + ' ondragstart="seqStripDragStart(event,' + i + ')"'
      + ' ondragover="seqStripDragOver(event,' + i + ')"'
      + ' ondrop="seqStripDrop(event,' + i + ')"'
      + ' ondragend="seqStripDragEnd(event)">'
      + '<span class="seq-strip-bar-label">' + label + '</span></div>';
  }).join('');

  strip.setAttribute('data-strip-mode', mode);
  strip.innerHTML =
    '<button class="seq-strip-play-btn" id="seqStripPlayBtn" onclick="seqStripPlayToggle()" title="Play everything">▶</button>'
    + '<div class="seq-strip-bars" id="seqStripBars">' + bars
    + '<div class="seq-strip-playhead" id="seqStripPlayhead" style="left:0"></div></div>'
    + '<button class="seq-strip-mgr-btn" onclick="seqOpenManagerModal()" title="Sequence Manager (add / rename / delete)">≡</button>';
  if (typeof _seqStripSyncPlayBtn === 'function') _seqStripSyncPlayBtn();
}
// Background tint for a bar from its section color (handles #hex or rgb()).
function _seqStripBarBg(color) {
  if (!color) return 'rgba(255,255,255,0.06)';
  if (color.charAt(0) === '#') {
    var r = parseInt(color.substr(1,2),16), g = parseInt(color.substr(3,2),16), b = parseInt(color.substr(5,2),16);
    return 'rgba(' + r + ',' + g + ',' + b + ',0.16)';
  }
  return color.replace(')', ',0.16)').replace('rgb', 'rgba');
}
window.seqStripRender = seqStripRender;
```

- [ ] **Step 3 — make the existing renderer delegate.** Replace the body of `seqRenderSequenceTabs()` (everything after `function seqRenderSequenceTabs() {` up to its closing `}` near line 25912's block end — read it first to find the exact end) with a thin delegate so all existing callers keep working:

```javascript
function seqRenderSequenceTabs() {
  var inArrange = (typeof arrIsOpen === 'function' && arrIsOpen());
  seqStripRender(inArrange ? 'grid' : 'fit');
  if (typeof _ucSyncArrows === 'function') _ucSyncArrows();
  if (typeof _seqUpdateBarRange === 'function') _seqUpdateBarRange();
  if (typeof _drUpdatePartLabel === 'function') _drUpdatePartLabel();
}
```
(Preserve any other side-effect calls the original made — list them from Step 1 and keep the ones still relevant; drop pill-only ones like `_ucbSyncDropdownBorderColor` only if they error. When unsure, keep the call guarded by `typeof`.)

- [ ] **Step 4 — add strip-bar CSS.** After the `.global-seq-strip {` rule (search it), add:

```css
.global-seq-strip { display: flex; align-items: stretch; gap: 0; }
.seq-strip-bars { display: flex; flex: 1 1 auto; align-items: stretch; position: relative; overflow-x: auto; overflow-y: hidden; min-height: 22px; }
.seq-strip-bars::-webkit-scrollbar { display: none; }
.seq-strip-bar {
  position: relative; display: flex; align-items: center; box-sizing: border-box;
  border-right: 1px solid var(--dh-color-border, #2a3242); cursor: pointer;
  font: 600 var(--dh-font-xs,10px)/1 ui-monospace, monospace; padding: 0 6px; overflow: hidden; white-space: nowrap;
}
.seq-strip-bar-label { pointer-events: none; }
.seq-strip-bar-active { outline: 2px solid currentColor; outline-offset: -2px; filter: brightness(1.25); }
.seq-strip-bar-playing { box-shadow: inset 0 -2px 0 0 currentColor; }
.seq-strip-playhead { position: absolute; top: 0; bottom: 0; width: 2px; background: var(--dh-color-rec,#ef4444); pointer-events: none; z-index: 3; }
.seq-strip-play-btn, .seq-strip-mgr-btn { flex: 0 0 auto; }
```

- [ ] **Step 5 — verify (browser).** Open a multi-section song in any tool (NOT Arrange). The strip shows **proportional bars** (wider sections = wider bars), an active highlight, a ▶ and a ≡ at the ends. (Handlers wired in Task 2; clicking may not fully work yet — that's next.) No console errors on load. Commit:
```bash
git add 1.293opus.html && git commit -m "feat(strip): proportional seqStripRender replaces pill render in #globalSeqStrip"
```

---

## Task 2: Unified select / solo / reorder handlers

**Files:** Modify `1.293opus.html` — add `seqStripSelect`/`seqStripSolo`/`seqStripDrag*`.

- [ ] **Step 1 — read the canonical behaviors.** Read `seqTabClick` (the pill select — search `function seqTabClick`) to see how selecting a sequence sets `seqActiveIdx` and loads it into the current tool; read `arrSecDblClick`/the section solo-play (search `function arrSecDblClick`); read `moveSectionInOrder` (≈21923) and `arrSecDrop` (≈74559) for reorder. Note the exact functions used.

- [ ] **Step 2 — add the unified handlers.** Insert below `window.seqStripRender = seqStripRender;`:

```javascript
// Tap a bar → select/activate that section everywhere (loads into current tool + Arrange selection).
window.seqStripSelect = function(i, ev) {
  if (ev) ev.stopPropagation();
  if (typeof seqTabClick === 'function') { seqTabClick(i, ev); }   // canonical: sets seqActiveIdx + loads tool
  else { seqActiveIdx = i; }
  if (typeof _arrSelectedSecIdx !== 'undefined') window._arrSelectedSecIdx = i;
  if (typeof arrIsOpen === 'function' && arrIsOpen() && typeof arrRenderAll === 'function') arrRenderAll();
};
// Double-tap → solo-play just this section.
window.seqStripSolo = function(i) {
  if (typeof seqSoloSection === 'function') return seqSoloSection(i);   // if a solo helper exists (confirm in Step 1)
  if (typeof arrSecDblClick === 'function') return arrSecDblClick(i);   // Arrange's audition path
};
// Drag → reorder. Reuse the existing section reorder so sectionOrder/sequences (and linked audio) move together.
var _seqStripDragFrom = -1;
window.seqStripDragStart = function(e, i) { _seqStripDragFrom = i; try { e.dataTransfer.effectAllowed = 'move'; } catch(_){} };
window.seqStripDragOver = function(e, i) { e.preventDefault(); };
window.seqStripDrop = function(e, i) {
  e.preventDefault();
  if (_seqStripDragFrom < 0 || _seqStripDragFrom === i) return;
  if (typeof moveSectionInOrder === 'function') moveSectionInOrder(_seqStripDragFrom, i);
  _seqStripDragFrom = -1;
  seqRenderSequenceTabs();
  if (typeof arrIsOpen === 'function' && arrIsOpen() && typeof arrRenderAll === 'function') arrRenderAll();
};
window.seqStripDragEnd = function(e) { _seqStripDragFrom = -1; };
```
(In Step 1 confirm whether a section-solo helper exists; if `arrSecDblClick` is Arrange-scoped and depends on Arrange being open, extract its core audition call into a shared `seqSoloSection(i)` and call that from both. If `moveSectionInOrder(from,to)` signature differs, adapt the call.)

- [ ] **Step 3 — verify (browser, non-Arrange).** Tap a bar → that section loads into the current tool and highlights. Double-tap → it auditions. Drag a bar onto another → order changes and persists (reload). Commit:
```bash
git add 1.293opus.html && git commit -m "feat(strip): unified select/solo/reorder handlers for the proportional strip"
```

---

## Task 3: Live playhead in the strip (all views)

**Files:** Modify `1.293opus.html` — a RAF that positions `#seqStripPlayhead`.

- [ ] **Step 1 — read the Arrange playhead tick.** Read `_arrTick` (≈74735) to see how it derives beat→x from `TL.getCurrentBeat()`, `TL.getBpm()`, `TL.getTimeSig()`, and `ARR_PPB`.

- [ ] **Step 2 — add a strip playhead updater.** Insert below the handlers from Task 2:

```javascript
// Position the strip playhead from the transport, in any view. fit: proportion across bars; grid: bar×ARR_PPB.
function _seqStripUpdatePlayhead() {
  var ph = document.getElementById('seqStripPlayhead');
  var barsEl = document.getElementById('seqStripBars');
  if (!ph || !barsEl || typeof TL === 'undefined') return;
  var playing = TL.isPlaying && TL.isPlaying();
  ph.style.display = playing ? 'block' : 'none';
  if (!playing) return;
  var beat = TL.getCurrentBeat ? TL.getCurrentBeat() : 0;
  var tsig = (TL.getTimeSig && TL.getTimeSig()) || 4;
  var barPos = beat / tsig;
  var mode = (document.getElementById('globalSeqStrip') || {}).getAttribute
           ? document.getElementById('globalSeqStrip').getAttribute('data-strip-mode') : 'fit';
  var x;
  if (mode === 'grid') {
    x = barPos * ((typeof ARR_PPB !== 'undefined') ? ARR_PPB : 16) - barsEl.scrollLeft;
  } else {
    var song = getCurrentSong(); var seqs = song ? getSongSequences(song) : [];
    var total = 0; seqs.forEach(function(s){ total += parseInt(s.bars||4,10)||4; });
    x = total > 0 ? (barPos / total) * barsEl.scrollWidth - barsEl.scrollLeft : 0;
  }
  ph.style.left = Math.max(0, x) + 'px';
}
var _seqStripPhRaf = null;
function _seqStripPhStart() { if (_seqStripPhRaf) return; (function loop(){ _seqStripUpdatePlayhead(); _seqStripPhRaf = requestAnimationFrame(loop); })(); }
window._seqStripPhStart = _seqStripPhStart;
```

- [ ] **Step 3 — start the RAF on load.** Find app init (search `function initApp` or the boot sequence end) and add `if (typeof _seqStripPhStart === 'function') _seqStripPhStart();` once after boot. (The loop self-guards via `TL.isPlaying()`, so it's cheap when idle — it only moves the playhead during playback.)

- [ ] **Step 4 — verify (browser).** Play the sequence (the ▶ on the strip) in a non-Arrange tool → a thin playhead sweeps across the bars and hides on stop. In Arrange, the strip playhead matches the lane playhead. Commit:
```bash
git add 1.293opus.html && git commit -m "feat(strip): live playhead across the strip in all views"
```

---

## Task 4: Pin strip under the header + visibility-coupling audit

**Files:** Modify `1.293opus.html` CSS + `_ucbApplyState`.

- [ ] **Step 1 — read the current strip placement + coupling rules.** Grep `global-seq-strip` in the CSS and list every rule that sets `display`, `position`, `top/bottom`, or `transform` on it, grouped by the body-class context: `split-active`, `split-tool-left`, `seq-drawer-open`, `il-perf-active`, `qc-state-1/2`, `ucb-state-2/3/4`, landscape. Also read `_ucbApplyState` (≈33496) where it hides the strip for states ≥3 on mobile.

- [ ] **Step 2 — pin the strip under the header.** Replace the base `.global-seq-strip` positioning rule so it's a fixed band directly under the site header (use the header's height var/value found in Step 1; if the header is `#siteHeader`, anchor `top` to its height). Add:
```css
.global-seq-strip {
  position: sticky; top: var(--dh-header-h, 0px); z-index: 50;
  width: 100%; box-sizing: border-box;
  background: var(--dh-color-surface-2, #0c0f16);
  border-bottom: 1px solid var(--dh-color-border, #2a3242);
}
body:not(.song-loaded) .global-seq-strip { display: none !important; }       /* song list: hide */
body.il-perf-active .global-seq-strip { display: none !important; }          /* perf mode: hide */
body.ucb-state-4 .global-seq-strip { display: none !important; }             /* deepest triangle state: hide */
```
(Use whatever "a song is loaded" body class exists — confirm in Step 1; the boot log shows `song-loaded`. Pick the real header element/height for `top`.)

- [ ] **Step 3 — remove the hide/reposition couplings.** Delete or neutralize the strip rules enumerated in Step 1 for `split-active`, `split-tool-left`, `seq-drawer-open`, `qc-state-1/2`, and `ucb-state-2/3` (the strip should stay put in all of these). **Keep only** the three deliberate hides added in Step 2 (song list, perf, state-4). Leave non-strip parts of those rules intact.

- [ ] **Step 4 — state 3 keeps the strip.** In `_ucbApplyState` (≈33496), the `s <= 2` branch clears `seq-strip-collapsed` and `s >= 3` clears inline styles to let CSS hide it. Change the threshold so the strip is only force-hidden at `s >= 4` (state 3 keeps it). Update the CSS in Step 2 accordingly (only `ucb-state-4` hides). Confirm the arrow/state visuals are unchanged.

- [ ] **Step 5 — verify (browser, desktop + mobile width).** The strip stays in the same spot under the header across: keyboard, drums, looper, sequencer, split view, with the seq drawer open. Song list → no strip. Perf mode → no strip. Mobile triangle: states 1–3 show the strip, state 4 hides it. No layout jumps when switching tools. Commit:
```bash
git add 1.293opus.html && git commit -m "feat(strip): pin strip under header; audit away context-hide couplings (keep song-list/perf/state-4)"
```

---

## Task 5: UCB → fixed bottom-center island

**Files:** Modify `1.293opus.html` CSS for `#ucBar`/`.uc-bar` + the `ucb-state` bottom rules.

- [ ] **Step 1 — read UCB placement.** Read `.uc-bar`/`#ucBar` CSS (≈8061, 67050) and the `ucb-state-3/4 .uc-bar { bottom: ... }` rules (≈8222–8223) and any bottom-nav height var.

- [ ] **Step 2 — bottom-center anchor.** Add/replace so the UCB is a fixed bottom-centered island (internals untouched):
```css
.uc-bar {
  position: fixed; left: 50%; transform: translateX(-50%);
  bottom: calc(env(safe-area-inset-bottom, 0px) + 8px);
  z-index: 60; width: max-content; max-width: 96vw;
}
@media (max-width: 899px) {
  /* sit above the bottom-nav on mobile so they never overlap */
  .uc-bar { bottom: calc(54px + env(safe-area-inset-bottom, 0px) + 4px); }
  body.ucb-state-4 .uc-bar { bottom: calc(env(safe-area-inset-bottom, 0px) + 4px); } /* nav hidden at state 4 */
}
```
(Use the real bottom-nav height from Step 1 in place of `54px` if different. Preserve the existing state-driven bottom shifts by keeping/adjusting those rules rather than deleting them.)

- [ ] **Step 3 — give content bottom clearance.** Ensure tool drawers/Arrange content aren't hidden behind the floating UCB: add bottom padding to the main content area equal to the UCB height + clearance (find the content container in Step 1; e.g. add `padding-bottom` under `body.song-loaded`).

- [ ] **Step 4 — verify (browser, desktop + mobile).** UCB floats centered at the bottom; its controls work unchanged; it doesn't cover the last row of tool content; on mobile it sits above the bottom-nav (no overlap) and drops to the bottom edge at triangle state 4. Commit:
```bash
git add 1.293opus.html && git commit -m "feat(ucb): reposition UCB to a fixed bottom-center island (internals unchanged)"
```

---

## Task 6: Fold Arrange onto the shared strip (grid mode + scroll-sync)

**Files:** Modify `1.293opus.html` — Arrange render path + scroll-sync; retire `#arrSectionsRow`.

- [ ] **Step 1 — read the Arrange render + scroll + layout.** Read `arrRenderAll` (≈73855), `_arrRenderSections` (≈74218), `_arrSyncScroll` (≈75064), the Arrange markup around `#arrSectionsRow`/`#arrBarRuler`/`#arrLanes`/`#arrTimelineWrap` (≈66033–66089), and `arrOpen`/`arrClose` (where `arr-view-open` is toggled, ≈74017/74038). Determine where the shared `#globalSeqStrip` sits relative to `#arrDrawer` (the Arrange overlay) and how to make the strip appear at Arrange's top with lanes below it.

- [ ] **Step 2 — render the shared strip in grid mode for Arrange.** In `arrRenderAll`, replace the `_arrRenderSections(sections)` call with `seqStripRender('grid')`. Ensure the strip element is positioned at the top of the Arrange view (either move `#globalSeqStrip` into the Arrange layout while open, or position the Arrange lanes/ruler to start below the persistent strip — pick per Step 1). Remove the now-unused `#arrSectionsRow` container from the Arrange markup and delete `_arrRenderSections`.

- [ ] **Step 3 — scroll-sync strip ↔ lanes.** In `_arrSyncScroll`, drive `#seqStripBars` scrollLeft from the timeline scroll (and vice-versa) so the grid-mode bars stay pixel-locked above the lanes. Confirm the playhead (`_seqStripUpdatePlayhead` grid branch already subtracts `barsEl.scrollLeft`) stays aligned.

- [ ] **Step 4 — switch modes on open/close.** In `arrOpen`, after layout, call `seqStripRender('grid')`; in `arrClose`, call `seqStripRender('fit')`. Confirm `seqRenderSequenceTabs` (Task 1 delegate) already picks mode by `arrIsOpen()` for incidental re-renders.

- [ ] **Step 5 — verify (browser).** Open Arrange: the top strip looks/behaves exactly as before (proportional bars aligned to lanes, scroll-synced, drag-reorder, playhead). Switch to another tool: the same strip is now in `fit` mode under the header. Switching back and forth keeps the strip in place. Sections added in the Sequence Manager appear in both. Commit:
```bash
git add 1.293opus.html && git commit -m "feat(arrange): use shared strip (grid mode), retire #arrSectionsRow, scroll-sync lanes"
```

---

## Task 7: Cleanup — retire pill styles + dead code

**Files:** Modify `1.293opus.html`.

- [ ] **Step 1 — find dead pill code.** Grep for `.seq-tab` (pill styles), `seq-part-btn`, `seqTabDragStart/Over/Drop/End`, `seq-strip-hint`, `seq-now-playing-badge`, and any helper only used by the old pill render. Confirm (via grep) each is no longer referenced by live code before removing.

- [ ] **Step 2 — remove confirmed-dead CSS/JS.** Delete the pill-only `.seq-tab*`/`.seq-part-btn` style blocks and any pill-only handlers with zero remaining references. Leave anything still referenced (e.g. shared color helpers). Do NOT remove `seqRenderSequenceTabs` (it's now the delegate) or `#globalSeqStrip`.

- [ ] **Step 3 — verify (browser).** Full pass: load song → strip under header (fit); open Arrange → strip grid + lanes; play → playhead everywhere; reorder, select, solo, open Sequence Manager (add/rename/delete) → all work; song list/perf/state-4 hide the strip; UCB bottom-center. No console errors. Commit:
```bash
git add 1.293opus.html && git commit -m "chore(strip): remove dead pill-strip CSS/JS after unification"
```

---

## Acceptance (run all, browser, desktop + a mobile width)
- [ ] One proportional strip sits under the header in every tool, same position; Arrange shows the same strip at its top with lanes below, scroll-synced.
- [ ] Tap = select/load; double-tap = solo; drag = reorder (persists); ≡ opens the Sequence Manager for add/rename/delete.
- [ ] Live playhead sweeps the strip during playback in all views.
- [ ] UCB is a bottom-center island, controls unchanged, no overlap with content or the mobile bottom-nav.
- [ ] Strip hidden only on the song list, in perf mode, and at triangle state 4; visible in states 1–3.
- [ ] No regressions: sequencer/drum/keys/looper playback, Arrange recording/takes, save/sync.

## Risks
- **Task 4 audit** is the highest-risk step — a missed `.global-seq-strip` context rule makes the strip vanish/jump in some mode. Enumerate them all in Step 1 before editing.
- **Task 6 scroll-sync** — the grid-mode bars must stay pixel-locked to the lanes; verify no drift while scrolling/zooming Arrange.
- **UCB clearance** — confirm content isn't hidden behind the floating UCB on the smallest supported screen.
