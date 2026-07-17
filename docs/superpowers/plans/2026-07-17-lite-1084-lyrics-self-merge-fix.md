# Lite 1.084 — Same-Device Lyrics Self-Merge Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop Drafthaus Lite from merging a device's own lyrics with themselves (duplicate text + "—— Also edited on another device ——" divider + toast) after a phone call / home-screen backgrounding.

**Architecture:** Three surgical changes inside the existing `_lyrics*` block of the single-file app: (1) content-equality guards at all three merge sites (`flushLyrics` transaction, `liteLyricsDrain` transaction, `liteFreshenSong` else-branch), (2) an in-flight-flush promise (`_lyricsFlushP`) that `liteFreshenSong` awaits before judging, (3) a `snap.metadata.fromCache` bail in `liteFreshenSong`. No schema/field/rule changes.

**Tech Stack:** Vanilla JS single-file HTML app (`lite-1.084.html`), Firebase Firestore (compat SDK), verified headlessly with `playwright-core` + installed Chrome (no test runner).

**Spec:** `docs/superpowers/specs/2026-07-17-lite-lyrics-self-merge-fix-design.md`

## Global Constraints

- This is **Drafthaus Lite** work: touch only `lite-1.084.html` and `_verify_lite_1084.js`. Never touch `full.html`, `1.3xx.html`, or `index.html` (promotion to root happens only after user sign-off, outside this plan).
- Versioning is whole-file copy: `lite-1.084.html` is branched from `lite-1.083.html` (== live root, verified by md5 in Task 1). Diff every fresh `cp` against its source before editing.
- Work lands directly on `main`. **Commit freely, but NEVER `git push`** — pushing deploys via GitHub Pages and requires explicit user confirmation.
- The app file is large — locate code by searching quoted strings/function names, never by line number.
- Genuine cross-device merge behavior (divider + toast on truly divergent content) must be preserved — the verify suite asserts this.
- No new Firestore fields, no security-rule changes, no wording changes to toast/divider.
- Test-harness ground rules (from project memory): app top-level `let` vars are NOT `window` props — stub them by bare-name assignment inside `page.evaluate`; top-level `function` declarations ARE `window` props. `db` is a top-level binding holding an object — stub its **methods** (`db.runTransaction = ...`), never reassign `db` itself. Never stub `navigator.onLine`.
- Chrome path for headless runs: `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome` via `playwright-core` (no browser download).

---

### Task 1: Branch lite-1.084.html from lite-1.083.html

**Files:**
- Create: `lite-1.084.html` (byte-copy of `lite-1.083.html`)

**Interfaces:**
- Produces: `lite-1.084.html`, the file every later task edits.

- [ ] **Step 1: Verify the true base (base-drift trap)**

Run:
```bash
cd /Users/jasoncraig/Documents/Claude/Projects/Drafthaus
md5 -q index.html lite-1.083.html
```
Expected: two **identical** hashes (`991549b262eee7a3a4bbd9972fcd1aa1` as of plan-writing). If they differ, STOP — the live root has drifted; find the true base by md5-ing `index.html` against all `lite-1.0xx.html` files and report to the user before proceeding.

- [ ] **Step 2: Copy and confirm the copy**

Run:
```bash
cp lite-1.083.html lite-1.084.html
diff lite-1.083.html lite-1.084.html && echo COPY-OK
```
Expected: `COPY-OK` (no diff output).

- [ ] **Step 3: Commit**

```bash
git add lite-1.084.html
git commit -m "chore(lite-1.084): branch from lite-1.083 (== live root)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: flushLyrics — equality guard + in-flight promise (`_lyricsFlushP`)

**Files:**
- Modify: `lite-1.084.html` — the `let _lyricsBase = '';` declaration and the `flushLyrics` function (locate by searching `let _lyricsBase` and `async function flushLyrics`)
- Create: `_verify_lite_1084.js`

**Interfaces:**
- Consumes: existing `currentEditorHtml()`, `_ilCommitDoc()`, `_lyricsDivider()`, `dhPendingLyricsPut()`, `toast()` — all unchanged.
- Produces: module var `_lyricsFlushP` (Promise|null — non-null exactly while a flush is in flight; the flush promise never rejects). `flushLyrics()` stays the public entry point (same name — inline `onblur="flushLyrics()"` and all existing callers keep working) and now returns that promise. The async body moves to a new private `_flushLyricsNow()`. Task 3's `liteFreshenSong` awaits `_lyricsFlushP`.

- [ ] **Step 1: Write the verify suite with the flush tests (failing)**

Create `_verify_lite_1084.js` with exactly:

```js
// _verify_lite_1084.js — lite-1.084: same-device lyrics self-merge fix
// (equality guards at the 3 merge sites + _lyricsFlushP flush/freshen coordination + fromCache bail)
const { chromium } = require('playwright-core');
const http = require('http'); const fs = require('fs'); const path = require('path');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ROOT = __dirname;
let PASS = 0, FAIL = 0;
const ok = (c, m) => { if (c) { PASS++; console.log('PASS', m); } else { FAIL++; console.log('FAIL', m); } };

