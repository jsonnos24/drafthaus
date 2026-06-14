// lite-1.048: no-account chord tools on the landing (Quick Chords / Find a Chord),
// sign-in nudge, and Back routing to the landing for preview visitors.
const { chromium } = require('playwright-core');
const path = require('path'); const http = require('http'); const fs = require('fs');
const BUILD = 'lite-1.048.html';
function startServer() {
  return new Promise(resolve => {
    const srv = http.createServer((req, res) => {
      const file = path.join(__dirname, decodeURIComponent(req.url.split('?')[0]));
      fs.readFile(file, (err, buf) => { if (err) { res.writeHead(404); res.end('nf'); return; }
        const ct = file.endsWith('.html') ? 'text/html' : file.endsWith('.mp3') ? 'audio/mpeg' : 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': ct }); res.end(buf); });
    });
    srv.listen(0, '127.0.0.1', () => resolve({ srv, port: srv.address().port }));
  });
}
// COMPUTED visibility: visible iff it has a non-none display AND lays out (rects).
async function visible(page, sel) {
  return await page.evaluate((s) => {
    const el = document.querySelector(s); if (!el) return false;
    return getComputedStyle(el).display !== 'none' && el.getClientRects().length > 0;
  }, sel);
}
(async () => {
  const { srv, port } = await startServer();
  const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
  const results = []; const assert = (n, c) => results.push((c ? 'PASS' : 'FAIL') + ' — ' + n);
  const errors = [];
  const base = `http://127.0.0.1:${port}/${BUILD}`;
  const mobileCtx = () => browser.newContext({ viewport: { width: 390, height: 800 }, hasTouch: true, isMobile: true });

  // ── Landing: brand + two chord buttons + nudge + auth card (guest kept) ──
  {
    const page = await (await mobileCtx()).newPage();
    page.on('pageerror', e => errors.push('PAGEERROR(landing): ' + e.message));
    await page.goto(base, { waitUntil: 'load' });
    assert('landing: shown on load (not signed in)', await visible(page, '#landing'));
    assert('landing: #app hidden on load', !(await visible(page, '#app')));
    assert('landing: two chord buttons present, labelled Quick Chords + Find a Chord', await page.evaluate(() => {
      const b = [...document.querySelectorAll('.landing-tools .ltool-btn')];
      return b.length === 2 && /Quick Chords/.test(b[0].textContent) && /Find a Chord/.test(b[1].textContent);
    }));
    assert('landing: chord buttons sit BETWEEN the brand and the auth card', await page.evaluate(() => {
      const kids = [...document.getElementById('landing').children];
      const i = kids.findIndex(k => k.classList.contains('brand'));
      const t = kids.findIndex(k => k.classList.contains('landing-tools'));
      const a = kids.findIndex(k => k.classList.contains('auth-card'));
      return i < t && t < a;
    }));
    assert('landing: nudge copy mentions saving + syncing', await page.evaluate(() => {
      const n = document.querySelector('.landing-nudge');
      return !!n && /save/i.test(n.textContent) && /sync/i.test(n.textContent);
    }));
    assert('landing: "Continue as guest" button kept', await page.evaluate(() =>
      !!document.querySelector('.auth-card .auth-btn.ghost') &&
      /guest/i.test(document.querySelector('.auth-card .auth-btn.ghost').textContent)));
  }

  // ── Quick Chords from the landing (no auth) ──
  {
    const page = await (await mobileCtx()).newPage();
    page.on('pageerror', e => errors.push('PAGEERROR(qc): ' + e.message));
    await page.goto(base, { waitUntil: 'load' });
    await page.click('.landing-tools .ltool-btn:nth-child(1)');
    await page.waitForTimeout(80);
    assert('qc: body.chord-preview set (no .signed-in)', await page.evaluate(() =>
      document.body.classList.contains('chord-preview') && !document.body.classList.contains('signed-in')));
    assert('qc: #landing hidden (computed), #app visible', !(await visible(page, '#landing')) && (await visible(page, '#app')));
    assert('qc: #screen-qc is the active screen', await page.evaluate(() =>
      document.getElementById('screen-qc').classList.contains('active') && getComputedStyle(document.getElementById('screen-qc')).display !== 'none'));
    assert('qc: diatonic chord pills rendered', await page.evaluate(() =>
      document.querySelectorAll('#qcPills *').length > 0));
    assert('qc: key pill defaults to C major', await page.evaluate(() =>
      /C major/.test(document.getElementById('qcKeyPill').textContent)));

    // Switch QC → FC keeps the landing origin.
    await page.click('#screen-qc .nav-switch');
    await page.waitForTimeout(60);
    assert('qc→fc: switch lands on #screen-fc, still in chord-preview', await page.evaluate(() =>
      document.getElementById('screen-fc').classList.contains('active') && document.body.classList.contains('chord-preview')));

    // Back from FC returns to the landing.
    await page.click('#screen-fc .back-btn');
    await page.waitForTimeout(60);
    assert('back: chord-preview cleared', await page.evaluate(() => !document.body.classList.contains('chord-preview')));
    assert('back: #landing visible again, #app hidden', (await visible(page, '#landing')) && !(await visible(page, '#app')));
  }

  // ── Find a Chord directly from the landing ──
  {
    const page = await (await mobileCtx()).newPage();
    page.on('pageerror', e => errors.push('PAGEERROR(fc): ' + e.message));
    await page.goto(base, { waitUntil: 'load' });
    await page.click('.landing-tools .ltool-btn:nth-child(2)');
    await page.waitForTimeout(80);
    assert('fc: opens #screen-fc in chord-preview (no auth)', await page.evaluate(() =>
      document.getElementById('screen-fc').classList.contains('active') &&
      document.body.classList.contains('chord-preview') && !document.body.classList.contains('signed-in')));
    assert('fc: #landing hidden, #app visible', !(await visible(page, '#landing')) && (await visible(page, '#app')));
  }

  // ── Regression: signed-in rail path still goes Back to the song screen, never the landing ──
  {
    const page = await (await mobileCtx()).newPage();
    page.on('pageerror', e => errors.push('PAGEERROR(reg): ' + e.message));
    await page.goto(base, { waitUntil: 'load' });
    await page.click('.auth-card .auth-btn.ghost');
    await page.waitForSelector('body.signed-in', { timeout: 15000 });
    await page.evaluate(() => { _openSongObj({ id: 'S', title: 'X', key: 'C major', lyricsDoc: '<div>x</div>' }); stopTakesListener(); });
    await page.waitForTimeout(60);
    await page.click('.rail .rail-tool'); // first rail tool = 🎸 Quick Chords
    await page.waitForTimeout(80);
    assert('reg: rail 🎸 opens #screen-qc WITHOUT setting chord-preview', await page.evaluate(() =>
      document.getElementById('screen-qc').classList.contains('active') && !document.body.classList.contains('chord-preview')));
    await page.click('#screen-qc .back-btn');
    await page.waitForTimeout(60);
    assert('reg: Back returns to #screen-song (not the landing)', await page.evaluate(() =>
      document.getElementById('screen-song').classList.contains('active') &&
      document.body.classList.contains('signed-in') && !document.body.classList.contains('chord-preview')));
  }

  // ── Narrow viewport: the two chord buttons stack ──
  {
    const page = await (await browser.newContext({ viewport: { width: 320, height: 700 }, hasTouch: true, isMobile: true })).newPage();
    await page.goto(base, { waitUntil: 'load' });
    assert('narrow: .landing-tools stacks (flex-direction column) at ≤360px', await page.evaluate(() =>
      getComputedStyle(document.querySelector('.landing-tools')).flexDirection === 'column'));
  }

  // ── Fit: at a realistic short Safari viewport, the landing fits with NO clipping/scroll ──
  // 390×640 approximates an iPhone with the URL bar + bottom toolbar showing.
  {
    const page = await (await browser.newContext({ viewport: { width: 390, height: 640 }, hasTouch: true, isMobile: true })).newPage();
    await page.goto(base, { waitUntil: 'load' });
    const fit = await page.evaluate(() => {
      const L = document.getElementById('landing');
      const noScroll = L.scrollHeight <= L.clientHeight + 1; // fits without overflow
      const kids = [...L.children];
      const top = kids[0].getBoundingClientRect().top;
      const bot = kids[kids.length - 1].getBoundingClientRect().bottom;
      return { noScroll, top, bot, vh: window.innerHeight };
    });
    assert('fit@640: landing fits without scrolling (no overflow)', fit.noScroll);
    assert('fit@640: nothing clipped — brand top >= 0 and guest button bottom <= viewport', fit.top >= 0 && fit.bot <= fit.vh + 1);
    await page.screenshot({ path: '_shot_lite_1048_fit640.png' });
  }

  // ── Safety net: at a too-short viewport it scrolls instead of clipping the top ──
  {
    const page = await (await browser.newContext({ viewport: { width: 390, height: 460 }, hasTouch: true, isMobile: true })).newPage();
    await page.goto(base, { waitUntil: 'load' });
    const top = await page.evaluate(() => document.getElementById('landing').children[0].getBoundingClientRect().top);
    assert('overflow@460: brand top stays on-screen (>= 0), not clipped above', top >= 0);
  }

  // ── Guest banner beside Songs + "Sign in to save" re-opens the login overlay ──
  {
    const page = await (await mobileCtx()).newPage();
    page.on('pageerror', e => errors.push('PAGEERROR(guest): ' + e.message));
    await page.goto(base, { waitUntil: 'load' });
    await page.click('.auth-card .auth-btn.ghost');         // Continue as guest (anonymous)
    await page.waitForSelector('body.signed-in', { timeout: 15000 });
    await page.waitForTimeout(80);
    assert('guest: body.is-guest set for an anonymous session', await page.evaluate(() =>
      document.body.classList.contains('is-guest')));
    assert('guest: banner visible beside Songs, reads "Guest" + "Sign in to save"', await page.evaluate(() => {
      const t = document.querySelector('.lg-title .guest-tag');
      return !!t && getComputedStyle(t).display !== 'none' && t.getClientRects().length > 0
        && /Guest/.test(t.textContent) && /Sign in to save/.test(t.textContent);
    }));
    assert('guest: banner sits left (with Songs), the ＋ stays on the right', await page.evaluate(() => {
      const head = document.querySelector('.lg-title .lg-head');
      const add = document.querySelector('.lg-title .add');
      return !!head && !!add && head.contains(document.querySelector('.guest-tag'))
        && add.getBoundingClientRect().left > head.getBoundingClientRect().right - 1;
    }));

    // CSS gate: a real (non-guest) account hides the banner.
    assert('gate: removing is-guest hides the banner; re-adding shows it', await page.evaluate(() => {
      const t = document.querySelector('.guest-tag');
      document.body.classList.remove('is-guest'); const hidden = getComputedStyle(t).display === 'none';
      document.body.classList.add('is-guest');    const shown  = getComputedStyle(t).display !== 'none';
      return hidden && shown;
    }));

    // Tap "Sign in to save" → login overlay returns ON TOP of the app, guest session intact.
    await page.click('.guest-signin');
    await page.waitForTimeout(60);
    assert('relogin: tapping "Sign in to save" sets body.relogin', await page.evaluate(() =>
      document.body.classList.contains('relogin')));
    assert('relogin: #landing is visible again over the still-present app', await page.evaluate(() =>
      getComputedStyle(document.getElementById('landing')).display === 'flex' &&
      getComputedStyle(document.getElementById('app')).display === 'block' &&
      document.body.classList.contains('signed-in')));
    await page.screenshot({ path: '_shot_lite_1048_relogin.png' });

    // "Continue as guest" from the re-login overlay dismisses it, keeps the guest session.
    await page.click('.auth-card .auth-btn.ghost');
    await page.waitForTimeout(80);
    assert('relogin: Continue-as-guest clears body.relogin + hides #landing', await page.evaluate(() =>
      !document.body.classList.contains('relogin') &&
      getComputedStyle(document.getElementById('landing')).display === 'none' &&
      document.body.classList.contains('signed-in') && document.body.classList.contains('is-guest')));
  }

  // ── Guest → account: must LINK (preserve uid/songs), not create a fresh account ──
  // Stub link/create/sign-in so we assert routing without creating real Firebase accounts.
  {
    const page = await (await mobileCtx()).newPage();
    page.on('pageerror', e => errors.push('PAGEERROR(link): ' + e.message));
    await page.goto(base, { waitUntil: 'load' });
    await page.click('.auth-card .auth-btn.ghost');                 // real anonymous guest
    await page.waitForSelector('body.signed-in', { timeout: 15000 });
    await page.waitForTimeout(60);
    assert('link: a real anonymous guest session exists (isAnonymous)', await page.evaluate(() =>
      !!auth.currentUser && auth.currentUser.isAnonymous === true));

    // Signup while guest → linkWithCredential, NOT createUserWithEmailAndPassword.
    const email = await page.evaluate(() => new Promise(resolve => {
      let linked = false, created = false;
      auth.currentUser.linkWithCredential = () => { linked = true; return Promise.resolve({}); };
      auth.createUserWithEmailAndPassword = () => { created = true; return Promise.resolve({}); };
      _authMode = 'signup';
      document.getElementById('authEmail').value = 'verify_guest@example.com';
      document.getElementById('authPass').value = 'secret123';
      authEmailSubmit({ preventDefault() {} });
      setTimeout(() => resolve({ linked, created }), 60);
    }));
    assert('link: guest "Create account" LINKS the credential (keeps uid)', email.linked === true);
    assert('link: guest "Create account" does NOT call createUserWithEmailAndPassword', email.created === false);
    assert('link: on success the relogin overlay + guest banner are cleared', await page.evaluate(() =>
      !document.body.classList.contains('relogin') && !document.body.classList.contains('is-guest')));

    // Google while guest → linkWithPopup, NOT signInWithPopup.
    const g = await page.evaluate(() => new Promise(resolve => {
      let linkedPopup = false, signedPopup = false;
      auth.currentUser.linkWithPopup = () => { linkedPopup = true; return Promise.resolve({}); };
      auth.signInWithPopup = () => { signedPopup = true; return Promise.resolve({}); };
      authGoogle();
      setTimeout(() => resolve({ linkedPopup, signedPopup }), 60);
    }));
    assert('link: guest Google sign-in uses linkWithPopup (keeps uid)', g.linkedPopup === true && g.signedPopup === false);

    // Signing IN to an existing account (not signup) from guest stays a plain sign-in (no link attempt).
    const si = await page.evaluate(() => new Promise(resolve => {
      let linked = false, signedIn = false;
      auth.currentUser.linkWithCredential = () => { linked = true; return Promise.resolve({}); };
      auth.signInWithEmailAndPassword = () => { signedIn = true; return Promise.resolve({}); };
      _authMode = 'signin';
      document.getElementById('authEmail').value = 'existing@example.com';
      document.getElementById('authPass').value = 'secret123';
      authEmailSubmit({ preventDefault() {} });
      setTimeout(() => resolve({ linked, signedIn }), 60);
    }));
    assert('link: guest "Sign in" (existing acct) uses signInWithEmailAndPassword, not link', si.signedIn === true && si.linked === false);
  }

  // ── Guest banner screenshot ──
  {
    const page = await (await mobileCtx()).newPage();
    await page.goto(base, { waitUntil: 'load' });
    await page.click('.auth-card .auth-btn.ghost');
    await page.waitForSelector('body.signed-in', { timeout: 15000 });
    await page.waitForTimeout(120);
    await page.screenshot({ path: '_shot_lite_1048_guestlist.png' });
  }

  // ── Screenshots ──
  {
    const page = await (await mobileCtx()).newPage();
    await page.goto(base, { waitUntil: 'load' });
    await page.screenshot({ path: '_shot_lite_1048_landing.png' });
    await page.click('.landing-tools .ltool-btn:nth-child(1)'); await page.waitForTimeout(120);
    await page.screenshot({ path: '_shot_lite_1048_qc.png' });
    await page.click('#screen-qc .nav-switch'); await page.waitForTimeout(120);
    await page.screenshot({ path: '_shot_lite_1048_fc.png' });
  }

  const fatal = errors.filter(e => !/permission|insufficient|FirebaseError|Failed to load resource|net::ERR|storage\//i.test(e));
  assert('no fatal JS errors', fatal.length === 0);
  if (fatal.length) console.log('FATAL:\n' + fatal.join('\n'));
  console.log(results.join('\n'));
  await browser.close(); srv.close();
  if (results.some(r => r.startsWith('FAIL'))) process.exit(1);
})();
