# Desktop 1.310 — Layout / Voices / Menu Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Drafthaus build 1.310 with 21 desktop changes: a fuller piano-roll, relocated Keys 1-9 + sequence strip, a minimized C1–C6 floating keyboard, menu/header cleanup, inverted side-tab letters, quantize-off default, and four new instrument voices.

**Architecture:** Single-file vanilla-JS/HTML app. All work happens in a new copy `1.310.html` (from `1.309.html`); `index.html` is untouched (deploy is a separate, user-approved promote). No test runner — every task is verified by **grep assertions** (structure) and a **headless Chrome harness** (visual), then committed. Code is located by **search string**, never raw line numbers (the file is ~78k lines and numbers drift).

**Tech Stack:** HTML + vanilla JS + Web Audio + Firestore. Verify with `playwright-core` driving the installed Chrome. Tone.js-style CDN samplers (`nbrosowsky/tonejs-instruments`, salamander) for voices.

---

## Conventions for every task

- **Target file:** `1.310.html` (created in Task 0). Never edit `1.309.html` or `index.html`.
- **Locate before editing:** use the quoted search string given in the task. If a string appears more than once, the task names which **desktop variant** to target.
- **Verify (structure):** run the task's `grep` command; confirm the stated count/result.
- **Verify (visual):** after each phase, run the headless harness in the **Verification Harness** appendix and eyeball the screenshot.
- **Commit** at the end of each task with the given message. Work lands on `main` (per project workflow); do **not** push (Pages deploy) without explicit user approval.

### Mobile safety (HARD REQUIREMENT — applies to every task)

**Mobile must be untouched.** This is desktop-only work. The app has separate
mobile code paths (`mpr-*` mobile piano roll, `kbd-stage-*`, the bottom nav, and
mobile params-bar variants). For every edit:

- **Scope CSS to desktop containers** — `.pr-overlay`, `.side-tabs`, the desktop
  params-bar variant, or a desktop media query. Never add a bare global selector
  (e.g. `.seq-strip-bar`, `.pr-chord-palette`, an instrument `<option>` list) in a
  way that changes the mobile rendering, unless the change is purely cosmetic and
  explicitly desired everywhere (borders) — and even then, verify mobile.
- **Gate desktop layout JS** behind a desktop check (the codebase uses
  `innerWidth < 900` to stub desktop-only modules like Arrange — match that).
  Strip-mount, PR fill-to-bottom, keys-1-9 chips, floating-keyboard changes must
  not run on the mobile paths.
- **Target the desktop DOM variant.** Several blocks (params bar, key select,
  palette) have mobile twins. Always edit the desktop variant; leave the
  `mpr-*` / `kbd-stage-*` / mobile-row markup alone.
- **Shared elements** (the `#mobileMenuPanel`, the instrument dropdown `<option>`
  lists): the requested menu cleanup + new voices are intended to apply globally,
  but must not *break* mobile — verify the mobile menu and mobile instrument
  selection still work in Task 17.
- **Regression check:** Task 17 includes a mobile-viewport pass (390×844)
  confirming the mobile UI is visually and functionally unchanged.

---

## Task 0: Create the 1.310 build (T17)

**Files:**
- Create: `1.310.html` (copy of `1.309.html`)

- [ ] **Step 1: Copy the file**

```bash
cd /Users/jasoncraig/Documents/Claude/Projects/Drafthaus
cp 1.309.html 1.310.html
```

- [ ] **Step 2: Find the build badge string**

Run: `grep -n "Build 1.309\|Build 1.30\|build-badge\|>1.309<\|1\.309" 1.310.html | head`
The header badge renders the version (screenshot shows `Build 1.287`). Identify the exact current token (e.g. `Build 1.309` text node, or a `_BUILD`/`APP_VERSION` constant).

- [ ] **Step 3: Bump the badge to 1.310**

Replace the badge text/constant `1.309` → `1.310`. If there is a JS constant (e.g. `const BUILD = '1.309'`), update it; otherwise update the literal in the header markup.

- [ ] **Step 4: Verify**

Run: `grep -c "1\.310" 1.310.html` → expect ≥ 1.
Run: `grep -n "1\.309" 1.310.html | head` → confirm no remaining *version-badge* reference (sample CDN paths/comments referencing old builds are fine).

- [ ] **Step 5: Commit**

```bash
git add 1.310.html && git commit -m "chore(1.310): branch build from 1.309"
```

---

# PHASE 1 — Independent quick wins

## Task 1: Invert side-tab letter opacity (T11)

**Files:** Modify: `1.310.html` (CSS `.side-tab-key`)

- [ ] **Step 1: Locate**

Run: `grep -n "\.side-tab-key {" 1.310.html`
Current block:
```css
.side-tab-key {
    font-weight: 800;
    opacity: 0.55;
  }
```

- [ ] **Step 2: Edit — first letter brightest, rest dimmer**

Change `.side-tab-key` opacity `0.55` → `1`. The rest of the word is `.st-rest` inside `.side-tab-label` (base opacity `0.7`), which already reads dimmer, but make it explicit so the contrast is intentional. Add immediately after the `.side-tab-key` rule:
```css
.side-tab-key { font-weight: 800; opacity: 1; }
.side-tab .st-rest { opacity: 0.6; }
```
(Replace the old `.side-tab-key` rule; add the `.st-rest` rule.)

- [ ] **Step 3: Verify**

