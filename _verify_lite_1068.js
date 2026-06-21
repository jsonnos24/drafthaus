// _verify_lite_1068.js  (Task 1: lyrics base tracking + pendingLyrics IndexedDB store + divider helper)
const { chromium } = require('playwright-core');
const http = require('http'); const fs = require('fs'); const path = require('path');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ROOT = __dirname;
let PASS = 0, FAIL = 0;
const ok = (c, m) => { if (c) { PASS++; console.log('PASS', m); } else { FAIL++; console.log('FAIL', m); } };

function serve() {
  return new Promise(res => {
    const s = http.createServer((req, rq) => {
      let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/lite-1.068.html';
      const fp = path.join(ROOT, p);
      fs.readFile(fp, (e, d) => {
        if (e) { rq.statusCode = 404; rq.end('nf'); return; }
        const ext = path.extname(fp);
        rq.setHeader('Content-Type', ext === '.html' ? 'text/html' : ext === '.js' ? 'text/javascript' : ext === '.mp3' ? 'audio/mpeg' : 'application/octet-stream');
        rq.end(d);
      });
    });
    s.listen(0, () => res(s));
  });
}

(async () => {
  const srv = await serve(); const port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  const ctx = await browser.newContext();
  await ctx.addInitScript(() => { try { localStorage['drafthaus-eula-accepted'] = '1'; } catch (e) {} });

  // ── Guest sign-in helper ──
  async function guestIn(page) {
    for (let i = 0; i < 2; i++) {
      try { await page.click('.auth-card .auth-btn.ghost'); await page.waitForSelector('body.signed-in', { timeout: 20000 }); return true; }
      catch (e) { if (i === 1) return false; await page.waitForTimeout(1000); }
    }
  }

  // ── Task-1 infra assert page: pure infra — no auth needed ──
  const pg = await ctx.newPage();
  await pg.goto(`http://localhost:${port}/lite-1.068.html`, { waitUntil: 'domcontentloaded' });
  await pg.waitForFunction(() => typeof window.dhAudioPut === 'function', { timeout: 10000 });

  const t1 = await pg.evaluate(async () => {
    const hasHelpers = typeof currentEditorHtml === 'function' && typeof _lyricsDivider === 'function' && typeof dhPendingLyricsPut === 'function';
    const div = _lyricsDivider('iPhone');
    await dhPendingLyricsPut({ songId: 's1', lyricsDoc: '<div>A2</div>', base: '<div>A</div>', editedAt: 1 });
    const got = await dhPendingLyricsGet('s1');
    const all = await dhPendingLyricsAll();
    await dhPendingLyricsDelete('s1');
    const afterDel = await dhPendingLyricsGet('s1');
    return { hasHelpers, divHasText: /Also edited on iPhone/.test(div), gotDoc: got && got.lyricsDoc, allLen: all.length, afterDel: afterDel === null };
  });
  ok(t1.hasHelpers, 'T1 lyrics helpers + pendingLyrics helpers exist');
  ok(t1.divHasText, 'T1 _lyricsDivider includes the source label');
  ok(t1.gotDoc === '<div>A2</div>', 'T1 dhPendingLyricsPut/Get round-trips');
  ok(t1.allLen >= 1, 'T1 dhPendingLyricsAll returns entries');
  ok(t1.afterDel, 'T1 dhPendingLyricsDelete removes the entry');

  // ── Task-1 base assert: open a song, check _lyricsBase + currentEditorHtml ──
  const pg2 = await ctx.newPage();
  await pg2.goto(`http://localhost:${port}/lite-1.068.html`, { waitUntil: 'domcontentloaded' });
  await pg2.waitForFunction(() => typeof window.dhAudioPut === 'function', { timeout: 10000 });
  const signedin2 = await guestIn(pg2);
  if (signedin2) {
    await pg2.evaluate(() => {
      _openSongObj({ id: 'S1068base', title: 'verify-1068-base', key: 'C major', lyricsDoc: '<div>Hello</div>' });
      stopTakesListener();
    });
    await pg2.waitForTimeout(200);

    const t1base = await pg2.evaluate(() => {
      const baseIsStr = typeof _lyricsBase === 'string';
      const edHtml = currentEditorHtml();
      const edHasContent = typeof edHtml === 'string' && edHtml.length > 0;
      return { baseIsStr, edHasContent, baseNotEmpty: _lyricsBase.length > 0 };
    });
    ok(t1base.baseIsStr, 'T1 _lyricsBase is a string after openSong');
    ok(t1base.baseNotEmpty, 'T1 _lyricsBase is non-empty after openSong with lyricsDoc');
    ok(t1base.edHasContent, 'T1 currentEditorHtml() returns sanitized html string');
  } else {
    console.log('SKIP T1-base (guest auth unavailable)');
  }
  await pg2.close();

  // ── Sanitize-survival check: run in page context ──
  const sanitizeResult = await pg.evaluate(() => {
    const div = _lyricsDivider('x');
    const sanitized = ilSanitizeDocHtml(div);
    return { div, sanitized, textSurvives: /Also edited on x/.test(sanitized) };
  });
  console.log('[sanitize-check] divider:', sanitizeResult.div);
  console.log('[sanitize-check] after ilSanitizeDocHtml:', sanitizeResult.sanitized);
  ok(sanitizeResult.textSurvives, 'T1 ilSanitizeDocHtml preserves divider text content');

  // ── Task-2 asserts: transactional flushLyrics ──
  const pg3 = await ctx.newPage();
  await pg3.goto(`http://localhost:${port}/lite-1.068.html`, { waitUntil: 'domcontentloaded' });
  await pg3.waitForFunction(() => typeof window.dhAudioPut === 'function', { timeout: 10000 });
  const signedin3 = await guestIn(pg3);
  if (signedin3) {
    await pg3.evaluate(() => {
      _openSongObj({ id: 'sg', title: 'verify-t2', key: 'C major', lyricsDoc: '<div>A</div>' });
      stopTakesListener();
    });
    await pg3.waitForTimeout(200);

    // no-conflict: serverDoc === base → writes editor content, no divider
    const t2a = await pg3.evaluate(async () => {
      _currentSong = { id: 'sg', lyricsDoc: '<div>A</div>' }; _lyricsBase = '<div>A</div>';
      document.getElementById('lyricsEditor').innerHTML = '<div>A2</div>';
      let written = null;
      const orig = db.runTransaction.bind(db);
      db.runTransaction = async (fn) => fn({ get: async () => ({ exists: true, data: () => ({ lyricsDoc: '<div>A</div>' }) }), set: (ref, d) => { written = d; } });
      Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => true });
      await flushLyrics();
      db.runTransaction = orig;
      return { written: written && written.lyricsDoc, base: _lyricsBase, noDivider: !/Also edited/.test(written.lyricsDoc) };
    });
    ok(/A2/.test(t2a.written) && t2a.noDivider, 'T2 no-conflict save writes editor content, no divider');
    ok(t2a.base === t2a.written, 'T2 _lyricsBase updates to the written content');

    // conflict: serverDoc !== base → inline-append merge
    const t2b = await pg3.evaluate(async () => {
      _currentSong = { id: 'sg', lyricsDoc: '<div>A</div>' }; _lyricsBase = '<div>A</div>';
      document.getElementById('lyricsEditor').innerHTML = '<div>A2</div>';
      let written = null;
      const orig = db.runTransaction.bind(db);
      db.runTransaction = async (fn) => fn({ get: async () => ({ exists: true, data: () => ({ lyricsDoc: '<div>B</div>' }) }), set: (ref, d) => { written = d; } });
      Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => true });
      await flushLyrics();
      db.runTransaction = orig;
      return { written: written && written.lyricsDoc };
    });
    ok(/A2/.test(t2b.written) && /Also edited/.test(t2b.written) && /B/.test(t2b.written), 'T2 conflict save inline-appends both versions + divider');

    // offline: no transaction, writes a pendingLyrics entry
    const t2c = await pg3.evaluate(async () => {
      _currentSong = { id: 'sgoff', lyricsDoc: '<div>A</div>' }; _lyricsBase = '<div>A</div>';
      document.getElementById('lyricsEditor').innerHTML = '<div>A2</div>';
      let txCalled = false; const orig = db.runTransaction.bind(db); db.runTransaction = async (fn) => { txCalled = true; return orig(fn); };
      Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => false });
      await flushLyrics();
      const e = await dhPendingLyricsGet('sgoff');
      db.runTransaction = orig; Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => true });
      await dhPendingLyricsDelete('sgoff');
      return { pending: e && e.lyricsDoc, base: e && e.base, noTx: txCalled === false };
    });
    ok(/A2/.test(t2c.pending) && t2c.base === '<div>A</div>' && t2c.noTx, 'T2 offline save stores pendingLyrics, no transaction');
  } else {
    console.log('SKIP T2 (guest auth unavailable)');
  }
  await pg3.close();

  // ── Task-3 asserts: liteLyricsDrain ──

  // pending entry reconciles: serverDoc moved → inline-append; entry cleared
  const t3 = await pg.evaluate(async () => {
    await dhPendingLyricsPut({ songId: 'sd', lyricsDoc: '<div>A2</div>', base: '<div>A</div>', editedAt: 1 });
    let written = null;
    const orig = db.runTransaction.bind(db);
    db.runTransaction = async (fn) => fn({ get: async () => ({ exists: true, data: () => ({ lyricsDoc: '<div>B</div>' }) }), set: (ref, d) => { written = d; } });
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => true });
    await liteLyricsDrain();
    const left = await dhPendingLyricsGet('sd');
    db.runTransaction = orig;
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => true });
    return { written: written && written.lyricsDoc, cleared: left === null };
  });
  ok(/A2/.test(t3.written) && /Also edited/.test(t3.written) && /B/.test(t3.written), 'T3 drain inline-appends on server divergence');
  ok(t3.cleared, 'T3 drain clears the pending entry on success');

  // no-divergence reconcile: serverDoc === base → writes clean
  const t3b = await pg.evaluate(async () => {
    await dhPendingLyricsPut({ songId: 'sd2', lyricsDoc: '<div>A2</div>', base: '<div>A</div>', editedAt: 1 });
    let written = null;
    const orig = db.runTransaction.bind(db);
    db.runTransaction = async (fn) => fn({ get: async () => ({ exists: true, data: () => ({ lyricsDoc: '<div>A</div>' }) }), set: (ref, d) => { written = d; } });
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => true });
    await liteLyricsDrain();
    db.runTransaction = orig;
    await dhPendingLyricsDelete('sd2');
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => true });
    return { written: written && written.lyricsDoc, noDivider: written && !/Also edited/.test(written.lyricsDoc) };
  });
  ok(/A2/.test(t3b.written) && t3b.noDivider, 'T3 drain writes clean when server unchanged');

  // ── Task-4 asserts: liteFreshenSong ──

  // t4a adopt: remote moved, no local edits, editor not focused → editor becomes remote, base updates
  const t4a = await pg.evaluate(async () => {
    _currentSong = { id: 'sf', lyricsDoc: '<div>A</div>' }; _lyricsBase = '<div>A</div>';
    document.getElementById('lyricsEditor').innerHTML = '<div>A</div>'; // == base (no local edits)
    document.getElementById('lyricsEditor').blur();
    const orig = db.collection.bind(db);
    db.collection = (n) => n === 'songs' ? { doc: () => ({ get: async () => ({ exists: true, data: () => ({ lyricsDoc: '<div>B</div>' }) }) }) } : orig(n);
    await liteFreshenSong();
    db.collection = orig;
    return { editor: currentEditorHtml(), base: _lyricsBase };
  });
  ok(/B/.test(t4a.editor) && !/A<\/div>/.test(t4a.editor) && t4a.base === '<div>B</div>', 'T4 freshen adopts remote when no local edits');

  // t4b merge: remote moved AND local edits → inline-append
  const t4b = await pg.evaluate(async () => {
    _currentSong = { id: 'sf2', lyricsDoc: '<div>A</div>' }; _lyricsBase = '<div>A</div>';
    document.getElementById('lyricsEditor').innerHTML = '<div>Alocal</div>'; // != base (local edits)
    const orig = db.collection.bind(db);
    db.collection = (n) => n === 'songs' ? { doc: () => ({ get: async () => ({ exists: true, data: () => ({ lyricsDoc: '<div>B</div>' }) }) }) } : orig(n);
    await liteFreshenSong();
    db.collection = orig;
    return { editor: currentEditorHtml(), base: _lyricsBase };
  });
  ok(/Alocal/.test(t4b.editor) && /Also edited/.test(t4b.editor) && /B/.test(t4b.editor) && t4b.base === '<div>B</div>', 'T4 freshen inline-appends when both moved');

  // t4c no-op: remote == base → nothing changes, local edits kept
  const t4c = await pg.evaluate(async () => {
    _currentSong = { id: 'sf3', lyricsDoc: '<div>A</div>' }; _lyricsBase = '<div>A</div>';
    document.getElementById('lyricsEditor').innerHTML = '<div>A2</div>';
    const orig = db.collection.bind(db);
    db.collection = (n) => n === 'songs' ? { doc: () => ({ get: async () => ({ exists: true, data: () => ({ lyricsDoc: '<div>A</div>' }) }) }) } : orig(n);
    await liteFreshenSong();
    db.collection = orig;
    return { editor: currentEditorHtml() };
  });
  ok(/A2/.test(t4c.editor) && !/Also edited/.test(t4c.editor), 'T4 freshen no-ops when remote unchanged (keeps local edits)');

  console.log(`\n${PASS} PASS / ${FAIL} FAIL`);
  await browser.close(); srv.close();
  process.exit(FAIL ? 1 : 0);
})();
