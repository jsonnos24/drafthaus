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
      let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/lite-1.071.html';
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

  // ── Task 1: tray state + link/membership helpers (no auth needed) ──
  const pgS = await ctx.newPage();
  await pgS.goto(`http://localhost:${port}/lite-1.071.html`, { waitUntil: 'domcontentloaded' });
  await pgS.waitForFunction(() => typeof window.shareTrayLink === 'function', { timeout: 10000 });
  const s1 = await pgS.evaluate(() => {
    const a = shareNewId(), b = shareNewId();
    const snap = _shareSnapshot(
      { id: 'T1', downloadUrl: 'https://x/y', duration: 12, mimeType: 'audio/mp3' },
      { id: 'S1', title: 'My Song', lyricsDoc: '<div>Hi</div>' });
    _shareTrays = [
      { id: 'TRA', name: 'Band demos', active: true, takes: [{ takeId: 'T1' }, { takeId: 'T2' }] },
      { id: 'TRB', name: '', active: true, takes: [{ takeId: 'T2' }] },
    ];
    return {
      idLen: a.length, idsDiffer: a !== b, urlSafe: /^[A-Za-z0-9_-]+$/.test(a),
      snapOK: snap.takeId === 'T1' && snap.songId === 'S1' && snap.songTitle === 'My Song'
              && snap.lyricsDoc === '<div>Hi</div>' && snap.downloadUrl === 'https://x/y'
              && snap.duration === 12 && typeof snap.addedAt === 'number',
      linkOK: /\?share=ABC123$/.test(shareTrayLink('ABC123')),
      legacyName: _trayName(_shareTrays[1]) === 'Shared takes',
      namedName: _trayName(_shareTrays[0]) === 'Band demos',
      forT1: shareTraysFor('T1').join(','),       // expect 'TRA'
      forT2: shareTraysFor('T2').sort().join(','), // expect 'TRA,TRB'
      sharedT1: shareIsShared('T1'), sharedNone: shareIsShared('T9'),
    };
  });
  ok(s1.idLen >= 20, 'T1 shareNewId is >=20 chars');
  ok(s1.idsDiffer, 'T1 shareNewId is random (two differ)');
  ok(s1.urlSafe, 'T1 shareNewId is URL-safe');
  ok(s1.snapOK, 'T1 _shareSnapshot builds a correct entry');
  ok(s1.linkOK, 'T1 shareTrayLink returns <origin><path>?share=<id>');
  ok(s1.legacyName && s1.namedName, 'T1 _trayName: blank→"Shared takes", else name');
  ok(s1.forT1 === 'TRA' && s1.forT2 === 'TRA,TRB', 'T1 shareTraysFor finds membership across trays');
  ok(s1.sharedT1 && !s1.sharedNone, 'T1 shareIsShared true in ≥1 tray, false otherwise');

  // ── Task 2: tray data layer with a stubbed shares query+docs ──
  const pg2 = await ctx.newPage();
  await pg2.goto(`http://localhost:${port}/lite-1.071.html`, { waitUntil: 'domcontentloaded' });
  await pg2.waitForFunction(() => typeof window.shareCreateTray === 'function', { timeout: 10000 });
  const s2 = await pg2.evaluate(async () => {
    // In-memory fake of the shares collection: many docs keyed by id.
    const docs = {};                 // id -> {data}
    let qListener = null;
    function emit() { if (qListener) qListener({ docs: Object.keys(docs).map(id => ({ id, data: () => docs[id] })) }); }
    const mkDocRef = (id) => ({
      id,
      set: (obj, opt) => { docs[id] = opt && opt.merge ? Object.assign({}, docs[id] || {}, obj) : obj; emit(); return Promise.resolve(); },
      delete: () => { delete docs[id]; emit(); return Promise.resolve(); },
    });
    const fakeShares = {
      doc: (id) => mkDocRef(id || ('GEN' + Object.keys(docs).length)),
      where: () => ({ onSnapshot: (cb) => { qListener = cb; emit(); return () => { qListener = null; }; } }),
    };
    const realCollection = db.collection.bind(db);
    db.collection = (name) => name === 'shares' ? fakeShares : realCollection(name);
    Object.defineProperty(auth, 'currentUser', { get: () => ({ uid: 'U1', isAnonymous: false }), configurable: true });
    _currentSong = { id: 'S1', title: 'Song One', lyricsDoc: '<div>La</div>' };
    window._fakeShareDocs = docs;

    shareLoadTrays();
    const idA = await shareCreateTray('Band demos');
    const idB = await shareCreateTray('');           // nameless on purpose
    const listedNames = _shareTrays.map(t => t.name).join('|'); // 'Band demos|' (trays already sorted by _trayName)
    const legacyDisplay = _trayName(_shareTrays.find(t => t.id === idB)) === 'Shared takes';

    const take = { id: 'TK1', downloadUrl: 'https://a/b', duration: 9, mimeType: 'audio/mp3' };
    shareAddTakeToTray(idA, take);
    shareAddTakeToTray(idB, take);                    // same take in two trays
    const inBoth = shareTraysFor('TK1').sort().join(',') === [idA, idB].sort().join(',');
    shareAddTakeToTray(idA, take);                    // dedupe
    const dedup = _shareTrays.find(t => t.id === idA).takes.length === 1;
    shareRemoveTakeFromTray(idA, 'TK1');              // remove from A only
    const removedAOnly = !shareTraysFor('TK1').includes(idA) && shareTraysFor('TK1').includes(idB);
    shareRenameTray(idB, 'Mix feedback');
    const renamed = docs[idB].name === 'Mix feedback';
    shareSetTrayActive(idA, false);
    const deactivated = docs[idA].active === false && _shareTrays.find(t => t.id === idA).active === false;
    shareDeleteTray(idA);
    const deleted = !docs[idA] && !_shareTrays.some(t => t.id === idA);
    const noUrlBlocked = (shareAddTakeToTray(idB, { id: 'TK2', duration: 3 }), !shareTraysFor('TK2').includes(idB));
    return { listedNames, legacyDisplay, inBoth, dedup, removedAOnly, renamed, deactivated, deleted, noUrlBlocked,
             createCount: Object.keys(docs).length, ownerOnDoc: docs[idB].ownerId === 'U1' };
  });
  ok(s2.listedNames === 'Band demos|', 'T2 shareLoadTrays lists multiple trays sorted');
  ok(s2.legacyDisplay, 'T2 nameless tray displays as "Shared takes"');
  ok(s2.ownerOnDoc, 'T2 created tray doc carries ownerId');
  ok(s2.inBoth, 'T2 a take can live in two trays at once');
  ok(s2.dedup, 'T2 shareAddTakeToTray dedupes by takeId within a tray');
  ok(s2.removedAOnly, 'T2 remove from one tray leaves the other untouched');
  ok(s2.renamed, 'T2 shareRenameTray writes name');
  ok(s2.deactivated, 'T2 shareSetTrayActive(false) flips active');
  ok(s2.deleted, 'T2 shareDeleteTray removes doc + local entry');
  ok(s2.noUrlBlocked, 'T2 add refuses a take with no downloadUrl');

  // ── Task 3: shareReorderTray rewrites takes[] order ──
  const pg3 = await ctx.newPage();
  await pg3.goto(`http://localhost:${port}/lite-1.071.html`, { waitUntil: 'domcontentloaded' });
  await pg3.waitForFunction(() => typeof window.shareReorderTray === 'function', { timeout: 10000 });
  const s3 = await pg3.evaluate(() => {
    let written = null;
    window._shareWriteTray = (id, fields) => { written = fields.takes.map(t => t.takeId).join(','); };
    _shareTrays = [{ id: 'TR', name: 'x', active: true, takes: [{ takeId: 'a' }, { takeId: 'b' }, { takeId: 'c' }] }];
    shareReorderTray('TR', 0, 2);  // a→end → b,c,a
    const order = _shareTrays[0].takes.map(t => t.takeId).join(',');
    const oob = (shareReorderTray('TR', 9, 0), _shareTrays[0].takes.map(t => t.takeId).join(','));
    return { order, written, oob };
  });
  ok(s3.order === 'b,c,a', 'T3 shareReorderTray moves take and rewrites local order');
  ok(s3.written === 'b,c,a', 'T3 shareReorderTray writes the new takes[] order');
  ok(s3.oob === 'b,c,a', 'T3 shareReorderTray is a no-op on out-of-range index');

  // ── Task 4: shareRefresh re-snapshots across all trays + drops missing ──
  const pg4 = await ctx.newPage();
  await pg4.goto(`http://localhost:${port}/lite-1.071.html`, { waitUntil: 'domcontentloaded' });
  await pg4.waitForFunction(() => typeof window.shareRefresh === 'function', { timeout: 10000 });
  const s4 = await pg4.evaluate(async () => {
    const writes = {};
    window._shareWriteTray = (id, fields) => { writes[id] = fields.takes.map(t => ({ id: t.takeId, title: t.songTitle, ly: t.lyricsDoc })); };
    _songs = [{ id: 'S1', title: 'New Title', lyricsDoc: '<div>NEW</div>' }];   // S2 missing
    _takes = [{ id: 'TK1', downloadUrl: 'https://a/b', duration: 9, mimeType: 'audio/mp3' }];
    _shareTrays = [
      { id: 'TRA', name: 'A', active: true, takes: [
        { takeId: 'TK1', songId: 'S1', songTitle: 'Old Title', lyricsDoc: '<div>OLD</div>', downloadUrl: 'https://a/b', duration: 9 },
        { takeId: 'TK9', songId: 'S2', songTitle: 'Gone', lyricsDoc: '', downloadUrl: 'x', duration: 1 },  // song gone → drop
      ]},
      { id: 'TRB', name: 'B', active: true, takes: [] },  // empty → untouched
    ];
    await shareRefresh();
    return { wroteA: !!writes['TRA'], wroteB: !!writes['TRB'], a: writes['TRA'] };
  });
  ok(s4.wroteA && !s4.wroteB, 'T4 shareRefresh writes only changed trays (skips empty/unchanged)');
  ok(s4.a && s4.a.length === 1 && s4.a[0].id === 'TK1', 'T4 shareRefresh drops a take whose song is gone');
  ok(s4.a && s4.a[0].title === 'New Title' && s4.a[0].ly === '<div>NEW</div>', 'T4 shareRefresh re-snapshots title + lyrics');

  // ── Task 4x (old): per-take share toggle button ──
  const pg4x = await ctx.newPage();
  await pg4x.goto(`http://localhost:${port}/lite-1.071.html`, { waitUntil: 'domcontentloaded' });
  await pg4x.waitForFunction(() => typeof window.takeShareToggle === 'function', { timeout: 10000 });
  const s4x = await pg4x.evaluate(() => {
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
  ok(s4x.present, 'T4 take row has a .take-share button');
  ok(s4x.added === 'TK1', 'T4 tapping share adds the take to the tray');

  // ── Task 5: share manager panel ──
  const pg5 = await ctx.newPage();
  await pg5.goto(`http://localhost:${port}/lite-1.071.html`, { waitUntil: 'domcontentloaded' });
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
  await pg6.goto(`http://localhost:${port}/lite-1.071.html?share=ZZZ`, { waitUntil: 'domcontentloaded' });
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
  await pg7.goto(`http://localhost:${port}/lite-1.071.html?share=ABC`, { waitUntil: 'domcontentloaded' });
  await pg7.waitForFunction(() => typeof window.svRenderLyrics === 'function', { timeout: 10000 });
  const s7 = await pg7.evaluate(() => {
    shareViewRender({ active: true, takes: [
      { takeId: 'TK1', songTitle: 'Alpha', lyricsDoc: '<div>Verse one</div>', downloadUrl: 'u1', duration: 10 },
      { takeId: 'TK2', songTitle: 'Beta',  lyricsDoc: '<div>Verse two</div>', downloadUrl: 'u2', duration: 20 },
    ]});
    const rows = document.querySelectorAll('#shareViewer .sv-col-list .sv-row');
    const r0 = rows[0];
    const twoCol = !!document.querySelector('#shareViewer .sv-2col .sv-col-list') && !!document.getElementById('svLyrics');
    const playLeftOfTitle = r0 && r0.querySelector('.sv-play') && r0.querySelector('.sv-play').compareDocumentPosition(r0.querySelector('.sv-title')) & Node.DOCUMENT_POSITION_FOLLOWING;
    const noLyrBtn = document.querySelector('#shareViewer .sv-lyrbtn') === null;
    // Nothing played yet → right column shows the hint.
    const lyr = document.getElementById('svLyrics');
    const hintInitially = /play a song to load its lyrics/i.test(lyr.textContent);
    // Simulate a song having played; lyrics follow _svLyricsIdx (persists past stop).
    _svLyricsIdx = 0; svRenderLyrics();
    const lyrLoaded = /Verse one/.test(lyr.textContent) && /Alpha/.test(lyr.querySelector('.sv-lyr-title').textContent);
    const noHintWhilePlaying = !/play a song to load/i.test(lyr.textContent);
    // Stop playback (_svIdx cleared) → lyrics MUST persist (not revert to hint).
    _svIdx = -1; svRenderLyrics();
    const lyricsPersistAfterStop = /Verse one/.test(lyr.textContent) && !/play a song to load/i.test(lyr.textContent);
    const hasPlaybackFns = typeof svPlay === 'function' && typeof svStop === 'function';
    // XSS escape check: inject a title with HTML special chars
    shareViewRender({ active: true, takes: [
      { takeId: 'TK3', songTitle: '<script>alert(1)</script>', lyricsDoc: '', downloadUrl: 'u3', duration: 5 },
    ]});
    const xssRow = document.querySelector('#shareViewer .sv-row');
    const xssTitle = xssRow && xssRow.querySelector('.sv-title');
    const noLiveScript = xssTitle && xssTitle.querySelector('script') === null;
    const escapedText = xssTitle && xssTitle.textContent.includes('<script>');
    return { count: rows.length, twoCol, playLeftOfTitle: !!playLeftOfTitle, noLyrBtn, hintInitially, lyrLoaded, noHintWhilePlaying, lyricsPersistAfterStop, hasPlaybackFns, noLiveScript, escapedText };
  });
  ok(s7.count === 2, 'T7 renders one row per take');
  ok(s7.twoCol, 'T7 two-column layout: song list + lyrics column');
  ok(s7.playLeftOfTitle, 'T7 play button precedes the song title');
  ok(s7.noLyrBtn, 'T7 no per-row Lyrics button (lyrics follow playback)');
  ok(s7.hintInitially, 'T7 right column shows the hint before anything is played');
  ok(s7.lyrLoaded && s7.noHintWhilePlaying, 'T7 right column loads the playing song lyrics + title');
  ok(s7.lyricsPersistAfterStop, 'T7 lyrics stay visible after playback stops (no revert to hint)');
  ok(s7.hasPlaybackFns, 'T7 svPlay + svStop exist');
  ok(s7.noLiveScript && s7.escapedText, 'T7 song title with HTML chars is escaped, no live <script> injected');

  // ── Task 8: viewer reads ONLY the shares collection ──
  const pg8 = await ctx.newPage();
  await pg8.goto(`http://localhost:${port}/lite-1.071.html?share=ABC`, { waitUntil: 'domcontentloaded' });
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
  await pg8b.goto(`http://localhost:${port}/lite-1.071.html`, { waitUntil: 'domcontentloaded' });
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
  await pg9a.goto(`http://localhost:${port}/lite-1.071.html`, { waitUntil: 'domcontentloaded' });
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
  await pg9b.goto(`http://localhost:${port}/lite-1.071.html`, { waitUntil: 'domcontentloaded' });
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
  await pg10.goto(`http://localhost:${port}/lite-1.071.html?share=ZZZ`, { waitUntil: 'domcontentloaded' });
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
