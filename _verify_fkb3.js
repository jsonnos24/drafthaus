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

  await page.addInitScript(() => {
    localStorage.setItem('drafthaus-eula-accepted', '1');
  });

  const filePath = path.resolve('/Users/jasoncraig/Documents/Claude/Projects/Drafthaus/1.310.html');
  await page.goto('file://' + filePath, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(3000);

  await page.evaluate(() => { if (typeof signInAsGuest === 'function') signInAsGuest(); }).catch(() => {});
  await page.waitForTimeout(2500);

  await page.evaluate(async () => {
    if (typeof _createAndLoadSong === 'function') await _createAndLoadSong('fkb-check');
  }).catch(() => {});
  await page.waitForTimeout(2000);

  await page.evaluate(() => {
    document.querySelectorAll('.modal-overlay, .modal-backdrop, [id*="onboarding"], [id*="welcome"], [id*="pickFighter"]').forEach(el => el.remove());
    const el = document.getElementById('pickFighterOverlay');
    if (el) el.remove();
  }).catch(() => {});

  await page.evaluate(async () => {
    if (typeof openSong === 'function' && window._songCurrentId) {
      await openSong(window._songCurrentId);
    }
  }).catch(() => {});
  await page.waitForTimeout(2000);

  await page.evaluate(() => {
    if (typeof openKeyboardDrawer === 'function') openKeyboardDrawer();
  }).catch(() => {});
  await page.waitForTimeout(2000);

  // Get position of fkbInlineRow
  const rowRect = await page.evaluate(() => {
    const el = document.getElementById('fkbInlineRow');
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    return { top: rect.top, left: rect.left, width: rect.width, height: rect.height };
  });
  console.log('fkbInlineRow rect:', rowRect);

  // Screenshot the inline row area specifically
  if (rowRect && rowRect.height > 0) {
    await page.screenshot({
      path: '/Users/jasoncraig/Documents/Claude/Projects/Drafthaus/_verify_fkb.png',
      clip: {
        x: Math.max(0, rowRect.left),
        y: Math.max(0, rowRect.top - 5),
        width: Math.min(1680, rowRect.width),
        height: rowRect.height + 10
      }
    });
    console.log('Inline row screenshot saved');
  } else {
    // Fall back to top of page
    await page.screenshot({
      path: '/Users/jasoncraig/Documents/Claude/Projects/Drafthaus/_verify_fkb.png',
      clip: { x: 0, y: 55, width: 1680, height: 60 }
    });
    console.log('Fallback top screenshot saved');
  }

  await browser.close();
})().catch(err => {
  console.error(err);
  process.exit(1);
});
