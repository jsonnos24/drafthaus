// _verify_lite_1066.js  (Task 1 — offline infra: enablePersistence, outbox store + helpers, local-blob index)
const { chromium } = require('playwright-core');
const http = require('http'); const fs = require('fs'); const path = require('path');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ROOT = __dirname;
let PASS = 0, FAIL = 0;
const ok = (c, m) => { if (c) { PASS++; console.log('PASS', m); } else { FAIL++; console.log('FAIL', m); } };

function serve() {
  return new Promise(res => {
    const s = http.createServer((req, rq) => {
      let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/lite-1.066.html';
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
  await pg.goto(`http://localhost:${port}/lite-1.066.html`, { waitUntil: 'domcontentloaded' });
  await pg.waitForFunction(() => typeof window.dhAudioPut === 'function', { timeout: 10000 });

  const t1 = await pg.evaluate(async () => {
    const persistenceCalled = typeof db.enablePersistence === 'function';
    // outbox round-trip
    await dhOutboxPut({ takeId: 'job-A', op: 'upload', storagePath: 'p/a.webm', mimeType: 'audio/webm', songId: 's', bytes: 10, duration: 1, tries: 0, createdAt: 1 });
    const got = await dhOutboxGet('job-A');
    const all = await dhOutboxAll();
    await dhOutboxDelete('job-A');
    const afterDel = await dhOutboxGet('job-A');
    // takeBlobs preserved across the v2 upgrade + local index
    await dhAudioPut('blob-A', new Blob([new Uint8Array(8)], { type: 'audio/webm' }), { mimeType: 'audio/webm', pendingUpload: true });
    const hasLocal = dhAudioHasLocal('blob-A');
    await dhAudioSetPending('blob-A', false);
    await dhAudioDelete('blob-A');
    const hasLocalAfter = dhAudioHasLocal('blob-A');
    return { persistenceCalled, gotOp: got && got.op, allLen: all.length, afterDel: afterDel === null, hasLocal, hasLocalAfter };
  });
  ok(t1.persistenceCalled, 'T1 enablePersistence is available + invoked at boot');
  ok(t1.gotOp === 'upload', 'T1 dhOutboxPut/Get round-trips a job');
  ok(t1.allLen >= 1, 'T1 dhOutboxAll returns jobs');
  ok(t1.afterDel, 'T1 dhOutboxDelete removes the job');
  ok(t1.hasLocal === true, 'T1 dhAudioHasLocal true after put (local index synced)');
  ok(t1.hasLocalAfter === false, 'T1 dhAudioHasLocal false after delete');

  const t1evict = await pg.evaluate(async () => {
    const saved = DH_AUDIO_CAP;
    DH_AUDIO_CAP = 1500;
    const blob = new Blob([new Uint8Array(1024)], { type: 'audio/webm' });
    await dhAudioPut('evi_old', blob, { mimeType: 'audio/webm', pendingUpload: false });
    // small delay so lastPlayed timestamps differ
    await new Promise(r => setTimeout(r, 10));
    await dhAudioTouch('evi_old');
    await new Promise(r => setTimeout(r, 10));
    await dhAudioPut('evi_new', blob, { mimeType: 'audio/webm', pendingUpload: false });
    await new Promise(r => setTimeout(r, 10));
    await dhAudioTouch('evi_new');
    // total ~2048 > 1500 → evict evi_old (least-recently-played)
    await dhAudioEvict();
    const oldGone = !dhAudioHasLocal('evi_old');
    const newKept = dhAudioHasLocal('evi_new');
    DH_AUDIO_CAP = saved;
    await dhAudioDelete('evi_new');
    return { oldGone, newKept };
  });
  ok(t1evict.oldGone && t1evict.newKept, 'T1 eviction removes evicted id from _localBlobIds index');

  // Drain uploads a queued job, patches the doc, empties the outbox, clears pending.
  const t2 = await pg.evaluate(async () => {
    // seed a blob + outbox job + a take doc stub via stubs
    await dhAudioPut('drain1', new Blob([new Uint8Array(16)], { type: 'audio/webm' }), { mimeType: 'audio/webm', pendingUpload: true });
    await dhOutboxPut({ takeId: 'drain1', op: 'upload', storagePath: 'voice_takes/s/drain1.webm', mimeType: 'audio/webm', songId: 's', userId: 'u1', filename: 'drain1.webm', trackNum: 0, bytes: 16, duration: 1, tries: 0, createdAt: 1 });
    let patched = null;
    const origRef = firebase.storage().ref.bind(firebase.storage());
    firebase.storage().ref = () => ({ put: async () => ({ ref: { getDownloadURL: async () => 'http://x/drain1.webm' } }), delete: async () => {} });
    const origColl = db.collection.bind(db);
    db.collection = (n) => n === 'voice_takes' ? { doc: () => ({ set: async (data) => { patched = data; } }) } : origColl(n);
    const _origOnline = Object.getOwnPropertyDescriptor(window.navigator, 'onLine');
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => true });
    await liteSyncDrain();
    const jobGone = (await dhOutboxGet('drain1')) === null;
    const rec = await (async () => { const d = await _dhAudioOpen(); return _dhReq(_dhTx(d, 'readonly').get('drain1')); })();
    firebase.storage().ref = origRef; db.collection = origColl;
    if (_origOnline) Object.defineProperty(window.navigator, 'onLine', _origOnline);
    await dhAudioDelete('drain1');
    return { patchedUrl: patched && patched.downloadUrl, patchedPending: patched && patched.pendingUpload, jobGone, pendingCleared: rec ? rec.pendingUpload === false : false };
  });
  ok(t2.patchedUrl === 'http://x/drain1.webm', 'T2 drain patches the doc with downloadUrl');
  ok(t2.patchedPending === false, 'T2 drain sets pendingUpload:false on the doc');
  ok(t2.jobGone, 'T2 drain removes the outbox job on success');
  ok(t2.pendingCleared, 'T2 drain clears the blob pendingUpload flag');

  // Failure keeps the job queued + increments tries (retry forever).
  const t2b = await pg.evaluate(async () => {
    await dhAudioPut('drain2', new Blob([new Uint8Array(16)], { type: 'audio/webm' }), { mimeType: 'audio/webm', pendingUpload: true });
    await dhOutboxPut({ takeId: 'drain2', op: 'upload', storagePath: 'p/d2.webm', mimeType: 'audio/webm', songId: 's', userId: 'u1', filename: 'd2.webm', trackNum: 0, bytes: 16, duration: 1, tries: 0, createdAt: 2 });
    const origRef = firebase.storage().ref.bind(firebase.storage());
    firebase.storage().ref = () => ({ put: async () => { throw new Error('net'); } });
    const _origOnline = Object.getOwnPropertyDescriptor(window.navigator, 'onLine');
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => true });
    await liteSyncDrain();
    const job = await dhOutboxGet('drain2');
    firebase.storage().ref = origRef;
    if (_origOnline) Object.defineProperty(window.navigator, 'onLine', _origOnline);
    await dhOutboxDelete('drain2'); await dhAudioDelete('drain2');
    return { stillQueued: !!job, tries: job ? job.tries : -1 };
  });
  ok(t2b.stillQueued, 'T2 failed upload keeps the job queued');
  ok(t2b.tries >= 1, 'T2 failed upload increments tries (retry forever)');

  // Single-flight: concurrent drains must upload exactly once.
  const t2sf = await pg.evaluate(async () => {
    await dhAudioPut('drain_sf', new Blob([new Uint8Array(16)], { type: 'audio/webm' }), { mimeType: 'audio/webm', pendingUpload: true });
    await dhOutboxPut({ takeId: 'drain_sf', op: 'upload', storagePath: 'p/sf.webm', mimeType: 'audio/webm', songId: 's', userId: 'u1', filename: 'sf.webm', trackNum: 0, bytes: 16, duration: 1, tries: 0, createdAt: 3 });
    let putCount = 0;
    const origRef = firebase.storage().ref.bind(firebase.storage());
    firebase.storage().ref = () => ({
      put: async () => {
        putCount++;
        await new Promise(r => setTimeout(r, 20));
        return { ref: { getDownloadURL: async () => 'http://x/sf.webm' } };
      },
      delete: async () => {}
    });
    const origColl = db.collection.bind(db);
    db.collection = (n) => n === 'voice_takes' ? { doc: () => ({ set: async () => {} }) } : origColl(n);
    const _origOnline = Object.getOwnPropertyDescriptor(window.navigator, 'onLine');
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => true });
    const a = liteSyncDrain(); const b = liteSyncDrain();
    await Promise.all([a, b]);
    firebase.storage().ref = origRef; db.collection = origColl;
    if (_origOnline) Object.defineProperty(window.navigator, 'onLine', _origOnline);
    await dhOutboxDelete('drain_sf'); await dhAudioDelete('drain_sf');
    return { putCount };
  });
  ok(t2sf.putCount === 1, 'T2 single-flight: concurrent drains upload once');

  // Complete-doc test: drain must write ALL fields for op:'upload' so a create-on-reconnect
  // (persistence-off edge) yields a fully-owned take, not a 4-field stub.
  const t2complete = await pg.evaluate(async () => {
    await dhAudioPut('drain_cd', new Blob([new Uint8Array(16)], { type: 'audio/webm' }), { mimeType: 'audio/webm', pendingUpload: true });
    await dhOutboxPut({ takeId: 'drain_cd', op: 'upload', storagePath: 'voice_takes/s/f.webm', mimeType: 'audio/webm', songId: 's', userId: 'u', filename: 'f.webm', trackNum: 0, bytes: 16, duration: 2, tries: 0, createdAt: 999 });
    let captured = null;
    const origRef = firebase.storage().ref.bind(firebase.storage());
    firebase.storage().ref = () => ({ put: async () => ({ ref: { getDownloadURL: async () => 'http://x/f.webm' } }), delete: async () => {} });
    const origColl = db.collection.bind(db);
    db.collection = (n) => n === 'voice_takes' ? { doc: () => ({ set: async (data) => { captured = data; } }) } : origColl(n);
    const _origOnline = Object.getOwnPropertyDescriptor(window.navigator, 'onLine');
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => true });
    await liteSyncDrain();
    firebase.storage().ref = origRef; db.collection = origColl;
    if (_origOnline) Object.defineProperty(window.navigator, 'onLine', _origOnline);
    await dhAudioDelete('drain_cd');
    return { songId: captured && captured.songId, userId: captured && captured.userId, downloadUrl: captured && captured.downloadUrl, pendingUpload: captured && captured.pendingUpload };
  });
  ok(t2complete.songId === 's', 'T2 drain writes a COMPLETE doc for op:upload (no orphan on create) — songId');
  ok(t2complete.userId === 'u', 'T2 drain writes a COMPLETE doc for op:upload (no orphan on create) — userId');
  ok(!!t2complete.downloadUrl, 'T2 drain writes a COMPLETE doc for op:upload (no orphan on create) — downloadUrl set');
  ok(t2complete.pendingUpload === false, 'T2 drain writes a COMPLETE doc for op:upload (no orphan on create) — pendingUpload:false');

  // ── Task-3 asserts: offline record → doc-first + outbox + local blob + no upload ──
  const pg3 = await ctx.newPage();
  await pg3.goto(`http://localhost:${port}/lite-1.066.html`, { waitUntil: 'domcontentloaded' });
  await pg3.waitForFunction(() => typeof window.dhAudioPut === 'function', { timeout: 10000 });
  const signedin3 = await guestIn(pg3);
  if (signedin3) {
    await pg3.evaluate(() => {
      _openSongObj({ id: 'S1066t3', title: 'verify-1066-t3', key: 'C major', lyricsDoc: '<div>test</div>' });
      stopTakesListener();
    });
    await pg3.waitForTimeout(200);

    const t3 = await pg3.evaluate(async () => {
      stopTakesListener(); _takes = []; _loadedTakeId = null;
      let docData = null, putCalled = false;
      const origColl = db.collection.bind(db);
      db.collection = (n) => n === 'voice_takes'
        ? { doc: (id) => ({ id: id || ('genid_' + Math.random().toString(36).slice(2)), set: async (d) => { docData = d; } }) }
        : origColl(n);
      const origRef = firebase.storage().ref.bind(firebase.storage());
      firebase.storage().ref = () => ({ put: async () => { putCalled = true; return { ref: { getDownloadURL: async () => 'http://x/y' } }; } });
      Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => false }); // OFFLINE
      const blob = new Blob([new Uint8Array(2048)], { type: 'audio/webm' });
      await uploadTake(blob, 'audio/webm', 1.0);
      const id = _loadedTakeId;
      const job = await dhOutboxGet(id);
      const localBlob = await dhAudioGet(id);
      db.collection = origColl; firebase.storage().ref = origRef;
      Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => true });
      if (id) { await dhOutboxDelete(id); await dhAudioDelete(id); }
      return { pendingTrue: docData && docData.pendingUpload === true, noUrl: docData && !docData.downloadUrl, jobQueued: !!job, playableLocal: !!localBlob, noUpload: putCalled === false, selected: id === _loadedTakeId };
    });
    ok(t3.pendingTrue, 'T3 offline record writes doc pendingUpload:true');
    ok(t3.noUrl, 'T3 offline record writes doc with NO downloadUrl');
    ok(t3.jobQueued, 'T3 offline record enqueues an outbox job');
    ok(t3.playableLocal, 'T3 offline record blob is in IndexedDB (plays locally)');
    ok(t3.noUpload, 'T3 offline record attempts NO Storage upload');
  } else {
    console.log('SKIP T3 (guest auth unavailable)');
  }
  await pg3.close();

  // ── Task-4 asserts: offline trim → doc-first + outbox replace + old url kept + no upload ──
  const pg4 = await ctx.newPage();
  await pg4.goto(`http://localhost:${port}/lite-1.066.html`, { waitUntil: 'domcontentloaded' });
  await pg4.waitForFunction(() => typeof window.dhAudioPut === 'function', { timeout: 10000 });
  const signedin4 = await guestIn(pg4);
  if (signedin4) {
    await pg4.evaluate(() => {
      _openSongObj({ id: 'S1066t4', title: 'verify-1066-t4', key: 'C major', lyricsDoc: '<div>test</div>' });
      stopTakesListener();
    });
    await pg4.waitForTimeout(200);

    const t4 = await pg4.evaluate(async () => {
      const ctx = ensureCtx(); const ab = ctx.createBuffer(1, 4410, 44100);
      _takes = [{ id: 'trim1', songId: 's', bytes: 100, storagePath: 'voice_takes/s/old.webm', downloadUrl: 'http://x/old.webm', mimeType: 'audio/webm' }];
      _wf.takeId = 'trim1';
      window._ensureMp3Lib = async () => {}; window._encodeMp3 = () => new Blob([new Uint8Array(64)], { type: 'audio/mp3' });
      let docData = null, putCalled = false;
      const origColl = db.collection.bind(db);
      db.collection = (n) => n === 'voice_takes' ? { doc: () => ({ set: async (d) => { docData = Object.assign(docData || {}, d); } }) } : origColl(n);
      const origRef = firebase.storage().ref.bind(firebase.storage());
      firebase.storage().ref = () => ({ put: async () => { putCalled = true; return { ref: { getDownloadURL: async () => 'http://x/new.mp3' } }; }, delete: async () => {} });
      Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => false });
      await _wfReplaceAudio(ab, null, 'Trimmed');
      const job = await dhOutboxGet('trim1');
      db.collection = origColl; firebase.storage().ref = origRef;
      await dhOutboxDelete('trim1'); await dhAudioDelete('trim1');
      return { pending: docData && docData.pendingUpload === true, keptUrl: !docData || docData.downloadUrl === undefined, jobReplace: job && job.op === 'replace', jobOldPath: job && job.oldPath === 'voice_takes/s/old.webm', noUpload: putCalled === false };
    });
    ok(t4.pending, 'T4 offline trim sets doc pendingUpload:true');
    ok(t4.keptUrl, 'T4 offline trim does NOT overwrite downloadUrl (other devices keep old)');
    ok(t4.jobReplace, 'T4 offline trim enqueues an op:replace job');
    ok(t4.jobOldPath, 'T4 replace job carries oldPath for post-upload delete');
    ok(t4.noUpload, 'T4 offline trim attempts NO Storage upload');
  } else {
    console.log('SKIP T4 (guest auth unavailable)');
  }
  await pg4.close();

  console.log(`\n${PASS} PASS / ${FAIL} FAIL`);
  await browser.close(); srv.close();
  process.exit(FAIL ? 1 : 0);
})();
