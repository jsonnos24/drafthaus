# Lyrics Rich-Text Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Drafthaus's per-section lyrics system with a single freeform `contenteditable` rich-text document (TextEdit-style), with a persistent format bar (B/I/U/Mono/Size/Color/Highlight), shared across desktop and mobile.

**Architecture:** A new `song.lyricsDoc` HTML-string field becomes canonical lyrics. `ilRenderBody()` is rewritten to paint a title + format bar + one `contenteditable` doc into `#rtBodyInlineInner` (the same element perform mode reuses via `.il-perf-mode`). All consumers read through one helper `ilGetDocHtml(song)` that lazily migrates legacy per-section `song.lyrics` into the doc on first read. The old per-section blocks, import modal, Add-Section / Common-Arrangements selects, and the separate mobile lyrics modal are removed.

**Tech Stack:** Vanilla JS, `contenteditable` + `document.execCommand`, single-file `index.html` (~76k lines), no build, no test runner. Verification is browser-driven via playwright-core + installed Chrome (see CLAUDE.md "Verifying changes").

---

## Conventions for this plan

- **No unit tests exist.** Each task's verification step is either a `grep` assertion against `index.html` or a real-browser check using the playwright-core recipe in CLAUDE.md. Treat the verification step as the task's "test".
- **All work happens in a new version file `1.311.html`** (Task 1 creates it by copying `index.html`). Every later task edits **`1.311.html`**, never `index.html`. Promotion of `1.311.html` → `index.html` is deliberately the very last task and gated on iPhone sign-off — matching the repo's versioning workflow (copy-the-whole-file; see [[drafthaus-versioning-workflow]]).
- **Locate code by quoted strings / function names, not line numbers** — line numbers in this plan are approximate and drift. The grep anchors are the source of truth.
- **Commit after every task** with a `feat(1.311)` / `refactor(1.311)` / `chore(1.311)` prefix. Do **not** push or promote to `index.html` until the final task.

---

## File structure

This is a single-file app; all changes live in one file (`1.311.html`). Responsibilities are organized by code region inside that file:

- **Data layer** — `ilGetDocHtml()`, `ilMigrateLyricsToDoc()`, `ilDocToPlainText()`, `ilSanitizeDocHtml()`, `ilDocHasContent()` (new helpers, placed just above `function ilRenderBody`).
- **Editor render** — rewritten `ilRenderBody()` + new `ilDocInput()` (replaces per-section body).
- **Format bar** — new `ilFmtCmd()`, `ilFmtSetSize()`, `ilFmtColor()`, `ilFmtSyncToolbar()` (placed next to `ilRenderBody`).
- **Consumers** — edits at the perf toggle (`il-perf-mode`), practice-view render, song-list badge checks, and the Firestore/export serialization.
- **Removed regions** — import modal, Add-Section/Common-Arrangements builders, per-section block helpers, mobile lyrics modal markup + JS.

---

## Task 1: Snapshot new version file `1.311.html`

**Files:**
- Create: `1.311.html` (copy of `index.html`)

- [ ] **Step 1: Copy the current build to the new version**

```bash
cd /Users/jasoncraig/Documents/Claude/Projects/Drafthaus
cp index.html 1.311.html
```

- [ ] **Step 2: Bump the visible version marker inside the new file**

Find the version string near the top of `1.311.html`:

Run: `grep -n "1\.310" 1.311.html | head`

For each user-facing version label (e.g. a `const APP_VERSION = '1.310'` or a title/footer showing `1.310`), update `1.310` → `1.311`. If no such marker exists, skip — do not invent one.

- [ ] **Step 3: Verify the copy is byte-faithful except the version bump**

Run: `diff <(grep -v "1\.31[01]" index.html) <(grep -v "1\.31[01]" 1.311.html) && echo IDENTICAL`
Expected: `IDENTICAL` (only version-marker lines differ).

- [ ] **Step 4: Commit**

```bash
git add 1.311.html
git commit -m "chore(1.311): snapshot 1.310 → 1.311 for lyrics rich-text editor"
```

---

## Task 2: Data-layer helpers (migration, sanitize, plain-text, content check)

Add the canonical accessor + migration + sanitizer. These are pure functions with no UI, so every later task can rely on them.

**Files:**
- Modify: `1.311.html` — insert a new block immediately **above** `function ilRenderBody(song) {` (find via `grep -n "function ilRenderBody(song)" 1.311.html`).

- [ ] **Step 1: Insert the helper block above `ilRenderBody`**

Insert this code on the line directly before `function ilRenderBody(song) {`:

