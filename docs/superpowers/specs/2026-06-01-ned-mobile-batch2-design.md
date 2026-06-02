# ned mobile keyboard drawer — batch 2 design

**Date:** 2026-06-01
**Target build:** copy `index.html` (== `1.307.html`, the deployed build) → `1.308.html`; promote to `index.html` only after iPhone sign-off.
**Hard rule:** mobile only. All changes live inside the `ned` IIFE, the `@media (max-width:768px)` CSS block, or the `_defSeq` data default. Desktop render of existing content must stay byte-identical; verify the desktop render path is untouched before promoting.

This batch covers five bug fixes (1–5) and four design items (6–9) for the mobile standard-notation / Quick Chords drawer (`ned`).

---

## Bug fixes

### 1. Borrowed chords broken (`[object Object]`, dead tap)

**Root cause:** `getBorrowedChords(key, mode)` returns an array of *objects* `{ name, label, degree }`, but `_nedRenderQC()` (~line 46646–46649) interpolates the whole object: `data-chord="${b}"` and chip text `>${b}<`. The object stringifies to `[object Object]`, and `data-chord` is invalid, so `_chordToMidi` resolves nothing and the tap is a no-op.

**Fix:** In the borrowed-chip render, use the object's fields:
- `data-chord="${b.name}"` (valid chord name → `_chordToMidi` resolves).
- Chip text = `b.name` (the chord symbol), with `b.label` rendered as a small teal degree badge, mirroring the diatonic chips' Roman-numeral badge (`.ned-chip-deg` styling).

**Verify:** Borrowed chips show real chord names; tapping previews the chord; dragging drops it on the staff.

### 2. Key dropdown shows placeholder instead of current key

**Root cause:** `_nedFillQCDropdowns()` (~line 46611) clones `#seqKeySelect`'s `innerHTML` into `#nedQCKey`, but a `<select>`'s current selection lives in its `.value` property, which `innerHTML` does **not** carry. So `#nedQCKey` falls back to its first option.

**Fix:** After `keySel.innerHTML = src.innerHTML`, add `keySel.value = src.value;` so the QC key dropdown reflects the song's current key (e.g. "C major").

**Verify:** Open drawer on a song in a known key → QC key dropdown reads that key; changing it still transposes via the existing `_nedQCKeyChange` path.

### 3. Voice (instrument) labels drifted

**Root cause:** The QC `OPTS` array (~line 46623) relabels `synth` → "Drafthaus" ("Grand + Drafthaus", "Upright + Drafthaus"), but every other instrument `<select>` in the app labels `synth` as "Synth" ("Grand + Synth", "Upright + Synth"). The drawer is the outlier.

**Fix (match the rest of the app):** Change `OPTS` labels (values unchanged):
```
['synth','Synth'], ['piano','Grand Piano'], ['piano2','Upright Piano'],
['guitar','Guitar'], ['piano+synth','Grand + Synth'], ['piano2+synth','Upright + Synth']
```

**Verify:** QC voice dropdown labels match the desktop/other selects exactly; selecting an option still drives `_nedQCVoiceChange`.

### 4. New sections default to synth

**Root cause:** `_defSeq.instrument: 'synth'` (~line 20721) is the global default chord instrument for every new section. `melodyInstrument` is already `'piano2'`.

**Decision:** New songs/sections should default to **Upright Piano** for both chords and keys.

**Fix:**
- `_defSeq.instrument: 'synth' → 'piano2'` (chords default = Upright). `melodyInstrument` stays `'piano2'` (keys default = Upright).
- Mobile-only QC fallbacks `|| 'piano'` → `|| 'piano2'` inside the `ned` IIFE (cosmetic consistency for sections missing the field).

