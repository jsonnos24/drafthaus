# Recording toasts anchored to the record button — design

**Date:** 2026-06-16
**App:** Drafthaus **Lite** (`index.html`, currently == `lite-1.060.html`). Full-app
files (`full.html` / `1.3xx.html`) are NOT touched.
**Goal:** Recording-status toasts ("Saving take…", "Take saved ✓", etc.) appear to the
**left of the red record button** instead of bottom-center. All other toasts are
unchanged.

## Background

Lite uses a **single global `#toast` element** (CSS at line ~245, `toast(msg, ms, center)`
function at line ~715) reused by ~25 different messages. It is `position: fixed` at
bottom-center and already supports one positioning modifier, `.center` (a centered-modal
variant). The **record button** `#recBtn` sits at the top of a 52px-wide vertical `.rail`
pinned to the right edge of the song editor (markup ~line 606, `.rail` CSS ~line 294).

## Scope

**In scope** — the 8 recording-flow toast call sites, all inside
`startRecord` / `onRecStop` / `uploadTake`. Every one fires while the song editor (and
therefore the rail + `#recBtn`) is on screen:

| Line | Message | Duration |
|------|---------|----------|
| 1786 | `Microphone blocked — allow mic access` | default |
| 1792 | `Recording not supported here` | default |
| 1817 | `Too short` | default |
| 1822 | `Not signed in` | default |
| 1823 | `liteCapMessage()` | 3200 |
| 1824 | `Saving take…` | 1500 |
| 1841 | `Take saved ✓` | default |
| 1842 | `Save failed — check connection` | default |

(Line numbers are a snapshot for the `lite-1.060` base; re-locate by quoted string in the
new copy — the file is large and lines drift.)

**Out of scope** — the waveform-editor "Replacing…/Replaced ✓" toasts (~lines 1719–1738)
fire behind a modal overlay away from the rail, so they stay bottom-center. All other
~17 `toast(...)` call sites are unchanged.

## Approach (selected: A — dynamic anchor)

At show-time, measure `#recBtn`'s on-screen rect with `getBoundingClientRect()` and
position the pill just to its left, vertically centered on the button. This survives
header-height / safe-area / mobile-vs-desktop layout differences automatically and
visually points at the button. (Rejected: static CSS-only anchor — fragile to layout
shifts; separate toast element in the rail — duplicates machinery and the 52px rail is
too narrow for the text anyway.)

## Design

### 1. CSS — new `.toast.rec-anchor` variant on the existing `#toast`

- Cancels the bottom-center centering transforms; vertically centers via
  `translateY(-50%)`.
- Show/hide animation: hidden = `opacity 0` + a small horizontal slide offset
  (`translate(8px, -50%)`); shown (`.show`) = `translate(0, -50%)`. Reuses the existing
  opacity/transform transition.
- `left: auto; bottom: auto;` — `top` and `right` are set inline by JS.
- `max-width` (e.g. `calc(100vw - 80px)`) with normal wrapping so long messages
  ("Microphone blocked — allow mic access") don't overflow the left edge on narrow
  phones.

### 2. JS — `recToast(msg, ms)` wrapper

- Looks up `#recBtn` and calls `getBoundingClientRect()`.
- Computes inline position: `right = window.innerWidth - rect.left + GAP` (GAP ≈ 10px, so
  the pill's right edge sits GAP px left of the button) and
  `top = rect.top + rect.height / 2` (combined with the variant's `translateY(-50%)` to
  center on the button).
- Adds the `rec-anchor` class, sets inline `top`/`right`, then shows (same
  show/`clearTimeout`/auto-hide mechanics as `toast()`).
- **Fallback:** if `#recBtn` is missing or its rect is off-screen / zero-size, clear the
  anchor and fall back to a normal bottom-center `toast(msg, ms)`.

### 3. `toast()` must reset the variant

`toast()` already toggles the `center` class each call. It must also **remove
`rec-anchor` and clear the inline `top`/`right`** on every normal call, so a recording
toast followed by an ordinary toast returns cleanly to bottom-center. (Single shared
element, so state from the previous call must not leak.)

### 4. Convert the 8 call sites

Replace `toast(...)` → `recToast(...)` at the 8 sites above, preserving each existing
duration argument (notably `1500` on "Saving take…" and `3200` on the cap message).

## Edge cases

- **Button absent / off-screen:** fallback to bottom-center (see §2).
- **Long error text on narrow screens:** `max-width` + wrapping (see §1).
- **Rapid successive recording toasts** (e.g. "Saving take…" → "Take saved ✓"): same
  single element, `clearTimeout` resets the timer; position is recomputed each call.
- **Recording toast → normal toast:** §3 reset returns it to bottom-center.

## Verification

No test runner — drive in a real browser (headless Playwright recipe, then on-device QA
on the phone per the Lite workflow). Confirm:

1. Triggering each recording state shows the pill to the left of `#recBtn`, vertically
   centered, not overlapping the button or running off-screen.
2. A non-recording toast (e.g. "Key: …", export) still appears bottom-center afterward.
3. Long mic-error text wraps and stays on-screen on a narrow viewport.
4. Fallback to bottom-center when `#recBtn` is not present.

## Versioning / delivery

Per the Lite workflow: copy `index.html` → new `lite-1.061.html`, make the change there
(and mirror into `index.html` on milestone per the established promote step — confirm),
commit to `main`, **confirm with the user before pushing** (push deploys via GitHub
Pages). On-device QA afterward.