```javascript
// ── Lyrics doc: single rich-text document model (replaces per-section song.lyrics) ──
// Whitelist sanitizer for contenteditable HTML (untrusted on paste / cross-device sync).
function ilSanitizeDocHtml(html) {
  if (!html) return '';
  const tpl = document.createElement('template');
  tpl.innerHTML = String(html);
  const ALLOWED_TAGS = new Set(['B','I','U','STRONG','EM','SPAN','DIV','BR','H1','H2','H3','P','FONT']);
  const ALLOWED_STYLE = ['color','background-color','background','font-size','font-family','font-weight','font-style','text-decoration'];
  const walk = (node) => {
    const kids = Array.from(node.childNodes);
    for (const el of kids) {
      if (el.nodeType === Node.COMMENT_NODE) { el.remove(); continue; }
      if (el.nodeType !== Node.ELEMENT_NODE) continue;
      if (!ALLOWED_TAGS.has(el.tagName)) {
        // unwrap disallowed element, keep its text/children
        while (el.firstChild) node.insertBefore(el.firstChild, el);
        el.remove();
        continue;
      }
      // strip all attributes except a filtered style + class
      for (const attr of Array.from(el.attributes)) {
        const n = attr.name.toLowerCase();
        if (n === 'class') continue;
        if (n === 'color' || n === 'face' || n === 'size') continue; // legacy <font> attrs are safe
        if (n === 'style') {
          const clean = attr.value.split(';').map(s => s.trim()).filter(s => {
            const prop = s.split(':')[0].trim().toLowerCase();
            return ALLOWED_STYLE.includes(prop);
          }).join('; ');
          if (clean) el.setAttribute('style', clean); else el.removeAttribute('style');
          continue;
        }
        el.removeAttribute(attr.name); // drops on*, href, src, etc.
      }
      walk(el);
    }
  };
  walk(tpl.content);
  return tpl.innerHTML;
}

// Convert doc HTML → plain text (for sheet sync / export / has-content checks).
function ilDocToPlainText(html) {
  if (!html) return '';
  const div = document.createElement('div');
  div.innerHTML = String(html);
  div.querySelectorAll('br').forEach(br => br.replaceWith('\n'));
  div.querySelectorAll('div,p,h1,h2,h3').forEach(b => b.append('\n'));
  return (div.textContent || '').replace(/\n{3,}/g, '\n\n').trim();
}

function ilDocHasContent(html) {
  return ilDocToPlainText(html).length > 0;
}

// One-time migration: build lyricsDoc from legacy per-section song.lyrics, in arrangement order.
function ilMigrateLyricsToDoc(song) {
  const legacy = song.lyrics || {};
  const order = (song.sectionOrder && song.sectionOrder.length)
    ? song.sectionOrder
    : (typeof getActiveParts === 'function' ? getActiveParts(song).map(p => p.id) : Object.keys(legacy));
  const blocks = [];
  for (const pid of order) {
    const text = (legacy[pid] || '').trim();
    if (!text) continue;
    const part = (typeof STRUCTURE_PARTS !== 'undefined') ? STRUCTURE_PARTS.find(p => p.id === pid) : null;
    const label = part ? part.label : pid;
    const color = part ? part.color : '#c8a96e';
    blocks.push(`<div style="font-weight: 700; color: ${color}">${esc(label)}</div>`);
    for (const line of text.split('\n')) {
      blocks.push(line.trim() ? `<div>${esc(line)}</div>` : '<div><br></div>');
    }
    blocks.push('<div><br></div>');
  }
  return ilSanitizeDocHtml(blocks.join(''));
}

// Canonical accessor: returns lyricsDoc, lazily migrating legacy lyrics on first read.
function ilGetDocHtml(song) {
  if (!song) return '';
  if (typeof song.lyricsDoc === 'string') return song.lyricsDoc;
  const migrated = ilMigrateLyricsToDoc(song);
  song.lyricsDoc = migrated; // populate once; never destroys song.lyrics
  if (typeof save === 'function') save();
  return migrated;
}
```

- [ ] **Step 2: Verify the helpers parse and migrate correctly in a browser**

Run a headless check (adapt the CLAUDE.md recipe). After boot + song load, in page context:

```javascript
// In the page console / playwright evaluate:
const s = { lyrics: { verse: 'line one\nline two', chorus: 'hook line' }, sectionOrder: ['verse','chorus'] };
const html = ilMigrateLyricsToDoc(s);
console.log('MIGRATE:', html.includes('line one') && html.includes('hook line'));
console.log('PLAIN:', ilDocToPlainText(html).includes('line one'));
console.log('HASCONTENT:', ilDocHasContent(html) === true, ilDocHasContent('') === false);
console.log('SANITIZE:', ilSanitizeDocHtml('<b onclick="x()">hi</b><script>bad()</script>') === '<b>hi</b>');
```

Expected: all five log `true` (or the sanitized string `<b>hi</b>`).

- [ ] **Step 3: Commit**

```bash
git add 1.311.html
git commit -m "feat(1.311): lyrics doc data layer — migrate/sanitize/plaintext helpers"
```

---

## Task 3: Rewrite `ilRenderBody` — title + format bar + contenteditable doc

Replace the per-section body with the single editor. This is the core change.

**Files:**
- Modify: `1.311.html` — the body of `function ilRenderBody(song)` (find via `grep -n "function ilRenderBody(song)" 1.311.html`), specifically the `inner.innerHTML = \`...\`` template and the post-render fixups (the `ilAddWrap`/`ilRenderSplitPreview` block).

- [ ] **Step 1: Replace the `inner.innerHTML` template and post-render block**

Find this region (currently roughly):

