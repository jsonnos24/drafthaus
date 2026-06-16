# Recording Toast Anchor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the 8 recording-flow toasts appear anchored to the left of the red record button (`#recBtn`) instead of bottom-center, in Drafthaus Lite.

**Architecture:** Reuse the single global `#toast` element. Add a `.toast.rec-anchor` CSS variant whose `top`/`right` are set inline at show-time by measuring `#recBtn.getBoundingClientRect()`. A new `recToast(msg, ms)` wrapper drives it, with a bottom-center fallback if the button is missing. `toast()` resets the variant so ordinary toasts stay bottom-center. Convert the 8 recording call sites to `recToast`.

**Tech Stack:** Single-file vanilla JS + CSS in `index.html` (Drafthaus Lite). No build step, no test runner — verify by driving the app with `playwright-core` against the installed Chrome.

**Spec:** `docs/superpowers/specs/2026-06-16-recording-toast-anchor-design.md`

---

## Important conventions (read first)

- **File of record:** All edits happen in the new copy `lite-1.061.html`, created in Task 0
  from `index.html`. On the final milestone step, `lite-1.061.html` is promoted into
  `index.html` (root). Until then, do NOT edit `index.html` directly.
- **Do not touch** `full.html` or any `1.3xx.html` (those are the separate full app).
- **Line numbers drift** in this ~big file — locate code by the quoted strings given,
  not by line number.
- **No test runner.** "Verify" steps mean: grep for the expected string, and/or drive the
  app headlessly (recipe in Task 6).
- **Do not push.** Pushing deploys via GitHub Pages. Pushing is a separate, user-confirmed
  step at the very end (Task 7), not part of any commit step.

---

### Task 0: Create the working copy

**Files:**
- Create: `lite-1.061.html` (copy of `index.html`)

- [ ] **Step 1: Confirm the base is what we expect**

Run:
```bash
md5 -q index.html lite-1.060.html
```
Expected: the two hashes are **identical** (index.html is byte-for-byte lite-1.060).
If they differ, STOP and ask — the base has drifted.

- [ ] **Step 2: Make the copy**

Run:
```bash
cp index.html lite-1.061.html
```

- [ ] **Step 3: Verify the copy is identical to the source**

Run:
```bash
md5 -q index.html lite-1.061.html
```
Expected: both hashes identical (the copy matched the source exactly).

- [ ] **Step 4: Commit**

```bash
git add lite-1.061.html
git commit -m "chore(lite-1.061): branch working copy from lite-1.060"
```

---

### Task 1: Add the `.toast.rec-anchor` CSS variant

**Files:**
- Modify: `lite-1.061.html` — the toast CSS block (locate by string `#toast.center.show`)

- [ ] **Step 1: Add the variant rules**

Find this block (around the toast CSS):
```css
#toast.center { top: 50%; bottom: auto; transform: translate(-50%, calc(-50% + 20px)); }
#toast.center.show { transform: translate(-50%, -50%); }
```

Insert immediately after `#toast.center.show { ... }`:
```css
#toast.rec-anchor { left: auto; bottom: auto; right: auto; max-width: calc(100vw - 80px);
  white-space: normal; transform: translate(8px, -50%); }
#toast.rec-anchor.show { transform: translate(0, -50%); }
```

Rationale: cancels the bottom-center `left:50%` centering, vertically centers via
`translateY(-50%)`, and gives a small slide-in offset (`8px`) that the existing
`transition` animates. `top` and `right` are set inline by `recToast()` in Task 3.
`max-width` + `white-space: normal` lets long error text wrap instead of overflowing the
left edge on narrow phones.

- [ ] **Step 2: Verify the rules are present**

Run:
```bash
grep -n "rec-anchor" lite-1.061.html
```
Expected: 2 matching lines (the base rule and the `.show` rule).

- [ ] **Step 3: Commit**

```bash
git add lite-1.061.html
git commit -m "feat(lite-1.061): add .toast.rec-anchor positioning variant"
```

---

### Task 2: Make `toast()` reset the variant on every normal call

**Files:**
- Modify: `lite-1.061.html` — the `toast` function (locate by string `function toast(msg, ms, center)`)

This guarantees that a recording toast followed by an ordinary toast returns cleanly to
bottom-center (single shared element — leftover state must not leak).

- [ ] **Step 1: Update the function body**

Find:
```javascript
function toast(msg, ms, center) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.toggle('center', !!center); t.classList.add('show');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => t.classList.remove('show'), ms || 1800);
}
```

Replace with:
```javascript
function toast(msg, ms, center) {
  const t = document.getElementById('toast');
  t.classList.remove('rec-anchor'); t.style.top = ''; t.style.right = '';
  t.textContent = msg; t.classList.toggle('center', !!center); t.classList.add('show');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => t.classList.remove('show'), ms || 1800);
}
```

Only the second line is new: it strips the `rec-anchor` class and clears the inline
`top`/`right` before every ordinary toast.

- [ ] **Step 2: Verify**

Run:
```bash
grep -n "classList.remove('rec-anchor'); t.style.top" lite-1.061.html
```
Expected: 1 matching line.

