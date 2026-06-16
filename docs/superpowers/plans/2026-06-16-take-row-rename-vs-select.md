# Take-row Rename vs. Select Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make tapping a take row anywhere select it (load + show waveform), and move renaming to a dedicated ✎ button — fixing the desktop "empty space renames" bug and the cramped mobile title/loop spacing.

**Architecture:** Single-file vanilla-JS app. Edit the `_takeRow()` template string, add one Feather-style SVG constant, and add a small CSS block. Reuse the existing `startRename`/`selectTake`/`commitRename` functions unchanged. Ships as a new file-copy snapshot `lite-1.062.html` promoted into `index.html`.

**Tech Stack:** Vanilla JS + HTML + CSS in one file (`index.html`); headless verification via `playwright-core` against installed Chrome over a local HTTP server.

## Global Constraints

- **File isolation:** Touch only `index.html` (Lite root) and the new `lite-1.062.html` snapshot + a new `_verify_lite_1062.js`. Never touch `full.html` / `1.3xx.html` / other `lite-*.html`.
- **Versioning:** File-copy snapshot (`cp index.html lite-1.062.html`), edit, verify, then promote into `index.html` by copy. Commit to `main`. Do NOT push until the user asks (push = GitHub Pages deploy).
- **Shared-data contract:** No changes to Firestore/Storage, the `voice_takes` schema, or rename logic. Markup + CSS + one SVG const only.
- **Verification reality:** No unit-test runner. The "test" is a Node + `playwright-core` script driven over real HTTP (not `file://`), using the Lite headless recipe (EULA bypass, `signInAsGuest()`, song load) and `stopTakesListener()` before injecting `_takes`. Run ONCE to a file and parse (anon-auth rate-limits on repeated guest sign-ins).
- **Icon style:** New SVG must match `LOOP_SVG`/`TRASH_SVG` exactly: `viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"`.

---

### Task 1: Code change — ✎ rename button + whole-card select

**Files:**
- Create: `lite-1.062.html` (copy of current `index.html`)
- Modify: `lite-1.062.html` — `PENCIL_SVG` const (≈ line 1425, beside `LOOP_SVG`), `_takeRow()` (≈ line 1465), `.take-card` CSS (≈ line 360) + the `@media (hover: hover) and (pointer: fine)` block (≈ line 266 or 351).

**Interfaces:**
- Consumes (existing, unchanged): `startRename(id, el, ev)` — `el` is the `.nm` element to make contenteditable; already calls `ev.stopPropagation()`. `selectTake(id)` — the `.take-card` onclick. `LOOP_SVG`, `TRASH_SVG` constants.
- Produces: `PENCIL_SVG` constant; `.take-edit` button rendered in every take row between `.meta` and `.loop`.

- [ ] **Step 1: Create the snapshot**

```bash
cp index.html lite-1.062.html
# Confirm it is a byte-identical starting point:
md5 index.html lite-1.062.html   # both hashes must match
```

- [ ] **Step 2: Add the `PENCIL_SVG` constant**

In `lite-1.062.html`, immediately after the `const LOOP_SVG = '...';` line (≈ 1425), add:

```js
const PENCIL_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path></svg>';
```

- [ ] **Step 3: Edit `_takeRow()` — remove title rename, add ✎ button**

In `_takeRow()`, change the `.nm` line FROM:

```js
          <div class="nm" onclick="startRename('${t.id}',this,event)">${esc(takeDisplayName(t, true))}</div>
```