function serve() {
  return new Promise(res => {
    const s = http.createServer((req, rq) => {
      let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/lite-1.084.html';
      const fp = path.join(ROOT, p);
      fs.readFile(fp, (e, d) => {
        if (e) { rq.statusCode = 404; rq.end('nf'); return; }
        const ext = path.extname(fp);
        rq.setHeader('Content-Type', ext === '.html' ? 'text/html' : ext === '.js' ? 'text/javascript' : 'application/octet-stream');
        rq.end(d);
      });
    });
    s.listen(0, () => res(s));
  });
}

// Boot a page to the signed-in song screen: guest sign-in, then createSong()
// (fire-and-forget Firestore write — works in guest mode; permission noise is expected).
async function boot(ctx, port) {
  const page = await ctx.newPage();
  await page.goto(`http://localhost:${port}/lite-1.084.html`, { waitUntil: 'domcontentloaded' });
  await page.click('.auth-btn.ghost');
  await page.waitForSelector('body.signed-in', { timeout: 15000 });
  await page.evaluate(() => createSong());
  await page.waitForSelector('#screen-song.active', { timeout: 5000 });
  return page;
}

// Page-side helpers: toast spy + Firestore stubs. db is a top-level binding holding an
// object — stub its METHODS; never reassign db itself. toast is a top-level function
// declaration, so bare reassignment replaces it globally.
const PAGE_HELPERS = () => {
  window._toasts = [];
  toast = (msg) => { window._toasts.push(String(msg)); };
  window.stubFS = (serverDoc, opts = {}) => {
    window._txWrites = [];
    db.runTransaction = async (fn) => {
      if (opts.delayMs) await new Promise(r => setTimeout(r, opts.delayMs));
      return await fn({
        get: async () => ({ exists: true, data: () => ({ lyricsDoc: serverDoc }) }),
        set: (ref, data) => { window._txWrites.push(data); },
      });
    };
    const snap = { exists: true, metadata: { fromCache: !!opts.fromCache }, data: () => ({ lyricsDoc: serverDoc }) };
    db.collection = () => ({
      doc: () => ({ get: async () => snap, set: async () => {}, update: async () => {} }),
      where: () => ({ orderBy: () => ({ onSnapshot: () => () => {} }), onSnapshot: () => () => {} }),
    });
  };
};