```javascript
  const addSelHtml = ilBuildAddOptions();
  inner.innerHTML = `
    <div class="il-perf-title">${title}</div>
    <h1 class="il-song-title" contenteditable="true" spellcheck="false"
      id="ilSongTitleEl"
      onblur="ilSaveTitleEdit(this)"
      onkeydown="if(event.key==='Enter'){event.preventDefault();this.blur();}"
      style="outline:none;cursor:text;min-width:60px;"
      title="Click to edit title">${title}</h1>
    <div class="il-meta">${keyChip}${bpmChip}
      <button class="il-import-btn" onclick="ilOpenImportModal()" title="Paste your full lyrics — sections split automatically at blank lines">⇩ Write/Paste</button>
      <span id="ilAddWrap" style="display:inline-flex;">
        <select class="il-add-sel" id="ilAddSel" onchange="ilAddSection(this)">${addSelHtml}</select>
      </span>
      <select class="il-add-sel" id="ilArrangeSel" onchange="ilApplyArrangement(this)">${ilBuildArrangementOptions()}</select>
    </div>
    ${partsHtml}`;

  const addWrap = document.getElementById('ilAddWrap');
  if (addWrap) {
    const sel = document.getElementById('ilAddSel');
    addWrap.style.display = (sel && sel.options.length <= 1) ? 'none' : 'inline-flex';
  }
  // Keep split preview in sync
  ilRenderSplitPreview(song);
```

Replace the whole region (from `const addSelHtml = ilBuildAddOptions();` through `ilRenderSplitPreview(song);` inclusive) with:

```javascript
  const docHtml = ilSanitizeDocHtml(ilGetDocHtml(song));
  inner.innerHTML = `
    <div class="il-perf-title">${title}</div>
    <h1 class="il-song-title" contenteditable="true" spellcheck="false"
      id="ilSongTitleEl"
      onblur="ilSaveTitleEdit(this)"
      onkeydown="if(event.key==='Enter'){event.preventDefault();this.blur();}"
      style="outline:none;cursor:text;min-width:60px;"
      title="Click to edit title">${title}</h1>
    <div class="il-fmt-bar" id="ilFmtBar" role="toolbar" aria-label="Formatting">
      <button type="button" class="il-fmt-btn" data-cmd="bold" title="Bold (⌘B)" onmousedown="event.preventDefault()" onclick="ilFmtCmd('bold')"><b>B</b></button>
      <button type="button" class="il-fmt-btn" data-cmd="italic" title="Italic (⌘I)" onmousedown="event.preventDefault()" onclick="ilFmtCmd('italic')"><i>I</i></button>
      <button type="button" class="il-fmt-btn" data-cmd="underline" title="Underline (⌘U)" onmousedown="event.preventDefault()" onclick="ilFmtCmd('underline')"><u>U</u></button>
      <button type="button" class="il-fmt-btn" data-cmd="mono" title="Monospace (chords)" onmousedown="event.preventDefault()" onclick="ilFmtCmd('mono')">&lt;M&gt;</button>
      <span class="il-fmt-sep"></span>
      <select class="il-fmt-size" id="ilFmtSize" title="Text size" onmousedown="event.stopPropagation()" onchange="ilFmtSetSize(this.value)">
        <option value="">Size</option>
        <option value="title">Title</option>
        <option value="heading">Heading</option>
        <option value="body">Body</option>
        <option value="small">Small</option>
      </select>
      <span class="il-fmt-sep"></span>
      <button type="button" class="il-fmt-btn" title="Text color" onmousedown="event.preventDefault()" onclick="ilFmtOpenSwatches('fore', this)">A<span class="il-fmt-swatch-ind" style="background:#e0504f"></span></button>
      <button type="button" class="il-fmt-btn" title="Highlight" onmousedown="event.preventDefault()" onclick="ilFmtOpenSwatches('back', this)">▮<span class="il-fmt-swatch-ind" style="background:#f5d76e"></span></button>
    </div>
    <div class="il-lyrics-doc" id="ilLyricsDoc" contenteditable="true" spellcheck="true"
      data-placeholder="Write your lyrics…"
      oninput="ilDocInput(this)">${docHtml}</div>`;
```

- [ ] **Step 2: Delete the now-unused `partsHtml` / chip locals at the top of `ilRenderBody`**

Near the top of `ilRenderBody`, remove the per-section assembly that is no longer referenced:

```javascript
  let partsHtml = '';
  if (_rtActiveParts.length === 0) {
    partsHtml = '';
  } else {
    partsHtml = _rtActiveParts.map(part => ilMakePartHtml(part, song)).join('');
  }
```

Delete that entire block. Leave `keyChip`/`bpmChip` only if still referenced; since the new template no longer uses `${keyChip}${bpmChip}`, also delete those two `const` lines.

- [ ] **Step 3: Add the `ilDocInput` handler**

Immediately after `function ilRenderBody(song) { ... }` closes, add:

