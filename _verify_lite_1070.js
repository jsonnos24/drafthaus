// _verify_lite_1070.js  (Task 1: share state + id/link/snapshot helpers)
const { chromium } = require('playwright-core');
const http = require('http'); const fs = require('fs'); const path = require('path');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ROOT = __dirname;
let PASS = 0, FAIL = 0;
const ok = (c, m) => { if (c) { PASS++; console.log('PASS', m); } else { FAIL++; console.log('FAIL', m); } };

function serve() {
  return new Promise(res => {
    const s = http.createServer((req, rq) => {
      let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/lite-1.070.html';
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

  // ── Task 1: share id + link + snapshot helpers (no auth needed) ──
  const pgS = await ctx.newPage();
  await pgS.goto(`http://localhost:${port}/lite-1.070.html`, { waitUntil: 'domcontentloaded' });
  await pgS.waitForFunction(() => typeof window.shareNewId === 'function', { timeout: 10000 });
  const s1 = await pgS.evaluate(() => {
    const a = shareNewId(), b = shareNewId();
    const snap = _shareSnapshot(
      { id: 'T1', downloadUrl: 'https://x/y', duration: 12, mimeType: 'audio/mp3' },
      { id: 'S1', title: 'My Song', lyricsDoc: '<div>Hi</div>' });
    _shareId = 'ABC123';
    const link = shareLink();
    return {
      idLen: a.length, idsDiffer: a !== b, urlSafe: /^[A-Za-z0-9_-]+$/.test(a),
      snapOK: snap.takeId === 'T1' && snap.songId === 'S1' && snap.songTitle === 'My Song'
              && snap.lyricsDoc === '<div>Hi</div>' && snap.downloadUrl === 'https://x/y'
              && snap.duration === 12 && typeof snap.addedAt === 'number',
      linkOK: /\?share=ABC123$/.test(link),
    };
  });
  ok(s1.idLen >= 20, 'T1 shareNewId is >=20 chars');
  ok(s1.idsDiffer, 'T1 shareNewId is random (two differ)');
  ok(s1.urlSafe, 'T1 shareNewId is URL-safe');
  ok(s1.snapOK, 'T1 _shareSnapshot builds a correct entry');
  ok(s1.linkOK, 'T1 shareLink returns <origin><path>?share=<id>');

  // ── Task 2: owner data layer with a stubbed shares doc ──
  const pg2 = await ctx.newPage();
  await pg2.goto(`http://localhost:${port}/lite-1.070.html`, { waitUntil: 'domcontentloaded' });
  await pg2.waitForFunction(() => typeof window.shareAddTake === 'function', { timeout: 10000 });
  const s2 = await pg2.evaluate(async () => {
    // In-memory fake of the one shares doc.
    let store = { exists: false, data: { takes: [], active: true, ownerId: 'U1' } };
    let listener = null;
    const fakeDocRef = {
      id: 'SHID',
      get: async () => ({ exists: store.exists, data: () => store.data }),
      set: (obj, opt) => { store.exists = true; store.data = opt && opt.merge ? Object.assign({}, store.data, obj) : obj; if (listener) listener({ exists: true, data: () => store.data }); return Promise.resolve(); },
      onSnapshot: (cb) => { listener = cb; cb({ exists: store.exists, data: () => store.data }); return () => { listener = null; }; },
    };
    const fakeShares = {
      doc: () => fakeDocRef,
      where: () => ({ limit: () => ({ get: async () => ({ empty: true, docs: [] }) }) }),
    };
    const realCollection = db.collection.bind(db);
    db.collection = (name) => name === 'shares' ? fakeShares : realCollection(name);
    Object.defineProperty(auth, 'currentUser', { get: () => ({ uid: 'U1', isAnonymous: false }), configurable: true });  // uid() reads this
    _currentSong = { id: 'S1', title: 'Song One', lyricsDoc: '<div>La</div>' };

    const take = { id: 'TK1', downloadUrl: 'https://a/b', duration: 9, mimeType: 'audio/mp3' };
    await shareAddTake(take);
    const afterAdd = { shared: shareIsShared('TK1'), n: _shareTakes.length, title: _shareTakes[0] && _shareTakes[0].songTitle };
    await shareAddTake(take);                 // dedupe
    const afterDup = _shareTakes.length;
    await shareSetActive(false);
    const activeFlag = _shareActive;
    await shareRemoveTake('TK1');
    const afterRemove = { shared: shareIsShared('TK1'), n: _shareTakes.length };
    const noUrlBlocked = await shareAddTake({ id: 'TK2', duration: 3 }).then(() => shareIsShared('TK2'));
    return { afterAdd, afterDup, activeFlag, afterRemove, noUrlBlocked };
  });
  ok(s2.afterAdd.shared && s2.afterAdd.n === 1, 'T2 shareAddTake adds + shareIsShared true');
  ok(s2.afterAdd.title === 'Song One', 'T2 added entry carries song title snapshot');
  ok(s2.afterDup === 1, 'T2 shareAddTake dedupes by takeId');
  ok(s2.activeFlag === false, 'T2 shareSetActive(false) flips _shareActive');
  ok(!s2.afterRemove.shared && s2.afterRemove.n === 0, 'T2 shareRemoveTake removes the entry');
  ok(s2.noUrlBlocked === false, 'T2 shareAddTake refuses a take with no downloadUrl');

  // ── Task 3: shareRefresh re-snapshots from _songs/_takes ──
  const pg3 = await ctx.newPage();
  await pg3.goto(`http://localhost:${port}/lite-1.070.html`, { waitUntil: 'domcontentloaded' });
  await pg3.waitForFunction(() => typeof window.shareRefresh === 'function', { timeout: 10000 });
  const s3 = await pg3.evaluate(async () => {
    let written = null;
    _shareId = 'SH';
    _shareWriteTakes = async (takes) => { written = takes; _shareTakes = takes; };  // spy
    _shareTakes = [
      { takeId: 'TK1', songId: 'S1', songTitle: 'OLD TITLE', lyricsDoc: '<div>old</div>', downloadUrl: 'u1', duration: 5, mimeType: 'audio/mp3', addedAt: 1 },
      { takeId: 'TK9', songId: 'GONE', songTitle: 'Ghost', lyricsDoc: '', downloadUrl: 'u9', duration: 2, mimeType: 'audio/mp3', addedAt: 1 },
    ];
    _songs = [{ id: 'S1', title: 'NEW TITLE', lyricsDoc: '<div>new</div>' }];
    _takes = [{ id: 'TK1', downloadUrl: 'u1b', duration: 7, mimeType: 'audio/mp3' }];
    await shareRefresh();
    return {
      n: written && written.length,
      kept: written && written[0],
      droppedGhost: written && !written.some(t => t.takeId === 'TK9'),
    };
  });
  ok(s3.droppedGhost, 'T3 shareRefresh drops entries whose song is gone');
  ok(s3.n === 1, 'T3 shareRefresh keeps the live entry only');
  ok(s3.kept && s3.kept.songTitle === 'NEW TITLE' && s3.kept.lyricsDoc === '<div>new</div>', 'T3 refreshes title + lyrics from _songs');
  ok(s3.kept && s3.kept.downloadUrl === 'u1b' && s3.kept.duration === 7, 'T3 refreshes audio fields from loaded _takes');

  // ── Task 4: per-take share toggle button ──
  const pg4 = await ctx.newPage();
  await pg4.goto(`http://localhost:${port}/lite-1.070.html`, { waitUntil: 'domcontentloaded' });
  await pg4.waitForFunction(() => typeof window.takeShareToggle === 'function', { timeout: 10000 });
  const s4 = await pg4.evaluate(() => {
    // Render a take row directly via renderTakes with a stubbed _takes/_loadedTakeId.
    let added = null, removed = null;
    shareAddTake = async (t) => { added = t.id; _shareTakes = [{ takeId: t.id }]; };
    shareRemoveTake = async (id) => { removed = id; _shareTakes = []; };
    _currentSong = { id: 'S1', title: 'S', lyricsDoc: '' };
    _takes = [{ id: 'TK1', downloadUrl: 'u', duration: 4, mimeType: 'audio/mp3', createdAt: { toMillis: () => 1 } }];
    _loadedTakeId = 'TK1';
    renderTakes();
    const btn = document.querySelector('.take-card[data-id="TK1"] .take-share, .take-row[data-id="TK1"] .take-share');
    const present = !!btn;
    if (btn) btn.click();
    return { present, added };
  });
  ok(s4.present, 'T4 take row has a .take-share button');
  ok(s4.added === 'TK1', 'T4 tapping share adds the take to the tray');

  // ── Task 5: share manager panel ──
  const pg5 = await ctx.newPage();
  await pg5.goto(`http://localhost:${port}/lite-1.070.html`, { waitUntil: 'domcontentloaded' });
  await pg5.waitForFunction(() => typeof window.openShareManager === 'function', { timeout: 10000 });
  const s5 = await pg5.evaluate(async () => {
    shareEnsureDoc = async () => { _shareId = 'SH'; return 'SH'; };  // avoid network
    let copied = null;
    navigator.clipboard.writeText = (s) => { copied = s; return Promise.resolve(); };
    _shareId = 'SH';
    _shareTakes = [{ takeId: 'TK1', songTitle: 'Song A', duration: 12 }, { takeId: 'TK2', songTitle: 'Song B', duration: 30 }];
    _shareActive = true;
    openShareManager();
    const panel = document.getElementById('sharePanel');
    const open = panel && getComputedStyle(panel).display !== 'none';
    const rows = document.querySelectorAll('#sharePanel .sm-row').length;
    await shareCopyLink();
    const hdrBtn = !!document.querySelector('.lg-actions .lg-share');
    return { open, rows, copied, copiedOK: /\?share=SH$/.test(copied || ''), hdrBtn };
  });
  ok(s5.hdrBtn, 'T5 header has a .lg-share button');
  ok(s5.open, 'T5 openShareManager shows #sharePanel');
  ok(s5.rows === 2, 'T5 manager lists one row per tray take');
  ok(s5.copiedOK, 'T5 shareCopyLink copies the share URL');

  // ── Task 6: viewer routing + unavailable ──
  const pg6 = await ctx.newPage();
  await pg6.addInitScript(() => {
    // Stub Firestore get for the shares doc BEFORE app code runs is hard (db not ready);
    // instead we drive shareViewLoad directly below after load.
  });
  await pg6.goto(`http://localhost:${port}/lite-1.070.html?share=ZZZ`, { waitUntil: 'domcontentloaded' });
  await pg6.waitForFunction(() => typeof window.shareViewLoad === 'function', { timeout: 10000 });
  const s6 = await pg6.evaluate(async () => {
    const inView = document.body.classList.contains('share-view');
    const viewerVisible = getComputedStyle(document.getElementById('shareViewer')).display !== 'none';
    const landingHidden = getComputedStyle(document.getElementById('landing')).display === 'none';
    // revoked
    db.collection = ((real) => (n) => n === 'shares' ? { doc: () => ({ get: async () => ({ exists: true, data: () => ({ active: false, takes: [] }) }) }) } : real(n))(db.collection.bind(db));
    await shareViewLoad('ZZZ');
    const revokedMsg = /unavailable/i.test(document.getElementById('shareViewer').textContent);
    // missing
    db.collection = (n) => n === 'shares' ? { doc: () => ({ get: async () => ({ exists: false }) }) } : null;
    await shareViewLoad('NOPE');
    const missingMsg = /unavailable/i.test(document.getElementById('shareViewer').textContent);
    return { inView, viewerVisible, landingHidden, revokedMsg, missingMsg };
  });
  ok(s6.inView, 'T6 ?share= sets body.share-view');
  ok(s6.viewerVisible && s6.landingHidden, 'T6 viewer shown, landing hidden');
  ok(s6.revokedMsg, 'T6 revoked (active:false) shows unavailable');
  ok(s6.missingMsg, 'T6 missing doc shows unavailable');

  // ── Task 7: viewer rows + lyrics expand + auto-advance wiring ──
  const pg7 = await ctx.newPage();
  await pg7.goto(`http://localhost:${port}/lite-1.070.html?share=ABC`, { waitUntil: 'domcontentloaded' });
  await pg7.waitForFunction(() => typeof window.svToggleLyrics === 'function', { timeout: 10000 });
  const s7 = await pg7.evaluate(() => {
    shareViewRender({ active: true, takes: [
      { takeId: 'TK1', songTitle: 'Alpha', lyricsDoc: '<div>Verse one</div>', downloadUrl: 'u1', duration: 10 },
      { takeId: 'TK2', songTitle: 'Beta',  lyricsDoc: '<div>Verse two</div>', downloadUrl: 'u2', duration: 20 },
    ]});
    const rows = document.querySelectorAll('#shareViewer .sv-row');
    const r0 = rows[0];
    const playLeftOfTitle = r0 && r0.querySelector('.sv-play') && r0.querySelector('.sv-play').compareDocumentPosition(r0.querySelector('.sv-title')) & Node.DOCUMENT_POSITION_FOLLOWING;
    // Lyrics now open in a right-side slide-out sheet (overlay), not inline.
    const sheet = document.getElementById('svSheet');
    const noInlineLyrics = r0.querySelector('.sv-lyrics') === null;
    const collapsed = sheet && !sheet.classList.contains('open');
    svToggleLyrics(0);
    const expanded = sheet && sheet.classList.contains('open');
    const lyrText = /Verse one/.test(document.getElementById('svSheetBody').textContent);
    const titleShown = /Alpha/.test(document.getElementById('svSheetTitle').textContent);
    // In-sheet transport: a play button + scrubbable waveform for this take, inside the sheet.
    const sheetHasPlay = !!document.querySelector('#svSheetPlayer .sv-play[data-i="0"]');
    const sheetHasWave = !!document.querySelector('#svSheetPlayer .sv-canvas[data-i="0"]');
    svToggleLyrics(0); // re-tap same row closes
    const closed = sheet && !sheet.classList.contains('open');
    const autoAdvances = typeof svPlay === 'function';
    // XSS escape check: inject a title with HTML special chars
    shareViewRender({ active: true, takes: [
      { takeId: 'TK3', songTitle: '<script>alert(1)</script>', lyricsDoc: '', downloadUrl: 'u3', duration: 5 },
    ]});
    const xssRow = document.querySelector('#shareViewer .sv-row');
    const xssTitle = xssRow && xssRow.querySelector('.sv-title');
    const noLiveScript = xssTitle && xssTitle.querySelector('script') === null;
    const escapedText = xssTitle && xssTitle.textContent.includes('<script>');
    return { count: rows.length, playLeftOfTitle: !!playLeftOfTitle, noInlineLyrics, collapsed, expanded, lyrText, titleShown, sheetHasPlay, sheetHasWave, closed, autoAdvances, noLiveScript, escapedText };
  });
  ok(s7.count === 2, 'T7 renders one row per take');
  ok(s7.playLeftOfTitle, 'T7 play button precedes the song title');
  ok(s7.noInlineLyrics && s7.collapsed, 'T7 lyrics are not inline; sheet starts closed');
  ok(s7.expanded && s7.lyrText && s7.titleShown, 'T7 Lyrics toggle opens the slide-out sheet with lyrics + song title');
  ok(s7.sheetHasPlay && s7.sheetHasWave, 'T7 open sheet includes an in-sheet play button + scrubbable waveform for the take');
  ok(s7.closed, 'T7 re-tapping the same row closes the sheet');
  ok(s7.autoAdvances, 'T7 svPlay exists for auto-advance');
  ok(s7.noLiveScript && s7.escapedText, 'T7 song title with HTML chars is escaped, no live <script> injected');

  // ── Task 8: viewer reads ONLY the shares collection ──
  const pg8 = await ctx.newPage();
  await pg8.goto(`http://localhost:${port}/lite-1.070.html?share=ABC`, { waitUntil: 'domcontentloaded' });
  await pg8.waitForFunction(() => typeof window.shareViewLoad === 'function', { timeout: 10000 });
  const s8 = await pg8.evaluate(async () => {
    const seen = [];
    db.collection = ((real) => (n) => { seen.push(n); return n === 'shares'
      ? { doc: () => ({ get: async () => ({ exists: true, data: () => ({ active: true, takes: [] }) }) }) }
      : real(n); })(db.collection.bind(db));
    await shareViewLoad('ABC');
    return { only: seen.every(n => n === 'shares'), touchedShares: seen.includes('shares') };
  });
  ok(s8.touchedShares && s8.only, 'T8 viewer reads only the shares collection');

  // ── Task 8: no-harm regression — owner app still works ──
  const pg8b = await ctx.newPage();
  await pg8b.goto(`http://localhost:${port}/lite-1.070.html`, { waitUntil: 'domcontentloaded' });
  await pg8b.waitForFunction(() => typeof window.renderTakes === 'function', { timeout: 10000 });
  const s8b = await pg8b.evaluate(() => {
    const hasTakesFn = typeof renderTakes === 'function';
    const hasLanding = !!document.getElementById('landing');
    const notShareView = !document.body.classList.contains('share-view');
    // owner app must not be force-darkened by the viewer path (headless default is light)
    const notForcedDark = !document.documentElement.classList.contains('dark');
    return { hasTakesFn, hasLanding, notShareView, notForcedDark };
  });
  ok(s8b.hasTakesFn, 'T8 no-harm: renderTakes is a function in the owner app');
  ok(s8b.notForcedDark, 'T8 no-harm: owner app is not forced dark (viewer-only)');
  ok(s8b.hasLanding, 'T8 no-harm: #landing element present on normal load');
  ok(s8b.notShareView, 'T8 no-harm: normal load does not enter share-view mode');

  // ── Task 9a: shareEnsureDoc in-flight deduplication ──
  const pg9a = await ctx.newPage();
  await pg9a.goto(`http://localhost:${port}/lite-1.070.html`, { waitUntil: 'domcontentloaded' });
  await pg9a.waitForFunction(() => typeof window.shareEnsureDoc === 'function', { timeout: 10000 });
  const s9a = await pg9a.evaluate(async () => {
    // Wire up the same fake shares environment as T2 so shareEnsureDoc can run.
    let createCount = 0;
    let store = { exists: false, data: { takes: [], active: true, ownerId: 'U9' } };
    let listener = null;
    const fakeDocRef = {
      id: 'SH9',
      get: async () => ({ exists: store.exists, data: () => store.data }),
      set: (obj, opt) => {
        createCount++;
        store.exists = true;
        store.data = opt && opt.merge ? Object.assign({}, store.data, obj) : obj;
        if (listener) listener({ exists: true, data: () => store.data });
        return Promise.resolve();
      },
      onSnapshot: (cb) => { listener = cb; cb({ exists: store.exists, data: () => store.data }); return () => { listener = null; }; },
    };
    const fakeShares = {
      doc: () => fakeDocRef,
      where: () => ({ limit: () => ({ get: async () => ({ empty: true, docs: [] }) }) }),
    };
    const realCollection = db.collection.bind(db);
    db.collection = (name) => name === 'shares' ? fakeShares : realCollection(name);
    Object.defineProperty(auth, 'currentUser', { get: () => ({ uid: 'U9', isAnonymous: false }), configurable: true });

    // Reset in-flight + shareId so both concurrent calls start from scratch.
    _shareId = null;
    _shareEnsureInFlight = null;

    const [id1, id2] = await Promise.all([shareEnsureDoc(), shareEnsureDoc()]);
    return { sameId: id1 === id2, createCount, id1, id2 };
  });
  ok(s9a.sameId, 'T9 shareEnsureDoc concurrent calls resolve to the same id');
  ok(s9a.createCount <= 1, 'T9 shareEnsureDoc concurrent calls invoke create at most once');

  // ── Task 9b: renderShareManager escapes HTML in songTitle ──
  const pg9b = await ctx.newPage();
  await pg9b.goto(`http://localhost:${port}/lite-1.070.html`, { waitUntil: 'domcontentloaded' });
  await pg9b.waitForFunction(() => typeof window.renderShareManager === 'function', { timeout: 10000 });
  const s9b = await pg9b.evaluate(() => {
    _shareId = 'SH9B';
    _shareActive = true;
    _shareTakes = [{ takeId: 'TKXSS', songTitle: '<script>alert(99)</script>' }];
    // Force the panel visible so renderShareManager renders.
    const panel = document.getElementById('sharePanel');
    if (panel) panel.style.display = 'flex';
    renderShareManager();
    const list = document.getElementById('smList');
    const noLiveScript = list && list.querySelector('script') === null;
    const textEscaped = list && list.textContent.includes('<script>');
    return { noLiveScript, textEscaped };
  });
  ok(s9b.noLiveScript, 'T9 renderShareManager: <script> title does not inject a live script element');
  ok(s9b.textEscaped, 'T9 renderShareManager: escaped title text is visible as literal <script>');

  // ── T10 (regression): shareViewBoot must not throw when #shareViewer isn't parsed yet ──
  // The real page defines #shareViewer AFTER the script that calls shareViewBoot(), so at
  // boot time getElementById('shareViewer') is null. Earlier code wrote .innerHTML directly
  // and threw → blank page. Boot must set body.share-view immediately and defer the DOM
  // write/load until the element exists.
  const pg10 = await ctx.newPage();
  await pg10.goto(`http://localhost:${port}/lite-1.070.html?share=ZZZ`, { waitUntil: 'domcontentloaded' });
  await pg10.waitForFunction(() => typeof window.shareViewBoot === 'function', { timeout: 10000 });
  const s10 = await pg10.evaluate(() => {
    // The public share page boots forced-dark (headless default is light, so this is
    // only true because shareViewBoot forced it).
    const darkOnBoot = document.documentElement.classList.contains('dark');
    // Simulate the boot-before-parse condition: remove the viewer element, reset state.
    const sv = document.getElementById('shareViewer'); if (sv) sv.remove();
    document.body.classList.remove('share-view'); _shareView = false;
    let threw = false;
    try { shareViewBoot(); } catch (e) { threw = true; }
    const classSet = document.body.classList.contains('share-view');
    // Now provide the element and stub the loader; boot should populate it + call shareViewLoad.
    const host = document.createElement('div'); host.id = 'shareViewer'; host.className = 'share-viewer';
    document.body.appendChild(host);
    let loadedId = null; shareViewLoad = (id) => { loadedId = id; };
    shareViewBoot();
    return { threw, classSet, loadedId, hostHtml: host.innerHTML, darkOnBoot };
  });
  ok(s10.darkOnBoot, 'T10 the public share page is forced dark on boot');
  ok(!s10.threw, 'T10 shareViewBoot does not throw when #shareViewer is not yet parsed');
  ok(s10.classSet, 'T10 shareViewBoot sets body.share-view even before the element exists');
  ok(s10.loadedId === 'ZZZ' && /Loading/.test(s10.hostHtml), 'T10 once #shareViewer exists, boot populates it + calls shareViewLoad');

  console.log(`\n${PASS} PASS / ${FAIL} FAIL`);
  await browser.close(); srv.close();
  process.exit(FAIL ? 1 : 0);
})();