(async () => {
  const src = fs.readFileSync(path.join(ROOT, 'lite-1.084.html'), 'utf8');

  const srv = await serve(); const port = srv.address().port;
  const browser = await chromium.launch({
    executablePath: CHROME, headless: true,
    args: ['--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
  });
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 } });
  await ctx.addInitScript(() => { try { localStorage['drafthaus-eula-accepted'] = '1'; } catch (e) {} });
  const page = await boot(ctx, port);
  await page.evaluate(PAGE_HELPERS);

  const DOC = '<div>hold on tight, the night is young</div>';
  const OLD = '<div>old base</div>';
  const OTHER = '<div>edited on the ipad</div>';

  // ── F: flushLyrics equality guard + in-flight promise ──
  ok(src.includes('let _lyricsFlushP'), 'F0 source: _lyricsFlushP declared');

  const f1 = await page.evaluate(async ([DOC, OLD]) => {
    window._toasts = []; stubFS(DOC);                       // server already holds the editor's exact text
    const ed = document.getElementById('lyricsEditor');
    ed.innerHTML = DOC; _lyricsBase = OLD; _lyricsEdited = true;
    await flushLyrics();
    return { writes: window._txWrites, base: _lyricsBase, toasts: window._toasts, flushP: _lyricsFlushP === null };
  }, [DOC, OLD]);
  ok(f1.writes.length === 1 && f1.writes[0].lyricsDoc === DOC, 'F1 flush: server==editor → adopt, writes editor doc verbatim');
  ok(!f1.writes[0].lyricsDoc.includes('lyr-merge-divider'), 'F2 flush: no divider in adopt write');
  ok(f1.base === DOC, 'F3 flush: _lyricsBase settles to the doc');
  ok(!f1.toasts.some(t => /Merged lyrics/.test(t)), 'F4 flush: no merge toast on identical content');
  ok(f1.flushP, 'F5 flush: _lyricsFlushP cleared after settle');

  const f6 = await page.evaluate(async ([DOC, OLD, OTHER]) => {
    window._toasts = []; stubFS(OTHER);                     // genuinely divergent server doc
    const ed = document.getElementById('lyricsEditor');
    ed.innerHTML = DOC; _lyricsBase = OLD; _lyricsEdited = true;
    await flushLyrics();
    return { write: window._txWrites[0], toasts: window._toasts };
  }, [DOC, OLD, OTHER]);
  ok(f6.write.lyricsDoc.includes('lyr-merge-divider') && f6.write.lyricsDoc.includes('edited on the ipad'), 'F6 flush: genuine divergence still merges with divider');
  ok(f6.toasts.some(t => /Merged lyrics/.test(t)), 'F7 flush: genuine merge still toasts');

  // === END TESTS ===
  console.log(`\n${PASS}/${PASS + FAIL} passed`);
  await browser.close(); srv.close();
  process.exit(FAIL ? 1 : 0);
})();
```

- [ ] **Step 2: Run it to verify the new asserts fail**

Run: `node _verify_lite_1084.js`
Expected: exit 1. FAIL on F0 (no `_lyricsFlushP` in source), F1/F2 (write contains divider — the old code merges identical content), F3 (base becomes the merged doc), F4 (merge toast fired). F5 FAILs (`_lyricsFlushP` undefined → `=== null` is false). F6/F7 PASS (genuine merge already worked).

- [ ] **Step 3: Implement — declaration, wrapper, equality guard**

In `lite-1.084.html`, three edits:

**(a)** Find `let _lyricsBase = '';` and replace with:

```js
let _lyricsBase = '';
let _lyricsFlushP = null; // in-flight flushLyrics() promise — liteFreshenSong awaits it before judging remote-vs-base
```

**(b)** Find `async function flushLyrics() {` and replace with:

```js
function flushLyrics() {
  const p = _flushLyricsNow().catch(e => console.warn('[lyrics] flush', e));
  _lyricsFlushP = p;
  p.then(() => { if (_lyricsFlushP === p) _lyricsFlushP = null; });
  return p;
}
async function _flushLyricsNow() {
```

(The rest of the function body is unchanged and now belongs to `_flushLyricsNow`.)

**(c)** Inside that body's transaction, find:

```js
      if (serverDoc === _lyricsBase) { result = html; }
```

and replace with:

```js
      if (serverDoc === _lyricsBase || serverDoc === html) { result = html; } // own text already on server — not a foreign edit
```

- [ ] **Step 4: Run the suite to verify it passes**

Run: `node _verify_lite_1084.js`
Expected: `8/8 passed`, exit 0.

- [ ] **Step 5: Commit**

```bash
git add lite-1.084.html _verify_lite_1084.js
git commit -m "fix(lite-1.084): flushLyrics — adopt identical server doc instead of self-merging; expose in-flight _lyricsFlushP

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: liteFreshenSong — await in-flight flush, fromCache bail, local==remote adopt

**Files:**
- Modify: `lite-1.084.html` — `liteFreshenSong` (locate by searching `async function liteFreshenSong`)
- Modify: `_verify_lite_1084.js` — append the R-block

**Interfaces:**
- Consumes: `_lyricsFlushP` from Task 2 (Promise|null, never rejects — awaited defensively anyway).
- Produces: nothing new for later tasks; `liteFreshenSong()` keeps its signature (async, no args, no return value).

- [ ] **Step 1: Append the failing R-block to the suite**

In `_verify_lite_1084.js`, insert immediately **before** the `// === END TESTS ===` line:

```js
  // ── R: liteFreshenSong — race, adopt, genuine merge, fromCache ──
  ok(src.includes('fromCache'), 'R0 source: freshen has a fromCache bail');

  const r1 = await page.evaluate(async ([DOC, OLD]) => {
    window._toasts = []; stubFS(DOC, { delayMs: 250 });     // slow flush txn; server already has DOC (the frozen-flush shape)
    const ed = document.getElementById('lyricsEditor');
    ed.innerHTML = DOC; _lyricsBase = OLD; _lyricsEdited = true;
    const fp = flushLyrics();                               // in flight…
    const fr = liteFreshenSong();                           // …freshen fires on return — must wait for the flush
    await fp; await fr;
    const html = currentEditorHtml();
    return { base: _lyricsBase, divider: html.includes('lyr-merge-divider'), toasts: window._toasts };
  }, [DOC, OLD]);
  ok(!r1.divider, 'R1 frozen-flush race: no divider after freshen during in-flight flush');
  ok(r1.base === DOC, 'R2 frozen-flush race: base settles to the flushed doc');
  ok(!r1.toasts.some(t => /Merged lyrics/.test(t)), 'R3 frozen-flush race: no merge toast');

  const r4 = await page.evaluate(async ([DOC, OLD]) => {
    window._toasts = []; stubFS(DOC);                       // no flush in flight; server == editor ≠ base
    const ed = document.getElementById('lyricsEditor');
    ed.innerHTML = DOC; _lyricsBase = OLD; _lyricsEdited = true;
    await liteFreshenSong();
    return { base: _lyricsBase, divider: currentEditorHtml().includes('lyr-merge-divider'), toasts: window._toasts };
  }, [DOC, OLD]);
  ok(!r4.divider && r4.base === DOC, 'R4 freshen: local==remote≠base → silent adopt');
  ok(!r4.toasts.some(t => /Merged lyrics/.test(t)), 'R5 freshen: no toast on silent adopt');

  const r6 = await page.evaluate(async ([DOC, OLD, OTHER]) => {
    window._toasts = []; stubFS(OTHER);                     // genuinely divergent remote
    const ed = document.getElementById('lyricsEditor');
    ed.innerHTML = DOC; _lyricsBase = OLD; _lyricsEdited = true;
    await liteFreshenSong();
    clearTimeout(_lyricsTimer);                             // merge schedules a save — keep it out of later tests
    const html = currentEditorHtml();
    return { divider: html.includes('lyr-merge-divider'), both: html.includes('night is young') && html.includes('edited on the ipad'), toasts: window._toasts };
  }, [DOC, OLD, OTHER]);
  ok(r6.divider && r6.both, 'R6 freshen: genuine divergence still merges local + divider + remote');
  ok(r6.toasts.some(t => /Merged lyrics/.test(t)), 'R7 freshen: genuine merge still toasts');

  const r8 = await page.evaluate(async ([DOC, OTHER]) => {
    window._toasts = []; stubFS(OTHER, { fromCache: true }); // stale cached read (network not back yet)
    const ed = document.getElementById('lyricsEditor');
    ed.innerHTML = DOC; _lyricsBase = DOC; _lyricsEdited = false; // clean editor — old code would silently replace with stale OTHER
    await liteFreshenSong();
    return { html: currentEditorHtml(), base: _lyricsBase };
  }, [DOC, OTHER]);
  ok(r8.html === DOC && r8.base === DOC, 'R8 freshen: fromCache snapshot ignored (no stale replace)');
```

- [ ] **Step 2: Run to verify the R-block fails**

Run: `node _verify_lite_1084.js`
Expected: exit 1. FAIL on R0 (no bail in source yet), R4/R5 (else-branch merges identical content), R8 (stale cache replaces editor). R1–R3 already PASS (Task 2's flush guard covers this shape — the coordination in this task is what keeps it fixed when local has extra keystrokes). R6/R7 PASS (genuine merge unchanged). F-block stays 8/8.

- [ ] **Step 3: Implement the three freshen edits**

In `lite-1.084.html`, inside `liteFreshenSong`:

**(a)** Find:

```js
  if (!_currentSong) return;
  const songId = _currentSong.id;
  if (!_takesUnsub || _takesSongId !== songId) startTakesListener(songId); // ensure take list is current
```

and replace with:

```js
  if (!_currentSong) return;
  const songId = _currentSong.id;
  if (_lyricsFlushP) { try { await _lyricsFlushP; } catch (e) {} } // let an in-flight save settle _lyricsBase before judging
  if (!_currentSong || _currentSong.id !== songId) return;
  if (!_takesUnsub || _takesSongId !== songId) startTakesListener(songId); // ensure take list is current
```

**(b)** Find:

```js
  if (!_currentSong || _currentSong.id !== songId) return; // song switched while awaiting
  const remote = (snap.exists && typeof snap.data().lyricsDoc === 'string') ? snap.data().lyricsDoc : _lyricsBase;
```

and replace with:

```js
  if (!_currentSong || _currentSong.id !== songId) return; // song switched while awaiting
  if (snap.metadata && snap.metadata.fromCache) return; // cached read (network not back yet) can be stale — only judge against the server
  const remote = (snap.exists && typeof snap.data().lyricsDoc === 'string') ? snap.data().lyricsDoc : _lyricsBase;
```

**(c)** Find:

```js
  } else {
    ed.innerHTML = ilSanitizeDocHtml(local + _lyricsDivider('another device') + remote); _atomizeLyricChords();
```

and replace with:

```js
  } else if (local === remote) {
    _lyricsBase = remote; _currentSong.lyricsDoc = remote; _lyricsEdited = false; clearTimeout(_lyricsTimer); // identical content is never a conflict
  } else {
    ed.innerHTML = ilSanitizeDocHtml(local + _lyricsDivider('another device') + remote); _atomizeLyricChords();
```

- [ ] **Step 4: Run the suite to verify it passes**

Run: `node _verify_lite_1084.js`
Expected: `17/17 passed`, exit 0.

- [ ] **Step 5: Commit**

```bash
git add lite-1.084.html _verify_lite_1084.js
git commit -m "fix(lite-1.084): liteFreshenSong — await in-flight flush, skip cached snapshots, adopt identical remote silently

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: liteLyricsDrain — equality guard

**Files:**
- Modify: `lite-1.084.html` — `liteLyricsDrain` (locate by searching `async function liteLyricsDrain`)
- Modify: `_verify_lite_1084.js` — append the D-block

**Interfaces:**
- Consumes: existing `dhPendingLyricsPut()` / `dhPendingLyricsGet()` / `dhPendingLyricsDelete()` (IndexedDB pending-lyrics store) — unchanged.
- Produces: nothing new; `liteLyricsDrain()` keeps its signature.

- [ ] **Step 1: Append the failing D-block to the suite**

In `_verify_lite_1084.js`, insert immediately **before** the `// === END TESTS ===` line:

```js
  // ── D: liteLyricsDrain equality guard ──
  ok(src.includes('serverDoc === e.base || serverDoc === e.lyricsDoc'), 'D0 source: drain equality guard');

  const d1 = await page.evaluate(async ([DOC, OLD]) => {
    window._toasts = []; stubFS(DOC);                       // server already holds the pending doc's exact text
    const ed = document.getElementById('lyricsEditor');
    ed.innerHTML = DOC; _lyricsBase = OLD;
    await dhPendingLyricsPut({ songId: _currentSong.id, lyricsDoc: DOC, base: OLD, editedAt: Date.now() });
    await liteLyricsDrain();
    const left = await dhPendingLyricsGet(_currentSong.id);
    return { writes: window._txWrites, base: _lyricsBase, left: !!left, toasts: window._toasts };
  }, [DOC, OLD]);
  ok(d1.writes.length === 1 && d1.writes[0].lyricsDoc === DOC && !d1.writes[0].lyricsDoc.includes('lyr-merge-divider'), 'D1 drain: server==pending doc → adopt, no divider');
  ok(!d1.left, 'D2 drain: pending entry deleted');
  ok(d1.base === DOC && !d1.toasts.some(t => /Merged lyrics/.test(t)), 'D3 drain: base settles, no merge toast');

  const d4 = await page.evaluate(async ([DOC, OLD, OTHER]) => {
    window._toasts = []; stubFS(OTHER);                     // genuinely divergent server doc
    const ed = document.getElementById('lyricsEditor');
    ed.innerHTML = DOC; _lyricsBase = OLD;
    await dhPendingLyricsPut({ songId: _currentSong.id, lyricsDoc: DOC, base: OLD, editedAt: Date.now() });
    await liteLyricsDrain();
    clearTimeout(_lyricsTimer);
    return { write: window._txWrites[0], toasts: window._toasts };
  }, [DOC, OLD, OTHER]);
  ok(d4.write.lyricsDoc.includes('lyr-merge-divider') && d4.write.lyricsDoc.includes('edited on the ipad'), 'D4 drain: genuine divergence still merges with divider');
  ok(d4.toasts.some(t => /Merged lyrics/.test(t)), 'D5 drain: genuine merge still toasts');
```

- [ ] **Step 2: Run to verify the D-block fails**

Run: `node _verify_lite_1084.js`
Expected: exit 1. FAIL on D0, D1, D3 (old drain merges identical content and toasts). D2 PASSes (entry is deleted either way), D4/D5 PASS. F/R blocks stay green.

- [ ] **Step 3: Implement the drain guard**

In `lite-1.084.html`, inside `liteLyricsDrain`'s transaction, find:

```js
          if (serverDoc === e.base) { result = e.lyricsDoc; }
```

and replace with:

```js
          if (serverDoc === e.base || serverDoc === e.lyricsDoc) { result = e.lyricsDoc; } // own text already on server — not a foreign edit
```

- [ ] **Step 4: Run the suite to verify it passes**

Run: `node _verify_lite_1084.js`
Expected: `22/22 passed`, exit 0.

- [ ] **Step 5: Commit**

```bash
git add lite-1.084.html _verify_lite_1084.js
git commit -m "fix(lite-1.084): liteLyricsDrain — adopt identical server doc instead of self-merging

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Regression sweep (1.083 + 1.082 suites retargeted at lite-1.084.html)

**Files:**
- Create (temporary, deleted in this task): `_regress_1083_on_1084.js`, `_regress_1082_on_1084.js`

**Interfaces:**
- Consumes: `_verify_lite_1083.js`, `_verify_lite_1082.js` (existing suites, read-only), `lite-1.084.html`.
- Produces: green regression evidence; no repo files remain.

- [ ] **Step 1: Retarget and run the 1.083 suite against 1.084**

Run:
```bash
cd /Users/jasoncraig/Documents/Claude/Projects/Drafthaus
sed 's/lite-1\.083\.html/lite-1.084.html/g' _verify_lite_1083.js > _regress_1083_on_1084.js
node _regress_1083_on_1084.js
```
Expected: `19/19 passed`, exit 0. (The temp copy must live in the repo dir — the suite serves files from `__dirname`.)

- [ ] **Step 2: Retarget and run the 1.082 suite against 1.084**

Run:
```bash
sed 's/lite-1\.082\.html/lite-1.084.html/g' _verify_lite_1082.js > _regress_1082_on_1084.js
node _regress_1082_on_1084.js
```
Expected: `15/15 passed`, exit 0. Note from project memory: if a 1.080-era A3-style timing assert flakes, re-run once before trusting a FAIL.

- [ ] **Step 3: Final full run of the new suite + cleanup**

Run:
```bash
node _verify_lite_1084.js
rm _regress_1083_on_1084.js _regress_1082_on_1084.js
git status --short
```
Expected: `22/22 passed`, exit 0; `git status` shows no stray files (only `.DS_Store` noise if pre-existing).

- [ ] **Step 4: Report to user — do NOT push, do NOT promote**

Summarize: 22/22 new + 19/19 + 15/15 regression. Pushing to GitHub (deploys `drafthaus.ca/lite-1.084.html`) and promoting to root `index.html` both wait for explicit user confirmation and on-device QA (backgrounding an edit session on the iPhone, returning, confirming no divider/toast). Remind the user that already-duplicated songs need a one-time manual cleanup of the divider + duplicate text.

---

## Self-Review Notes

- **Spec coverage:** fix part 1 → Tasks 2 (flush), 3c (freshen), 4 (drain); part 2 → Tasks 2b (wrapper) + 3a (await); part 3 → Task 3b (fromCache). Verification section → suite blocks F/R/D + Task 5 regressions. Out-of-scope items respected (no wording, schema, or auto-heal tasks).
- **Type consistency:** `_lyricsFlushP` is Promise|null, produced in Task 2b, consumed in Task 3a; the flush promise is pre-caught (never rejects) but awaited inside try/catch anyway. `flushLyrics()` keeps its name for the inline `onblur` handler and `closeSong` caller; only the body moved to `_flushLyricsNow()`.
- **Known pre-fix pass:** R1–R3 pass as soon as Task 2 lands (the equality guard alone covers the identical-content race); they're kept because they pin the exact reported bug shape end-to-end.
