# Drafthaus Lite — Mobile playback-session robustness (lite-1.085)

**Date:** 2026-07-29
**Base:** copy `lite-1.084.html` → `lite-1.085.html` (live root is `index.html` == `lite-1.084.html`, md5 `89c4d010629894eec4cc05bc123d4a50`)
**Scope:** Drafthaus **Lite** only (`lite-*.html` / `index.html`). Does **not** touch the full app (`full.html` / `1.3xx.html`).

## Problem

Four independent mobile pain points reported by the user, all on plain Safari/Chrome
**tabs** on iPhone (not an installed PWA):

1. **Playback stops when the phone locks or the user switches apps.** Audio should
   persist until stopped inside the app.
2. **The phone auto-locks after a period.** The app should keep the screen awake so it
   doesn't lock while in use.
3. **The sketchpad hides underneath the takes list.** On mobile, tapping the sketchpad
   button while the takes panel is expanded leaves the sketchpad invisible (behind the
   panel). It should float on top.
4. **The mic permission prompt reappears on every visit.** The user asked whether the
   setting can be "cookied."

## Constraints & findings (from reading `lite-1.084.html`)

- **Playback is Web Audio.** `playTake`/`stopPlayback`/`_getBuffer` (~lines 2369–2450)
  decode each take to an `AudioBuffer` and play it via
  `createBufferSource → GainNode → ctx.destination`. The playhead RAF reads
  `_audioCtx.currentTime`. iOS **suspends the `AudioContext`** whenever the tab is
  backgrounded or the screen locks, which is exactly why audio stops (#1).
- **No wake lock exists** anywhere in the file (#2).
- **Z-index (#3):** `#takesPanel` is `z-index: 7`, `#scratchPad` is `z-index: 6`; both are
  `position: absolute` inside `.song-body` (`position: relative`). The panel therefore
  covers the sketchpad. On mobile the takes panel spans `left:0; right:52px` (full width
  minus the rail); on desktop `left:50%`.
- **Mic permission (#4) cannot be persisted by the page.** On iOS both Safari and Chrome
  use WebKit, which deliberately forgets `getUserMedia` grants between fresh visits/reloads
  of a plain tab. No cookie, `localStorage`, header, or Permissions-API call can make the
  browser skip the prompt — this is an Apple security guarantee. The only ways to stop the
  re-prompt are user-side: **Add to Home Screen** (standalone PWA — iOS remembers the grant)
  or the manual **aA → Website Settings → Microphone → Allow** toggle (the exact
  "remember across reloads in this tab" switch). Within a single visit the app already
  doesn't re-ask.
- **PWA scaffolding already present:** `apple-mobile-web-app-capable`, black-translucent
  status bar, and `/lite.webmanifest` are in `<head>`.
- **Wiring points:** `_openSongObj(s)` (line 1439) is the song-open path; `goHome()`
  (line 1462) returns to the song list; a `visibilitychange` handler already exists
  (line 3987, calls `liteFreshenSong`); `startRecord()` is at line 2800; `toggleScratch()`
  toggles the sketchpad; boost gain is applied at line 2426.

## Design

### 1. Background / lock-screen audio — route all take transport through one `<audio>` element

iOS keeps a *playing `HTMLMediaElement`* alive in the background/lock screen; it does **not**
keep a Web Audio `AudioContext` alive. All **take transport** moves off Web Audio and onto a
single reused hidden element:

```html
<audio id="playEl" playsinline preload="auto"></audio>
```

- **Source:** IndexedDB-first blob via `dhAudioGet(take.id)` →
  `URL.createObjectURL(blob)`; fall back to `take.downloadUrl` when there is no local blob.
  Revoke the previous object URL each time the source changes (no leaks).
- **Play / stop / seek:** `playEl.currentTime = offset; playEl.play()` and
  `playEl.pause()`. Replaces `createBufferSource().start(0, offset)` / `.stop()`.
- **Whole-take loop:** `playEl.loop = true` (was `src.loop` for `_loopTakes`).
- **Region loop (waveform selection A→B):** no native element equivalent. In the existing
  playhead RAF, when `playEl.currentTime >= region.b`, set `playEl.currentTime = region.a`.
  **Accepted caveat:** loop boundaries gain a few ms of slop versus today's sample-exact
  `loopStart/loopEnd`. Acceptable for a songwriting/take app; explicitly signed off.
- **Playhead:** the RAF reads `playEl.currentTime` directly (replaces the
  `_phOffset + (_audioCtx.currentTime - _phStartCtx)` math and the `_phRegion`/`_curSource.loop`
  wrap logic). `ended` event resets the playhead to 0 and updates the rail/takes UI, matching
  today's `src.onended` behavior.
- **Media Session:** on play, set `navigator.mediaSession.metadata` (title = take display
  name, artist = song title) and register `play` / `pause` / `stop` action handlers wired to
  the app's transport. This yields lock-screen transport controls as a bonus of the element
  approach. Feature-detected.
- **Unchanged / still Web Audio (out of scope):** `AudioContext.decodeAudioData` for
  waveform peak computation (`_computePeaks`), chord & QuickChords playback
  (`playChordOnInstrument`, `_playSampled`, `_playSynth`), and the separate share-viewer
  audio engine (`sv*`, `_svCtx`). These are foreground-only interactions.

**Boost casualty (confirmed acceptable).** The optional per-song **Boost** currently
multiplies gain up to **4×** via a `GainNode` (line 2426: `g.gain.value = boost ? normGain : 1`).
An `<audio>` element's `volume` cannot exceed `1.0`, and re-routing through Web Audio to
regain gain would re-suspend in the background. Therefore **the >1× boost is dropped for take
playback** — boosted songs play at unity (normal) level. Boost is an opt-in flag, off by
default. Signed off by the user.

### 2. Wake lock — keep the screen awake while a song is open

- Acquire at the end of `_openSongObj`: `_wakeLock = await navigator.wakeLock.request('screen')`
  (guarded in try/catch; feature-detected).
- Release in `goHome()` (returning to the song list): `_wakeLock?.release(); _wakeLock = null;`.
- Re-acquire in the existing `visibilitychange` handler (line 3987) when
  `document.visibilityState === 'visible'` **and** a song is currently open — the browser
  auto-releases screen wake locks when the tab is hidden, so this restores it on return.
- On browsers without the API (older iOS < 16.4, etc.) the calls are silent no-ops.
- Scope decision (user-selected): held for the **entire time a song is open** (reading
  lyrics, playing, recording), not only during active playback.

### 3. Sketchpad floats over the takes panel

CSS-only. Raise `#scratchPad` `z-index` from **6 → 8** (above `#takesPanel`'s `7`). Both
elements share the `.song-body` stacking context, so this is a clean local change. The rail
— and therefore the sketchpad toggle button — remains visible beside the open takes panel,
so `toggleScratch()` keeps working with the panel open. No JS change.

### 4. Mic prompt — one-time iOS tip teaching the real cures

No code can persist the grant, so the deliverable teaches the two user-side cures via a
once-ever, dismissible hint:

- **Trigger:** first record attempt (in `startRecord`).
- **Gate:** shown only on iOS **tab** context — iOS user agent **and** not standalone
  (`navigator.standalone !== true`) — and only once, guarded by
  `localStorage['dh-lite-mic-tip-seen']`. Desktop and installed-PWA users never see it.
- **Copy:** explains the **aA → Website Settings → Microphone → Allow** toggle (the exact
  "remember across reloads in this tab" switch) and mentions **Add to Home Screen** as the
  stronger fix.
- **Dismiss:** a close/OK control sets the localStorage flag; the tip never returns.
- No mic re-plumbing, no held stream, no orange-dot cost.

## Testing

No test runner. Two layers:

### Headless (`_verify_lite_1085.js`, playwright-core + installed Chrome, per repo recipe)

Asserts what desktop Chrome can prove:
- `#playEl` exists; `playTake` sets its `src` and `currentTime`; `stopPlayback` pauses it.
- Playhead RAF reads `playEl.currentTime`.
- Region-loop seek: when currentTime passes `region.b`, it snaps back to `region.a`.
- Whole-take loop sets `playEl.loop = true`.
- `#scratchPad` computed `z-index` > `#takesPanel` computed `z-index`.
- Mic tip: shows on first record (iOS UA + non-standalone stub) → dismiss → localStorage
  flag set → does not reappear; and does **not** show on desktop UA.
- Wake lock: `navigator.wakeLock.request` (stubbed) is invoked on song open and the sentinel
  `release()` is called on `goHome`.

### Real iPhone QA (mandatory — desktop cannot prove these)

- Audio keeps playing after locking the phone and after switching apps; stops only when
  stopped in-app.
- Lock-screen transport controls appear and work (Media Session).
- Screen does not auto-lock while a song is open; does lock again on the song list.
- The mic tip renders correctly on a real iOS Safari tab.

### Regression

Re-run `_verify_lite_1084.js` (28/28) plus the prior lyrics/regression suites
(`_verify_lite_1072.js` 73/73 and the 19/19 + 15/15 suites) to confirm lyrics reconciliation
and takes behavior are untouched.

## Out of scope

- Full app (`full.html` / `1.3xx.html`).
- Share-viewer (`?share=`) audio engine background playback.
- Preserving >1× boost during playback (dropped, per §1).
- Any attempt to persist mic permission programmatically (impossible by design).
- Multitrack/stereo, audio monitoring.

## Versioning / deploy

Per repo workflow: copy `lite-1.084.html` → `lite-1.085.html`, diff the fresh copy against
its source to confirm it copied correctly, implement, verify, commit to `main`. Promotion to
`index.html` (root) and pushing (which deploys via GitHub Pages) happen only on explicit user
confirmation, after iPhone QA.