```javascript
let _ilDocSaveTimer = null;
function ilDocInput(el) {
  const song = getCurrentSong();
  if (!song) return;
  song.lyricsDoc = ilSanitizeDocHtml(el.innerHTML);
  clearTimeout(_ilDocSaveTimer);
  _ilDocSaveTimer = setTimeout(() => {
    save();
    if (typeof scheduleSyncToSheet === 'function') scheduleSyncToSheet(song);
  }, 600);
}
// Flush pending lyrics save immediately (call on blur / view-close).
function ilDocFlush() {
  const el = document.getElementById('ilLyricsDoc');
  const song = getCurrentSong();
  if (el && song) song.lyricsDoc = ilSanitizeDocHtml(el.innerHTML);
  clearTimeout(_ilDocSaveTimer);
  if (song) { save(); if (typeof scheduleSyncToSheet === 'function') scheduleSyncToSheet(song); }
}
```

- [ ] **Step 4: Add minimal CSS for the doc + placeholder**

Find the Google-Docs page CSS anchor: `grep -n "Google Docs–style page view" 1.311.html`. Directly after that rule block, add:

```css
.il-lyrics-doc {
  outline: none;
  min-height: 50vh;
  padding: 18px 22px;
  line-height: 1.7;
  font-size: 16px;
  white-space: pre-wrap;
  word-break: break-word;
}
.il-lyrics-doc:empty::before {
  content: attr(data-placeholder);
  color: rgba(255,255,255,0.25);
  pointer-events: none;
}
#songViewRunthrough.il-perf-mode .il-lyrics-doc:empty::before { color: rgba(0,0,0,0.25); }
.il-lyrics-doc [data-mono], .il-lyrics-doc .il-mono { font-family: 'IBM Plex Mono', monospace; }
```

- [ ] **Step 5: Verify the editor renders and persists**

Browser check: load a song, open the lyrics view (`navToolTap('lyrics')` or the lyrics toggle). Confirm:
- A title, a format bar (`#ilFmtBar`), and an editable `#ilLyricsDoc` appear.
- No `⇩ Write/Paste` button, no Add-Section select, no Common-Arrangements select, no per-section blocks.
- Type text, switch to another tool and back; text persists.

```javascript
// playwright evaluate after opening lyrics:
!!document.getElementById('ilLyricsDoc') &&
!!document.getElementById('ilFmtBar') &&
!document.querySelector('.il-import-btn') &&
!document.getElementById('ilArrangeSel') &&
!document.querySelector('.il-part')
```

Expected: `true`.

- [ ] **Step 6: Commit**

```bash
git add 1.311.html
git commit -m "feat(1.311): rewrite lyrics view as single contenteditable doc + format bar"
```

---

## Task 4: Format-bar commands (B/I/U/Mono/Size/Color/Highlight) + active-state sync

**Files:**
- Modify: `1.311.html` — add the `ilFmt*` functions next to `ilDocInput` (same script region); add format-bar CSS next to the `.il-lyrics-doc` rules.

- [ ] **Step 1: Add the format-command functions**

After `ilDocFlush` (from Task 3), add:

```javascript
function _ilDocFocus() {
  const el = document.getElementById('ilLyricsDoc');
  if (el) el.focus();
  return el;
}
function ilFmtCmd(cmd) {
  const el = _ilDocFocus();
  if (!el) return;
  if (cmd === 'mono') {
    // Toggle monospace on the selection by wrapping in a styled span via fontName.
    document.execCommand('fontName', false, 'IBM Plex Mono, monospace');
  } else {
    document.execCommand(cmd, false, null);
  }
  ilDocInput(el);
  ilFmtSyncToolbar();
}
const IL_FMT_SIZES = { title: '28px', heading: '20px', body: '16px', small: '13px' };
function ilFmtSetSize(key) {
  const el = _ilDocFocus();
  if (!el || !IL_FMT_SIZES[key]) { const s = document.getElementById('ilFmtSize'); if (s) s.value = ''; return; }
  // execCommand fontSize only accepts 1–7; apply real px by styling the resulting font elements.
  document.execCommand('fontSize', false, '7');
  el.querySelectorAll('font[size="7"]').forEach(f => {
    f.removeAttribute('size');
    f.style.fontSize = IL_FMT_SIZES[key];
  });
  const s = document.getElementById('ilFmtSize'); if (s) s.value = '';
  ilDocInput(el);
}
const IL_FORE_SWATCHES = ['#ffffff','#e0504f','#f5a623','#f5d76e','#7ed957','#4a9eff','#c8a96e','#b06ff5'];
const IL_BACK_SWATCHES = ['#fff3a0','#ffd1d1','#d1ffd6','#d1e8ff','#f0d1ff','#ffe0b3','#e6e6e6','transparent'];
function ilFmtOpenSwatches(kind, anchorBtn) {
  document.querySelector('.il-fmt-swatches')?.remove();
  const swatches = kind === 'fore' ? IL_FORE_SWATCHES : IL_BACK_SWATCHES;
  const pop = document.createElement('div');
  pop.className = 'il-fmt-swatches';
  pop.innerHTML = swatches.map(c =>
    `<button type="button" class="il-fmt-swatch" style="background:${c === 'transparent' ? 'repeating-conic-gradient(#888 0 25%, #ccc 0 50%) 50%/8px 8px' : c}"
      onmousedown="event.preventDefault()" onclick="ilFmtColor('${kind}','${c}')"></button>`
  ).join('') + `<button type="button" class="il-fmt-swatch il-fmt-swatch-none" onmousedown="event.preventDefault()" onclick="ilFmtColor('${kind}','none')">⦸</button>`;
  anchorBtn.style.position = 'relative';
  anchorBtn.appendChild(pop);
  const open = Date.now();
  const close = e => { if (Date.now() - open < 200) return; if (!pop.contains(e.target)) { pop.remove(); document.removeEventListener('click', close, true); } };
  setTimeout(() => document.addEventListener('click', close, true), 10);
}
function ilFmtColor(kind, color) {
  document.querySelector('.il-fmt-swatches')?.remove();
  const el = _ilDocFocus();
  if (!el) return;
  if (kind === 'fore') {
    document.execCommand('foreColor', false, color === 'none' ? '#ffffff' : color);
  } else {
    document.execCommand('hiliteColor', false, color === 'none' ? 'transparent' : color);
  }
  ilDocInput(el);
}
function ilFmtSyncToolbar() {
  const bar = document.getElementById('ilFmtBar');
  if (!bar) return;
  ['bold','italic','underline'].forEach(cmd => {
    const btn = bar.querySelector(`[data-cmd="${cmd}"]`);
    if (btn) btn.classList.toggle('il-fmt-active', document.queryCommandState(cmd));
  });
}
```

