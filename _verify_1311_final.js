/** 1.311 comprehensive verification — desktop + mobile, full lyrics-editor feature. */
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
  await page.goto(FILE); await sleep(1500);
  await page.evaluate(() => { try { signInAsGuest(); } catch (e) {} }); await sleep(1500);
  await page.evaluate(() => { try { _createAndLoadSong('vfinal'); } catch (e) {} }); await sleep(1000);
  await page.evaluate(() => { const el = document.querySelector('#pickFighterOverlay'); if (el) el.remove(); });
  await page.evaluate(() => { try { openSong(window._songCurrentId); } catch (e) {} }); await sleep(1200);
  for (let i = 0; i < 20; i++) {
    const ok = await page.evaluate(() => { try { return !!getCurrentSong(); } catch (e) { return false; } });
    if (ok) break;
    await page.evaluate(() => { try { _createAndLoadSong('vfinal'); const o = document.querySelector('#pickFighterOverlay'); if (o) o.remove(); openSong(window._songCurrentId); } catch (e) {} });
    await sleep(500);
  }
  return errors;
}

async function run(label, width, height) {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const ctx = await browser.newContext({ viewport: { width, height } });
  const page = await ctx.newPage();
  const errors = await boot(page);
  const R = {};

  R.song_loaded = await page.evaluate(() => !!getCurrentSong());

  // Migration from legacy per-section lyrics
  R.migration_preserved = await page.evaluate(() => {
    const s = getCurrentSong();
    if (!s.structure) s.structure = {};
    s.structure.verse = { checked: true, count: 1 };
    s.sectionOrder = ['verse'];
    s.lyrics = { verse: 'seed line A\nseed line B' };
    delete s.lyricsDoc;
    const t = ilDocToPlainText(ilGetDocHtml(s));
    return t.includes('seed line A') && t.includes('seed line B');
  });

  // Render editor
  await page.evaluate(() => ilRenderBody(getCurrentSong())); await sleep(300);
  R.editor_present = await page.evaluate(() => !!document.getElementById('ilLyricsDoc') && !!document.getElementById('ilFmtBar'));
  R.no_removed_chrome = await page.evaluate(() =>
    !document.querySelector('.il-import-btn') && !document.getElementById('ilArrangeSel') &&
    !document.getElementById('ilAddSel') && !document.querySelector('.il-part'));

  // Formatting
  R.formatting_works = await page.evaluate(() => {
    const doc = document.getElementById('ilLyricsDoc');
    const sel = window.getSelection();
    const fresh = (txt) => { doc.innerHTML = '<div>' + txt + '</div>'; doc.focus(); const r = document.createRange(); r.selectNodeContents(doc); sel.removeAllRanges(); sel.addRange(r); };
    fresh('bold me'); ilFmtCmd('bold');
    const boldOk = /<b>|font-weight|<strong>/i.test(doc.innerHTML);
    fresh('size me'); ilFmtSetSize('title');
    const sizeOk = /font-size:\s*28px/i.test(doc.innerHTML) && !doc.querySelector('font[size="7"]');
    fresh('color me'); ilFmtColor('fore', '#e0504f');
    const colorOk = /color/i.test(doc.innerHTML);
    fresh('mono me'); ilFmtCmd('mono');
    const monoOk = /monospace|IBM Plex Mono/i.test(doc.innerHTML);
    return boldOk && sizeOk && colorOk && monoOk;
  });

  // Perform mode: read-only + format bar hidden
  R.perform_readonly = await page.evaluate(() => {
    ilSetPerfMode(true);
    const doc = document.getElementById('ilLyricsDoc');
    const bar = document.getElementById('ilFmtBar');
    const ro = doc.getAttribute('contenteditable') === 'false';
    const barHidden = getComputedStyle(bar).display === 'none';
    ilSetPerfMode(false);
    const editable = doc.getAttribute('contenteditable') === 'true';
    return ro && barHidden && editable;
  });

  // Legacy editable surfaces gone
  await page.evaluate(() => { try { openPracticeDrawer(); } catch (e) {} }); await sleep(600);
  R.runthrough_no_lyrics = await page.evaluate(() => !document.querySelector('.rt-lyrics'));
  await page.evaluate(() => { try { closeRunThroughDrawer(); } catch (e) {} }); await sleep(300);
  R.instruments_no_lyric_textarea = await page.evaluate(() => {
    try { if (typeof navToolTap === 'function') navToolTap('guitar'); } catch (e) {}
    return !document.querySelector('textarea[oninput*="saveSectionLyric"]');
  });

  await browser.close();
  const errs = filt(errors);
  let pass = 0, fail = 0;
  console.log(`\n=== ${label} (${width}x${height}) ===`);
  for (const [k, v] of Object.entries(R)) { const ok = v === true; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${k}`); ok ? pass++ : fail++; }
  console.log(`  console errors: ${errs.length}`); errs.slice(0, 8).forEach(e => console.log('   • ' + e));
  return { pass, fail: fail + (errs.length ? 1 : 0), errs: errs.length };
}

(async () => {
  const d = await run('DESKTOP', 1680, 1050);
  const m = await run('MOBILE', 390, 844);
  const totFail = d.fail + m.fail;
  console.log(`\n==== TOTAL: desktop ${d.pass} pass / ${d.fail} fail, mobile ${m.pass} pass / ${m.fail} fail ====`);
  process.exit(totFail === 0 ? 0 : 1);
})();