Run: `grep -n "\.side-tab-key {" 1.310.html` then read the rule → opacity is `1`.
Run: `grep -n "\.side-tab .st-rest" 1.310.html` → present.

- [ ] **Step 4: Commit**

```bash
git add 1.310.html && git commit -m "feat(1.310): invert side-tab letter emphasis — first letter bright"
```

## Task 2: Hide header Tutorial + Help buttons (T12)

**Files:** Modify: `1.310.html` (header markup)

- [ ] **Step 1: Locate**

Run: `grep -n "hdrTutorialBtn\|hdrHelpBtn" 1.310.html`
Current markup:
```html
<button class="hdr-tutorial-btn" id="hdrTutorialBtn" onclick="_tutOpenOverlay()" title="Open the Tutorial">Tutorial</button>
<button class="hdr-tutorial-btn" id="hdrHelpBtn" onclick="_tutStartWalkthrough()" title="Start guided walkthrough" style="...">Help me, I'm stuck!</button>
```

- [ ] **Step 2: Edit — hide both (reversible)**

Add `display:none;` to each button's inline style (keep the elements so the tutorial system's `getElementById` calls don't throw). For `#hdrTutorialBtn` add `style="display:none;"`; for `#hdrHelpBtn` prepend `display:none;` to its existing `style`.

- [ ] **Step 3: Verify**

Run: `grep -n "hdrTutorialBtn" 1.310.html` → confirm `display:none`.
Run: `grep -n "hdrHelpBtn" 1.310.html` → confirm `display:none`.

- [ ] **Step 4: Commit**

```bash
git add 1.310.html && git commit -m "feat(1.310): hide header Tutorial + Help buttons"
```

## Task 3: Menu cleanup — remove About / MIDI / Theme, hide Quota (T13/T16/T19/T20)

**Files:** Modify: `1.310.html` (`#mobileMenuPanel`)

- [ ] **Step 1: Locate the menu panel**

Run: `grep -n "mobileMenuPanel\|menuThemeToggle\|MIDI Connect\|mobileMenuQuota\|>ℹ About<" 1.310.html`
The panel is the `<div class="mobile-menu-panel" id="mobileMenuPanel">` block.

- [ ] **Step 2: Remove MIDI Connect**

Delete the line:
```html
<button title="Connect a MIDI controller..." class="mobile-menu-item" onclick="initMidi();closeMobileMenu()">🎹 MIDI Connect</button>
```

- [ ] **Step 3: Remove Theme toggle**

Delete the line:
```html
<button title="Cycle through available color themes..." class="mobile-menu-item" id="menuThemeToggle" onclick="cycleTheme()">◑ Theme: <span id="menuThemeLabel">Dark</span></button>
```

- [ ] **Step 4: Remove About (menu only)**

Delete the menu line (NOT other About entry points):
```html
<button title="Learn about Drafthaus..." class="mobile-menu-item" onclick="openAbout();closeMobileMenu()">ℹ About</button>
```

- [ ] **Step 5: Hide Quota**

The quota element is `<div class="mobile-menu-item mobile-menu-quota" id="mobileMenuQuota">Quota: —</div>`. Add `style="display:none;"` (JS may still write to it; hide rather than delete).

- [ ] **Step 6: Verify**

Run: `grep -c "menuThemeToggle\|>🎹 MIDI Connect<\|onclick=\"openAbout();closeMobileMenu()\"" 1.310.html` → expect `0`.
Run: `grep -n "mobileMenuQuota" 1.310.html` → confirm `display:none`.

- [ ] **Step 7: Commit**

```bash
git add 1.310.html && git commit -m "feat(1.310): menu cleanup — remove About/MIDI/Theme, hide Quota"
```

## Task 4: Add Sign-In menu item (signed-out only) (T14)

**Files:** Modify: `1.310.html` (`#mobileMenuPanel` top + a small show/hide hook)

- [ ] **Step 1: Confirm the auth-overlay entry point**

Run: `grep -n "v4RequireAuth\|signInAsGuest\|onAuthStateChanged" 1.310.html | head`
The login/create-account overlay is opened by `v4RequireAuth()` (used at line ~20407 for the "Sign In" / "Create Account" landing actions). The signed-in state is tracked via `auth.onAuthStateChanged` and `auth.currentUser`. Guests are signed-in-anonymously (`signInAsGuest`), so "signed out / not a real account" = anonymous user. Decide the condition: show the Sign-In item when `auth.currentUser` is null **or** `auth.currentUser.isAnonymous` is true.

- [ ] **Step 2: Add the Sign-In button at the top of the panel**

Immediately after `<div class="mobile-menu-panel" id="mobileMenuPanel">` and before the `← Song List` button, add:
```html
<button id="menuSignInBtn" class="mobile-menu-item" style="display:none;font-weight:700;color:#64dcb4;border-bottom:1px solid rgba(255,255,255,0.08);margin-bottom:4px;padding-bottom:10px;" onclick="v4RequireAuth();closeMobileMenu()">↪ Sign In / Create Account</button>
```

- [ ] **Step 3: Wire its visibility to auth state**

