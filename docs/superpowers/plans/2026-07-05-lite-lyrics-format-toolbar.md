# Lite Lyrics Format Toolbar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A selection popover in Drafthaus Lite's lyrics editor that applies bold/italic/underline, 4 named sizes, and 8 color swatches (default swatch = black in light mode, white in dark mode) to selected text.

**Architecture:** All new code lives in one `fmt*`-prefixed block inside `lite-1.076.html` (a copy of `lite-1.075.html`). Formatting is applied with `document.execCommand` on the existing `#lyricsEditor` contenteditable; the theme-adaptive default color is stored as `color:var(--fmtText,#ffffff)` (sentinel-color + rewrite trick). Persistence rides the existing `onLyricsInput()` → `flushLyrics()` pipeline unchanged.

**Tech Stack:** Vanilla JS single-file HTML app; verification via `_verify_lite_1076.js` (playwright-core + installed Chrome — this repo has NO unit-test runner; the verify script IS the test suite).

**Spec:** `docs/superpowers/specs/2026-07-04-lite-lyrics-format-toolbar-design.md`

## Global Constraints

- Work ONLY in `lite-1.076.html` and `_verify_lite_1076.js`. Never touch `full.html`, `index.html`, `1.3xx.html`, or any other `lite-*.html`.
- Do NOT modify: `ilSanitizeDocHtml`, `flushLyrics`, `onLyricsInput`, `_atomizeLyricChords`, Firestore rules, or any chord-mode code. New code only *calls* these.
- All new functions/consts are prefixed `fmt`/`FMT_`/`_fmt`.
- Sizes must be exactly: title `28px`, heading `20px`, body `16px`, small `13px` (matches full app's `IL_FMT_SIZES`).
- Accent swatches (literal hex, stored as-is): `#d94848`, `#d97a1f`, `#b8860b`, `#2f9e44`, `#2f6fd0`, `#9d5fe0`, `#d6408b`.
- Default swatch stores exactly `color:var(--fmtText,#ffffff)`. Sentinel color for the rewrite: `#010203`.
- The ~76k-line-file rule applies here too (file is ~4k lines but the rule stands): locate code by searching quoted strings/function names, never by line number.
- Every toolbar button gets `onmousedown="event.preventDefault()"` (preserves the selection).
- Commit after each task; do NOT `git push` (deploys to GitHub Pages) — the user confirms pushes.
- Run the verify script as: `node _verify_lite_1076.js` from the repo root. Expected final output format: `N/N passed, 0 failed` and exit code 0.

## File Structure

- `lite-1.076.html` — the app (copy of 1.075). Two insertion points:
  - CSS: immediately before the `/* toast */` comment in the `<style>` block.
  - JS: immediately after the `_atomizeLyricChords` function (search `function _atomizeLyricChords`).
  - Theme tokens: inside the existing `:root {` and `html.dark {` blocks at the top of the `<style>`.
- `_verify_lite_1076.js` — new verify script (harness copied from `_verify_lite_1075.js`, old T1–T6 test bodies dropped, new F1–F5 blocks added by tasks).

---

### Task 1: Branch lite-1.076.html + verify harness

**Files:**
- Create: `lite-1.076.html` (byte-copy of `lite-1.075.html`)
- Create: `_verify_lite_1076.js`

**Interfaces:**
- Produces: the harness helpers every later task's test block uses — `ok(cond, msg)`, `boot(browser, port, viewport)`, `seedSong(page)` (opens song `TESTSONG` with `lyricsDoc: '<div>hello world lyrics</div>'`), and `selectAllLyrics(page)`.

- [ ] **Step 1: Copy the file and confirm the copy is exact**

```bash
cd /Users/jasoncraig/Documents/Claude/Projects/Drafthaus
cp lite-1.075.html lite-1.076.html
md5 -q lite-1.075.html lite-1.076.html
```

Expected: two identical md5 hashes (CLAUDE.md base-drift rule: always confirm a snapshot copied what you meant).

- [ ] **Step 2: Write the verify harness with one sanity assert**

Create `_verify_lite_1076.js`:

```js
// _verify_lite_1076.js — lite-1.076: lyrics selection format toolbar (color/size/B·I·U)
const { chromium } = require('playwright-core');
const http = require('http'); const fs = require('fs'); const path = require('path');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ROOT = __dirname;
let PASS = 0, FAIL = 0;
const ok = (c, m) => { if (c) { PASS++; console.log('PASS', m); } else { FAIL++; console.log('FAIL', m); } };

function serve() {
  return new Promise(res => {
    const s = http.createServer((req, rq) => {
      let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/lite-1.076.html';
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

async function boot(browser, port, viewport) {
  const ctx = await browser.newContext({ viewport });
  await ctx.addInitScript(() => { try { localStorage['drafthaus-eula-accepted'] = '1'; } catch (e) {} });
  const page = await ctx.newPage();
  await page.goto(`http://localhost:${port}/lite-1.076.html`, { waitUntil: 'domcontentloaded' });
  await page.click('.auth-btn.ghost');
  await page.waitForSelector('body.signed-in', { timeout: 15000 });
  return page;
}