- [ ] **Step 2: Wire `selectionchange` to sync the toolbar active states**

Find where global one-time listeners are attached (search for an existing `document.addEventListener('selectionchange'` or, if none, add near the lyrics init). Add:

```javascript
document.addEventListener('selectionchange', () => {
  const sel = document.getSelection();
  if (sel && sel.anchorNode && document.getElementById('ilLyricsDoc')?.contains(sel.anchorNode)) {
    ilFmtSyncToolbar();
  }
});
```

- [ ] **Step 3: Add format-bar CSS**

After the `.il-lyrics-doc` CSS from Task 3, add:

```css
.il-fmt-bar {
  position: sticky; top: 0; z-index: 5;
  display: flex; align-items: center; gap: 4px;
  padding: 6px 10px; margin-bottom: 6px;
  background: var(--surface); border-bottom: 1px solid var(--border);
  overflow-x: auto; -webkit-overflow-scrolling: touch;
}
.il-fmt-btn {
  position: relative; min-width: 30px; height: 28px; padding: 0 7px;
  background: transparent; color: var(--text);
  border: 1px solid transparent; border-radius: 6px; cursor: pointer;
  font-size: 14px; line-height: 1; white-space: nowrap;
}
.il-fmt-btn:hover { background: rgba(255,255,255,0.06); }
.il-fmt-btn.il-fmt-active { background: rgba(200,169,110,0.22); border-color: rgba(200,169,110,0.5); }
.il-fmt-swatch-ind { display:inline-block; width:7px; height:7px; border-radius:2px; margin-left:3px; vertical-align:middle; }
.il-fmt-sep { width:1px; height:18px; background: var(--border); margin:0 4px; flex:0 0 auto; }
.il-fmt-size { height:28px; background: var(--surface); color: var(--text); border:1px solid var(--border); border-radius:6px; font-size:12px; }
.il-fmt-swatches {
  position: absolute; top: 32px; left: 0; z-index: 20;
  display: grid; grid-template-columns: repeat(3, 22px); gap: 5px;
  padding: 8px; background: var(--surface); border:1px solid var(--border); border-radius:8px;
  box-shadow: 0 6px 24px rgba(0,0,0,0.4);
}
.il-fmt-swatch { width:22px; height:22px; border-radius:5px; border:1px solid rgba(255,255,255,0.25); cursor:pointer; }
.il-fmt-swatch-none { background: var(--surface); color: var(--text); font-size:13px; }
/* perf mode: format bar hidden, doc read-only (set via JS) */
#songViewRunthrough.il-perf-mode .il-fmt-bar { display: none; }
```

- [ ] **Step 4: Verify every command applies and survives reload**

Browser check in lyrics view: select text, click B/I/U → text styles toggle and the button shows `.il-fmt-active`. Click Mono → selection becomes monospace. Pick a Size → size changes. Pick a text color and a highlight → colors apply. Reload the song (re-open) and confirm formatting persisted (it round-trips through `ilSanitizeDocHtml`).

```javascript
// after applying bold to a selection programmatically is awkward; verify manually,
// then assert persistence shape:
const doc = document.getElementById('ilLyricsDoc');
ilDocFlush();
const s = getCurrentSong();
console.log('PERSIST:', typeof s.lyricsDoc === 'string' && s.lyricsDoc === ilSanitizeDocHtml(doc.innerHTML));
```

Expected: `PERSIST: true`, and visually B/I/U/Mono/Size/Color/Highlight all work.

- [ ] **Step 5: Commit**

```bash
git add 1.311.html
git commit -m "feat(1.311): format bar commands — B/I/U/Mono/size/color/highlight + active sync"
```

---

## Task 5: Perform-mode integration (read-only doc, no format bar)