Run: `grep -n "function updateMobileMenuUser\|mobileMenuUser\b" 1.310.html | head` to find where the menu's user line is refreshed. Add a helper and call it from the existing `auth.onAuthStateChanged` handler(s):
```js
function _updateMenuSignIn() {
  var btn = document.getElementById('menuSignInBtn');
  if (!btn) return;
  var u = (typeof auth !== 'undefined' && auth.currentUser) ? auth.currentUser : null;
  var signedOut = !u || u.isAnonymous;
  btn.style.display = signedOut ? '' : 'none';
}
```
Call `_updateMenuSignIn();` inside each `auth.onAuthStateChanged(...)` callback (search `onAuthStateChanged`) and once on menu-open (search `toggleMobileMenu`).

- [ ] **Step 4: Verify**

Run: `grep -n "menuSignInBtn\|_updateMenuSignIn" 1.310.html` → button + helper + at least one call site present.
Visual (harness, guest session): open menu → Sign-In item visible at top.

- [ ] **Step 5: Commit**

```bash
git add 1.310.html && git commit -m "feat(1.310): menu Sign-In item shown when signed out → auth overlay"
```

## Task 5: Yellow "← Song List" menu item (T21)

**Files:** Modify: `1.310.html` (`#mobileMenuPanel` first item)

- [ ] **Step 1: Locate**

Run: `grep -n "showList();closeMobileMenu()" 1.310.html`
Current:
```html
<button title="Go back to the song list view..." class="mobile-menu-item" onclick="showList();closeMobileMenu()" style="font-weight:700;border-bottom:1px solid rgba(255,255,255,0.08);margin-bottom:4px;padding-bottom:10px;">← Song List</button>
```

- [ ] **Step 2: Edit — gold text + arrow**

Prepend `color:var(--gold,#f5a623);` to its inline `style`. (The `←` is part of the text node, so coloring the button colors both.)

- [ ] **Step 3: Verify**

Run: `grep -n "showList();closeMobileMenu()" 1.310.html` → confirm `--gold` in style.

- [ ] **Step 4: Commit**

```bash
git add 1.310.html && git commit -m "feat(1.310): gold ← Song List menu item"
```

## Task 6: Quantize off by default + confirm on-demand quantize (T7)

**Files:** Modify: `1.310.html` (song-creation defaults; verify toggle path)

- [ ] **Step 1: Confirm current defaults**

Run: `grep -n "melodyQuantize" 1.310.html`
Defaults already set `melodyQuantize: false` at song templates (~21747, ~27092). Playback reads `melodyQuantize !== false` (treats missing as ON). So a song with the field **absent** quantizes; a song with `false` does not.

- [ ] **Step 2: Make the default explicitly false everywhere a song is created**

Ensure every new-song template object includes `melodyQuantize: false`. Search each `melodyQuantize` template literal and confirm `false`. If any song-creation path omits the field, add `melodyQuantize: false`.

- [ ] **Step 3: Confirm the on-demand quantize path**

Run: `grep -n "function melodyToggleQuantize\|function melodyQuantizeNotes" 1.310.html`
`melodyToggleQuantize()` flips `song.sequencer.melodyQuantize` and toggles the button `active` class; `melodyQuantizeNotes()` performs the snap. **Behavior to confirm in harness:** with quantize OFF, select notes, press the Quantize button → notes snap. Read `melodyToggleQuantize`/`melodyQuantizeNotes` to confirm tapping the button (turning it ON) triggers a quantize pass on existing/selected notes. If toggling ON does **not** immediately quantize existing notes, add a `melodyQuantizeNotes()` call in `melodyToggleQuantize()` when it transitions to ON.

- [ ] **Step 4: Verify**

Run: `grep -c "melodyQuantize: false" 1.310.html` → expect ≥ 2 (templates).
Visual (harness): new song → Quantize button renders inactive; drawing off-grid notes then pressing Quantize snaps them.

- [ ] **Step 5: Commit**

```bash
git add 1.310.html && git commit -m "feat(1.310): quantize off by default; on-demand quantize on toggle"
```

## Task 7: Sequence-part borders (T8)

**Files:** Modify: `1.310.html` (CSS `.seq-strip-bar`)

- [ ] **Step 1: Locate**

Run: `grep -n "\.seq-strip-bar" 1.310.html | head`
Find the `.seq-strip-bar` rule (the section bar) and the active variant `.seq-strip-bar-active`.

- [ ] **Step 2: Edit — add separating borders**

Add to `.seq-strip-bar`:
```css
.seq-strip-bar { border-left: 1px solid rgba(255,255,255,0.28); border-right: 1px solid rgba(0,0,0,0.35); box-sizing: border-box; }
```
This makes each section's start/end legible against neighbors. (Keep existing colour/flex rules; only add the border + box-sizing.)

- [ ] **Step 3: Verify**

Run: `grep -n "border-left: 1px solid rgba(255,255,255,0.28)" 1.310.html` → present.
Visual (harness): strip shows clear divisions between Section 1/2/3.

- [ ] **Step 4: Commit**

```bash
git add 1.310.html && git commit -m "feat(1.310): visible borders between sequence sections"
```

---

# PHASE 2 — Voices

## Task 8: Add four instrument voices (T15)

**Files:** Modify: `1.310.html` (`INSTRUMENTS`, sampler base URLs/loaders, chord + keys dropdown `<option>` lists)

- [ ] **Step 1: Research sampled pad/lead (first)**

