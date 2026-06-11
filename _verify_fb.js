// Headless verify harness for the floating fretboard. Drives installed Chrome via playwright-core.
const { chromium } = require('playwright-core');
const path = require('path');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const FILE = 'file://' + path.resolve(__dirname, '1.314.html');

let pass = 0, fail = 0;
function assert(name, cond, extra) {
  if (cond) { pass++; console.log('  ok  ' + name); }
  else { fail++; console.log('FAIL  ' + name + (extra ? '  -> ' + JSON.stringify(extra) : '')); }
}

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  await page.addInitScript(() => { try { localStorage.setItem('drafthaus-eula-accepted','1'); } catch(e){} });
  page.on('pageerror', e => { fail++; console.log('FAIL  pageerror -> ' + e.message); });
  await page.goto(FILE, { waitUntil: 'load' });
  await page.waitForTimeout(400);

  // === ENGINE ASSERTIONS ===
  const t1 = await page.evaluate(() => ({
    c:   _fbParseChord('C'),
    fs7: _fbParseChord('F#7'),
    m7b5:_fbParseChord('Bm7b5'),
    bad: _fbParseChord('H'),
    nul: _fbParseChord(''),
    cnote0: (typeof SEQ_NOTES !== 'undefined' && SEQ_NOTES[0]),
  }));
  assert('SEQ_NOTES[0] is C', t1.cnote0 === 'C', t1.cnote0);
  assert('parse C -> root C, pcs[0,4,7]', t1.c && t1.c.root==='C' && t1.c.rootPc===0 && JSON.stringify(t1.c.pcs)==='[0,4,7]', t1.c);
  assert('parse F#7 -> root F#, 4 pcs', t1.fs7 && t1.fs7.root==='F#' && t1.fs7.pcs.length===4, t1.fs7);
  assert('parse Bm7b5 -> qual m7b5', t1.m7b5 && t1.m7b5.qual==='m7b5' && t1.m7b5.pcs.length===4, t1.m7b5);
  assert('parse junk -> null', t1.bad === null && t1.nul === null, t1);

  // === DOM ASSERTIONS ===

  console.log(`\n${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
