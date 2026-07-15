# Compact Take Date Format Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Take dates render as `4:32pm - 14/07/26` (time, then DD/MM/YY) on every surface of Drafthaus Lite, replacing the long `July 14th, 2026 - 4:32pm` format, with zero data changes.

**Architecture:** Drafthaus Lite is a single-file HTML app (`lite-*.html`, vanilla JS + Firebase). Dates are never stored — `takeDisplayName`/`fmtTakeDate` compute them at render time from each take's `createdAt`. We rewrite one formatter, delete its now-dead helpers (`MONTHS`, `_ordinal`, the `withYear` parameter), and update three call sites. Spec: `docs/superpowers/specs/2026-07-14-compact-take-date-format-design.md`.

**Tech Stack:** Vanilla JS in a single HTML file; verification via `playwright-core` driving the installed Chrome (`/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`) — there is no test runner.

## Global Constraints

- Work ONLY in `lite-1.082.html` (new snapshot) — never touch `full.html`, `1.3xx.html`, or `index.html` in this plan. Promotion into `index.html` happens after user sign-off, outside this plan.
- Locate code by searching quoted strings/function names, NOT line numbers (file is large; numbers drift).
- Commit directly to `main`. **NEVER `git push`** — pushing deploys to drafthaus.ca via GitHub Pages; the user confirms pushes personally.
- Format contract (exact): 12-hour time, no leading zero on hour, minutes zero-padded, lowercase am/pm; then ` - `; then zero-padded `DD/MM/YY`. Examples: `9:05am - 03/07/26`, `12:32am - 14/12/26`, `12:00pm - 14/12/26`.
- Renamed takes render as `<name> - <time> - <date>`: `Chorus idea - 4:32pm - 14/07/26`.
- No Firestore/data writes change in any way. `_takeDate(t)` (the Timestamp/number/`_localTs` fallback chain) must not be touched.
- App top-level `let` vars are NOT window props — in `page.evaluate` stub them by bare-name assignment (`_takes = [...]`), not `window._takes =`. Top-level `function`s ARE window props.

---

### Task 1: Snapshot the new version file

**Files:**
- Create: `lite-1.082.html` (byte-copy of `lite-1.081.html`)

**Interfaces:**
- Produces: `lite-1.082.html`, the file every later task edits and tests.

- [ ] **Step 1: Confirm the true base (base-drift trap)**

The live root must match the file we branch from:

```bash
cd /Users/jasoncraig/Documents/Claude/Projects/Drafthaus
md5 -q index.html lite-1.081.html
```

Expected: two identical hashes. If they differ, STOP and report — the base assumption is wrong.

- [ ] **Step 2: Copy and verify the copy**

```bash
cp lite-1.081.html lite-1.082.html
md5 -q lite-1.081.html lite-1.082.html
```

Expected: two identical hashes (confirms the copy took what we meant).

- [ ] **Step 3: Commit**

```bash
git add lite-1.082.html
git commit -m "chore(lite-1.082): snapshot from lite-1.081 — base for compact take date format

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Failing verify suite, then the formatter change

**Files:**
- Create: `_verify_lite_1082.js`
- Modify: `lite-1.082.html` (the "Take date / name formatting" block — find it by searching `Take date / name formatting` — plus three call sites found by searching `takeDisplayName(t, true)`, `takeDisplayName(t, false)`, `fmtTakeDate(_takeDate(take), true)`)

**Interfaces:**
- Consumes: `lite-1.082.html` from Task 1.
- Produces: `fmtTakeDate(date)` → `'4:32pm - 14/07/26'`-style string (`''` for falsy input); `takeDisplayName(t)` → `'<name> - <formatted>'` or `'<formatted>'`. Both single-argument — the `withYear` parameter is gone. `MONTHS` and `_ordinal` no longer exist. Task 3's regression run relies on the suite committed here passing 14/14.

- [ ] **Step 1: Write the failing verify suite**

Write `_verify_lite_1082.js` (repo root, same harness as `_verify_lite_1081.js`). The suite absorbs the 1081 suite's five semantic checks (numeric `createdAt`, Timestamp path, null fallback, name+sort, drain patch) with new-format expectations, because the 1081 suite is pinned to the old format and retires with it:

```js
// _verify_lite_1082.js — lite-1.082: compact take date format (time - DD/MM/YY)
const { chromium } = require('playwright-core');
const http = require('http'); const fs = require('fs'); const path = require('path');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ROOT = __dirname;
let PASS = 0, FAIL = 0;
const ok = (c, m) => { if (c) { PASS++; console.log('PASS', m); } else { FAIL++; console.log('FAIL', m); } };