// Open a synthetic song with known lyrics (no network/Firestore needed).
async function seedSong(page) {
  await page.evaluate(() => {
    window._openSongObj({ id: 'TESTSONG', ownerId: 'guest', title: 'Fmt Song', key: '', lyricsDoc: '<div>hello world lyrics</div>' });
  });
  await page.waitForTimeout(300);
}

// Select the full contents of the lyrics editor (fires selectionchange).
const selectAllLyrics = (page) => page.evaluate(() => {
  const ed = document.getElementById('lyricsEditor'); ed.focus();
  const r = document.createRange(); r.selectNodeContents(ed);
  const s = getSelection(); s.removeAllRanges(); s.addRange(r);
});

(async () => {
  const srv = await serve(); const port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await boot(browser, port, { width: 390, height: 780 });   // mobile-size
  await seedSong(page);

  // ── F0: sanity — song open, lyrics rendered ──
  ok(await page.evaluate(() => document.getElementById('lyricsEditor').textContent.includes('hello world')),
    'F0 sanity: seeded lyrics render in the editor');

  // ── [test blocks F1–F5: appended by tasks 2–5 above this line] ──

  console.log(`\n${PASS}/${PASS + FAIL} passed, ${FAIL} failed`);
  await browser.close(); srv.close();
  process.exit(FAIL ? 1 : 0);
})();
```

- [ ] **Step 3: Run it**

Run: `node _verify_lite_1076.js`
Expected: `PASS F0 sanity...` then `1/1 passed, 0 failed`, exit 0.

- [ ] **Step 4: Commit**

```bash
git add lite-1.076.html _verify_lite_1076.js
git commit -m "chore(lite-1.076): branch from 1.075 + verify harness for format toolbar"
```

---

### Task 2: Theme token, toolbar shell, show/hide engine, B/I/U

**Files:**
- Modify: `lite-1.076.html` (three insertions: theme tokens, CSS, JS block)
- Modify: `_verify_lite_1076.js` (append F1+F2 blocks)

**Interfaces:**
- Consumes: existing `_chordsMode` (top-level `let`), `toggleChordsMode(on)`, `onLyricsInput()`, `#lyricsEditor`.
- Produces: `_fmtBar()` (creates/returns the `#fmtBar` element and its `#fmtSub` sibling panel), `fmtHide()`, `_fmtMaybeShow()`, `fmtCmd(cmd)` for `'bold'|'italic'|'underline'`, `fmtSync()`, `_fmtSub(anchorBtn, html)`, `_fmtCloseSub()`. Tasks 3–4 add buttons into the markup string inside `_fmtBar()` and rely on `_fmtSub`/`_fmtCloseSub`.

- [ ] **Step 1: Add the `--fmtText` theme token**

In `lite-1.076.html`, find the `:root {` block (search `--fill:      rgba(120,120,128,0.12)`) and add one line inside it:

```css
  --fmtText:   #111111;   /* lyrics "default" format color — flips white in dark */
```

Find the `html.dark {` block (search `--fill:      rgba(120,120,128,0.24)`) and add inside it:

```css
  --fmtText:   #ffffff;
```

- [ ] **Step 2: Add the toolbar CSS**

Immediately before the `/* toast */` comment in the `<style>` block, insert:

