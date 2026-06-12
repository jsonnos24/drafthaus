// Milestone 1 smoke test: boot, guest auth, song-list render, no fatal errors.
const { chromium } = require('playwright-core');
const path = require('path');

(async () => {
  const browser = await chromium.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
  });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 780 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));

  const url = 'file://' + path.resolve(__dirname, 'lite-1.0.html');
  await page.goto(url, { waitUntil: 'load' });

  const results = [];
  const assert = (name, cond) => { results.push((cond ? 'PASS' : 'FAIL') + ' — ' + name); };

  // Landing visible before auth
  assert('landing overlay visible', await page.isVisible('#landing'));
  assert('Google button present', await page.isVisible('.auth-btn.google'));
  assert('email form present', await page.isVisible('#emailForm'));
  assert('guest button present', await page.isVisible('.auth-btn.ghost'));

  // Toggle sign-up mode
  await page.click('#authToggle');
  assert('toggle -> Create account', (await page.textContent('#authSubmitBtn')).includes('Create'));
  await page.click('#authToggle');
  assert('toggle back -> Sign in', (await page.textContent('#authSubmitBtn')).trim() === 'Sign in');

  // Guest sign-in
  await page.click('.auth-btn.ghost');
  await page.waitForSelector('body.signed-in', { timeout: 15000 });
  assert('signed in as guest', await page.evaluate(() => document.body.classList.contains('signed-in')));
  assert('song list screen shown', await page.isVisible('#screen-songlist'));

  // Song list resolves to a real state (empty-state or rows), not stuck on spinner
  await page.waitForFunction(() => {
    const b = document.getElementById('songListBody');
    return b && !b.querySelector('.center-load');
  }, { timeout: 15000 }).catch(() => {});
  const bodyHtml = await page.innerHTML('#songListBody');
  assert('song list rendered (not stuck on spinner)', !bodyHtml.includes('center-load'));
  assert('guest sees empty-state or rows', bodyHtml.includes('sl-empty') || bodyHtml.includes('sl-row'));

  // Create-song button exists & is wired
  assert('add button present', await page.isVisible('.lg-title .add'));

  // Dark mode toggling via API
  await page.evaluate(() => window.applyTheme('dark'));
  assert('dark mode applies', await page.evaluate(() => document.documentElement.classList.contains('dark')));
  await page.evaluate(() => window.applyTheme('light'));
  assert('light mode applies', await page.evaluate(() => !document.documentElement.classList.contains('dark')));

  // Filter out expected Firestore permission noise from guest mode
  const fatal = errors.filter(e =>
    !/permission|insufficient|Missing or insufficient|FirebaseError|Failed to load resource|net::ERR/i.test(e));
  assert('no fatal JS errors', fatal.length === 0);

  console.log(results.join('\n'));
  if (fatal.length) console.log('\nFATAL ERRORS:\n' + fatal.join('\n'));
  console.log('\nALL JS console errors (' + errors.length + '):');
  errors.slice(0, 12).forEach(e => console.log('  · ' + e.slice(0, 160)));

  await browser.close();
  process.exit(results.some(r => r.startsWith('FAIL')) ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR:', e); process.exit(2); });