TO (drop the onclick — the title is now part of the card's select):

```js
          <div class="nm">${esc(takeDisplayName(t, true))}</div>
```

Then, on the line with the loop button, insert the ✎ button immediately BEFORE it. FROM:

```js
        <button class="loop ${looping ? 'on' : ''}" onclick="toggleLoop('${t.id}',event)" aria-label="Loop">${LOOP_SVG}</button>
```

TO:

```js
        <button class="take-edit" onclick="startRename('${t.id}', this.closest('.take-card').querySelector('.nm'), event)" title="Rename take" aria-label="Rename take">${PENCIL_SVG}</button>
        <button class="loop ${looping ? 'on' : ''}" onclick="toggleLoop('${t.id}',event)" aria-label="Loop">${LOOP_SVG}</button>
```

- [ ] **Step 4: Add the `.take-edit` CSS**

After the `.take-card .loop svg { ... }` rule (≈ line 362), add:

```css
.take-card .take-edit { width: 30px; height: 30px; display: flex; align-items: center; justify-content: center; color: var(--text-3); flex: none; }
.take-card .take-edit svg { width: 18px; height: 18px; }
```

- [ ] **Step 5: Add the desktop hover tint**

Inside the existing `@media (hover: hover) and (pointer: fine) { ... }` block that contains `.take-del-desktop:hover { color: var(--red); }` (≈ line 266), add a sibling rule:

```css
  .take-card .take-edit:hover { color: var(--tint); }
```

- [ ] **Step 6: Sanity-check the edits**

```bash
grep -n "PENCIL_SVG" lite-1.062.html        # expect 2 hits: the const + the _takeRow use
grep -n 'class="take-edit"' lite-1.062.html  # expect 1 hit (in _takeRow)
grep -n 'class="nm"[^>]*onclick' lite-1.062.html  # expect NO hits (title onclick removed)
```
Expected: PENCIL_SVG twice, `take-edit` once, the third grep empty.

- [ ] **Step 7: Commit**

```bash
git add lite-1.062.html
git commit -m "feat(lite-1.062): dedicated ✎ rename button; whole take card selects

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Headless verification

**Files:**
- Create: `_verify_lite_1062.js`

**Interfaces:**
- Consumes: `lite-1.062.html` served over local HTTP; app globals `signInAsGuest`, `_createAndLoadSong`, `_songCurrentId`, `openSong`, `toggleTakes`, `stopTakesListener`, `renderTakes`, `_takes`, `selectTake`, `_loadedTakeId`, `startRename`, `commitRename`, `db`.
- Produces: a pass/fail report printed to stdout.

- [ ] **Step 1: Write the verification script**

Create `_verify_lite_1062.js`. Mirror the existing `_verify_lite_1061.js` boot/bypass scaffolding (start a static HTTP server on the repo root, launch installed Chrome via `playwright-core` `executablePath`, `addInitScript` to set `localStorage['drafthaus-eula-accepted']='1'`, load `http://localhost:<port>/lite-1.062.html`, `signInAsGuest()`, `_createAndLoadSong('verify-1062')`, remove `#pickFighterOverlay`, `openSong(_songCurrentId)`). Then inject takes and assert. Core assertions (adapt the harness lines to match 1061's exact helper names):

```js
// open the takes panel and inject two takes (one pinned, one not)
await page.evaluate(() => {
  stopTakesListener();                       // stop the live snapshot clobbering injected takes
  _takes = [
    { id: 'tk_pin', name: 'Pinned take', duration: 12, pinned: true,  pinOrder: 0, mimeType: 'audio/mp3',  bytes: 1200000 },
    { id: 'tk_rest', name: 'Verse idea 2', duration: 31, pinned: false,                mimeType: 'audio/webm', bytes: 2000000 },
  ];
  if (typeof toggleTakes === 'function') toggleTakes();  // ensure panel open
  renderTakes();
});

const results = [];
const ok = (name, cond) => results.push((cond ? 'PASS ' : 'FAIL ') + name);

// 1. Every row has exactly one .take-edit, ordered immediately before .loop
const order = await page.evaluate(() => [...document.querySelectorAll('.take-card')].map(card => {
  const kids = [...card.children];
  const e = kids.findIndex(k => k.classList.contains('take-edit'));
  const l = kids.findIndex(k => k.classList.contains('loop'));
  return { hasEdit: e !== -1, hasLoop: l !== -1, editBeforeLoop: e !== -1 && l !== -1 && e === l - 1 };
}));
ok('two rows rendered (pinned + rest)', order.length === 2);
ok('each row has a .take-edit', order.every(o => o.hasEdit));
ok('.take-edit immediately precedes .loop in every row', order.every(o => o.editBeforeLoop));

// 2. Title no longer carries a rename onclick
const titleHasOnclick = await page.evaluate(() =>
  [...document.querySelectorAll('.take-card .nm')].some(n => n.hasAttribute('onclick')));
ok('title (.nm) has no onclick', titleHasOnclick === false);

// 3. Tapping the card body selects (load + waveform host), NOT the .take-edit
await page.evaluate(() => { _loadedTakeId = null; });
await page.click('.take-card[data-id] .meta .nm');  // tapping the title selects now
const afterTitleTap = await page.evaluate(() => ({
  loaded: _loadedTakeId,
  renaming: !!document.querySelector('.take-card .nm[contenteditable]'),
}));
ok('tapping title selects a take', !!afterTitleTap.loaded);
ok('tapping title does NOT enter rename', afterTitleTap.renaming === false);
ok('selected row shows a .take-wave host', await page.evaluate(() => !!document.querySelector('.take-row .take-wave')));

// 4. Clicking .take-edit enters contenteditable rename
await page.evaluate(() => { db.collection = () => ({ doc: () => ({ set: async () => {} }) }); }); // stub Firestore write
await page.click('.take-card .take-edit');
ok('clicking ✎ enters contenteditable rename', await page.evaluate(() =>
  !!document.querySelector('.take-card .nm[contenteditable="true"]')));

console.log(results.join('\n'));
console.log(results.filter(r => r.startsWith('PASS')).length + ' PASS / ' + results.filter(r => r.startsWith('FAIL')).length + ' FAIL');
```

> Note for the implementer: open `_verify_lite_1061.js` first and copy its exact server/launch/bypass preamble and its real helper names (e.g. the guest sign-in retry `guestIn()` if present) rather than guessing — only the assertion block above is new. Disable CSS transitions in-test if any timing-sensitive geometry read is added.

- [ ] **Step 2: Run the verification once and capture output**

```bash
node _verify_lite_1062.js | tee /tmp/v1062.txt
```
Expected: the final line reads `8 PASS / 0 FAIL` (count may differ slightly if you split/merge asserts — every line must say PASS, zero FAIL).

- [ ] **Step 3: If any assert fails, fix `lite-1.062.html` and re-run**

Fix the markup/CSS in `lite-1.062.html` (not the test, unless the test's helper names are wrong). Re-run Step 2 ONCE. Do not loop the verify repeatedly (anon-auth rate-limit).

- [ ] **Step 4: Commit the verify script**

```bash
git add _verify_lite_1062.js
git commit -m "test(lite-1.062): headless verify ✎ rename button + whole-card select

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Promote into `index.html`

**Files:**
- Modify: `index.html` (becomes byte-identical to `lite-1.062.html`)

- [ ] **Step 1: Promote**

```bash
cp lite-1.062.html index.html
md5 index.html lite-1.062.html   # both hashes must match
```

- [ ] **Step 2: Commit**

```bash
git add index.html
git commit -m "feat(lite-1.062): promote ✎-rename build to root (index.html)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

- [ ] **Step 3: Update memory + report**

Append a `1.062` bullet to `drafthaus-lite.md` (dedicated ✎ rename button; whole take card selects; headless-verified; awaiting on-device sign-off + the standing on-device QA backlog). Update the `MEMORY.md` pointer's "pushed/live" tail. Then tell the user the build is committed locally and ask whether to push (Pages deploy) — do NOT push unprompted.

---

## Notes for the executor

- On-device sign-off (post-push) is the real acceptance gate: iPhone Safari — tap card = waveform, tap ✎ = inline rename with keyboard, no accidental renames from empty space, comfortable spacing beside ↻.
- The full on-device QA backlog from 1.045–1.061 (anchored toasts, storage caps) is still open and unrelated to this change.