```css
/* lyrics selection format toolbar */
#fmtBar, #fmtSub { position: fixed; z-index: 1300; display: none; background: var(--bg-elev);
  border-radius: 12px; box-shadow: var(--shadow-lg); padding: 4px; align-items: center; gap: 2px; }
#fmtBar.open, #fmtSub.open { display: flex; }
#fmtBar .fmt-btn { min-width: 34px; height: 34px; border: none; background: none; border-radius: 8px;
  font-size: 15px; font-weight: 700; color: var(--text); padding: 0 8px; font-family: var(--font); }
#fmtBar .fmt-btn:active, #fmtBar .fmt-btn.on { background: var(--bg-input); }
#fmtBar .fmt-btn.fi { font-style: italic; font-weight: 600; }
#fmtBar .fmt-btn.fu { text-decoration: underline; font-weight: 600; }
#fmtBar .fmt-sep { width: .5px; align-self: stretch; margin: 5px 3px; background: var(--sep); }
#fmtSub { padding: 6px; gap: 6px; }
#fmtSub .fmt-size { border: none; background: var(--bg-input); color: var(--text); border-radius: 8px;
  padding: 5px 10px; font-weight: 600; font-family: var(--font); }
#fmtSub .fmt-sw { width: 26px; height: 26px; border-radius: 50%; border: .5px solid var(--sep); flex: none; }
```

- [ ] **Step 3: Add the JS block (shell + engine + B/I/U)**

Immediately after the `_atomizeLyricChords` function (search `function _atomizeLyricChords`, insert after its closing `}`):

```js
/* ── Selection format toolbar: color / size / B·I·U (fmt*) ── */
const FMT_SIZES = { title: '28px', heading: '20px', body: '16px', small: '13px' };
const FMT_ACCENTS = ['#d94848','#d97a1f','#b8860b','#2f9e44','#2f6fd0','#9d5fe0','#d6408b'];
const FMT_SENTINEL = '#010203';
let _fmtTimer = null;

function _fmtBar() {
  let bar = document.getElementById('fmtBar');
  if (bar) return bar;
  bar = document.createElement('div'); bar.id = 'fmtBar';
  bar.innerHTML =
    '<button class="fmt-btn" data-cmd="bold" onmousedown="event.preventDefault()" onclick="fmtCmd(\'bold\')" aria-label="Bold">B</button>' +
    '<button class="fmt-btn fi" data-cmd="italic" onmousedown="event.preventDefault()" onclick="fmtCmd(\'italic\')" aria-label="Italic">I</button>' +
    '<button class="fmt-btn fu" data-cmd="underline" onmousedown="event.preventDefault()" onclick="fmtCmd(\'underline\')" aria-label="Underline">U</button>';
  document.body.appendChild(bar);
  const sub = document.createElement('div'); sub.id = 'fmtSub';
  document.body.appendChild(sub);
  return bar;
}

// The current selection, but only if it's a real (non-collapsed) range inside the lyrics editor.
function _fmtSelRange() {
  const sel = document.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
  const ed = document.getElementById('lyricsEditor');
  if (!ed || !ed.contains(sel.anchorNode) || !ed.contains(sel.focusNode)) return null;
  return sel.getRangeAt(0);
}

function fmtHide() {
  document.getElementById('fmtBar')?.classList.remove('open');
  _fmtCloseSub();
}

function _fmtMaybeShow() {
  if (_chordsMode) { fmtHide(); return; }   // Chordify: word-taps mean "add chord"
  const r = _fmtSelRange();
  if (!r) { fmtHide(); return; }
  const bar = _fmtBar();
  bar.classList.add('open');
  const rect = r.getBoundingClientRect();
  let top = rect.top - bar.offsetHeight - 8;
  if (top < 8) top = rect.bottom + 8;   // no room above → flip below
  let left = rect.left + rect.width / 2 - bar.offsetWidth / 2;
  left = Math.max(8, Math.min(left, innerWidth - bar.offsetWidth - 8));
  bar.style.top = top + 'px'; bar.style.left = left + 'px';
  fmtSync();
}

document.addEventListener('selectionchange', () => {
  clearTimeout(_fmtTimer);
  if (!_fmtSelRange()) { fmtHide(); return; }   // collapse/leave hides immediately
  _fmtTimer = setTimeout(_fmtMaybeShow, 150);   // debounce while the selection is being dragged
});
window.addEventListener('scroll', fmtHide, true);

function fmtCmd(cmd) {
  const ed = document.getElementById('lyricsEditor'); if (!ed) return;
  document.execCommand(cmd, false, null);
  onLyricsInput(); fmtSync();
}

function fmtSync() {
  const bar = document.getElementById('fmtBar'); if (!bar) return;
  ['bold', 'italic', 'underline'].forEach(c => {
    const b = bar.querySelector('[data-cmd="' + c + '"]'); if (!b) return;
    let on = false; try { on = document.queryCommandState(c); } catch (e) {}
    b.classList.toggle('on', on);
  });
}

// Second-level panel (sizes / swatches) anchored under a bar button.
function _fmtSub(anchorBtn, html) {
  const sub = document.getElementById('fmtSub');
  if (sub.classList.contains('open') && sub.dataset.for === anchorBtn.dataset.sub) { _fmtCloseSub(); return; }
  sub.dataset.for = anchorBtn.dataset.sub || '';
  sub.innerHTML = html; sub.classList.add('open');
  const r = anchorBtn.getBoundingClientRect();
  sub.style.top = (r.bottom + 6) + 'px';
  sub.style.left = Math.max(8, Math.min(r.left, innerWidth - sub.offsetWidth - 8)) + 'px';
}
function _fmtCloseSub() {
  const s = document.getElementById('fmtSub');
  if (s) { s.classList.remove('open'); s.dataset.for = ''; }
}
```

