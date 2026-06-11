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

  // === DOM ASSERTIONS ===

  console.log(`\n${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
