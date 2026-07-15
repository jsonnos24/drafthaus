# Lite 1.083 Implementation Plan — +CHORDS rename, mobile scratch pad, lyric-color bleed fix

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship lite-1.083: rename the Chordify rail button to +CHORDS, enable the sticky-note scratch pad on mobile (collapsed by default), and root-cause + fix the bug where coloring a lyric line repaints the line above it red.

**Architecture:** Drafthaus Lite is a single-file vanilla-JS HTML app (`lite-1.0xx.html`); versions are whole-file copies, work lands directly on `main`. All three items edit `lite-1.083.html` (branched from `lite-1.082.html`, which is byte-identical to the live root `index.html`). Verification is a headless playwright-core suite (`_verify_lite_1083.js`) built incrementally, test-first, task by task.

**Tech Stack:** Vanilla JS single-file HTML, Firebase/Firestore, playwright-core + installed Chrome (`/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`, no browser download).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-15-lite-1083-chords-scratchpad-colorfix-design.md` — read it before starting.
- Work ONLY on `lite-1.083.html` + `_verify_lite_1083.js` until the final promote task. Never touch `index.html`, `full.html`, or any `1.3xx.html` before Task 7.
- Locate code by searching quoted strings/function names, NOT line numbers (they drift).
- Mobile = `max-width: 767px`; desktop = `min-width: 768px` — match the file's existing breakpoints exactly.
- Do NOT stage `.DS_Store` or `_tmp_regress_1080_on_1081.js` (pre-existing dirt in the working tree). Stage files by explicit name, never `git add -A`.
- The user has pre-authorized push + promote-to-root at the end ("when you're done just push and promote") — no extra confirmation stop needed at Task 7, but ONLY if every suite is green and the bug repro gate (Task 4/5) succeeded.
- Commit messages end with:
  `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` and
  `Claude-Session: https://claude.ai/code/session_01JeastqWexZhwQCc1oFXkZh`

---

### Task 1: Branch the 1.083 build

**Files:**
- Create: `lite-1.083.html` (copy of `lite-1.082.html`)

**Interfaces:**
- Produces: `lite-1.083.html`, byte-identical to `lite-1.082.html`, committed. All later tasks edit this file.

- [ ] **Step 1: Confirm the true base (base-drift trap from memory)**

Run:
```bash
cd /Users/jasoncraig/Documents/Claude/Projects/Drafthaus
md5 -q index.html lite-1.082.html
```
Expected: two IDENTICAL hashes (`index.html` == `lite-1.082.html`). If they differ, STOP — the base has drifted; report to the user before copying anything.

- [ ] **Step 2: Copy and verify the copy**

Run:
```bash
cp lite-1.082.html lite-1.083.html
diff lite-1.082.html lite-1.083.html && echo "COPY CLEAN"
```
Expected: `COPY CLEAN` (empty diff).

- [ ] **Step 3: Commit**

```bash
git add lite-1.083.html
git commit -m "chore(lite-1.083): branch from lite-1.082 (== live root)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01JeastqWexZhwQCc1oFXkZh"
```

---

### Task 2: +CHORDS rename (with verify harness)

**Files:**
- Modify: `lite-1.083.html` (the `#chordsModeBtn` button tag — find by searching `rail-chordify`)
- Create: `_verify_lite_1083.js` (harness + CH test block)

**Interfaces:**
- Consumes: `lite-1.083.html` from Task 1.
- Produces: `_verify_lite_1083.js` with the shared harness (`serve()`, `ok()`, `boot(ctx)`) that Tasks 3–5 append test blocks to. Insertion anchor for later blocks: the line `// === END TESTS ===`.

- [ ] **Step 1: Write the failing test — create `_verify_lite_1083.js`**

Create the file with this exact content (harness cloned from `_verify_lite_1082.js`, same boot recipe: EULA localStorage → guest button → `body.signed-in`):

