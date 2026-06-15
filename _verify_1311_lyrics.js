/**
 * Drafthaus 1.311 lyrics-editor verification (Tasks 2–4).
 * VERIFYING ONLY — no source edits.
 */
const { chromium } = require('playwright-core');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = '/Users/jasoncraig/Documents/Claude/Projects/Drafthaus';
const FILE = `file://${BASE}/1.311.html`;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const filt = es => es.filter(e => !/permission-denied|PERMISSION_DENIED|Firestore|Firebase|net::ERR/i.test(e));

async function boot(page) {
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => localStorage.setItem('drafthaus-eula-accepted', '1'));
  await page.goto(FILE);
  await sleep(1500);
  await page.evaluate(() => { try { signInAsGuest(); } catch (e) {} });
  await sleep(1500);
  await page.evaluate(() => { try { _createAndLoadSong('verify1311'); } catch (e) {} });
  await sleep(1000);
  await page.evaluate(() => { const el = document.querySelector('#pickFighterOverlay'); if (el) el.remove(); });
  await page.evaluate(() => { try { openSong(window._songCurrentId); } catch (e) {} });
  await sleep(1200);
  return errors;
}

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1680, height: 1050 } });
  const page = await ctx.newPage();
  const errors = await boot(page);

  const R = await page.evaluate(() => {
    const out = {};
    const song = getCurrentSong();

    // ── Migration test (Task 2) ──
    const test = { lyrics: { verse: 'line one\nline two', chorus: 'hook line' }, sectionOrder: ['verse', 'chorus'] };
    const mig = ilMigrateLyricsToDoc(test);
    out.migrate_hasLineOne = mig.includes('line one');
    out.migrate_hasHook = mig.includes('hook line');
    out.plain_hasLineOne = ilDocToPlainText(mig).includes('line one');
    out.hasContent_true = ilDocHasContent(mig) === true;
    out.hasContent_false = ilDocHasContent('') === false;
    out.sanitize_strips_handlers = ilSanitizeDocHtml('<b onclick="x()">hi</b>') === '<b>hi</b>';
    out.sanitize_keeps_color = ilSanitizeDocHtml('<span style="color: red; position: fixed">y</span>').includes('color');
    out.sanitize_drops_unsafe_style = !ilSanitizeDocHtml('<span style="position: fixed">y</span>').includes('position');

    // ── Lazy accessor populates lyricsDoc once ──
    const t2 = { lyrics: { verse: 'abc' }, sectionOrder: ['verse'] };
    const first = ilGetDocHtml(t2);
    out.getDoc_populates = typeof t2.lyricsDoc === 'string' && t2.lyricsDoc === first;

    // ── Render the editor into the live view (Task 3) ──
    song.lyricsDoc = '<div>my lyric line</div>';
    ilRenderBody(song);
    out.has_doc_el = !!document.getElementById('ilLyricsDoc');
    out.has_fmtbar = !!document.getElementById('ilFmtBar');
    out.no_import_btn = !document.querySelector('.il-import-btn');
    out.no_arrange_sel = !document.getElementById('ilArrangeSel');
    out.no_add_sel = !document.getElementById('ilAddSel');
    out.no_part_blocks = !document.querySelector('.il-part');
    out.doc_shows_content = (document.getElementById('ilLyricsDoc')?.textContent || '').includes('my lyric line');

    // ── Format commands (Task 4) — select all then bold ──
    const doc = document.getElementById('ilLyricsDoc');
    doc.focus();
    const range = document.createRange(); range.selectNodeContents(doc);
    const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range);
    ilFmtCmd('bold');
    out.bold_applied = /<b>|font-weight|<strong>/i.test(doc.innerHTML);
    // size
    const range2 = document.createRange(); range2.selectNodeContents(doc);
    sel.removeAllRanges(); sel.addRange(range2);
    ilFmtSetSize('title');
    out.size_applied = /font-size:\s*28px/i.test(doc.innerHTML);
    out.size_no_font7 = !doc.querySelector('font[size="7"]');
    // color
    const range3 = document.createRange(); range3.selectNodeContents(doc);
    sel.removeAllRanges(); sel.addRange(range3);
    ilFmtColor('fore', '#e0504f');
    out.color_applied = /color/i.test(doc.innerHTML);

    // ── Persistence (Task 3) ──
    ilDocFlush();
    out.persist_matches = typeof song.lyricsDoc === 'string' && song.lyricsDoc === ilSanitizeDocHtml(doc.innerHTML);

    // ── Functions exist ──
    out.fns_defined = ['ilFmtCmd','ilFmtSetSize','ilFmtColor','ilFmtOpenSwatches','ilFmtSyncToolbar','ilDocInput','ilDocFlush','ilGetDocHtml']
      .every(n => typeof window[n] === 'function');
    return out;
  });

  console.log('\n=== 1.311 LYRICS EDITOR VERIFICATION ===');
  let pass = 0, fail = 0;
  for (const [k, v] of Object.entries(R)) {
    const ok = v === true;
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${k} = ${v}`);
    ok ? pass++ : fail++;
  }
  const errs = filt(errors);
  console.log(`\n  Console errors (filtered): ${errs.length}`);
  errs.slice(0, 8).forEach(e => console.log('   • ' + e));
  console.log(`\n  RESULT: ${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail === 0 && errs.length === 0 ? 0 : 1);
})();