- [ ] **Step 4: Append the F1 (show/hide) + F2 (B/I/U) test blocks**

In `_verify_lite_1076.js`, insert above the `── [test blocks F1–F5 ...]` marker:

```js
  // ── F1: popover shows on selection, hides on collapse, suppressed in Chordify, theme token flips ──
  {
    ok(await page.evaluate(() => !document.querySelector('#fmtBar.open')), 'F1 no selection → no format bar');
    await selectAllLyrics(page);
    await page.waitForTimeout(300);
    ok(await page.evaluate(() => !!document.querySelector('#fmtBar.open')), 'F1 selection → format bar opens');
    const pos = await page.evaluate(() => {
      const b = document.getElementById('fmtBar').getBoundingClientRect();
      return b.left >= 8 && b.right <= innerWidth - 8 && b.top >= 8;
    });
    ok(pos, 'F1 bar positioned inside the viewport');
    await page.evaluate(() => getSelection().removeAllRanges());
    await page.waitForTimeout(300);
    ok(await page.evaluate(() => !document.querySelector('#fmtBar.open')), 'F1 collapse → bar hides');
    await page.evaluate(() => toggleChordsMode(true));
    await selectAllLyrics(page);
    await page.waitForTimeout(300);
    ok(await page.evaluate(() => !document.querySelector('#fmtBar.open')), 'F1 Chordify mode → bar suppressed');
    await page.evaluate(() => { toggleChordsMode(false); getSelection().removeAllRanges(); });
    const tok = await page.evaluate(() => {
      const get = () => getComputedStyle(document.documentElement).getPropertyValue('--fmtText').trim();
      const light = get();
      document.documentElement.classList.add('dark'); const dark = get();
      document.documentElement.classList.remove('dark');
      return { light, dark };
    });
    ok(tok.light === '#111111' && tok.dark === '#ffffff', 'F1 --fmtText token: #111111 light / #ffffff dark');
  }

  // ── F2: B/I/U apply, reflect state, toggle off ──
  {
    await selectAllLyrics(page);
    await page.waitForTimeout(300);
    await page.click('#fmtBar [data-cmd="bold"]');
    ok(await page.evaluate(() => /<(b|strong)\b/i.test(document.getElementById('lyricsEditor').innerHTML)),
      'F2 bold applies to the selection');
    ok(await page.evaluate(() => document.querySelector('#fmtBar [data-cmd="bold"]').classList.contains('on')),
      'F2 bold button shows active state');
    await page.click('#fmtBar [data-cmd="italic"]');
    await page.click('#fmtBar [data-cmd="underline"]');
    ok(await page.evaluate(() => {
      const h = document.getElementById('lyricsEditor').innerHTML;
      return /<(i|em)\b/i.test(h) && /<u\b/i.test(h);
    }), 'F2 italic + underline apply');
    await page.click('#fmtBar [data-cmd="bold"]');   // toggle bold back off
    ok(await page.evaluate(() => !/<(b|strong)\b/i.test(document.getElementById('lyricsEditor').innerHTML)),
      'F2 bold toggles off');
    ok(await page.evaluate(() => {
      // formatting survives the sanitizer round-trip
      const ed = document.getElementById('lyricsEditor');
      const clean = ilSanitizeDocHtml(ed.innerHTML);
      return /<(i|em)\b/i.test(clean) && /<u\b/i.test(clean);
    }), 'F2 B/I/U survive ilSanitizeDocHtml');
    await page.evaluate(() => { document.execCommand('italic'); document.execCommand('underline'); getSelection().removeAllRanges(); });
  }
```

