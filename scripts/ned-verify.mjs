// scripts/ned-verify.mjs — shared headless boot for notation-drawer verification
import { chromium } from 'playwright-core';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const FILE = 'file://' + path.resolve(
  path.dirname(fileURLToPath(import.meta.url)), '..', '1.301.html');

export async function boot({ portrait = true } = {}) {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const context = await browser.newContext({
    viewport: portrait ? { width: 390, height: 844 } : { width: 1280, height: 800 },
    deviceScaleFactor: 2, isMobile: portrait, hasTouch: portrait,
  });
  await context.addInitScript(() => {
    localStorage['drafthaus-eula-accepted'] = '1';
  });
  const page = await context.newPage();
  const logs = [];
  page.on('console', m => logs.push(m.text()));
  await page.goto(FILE);
  await page.waitForFunction(() => typeof window.signInAsGuest === 'function');
  await page.evaluate(async () => {
    await window.signInAsGuest();
    await window._createAndLoadSong('NED Test');
    document.getElementById('pickFighterOverlay')?.remove();
    if (typeof openSong === 'function') openSong(window._songCurrentId);
  });
  await page.waitForTimeout(400);
  return { browser, context, page, logs };
}
