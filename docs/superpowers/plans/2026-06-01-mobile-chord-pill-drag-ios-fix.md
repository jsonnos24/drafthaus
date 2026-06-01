# Fix Chord-Pill Drag on iPhone — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make chord-pill drag-to-staff work on iPhone Safari by suppressing the native text-selection + callout (magnifier) gesture that currently hijacks the touch.

**Architecture:** One CSS-only change to the `.ned-chip` rule in `index.html` (the mobile notation editor's Quick Chords chips). The existing `_nedChipDragStart` → `_nedShowGhost` → `_nedDropChordAt` pointer-event flow is left untouched; suppressing iOS selection/callout lets the pointer stream survive on iPhone exactly as it already does on desktop. Done in a `1.302.html` file-copy per the Drafthaus versioning workflow, promoted to `index.html` only after on-device confirmation.

**Tech Stack:** Vanilla HTML/CSS, single-file build. No test runner; headless regression via `scripts/ned-verify.mjs` (playwright-core + desktop Chrome); authoritative verification on iPhone Safari.

**Spec:** `docs/superpowers/specs/2026-06-01-mobile-chord-pill-drag-ios-fix-design.md`

---

### Task 1: Create the working copy

**Files:**
- Create: `1.302.html` (copy of `index.html`)

- [ ] **Step 1: Copy the current build to the next version number**

```bash
cd /Users/jasoncraig/Documents/Claude/Projects/Drafthaus
cp index.html 1.302.html
```

- [ ] **Step 2: Confirm the copy is byte-identical**

Run:
```bash
diff index.html 1.302.html && echo IDENTICAL
```
Expected: `IDENTICAL` (no diff output).

---

### Task 2: Add iOS selection/callout suppression to `.ned-chip`

**Files:**
- Modify: `1.302.html` (the `.ned-chip` CSS rule, currently near line 4851)

- [ ] **Step 1: Locate the exact rule**

Run:
```bash
grep -n '\.ned-chip {' 1.302.html
```
Expected: one match. The current rule is:
```css
.ned-chip { flex: 1; min-width: 0; text-align: center; padding: 7px 2px; font-size: 10px; border: 1px solid #2a2c36; background: transparent; font-family: inherit; touch-action: none; }
```
(Whitespace in the file is single-line; match it exactly when editing.)

- [ ] **Step 2: Add the four declarations after `touch-action:none;`**

Edit the rule so it reads (append the new properties inside the existing braces, keeping it on one line to match file style):
```css
.ned-chip { flex:1; min-width:0; text-align:center; padding:7px 2px; font-size:10px; border:1px solid #2a2c36; background:transparent; font-family:inherit; touch-action:none; user-select:none; -webkit-user-select:none; -webkit-touch-callout:none; -webkit-tap-highlight-color:transparent; }
```
Only `user-select`, `-webkit-user-select`, `-webkit-touch-callout`, and `-webkit-tap-highlight-color` are added — nothing else changes.

- [ ] **Step 3: Verify exactly one rule changed and the new properties are present**

Run:
```bash
grep -n 'webkit-touch-callout' 1.302.html
```
Expected: a match on the `.ned-chip` line (plus any pre-existing matches elsewhere, e.g. `.seq-chord-pill` — those are unrelated and untouched).

Run:
```bash
diff index.html 1.302.html
```
Expected: a single changed line — the `.ned-chip` rule. No other differences.

---

### Task 3: Headless desktop regression check

**Files:**
- Use: `scripts/ned-verify.mjs` (drives the build in desktop Chrome via playwright-core)

- [ ] **Step 1: Point the verify script at the working copy and run it**

`scripts/ned-verify.mjs` hardcodes its target at line 8 (`'..', '1.301.html'`). Temporarily point it at the working copy:
```bash
sed -i '' "s/'1\\.301\\.html'/'1.302.html'/" scripts/ned-verify.mjs
node scripts/ned-verify.mjs
```
Expected: script boots the app, opens the notation drawer, and the chord-chip drag/ghost/drop path works on desktop with no JS errors (Firestore `permission-denied` console noise in guest mode is expected and ignorable).

Revert the script edit afterward so it tracks the deployed build again (it's gitignored, but keep it pointing at `index.html`'s twin):
```bash
sed -i '' "s/'1\\.302\\.html'/'1.301.html'/" scripts/ned-verify.mjs
```
(If you prefer, update it to `'index.html'` permanently — your call; out of scope for this fix.)

- [ ] **Step 2: Confirm no desktop regression**

The CSS added is desktop-safe (`user-select:none` on a button is a no-op for drag; the `-webkit-*` props are mobile-only). Confirm the headless run still drops a chord on the staff. If the script has no built-in drag assertion, at minimum confirm it loads `1.302.html` without JS errors and the chips render.

---

### Task 4: On-device verification (authoritative — requires the user)

**This task cannot be completed headlessly. It is the real test.**

- [ ] **Step 1: Serve the working copy so the iPhone can reach it**

Options (pick one):
- Temporarily promote: `cp 1.302.html index.html` then push to a preview — **do not** do this without user OK (pushing `main` deploys `drafthaus.ca`).
- Local serve over LAN: `python3 -m http.server 8000` in the project dir, open `http://<mac-LAN-ip>:8000/1.302.html` on the iPhone.

Default: local serve, so nothing deploys before confirmation.

- [ ] **Step 2: User tests on iPhone Safari**

Open the notation drawer → Quick Chords. Press-and-hold a chord chip and drag toward the staff. Confirm all three:
1. **No** text-selection box appears around the chip.
2. **No** magnifier/loupe pops up.
3. The drag **ghost** follows the finger, and releasing over the staff **drops** the chord (and previews its sound).

- [ ] **Step 3: Record the result**

If all three pass → proceed to Task 5.
If the loupe still appears on some iOS version → implement the reserved JS fallback from the spec (`preventDefault()` on `selectstart`/`contextmenu` on the chip during `_nedChipDragStart`), then re-test. Do not promote until all three pass.

---

### Task 5: Promote and push (only after user confirms on-device)

**Files:**
- Modify: `index.html` (overwrite with `1.302.html`)

- [ ] **Step 1: Promote the verified build**

```bash
cp 1.302.html index.html
```

- [ ] **Step 2: Confirm promotion is exact**

```bash
diff 1.302.html index.html && echo PROMOTED
```
Expected: `PROMOTED`.

- [ ] **Step 3: Commit**

```bash
git add index.html 1.302.html
git commit -m "fix(ned): chord-pill drag works on iPhone (suppress iOS selection/callout on .ned-chip)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

- [ ] **Step 4: Push (deploys drafthaus.ca — requires explicit user go-ahead)**

```bash
git push origin main
```
Per the Drafthaus workflow, **confirm with the user before pushing** — pushing `main` deploys the live site.

---

## Self-Review

**Spec coverage:**
- Root cause / CSS change → Task 2. ✓
- No JS changes (desktop untouched) → Task 2 changes only CSS; Task 3 guards regression. ✓
- Fallback reserved, not implemented unless needed → Task 4 Step 3. ✓
- On-device verification authoritative; headless is regression-only → Tasks 3 & 4. ✓
- Versioning: edit in `1.302.html`, promote/push only after iPhone confirmation → Tasks 1 & 5. ✓

**Placeholder scan:** No TBD/TODO; the only conditional work (JS fallback) is fully specified by reference to the spec and gated on a concrete test result. ✓

**Type/name consistency:** Function names (`_nedChipDragStart`, `_nedShowGhost`, `_nedDropChordAt`), file names (`1.302.html`, `index.html`), and the CSS selector (`.ned-chip`) are used consistently throughout. ✓