Perform mode reuses `#rtBodyInlineInner` by toggling `.il-perf-mode` on `#songViewRunthrough`. The CSS in Task 4 already hides the format bar in perf mode; this task makes the doc non-editable while performing and editable while editing.

**Files:**
- Modify: `1.311.html` — the perf toggle (find via `grep -n "classList.toggle('il-perf-mode', on)" 1.311.html`).

- [ ] **Step 1: Toggle doc editability with perf mode**

Find the line:

```javascript
  if (rtEl) rtEl.classList.toggle('il-perf-mode', on);
```

Immediately after it, add:

```javascript
  const _ilDoc = document.getElementById('ilLyricsDoc');
  if (_ilDoc) _ilDoc.setAttribute('contenteditable', on ? 'false' : 'true');
  if (on && typeof ilDocFlush === 'function') ilDocFlush(); // save before performing
```

- [ ] **Step 2: Also handle the other perf-off path**

Find the other anchor:

```javascript
  if (rtEl) rtEl.classList.remove('il-perf-mode');
```

Immediately after it, add:

```javascript
  const _ilDocOn = document.getElementById('ilLyricsDoc');
  if (_ilDocOn) _ilDocOn.setAttribute('contenteditable', 'true');
```

- [ ] **Step 3: Verify perform mode shows the doc read-only**

Browser check: type lyrics in edit mode → toggle into perform mode (the bottom-nav lyrics toggle / `il-perf-mode`). Confirm the same text shows, the format bar is gone, and the doc is not editable (typing does nothing). Toggle back → editable again.

```javascript
// in perf mode:
document.getElementById('ilLyricsDoc').getAttribute('contenteditable') === 'false' &&
getComputedStyle(document.getElementById('ilFmtBar')).display === 'none'
```

Expected: `true` in perf mode; `false`/visible back in edit mode.

- [ ] **Step 4: Commit**

```bash
git add 1.311.html
git commit -m "feat(1.311): perform mode renders lyrics doc read-only, hides format bar"
```

---

## Task 6: Repoint remaining consumers (practice view, song-list badges, serialization)

**Files:**
- Modify: `1.311.html` at the practice-view lyrics render, the two song-list `hasLyrics` checks, and the Firestore/export serialization.

- [ ] **Step 1: Song-list / card "has lyrics" badge (list view)**

Find: `grep -n "const hasLyrics = Object.values(song.lyrics" 1.311.html` (the list-view occurrence — there are two identical lines ~19451 and ~19651). Replace **both** occurrences:

```javascript
    const hasLyrics = Object.values(song.lyrics || {}).some(v => v && String(v).trim().length > 0);
```

with:

```javascript
    const hasLyrics = ilDocHasContent(song.lyricsDoc) || Object.values(song.lyrics || {}).some(v => v && String(v).trim().length > 0);
```

(The `|| legacy` keeps badges correct for songs not yet migrated.)

- [ ] **Step 2: Per-part lyrics badge counter (~21451)**

Find: `grep -n "const hasLyrics = (song.lyrics?.\[part.id\]" 1.311.html`. This counts "parts with lyrics" for a song-card stat. Since lyrics are no longer per-part, replace the surrounding per-part loop's lyrics signal with a single doc check. Locate the block:

```javascript
      // Check lyrics exist for this part
      const hasLyrics = (song.lyrics?.[part.id] || '').trim().length > 0;
      if (hasChords) partsWithChords++;
      if (hasLyrics) partsWithLyrics++;
```

Replace the `const hasLyrics` line with:

```javascript
      const hasLyrics = false; // lyrics are now a single song-level doc (see partsWithLyrics override below)
```

Then find where `partsWithLyrics` is consumed/displayed after the loop and set it from the doc instead. Search `grep -n "partsWithLyrics" 1.311.html`; directly after the loop that increments it, add:

```javascript
  partsWithLyrics = ilDocHasContent(song.lyricsDoc) || Object.values(song.lyrics || {}).some(v => v && String(v).trim().length > 0) ? 1 : 0;
```

(If `partsWithLyrics` is a `const`, change it to `let` at its declaration so it can be overridden.)

- [ ] **Step 2-check: Confirm the override compiles**

Run: `grep -n "partsWithLyrics" 1.311.html`
Expected: its declaration is `let`, and the override line appears after the loop.

- [ ] **Step 3: Practice view lyrics render (~39677 / ~42597)**

Find: `grep -n "song.lyrics?.\[part.id\]" 1.311.html` (practice/rehearse occurrences at ~39677 and ~42597). These build per-part lyric blocks. For the practice view, replace the per-part lyric rendering with a single doc block. Locate the practice render function (search `practice-lyrics`), and where it currently maps active parts to per-part lyric HTML, replace that mapping with one doc block:

```javascript
  const _practiceDoc = ilSanitizeDocHtml(ilGetDocHtml(song));
  const lyricsHtml = ilDocHasContent(_practiceDoc)
    ? `<div class="practice-lyrics il-lyrics-doc" style="white-space:pre-wrap">${_practiceDoc}</div>`
    : '';
```