Use WebSearch / WebFetch to look for free, CDN-hosted sampled **analog pad** and **analog lead** sets usable like the existing samplers (one sample per few semitones, hosted on a jsDelivr GitHub mirror). Candidate starting points: search `tonejs instruments synth pad samples github`, `VCSL synth jsdelivr`, `freepats synth`. Record any usable base URL + note→file map. **If nothing meets a basic quality/completeness bar, use the oscillator fallback in Step 4b.** Note the decision inline in a code comment.

- [ ] **Step 2: Locate the existing sampler definitions**

Run: `grep -n "GUITAR_BASE_URL\|PIANO2_BASE_URL\|nbrosowsky/tonejs-instruments\|function .*Sampler\|loadGuitarSampler\|createSampler" 1.310.html | head`
Mirror the existing per-instrument sampler pattern (base URL + note map + lazy load). `nbrosowsky/tonejs-instruments` exposes `bass-electric/` and `violin/` sample folders in the same layout as `guitar-acoustic/`.

- [ ] **Step 3: Add Bass Guitar + Violins samplers (real samples)**

Add base URLs next to the existing ones:
```js
const BASS_BASE_URL   = 'https://cdn.jsdelivr.net/gh/nbrosowsky/tonejs-instruments@master/samples/bass-electric/';
const VIOLIN_BASE_URL = 'https://cdn.jsdelivr.net/gh/nbrosowsky/tonejs-instruments@master/samples/violin/';
```
Create their samplers with the same loader the guitar/upright use (copy that function, swap the base URL and the available-note list — bass-electric/violin ship `A`, `C`, `D#`/`E`, `G`/`A#` across octaves; confirm the exact filenames the loader expects against the repo listing fetched in Step 1/2).

- [ ] **Step 4a: Add the two analog synths (sampled path)**

If Step 1 found a usable set, add `PAD_BASE_URL` / `LEAD_BASE_URL` + samplers the same way.

- [ ] **Step 4b: Add the two analog synths (oscillator fallback)**

If no sampled set qualifies, implement `pad` and `lead` as Web Audio voices reusing the existing `synth` voice plumbing (search `case 'synth'` / the synth voice factory). Pad = detuned saw ×2 + lowpass + slow attack/release; Lead = square/saw + slight glide + faster envelope. Register them through the same play path the `synth` voice uses so chord/keys playback, the keyboard, and the sequencer all route correctly.

- [ ] **Step 5: Register in INSTRUMENTS + both dropdowns**

Run: `grep -n "const INSTRUMENTS = \[\|>Upright + Synth<\|piano2+synth" 1.310.html`
Add the four voices as selectable options in the **chord** instrument dropdown and the **keys/melody** instrument dropdown (the `<option>` lists at the `piano2+synth` sites: ~35302, ~44618, ~44632, ~46735). Use ids `bass`/`violin`/`pad`/`lead` (avoid colliding with the existing fretboard `bass` instrument id — namespace the *sampler/voice* id distinctly, e.g. `bassgtr`, if `bass` is taken). Add matching labels: `Bass Guitar`, `Violins`, `Analog Pad`, `Analog Lead`.

- [ ] **Step 6: Verify**

Run: `grep -c "Bass Guitar\|Violins\|Analog Pad\|Analog Lead" 1.310.html` → expect options present in both dropdown lists.
Visual (harness): select each new voice in the chords dropdown and the keys dropdown; play a chord/note; confirm audio + no uncaught console errors (guest Firestore `permission-denied` is expected noise).

- [ ] **Step 7: Commit**

```bash
git add 1.310.html && git commit -m "feat(1.310): add Bass Guitar, Violins, Analog Pad, Analog Lead voices"
```

---

# PHASE 3 — Layout cluster (strict order)

> These tasks change the desktop piano-roll geometry. Do them in order; the
> fill-to-bottom (Task 14), grid-reclaim (Task 13), and QC overlay (Task 15) run
> last so they measure the *final* layout.

## Task 9: Remove Q-Flam button + dropdown (T4)

**Files:** Modify: `1.310.html` (`.pr-header`)

- [ ] **Step 1: Locate**

Run: `grep -n "prQFlamBtn\|prQFlamAmt" 1.310.html`

- [ ] **Step 2: Delete the button + the whole `<select>`**

Remove:
```html
<button class="pr-tool-btn" id="prQFlamBtn" onclick="prToggleQFlam()" ...>Q-Flam</button>
<select class="pr-tool-btn" id="prQFlamAmt" ...> ...all <option>... </select>
```
(Delete the entire `<select id="prQFlamAmt">…</select>` including every `<option>`.)

- [ ] **Step 3: Neutralize dangling calls**

Run: `grep -n "prToggleQFlam\|prApplyQFlam\|_prQFlamEnabled" 1.310.html`
Leave the function definitions (harmless if unused) but confirm nothing else *renders* the removed elements. No further change needed if only the markup referenced them.

- [ ] **Step 4: Verify**

Run: `grep -c "prQFlamBtn\|prQFlamAmt" 1.310.html` → expect `0`.
Visual: toolbar no longer shows Q-Flam or the ticks dropdown.

- [ ] **Step 5: Commit**

```bash
git add 1.310.html && git commit -m "feat(1.310): remove Q-Flam button + flam dropdown from PR toolbar"
```

## Task 10: "Zoom" label above the H/V sliders (T5)

**Files:** Modify: `1.310.html` (`.pr-header` zoom sliders)

- [ ] **Step 1: Locate**