function serve() {
  return new Promise(res => {
    const s = http.createServer((req, rq) => {
      let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/lite-1.082.html';
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

(async () => {
  // ── Source-level: dead code is gone, call sites updated ──
  const src = fs.readFileSync(path.join(ROOT, 'lite-1.082.html'), 'utf8');
  ok(!src.includes('MONTHS') && !src.includes('_ordinal'), 'S1 source: MONTHS and _ordinal removed');
  ok(!src.includes('withYear'), 'S2 source: no withYear remnants');
  ok(src.includes('fmtTakeDate(_takeDate(take))'), 'S3 source: share viewer label uses 1-arg fmtTakeDate');
  ok(src.includes('takeDisplayName(t)') && !src.includes('takeDisplayName(t,'), 'S4 source: row+rail use 1-arg takeDisplayName');

  const srv = await serve(); const port = srv.address().port;
  const browser = await chromium.launch({
    executablePath: CHROME, headless: true,
    args: ['--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
  });
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 } });
  await ctx.addInitScript(() => { try { localStorage['drafthaus-eula-accepted'] = '1'; } catch (e) {} });
  const page = await ctx.newPage();
  await page.goto(`http://localhost:${port}/lite-1.082.html`, { waitUntil: 'domcontentloaded' });
  await page.click('.auth-btn.ghost');
  await page.waitForSelector('body.signed-in', { timeout: 15000 });

  // ── T1–T3: format contract (padding + 12am/12pm edges) ──
  const fmt = (y, mo, d, h, mi) => page.evaluate(a => fmtTakeDate(new Date(a[0], a[1], a[2], a[3], a[4])), [y, mo, d, h, mi]);
  ok(await fmt(2026, 6, 3, 9, 5) === '9:05am - 03/07/26', 'T1 padding: day/month/minute padded, hour not');
  ok(await fmt(2026, 11, 14, 0, 32) === '12:32am - 14/12/26', 'T2 midnight renders 12:32am');
  ok(await fmt(2026, 11, 14, 12, 0) === '12:00pm - 14/12/26', 'T3 noon renders 12:00pm');

  // ── T4–T5: createdAt shapes (legacy number + Firestore Timestamp), stable across renders ──
  const FIXED = new Date(2026, 5, 20, 16, 32).getTime(); // Jun 20th 2026, 4:32pm — clearly not "now"
  const t4a = await page.evaluate(f => takeDisplayName({ createdAt: f }), FIXED);
  await page.waitForTimeout(1100);
  const t4b = await page.evaluate(f => takeDisplayName({ createdAt: f }), FIXED);
  ok(t4a === '4:32pm - 20/06/26', `T4a numeric createdAt formats its stored instant (got "${t4a}")`);
  ok(t4a === t4b, 'T4b stable across renders (no drift to current time)');
  const t5 = await page.evaluate(f => takeDisplayName({ createdAt: { toDate: () => new Date(f) } }), FIXED);
  ok(t5 === '4:32pm - 20/06/26', 'T5 Timestamp createdAt renders via toDate()');

  // ── T6: missing createdAt still falls back to now (pending serverTimestamp window) ──
  const t6 = await page.evaluate(() => ({ shown: takeDisplayName({}), now: fmtTakeDate(new Date()) }));
  ok(t6.shown === t6.now, 'T6 null createdAt still shows current time');

  // ── T7: custom name prefixes; _ms sort unaffected by format change ──
  const t7 = await page.evaluate(f => ({
    named: takeDisplayName({ name: 'Chorus idea', createdAt: f }),
    sortOlderFirst: _ms(f) < _ms({ toDate: () => new Date(f + 60000) }),
  }), FIXED);
  ok(t7.named === 'Chorus idea - 4:32pm - 20/06/26' && t7.sortOlderFirst,
    'T7 name - time - date; _ms sorts numeric vs Timestamp correctly');

  // ── T8: rename safety — editor seeds only the stored name; commit writes only typed text ──
  const t8 = await page.evaluate(async f => {
    _takes = [{ id: 'TK1', name: '', createdAt: f, duration: 2, bytes: 3 }];
    renderTakes();
    const nm = document.querySelector('.take-row[data-id="TK1"] .nm');
    const shownBefore = nm.textContent;
    const captured = [];
    const origCollection = db.collection.bind(db);
    db.collection = (name) => name === 'voice_takes'
      ? { doc: (id) => ({ set: async (patch, opts) => { captured.push({ id, patch, opts }); } }) }
      : origCollection(name);
    startRename('TK1', nm);
    const seeded = nm.textContent;
    nm.textContent = 'My take';
    nm.blur();
    await new Promise(r => setTimeout(r, 100));
    db.collection = origCollection;
    return { shownBefore, seeded, captured };
  }, FIXED);
  ok(t8.shownBefore === '4:32pm - 20/06/26' && t8.seeded === ''
     && t8.captured.length === 1 && t8.captured[0].patch.name === 'My take'
     && !('createdAt' in t8.captured[0].patch),
    'T8 rename: row shows new format; editor seeds blank (not the date); write is name-only');

  // ── T9: rail label uses the same compact format ──
  const t9 = await page.evaluate(f => {
    _takes = [{ id: 'TK1', name: '', createdAt: f, duration: 2, bytes: 3 }];
    _loadedTakeId = 'TK1';
    updateRail();
    return document.getElementById('railTakeName').textContent;
  }, FIXED);
  ok(t9 === '4:32pm - 20/06/26', 'T9 rail label shows compact format (year included)');

  // ── T10: drain doc patch still carries no createdAt (1081 regression, re-pinned here) ──
  const t10 = await page.evaluate(async () => {
    const captured = [];
    dhOutboxAll = async () => (captured.length ? [] : [{
      takeId: 'TK1', op: 'upload', storagePath: 'voice_takes/S/x.webm', mimeType: 'audio/webm',
      songId: 'S', userId: 'guest', filename: 'x.webm', trackNum: 0, bytes: 3, duration: 2,
      tries: 0, createdAt: 1750000000000,
    }]);
    dhAudioGet = async () => new Blob(['abc'], { type: 'audio/webm' });
    dhOutboxDelete = async () => {}; dhAudioSetPending = async () => {};
    const origStorage = firebase.storage;
    firebase.storage = () => ({ ref: () => ({ put: async () => ({ ref: { getDownloadURL: async () => 'http://dl/x' } }), delete: () => Promise.resolve() }) });
    const origCollection = db.collection.bind(db);
    db.collection = (name) => name === 'voice_takes'
      ? { doc: (id) => ({ set: async (patch, opts) => { captured.push({ id, patch, opts }); } }) }
      : origCollection(name);
    await liteSyncDrain();
    firebase.storage = origStorage; db.collection = origCollection;
    return captured;
  });
  ok(t10.length === 1 && t10[0].id === 'TK1' && !('createdAt' in t10[0].patch)
     && t10[0].patch.downloadUrl === 'http://dl/x' && t10[0].patch.pendingUpload === false,
    'T10 drain doc patch: merge-set without createdAt (1081 fix intact)');

  console.log(`\n${PASS}/${PASS + FAIL} passed`);
  await browser.close(); srv.close();
  process.exit(FAIL ? 1 : 0);
})();
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd /Users/jasoncraig/Documents/Claude/Projects/Drafthaus && node _verify_lite_1082.js
```

Expected: FAIL lines for S1–S4 (old code still present) and T1–T5/T7–T9 (old long format returned); exit code 1. T6 and T10 may already pass (format-independent). If everything passes, the test is broken — stop and fix it.

- [ ] **Step 3: Implement the formatter change in `lite-1.082.html`**

Four edits, all inside or near the block found by searching `Take date / name formatting`:

**Edit A** — replace the `MONTHS` const, `_ordinal`, and `fmtTakeDate` (three lines starting at the `const MONTHS =` line) with the new single formatter:

Old:
```js
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
function _ordinal(n) { const s = ['th','st','nd','rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }
function fmtTakeDate(date, withYear) {
  if (!date) return '';
  let h = date.getHours(); const m = date.getMinutes(); const ap = h >= 12 ? 'pm' : 'am'; h = h % 12; if (h === 0) h = 12;
  const time = h + ':' + String(m).padStart(2, '0') + ap;
  const md = MONTHS[date.getMonth()] + ' ' + _ordinal(date.getDate()) + (withYear ? ', ' + date.getFullYear() : '');
  return md + ' - ' + time;
}
```

New:
```js
function fmtTakeDate(date) {
  if (!date) return '';
  let h = date.getHours(); const m = date.getMinutes(); const ap = h >= 12 ? 'pm' : 'am'; h = h % 12; if (h === 0) h = 12;
  const time = h + ':' + String(m).padStart(2, '0') + ap;
  const dmy = String(date.getDate()).padStart(2, '0') + '/' + String(date.getMonth() + 1).padStart(2, '0') + '/' + String(date.getFullYear() % 100).padStart(2, '0');
  return time + ' - ' + dmy;
}
```

**Edit B** — `takeDisplayName` drops the parameter (search `function takeDisplayName`):

Old:
```js
function takeDisplayName(t, withYear) {
  const d = fmtTakeDate(_takeDate(t), withYear);
```
New:
```js
function takeDisplayName(t) {
  const d = fmtTakeDate(_takeDate(t));
```

**Edit C** — the two `takeDisplayName` call sites (search `takeDisplayName(t, true)` and `takeDisplayName(t, false)`):
- `${esc(takeDisplayName(t, true))}` → `${esc(takeDisplayName(t))}`
- `nameEl.textContent = t ? takeDisplayName(t, false) : 'Empty';` → `nameEl.textContent = t ? takeDisplayName(t) : 'Empty';`

**Edit D** — the share-viewer label (search `fmtTakeDate(_takeDate(take), true)`):
- `const dstr = fmtTakeDate(_takeDate(take), true);` → `const dstr = fmtTakeDate(_takeDate(take));`

Do NOT touch `_takeDate` (the function right between Edits A and B).

- [ ] **Step 4: Run the suite to verify it passes**

```bash
cd /Users/jasoncraig/Documents/Claude/Projects/Drafthaus && node _verify_lite_1082.js
```

Expected: `14/14 passed`, exit code 0.

- [ ] **Step 5: Commit**

```bash
git add lite-1.082.html _verify_lite_1082.js
git commit -m "feat(lite-1.082): compact take date format — time - DD/MM/YY on all surfaces

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Regression run + hand back for push/promotion

**Files:**
- None modified. Temp file `_regress_1080_on_1082.tmp.js` created in repo root and deleted (must live in the repo root so its `__dirname` file-server and `require('playwright-core')` resolve).

**Interfaces:**
- Consumes: `lite-1.082.html` + passing `_verify_lite_1082.js` from Task 2.
- Produces: a clean regression verdict. Nothing downstream — push and `index.html` promotion are the user's call.

- [ ] **Step 1: Run the 1080 suite against the new file**

The 1080 suite (input-device picker, 24 asserts) is date-format-agnostic, so it retargets with a filename swap. The 1081 suite does NOT retarget (it pins the old format); its checks live on as T4–T7/T10 of the 1082 suite.

```bash
cd /Users/jasoncraig/Documents/Claude/Projects/Drafthaus
sed 's/lite-1\.081\.html/lite-1.082.html/g; s/lite-1\.080\.html/lite-1.082.html/g' _verify_lite_1080.js > _regress_1080_on_1082.tmp.js
node _regress_1080_on_1082.tmp.js
```

Expected: `24/24 passed`. ⚠️ The A3 block of this suite is timing-flaky — if only A3 fails, re-run once before treating it as real.

- [ ] **Step 2: Delete the temp script**

```bash
rm /Users/jasoncraig/Documents/Claude/Projects/Drafthaus/_regress_1080_on_1082.tmp.js
```

- [ ] **Step 3: Re-run the 1082 suite one final time**

```bash
cd /Users/jasoncraig/Documents/Claude/Projects/Drafthaus && node _verify_lite_1082.js
```

Expected: `14/14 passed`.

- [ ] **Step 4: Report and stop — do NOT push**

Report to the user: verify results (14/14 + 24/24), and that `lite-1.082.html` is committed on `main` awaiting their confirmation to (a) push (deploys `drafthaus.ca/lite-1.082.html` via Pages) and (b) promote into `index.html` (`cp lite-1.082.html index.html` + release commit), per the standard Lite milestone workflow.
