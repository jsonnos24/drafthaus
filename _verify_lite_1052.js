// lite-1.052: no-account chord tools on the landing (Quick Chords / Find a Chord),
// sign-in nudge, and Back routing to the landing for preview visitors.
const { chromium } = require('playwright-core');
const path = require('path'); const http = require('http'); const fs = require('fs');
const BUILD = 'lite-1.052.html';
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
  const desktopCtx = () => browser.newContext({ viewport: { width: 1100, height: 820 } });

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
    await page.screenshot({ path: '_shot_lite_1052_fit640.png' });
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
    await page.screenshot({ path: '_shot_lite_1052_relogin.png' });

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
    await page.screenshot({ path: '_shot_lite_1052_guestlist.png' });
  }

  // ── Export button: placement + desktop-only gating ──
  {
    const page = await (await desktopCtx()).newPage();
    page.on('pageerror', e => errors.push('PAGEERROR(export-ui): ' + e.message));
    await page.goto(base, { waitUntil: 'load' });
    await page.click('.auth-card .auth-btn.ghost');
    await page.waitForSelector('body.signed-in', { timeout: 15000 });
    await page.waitForTimeout(80);
    assert('export: button visible on desktop, labelled "Export"', await page.evaluate(() => {
      const b = document.querySelector('.lg-export');
      return !!b && getComputedStyle(b).display !== 'none' && /Export/.test(b.textContent);
    }));
    assert('export: button sits to the LEFT of the ＋ (both inside .lg-actions)', await page.evaluate(() => {
      const ex = document.querySelector('.lg-export'), add = document.querySelector('.lg-title .add');
      const acts = document.querySelector('.lg-actions');
      return acts.contains(ex) && acts.contains(add) && ex.getBoundingClientRect().right <= add.getBoundingClientRect().left + 1;
    }));
    assert('export: no songs → exportStart toasts "No songs to export"', await page.evaluate(() => {
      if (_songsUnsub) { _songsUnsub(); _songsUnsub = null; } _songs = [];
      exportStart();
      return /No songs to export/.test(document.getElementById('toast').textContent) && !document.querySelector('.export-choice');
    }));
  }

  // ── Export selection mode: dialog → pick songs → Export Selected / Clear / Cancel ──
  {
    const page = await (await desktopCtx()).newPage();
    page.on('pageerror', e => errors.push('PAGEERROR(export-select): ' + e.message));
    await page.goto(base, { waitUntil: 'load' });
    await page.click('.auth-card .auth-btn.ghost');
    await page.waitForSelector('body.signed-in', { timeout: 15000 });
    await page.evaluate(() => {
      if (_songsUnsub) { _songsUnsub(); _songsUnsub = null; }
      _songs = [
        { id: 'A', title: 'Song A', updatedAt: Date.now() },
        { id: 'B', title: 'Song B', updatedAt: Date.now() },
        { id: 'C', title: 'Song C', updatedAt: Date.now() },
      ];
      _songsLoaded = true; renderSongList();
    });
    await page.click('.lg-export'); // Export → dialog
    await page.waitForTimeout(50);
    assert('select: Export opens the choice dialog (Export all / Select songs)', await page.evaluate(() =>
      !!document.querySelector('.export-choice #_exAll') && !!document.querySelector('.export-choice #_exSome')));
    await page.click('#_exSome');
    await page.waitForTimeout(50);
    assert('select: "Select songs…" enters export-select mode with checkboxes visible', await page.evaluate(() =>
      document.body.classList.contains('export-select') && getComputedStyle(document.querySelector('.sl-check')).display === 'flex'));

    await page.click('.sl-row[data-id="A"] .sl-card');
    await page.click('.sl-row[data-id="C"] .sl-card');
    await page.waitForTimeout(40);
    assert('select: tapping a row checks it (no song opened) + count updates', await page.evaluate(() =>
      document.querySelector('.sl-row[data-id="A"] .sl-check').classList.contains('on') &&
      document.querySelector('.sl-row[data-id="C"] .sl-check').classList.contains('on') &&
      !document.querySelector('.sl-row[data-id="B"] .sl-check').classList.contains('on') &&
      document.getElementById('screen-songlist').classList.contains('active') &&
      /Export Selected \(2\)/.test(document.querySelector('.lg-sel-export').textContent)));

    await page.click('.lg-sel-clear');
    await page.waitForTimeout(30);
    assert('select: Clear unchecks all + resets the count', await page.evaluate(() =>
      document.querySelectorAll('.sl-check.on').length === 0 && /Export Selected$/.test(document.querySelector('.lg-sel-export').textContent.trim())));

    assert('select: Export Selected with none → toast "Select at least one song"', await page.evaluate(() => {
      exportSelected();
      return /Select at least one song/.test(document.getElementById('toast').textContent) && document.body.classList.contains('export-select');
    }));

    // Re-select 2 and export → exportAll receives exactly the chosen songs, mode exits.
    await page.click('.sl-row[data-id="A"] .sl-card');
    await page.click('.sl-row[data-id="B"] .sl-card');
    const sel = await page.evaluate(() => {
      window.__exArgs = null; const orig = exportAll; exportAll = (songs) => { window.__exArgs = (songs || []).map(s => s.id); };
      exportSelected();
      const r = { ids: window.__exArgs, mode: document.body.classList.contains('export-select') };
      exportAll = orig; return r;
    });
    assert('select: Export Selected exports only the checked songs + exits mode', sel.ids && sel.ids.length === 2 && sel.ids.includes('A') && sel.ids.includes('B') && !sel.ids.includes('C') && sel.mode === false);

    // Export all from the dialog passes every song; Cancel exits select mode.
    const all = await page.evaluate(() => {
      window.__exArgs = null; const orig = exportAll; exportAll = (songs) => { window.__exArgs = (songs || []).map(s => s.id); };
      exportStart(); document.querySelector('#_exAll').click();
      const ids = window.__exArgs; exportAll = orig; return ids;
    });
    assert('select: "Export all songs" passes every song', all && all.length === 3);
    assert('select: Cancel exits export-select mode', await page.evaluate(() => {
      exportEnterSelect(); const was = document.body.classList.contains('export-select');
      exportCancel(); return was && !document.body.classList.contains('export-select');
    }));
  }
  // Now enabled on mobile too.
  {
    const page = await (await mobileCtx()).newPage();
    await page.goto(base, { waitUntil: 'load' });
    await page.click('.auth-card .auth-btn.ghost');
    await page.waitForSelector('body.signed-in', { timeout: 15000 });
    assert('export: button now VISIBLE on mobile', await page.evaluate(() =>
      getComputedStyle(document.querySelector('.lg-export')).display !== 'none'));
  }

  // ── Export internals: token parsing, PDF output, zip structure (stubbed takes) ──
  {
    const page = await (await desktopCtx()).newPage();
    page.on('pageerror', e => errors.push('PAGEERROR(export-core): ' + e.message));
    await page.goto(base, { waitUntil: 'load' });

    // Pure helpers.
    assert('tokens: a .chord span binds to the word that follows it', await page.evaluate(() => {
      const d = document.createElement('div');
      d.innerHTML = '<span class="chord">G</span>walked the <span class="chord">C</span>line';
      const t = _lineTokens(d);
      return t.length === 3 && t[0].chord === 'G' && t[0].word === 'walked'
        && t[1].chord === null && t[1].word === 'the' && t[2].chord === 'C' && t[2].word === 'line';
    }));
    assert('safeName: strips path-illegal chars + falls back', await page.evaluate(() =>
      _safeName('A/B:C?', 'X') === 'A-B-C' && _safeName('   ', 'Untitled') === 'Untitled'));
    assert('uniqueName: dedupes case-insensitively', await page.evaluate(() => {
      const u = new Set(); return _uniqueName('Song', u) === 'Song' && _uniqueName('song', u) === 'song (2)';
    }));

    // Load the export libs the way the app would, then drive the real builder with stubs.
    let libsLoaded = true;
    try {
      await page.addScriptTag({ url: 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js' });
      await page.addScriptTag({ url: 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js' });
      await page.addScriptTag({ url: 'https://cdnjs.cloudflare.com/ajax/libs/lamejs/1.2.1/lame.min.js' });
    } catch (e) { libsLoaded = false; errors.push('NOTE: export lib CDN unavailable in this run: ' + e.message); }
    assert('libs: JSZip + jsPDF + lamejs available after lazy-load', !libsLoaded ? false : await page.evaluate(() =>
      !!window.JSZip && !!(window.jspdf && window.jspdf.jsPDF) && !!(window.lamejs && window.lamejs.Mp3Encoder)));

    if (libsLoaded) {
      assert('pdf: _lyricsPdf returns a real PDF (%PDF header)', await page.evaluate(() => {
        const ab = _lyricsPdf(window.jspdf.jsPDF, { title: 'T', key: 'C major', lyricsDoc: '<div><span class="chord">G</span>hi there</div>' });
        return String.fromCharCode.apply(null, new Uint8Array(ab).slice(0, 4)) === '%PDF';
      }));
      assert('mp3: _encodeMp3 produces an audio/mp3 blob with an MPEG frame sync', await page.evaluate(async () => {
        const ctx = ensureCtx(); const buf = ctx.createBuffer(1, 8192, 44100);
        const d = buf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.sin(i * 0.05) * 0.3;
        const blob = _encodeMp3(buf);
        if (blob.type !== 'audio/mp3' || blob.size < 100) return false;
        const head = new Uint8Array(await blob.arrayBuffer()).slice(0, 2);
        return head[0] === 0xFF && (head[1] & 0xE0) === 0xE0; // MPEG audio frame sync
      }));
      const keys = await page.evaluate(async () => {
        // Stub: two takes (one renamed, one not) with fixed dates; fake audio + decode (no network).
        const realColl = db.collection.bind(db);
        db.collection = (n) => n === 'voice_takes'
          ? { where: () => ({ get: () => Promise.resolve({ forEach: cb => {
              cb({ id: 't1', data: () => ({ songId: 'X', name: '', downloadUrl: 'blob:a', createdAt: { toDate: () => new Date(2026, 5, 6, 15, 42), toMillis: () => 1 } }) });
              cb({ id: 't2', data: () => ({ songId: 'X', name: 'My Take', downloadUrl: 'blob:b', createdAt: { toDate: () => new Date(2026, 5, 7, 9, 5), toMillis: () => 2 } }) });
            } }) }) }
          : realColl(n);
        window.fetch = () => Promise.resolve({ arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) });
        const ctx = ensureCtx(); ctx.decodeAudioData = () => Promise.resolve(ctx.createBuffer(1, 4096, 44100));
        const songs = [
          { id: 'X1', title: 'My Song', lyricsDoc: '<div><span class="chord">G</span>hello</div>' },
          { id: 'X2', title: 'My Song', lyricsDoc: '<div>verse two</div>' }, // same title → dedupe
        ];
        const prog = [];
        const { zip, skipped } = await _buildExportZip(songs, (done, total) => prog.push([done, total]));
        return { files: Object.keys(zip.files), skipped, prog };
      });
      const has = s => keys.files.some(k => k === s);
      assert('zip: SONGNAME/Lyrics.pdf present per song', has('My Song/Lyrics.pdf') && has('My Song (2)/Lyrics.pdf'));
      assert('zip: duplicate song titles are deduped (My Song (2))', keys.files.some(k => k.indexOf('My Song (2)/') === 0));
      assert('zip: no takes skipped with valid stubbed takes', keys.skipped === 0);
      assert('name: unnamed take → "Take 1 - <date/time>.mp3"', keys.files.some(k => /My Song\/Takes\/Take 1 - June 6th, 2026 - 3-42pm\.mp3/.test(k)));
      assert('name: renamed take → "<name> - Take 2 - <date/time>.mp3"', keys.files.some(k => /My Song\/Takes\/My Take - Take 2 - June 7th, 2026 - 9-05am\.mp3/.test(k)));
      assert('progress: onProgress fires per take, ending at done===total', keys.prog.length > 0 && keys.prog[keys.prog.length - 1][0] === keys.prog[keys.prog.length - 1][1] && keys.prog[keys.prog.length - 1][1] === 4);

      // Fallback: a take the browser can't decode is KEPT in its original format (not skipped).
      assert('ext: _takeExt reads filename first, then mimeType', await page.evaluate(() =>
        _takeExt({ filename: 'take_9.webm' }) === 'webm' &&
        _takeExt({ mimeType: 'audio/mp4' }) === 'm4a' &&
        _takeExt({ mimeType: 'audio/wav' }) === 'wav'));
      const fb = await page.evaluate(async () => {
        const realColl = db.collection.bind(db);
        db.collection = (n) => n === 'voice_takes'
          ? { where: () => ({ get: () => Promise.resolve({ forEach: cb => {
              cb({ id: 'w1', data: () => ({ songId: 'X', name: '', filename: 'take_1.webm', mimeType: 'audio/webm;codecs=opus', downloadUrl: 'blob:w', createdAt: { toDate: () => new Date(2026, 5, 6, 15, 42), toMillis: () => 1 } }) });
            } }) }) }
          : realColl(n);
        window.fetch = () => Promise.resolve({ arrayBuffer: () => Promise.resolve(new Uint8Array([1, 2, 3, 4]).buffer) });
        const ctx = ensureCtx(); ctx.decodeAudioData = () => Promise.reject(new Error('iOS cannot decode webm'));
        const { zip, kept, skipped } = await _buildExportZip([{ id: 'X1', title: 'WebmSong', lyricsDoc: '<div>x</div>' }]);
        return { files: Object.keys(zip.files), kept, skipped };
      });
      assert('fallback: undecodable take kept as original .webm (kept=1, skipped=0)', fb.kept === 1 && fb.skipped === 0 &&
        fb.files.some(k => /WebmSong\/Takes\/Take 1 - June 6th, 2026 - 3-42pm\.webm$/.test(k)) &&
        !fb.files.some(k => /\.mp3$/.test(k)));

      // A genuine download failure still counts as a real skip (nothing to keep).
      const sk = await page.evaluate(async () => {
        const realColl = db.collection.bind(db);
        db.collection = (n) => n === 'voice_takes'
          ? { where: () => ({ get: () => Promise.resolve({ forEach: cb => cb({ id: 'x', data: () => ({ songId: 'X', downloadUrl: 'blob:x', filename: 'take.webm', createdAt: { toMillis: () => 1, toDate: () => new Date() } }) }) }) }) }
          : realColl(n);
        window.fetch = () => Promise.reject(new Error('network down'));
        const { zip, kept, skipped } = await _buildExportZip([{ id: 'X1', title: 'S', lyricsDoc: '<div>x</div>' }]);
        return { kept, skipped, hasTakes: Object.keys(zip.files).some(k => /\/Takes\//.test(k)) };
      });
      assert('fallback: a true download failure still counts as skipped (kept=0, no take file)', sk.skipped === 1 && sk.kept === 0 && !sk.hasTakes);
    }
  }

  // ── Progress overlay + ETA + cancel + delivery (share vs download) ──
  {
    const page = await (await desktopCtx()).newPage();
    page.on('pageerror', e => errors.push('PAGEERROR(progress): ' + e.message));
    await page.goto(base, { waitUntil: 'load' });
    assert('eta: _fmtETA formats seconds + minutes', await page.evaluate(() =>
      _fmtETA(8000) === '~8s' && _fmtETA(125000) === '~2m 5s' && _fmtETA(120000) === '~2m'));
    assert('progress: _exProgShow builds the overlay; _exProgSet fills + labels', await page.evaluate(() => {
      _exProgShow(); _exProgSet(50, 'Converting take 2 of 4 · ~6s left');
      const ok = !!document.getElementById('exportProgress') &&
        document.getElementById('epFill').style.width === '50%' &&
        /Converting take 2 of 4/.test(document.getElementById('epStatus').textContent);
      return ok;
    }));
    assert('progress: Cancel sets _exportAbort', await page.evaluate(() => {
      _exportAbort = false; document.getElementById('epCancel').click(); return _exportAbort === true;
    }));
    assert('progress: _exProgHide removes the overlay', await page.evaluate(() => {
      _exProgHide(); return !document.getElementById('exportProgress');
    }));
    assert('abort: _buildExportZip returns aborted with no jobs when pre-aborted', await page.evaluate(async () => {
      _exportAbort = true;
      const r = await _buildExportZip([{ id: 'Z', title: 'Z', lyricsDoc: '<div>x</div>' }]);
      _exportAbort = false;
      return r.aborted === true;
    }));
    // Desktop delivery uses download (no share), even if share were available.
    assert('deliver: desktop path does NOT call navigator.share', await page.evaluate(async () => {
      let shared = false; navigator.canShare = () => true; navigator.share = () => { shared = true; return Promise.resolve(); };
      await _deliver(new Blob(['x']), 'T.zip');
      return shared === false; // desktop (hover/fine) → download branch
    }));
  }
  // Mobile delivery uses the share sheet when available.
  {
    const page = await (await mobileCtx()).newPage();
    await page.goto(base, { waitUntil: 'load' });
    assert('deliver: mobile path calls navigator.share with the zip file', await page.evaluate(async () => {
      let sharedFiles = null; navigator.canShare = () => true; navigator.share = (d) => { sharedFiles = d.files; return Promise.resolve(); };
      await _deliver(new Blob(['x'], { type: 'application/zip' }), 'T.zip');
      return Array.isArray(sharedFiles) && sharedFiles.length === 1 && sharedFiles[0].name === 'T.zip';
    }));
  }

  // ── Screenshots ──
  {
    const page = await (await mobileCtx()).newPage();
    await page.goto(base, { waitUntil: 'load' });
    await page.screenshot({ path: '_shot_lite_1052_landing.png' });
    await page.click('.landing-tools .ltool-btn:nth-child(1)'); await page.waitForTimeout(120);
    await page.screenshot({ path: '_shot_lite_1052_qc.png' });
    await page.click('#screen-qc .nav-switch'); await page.waitForTimeout(120);
    await page.screenshot({ path: '_shot_lite_1052_fc.png' });
  }

  const fatal = errors.filter(e => !/permission|insufficient|FirebaseError|Failed to load resource|net::ERR|storage\//i.test(e));
  assert('no fatal JS errors', fatal.length === 0);
  if (fatal.length) console.log('FATAL:\n' + fatal.join('\n'));
  console.log(results.join('\n'));
  await browser.close(); srv.close();
  if (results.some(r => r.startsWith('FAIL'))) process.exit(1);
})();