**Scope note:** This is a *data* default, not a render change — desktop render of existing songs stays byte-identical. New sections created on desktop will also default to Upright instead of Synth. This is an accepted, sanctioned global data-default change (the user's "new songs default to upright" intent). Stored instruments on existing songs are untouched.

**Verify:** Create a new song/section → chord + keys instruments both Upright; chord previews/drops play piano, not synth. Existing songs keep their saved instruments.

### 5. Hide the global mobile UCB bar while the keyboard drawer is open

**Root cause:** The lower on-screen UCB bar (`#ucBar` / `.uc-bar`, with the `body.ucb-state-*` cycle states) stays visible over the keyboard drawer, which is excessive there.

**Fix:** Add one rule inside the existing `@media (max-width:768px)` block:
```css
body.keyboard-drawer-open .uc-bar { display: none !important; }
```
The in-drawer transport row (`.ned-ucb`: Click·REC·Play·TAP·BPM) is a different element and is untouched. Rule is media-gated → desktop unaffected.

**Verify:** Open the keyboard drawer on mobile → global UCB bar gone; `.ned-ucb` transport row still present. Close drawer → UCB bar returns. Desktop unchanged.

---

## Design items

### 6. Quick Chords default resting position — computed from staff

**Goal:** The QC overlay should rest with its handle just below the **3rd treble staff line (3rd from the top)** instead of the current hardcoded `top:55%`.

**Geometry:** Staff SVG is a fixed 386px (`viewBox 0 0 W 386`, no scaling). Treble lines: `NED_TREBLE_TOP=44` + `i*NED_LINE_GAP*2` (gap 30) → y = 44, 74, **104**, 134, 164. Bass lines: `NED_BASS_TOP=254` + same → y = 254, 284, 314, 344, 374. The 3rd treble line is at **y=104**.

**Approach (computed, robust to staff height):**
- Add `_nedQCDefaultTop()`: target y = `104 + 8` (just below the 3rd line); return `clamp(25, 78, (targetY / staffRect.height) * 100)` as a percentage.
- Apply on drawer open and in `_nedRefresh`, **unless** the user has manually dragged the handle this session.
- Add a session flag `_nedQCUserMoved` set inside `_nedBindQCResize` on a real drag, so the computed default never fights manual placement. (Reset when the drawer remounts / song changes, consistent with `_nedRefresh`.)
- Replace the inline `style="top:55%"` reliance — the computed value is authoritative on open.

**Verify:** Open drawer → QC handle sits just under the 3rd treble line; drag it, reopen within session → respects manual position; new song/remount → recomputes.

### 7. Quick Chords handle — bigger hit target + reliable drag

**Goal:** The gold resize handle is finicky on mobile.

**Fix:**
- CSS (`.ned-qc-handle`): `min-height:30px`, padding `9px 10px 7px` (taller tap area). Grip bar `.ned-qc-grip-bar` → `width:52px; height:6px`. Add a transparent `::before` on the grip extending the tap zone ~12px in each direction (`position:absolute; inset:-12px;`) so near-misses still grab.
- JS (`_nedBindQCResize`): call `setPointerCapture(ev.pointerId)` on pointerdown so the drag keeps tracking even when the finger drifts off the 1px-tall handle. Start responding on first move (no dead zone). Keep the `clientY → %` mapping 1:1 (already direct) and the 25–78 clamp. Set `_nedQCUserMoved = true` on a real drag (see #6).

**Verify:** On iPhone, the handle grabs reliably from a sloppy tap and tracks smoothly without losing the drag.

### 8. First-open hint animation (style C: tap-a-note → drag-a-chord)

**Goal:** The first time the keyboard drawer opens for a given song, play a short, non-blocking hint demonstrating the two core gestures.

**Persistence:** Per-song `localStorage['drafthaus-ned-hint-<songId>']`. Plays once per song, ever; survives reloads.

**Behavior:**
- On the first drawer open for a song where the flag is unset, mount a hint overlay inside `#nedStaff` (absolutely positioned, `pointer-events:none` except for dismissal listener on the staff).
- Sequence (~2.3s total), pure CSS keyframes:
  1. **Tap a note (~1s):** a finger/dot indicator pulses at an empty treble staff position; a notehead blooms where it lands, then fades. Caption: "Tap the staff to place a note."
  2. **Drag a chord (~1.5s):** a translucent chord (3 ghost noteheads) lifts off the first diatonic chip, glides up onto the staff, and fades. Caption: "Drag a chord onto the staff."
- Any touch/tap anywhere dismisses immediately. On end (or dismiss), remove the overlay and set the flag so it never replays for that song.
- Must not block interaction: if the user taps to place a note during the hint, the hint dismisses and the tap proceeds.

**Verify:** New song, first drawer open → hint plays once; tapping mid-hint dismisses and works; reopen / reload → no replay; a different song → plays once for it.

### 9. Bass clef access — two-finger pan + visible tip

**Goal:** Let the user reach the bass clef (y=254–374), which is below the visible band and behind the QC overlay (more so after #6 moves QC up). Single-finger drag on the staff is note-placement, so panning must not use one finger.

**Mechanism:**
- Add module-scoped `_nedPanY = 0` (px; positive = staff content shifted up to reveal lower content).
- Apply `transform: translateY(-_nedPanY)` to the staff `.ned-svg` (set after each `nedRender`, re-applied so it persists across re-renders).
- Update the Y→pitch / hit-test mapping to account for pan: in `_nedYToMidi` and `_nedHitNote`, use local `y = clientY - r.top + _nedPanY`. (Ghost/note rendering already uses absolute SVG coords and moves with the transform, so only the inverse client→content mapping needs the offset.)
- **Two-finger pan:** add touch listeners on `#nedStaff` (`passive:false`, since `.ned-staff` is `touch-action:none`). When `e.touches.length === 2`, set `_nedTwoFinger = true`, record the average start Y and start pan; on move, `preventDefault` and update `_nedPanY` by the average-Y delta; clamp so the bass clef can reach the visible band above the QC overlay (e.g. `_nedPanY ∈ [0, maxPan]` where `maxPan` brings the bass bottom line (374) to just above the QC top edge — compute from staff height and current QC top). On touchend/cancel with <2 touches, clear `_nedTwoFinger`.
- **Gesture-conflict guards:**
  - Pencil pointer handlers bail while `_nedTwoFinger` is true.
  - When a 2nd touch lands mid-gesture, enter pan mode **and remove any note the 1st finger just placed** in this gesture (track the last-placed note id during an active pencil gesture so it can be undone). This prevents an accidental note when the user starts a two-finger pan.
- **Tip:** a faint, always-on, `pointer-events:none` tip pill anchored at the staff's bottom-right, e.g. "✌ two-finger drag → bass clef". Subtle (low opacity), does not intercept input.

**Verify:** On iPhone, two-finger vertical drag pans the staff and brings the bass clef into view; placed bass-clef notes land on the correct pitch (pan-corrected); single-finger placement still works; starting a two-finger pan does not leave a stray note; the tip is visible but never blocks taps. After panning, dropping a chord / placing a note maps to the right pitch.

---

## Out of scope (deferred — see ned mobile backlog)

Borrowed-chords bug is fixed here; remaining backlog items not in this batch unless already listed above. No desktop changes. No new section-management or transport behavior changes beyond what's specified.

## Verification plan

- Headless smoke per the repo's playwright-core recipe (EULA/guest/song-load bypass) to confirm the drawer mounts and renders without console errors beyond the expected Firestore `permission-denied` guest noise.
- Desktop render path diff-check: confirm no change to desktop rendering (the only shared edit is the `_defSeq.instrument` data default, which does not alter render of existing content).
- Primary acceptance is the user's iPhone test of items 1–9.