- [ ] **Step 3: Commit**

```bash
git add lite-1.061.html
git commit -m "feat(lite-1.061): toast() resets rec-anchor variant on normal calls"
```

---

### Task 3: Add the `recToast(msg, ms)` wrapper

**Files:**
- Modify: `lite-1.061.html` — immediately after the `toast` function (locate by the closing of `function toast`)

- [ ] **Step 1: Add the wrapper**

Insert immediately after the `toast(msg, ms, center)` function's closing `}` (the one
edited in Task 2):

```javascript
function recToast(msg, ms) {
  const btn = document.getElementById('recBtn');
  const r = btn && btn.getBoundingClientRect();
  if (!r || (r.width === 0 && r.height === 0) || r.bottom < 0 || r.top > window.innerHeight) {
    return toast(msg, ms); // fallback: button missing/off-screen -> bottom-center
  }
  const t = document.getElementById('toast');
  t.classList.remove('center');
  t.textContent = msg;
  t.style.top = (r.top + r.height / 2) + 'px';
  t.style.right = (window.innerWidth - r.left + 10) + 'px';
  t.classList.add('rec-anchor', 'show');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => t.classList.remove('show'), ms || 1800);
}
```

Notes:
- `right = innerWidth - r.left + 10` puts the pill's right edge 10px to the left of the
  button's left edge.
- `top = r.top + r.height/2` plus the variant's `translateY(-50%)` (Task 1) centers the
  pill vertically on the button.
- Mirrors `toast()`'s `clearTimeout`/auto-hide mechanics and default 1800ms.

- [ ] **Step 2: Verify**

Run:
```bash
grep -n "function recToast" lite-1.061.html
```
Expected: 1 matching line.

- [ ] **Step 3: Commit**

```bash
git add lite-1.061.html
git commit -m "feat(lite-1.061): add recToast() anchored-to-record-button helper"
```

---

### Task 4: Convert the 8 recording call sites to `recToast`

**Files:**
- Modify: `lite-1.061.html` — in `startRecord`, `onRecStop`, `uploadTake`

Convert each of these `toast(...)` calls to `recToast(...)`, preserving the exact
arguments. Use the quoted strings to locate them (line numbers will have drifted after
Tasks 1–3).

- [ ] **Step 1: Convert the calls**

| Locate by string | Change |
|---|---|
| `toast('Microphone blocked — allow mic access')` | → `recToast('Microphone blocked — allow mic access')` |
| `toast('Recording not supported here')` | → `recToast('Recording not supported here')` |
| `toast('Too short')` | → `recToast('Too short')` |
| `toast('Not signed in')` (the one inside `uploadTake`) | → `recToast('Not signed in')` |
| `toast(liteCapMessage(), 3200)` | → `recToast(liteCapMessage(), 3200)` |
| `toast('Saving take…', 1500)` | → `recToast('Saving take…', 1500)` |
| `toast('Take saved ✓')` | → `recToast('Take saved ✓')` |
| `toast('Save failed — check connection')` | → `recToast('Save failed — check connection')` |

⚠️ `'Not signed in'` also appears elsewhere (the waveform-replace path at the
`function ... replace` block near `toast('Not signed in')`). Only convert the one inside
`uploadTake` (the function containing `Saving take…`). Leave the waveform-editor one as
`toast(...)`.

- [ ] **Step 2: Verify all 8 converted and none missed**

Run:
```bash
grep -n "recToast(" lite-1.061.html
```
Expected: 9 lines total — the `function recToast` definition (Task 3) + the 8 call sites.

Run:
```bash
grep -nE "toast\('(Microphone blocked|Recording not supported|Too short|Take saved|Save failed|Saving take)" lite-1.061.html
```
Expected: **no output** (every recording-specific message now uses `recToast`, so no bare
`toast(` remains for these strings).

- [ ] **Step 3: Commit**

```bash
git add lite-1.061.html
git commit -m "feat(lite-1.061): recording toasts anchor left of the record button"
```

---

### Task 5: Bump the in-app version label (if present)

**Files:**
- Modify: `lite-1.061.html` — version string

- [ ] **Step 1: Find the version label**

Run:
```bash
grep -niE "1\.060|lite-1\.060|v1\.060|>1\.060<" lite-1.061.html
```

- [ ] **Step 2: Update it**

If a user-visible version label / build comment referencing `1.060` exists, update the
occurrence(s) to `1.061`. If grep returns no results, skip this task (no label to bump).

- [ ] **Step 3: Verify**

Run:
```bash
grep -niE "1\.061" lite-1.061.html
```
Expected: matches if a label existed; otherwise this task was a no-op (fine).

- [ ] **Step 4: Commit (only if something changed)**

```bash
git add lite-1.061.html
git commit -m "chore(lite-1.061): bump version label to 1.061"
```

---

### Task 6: Headless browser verification

**Files:**
- Create (temporary): `_verify_rec_toast.js` (delete after; do not commit)

- [ ] **Step 1: Write the verification script**

