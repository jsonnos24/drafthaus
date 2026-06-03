const { chromium } = require('playwright-core');
const path = require('path');

(async () => {
  const browser = await chromium.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
    args: ['--no-sandbox', '--disable-web-security', '--allow-file-access-from-files']
  });

  const context = await browser.newContext({
    viewport: { width: 1680, height: 1050 }
  });

  const page = await context.newPage();

  // Set localStorage before page load
  await page.addInitScript(() => {
    localStorage.setItem('drafthaus-eula-accepted', '1');
  });

  const errors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') {
      const text = msg.text();
      if (!text.includes('permission-denied') && !text.includes('FirebaseError') && !text.includes('PERMISSION_DENIED')) {
        errors.push(text);
      }
    }
  });

  const filePath = path.resolve('/Users/jasoncraig/Documents/Claude/Projects/Drafthaus/1.310.html');
  await page.goto('file://' + filePath, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(3000);

  // Sign in as guest
  await page.evaluate(() => { if (typeof signInAsGuest === 'function') signInAsGuest(); }).catch(() => {});
  await page.waitForTimeout(2500);

  // Create and load a song
  await page.evaluate(async () => {
    if (typeof _createAndLoadSong === 'function') await _createAndLoadSong('fkb-check');
  }).catch(() => {});
  await page.waitForTimeout(2000);

  // Remove ALL overlays/modals
  await page.evaluate(() => {
    ['pickFighterOverlay', 'onboardingModal', 'onboardingOverlay', 'welcomeModal'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.remove();
    });
    // Also remove any modal backdrops
    document.querySelectorAll('.modal-overlay, .modal-backdrop, [class*="onboarding"]').forEach(el => el.remove());
  }).catch(() => {});

  // Open song
  await page.evaluate(async () => {
    if (typeof openSong === 'function' && window._songCurrentId) {
      await openSong(window._songCurrentId);
    }
  }).catch(() => {});
  await page.waitForTimeout(2000);

  // Open keyboard drawer
  await page.evaluate(() => {
    if (typeof openKeyboardDrawer === 'function') openKeyboardDrawer();
  }).catch(() => {});
  await page.waitForTimeout(2000);

  // Scroll to bottom to see keyboard strip
  await page.evaluate(() => {
    const inlineRow = document.getElementById('fkbInlineRow');
    if (inlineRow) inlineRow.scrollIntoView();
  }).catch(() => {});
  await page.waitForTimeout(500);

  // Screenshot of just the keyboard area (bottom portion)
  const pageHeight = await page.evaluate(() => document.documentElement.scrollHeight);
  await page.screenshot({
    path: '/Users/jasoncraig/Documents/Claude/Projects/Drafthaus/_verify_fkb.png',
    fullPage: false,
    clip: { x: 0, y: 800, width: 1680, height: 250 }
  });
  console.log('Bottom screenshot saved');

  // Also full page screenshot
  await page.screenshot({
    path: '/Users/jasoncraig/Documents/Claude/Projects/Drafthaus/_verify_fkb_full.png',
    fullPage: false
  });
  console.log('Full screenshot saved');

  console.log('Errors:', errors.length ? errors : 'none');
  await browser.close();
})().catch(err => {
  console.error(err);
  process.exit(1);
});
