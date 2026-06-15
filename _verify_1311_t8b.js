/** Task 8b regression: run-through drawer + instruments + core editor, no errors, no lyric fields. */
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
  await page.evaluate(() => { try { _createAndLoadSong('verifyT8b'); } catch (e) {} }); await sleep(1000);
  await page.evaluate(() => { const el = document.querySelector('#pickFighterOverlay'); if (el) el.remove(); });
  await page.evaluate(() => { try { openSong(window._songCurrentId); } catch (e) {} }); await sleep(1200);
  // Poll until a current song is available (guest boot can be racy)
  for (let i = 0; i < 20; i++) {
    const ok = await page.evaluate(() => { try { return !!getCurrentSong(); } catch (e) { return false; } });
    if (ok) break;
    await page.evaluate(() => { try { _createAndLoadSong('verifyT8b'); const o = document.querySelector('#pickFighterOverlay'); if (o) o.remove(); openSong(window._songCurrentId); } catch (e) {} });
    await sleep(500);
  }
  return errors;
}

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1680, height: 1050 } });
  const page = await ctx.newPage();
  const errors = await boot(page);
  const R = {};

  // Seed legacy lyrics + a section so views have content; activate a section.
  R.song_loaded = await page.evaluate(() => !!getCurrentSong());
  await page.evaluate(() => {
    const s = getCurrentSong();
    if (!s) return;
    if (!s.structure) s.structure = {};
    s.structure.verse = { checked: true, count: 1 };
    s.sectionOrder = ['verse'];
    s.lyrics = { verse: 'old verse line one\nold verse line two' };
    delete s.lyricsDoc;
  });
  // Assert migration immediately after seeding (before other views cache the doc)
  R.migration_preserved = await page.evaluate(() => {
    const t = ilDocToPlainText(ilGetDocHtml(getCurrentSong()));
    return t.includes('old verse line one') && t.includes('old verse line two');
  });

  // Open run-through (Practice) drawer
  R.runthrough_opened = await page.evaluate(() => { try { openPracticeDrawer(); return true; } catch (e) { return 'ERR:' + e.message; } });
  await sleep(800);
  R.runthrough_no_rt_lyrics = await page.evaluate(() => !document.querySelector('.rt-lyrics'));
  R.runthrough_drawer_open = await page.evaluate(() => !!document.getElementById('runThroughDrawer')?.classList.contains('open'));
  await page.evaluate(() => { try { closeRunThroughDrawer(); } catch (e) {} });
  await sleep(400);

  // Open Instruments tool (guitar) — check no lyrics textarea
  R.instruments_opened = await page.evaluate(() => {
    try { if (typeof navToolTap === 'function') navToolTap('guitar'); return true; } catch (e) { return 'ERR:' + e.message; }
  });
  await sleep(800);
  R.instruments_no_lyric_textarea = await page.evaluate(() => !document.querySelector('textarea[oninput*="saveSectionLyric"]'));
  R.saveSectionLyric_gone = await page.evaluate(() => typeof window.saveSectionLyric === 'undefined');

  // Core editor still works + migration preserved legacy lyrics
  await page.evaluate(() => { try { closeAllDrawers && closeAllDrawers(null); } catch (e) {} ilRenderBody(getCurrentSong()); });
  await sleep(300);
  R.editor_present = await page.evaluate(() => !!document.getElementById('ilLyricsDoc'));

  console.log('\n=== TASK 8b REGRESSION ===');
  let pass = 0, fail = 0;
  for (const [k, v] of Object.entries(R)) { const ok = v === true; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${k} = ${v}`); ok ? pass++ : fail++; }
  const errs = filt(errors);
  console.log(`\n  Console errors (filtered): ${errs.length}`); errs.slice(0, 10).forEach(e => console.log('   • ' + e));
  console.log(`\n  RESULT: ${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail === 0 && errs.length === 0 ? 0 : 1);
})();