```js
// _verify_lite_1083.js — lite-1.083: +CHORDS rename, mobile scratch pad, lyric-color bleed fix
const { chromium } = require('playwright-core');
const http = require('http'); const fs = require('fs'); const path = require('path');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ROOT = __dirname;
let PASS = 0, FAIL = 0;
const ok = (c, m) => { if (c) { PASS++; console.log('PASS', m); } else { FAIL++; console.log('FAIL', m); } };

function serve() {
  return new Promise(res => {
    const s = http.createServer((req, rq) => {
      let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/lite-1.083.html';
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
  await page.goto(`http://localhost:${port}/lite-1.083.html`, { waitUntil: 'domcontentloaded' });
  await page.click('.auth-btn.ghost');
  await page.waitForSelector('body.signed-in', { timeout: 15000 });
  await page.evaluate(() => createSong());
  await page.waitForSelector('#screen-song.active', { timeout: 5000 });
  return page;
}

(async () => {
  const src = fs.readFileSync(path.join(ROOT, 'lite-1.083.html'), 'utf8');

  // ── CH: +CHORDS rename ──
  ok(!src.includes('C<br>H<br>O<br>R<br>D<br>I<br>F<br>Y'), 'CH1 source: stacked CHORDIFY label gone');
  ok(src.includes('aria-label="Add chords">+<br>C<br>H<br>O<br>R<br>D<br>S</button>'), 'CH2 source: +CHORDS label with aria-label "Add chords"');
  ok(src.includes('title="Add chords by tapping words"'), 'CH3 source: tooltip unchanged');

  const srv = await serve(); const port = srv.address().port;
  const browser = await chromium.launch({
    executablePath: CHROME, headless: true,
    args: ['--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
  });

  const desk = await browser.newContext({ viewport: { width: 1200, height: 800 } });
  await desk.addInitScript(() => { try { localStorage['drafthaus-eula-accepted'] = '1'; } catch (e) {} });
  const dpage = await boot(desk, port);

  const ch4 = await dpage.evaluate(() => {
    const btn = document.getElementById('chordsModeBtn');
    const label = btn.textContent;                    // <br>-separated letters concatenate
    toggleChordsMode();                                // enter chords mode
    const onActive = btn.classList.contains('active');
    const edOn = document.getElementById('lyricsEditor').classList.contains('chords-mode');
    toggleChordsMode(false);                           // force off (same call _openSongObj uses)
    const offActive = btn.classList.contains('active');
    return { label, onActive, edOn, offActive };
  });
  ok(ch4.label === '+CHORDS', `CH4 button renders "+CHORDS" (got "${ch4.label}")`);
  ok(ch4.onActive && ch4.edOn && !ch4.offActive, 'CH5 toggleChordsMode logic untouched (active class + editor chords-mode)');

  // === END TESTS ===
  console.log(`\n${PASS}/${PASS + FAIL} passed`);
  await browser.close(); srv.close();
  process.exit(FAIL ? 1 : 0);
})();
```

- [ ] **Step 2: Run to verify it fails**

Run: `node _verify_lite_1083.js`
Expected: `CH1` and `CH2` FAIL (label not yet renamed), `CH3`–`CH5` PASS. Exit code 1.

- [ ] **Step 3: Rename the button**

In `lite-1.083.html`, find the `#chordsModeBtn` line (search `rail-chordify`) and replace ONLY the aria-label and inner label:

Old (end of the button tag):
```html
aria-label="Chordify">C<br>H<br>O<br>R<br>D<br>I<br>F<br>Y</button>
```
New:
```html
aria-label="Add chords">+<br>C<br>H<br>O<br>R<br>D<br>S</button>
```
Leave `onmousedown`, `onclick="toggleChordsMode()"`, `title`, and the `.rail-chordify` class untouched. No CSS or JS changes.

- [ ] **Step 4: Run to verify it passes**

Run: `node _verify_lite_1083.js`
Expected: 5/5 PASS, exit 0.

- [ ] **Step 5: Commit**

```bash
git add lite-1.083.html _verify_lite_1083.js
git commit -m "feat(lite-1.083): rename Chordify rail button to +CHORDS

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01JeastqWexZhwQCc1oFXkZh"
```

---

### Task 3: Mobile scratch pad

**Files:**
- Modify: `lite-1.083.html` — the mobile hide rule (search `#scratchPad, #scratchBtn, #inputBtn`), the scratch CSS comment (search `scratch pad — desktop-only sticky note`), and `scratchApply` (search `// default open`).
- Modify: `_verify_lite_1083.js` — insert the M/D block before `// === END TESTS ===`.

**Interfaces:**
- Consumes: harness + `boot()` from Task 2.
- Produces: mobile-enabled scratch pad. Behavior contract other code relies on: `scratchApply(s)` unchanged signature; localStorage keys `dh-lite-scratch-open` / `dh-lite-scratch-h` unchanged; `song.scratch` field unchanged.

- [ ] **Step 1: Write the failing tests**

In `_verify_lite_1083.js`, insert this block immediately BEFORE the `// === END TESTS ===` line:

```js
  // ── D: desktop scratch pad regression (unchanged behavior) ──
  const d1 = await dpage.evaluate(() => {
    const pad = document.getElementById('scratchPad'), sb = document.querySelector('.song-body');
    const pr = pad.getBoundingClientRect(), sr = sb.getBoundingClientRect();
    return {
      hidden: pad.hidden,
      w: pr.width, h: pr.height,
      rightGap: sr.right - pr.right,                       // expect 50% of song-body + 14
      halfPlus14: sr.width / 2 + 14,
      fs: getComputedStyle(document.getElementById('scratchText')).fontSize,
    };
  });
  ok(!d1.hidden, 'D1 desktop: pad default-open with no stored key');
  ok(Math.abs(d1.w - 280) < 2 && Math.abs(d1.h - 320) < 2, `D2 desktop: 280x320 unchanged (got ${d1.w}x${d1.h})`);
  ok(Math.abs(d1.rightGap - d1.halfPlus14) < 2, 'D3 desktop: position right:calc(50% + 14px) unchanged');
  ok(d1.fs === '14px', 'D4 desktop: textarea font 14px unchanged');

  // ── M: mobile scratch pad ──
  const mob = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await mob.addInitScript(() => { try { localStorage['drafthaus-eula-accepted'] = '1'; } catch (e) {} });
  const mpage = await boot(mob, port);

  const m1 = await mpage.evaluate(() => ({
    btnShown: getComputedStyle(document.getElementById('scratchBtn')).display !== 'none',
    inputHidden: getComputedStyle(document.getElementById('inputBtn')).display === 'none',
    padHidden: document.getElementById('scratchPad').hidden,
    btnOn: document.getElementById('scratchBtn').classList.contains('on'),
  }));
  ok(m1.btnShown, 'M1 mobile: scratch rail button visible');
  ok(m1.inputHidden, 'M2 mobile: input-device button still hidden');
  ok(m1.padHidden && !m1.btnOn, 'M3 mobile: pad default-CLOSED with no stored key');

  await mpage.evaluate(() => toggleScratch());
  const m4 = await mpage.evaluate(() => {
    const pad = document.getElementById('scratchPad'), sb = document.querySelector('.song-body');
    const pr = pad.getBoundingClientRect(), sr = sb.getBoundingClientRect();
    return {
      hidden: pad.hidden, stored: localStorage.getItem('dh-lite-scratch-open'),
      w: pr.width, h: pr.height, rightGap: sr.right - pr.right,
      fs: getComputedStyle(document.getElementById('scratchText')).fontSize,
    };
  });
  ok(!m4.hidden && m4.stored === '1', 'M4 mobile: toggle opens pad and persists open state');
  ok(Math.abs(m4.w - 273) < 2, `M5 mobile: width min(280px,70vw) => 273 on 390w (got ${m4.w})`);
  ok(Math.abs(m4.h - 220) < 2, `M6 mobile: default height 220 (got ${m4.h})`);
  ok(Math.abs(m4.rightGap - 66) < 2, `M7 mobile: anchored 66px from song-body right — 14px clear of the 52px rail (got ${m4.rightGap})`);
  ok(m4.fs === '16px', 'M8 mobile: textarea font 16px (no iOS focus-zoom)');

  const m9 = await mpage.evaluate(async () => {
    const ta = document.getElementById('scratchText');
    ta.value = 'riff idea: Em -> C'; scratchInput();
    await new Promise(r => setTimeout(r, 750));          // > 600ms debounce
    return { model: _currentSong.scratch, saved: _scratchLastSaved };
  });
  ok(m9.model === 'riff idea: Em -> C' && m9.saved === 'riff idea: Em -> C', 'M9 mobile: typing flows through scratchInput -> flush (song.scratch path unchanged)');

  const m10 = await mpage.evaluate(() => {
    toggleScratch();                                      // close -> stores '0'
    scratchApply({ scratch: 'from another song' });       // re-entering a song
    return {
      hidden: document.getElementById('scratchPad').hidden,
      text: document.getElementById('scratchText').value,
      stored: localStorage.getItem('dh-lite-scratch-open'),
    };
  });
  ok(m10.hidden && m10.stored === '0' && m10.text === 'from another song', 'M10 mobile: stored closed-state wins over default; scratch text loads');

```

- [ ] **Step 2: Run to verify it fails**

Run: `node _verify_lite_1083.js`
Expected: D1–D4 PASS (desktop untouched); M1 FAILS (button display:none), M3 fails (pad default-open logic), M5–M8 fail. Exit 1.

- [ ] **Step 3: Implement — CSS**

In `lite-1.083.html`:

(a) Search `scratch pad — desktop-only sticky note` and update the comment:
Old:
```css
/* scratch pad — desktop-only sticky note, scroll-locked (absolute in .song-body; only #lyricsEditor scrolls) */
```
New:
```css
/* scratch pad — sticky note, scroll-locked (absolute in .song-body; only #lyricsEditor scrolls) */
```

(b) Search `#scratchPad, #scratchBtn, #inputBtn` and replace the whole mobile rule:
Old:
```css
@media (max-width: 767px) { #scratchPad, #scratchBtn, #inputBtn { display: none !important; } }
```
New:
```css
@media (max-width: 767px) {
  #inputBtn { display: none !important; }
  /* mobile sticky: smaller, top-right of the full-width lyrics area (14px clear of the 52px rail);
     a stored dh-lite-scratch-h inline height still wins over the 220px default, as designed */
  #scratchPad { right: 66px; width: min(280px, 70vw); height: 220px; }
  #scratchText { font-size: 16px; }   /* <16px triggers iOS Safari focus-zoom */
}
```

(c) Search `<!-- scratch pad (desktop sticky note) -->` and change to `<!-- scratch pad (sticky note) -->`. Also search `/* ── Scratch pad (desktop sticky note) ── */` and change to `/* ── Scratch pad (sticky note) ── */`.

- [ ] **Step 4: Implement — JS open-state default**

In `scratchApply` (search `// default open`):
Old:
```js
  const open = localStorage.getItem('dh-lite-scratch-open') !== '0';   // default open
```
New:
```js
  const stored = localStorage.getItem('dh-lite-scratch-open');
  // Unset default: open on desktop, closed on mobile (key is per-device; any toggle wins on both).
  const open = stored === null ? matchMedia('(min-width: 768px)').matches : stored !== '0';
```
`toggleScratch`, `scratchInput`, `scratchFlush`, `scratchResizeStart` are NOT modified.

- [ ] **Step 5: Run to verify it passes**

Run: `node _verify_lite_1083.js`
Expected: all CH + D + M asserts PASS (15/15 at this point), exit 0.

- [ ] **Step 6: Commit**

```bash
git add lite-1.083.html _verify_lite_1083.js
git commit -m "feat(lite-1.083): mobile scratch pad — sticky note on phones, default collapsed

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01JeastqWexZhwQCc1oFXkZh"
```

---

### Task 4: Reproduce the lyric-color bleed (gate — no fix without a failing repro)

**Files:**
- Create: `/private/tmp/claude-501/-Users-jasoncraig-Documents-Claude-Projects-Drafthaus/92e3bf71-be7f-4289-b893-3afc2008610f/scratchpad/_repro_color_bleed.js` (scratch investigation script — NOT committed)

**Interfaces:**
- Consumes: harness pattern from `_verify_lite_1083.js` (copy `serve()`/`boot()` into the repro script).
- Produces: a documented, deterministic repro (which variant fires, captured before/after `#lyricsEditor.innerHTML`). Task 5 consumes this. If NO variant reproduces, STOP the whole plan and report to the user (do not proceed to Task 5 or 7 with a speculative fix).

**User's reported recipe (2026-07-15):** fresh lyric lines, NO chords in the doc, drag-selected a line, tapped a non-red swatch → selected line got the chosen color AND the line above turned red (`#d94848` = `FMT_ACCENTS[0]`, never applied by the user).

- [ ] **Step 1: Write the repro script**

Create `_repro_color_bleed.js` in the scratchpad dir. Clone `serve()`, browser launch, and `boot()` from `_verify_lite_1083.js` (desktop context 1200×800), then run these variants in order, printing `ed.innerHTML` before and after each color application. The bleed check after every variant:

```js
// Shared helpers (top of file, after boot()):
const RED = /#d94848|rgb\(217,\s*72,\s*72\)/i;
async function bleedCheck(page, label) {
  const r = await page.evaluate(() => {
    const ed = document.getElementById('lyricsEditor');
    const lines = [...ed.children].map(el => el.outerHTML);
    return { html: ed.innerHTML, lines };
  });
  const redAnywhere = RED.test(r.html);
  console.log(`\n[${label}] red-present=${redAnywhere}`);
  r.lines.forEach((l, i) => console.log(`  line${i}: ${l}`));
  return redAnywhere;
}

// V1 — programmatic range over the middle line, green swatch (spec recipe, cheapest):
await page.evaluate(() => {
  const ed = document.getElementById('lyricsEditor');
  ed.innerHTML = '<div>alpha alpha alpha</div><div>bravo bravo bravo</div><div>charlie charlie</div>';
  const r = document.createRange(); r.selectNodeContents(ed.children[1]);
  const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
  fmtColor('#2f9e44');
});
const v1 = await bleedCheck(page, 'V1 programmatic-range + green');

// V2 — REAL typing + REAL mouse drag (matches the user's physical actions):
//   click into the editor, type three lines with Enter, then mouse-drag across line 2
//   (use element bounding boxes: mouse.move to start of the line's text, mouse.down,
//   move to its end, mouse.up), wait 200ms for the fmt bar debounce, then call
//   fmtColor('#2f9e44') via evaluate (tapping the real swatch button is fine too).
//   Repeat the drag RIGHT-TO-LEFT (upward/backward selection) as V2b.

// V3 — history pollution: apply RED to line 1 first, undo-less, then color line 2 green.
//   (Tests suspect #2: Enter/split cloning wrappers from an earlier red edit.)
await page.evaluate(() => {
  const ed = document.getElementById('lyricsEditor');
  ed.innerHTML = '<div>alpha</div><div>bravo</div><div>charlie</div>';
  let r = document.createRange(); r.selectNodeContents(ed.children[0]);
  let sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
  fmtColor('#d94848');                                    // deliberate red on line 0
  // now clear line 0 back to default, then color line 1 green
  r = document.createRange(); r.selectNodeContents(ed.children[0]);
  sel.removeAllRanges(); sel.addRange(r);
  fmtColor('');                                           // default swatch (sentinel rewrite path)
  r = document.createRange(); r.selectNodeContents(ed.children[1]);
  sel.removeAllRanges(); sel.addRange(r);
  fmtColor('#2f9e44');
});
const v3 = await bleedCheck(page, 'V3 prior-red + default-clear + green');

// V4 — save/reload cycle: after V2, run onLyricsInput + flushLyrics, then
//   scratchApply-style re-render: evaluate
//   `document.getElementById('lyricsEditor').innerHTML = ilSanitizeDocHtml(document.getElementById('lyricsEditor').innerHTML)`
//   and re-check — does sanitize/re-render manufacture or reveal red?

// V5 — dark theme: repeat V2 in a context created with { colorScheme: 'dark' }.
```

Write V2/V4/V5 out fully in the script (they are sketched above to fix intent; the script must contain the complete playwright code — real `page.mouse.move/down/up` coordinates from `boundingBox()` of the line elements, real `page.keyboard.type` calls).

- [ ] **Step 2: Run and record the verdict**

Run: `node <scratchpad>/_repro_color_bleed.js`
Expected: at least one variant prints `red-present=true` with red inside a line the variant never applied red to. Record WHICH variant and save the before/after innerHTML output.

- [ ] **Step 3: Gate decision**

- Reproduced → proceed to Task 5.
- NOT reproduced by any variant → STOP. Report to the user: which variants ran, the captured HTML, and ask for their exact live steps (device, theme, whether the doc had any earlier red edits, screen recording if possible). Do NOT write a speculative fix; do NOT run Task 7.

---

### Task 5: Root-cause and fix the bleed

**Files:**
- Modify: `lite-1.083.html` (site depends on diagnosis — the fmt toolbar block lives between `const FMT_ACCENTS` and `fmtColor`; search those names)
- Modify: `_verify_lite_1083.js` — add the CB regression block before `// === END TESTS ===`.

**Interfaces:**
- Consumes: the firing variant + captured HTML from Task 4.
- Produces: fix in `lite-1.083.html`; CB asserts green. The fix must not change `fmtColor(hex)` / `fmtCmd(cmd)` / `fmtSetSize(key)` signatures (inline onclick handlers reference them).

- [ ] **Step 1: Localize the stage that introduces red**

Use superpowers:systematic-debugging. In the repro script, capture `ed.innerHTML` at each stage of the firing variant's pipeline and diff between stages to find WHERE red first appears:
1. before `document.execCommand('foreColor', ...)`;
2. immediately after execCommand (before any rewrite);
3. after `fmtColor`'s default-swatch rewrite pass (`font[color]` sentinel rewrite + `querySelectorAll('[style*="color"]')` pass);
4. after `_atomizeLyricChords()`;
5. after `onLyricsInput()`;
6. after a sanitize/re-render round-trip (`ilSanitizeDocHtml`).

To instrument without editing the app file, wrap in the repro script via `page.evaluate`: save originals (`const _ec = document.execCommand.bind(document)`) and interpose logging, or simply call the pipeline pieces stepwise instead of `fmtColor` (its body is small — replicate it inline stage by stage).

- [ ] **Step 2: Fix at the convicted stage — minimal, at the root**

Known suspects → likely fix shapes (implement ONLY the one the diff convicts; these are guides, not license to patch symptoms):
- **execCommand extends/re-anchors neighboring-line wrappers** → normalize the selection range before applying (clamp the range to the intersecting text nodes of the selected block(s)) OR post-pass that strips the injected color from nodes that were fully OUTSIDE the pre-execCommand range (capture the range's start/end containers before applying).
- **Enter/split clones old formatting wrappers** → fix belongs where lines are created/merged, not in fmtColor; strip stale `<font>`/color wrappers from freshly split empty lines.
- **Whole-editor post-processing passes** (`fmtColor`'s `[style*="color"]` rewrite, `fmtSetSize`'s `font[size="7"]` scan) repaint content outside the selection → scope the pass to the selection's `commonAncestorContainer` captured BEFORE `execCommand`.

Whatever the fix, keep it inside the fmt-toolbar block and comment the constraint the code can't show (why the range/scope capture must happen before execCommand).

- [ ] **Step 3: Re-run the full repro matrix**

Run: `node <scratchpad>/_repro_color_bleed.js`
Expected: every variant prints `red-present=false` (except V3's deliberate red-on-line-0 stage, whose FINAL state must show line 0 default-colored and no red anywhere). The chosen color must still land on the selected line — verify the green actually applied (`rgb(47, 158, 68)` present on line 1 in each variant).

- [ ] **Step 4: Add the regression block to the suite**

In `_verify_lite_1083.js`, insert before `// === END TESTS ===` (this is the distilled, permanent form of the firing variant — adjust the selection mechanics to match what Task 4 proved necessary, e.g. real mouse drag instead of programmatic range if only V2 fired):

```js
  // ── CB: color-bleed fix (lite-1.083 bug: coloring a line painted the line above red) ──
  const RED_RE = /#d94848|rgb\(217,\s*72,\s*72\)/i;
  const cb1 = await dpage.evaluate(() => {
    const ed = document.getElementById('lyricsEditor');
    ed.innerHTML = '<div>alpha alpha</div><div>bravo bravo</div><div>charlie charlie</div>';
    const r = document.createRange(); r.selectNodeContents(ed.children[1]);
    const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
    fmtColor('#2f9e44');
    return {
      html: ed.innerHTML,
      line0: ed.children[0].outerHTML,
      line2: ed.children[2] ? ed.children[2].outerHTML : '',
    };
  });
  ok(!RED_RE.test(cb1.html), 'CB1 no red anywhere after coloring middle line green');
  ok(!/font|style/i.test(cb1.line0) && !/font|style/i.test(cb1.line2), 'CB2 neighboring lines untouched (no injected wrappers)');
  ok(/2f9e44|rgb\(47,\s*158,\s*68\)/i.test(cb1.html), 'CB3 chosen color actually applied to the selection');

  // CB4 sweep: every swatch on a drag-selected middle line never alters other lines
  const cb4 = await dpage.evaluate(() => {
    const bad = [];
    for (const c of FMT_ACCENTS) {
      const ed = document.getElementById('lyricsEditor');
      ed.innerHTML = '<div>one one one</div><div>two two two</div><div>three three</div>';
      const before0 = ed.children[0].outerHTML, before2 = ed.children[2].outerHTML;
      const r = document.createRange(); r.selectNodeContents(ed.children[1]);
      const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
      fmtColor(c);
      if (ed.children[0].outerHTML !== before0 || ed.children[2].outerHTML !== before2) bad.push(c);
    }
    return bad;
  });
  ok(cb4.length === 0, `CB4 swatch sweep: no neighbor line ever changes (bad: ${cb4.join(',') || 'none'})`);

```
(If Task 4 proved only a real mouse drag reproduces, ALSO keep a mouse-drag CB assert — port the firing V2 code from the repro script verbatim.)

- [ ] **Step 5: Run the full suite**

Run: `node _verify_lite_1083.js`
Expected: all asserts PASS (19+/19+), exit 0.

- [ ] **Step 6: Check the user's saved song for damage**

The spec's self-heal decision: the fix stops NEW damage; already-saved red wrappers in the user's `lyricsDoc` are NOT auto-healed unless provably safe. Since deliberate red styling is indistinguishable from bleed-red in saved HTML, an automatic heal is NOT safe — record in the commit message that existing stray red is a one-off manual fix (user deletes/re-colors the line). Do not write migration code.

- [ ] **Step 7: Commit**

```bash
git add lite-1.083.html _verify_lite_1083.js
git commit -m "fix(lite-1.083): lyric color no longer bleeds red into the line above

<one-paragraph root-cause summary from Task 5 Step 1 findings>
Saved docs with already-bled red are a one-off manual fix (deliberate vs bled red is indistinguishable — no auto-heal).

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01JeastqWexZhwQCc1oFXkZh"
```

---

### Task 6: Full regression

**Files:**
- Create: `<scratchpad>/_regress_1082_on_1083.js` (sed-retargeted copy, NOT committed)

**Interfaces:**
- Consumes: committed `lite-1.083.html`, `_verify_lite_1082.js`.
- Produces: green light for Task 7.

- [ ] **Step 1: Run the 1083 suite once more, clean**

Run: `node _verify_lite_1083.js`
Expected: all PASS, exit 0.

- [ ] **Step 2: Run the 1082 suite retargeted at the new build**

```bash
SP=/private/tmp/claude-501/-Users-jasoncraig-Documents-Claude-Projects-Drafthaus/92e3bf71-be7f-4289-b893-3afc2008610f/scratchpad
sed 's/lite-1\.082\.html/lite-1.083.html/g' _verify_lite_1082.js > "$SP/_regress_1082_on_1083.js"
node "$SP/_regress_1082_on_1083.js"
```
Expected: `15/15 passed`, exit 0. (Per memory: the 1.080-suite A3 flake caveat applies to the 1080 suite, not this one — but if anything fails here, re-run once before investigating.)

- [ ] **Step 3: If anything fails** — fix on `lite-1.083.html`, amend or add a commit, re-run BOTH suites from scratch. Do not proceed until both are green in the same run.

---

### Task 7: Push and promote to root (pre-authorized)

**Files:**
- Modify: `index.html` (becomes byte-identical to `lite-1.083.html`)

**Interfaces:**
- Consumes: green Task 6. If Task 4 gated (bug not reproduced), this task does NOT run — report to the user instead.
- Produces: live deploy — `drafthaus.ca` == `drafthaus.ca/lite-1.083.html` == `lite-1.083.html`.

- [ ] **Step 1: Confirm working tree state**

Run: `git status --short`
Expected: only `.DS_Store` (pre-existing) and untracked scratch files. `lite-1.083.html` and `_verify_lite_1083.js` fully committed. Anything else unexpected → resolve before pushing.

- [ ] **Step 2: Promote to root**

```bash
cp lite-1.083.html index.html
diff lite-1.083.html index.html && echo "PROMOTE CLEAN"
git add index.html
git commit -m "release: promote lite-1.083 to root — +CHORDS, mobile scratch pad, lyric-color bleed fix live

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01JeastqWexZhwQCc1oFXkZh"
```
Expected: `PROMOTE CLEAN` before the add.

- [ ] **Step 3: Push (deploys via GitHub Pages)**

```bash
git push
```

- [ ] **Step 4: Confirm live deploy by md5**

Pages deploys lag 1–3 minutes. Poll until BOTH match the local hash:
```bash
LOCAL=$(md5 -q lite-1.083.html)
curl -s https://drafthaus.ca/lite-1.083.html | md5
curl -s https://drafthaus.ca/ | md5
```
Expected: both curl hashes == `$LOCAL`. Retry every ~30s up to ~5 minutes; if still mismatched after that, check the Pages build (`gh run list --limit 3`) and report.

- [ ] **Step 5: Report**

Tell the user: live URLs, suite counts (1083 suite + 15/15 regression), the color-bleed root cause in one paragraph, and the note that any already-saved stray red in their song is a one-line manual re-color (no auto-heal, by design). Flag iPhone QA items: scratch pad feel (toggle, resize drag, keyboard behavior) and +CHORDS legibility.