Run: `grep -n "prZoomH\|prZoomV" 1.310.html | head`
Current (two adjacent spans):
```html
<span ... title="Horizontal zoom">H<input ... id="prZoomH" ...></span>
<span ... title="Vertical zoom">V<input ... id="prZoomV" ...></span>
```

- [ ] **Step 2: Wrap in a labeled column**

Replace the two spans with a small column carrying a centered "Zoom" label on top:
```html
<span style="display:inline-flex;flex-direction:column;align-items:center;gap:2px;margin-left:6px;">
  <span style="font-size:9px;color:#aaa;letter-spacing:0.06em;">Zoom</span>
  <span style="display:inline-flex;align-items:center;gap:8px;">
    <span style="display:inline-flex;align-items:center;gap:3px;font-size:10px;color:#aaa;" title="Horizontal zoom">H<input type="range" id="prZoomH" min="6" max="60" value="12" style="width:60px;accent-color:#e8749a;cursor:pointer;" oninput="prSetZoomH(+this.value)"></span>
    <span style="display:inline-flex;align-items:center;gap:3px;font-size:10px;color:#aaa;" title="Vertical zoom">V<input type="range" id="prZoomV" min="12" max="40" value="26" style="width:60px;accent-color:#e8749a;cursor:pointer;" oninput="prSetZoomV(+this.value)"></span>
  </span>
</span>
```
(Preserve the exact `min`/`max`/`value`/`oninput` from the current inputs — copy them from the located markup rather than trusting these defaults if they differ.)

- [ ] **Step 3: Verify**

Run: `grep -n ">Zoom<" 1.310.html` → present, near `prZoomH`.
Visual: a centered "Zoom" label sits above the H and V sliders; both still work.

- [ ] **Step 4: Commit**

```bash
git add 1.310.html && git commit -m "feat(1.310): Zoom label centered above H/V sliders"
```

## Task 11: Floating keyboard — minimized default, C1–C6, reorder, flip triangle (T2/T3)

**Files:** Modify: `1.310.html` (floating keyboard render — `fkb*` / inline keyboard; the keys/voice dropdown)

**Mobile guard:** Confirm the `fkb` inline keyboard is the **desktop** floating keyboard, not the mobile keyboard (mobile uses `mpr`/`kbd-stage`). If the `fkb` builder is shared, gate the range/minimized/reorder/triangle changes behind a desktop check (`innerWidth >= 900`) so the mobile keyboard is unchanged.

- [ ] **Step 1: Read the floating keyboard region**

Run: `grep -n "fkbPopOut\|fkb-popout-btn\|fkb-inline\|fkbMinimize\|fkb-toggle\|kbdOctave\|startOct\|C1\|octave" 1.310.html | head -30`
Read the inline-keyboard builder (around the `fkb-popout-btn` creation and the octave loop that renders C1..C7). Identify: (a) the octave range constants, (b) the minimized/expanded default state, (c) the drawer toggle element whose triangle must flip, (d) the current home of the keys/voice dropdown.

- [ ] **Step 2: Range → C1–C6**

In the octave loop that builds the inline keyboard, change the upper bound so it renders **C1 through C6** (was C1–C7). Update both the key-render loop and any octave label logic so the top octave is 6.

- [ ] **Step 3: Default to minimized**

Find the state flag that controls expanded vs minimized (search the minimize handler near `fkb` / `Pop-Out`). Initialize it to **minimized** on load, so the floating keyboard boots in its minimized position.

- [ ] **Step 4: Reorder controls → `[C1–C6] [Pop-Out] [Keyboard Voice ▾]`**

Move the keys/voice instrument dropdown (search the keys-instrument `<select>` rendered inside the floating keyboard) to sit **after** the Pop-Out button, labeled `Keyboard Voice:`. Final inline order: keyboard board → `Pop-Out` button → `Keyboard Voice:` `<select>`. Reuse the existing select element/handler; just relocate it and add the label span.

- [ ] **Step 5: Flip the drawer toggle triangle up**

Find the floating-keyboard drawer toggle (the pull-tab arrow). Change its glyph/rotation so the triangle points **up** (e.g. `▲` or `rotate(180deg)` on the existing arrow) — matching the direction the floating keyboard travels when it pops up.

- [ ] **Step 6: Verify**

Run: `grep -n "Keyboard Voice" 1.310.html` → label present after Pop-Out.
Visual (harness): floating keyboard boots minimized; spans C1–C6; order is board → Pop-Out → Keyboard Voice dropdown; toggle triangle points up; the new voices (Task 8) appear in the dropdown.

- [ ] **Step 7: Commit**

```bash
git add 1.310.html && git commit -m "feat(1.310): floating keyboard — minimized default, C1–C6, reorder, up triangle"
```

## Task 12: Relocate Keys 1-9 into the params bar (T6)

**Files:** Modify: `1.310.html` (desktop keyboard-drawer params bar + `#prChordPalette` host; palette renderer)

**Mobile guard:** There are multiple params-bar variants (mobile rows + desktop row). Edit **only the desktop variant** (the one with `#seqKeySelect` directly followed by `#kbdKeysTimeSig` under the desktop "Row 1" layout). Do not touch the `mpr-*` / mobile params markup. The mirrored `#paramsKeysSlots` host must live only in the desktop row.

- [ ] **Step 1: Identify the desktop params bar variant**

