# Lite 1.078 — Music-Grade Recording Capture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** New recorded takes in Drafthaus Lite capture raw, music-grade audio (voice-call processing off, explicit 128 kbps recorder bitrate, 192 kbps MP3 edit-save) — existing takes untouched.

**Architecture:** Drafthaus Lite is a single-file HTML app (`lite-*.html`, vanilla JS). Versioning is by copying the whole file to a new numbered name (`lite-1.077.html` → `lite-1.078.html`); all three changes are tiny string edits inside the new copy. Verification is a headless playwright-core script driving the real app in the installed Chrome with a fake mic device.

**Tech Stack:** Vanilla JS, MediaRecorder + getUserMedia, lamejs (CDN), playwright-core + installed Chrome for verification. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-07-10-lite-audio-quality-design.md`

## Global Constraints

- All app edits go in `lite-1.078.html` ONLY. Never touch `full.html`, `index.html`, `lite-1.077.html`, or any other `1.3xx`/`lite-*` file. (`index.html` is the live site root — it changes only in the promote step, which is user-gated.)
- The file is ~4.6k lines but line numbers drift — locate code by searching the quoted strings given in each step, not by line number.
- `git push` deploys to production via GitHub Pages — NEVER push without explicit user confirmation. Committing locally is always fine.
- Chrome for headless runs: `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome` (playwright-core `executablePath`, no browser download).
- Known harness gotchas (from project memory): app top-level `let` variables are NOT window props (stub by bare-name assignment inside `page.evaluate`), but top-level `function` declarations ARE window props (`window.fn = spy` works). Don't assert on the Firestore takes-listener DOM in tests — the seeded song doc doesn't exist server-side and the rules' cross-doc lookup makes that listener unreliable in the harness; spy on `uploadTake` instead.

---

### Task 1: Snapshot `lite-1.078.html` from the verified base

**Files:**
- Create: `lite-1.078.html` (byte-copy of `lite-1.077.html`)

**Interfaces:**
- Produces: `lite-1.078.html`, the only file Tasks 2–3 touch; Task 2's server defaults to serving it.

- [ ] **Step 1: Verify the base is really the live root (base-drift trap)**

Run:
```bash
cd /Users/jasoncraig/Documents/Claude/Projects/Drafthaus
md5 -q index.html lite-1.077.html
```
Expected: the two hashes are IDENTICAL (currently `dfea9f35a8028e25f4f7da8534699f5e`). If they differ, STOP — the base has drifted; find the true base by md5-comparing `index.html` against the `lite-*.html` files and raise it with the user before proceeding.

- [ ] **Step 2: Copy and confirm the copy is byte-identical**

Run:
```bash
cp lite-1.077.html lite-1.078.html
diff lite-1.077.html lite-1.078.html && echo IDENTICAL
```
Expected: no diff output, then `IDENTICAL`.

- [ ] **Step 3: Confirm the three edit anchors exist in the new file**

Run:
```bash
grep -c "{ audio: { echoCancellation: true, noiseSuppression: true } }" lite-1.078.html
grep -c "new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)" lite-1.078.html
grep -c "new lamejs.Mp3Encoder(ch, sr, 128)" lite-1.078.html
```
Expected: `2`, `1`, `1` (in that order). Any other counts → STOP and re-inspect; the anchors in Task 3 assume exactly these.

No commit yet — the snapshot commits together with its changes in Task 3 (repo convention: one `feat(lite-N)` commit per version).

---

### Task 2: Write the failing verify script `_verify_lite_1078.js`

**Files:**
- Create: `_verify_lite_1078.js` (repo root — it must sit next to `node_modules` and the html files; the built-in server serves from `__dirname`)

**Interfaces:**
- Consumes: `lite-1.078.html` from Task 1 (currently identical to 1.077, so the three targeted asserts FAIL — that's the TDD baseline).
- Produces: `node _verify_lite_1078.js` exits 0 with `6/6 passed` once Task 3's edits land. Asserts: S0 boot sanity, A1 countdown-pre-acquire constraints, A2 startRecord-fallback constraints, B recorder bitrate, D real ~1s capture reaches `uploadTake`, C mp3 encoder 192 kbps.

- [ ] **Step 1: Write the script**

Create `_verify_lite_1078.js` with exactly this content:

```js
// _verify_lite_1078.js — lite-1.078: music-grade capture (raw mic constraints + explicit bitrates)
const { chromium } = require('playwright-core');
const http = require('http'); const fs = require('fs'); const path = require('path');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ROOT = __dirname;
let PASS = 0, FAIL = 0;
const ok = (c, m) => { if (c) { PASS++; console.log('PASS', m); } else { FAIL++; console.log('FAIL', m); } };

