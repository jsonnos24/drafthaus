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

  // Capture console errors (ignoring expected Firestore permission-denied)
  const errors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') {
      const text = msg.text();
      if (!text.includes('permission-denied') && !text.includes('FirebaseError') && !text.includes('PERMISSION_DENIED')) {
        errors.push(text);
      }
    }
  });
  page.on('pageerror', err => {
    if (!err.message.includes('permission-denied') && !err.message.includes('FirebaseError')) {
      errors.push('pageerror: ' + err.message);
    }
  });

  const filePath = path.resolve('/Users/jasoncraig/Documents/Claude/Projects/Drafthaus/1.310.html');
  await page.goto('file://' + filePath, { waitUntil: 'domcontentloaded', timeout: 30000 });

  // Wait for app to boot
  await page.waitForTimeout(3000);

  // Sign in as guest
  try {
    await page.evaluate(() => {
      if (typeof signInAsGuest === 'function') return signInAsGuest();
    });
    await page.waitForTimeout(2000);
  } catch (e) {
    console.log('signInAsGuest error:', e.message);
  }

  // Create and load a song
  try {
    await page.evaluate(async () => {
      if (typeof _createAndLoadSong === 'function') {
        await _createAndLoadSong('fkb-check');
      }
    });
    await page.waitForTimeout(2000);
  } catch (e) {
    console.log('_createAndLoadSong error:', e.message);
  }

  // Remove pick fighter overlay if present
  try {
    await page.evaluate(() => {
      const el = document.getElementById('pickFighterOverlay');
      if (el) el.remove();
    });
  } catch (e) {}

  // Open song
  try {
    await page.evaluate(async () => {
      if (typeof openSong === 'function' && window._songCurrentId) {
        await openSong(window._songCurrentId);
      }
    });
    await page.waitForTimeout(2000);
  } catch (e) {
    console.log('openSong error:', e.message);
  }

  // Open keyboard drawer
  try {
    await page.evaluate(() => {
      if (typeof openKeyboardDrawer === 'function') openKeyboardDrawer();
    });
    await page.waitForTimeout(2000);
  } catch (e) {
    console.log('openKeyboardDrawer error:', e.message);
  }

  // Check fkb state
  const fkbState = await page.evaluate(() => {
    const inlineRow = document.getElementById('fkbInlineRow');
    const fkbWrap = document.getElementById('fkbWrap');
    const fkbInlineInstrSel = document.getElementById('fkbInlineInstrSel');
    const popBtn = document.querySelector('.fkb-popout-btn');
    const fkbMinBtn = document.getElementById('fkbMinBtn');
    const fkbInlineKeys = document.getElementById('fkbInlineKeys');

    return {
      _fkbMinimized: typeof _fkbMinimized !== 'undefined' ? _fkbMinimized : 'undefined',
      inlineRowDisplay: inlineRow ? inlineRow.style.display : 'not found',
      fkbWrapExists: !!fkbWrap,
      fkbWrapDisplay: fkbWrap ? (fkbWrap.style.display || 'auto (check CSS)') : 'not found',
      fkbWrapHasOpenClass: fkbWrap ? fkbWrap.classList.contains('fkb-open') : false,
      hasInlineInstrSel: !!fkbInlineInstrSel,
      instrSelValue: fkbInlineInstrSel ? fkbInlineInstrSel.value : null,
      hasPopBtn: !!popBtn,
      popBtnText: popBtn ? popBtn.textContent : null,
      fkbMinBtnText: fkbMinBtn ? fkbMinBtn.textContent : null,
      inlineKeysChildCount: fkbInlineKeys ? fkbInlineKeys.children.length : 0,
      boardWhiteKeyCount: (() => {
        const board = document.querySelector('.fkb-inline-board');
        if (!board) return 0;
        return board.querySelectorAll('.fkb-inline-wkey').length;
      })(),
      // Check element order in fkbInlineKeys
      childTypes: (() => {
        if (!fkbInlineKeys) return [];
        return Array.from(fkbInlineKeys.children).map(el => ({
          tag: el.tagName,
          id: el.id,
          className: el.className,
          text: el.textContent ? el.textContent.substring(0, 30) : ''
        }));
      })()
    };
  });

  console.log('FKB State:', JSON.stringify(fkbState, null, 2));
  console.log('\nErrors (non-Firestore):', errors.length ? errors : 'none');

  // Take screenshot
  await page.screenshot({
    path: '/Users/jasoncraig/Documents/Claude/Projects/Drafthaus/_verify_fkb.png',
    fullPage: false
  });
  console.log('\nScreenshot saved to _verify_fkb.png');

  await browser.close();
})().catch(err => {
  console.error('Script error:', err);
  process.exit(1);
});
