/** 1.312 verification — lyrics rich-text (kept) + recovered 1.310 batch (header/menu tidy, voices). */
const { chromium } = require('playwright-core');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = '/Users/jasoncraig/Documents/Claude/Projects/Drafthaus';
const FILE = `file://${BASE}/1.312.html`;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const filt = es => es.filter(e => !/permission-denied|PERMISSION_DENIED|Firestore|Firebase|net::ERR/i.test(e));

async function boot(page) {
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => localStorage.setItem('drafthaus-eula-accepted', '1'));
  await page.goto(FILE); await sleep(1500);
  await page.evaluate(() => { try { signInAsGuest(); } catch (e) {} }); await sleep(1500);
  await page.evaluate(() => { try { _createAndLoadSong('v312'); } catch (e) {} }); await sleep(1000);
  await page.evaluate(() => { const el = document.querySelector('#pickFighterOverlay'); if (el) el.remove(); });
  await page.evaluate(() => { try { openSong(window._songCurrentId); } catch (e) {} }); await sleep(1200);
  for (let i = 0; i < 20; i++) {
    const ok = await page.evaluate(() => { try { return !!getCurrentSong(); } catch (e) { return false; } });
    if (ok) break;
    await page.evaluate(() => { try { _createAndLoadSong('v312'); const o = document.querySelector('#pickFighterOverlay'); if (o) o.remove(); openSong(window._songCurrentId); } catch (e) {} });
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

  // ---- LYRICS RICH-TEXT (kept from 1.311) ----
  R.lyrics_migration_preserved = await page.evaluate(() => {
    const s = getCurrentSong();
    if (!s.structure) s.structure = {};
    s.structure.verse = { checked: true, count: 1 };
    s.sectionOrder = ['verse'];
    s.lyrics = { verse: 'seed line A\nseed line B' };
    delete s.lyricsDoc;
    const t = ilDocToPlainText(ilGetDocHtml(s));
    return t.includes('seed line A') && t.includes('seed line B');
  });
  await page.evaluate(() => ilRenderBody(getCurrentSong())); await sleep(300);
  R.lyrics_editor_present = await page.evaluate(() => !!document.getElementById('ilLyricsDoc') && !!document.getElementById('ilFmtBar'));
  R.lyrics_formatting_works = await page.evaluate(() => {
    const doc = document.getElementById('ilLyricsDoc');
    const sel = window.getSelection();
    const fresh = (txt) => { doc.innerHTML = '<div>' + txt + '</div>'; doc.focus(); const r = document.createRange(); r.selectNodeContents(doc); sel.removeAllRanges(); sel.addRange(r); };
    fresh('bold me'); ilFmtCmd('bold');
    const boldOk = /<b>|font-weight|<strong>/i.test(doc.innerHTML);
    fresh('color me'); ilFmtColor('fore', '#e0504f');
    const colorOk = /color/i.test(doc.innerHTML);
    return boldOk && colorOk;
  });

  // ---- RECOVERED 1.310 BATCH ----
  // Header tidy: Tutorial + Help buttons hidden
  R.header_tutorial_hidden = await page.evaluate(() => {
    const t = document.getElementById('hdrTutorialBtn');
    const h = document.getElementById('hdrHelpBtn');
    return !!t && !!h && getComputedStyle(t).display === 'none' && getComputedStyle(h).display === 'none';
  });
  // Menu tidy: open menu, assert About/MIDI/Theme items gone, quota hidden, gold Song List present
  R.menu_tidied = await page.evaluate(() => {
    try { const w = document.getElementById('mobileMenuWrap'); if (typeof openMobileMenu === 'function') openMobileMenu(); } catch (e) {}
    const panel = document.getElementById('mobileMenuPanel');
    if (!panel) return false;
    const txt = panel.textContent || '';
    const themeGone = !document.getElementById('menuThemeToggle');
    const midiGone = !/MIDI Connect/.test(txt);
    const aboutGone = !/ℹ\s*About/.test(txt);
    const quota = document.getElementById('mobileMenuQuota');
    const quotaHidden = !quota || getComputedStyle(quota).display === 'none';
    const songList = /Song List/.test(txt);
    try { if (typeof closeMobileMenu === 'function') closeMobileMenu(); } catch (e) {}
    return themeGone && midiGone && aboutGone && quotaHidden && songList;
  });
  // New voices present in instrument dropdowns
  R.new_voices_present = await page.evaluate(() => {
    const all = Array.from(document.querySelectorAll('option, [data-voice], .voice-option')).map(o => o.textContent).join('|');
    const html = document.documentElement.innerHTML;
    const has = n => all.includes(n) || html.includes(n);
    return has('Bass Guitar') && has('Violins') && has('Analog Pad') && has('Analog Lead');
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
