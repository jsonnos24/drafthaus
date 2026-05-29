# Arrange DAW — Punch/Linear Recording + Section-Loop Toggle (Phase 2a) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Give Arrange two recording modes — **default punch/linear** (roll from the playhead, capture until Stop → a free audio region placed where you recorded) and **opt-in section-loop** (click a section header first → loop-record just that section, as today). Make `arrFreeRegions` real: store the take, render the region, and play it back at its absolute timeline position.

**Architecture:** Build on the existing-but-inert `song.arrFreeRegions = [{trackId, startBar, bars, meta}]` (`_arrGetFreeRegions`/`_arrSaveFreeRegion` ≈ line 75095). A new state flag `window._arrRecLoopSectionId` decides the mode: set when the user clicks a section header (loop that section — reuses the Phase-1 attribution path), null otherwise (linear from playhead). Linear record plays the song from the playhead beat in `'song'` mode (no loop) and, on Stop, writes a free region with `meta.takeId`. `_arrRenderLanes` gains a free-region pass; a new `_arrScheduleFreeRegions()` schedules each free region's take buffer via `AudioBufferSourceNode.start(when, offset)` when the transport starts.

**Tech stack:** Single-file vanilla JS (`1.293opus.html`), Web Audio, `TL` timeline (`TL.getCurrentBeat`, `TL.play(beatOffset)`), seq scheduler (`seqPlay`/`sharedPlaySong`, `_seqPlayMode`). No test runner — verify in-browser via DevTools + the live site.

**Conventions:** All edits in `1.293opus.html`. Re-locate anchors by searching the quoted strings (line numbers drift). Commit after each task. Verify in the browser (no headless harness).

---

## File map

| File | Change |
|---|---|
| `1.293opus.html` | All changes: record-mode state + section/ruler click handlers, `_urStartRecording` mode branch, `_mtFinishRecording` free-region creation, `_arrRenderLanes` free-region render, new `_arrScheduleFreeRegions` playback |

---

## Task 1: Record-mode toggle — section-loop vs playhead

**Files:** Modify `1.293opus.html` (arr closure: new state; `_arrRenderSections` section-header click; the Arrange ruler/lane click that seeks the playhead).

- [ ] **Step 1 — read the relevant handlers.** Search and read: `function _arrRenderSections` (how `.arr-section` headers render + their existing onclick — currently "click section to solo-play"), and the Arrange ruler/timeline click that sets the playhead (search `arrBarRuler`, `_prPendingSeekStep`, or `addEventListener('click'` within the arr timeline). Identify the section's `seq.id` available at click time and the element for highlight.

- [ ] **Step 2 — add mode state.** Near the top of the arr closure (search the `var ARR_TRACKS = [` block region, or just below it), add:
```javascript
  // Phase-2a: which section is the record loop target. null = punch/linear record from playhead.
  window._arrRecLoopSectionId = null;
```

- [ ] **Step 3 — section header click sets the loop target (toggle).** In the section-header click handler, set the loop target and highlight it (toggle off if clicking the same one):
```javascript
    // Phase-2a: clicking a section header arms section-loop recording for it.
    window._arrRecLoopSectionId = (window._arrRecLoopSectionId === sec.seq.id) ? null : (sec.seq && sec.seq.id ? sec.seq.id : null);
    document.querySelectorAll('.arr-section').forEach(function(el){ el.classList.remove('arr-loop-armed'); });
    if (window._arrRecLoopSectionId) this.classList.add('arr-loop-armed');
```
(Use the actual section element + `sec` variable names from Step 1. Preserve any existing solo-play behavior the team wants to keep, or move it to a modifier — confirm intent in Step 1; if unclear, keep solo-play and add the loop-arm as an additional effect.)

- [ ] **Step 4 — ruler/lane click clears the loop target.** In the playhead-seek handler (ruler/lane click), add at the top:
```javascript
    // Phase-2a: placing the playhead chooses punch/linear record (clears section-loop arm).
    window._arrRecLoopSectionId = null;
    document.querySelectorAll('.arr-section').forEach(function(el){ el.classList.remove('arr-loop-armed'); });
```

- [ ] **Step 5 — add the highlight CSS.** After the `.arr-section {` rule, add:
```css
.arr-section.arr-loop-armed { outline: 2px solid var(--dh-color-rec); outline-offset: -2px; box-shadow: inset 0 0 0 9999px rgba(239,68,68,0.10); }
```