Run: `grep -n "seqKeySelect\|kbdKeysTimeSig\|Row 1:" 1.310.html`
The desktop keyboard-drawer params row is the one rendering `Key, Time Sig, Bars, Progression, Chords inst, Keys inst, Quantize` (the variant with `id="seqKeySelect"` immediately followed by `id="kbdKeysTimeSig"`; confirm by reading the surrounding "Row 1" comment for the desktop layout). The `Key` `<select>` is `#seqKeySelect`; the Time Sig `<select>` is `#kbdKeysTimeSig`.

- [ ] **Step 2: Read the Keys 1-9 palette renderer**

Run: `grep -n "prBuildPalette\|prChordPalette\|pr-chord-pill\|data-degree" 1.310.html | head`
`#prChordPalette` (left column) is populated by the palette builder with one `.pr-chord-pill[data-degree][data-chord]` per scale degree (mapped to number keys 1–9). Note the markup it produces and the click/number-key handlers so they survive the move.

- [ ] **Step 3: Add a "Use Keys" inline chip group between Key and Time Sig**

In the desktop params row, between `#seqKeySelect` and `#kbdKeysTimeSig`, insert:
```html
<span class="kps-label" style="margin-left:6px;">Use Keys</span>
<div id="paramsKeysSlots" class="params-keys-slots" style="display:inline-flex;gap:3px;align-items:center;"></div>
```

- [ ] **Step 4: Render the 1–9 slots into the new inline host**

Make the palette builder render into `#paramsKeysSlots` as **compact horizontal chips** (number + chord, e.g. small fixed-width pills) in addition to / instead of the old left column. Simplest robust approach: after the existing builder populates `#prChordPalette`, mirror its `.pr-chord-pill` nodes into `#paramsKeysSlots` (clone nodes, keep `data-degree`/`data-chord` + rewire the same click handler), then hide the old column (Task 13 reclaims its space). Add CSS:
```css
.params-keys-slots .pr-chord-pill { min-width: 30px; padding: 2px 5px; font-size: 9px; text-align: center; }
```

- [ ] **Step 5: Verify**

Run: `grep -n "paramsKeysSlots\|>Use Keys<" 1.310.html` → present.
Visual (harness): params bar reads `Key ▾ · Use Keys · [1..9] chips · Time Sig`; clicking a chip / pressing number keys still triggers the chord; per-degree colors preserved.

- [ ] **Step 6: Commit**

```bash
git add 1.310.html && git commit -m "feat(1.310): move Keys 1-9 into params bar as Use Keys chips"
```

## Task 13: Piano-roll grid reclaims the left column (T10)

**Files:** Modify: `1.310.html` (CSS/markup for `#prChordPalette` + `.pr-grid-wrap`)

- [ ] **Step 1: Hide the desktop left column**

Now that the 1–9 slots live in the params bar (Task 12), hide `#prChordPalette` in the **desktop pr-overlay** context so the grid takes its width. Run: `grep -n "\.pr-chord-palette {" 1.310.html`. Add a desktop rule:
```css
.pr-overlay .pr-chord-palette { display: none; }
```
(Do not break the mobile `mpr-chord-sidebar` override, which already shows its own palette.)

- [ ] **Step 2: Let the grid expand**