- [ ] **Step 5: Run**

Run: `node _verify_lite_1076.js`
Expected: `12/12 passed, 0 failed`, exit 0. (If the F2 click misses because the bar overlaps the selection top, the bar's flip-below branch is wrong — fix positioning, not the test.)

- [ ] **Step 6: Commit**

```bash
git add lite-1.076.html _verify_lite_1076.js
git commit -m "feat(lite-1.076): lyrics selection format bar — show/hide engine + B/I/U"
```

---

### Task 3: Sizes (Aa panel)

**Files:**
- Modify: `lite-1.076.html` (extend `_fmtBar()` markup; add `fmtOpenSizes` + `fmtSetSize`)
- Modify: `_verify_lite_1076.js` (append F3 block)

**Interfaces:**
- Consumes: `_fmtBar()`, `_fmtSub(anchorBtn, html)`, `_fmtCloseSub()`, `FMT_SIZES`, `onLyricsInput()` from Task 2.
- Produces: `fmtOpenSizes(btn)`, `fmtSetSize(key)` where `key` ∈ `'title'|'heading'|'body'|'small'`.

- [ ] **Step 1: Add the Aa button to the bar markup**

In `_fmtBar()`, extend the `bar.innerHTML` string — after the underline button, append:

```js
    '<div class="fmt-sep"></div>' +
    '<button class="fmt-btn" data-sub="size" onmousedown="event.preventDefault()" onclick="fmtOpenSizes(this)" aria-label="Text size">Aa</button>';
```

(i.e. change the trailing `';` of the underline line to `' +` and add these two lines.)

- [ ] **Step 2: Add the size functions**

After `_fmtCloseSub()` in the fmt block:

```js
function fmtOpenSizes(btn) {
  const labels = { title: 'Title', heading: 'Heading', body: 'Body', small: 'Small' };
  _fmtSub(btn, Object.keys(FMT_SIZES).map(k =>
    `<button class="fmt-size" style="font-size:${Math.min(parseInt(FMT_SIZES[k], 10), 19)}px" onmousedown="event.preventDefault()" onclick="fmtSetSize('${k}')">${labels[k]}</button>`
  ).join(''));
}

function fmtSetSize(key) {
  const ed = document.getElementById('lyricsEditor'); if (!ed || !FMT_SIZES[key]) return;
  // execCommand fontSize only accepts 1–7; apply real px by restyling the resulting
  // font elements (same trick as the full app's ilFmtSetSize).
  document.execCommand('styleWithCSS', false, false);   // ensure <font size="7"> output
  document.execCommand('fontSize', false, '7');
  ed.querySelectorAll('font[size="7"]').forEach(f => {
    f.removeAttribute('size');
    f.style.fontSize = FMT_SIZES[key];
  });
  _fmtCloseSub(); onLyricsInput();
}
```

- [ ] **Step 3: Append the F3 test block**

Above the marker in `_verify_lite_1076.js`:

```js
  // ── F3: sizes — Aa panel opens, each key writes its exact px, sanitizer keeps it ──
  {
    await selectAllLyrics(page);
    await page.waitForTimeout(300);
    await page.click('#fmtBar [data-sub="size"]');
    ok(await page.evaluate(() => document.querySelectorAll('#fmtSub.open .fmt-size').length === 4),
      'F3 Aa opens a panel with 4 size choices');
    await page.click('#fmtSub .fmt-size:first-child');   // Title = 28px
    ok(await page.evaluate(() => {
      const ed = document.getElementById('lyricsEditor');
      return /font-size:\s*28px/.test(ed.innerHTML) && !ed.querySelector('font[size]');
    }), 'F3 Title writes font-size:28px (no font[size] left behind)');
    ok(await page.evaluate(() => !document.querySelector('#fmtSub.open')), 'F3 picking a size closes the panel');
    const px = await page.evaluate(() => {
      const results = {};
      for (const [k, v] of Object.entries(FMT_SIZES)) {
        selectAllInline(); fmtSetSize(k);
        results[k] = new RegExp('font-size:\\s*' + v).test(document.getElementById('lyricsEditor').innerHTML);
      }
      function selectAllInline() {
        const ed = document.getElementById('lyricsEditor'); ed.focus();
        const r = document.createRange(); r.selectNodeContents(ed);
        const s = getSelection(); s.removeAllRanges(); s.addRange(r);
      }
      return results;
    });
    ok(px.title && px.heading && px.body && px.small, 'F3 all four sizes write their exact px values');
    ok(await page.evaluate(() => /font-size:\s*13px/.test(ilSanitizeDocHtml(document.getElementById('lyricsEditor').innerHTML))),
      'F3 font-size survives ilSanitizeDocHtml');
    await page.evaluate(() => { // reset lyrics for later blocks
      document.getElementById('lyricsEditor').innerHTML = '<div>hello world lyrics</div>';
      getSelection().removeAllRanges();
    });
  }
```

- [ ] **Step 4: Run**

Run: `node _verify_lite_1076.js`
Expected: `17/17 passed, 0 failed`, exit 0.

- [ ] **Step 5: Commit**

```bash
git add lite-1.076.html _verify_lite_1076.js
git commit -m "feat(lite-1.076): format bar sizes — Title/Heading/Body/Small (full-app px parity)"
```

---

### Task 4: Colors (swatch panel + theme-adaptive default)

**Files:**
- Modify: `lite-1.076.html` (extend `_fmtBar()` markup; add `fmtOpenSwatches` + `fmtColor`)
- Modify: `_verify_lite_1076.js` (append F4 block)

**Interfaces:**
- Consumes: `_fmtBar()`, `_fmtSub`, `_fmtCloseSub`, `FMT_ACCENTS`, `FMT_SENTINEL`, `onLyricsInput()`, existing `_atomizeLyricChords()`.
- Produces: `fmtOpenSwatches(btn)`, `fmtColor(hex)` — `fmtColor('')` (empty string) = the theme-adaptive default swatch.

- [ ] **Step 1: Add the color button to the bar markup**

In `_fmtBar()`, append to the `bar.innerHTML` string after the Aa button:

```js
    '<div class="fmt-sep"></div>' +
    '<button class="fmt-btn" data-sub="color" onmousedown="event.preventDefault()" onclick="fmtOpenSwatches(this)" aria-label="Text color"><span class="fmt-sw" style="display:inline-block;vertical-align:-6px;background:var(--fmtText)"></span></button>';
```

- [ ] **Step 2: Add the color functions**

After `fmtSetSize` in the fmt block:

```js
function fmtOpenSwatches(btn) {
  // First swatch = theme default (black in light / white in dark); shown as a split circle.
  const def = `<button class="fmt-sw" style="background:linear-gradient(135deg,#111 50%,#fff 50%)" onmousedown="event.preventDefault()" onclick="fmtColor('')" aria-label="Default color"></button>`;
  _fmtSub(btn, def + FMT_ACCENTS.map(c =>
    `<button class="fmt-sw" style="background:${c}" onmousedown="event.preventDefault()" onclick="fmtColor('${c}')"></button>`
  ).join(''));
}

function fmtColor(hex) {
  const ed = document.getElementById('lyricsEditor'); if (!ed) return;
  document.execCommand('styleWithCSS', false, false);   // <font color="..."> output
  document.execCommand('foreColor', false, hex || FMT_SENTINEL);
  if (!hex) {
    // Default swatch: rewrite the sentinel to a theme-adaptive var. In Lite, --fmtText is
    // #111 (light) / #fff (dark); in the full app the var is undefined → CSS falls back to
    // #ffffff, the full app's normal lyrics color. Both sanitizers pass var() through.
    ed.querySelectorAll('font[color]').forEach(f => {
      if ((f.getAttribute('color') || '').toLowerCase() === FMT_SENTINEL) {
        f.removeAttribute('color');
        f.style.color = 'var(--fmtText,#ffffff)';
      }
    });
  }
  _atomizeLyricChords();   // belt-and-braces: chord spans stay non-editable islands
  _fmtCloseSub(); onLyricsInput();
}
```

- [ ] **Step 3: Append the F4 test block**

```js
  // ── F4: colors — accent stores literal hex; default stores var(); theme flip changes computed color ──
  {
    await selectAllLyrics(page);
    await page.waitForTimeout(300);
    await page.click('#fmtBar [data-sub="color"]');
    ok(await page.evaluate(() => document.querySelectorAll('#fmtSub.open .fmt-sw').length === 8),
      'F4 color panel shows 8 swatches (default + 7 accents)');
    await page.click('#fmtSub .fmt-sw:nth-child(2)');   // first accent = #d94848
    ok(await page.evaluate(() => /#d94848/i.test(document.getElementById('lyricsEditor').innerHTML)),
      'F4 accent swatch stores literal hex');
    await selectAllLyrics(page);
    await page.waitForTimeout(300);
    await page.evaluate(() => fmtColor(''));            // default swatch
    const defState = await page.evaluate(() => {
      const ed = document.getElementById('lyricsEditor');
      const html = ed.innerHTML;
      const probe = ed.querySelector('[style*="--fmtText"]');
      const colLight = probe ? getComputedStyle(probe).color : '';
      document.documentElement.classList.add('dark');
      const colDark = probe ? getComputedStyle(probe).color : '';
      document.documentElement.classList.remove('dark');
      return {
        hasVar: /var\(--fmtText,\s*#ffffff\)/.test(html),
        sentinelGone: !/010203/i.test(html),
        colLight, colDark,
        survives: /var\(--fmtText,\s*#ffffff\)/.test(ilSanitizeDocHtml(html)),
      };
    });
    ok(defState.hasVar, 'F4 default swatch stores color:var(--fmtText,#ffffff)');
    ok(defState.sentinelGone, 'F4 sentinel color fully rewritten');
    ok(defState.colLight === 'rgb(17, 17, 17)', 'F4 default text computes near-black in light mode');
    ok(defState.colDark === 'rgb(255, 255, 255)', 'F4 default text computes white in dark mode (auto-switch)');
    ok(defState.survives, 'F4 var() color survives ilSanitizeDocHtml');
    // share viewer probe: viewer forces html.dark, so the same token must resolve white there
    const sv = await page.evaluate(() => {
      document.documentElement.classList.add('dark');
      const d = document.createElement('div'); d.className = 'sv-lyr-body';
      d.innerHTML = '<span style="color:var(--fmtText,#ffffff)">x</span>';
      document.body.appendChild(d);
      const c = getComputedStyle(d.firstChild).color;
      d.remove(); document.documentElement.classList.remove('dark');
      return c;
    });
    ok(sv === 'rgb(255, 255, 255)', 'F4 share-viewer (forced dark) renders default color white');
    await page.evaluate(() => getSelection().removeAllRanges());
  }
```

- [ ] **Step 4: Run**

Run: `node _verify_lite_1076.js`
Expected: `24/24 passed, 0 failed`, exit 0. (If `colLight` comes back as the sentinel or an accent color, the rewrite selector missed — check whether Chrome emitted `<font color>` or a styled span and widen the rewrite to both forms; the stored result must still be exactly the `var()` string.)

- [ ] **Step 5: Commit**

```bash
git add lite-1.076.html _verify_lite_1076.js
git commit -m "feat(lite-1.076): format bar colors — 7 fixed accents + theme-adaptive default (var --fmtText)"
```

---

### Task 5: Integration safety — chord spans, persistence round-trip, full run

**Files:**
- Modify: `_verify_lite_1076.js` (append F5 block)
- Modify: `lite-1.076.html` ONLY if F5 exposes a bug (fix inside the fmt block)

**Interfaces:**
- Consumes: everything from Tasks 2–4; existing `_atomizeLyricChords()`, `ilSanitizeDocHtml`, `currentEditorHtml()`, `onLyricsInput()`.

- [ ] **Step 1: Append the F5 test block**

```js
  // ── F5: chord-span safety + save/reload round-trip ──
  {
    await page.evaluate(() => {
      const ed = document.getElementById('lyricsEditor');
      ed.innerHTML = '<div>la <span class="chord">Am</span> la la</div>';
      _atomizeLyricChords();
    });
    await selectAllLyrics(page);
    await page.waitForTimeout(300);
    await page.evaluate(() => { fmtCmd('bold'); fmtColor('#2f6fd0'); });
    const chord = await page.evaluate(() => {
      const c = document.getElementById('lyricsEditor').querySelector('.chord');
      return c ? { text: c.textContent, atomic: c.contentEditable === 'false', cls: c.className } : null;
    });
    ok(chord && chord.text === 'Am' && chord.atomic && chord.cls === 'chord',
      'F5 formatting across a chord span leaves the chord intact and atomic');
    // simulated save → reload: what flushLyrics persists is currentEditorHtml();
    // reloading runs it through ilSanitizeDocHtml again (openSong path)
    const rt = await page.evaluate(() => {
      const saved = currentEditorHtml();
      const ed = document.getElementById('lyricsEditor');
      ed.innerHTML = ilSanitizeDocHtml(saved); _atomizeLyricChords();
      const again = currentEditorHtml();
      return { stable: saved === again, bold: /<(b|strong)\b/i.test(again), color: /#2f6fd0/i.test(again), chord: !!ed.querySelector('.chord') };
    });
    ok(rt.stable, 'F5 sanitize round-trip is stable (save === re-save)');
    ok(rt.bold && rt.color && rt.chord, 'F5 bold + color + chord all survive save/reload');
    // editing formatted text still marks the doc dirty for autosave
    const dirty = await page.evaluate(() => { _lyricsEdited = false; onLyricsInput(); return _lyricsEdited; });
    ok(dirty, 'F5 toolbar actions route through onLyricsInput (autosave pipeline engaged)');
  }
```

- [ ] **Step 2: Full run**

Run: `node _verify_lite_1076.js`
Expected: `28/28 passed, 0 failed`, exit 0.

If the chord-span assert fails (execCommand mangled the non-editable island), fix inside the fmt block only — e.g. re-run `_atomizeLyricChords()` after `fmtCmd`/`fmtSetSize` too, or normalize a chord span whose `class` was wrapped. Re-run until green.

- [ ] **Step 3: Regression sweep — old suite still passes against 1.075's twin**

The fmt block must not have disturbed existing behavior. Quick check that the app still boots clean and lyrics editing works (already covered by F0 boot + F5 pipeline assert), plus:

Run: `git diff lite-1.075.html lite-1.076.html --stat`
Expected: exactly one file changed; eyeball the diff hunks — only the three fmt insertions (tokens, CSS, JS block). Any other hunk is a mistake (CLAUDE.md snapshot-diff rule).

- [ ] **Step 4: Commit**

```bash
git add lite-1.076.html _verify_lite_1076.js
git commit -m "feat(lite-1.076): format toolbar integration asserts — chord safety + persistence round-trip"
```

---

### Task 6: Wrap-up — report for release decision

**Files:** none (reporting only)

- [ ] **Step 1: Summarize for the user**

Report: verify totals (expect 28/28), the diff stat, and the two things that still need a human:
1. **Push decision** — pushing `main` deploys `drafthaus.ca/lite-1.076.html` (GitHub Pages). Do NOT push without the user's explicit go-ahead.
2. **iPhone QA** — headless can't prove the popover coexists with the native iOS selection callout (position/tappability feel). Promotion into `index.html` (root) waits for on-device sign-off, per the standard Lite flow.

---

## Self-Review (completed)

- **Spec coverage:** UX popover + suppression (T2), B/I/U (T2), 4 sizes exact px (T3), 8 swatches + var() default + sentinel rewrite + share viewer (T4), chord safety + persistence (T5), release flow (T6). Verification list items 1–9 in the spec map to F1–F5 (spec item 7 "save→reload" is the simulated round-trip in F5 — real Firestore round-trip isn't reachable in guest headless; item 9 covered by the F4 forced-dark probe). PDF export explicitly out of scope — no task, correct.
- **Placeholders:** none; every step has full code/commands.
- **Type consistency:** `fmtCmd/fmtSync/fmtHide/_fmtBar/_fmtSub/_fmtCloseSub/fmtOpenSizes/fmtSetSize/fmtOpenSwatches/fmtColor/FMT_SIZES/FMT_ACCENTS/FMT_SENTINEL` used identically across tasks; verify helpers `ok/boot/seedSong/selectAllLyrics` defined in T1 and reused.