Use `lyricsHtml` where the per-part lyric blocks were inserted. (Keep chord/instrument rendering untouched — only the lyric text source changes.)

- [ ] **Step 4: Firestore + export serialization (~37673, ~41817, ~42592)**

Find: `grep -n "lyrics:.*song.lyrics" 1.311.html` (the Firestore payload at ~37673, currently `lyrics: song.lyrics || {},`). Add the doc field alongside it (keep `lyrics` for backward-compat / un-migrated reads):

```javascript
      lyrics:         song.lyrics         || {},
      lyricsDoc:      song.lyricsDoc      || '',
```

For any plain-text export (search `grep -n "song.lyrics\b" 1.311.html` around ~41817/~42592 for export/share/sheet builders), where it previously concatenated per-section text, swap to:

```javascript
  const lyricsPlain = ilDocToPlainText(ilGetDocHtml(song));
```

and use `lyricsPlain` in the export string.

- [ ] **Step 5: Verify consumers**

Browser checks:
- Song-list: a song with lyrics shows the "has lyrics" badge; an empty one doesn't.
- Practice view: lyrics doc renders as one block; chords/instruments unaffected.
- Reload after edit: `getCurrentSong().lyricsDoc` is present; export/share text contains the lyric words (via `ilDocToPlainText`).

```javascript
ilDocHasContent(getCurrentSong().lyricsDoc) === true &&
ilDocToPlainText(getCurrentSong().lyricsDoc).length > 0
```

Expected: `true` for a song with lyrics.

- [ ] **Step 6: Commit**

```bash
git add 1.311.html
git commit -m "feat(1.311): repoint practice view, badges, export/sync to lyricsDoc"
```

---

## Task 7: Remove the separate mobile lyrics modal; share the editor on mobile

**Files:**
- Modify: `1.311.html` — remove `#ilMobLyricsModal` markup (find `grep -n "id=\"ilMobLyricsModal\"" 1.311.html`), its CSS (`#ilMobLyricsModal {`), and its JS (`_ilMobLyricsPartId`, the open/save fns). Add mobile-responsive format-bar CSS.

- [ ] **Step 1: Remove the mobile modal markup**

Find the block starting `<div id="ilMobLyricsModal">` (around line 66673) through its closing `</div>` (includes `#ilMobLyricsTitle`, `#ilMobLyricsTa`). Delete the whole `#ilMobLyricsModal` element.

- [ ] **Step 2: Remove the mobile modal JS**

Find and delete: the `window._ilMobLyricsPartId = null;` declaration and the function that opens/closes the modal (the block reading `const modal = document.getElementById('ilMobLyricsModal');` ... `window._ilMobLyricsPartId = null;`). Search any callers: `grep -n "ilMobLyricsModal\|_ilMobLyricsPartId\|ilMobLyricsTa" 1.311.html` and remove/redirect each caller so that on mobile the lyrics view simply opens the shared `#ilLyricsDoc` editor (the same path desktop uses). If a caller was "open mobile lyrics for partId", replace it with the normal lyrics-view open (e.g. `navToolTap('lyrics')` or the existing lyrics toggle).

- [ ] **Step 3: Remove the mobile modal CSS**

Find the CSS block beginning `#ilMobLyricsModal {` (around line 7492) through the related `.il-mob-lyrics-*` rules (back button, title, save btn, textarea, placeholder). Delete those rules.

- [ ] **Step 4: Add mobile-responsive format-bar styling**