Create `_verify_rec_toast.js`:
```javascript
const { chromium } = require('playwright-core');
const path = require('path');
(async () => {
  const browser = await chromium.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  });
  const page = await browser.newPage({ viewport: { width: 414, height: 896 } });
  await page.addInitScript(() => localStorage['drafthaus-eula-accepted'] = '1');
  await page.goto('file://' + path.resolve('lite-1.061.html'));
  await page.waitForTimeout(1500);

  // Drive into a song editor however Lite reaches it (guest sign-in + create/open song).
  // Adapt these calls to the real Lite boot fns if names differ; the goal is: rail visible.
  await page.evaluate(() => window.signInAsGuest && window.signInAsGuest()).catch(() => {});
  await page.waitForTimeout(1500);

  const hasBtn = await page.evaluate(() => !!document.getElementById('recBtn'));
  console.log('recBtn present:', hasBtn);

  // Fire an anchored recording toast directly and read back its geometry.
  const res = await page.evaluate(() => {
    if (typeof recToast !== 'function') return { err: 'recToast missing' };
    recToast('Take saved ✓');
    const t = document.getElementById('toast');
    const btn = document.getElementById('recBtn');
    const tr = t.getBoundingClientRect();
    const br = btn ? btn.getBoundingClientRect() : null;
    return {
      hasAnchorClass: t.classList.contains('rec-anchor'),
      showing: t.classList.contains('show'),
      text: t.textContent,
      toastRight: tr.right, btnLeft: br && br.left,
      toastVCenter: tr.top + tr.height / 2, btnVCenter: br && (br.top + br.height / 2),
    };
  });
  console.log(JSON.stringify(res, null, 2));

  // Assertions
  const ok =
    res.hasAnchorClass === true &&
    res.showing === true &&
    res.text === 'Take saved ✓' &&
    res.btnLeft != null &&
    res.toastRight <= res.btnLeft + 1 &&            // pill sits left of the button
    Math.abs(res.toastVCenter - res.btnVCenter) <= 2; // vertically centered on button
  console.log('ANCHOR OK:', ok);

  // A normal toast must return to bottom-center (no rec-anchor class).
  const norm = await page.evaluate(() => {
    toast('Key: C');
    const t = document.getElementById('toast');
    return { hasAnchor: t.classList.contains('rec-anchor'), top: t.style.top, right: t.style.right };
  });
  console.log('NORMAL RESET OK:', norm.hasAnchor === false && !norm.top && !norm.right, JSON.stringify(norm));

  await browser.close();
  process.exit(ok ? 0 : 1);
})();
```

- [ ] **Step 2: Run it**

Run:
```bash
node _verify_rec_toast.js
```
Expected output includes:
- `recBtn present: true`
- `ANCHOR OK: true`
- `NORMAL RESET OK: true`

If `recBtn present: false`, the guest/song-open boot path differs — adjust the driving
calls (see CLAUDE.md "Verifying changes" recipe: `signInAsGuest()` →
`_createAndLoadSong(title)` → remove `#pickFighterOverlay` → `openSong(_songCurrentId)`)
until the rail and `#recBtn` are on screen, then re-run.

- [ ] **Step 3: Clean up the temp script**

Run:
```bash
rm _verify_rec_toast.js
```
(Do not commit the verification script.)

- [ ] **Step 4: Manual on-device QA note**

Per the Lite workflow, the red record button and rail are confirmed visually on a real
iPhone in Task 7 after promotion — automated headless covers geometry only.

---

### Task 7: Promote to `index.html` and hand off for push (USER-CONFIRMED)

**Files:**
- Modify: `index.html` (overwrite from `lite-1.061.html`)

- [ ] **Step 1: Promote the build into the root**

Run:
```bash
cp lite-1.061.html index.html
```

- [ ] **Step 2: Verify the promotion is exact**

Run:
```bash
md5 -q index.html lite-1.061.html
```
Expected: identical hashes.

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "feat(lite-1.061): promote recording-toast-anchor build to root (index.html)"
```

- [ ] **Step 4: STOP — confirm before pushing**

Do NOT `git push`. Pushing deploys via GitHub Pages (live at `drafthaus.ca`). Report
that the build is committed on `main` and ask the user to confirm the push. After the
user confirms and the deploy is live, they perform on-device iPhone QA of the anchored
recording toasts.

---

## Self-review (performed during planning)

- **Spec coverage:** CSS variant (Task 1) ✓; `toast()` reset §3 (Task 2) ✓; `recToast`
  wrapper + fallback §2 (Task 3) ✓; 8 call-site conversions §4 (Task 4) ✓; out-of-scope
  waveform-replace `'Not signed in'` explicitly excluded (Task 4 warning) ✓; verification
  §Verification (Task 6) ✓; versioning/promote/confirm-before-push (Tasks 0, 7) ✓.
- **Placeholder scan:** none — every code/CSS step shows full content; Task 5 is a
  conditional no-op with an explicit skip rule.
- **Type/name consistency:** `recToast`, `rec-anchor`, `#recBtn`, `#toast`, `_toastTimer`
  used identically across Tasks 1–4 and the verify script in Task 6.
```