Confirm `.pr-grid-wrap` / `#prBodyInner` flexes to full width once the palette is gone (it's a flex row; removing the first child reclaims the space). If the grid has a hard left margin/width accounting for the palette, remove it.

- [ ] **Step 2.5: Reflow guard**

Run: `grep -n "prResize\|prRelayout\|prRedraw\|function prRender" 1.310.html | head` — call the existing grid relayout/redraw after the palette is hidden so the canvas/ruler recompute to the wider width (the grid canvas is sized in JS).

- [ ] **Step 3: Verify**

Visual (harness): the piano-roll grid spans the full horizontal frame; no empty gutter where the Keys 1-9 column used to be; notes/ruler align.

- [ ] **Step 4: Commit**

```bash
git add 1.310.html && git commit -m "feat(1.310): PR grid reclaims vacated Keys 1-9 column width"
```

## Task 14: Sequence strip under the toolbar in keyboard + drum drawers, grid-aligned + zoom-resize; hide Play Sequence (T18)

**Files:** Modify: `1.310.html` (strip mount/unmount + render mode; keyboard & drum drawer hosts; zoom hooks; `#seqStripPlayBtn`)

**Mobile guard:** Gate `_pianoMountStrip`/`_drumMountStrip` behind the desktop check (`innerWidth >= 900`) so mobile never relocates the strip — mobile keeps its current strip placement. Hiding `#seqStripPlayBtn` is acceptable globally (it's hidden in grid mode already), but confirm the mobile strip still renders and functions without it.

- [ ] **Step 1: Study the Arrange mount pattern (reference)**

Run: `grep -n "_arrMountStrip\|_arrUnmountStrip\|arrTimelineInner\|seqStripRender('grid'\|seqStripRender(\"grid\"" 1.310.html`
Read `_arrMountStrip`/`_arrUnmountStrip` (~74819): they move `#globalSeqStrip` into `#arrTimelineInner` and render `'grid'` mode (bar width = `bars × ppb`). This is the template for mounting into the keyboard/drum grids.

- [ ] **Step 2: Hide the Play Sequence button**

Run: `grep -n "seqStripPlayBtn" 1.310.html`
In `seqStripRender` (where the `#seqStripPlayBtn` markup is emitted, ~25816) stop emitting it, or render it with `display:none`. Hiding it removes the fixed-width left element that pushed bars out of alignment with the grid origin. (Grid mode already hides it per CLAUDE.md — confirm and extend that condition to the new keyboard/drum mounts.)

- [ ] **Step 3: Add keyboard-drawer + drum-drawer mount hosts**

Identify the grid scroll containers: PR grid = `#prGridScroll`/`.pr-grid-wrap` under `.pr-header`; drum grid = the sequencer/drum step-grid scroll container (run `grep -n "drum.*grid\|seqGrid\|drumGridScroll\|step-grid" 1.310.html | head` to find it). Create `_pianoMountStrip()` / `_drumMountStrip()` (mirroring `_arrMountStrip`) that move `#globalSeqStrip` to **directly under the toolbar, above the grid**, inside each drawer, and render grid mode with that drawer's pixels-per-bar:
- Piano: ppb derived from `PR_COL_W` (search `_arrPPB`/`window.prGetColW`) × columns-per-bar; offset by the key-label gutter (44px — `#prNotesLayer` uses `left:44px`).
- Drum: ppb derived from the drum step-grid column width × steps-per-bar; offset by that grid's label gutter.
Add matching `_pianoUnmountStrip()` / `_drumUnmountStrip()` that return `#globalSeqStrip` to its home spot (before `#seqStripToggleBtn`) and render `'fit'`.

- [ ] **Step 4: Call mount/unmount on drawer open/close**

Run: `grep -n "openKeyboardDrawer\|navToolTap\|sideTabTap\|openSeqDrawer\|function .*Drawer" 1.310.html | head`
Call `_pianoMountStrip()` when the keyboard drawer/PR opens and `_pianoUnmountStrip()` when it closes; same for `_drumMountStrip`/`_drumUnmountStrip` on the drum drawer. Ensure leaving one drawer for another unmounts cleanly (only one host at a time; the strip is a single element).

- [ ] **Step 5: Re-render on horizontal zoom**

Run: `grep -n "function prSetZoomH\|prSetZoomH =" 1.310.html`
At the end of `prSetZoomH` (and the drum grid's zoom handler), if the strip is mounted in that drawer, re-render grid mode with the new ppb so each section grows/shrinks to stay aligned with the grid. Use `seqStripRender('grid', <newPpbPerBar>)` and reposition the playhead.

- [ ] **Step 6: Verify**

Run: `grep -n "_pianoMountStrip\|_drumMountStrip" 1.310.html` → present + called.
Visual (harness): in the keyboard drawer the strip sits under the toolbar with sections lined up to the bar grid; dragging H-zoom grows/shrinks sections in lockstep with the grid; Play Sequence button gone; repeat in the drum drawer against its step grid; other tool views still show the strip below the header.

- [ ] **Step 7: Commit**

```bash
git add 1.310.html && git commit -m "feat(1.310): seq strip under toolbar in keyboard+drum drawers, grid-aligned + zoom-resize; hide Play Sequence"
```

## Task 15: Piano-roll fills to window bottom, reactive, resizable (T1)

**Files:** Modify: `1.310.html` (CSS/JS sizing for `.pr-panel` / `.pr-overlay`)

**Mobile guard:** Scope the fill-to-bottom sizing to the **desktop** `.pr-overlay` (mobile uses `mpr` inline/`mpr-pr-slot` sizing, which already overrides `.pr-panel` height). Gate any JS sizing behind the desktop check and/or use a desktop media query so the mobile PR height rules are untouched.

- [ ] **Step 1: Read current PR panel sizing**

Run: `grep -n "\.pr-panel {\|\.pr-overlay {\|prResizeBar\|maxHeight\|max-height" 1.310.html | head`
The panel has a `#prResizeBar` drag handle and a height/max-height. Identify how height is currently set (fixed px / vh / JS).

- [ ] **Step 2: Default height = down to viewport bottom**

Make `.pr-panel` default to fill from its top to the bottom of the window. Compute the available height = `window.innerHeight − panelTopOffset − transportBarHeight` (the bottom transport `1.1 BAR / REC / PLAY …` strip). Set this on load and **keep `#prResizeBar`** so the user can still drag it shorter. Prefer a JS sizing function (the layout is dynamic) over a static `vh` if the existing code already sizes in JS; otherwise a `height: calc(100vh − <stack>)` with a CSS var is acceptable.

- [ ] **Step 3: React to window resize**

Run: `grep -n "addEventListener('resize'\|window.onresize" 1.310.html | head`
Add (or extend) a `resize` handler to recompute the panel height (unless the user has manually resized it this session — respect a "user dragged" flag if `#prResizeBar` sets one; if not, full-height-on-resize is acceptable).

- [ ] **Step 4: Verify**

Visual (harness) at two window heights: the PR grid extends to just above the bottom transport bar at both sizes; the resize handle still shrinks it; no clipping of the lowest visible keys.

- [ ] **Step 5: Commit**

```bash
git add 1.310.html && git commit -m "feat(1.310): PR fills to window bottom, reactive to resize, still resizable"
```

## Task 16: Quick Chords overlay — default open, right-aligned clearing side tabs (T9)

**Files:** Modify: `1.310.html` (`#qcContainer` default state + position)

**Mobile guard:** Apply the default-open + right-aligned positioning only on **desktop** (`innerWidth >= 900`). Mobile has its own Quick Chords handling (`mprChordPalette` / mobile QC); do not auto-open or reposition the overlay on mobile.

- [ ] **Step 1: Read QC open/position logic**

Run: `grep -n "qcToggleView\|qcContainer\|qc-hidden\|qcMinimize\|_qcMinimized\|qc.*position\|qcRestorePos" 1.310.html | head`
`#qcContainer` starts with class `qc-hidden`. Find where it's shown/positioned and whether a saved position is restored.

- [ ] **Step 2: Default open when no saved state**

On PR open, if there is no saved QC open/closed state for the session, remove `qc-hidden` (open it). Respect an explicit user close within the session: set a session flag when the user closes (`qcToggleView`/`qc-float-close`), and don't auto-reopen while that flag is set.

- [ ] **Step 3: Right-align clearing the side tabs**

Position `#qcContainer` against the right edge with a margin that clears `#sideTabs` (the vertical tab rail, ~28–32px wide). E.g. default `right: 40px` (tabs width + gap), `top:` a sensible offset below the toolbar. Read the side-tab width from `.side-tabs` CSS and set the gap so the overlay never overlaps the tabs. If a saved position exists, honor it; otherwise use this right-aligned default.

- [ ] **Step 4: Verify**

Visual (harness): opening the PR shows Quick Chords open, docked to the right, fully clear of the LYRICS/TRACK/KEYS… tab rail; closing it and reopening the PR in the same session keeps it closed; it is distinct from the params-bar Keys 1-9 chips.

- [ ] **Step 5: Commit**

```bash
git add 1.310.html && git commit -m "feat(1.310): Quick Chords overlay default-open, right-aligned clear of side tabs"
```

---

# PHASE 4 — Verification

## Task 17: Full desktop verification pass

**Files:** none (verification only)

- [ ] **Step 1: Run the harness against `1.310.html`**

Use the **Verification Harness** appendix. Drive a desktop viewport (e.g. 1920×1080 and a shorter 1366×768) through: boot → guest → create+load song → open keyboard drawer (PR) → open drum drawer.

- [ ] **Step 2: Walk the acceptance checklist**

Confirm, capturing a screenshot for each:
- PR fills to bottom + resize handle works; grid full width (no Keys 1-9 gutter); Zoom label above H/V; Q-Flam gone.
- Floating keyboard: minimized default, C1–C6, order board→Pop-Out→Keyboard Voice, up triangle.
- Seq strip: under toolbar in keyboard + drum drawers, sections aligned, resize on H-zoom; Play Sequence hidden; section borders legible; below-header in other views.
- Quick Chords overlay: open, right-aligned, clears side tabs.
- Menu: About/MIDI/Theme gone, Quota hidden, Sign-In shown (guest), Song List gold.
- Header: Tutorial + Help hidden. Side tabs: first letter brightest.
- Voices: Bass Guitar / Violins / Analog Pad / Analog Lead select + play in both dropdowns.
- Quantize: off by default; select notes + tap Quantize snaps.
- Build badge reads 1.310.

- [ ] **Step 3: Mobile regression pass (mobile must be untouched)**

Re-run the harness with a **mobile viewport (390×844)** against `1.310.html` and the same flow (boot → guest → song → open keyboard/keys, drums). Capture screenshots and confirm the mobile UI is **visually and functionally identical to 1.309**:
- Mobile piano roll (`mpr`), mobile params rows, bottom nav, and mobile keyboard render as before.
- The sequence strip keeps its mobile placement (not relocated under a toolbar).
- Mobile menu opens; instrument selection works; the four new voices are selectable but nothing else in the mobile menu changed unexpectedly.
- No mobile-only layout shifted because of a desktop CSS/JS edit.
If anything differs from 1.309 on mobile, the owning task leaked — add a desktop guard and re-verify. (Optional: diff against a 1.309 mobile screenshot for confidence.)

- [ ] **Step 4: Record results**

Note any failures and loop back to the owning task. When all pass, report the harness output (desktop + mobile screenshots + console) to the user. **Do not** promote to `index.html` or push — that's a separate, user-approved deploy step.

---

## Appendix: Verification Harness

No test runner exists; drive the build with `playwright-core` + installed Chrome (per CLAUDE.md). Reusable bootstrap:

```js
// verify-1310.mjs — run: node verify-1310.mjs
import { chromium } from 'playwright-core';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
page.on('console', m => { const t = m.text(); if (!/permission-denied/.test(t)) console.log('[console]', t); });
await page.addInitScript(() => localStorage['drafthaus-eula-accepted'] = '1');
await page.goto('file://' + process.cwd() + '/1.310.html');
await page.waitForTimeout(1500);
await page.evaluate(() => signInAsGuest && signInAsGuest());
await page.waitForTimeout(1500);
await page.evaluate(() => _createAndLoadSong && _createAndLoadSong('verify-1310'));
await page.waitForTimeout(1000);
await page.evaluate(() => { const o = document.getElementById('pickFighterOverlay'); if (o) o.remove(); });
await page.evaluate(() => openSong && openSong(window._songCurrentId));
await page.waitForTimeout(1000);
// open tools as needed: navToolTap('keyboard'), navToolTap('sequencer'), arrOpen(), etc.
await page.screenshot({ path: 'verify-1310.png', fullPage: false });
await browser.close();
```

Adjust `viewport`, the opened tool, and the screenshot name per check. Guest-mode Firestore `permission-denied` console errors are expected and filtered above.
