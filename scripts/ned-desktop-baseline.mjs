import { boot } from './ned-verify.mjs';
import fs from 'node:fs';
const out = process.argv[2] || 'desktop-before.json';
const { browser, page } = await boot({ portrait: false });
await page.evaluate(() => { if (typeof openKeyboardDrawer === 'function') openKeyboardDrawer(); });
await page.waitForTimeout(400);
const snap = await page.evaluate(() => {
  const b = document.getElementById('keyboardDrawerBody');
  return { bodyHTML: b ? b.innerHTML.length : -1,
           hasMprWrap: !!document.getElementById('mprWrap'),
           hasNedWrap: !!document.getElementById('nedWrap'),
           prPanel: !!document.getElementById('prPanel') };
});
fs.writeFileSync(out, JSON.stringify(snap, null, 2));
console.log('wrote', out, snap);
await browser.close();