- [ ] **Step 6 — verify (browser).** Open Arrange. Click a section header → it highlights red; `window._arrRecLoopSectionId` is that section's id (check console). Click the ruler → highlight clears, `_arrRecLoopSectionId === null`. Commit:
```bash
git add 1.293opus.html && git commit -m "feat(daw): record-mode toggle — section-loop arm vs playhead"
```

---

## Task 2: Linear (song-mode) record transport from the playhead

**Files:** Modify `1.293opus.html` (`_urStartRecording` ≈ line 33189; capture block added in Phase 1).

- [ ] **Step 1 — read the record start + song player.** Re-read `_urStartRecording` (the `_urSavedStartStep`/`seqPlay()` region ≈ 33255–33290) and `sharedPlaySong` (search `async function sharedPlaySong`) — note how song mode sets `_seqPlayMode='song'` and how `TL.play(beatOffset)` / start section is chosen. Determine how to start song-mode playback at the playhead beat without looping.

- [ ] **Step 2 — capture mode + playhead at record start.** In `_urStartRecording`, in the Phase-1 capture block (search `attribute this recording to the ACTIVE`), add the mode + playhead snapshot:
```javascript
    // Phase-2a: record mode. Section-loop if a section header is armed; else punch/linear from playhead.
    window._arrRecFreeMode = !window._arrRecLoopSectionId;
    window._arrRecStartBar = 0;
    if (window._arrRecFreeMode && typeof TL !== 'undefined' && TL.getCurrentBeat) {
      var _ts = (parseInt(song?.sequencer?.time || 4, 10) || 4);
      window._arrRecStartBar = Math.max(0, Math.floor(TL.getCurrentBeat() / _ts));
    }
    // In section-loop mode, attribute to the armed section (overrides the active-section default above).
    if (window._arrRecLoopSectionId) window._arrRecSectionId = window._arrRecLoopSectionId;
```

- [ ] **Step 3 — branch the transport.** Where `_urStartRecording` starts playback (the `_seqPlayFilter = 'all'; seqPlay();` region from Step 1), branch so linear mode plays the whole song from the playhead instead of looping:
```javascript
    _seqPlayFilter = 'all';
    if (window._arrRecFreeMode && typeof sharedPlaySong === 'function') {
      // Punch/linear: play the arrangement through from the playhead, no section loop.
      sharedPlaySong();
    } else {
      seqPlay(); // section-loop record (existing behavior)
    }
```
(If `sharedPlaySong` always starts at section 0, add a start-beat argument or seek `TL.seek(beat)` + set the starting `_seqSongSectionIdx` to the section containing `_arrRecStartBar` before calling it — implement per what Step 1 reveals. Keep the 2-bar count-in intact.)

- [ ] **Step 4 — verify (browser).** With NO section armed, place the playhead mid-arrangement, record → playback rolls forward through sections (does not loop a single section) and keeps recording until you press Stop. With a section armed, recording still loops that section. Commit:
```bash
git add 1.293opus.html && git commit -m "feat(daw): linear record transport from playhead (song mode, no loop)"
```

---

## Task 3: On Stop, create a free region with the take (linear mode)

**Files:** Modify `1.293opus.html` (`_arrSaveFreeRegion` ≈ 75101; `_mtFinishRecording` local auto-link block ≈ 60246).

- [ ] **Step 1 — let free regions store a take id.** `_arrSaveFreeRegion(song, trackId, startBar, bars, meta)` already accepts `meta`. Confirm it stores `meta` (it does: `{...meta:{}}`). No change needed if callers pass `{ takeId }`.