function serve() {
  return new Promise(res => {
    const s = http.createServer((req, rq) => {
      let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/lite-1.078.html';
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

const RAW = JSON.stringify({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });

(async () => {
  const srv = await serve(); const port = srv.address().port;
  const browser = await chromium.launch({
    executablePath: CHROME, headless: true,
    args: ['--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
  });
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 } });
  await ctx.addInitScript(() => {
    try { localStorage['drafthaus-eula-accepted'] = '1'; } catch (e) {}
    // Spy getUserMedia constraints (delegates to the fake device so recording really runs).
    const orig = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    window._gumCalls = [];
    navigator.mediaDevices.getUserMedia = (c) => {
      try { window._gumCalls.push(JSON.parse(JSON.stringify(c))); } catch (e) {}
      return orig(c);
    };
    // Spy MediaRecorder constructor options (returns a real recorder).
    const OrigMR = window.MediaRecorder;
    window._mrOpts = [];
    window.MediaRecorder = function (stream, opts) { window._mrOpts.push(opts || null); return new OrigMR(stream, opts); };
    window.MediaRecorder.isTypeSupported = (t) => OrigMR.isTypeSupported(t);
  });
  const page = await ctx.newPage();
  await page.goto(`http://localhost:${port}/lite-1.078.html`, { waitUntil: 'domcontentloaded' });
  await page.click('.auth-btn.ghost');
  await page.waitForSelector('body.signed-in', { timeout: 15000 });
  await page.evaluate(s => { window._openSongObj(s); },
    { id: 'TESTSONG', ownerId: 'guest', title: 'Rec Song', key: '', lyricsDoc: '<div>x</div>' });
  await page.waitForTimeout(300);

  // ── S0: sanity ──
  ok(await page.evaluate(() => !!document.getElementById('takesList') && document.body.classList.contains('signed-in')),
    'S0 boot: signed in, song open');

  // ── A1: countdown pre-acquire requests raw music-grade constraints ──
  await page.evaluate(() => { window._gumCalls.length = 0; _startCountdown(); });
  await page.waitForTimeout(250);
  await page.evaluate(() => _cancelCountdown());
  const a1 = await page.evaluate(() => window._gumCalls);
  ok(a1.length === 1 && JSON.stringify(a1[0]) === RAW,
    'A1 countdown pre-acquire: EC/NS/AGC all requested off');

  // ── A2 + B + D: startRecord fallback constraints, recorder options, real capture ──
  await page.evaluate(() => {
    window._gumCalls.length = 0; window._mrOpts.length = 0; window._uploads = [];
    // Top-level function → window prop; swallow the upload (Firestore not needed here).
    window.uploadTake = (blob, mime, dur) => { window._uploads.push({ size: blob.size, mime, dur }); };
    startRecord();
  });
  await page.waitForTimeout(1200);
  await page.evaluate(() => stopRecord());
  await page.waitForTimeout(600);
  const st = await page.evaluate(() => ({ gum: window._gumCalls, mr: window._mrOpts, up: window._uploads }));
  ok(st.gum.length === 1 && JSON.stringify(st.gum[0]) === RAW,
    'A2 startRecord fallback: EC/NS/AGC all requested off');
  ok(st.mr.length === 1 && !!st.mr[0] && st.mr[0].audioBitsPerSecond === 128000 && /webm|mp4/.test(st.mr[0].mimeType || ''),
    'B MediaRecorder gets audioBitsPerSecond 128000 alongside the picked mimeType');
  ok(st.up.length === 1 && st.up[0].size > 0 && st.up[0].dur > 0.9 && st.up[0].dur < 3,
    'D real ~1s capture produces a non-empty blob and reaches uploadTake');

  // ── C: _encodeMp3 encodes at 192 kbps (stubbed lamejs, real AudioBuffer) ──
  const mp3 = await page.evaluate(() => {
    window.lamejs = { Mp3Encoder: function (ch, sr, kbps) {
      window._mp3Args = { ch, sr, kbps };
      this.encodeBuffer = () => []; this.flush = () => [];
    } };
    const ac = new (window.AudioContext || window.webkitAudioContext)();
    const buf = ac.createBuffer(1, 4410, 44100);
    _encodeMp3(buf);
    return window._mp3Args;
  });
  ok(!!mp3 && mp3.ch === 1 && mp3.sr === 44100 && mp3.kbps === 192,
    'C _encodeMp3 constructs Mp3Encoder at 192 kbps');

  console.log(`\n${PASS}/${PASS + FAIL} passed`);
  await browser.close(); srv.close();
  process.exit(FAIL ? 1 : 0);
})();
```

- [ ] **Step 2: Run it to verify the targeted asserts fail (TDD baseline)**

Run:
```bash
cd /Users/jasoncraig/Documents/Claude/Projects/Drafthaus && node _verify_lite_1078.js
```
Expected: `2/6 passed`, exit code 1 — S0 and D PASS (boot + real capture already work), A1/A2/B/C FAIL (the app still sends `echoCancellation: true, noiseSuppression: true`, no bitrate, 128 kbps mp3). If S0 or D fail instead, STOP and fix the harness before touching the app — those two must be green on the unmodified copy.

No commit yet — the script commits with the feature in Task 3.

---

### Task 3: Apply the three edits, go green, run regression, commit

**Files:**
- Modify: `lite-1.078.html` (three string edits — search for the anchors, don't trust line numbers; for orientation they're near lines 2580/2600 in `_startCountdown`/`startRecord`, ~2606 in `startRecord`, and ~3497 in `_encodeMp3`)
- Test: `_verify_lite_1078.js` (from Task 2), plus a re-pointed copy of `_verify_lite_1077.js` as regression

**Interfaces:**
- Consumes: `lite-1.078.html` + `_verify_lite_1078.js` from Tasks 1–2.
- Produces: a single local commit `feat(lite-1.078)` containing both files, all green. Task 4 pushes/promotes it (user-gated).

- [ ] **Step 1: Edit 1 — raw capture constraints (both getUserMedia sites)**

In `lite-1.078.html`, replace ALL (exactly 2) occurrences of:
```js
{ audio: { echoCancellation: true, noiseSuppression: true } }
```
with:
```js
{ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } }
```
(Use Edit with `replace_all: true`; Task 1 Step 3 confirmed the count is exactly 2 — the countdown pre-acquire and the `startRecord` fallback.)

- [ ] **Step 2: Edit 2 — explicit recorder bitrate**

Replace the single occurrence of:
```js
try { _mediaRec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined); }
```
with:
```js
try { _mediaRec = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: 128000 } : { audioBitsPerSecond: 128000 }); }
```

- [ ] **Step 3: Edit 3 — 192 kbps MP3 edit-save (and its comment)**

Replace the single occurrence of:
```js
// Encode an AudioBuffer to an MP3 Blob (portable everywhere). 128kbps; mono or stereo.
function _encodeMp3(buffer) {
  const sr = buffer.sampleRate, ch = Math.min(2, buffer.numberOfChannels) || 1;
  const enc = new lamejs.Mp3Encoder(ch, sr, 128);
```
with:
```js
// Encode an AudioBuffer to an MP3 Blob (portable everywhere). 192kbps; mono or stereo.
function _encodeMp3(buffer) {
  const sr = buffer.sampleRate, ch = Math.min(2, buffer.numberOfChannels) || 1;
  const enc = new lamejs.Mp3Encoder(ch, sr, 192);
```

- [ ] **Step 4: Run the new verify — expect all green**

Run:
```bash
cd /Users/jasoncraig/Documents/Claude/Projects/Drafthaus && node _verify_lite_1078.js
```
Expected: `6/6 passed`, exit code 0.

- [ ] **Step 5: Run the 1.077 suite as regression against the new file**

The 1.077 script hardcodes its filename; run a re-pointed copy from the repo root (it must stay in the root so `require('playwright-core')` and the file server resolve), then delete it:
```bash
cd /Users/jasoncraig/Documents/Claude/Projects/Drafthaus
sed 's/lite-1\.077\.html/lite-1.078.html/g' _verify_lite_1077.js > _tmp_verify_1077_on_1078.js
node _tmp_verify_1077_on_1078.js; rm _tmp_verify_1077_on_1078.js
```
Expected: `24/24 passed` (the full lite-1.077 sticky-pad + regression suite, unaffected by audio changes). Any FAIL → the edits broke something unrelated; investigate before committing.

- [ ] **Step 6: Sanity-check the diff is exactly the three edits**

Run:
```bash
cd /Users/jasoncraig/Documents/Claude/Projects/Drafthaus && diff lite-1.077.html lite-1.078.html
```
Expected: exactly five changed lines — the two `getUserMedia` constraint lines, the `MediaRecorder` constructor line, the `_encodeMp3` comment line, and the `Mp3Encoder` bitrate line — and nothing else.

- [ ] **Step 7: Commit (local only — do NOT push)**

```bash
cd /Users/jasoncraig/Documents/Claude/Projects/Drafthaus
git add lite-1.078.html _verify_lite_1078.js
git commit -m "feat(lite-1.078): music-grade capture — raw mic constraints, 128k recorder bitrate, 192k mp3 edit-save

New takes record without echoCancellation/noiseSuppression/autoGainControl
(voice-call processing that made music sound underwater/pumping), with an
explicit MediaRecorder audioBitsPerSecond of 128000, and trim/edit-save +
ZIP export re-encode at 192 kbps MP3 instead of 128. Existing takes untouched.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Push, live QA, promote (USER-GATED — never proceed without explicit confirmation)

**Files:**
- Modify: `index.html` (promote step only — byte-copy of `lite-1.078.html`)

**Interfaces:**
- Consumes: the Task 3 commit.
- Produces: live `drafthaus.ca/lite-1.078.html`, and (after sign-off) `drafthaus.ca` root == lite-1.078.

- [ ] **Step 1: Ask the user to confirm the push** (pushing `main` deploys via GitHub Pages). Do not push until they say yes.

- [ ] **Step 2: Push and confirm deploy**

```bash
cd /Users/jasoncraig/Documents/Claude/Projects/Drafthaus && git push
```
Then poll (Pages deploys take ~1–2 min):
```bash
curl -sI https://drafthaus.ca/lite-1.078.html | head -1
```
Expected: `HTTP/2 200` (retry every ~30 s until it flips from 404).

- [ ] **Step 3: User QA on iPhone** — the audible improvement (no underwater/pumping, crisper takes) can only be confirmed by ear at `https://drafthaus.ca/lite-1.078.html`. Suggested check: record a voice+guitar take, listen for natural sustain and steady level; trim it and confirm the trimmed version still sounds good. Wait for their verdict.

- [ ] **Step 4: Promote into the root (only on explicit user sign-off)**

```bash
cd /Users/jasoncraig/Documents/Claude/Projects/Drafthaus
cp lite-1.078.html index.html
git add index.html
git commit -m "release(lite-1.078): promote into index.html (root) — music-grade recording capture

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
git push
```
Then confirm: `curl -s https://drafthaus.ca | md5` matches `md5 -q lite-1.078.html` (after deploy).