Inside an existing mobile media query (search `@media (max-width: 600px)` or the project's mobile breakpoint near other `il-` mobile rules), add:

```css
  .il-fmt-bar { gap: 2px; padding: 5px 8px; }
  .il-fmt-btn { min-width: 28px; height: 30px; padding: 0 6px; }
  .il-fmt-size { height: 30px; }
  .il-fmt-swatches { grid-template-columns: repeat(4, 24px); }
```

- [ ] **Step 5: Verify no dangling references and mobile editor works**

Run: `grep -n "ilMobLyrics\|_ilMobLyricsPartId" 1.311.html`
Expected: no matches (or only an unrelated string), confirming full removal.

Browser check at iPhone-width viewport (e.g. 390px): open lyrics → the shared `#ilLyricsDoc` + horizontally-scrollable format bar appear; no full-screen modal; typing + B/I/U/size/color all work and don't collide with the global seq strip or bottom nav.

- [ ] **Step 6: Commit**

```bash
git add 1.311.html
git commit -m "refactor(1.311): remove mobile lyrics modal, share doc editor on mobile"
```

---

## Task 8: Dead-code sweep (remove orphaned per-section helpers)

Remove helpers that now have **zero callers**. Verify each is orphaned with grep before deleting.

**Files:**
- Modify: `1.311.html`.

- [ ] **Step 1: Build the candidate orphan list and check callers**

For each function below, run `grep -n "<name>" 1.311.html` and confirm the only match is its own definition (no call sites). Candidates:

```
ilOpenImportModal       ilRenderSplitPreview     ilApplyImport (and any ilImport* split helper)
ilAddSection            ilBuildAddOptions        ilApplyArrangement
ilBuildArrangementOptions  COMMON_ARRANGEMENTS
ilMakePartHtml          ilToggleSectionMenu      ilCloseSectionMenus
ilRelabelPart           ilApplyRelabel           ilLyricsRawEdit
ilRenderPaletteHtml (only if not used outside lyrics)
ilRenderChordChartHtml (CHECK — may be used by perf/practice; do NOT remove if it has other callers)
```

- [ ] **Step 2: Delete only the confirmed-orphan functions**

Delete each function whose only grep match was its definition. **Do not** delete any function that still has a caller (e.g. `seqDeleteByPartId`, or `ilRenderChordChartHtml` if used elsewhere). Also remove the now-orphaned import-modal markup if any remains, and the `COMMON_ARRANGEMENTS` constant array.

- [ ] **Step 3: Remove orphaned CSS for deleted UI**

Grep the class names of removed UI and delete rules with no remaining markup: `il-import-btn`, `il-import-*`, `il-add-sel`, `il-add-section-row`, `il-section-menu*`, `il-relabel-*`, `il-split-*`/`ilSplitPreview`, `.il-mob-lyrics-*` (if any survived Task 7). For each, confirm `grep -n "<class>" 1.311.html` shows no markup/JS usage before deleting the rule.

- [ ] **Step 4: Verify the app still boots clean**

Browser check: full boot → load song → open lyrics, perform mode, practice view, song list. No console `ReferenceError`/`is not defined`. Confirm:

```javascript
['ilOpenImportModal','ilApplyArrangement','ilMakePartHtml','ilAddSection']
  .filter(n => typeof window[n] === 'function')
```

Expected: `[]` (all removed), and no runtime errors anywhere in the lyrics/perform/practice flows.

- [ ] **Step 5: Commit**

```bash
git add 1.311.html
git commit -m "chore(1.311): dead-code sweep — remove orphaned per-section lyrics helpers"
```

---

## Task 9: Full verification + promote `1.311.html` → `index.html`

**Files:**
- Modify: `index.html` (promotion copy), `CLAUDE.md` (version pointer line).

- [ ] **Step 1: Full headless verification pass (desktop + mobile)**

Using the CLAUDE.md playwright recipe against `1.311.html`, verify end-to-end on both a desktop viewport and a 390px mobile viewport:
- Migration: open a song that has legacy per-section `song.lyrics` and no `lyricsDoc` → doc auto-populates with section-name headings + text, in order.
- Editing: B / I / U / Mono / Size / Color / Highlight all apply; persist across tool-switch and reload.
- Perform mode: shows doc read-only, no format bar.
- Practice view + song-list badges reflect doc content.
- Empty doc shows the placeholder; "has lyrics" badge is false when empty.
- No console errors in any flow.

Record the results. Do not proceed to promotion until all pass.

- [ ] **Step 2: STOP for iPhone sign-off**

Per the repo workflow ([[drafthaus-ned-mobile-backlog]] pattern), mobile builds are promoted only after real-iPhone sign-off. Surface to the user: "`1.311.html` is committed and headless-verified on desktop + mobile-width. Please test on a real iPhone before I promote it to `index.html`." Wait for explicit approval.

- [ ] **Step 3: Promote to index (only after approval)**

```bash
cd /Users/jasoncraig/Documents/Claude/Projects/Drafthaus
cp 1.311.html index.html
```

- [ ] **Step 4: Update the version pointer in CLAUDE.md**

In `CLAUDE.md`, find the line naming the deployed build (currently references `1.307.html` as byte-identical to `index.html`). Update it to state `index.html` is byte-identical to `1.311.html`, with `1.310.html` as the prior snapshot.

- [ ] **Step 5: Commit (do not push until user confirms — Pages deploys on push)**

```bash
git add index.html CLAUDE.md
git commit -m "feat(1.311): promote single rich-text lyrics editor to index"
```

Then ask the user before `git push` — pushing `main` deploys `drafthaus.ca` ([[drafthaus-versioning-workflow]]).

---

## Self-review notes

- **Spec coverage:** Section 1 (data/migration) → Task 2; Section 2 (editor/format bar) → Tasks 3–4; Section 3 (removal) → Tasks 3 (UI swap) + 8 (sweep); Section 4 (repoint consumers) → Tasks 5–6; Section 5 (desktop/mobile layout) → Tasks 3 (CSS) + 7 (mobile); Section 6 (sanitize/empty/migration-safety/undo/save/sync) → Task 2 (sanitize/migrate) + Task 3 (save cadence/placeholder) + native undo (no extra task needed). All covered.
- **Type consistency:** `ilGetDocHtml`, `ilSanitizeDocHtml`, `ilDocToPlainText`, `ilDocHasContent`, `ilMigrateLyricsToDoc`, `ilDocInput`, `ilDocFlush`, `ilFmtCmd`, `ilFmtSetSize`, `ilFmtColor`, `ilFmtOpenSwatches`, `ilFmtSyncToolbar` — names used identically across tasks. The field is always `song.lyricsDoc`; the element is always `#ilLyricsDoc`; the bar is always `#ilFmtBar`.
- **No test runner:** verification steps are grep assertions + browser checks per CLAUDE.md, the project's established method.