- [ ] **Step 2 — create the free region on finalize (linear mode only).** In `_mtFinishRecording`, inside the Phase-1 attribution `try` block (search `attribute this take to the active section`), add a linear-mode branch that creates a free region instead of a section link:
```javascript
        if (window._arrRecFreeMode) {
          // Punch/linear: place a free region at the record-start bar, length = recorded bars.
          var _song = (typeof getCurrentSong === 'function') ? getCurrentSong() : null;
          var _newTakeF = t.takes[t.takes.length - 1];
          if (_song && _newTakeF && _newTakeF.id && typeof _arrSaveFreeRegion === 'function') {
            var _bpm = parseFloat(_song.bpm || 120) || 120;
            var _tsig = parseInt(_song?.sequencer?.time || 4, 10) || 4;
            var _secPerBar = (60 / _bpm) * _tsig;
            var _bars = Math.max(1, Math.round((durSec || _newTakeF.duration || _secPerBar) / _secPerBar));
            _arrSaveFreeRegion(_song, 'ft' + trackIdx, (window._arrRecStartBar || 0), _bars, { takeId: _newTakeF.id });
          }
        } else if (window._arrRecSectionId) {
          // ... existing section-loop link + arrCompSetTake block stays here ...
        }
```
Wrap the EXISTING link+arrComp code (the `if (window._arrRecSectionId) { ... }` body) as the `else if` branch above — do not duplicate it. (For signed-in users, the cloud re-link block updates `arrComp` for the section-loop case; for the free-region case, the local placeholder take id is replaced on `vrLoadTakes()` — in the cloud block, if `window._arrRecFreeMode`, update the matching free region's `meta.takeId` to `newTake.id` instead of calling `arrCompSetTake`. Implement symmetrically in the cloud block.)

- [ ] **Step 3 — verify (browser + console).** Linear-record a few seconds at bar N → `getCurrentSong().arrFreeRegions` has `{ trackId:'ft0', startBar:N, bars:…, meta:{ takeId:… } }`. Commit:
```bash
git add 1.293opus.html && git commit -m "feat(daw): linear recording creates a free region with the take"
```

---

## Task 4: Render free regions on the Arrange timeline

**Files:** Modify `1.293opus.html` (`_arrRenderLanes` ≈ 74292, the 4track branch end).

- [ ] **Step 1 — render free regions per track.** In `_arrRenderLanes`, after the `if (t.group === '4track') { ... }` block emits its linked/fallback regions, append free regions for this track:
```javascript
        // Phase-2a: render free (punch/linear) regions for this track at absolute bar positions.
        if (typeof _arrGetFreeRegions === 'function') {
          _arrGetFreeRegions(song).forEach(function(fr) {
            if (fr.trackId !== t.id) return;
            var fx = fr.startBar * ARR_PPB;
            var fw = Math.max(1, fr.bars) * ARR_PPB - 2;
            var tkId = fr.meta && fr.meta.takeId ? fr.meta.takeId : '';
            html += '<div class="arr-region arr-region-free" data-arr-region="' + t.id + '"'
                  + ' data-arr-free-take="' + tkId + '"'
                  + ' style="left:' + fx + 'px;width:' + fw + 'px;background:' + _arrHexToRgba(t.color, 0.18) + ';color:' + t.color + '" draggable="true" ondragstart="arrRegionDragStart(event,this)">'
                  + '<div class="arr-handle arr-handle-l"></div>'
                  + '<svg class="arr-region-wave" viewBox="0 0 200 14"><path d="M0,7 L200,7" stroke="' + t.color + '" stroke-width="1.2" fill="none"/></svg>'
                  + '<div class="arr-handle arr-handle-r"></div>'
                  + '</div>';
          });
        }
```
(Confirm `_arrHexToRgba` exists — it's used by `_arrMakeAudioRegion`.)

- [ ] **Step 2 — verify (browser).** The free region from Task 3 appears at its bar position on the track lane (distinct from section-linked regions). Commit:
```bash
git add 1.293opus.html && git commit -m "feat(daw): render free regions on the Arrange timeline"
```

---

## Task 5: Play back free regions at their absolute timeline position  ← highest-risk

**Files:** Modify `1.293opus.html` (new `_arrScheduleFreeRegions`; call it from `_arrPlay` ≈ 74663).

- [ ] **Step 1 — read an existing one-shot audio schedule + the seq clock.** Read how `_mtSeqPlayTrack` builds a source (`createBufferSource` → `t.buffer` → connect → `start`) and how the seq scheduler exposes the play clock (`getSeqAudioCtx()`, `_seqNextNoteTime`/`_seqLoopBaseTime`, `TL.getBpm`, `TL.getCurrentBeat`). Identify the per-track gain/output node a free region should connect through (mirror `_mtSeqPlayTrack`).

- [ ] **Step 2 — add the scheduler.** Add near `_arrPlay`:
```javascript
  // Phase-2a: schedule free-region take buffers to fire at their absolute timeline positions.
  function _arrScheduleFreeRegions() {
    var song = (typeof getCurrentSong === 'function') ? getCurrentSong() : null;
    if (!song || typeof _arrGetFreeRegions !== 'function') return;
    var ctx = (typeof getSeqAudioCtx === 'function') ? getSeqAudioCtx() : (typeof _mtAudioCtx !== 'undefined' ? _mtAudioCtx : null);
    if (!ctx) return;
    var bpm = (typeof TL !== 'undefined' && TL.getBpm) ? (TL.getBpm() || 120) : 120;
    var tsig = parseInt(song?.sequencer?.time || 4, 10) || 4;
    var secPerBar = (60 / bpm) * tsig;
    var curBeat = (typeof TL !== 'undefined' && TL.getCurrentBeat) ? TL.getCurrentBeat() : 0;
    var curBar = curBeat / tsig;
    var t0 = ctx.currentTime + 0.05;
    _arrGetFreeRegions(song).forEach(function(fr) {
      var ftIdx = parseInt(String(fr.trackId).replace('ft',''), 10);
      var tr = (typeof _mtTracks !== 'undefined') ? _mtTracks[ftIdx] : null;
      if (!tr || (_arrTrackState[fr.trackId] && _arrTrackState[fr.trackId].mute)) return;
      var takeId = fr.meta && fr.meta.takeId;
      var take = takeId && tr.takes ? tr.takes.find(function(tk){ return tk && tk.id === takeId; }) : null;
      var buf = (take && (take._localBuffer || take._buffer)) || tr.buffer;
      if (!buf) { if (take && typeof _mtLoadTakeBuffer === 'function') _mtLoadTakeBuffer(ftIdx, take); return; }
      var startSec = (fr.startBar - curBar) * secPerBar;       // where this region begins relative to now
      var when = t0 + Math.max(0, startSec);
      var offset = startSec < 0 ? -startSec : 0;               // playhead already past region start
      if (offset >= buf.duration) return;
      try {
        var src = ctx.createBufferSource(); src.buffer = buf;
        var g = ctx.createGain();
        var vol = (_arrTrackState[fr.trackId] && typeof _arrTrackState[fr.trackId].vol === 'number') ? _arrTrackState[fr.trackId].vol/100 : 0.85;
        g.gain.value = vol;
        src.connect(g); g.connect(ctx.destination);           // mirror _mtSeqPlayTrack's output node if it differs (Step 1)
        src.start(when, offset);
      } catch(e) { console.warn('[ARR] free-region schedule error:', e); }
    });
  }
```
(Replace `ctx.destination` with the same output/gain node `_mtSeqPlayTrack` uses, per Step 1, so track volume/mute/master apply.)

- [ ] **Step 3 — call it when the Arrange transport starts.** In `_arrPlay` (after `sharedPlaySong()` is invoked), add:
```javascript
    try { _arrScheduleFreeRegions(); } catch(e) { console.warn('[ARR] free-region schedule failed:', e); }
```

- [ ] **Step 4 — verify (browser).** Linear-record a clip at bar N. Rewind, press Play in Arrange → the recorded audio sounds at bar N (and is silent before it). Test a region the playhead starts *after* (offset path). Confirm mute/volume affect it. Commit:
```bash
git add 1.293opus.html && git commit -m "feat(daw): schedule free-region playback at absolute timeline position"
```

---

## Acceptance (run all, browser)
- [ ] No section armed → record rolls linearly from the playhead, captures until Stop, and leaves a free region at that position.
- [ ] Section header armed (red) → record loops that section and attaches the take to it (Phase-1 behavior).
- [ ] Free regions render at their bar position and play their audio at the right time on Arrange playback.
- [ ] Existing section-linked takes, sequencer/drum playback, and the 4-Track drawer still work.

## Risks
- **Task 5 (scheduling)** is the real engineering — getting `start(when, offset)` and the output node right. If song-mode tempo/seek differs from the simple `secPerBar` model, derive timing from the same clock `_mtSeqPlayTrack` uses.
- **Task 2 transport:** starting song mode at an arbitrary playhead beat may need a seek + starting-section index; if `sharedPlaySong` can't start mid-arrangement cleanly, fall back to starting at the section containing the playhead.
- **Free-region editing** (trim/move/delete, multiple regions per track) is intentionally out of scope here — this plan only records, renders, and plays them. Drag-reposition already half-exists (`_arrStartFreeDrag`); polishing it is a follow-up.

## Deferred (not this plan)
- Swipe comping (the original Phase-2 multi-slice work), region trim/crossfade UI, free-region delete/dedup, mobile.
