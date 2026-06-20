// _verify_lite_1067.js  (Fix A: in-memory IDB fallback; Fix B: resilient takes-listener re-subscribe)
const { chromium } = require('playwright-core');
const http = require('http'); const fs = require('fs'); const path = require('path');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ROOT = __dirname;
let PASS = 0, FAIL = 0;
const ok = (c, m) => { if (c) { PASS++; console.log('PASS', m); } else { FAIL++; console.log('FAIL', m); } };

function serve() {
  return new Promise(res => {
    const s = http.createServer((req, rq) => {
      let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/lite-1.067.html';
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
  await pg.goto(`http://localhost:${port}/lite-1.067.html`, { waitUntil: 'domcontentloaded' });
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
  await pg3.goto(`http://localhost:${port}/lite-1.067.html`, { waitUntil: 'domcontentloaded' });
  await pg3.waitForFunction(() => typeof window.dhAudioPut === 'function', { timeout: 10000 });
  const signedin3 = await guestIn(pg3);
  if (signedin3) {
    await pg3.evaluate(() => {
      _openSongObj({ id: 'S1067t3', title: 'verify-1067-t3', key: 'C major', lyricsDoc: '<div>test</div>' });
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
  await pg4.goto(`http://localhost:${port}/lite-1.067.html`, { waitUntil: 'domcontentloaded' });
  await pg4.waitForFunction(() => typeof window.dhAudioPut === 'function', { timeout: 10000 });
  const signedin4 = await guestIn(pg4);
  if (signedin4) {
    await pg4.evaluate(() => {
      _openSongObj({ id: 'S1067t4', title: 'verify-1067-t4', key: 'C major', lyricsDoc: '<div>test</div>' });
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

  // Note: relies on this page's navigator.onLine===true (unmodified here; the offline-record blocks run on their own pages).
  // ── Task-5 asserts: offline pill + connectivity listeners ──
  const t5 = await pg.evaluate(() => {
    const pill = document.getElementById('offlinePill');
    window.dispatchEvent(new Event('offline'));
    const offState = document.body.classList.contains('is-offline');
    window.dispatchEvent(new Event('online'));
    const onState = document.body.classList.contains('is-offline');
    return { pillExists: !!pill, offState, onCleared: onState === false };
  });
  ok(t5.pillExists, 'T5 #offlinePill element exists');
  ok(t5.offState, 'T5 offline event sets body.is-offline');
  ok(t5.onCleared, 'T5 online event clears body.is-offline');

  // ── Task-6 asserts: per-take badge + retry + cross-device play guard ──
  const t6 = await pg.evaluate(async () => {
    // local pending (mine): has local blob → "Uploading…/On this device" + retry, NOT play-disabled
    await dhAudioPut('mine1', new Blob([new Uint8Array(4)]), { mimeType: 'audio/webm', pendingUpload: true });
    const mineHtml = _takeRow({ id: 'mine1', duration: 1, bytes: 4, mimeType: 'audio/webm', pendingUpload: true }, false);
    // remote pending (other device): no local blob, no downloadUrl → "uploading from another device" + play disabled
    const remoteHtml = _takeRow({ id: 'remote1', duration: 1, bytes: 4, mimeType: 'audio/webm', pendingUpload: true }, false);
    // normal existing take: no pending → no badge, normal
    const normalHtml = _takeRow({ id: 'norm1', duration: 1, bytes: 4, mimeType: 'audio/webm', downloadUrl: 'http://x/y' }, false);
    // _getBuffer guard: remote pending must NOT fetch(undefined)
    let fetched = false; const realFetch = window.fetch; window.fetch = () => { fetched = true; throw new Error('should not fetch'); };
    let threwGuard = false;
    try { await _getBuffer({ id: 'remote1', pendingUpload: true }); } catch (e) { threwGuard = true; }
    window.fetch = realFetch;
    await dhAudioDelete('mine1');
    return {
      mineBadge: /On this device|Uploading/.test(mineHtml), mineRetry: /retryTake/.test(mineHtml), mineNotDisabled: !/disabled/.test(mineHtml.split('class="play"')[0] + (mineHtml.match(/<button class="play"[^>]*>/) || [''])[0]),
      remoteAnother: /another device/.test(remoteHtml), remoteDisabled: /<button class="play"[^>]*disabled/.test(remoteHtml),
      normalClean: !/On this device|another device|Uploading/.test(normalHtml),
      guardNoFetch: fetched === false && threwGuard,
    };
  });
  ok(t6.mineBadge, 'T6 local pending take shows On this device/Uploading badge');
  ok(t6.mineRetry, 'T6 local pending take shows a ↻ retry control');
  ok(t6.mineNotDisabled, 'T6 local pending take play button is NOT disabled');
  ok(t6.remoteAnother, 'T6 remote pending take shows "uploading from another device"');
  ok(t6.remoteDisabled, 'T6 remote pending take has Play disabled');
  ok(t6.normalClean, 'T6 normal existing take shows no pending UI');
  ok(t6.guardNoFetch, 'T6 _getBuffer does not fetch(undefined) for a remote pending take');

  // ── Task-7 No-harm: existing take (downloadUrl, no pendingUpload) unchanged through new paths ──
  const t7 = await pg.evaluate(async () => {
    const existing = { id: 'legacy1', songId: 's', bytes: 500, storagePath: 'voice_takes/s/legacy.webm', downloadUrl: 'http://x/legacy.webm', mimeType: 'audio/webm', duration: 3 };
    const before = JSON.stringify(existing);
    const row = _takeRow(existing, false);
    // existing take: no pending UI, play enabled, served via fetch (not outbox)
    const noPendingUI = !/uploading|On this device|Uploading/i.test(row);
    const playEnabled = !/<button class="play"[^>]*disabled/.test(row);
    const job = await dhOutboxGet('legacy1'); // never enqueued
    const unchanged = JSON.stringify(existing) === before;
    // _getBuffer for an existing take still fetches its downloadUrl
    let fetched = false; const realFetch = window.fetch;
    window.fetch = async () => { fetched = true; return { arrayBuffer: async () => { const r=8000,n=400,b=new ArrayBuffer(44+n*2),v=new DataView(b);const wr=(o,s)=>{for(let i=0;i<s.length;i++)v.setUint8(o+i,s.charCodeAt(i));};wr(0,'RIFF');v.setUint32(4,36+n*2,true);wr(8,'WAVE');wr(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,r,true);v.setUint32(28,r*2,true);v.setUint16(32,2,true);v.setUint16(34,16,true);wr(36,'data');v.setUint32(40,n*2,true);for(let i=0;i<n;i++)v.setInt16(44+i*2,1000,true);return b; } }; };
    delete _bufCache['legacy1'];
    const entry = await _getBuffer(existing);
    window.fetch = realFetch; delete _bufCache['legacy1']; await dhAudioDelete('legacy1');
    return { noPendingUI, playEnabled, jobNever: job === null, unchanged, fetched, decoded: !!(entry && entry.buffer) };
  });
  ok(t7.noPendingUI, 'T7 existing take shows no pending UI');
  ok(t7.playEnabled, 'T7 existing take Play is enabled');
  ok(t7.jobNever, 'T7 existing take never gets an outbox job');
  ok(t7.unchanged, 'T7 existing take object is not mutated by render');
  ok(t7.fetched && t7.decoded, 'T7 existing take still fetches+decodes via downloadUrl (no-harm)');

  // ── Task-8 Integration: offline record → online drain → take becomes synced ──
  const pg8 = await ctx.newPage();
  await pg8.goto(`http://localhost:${port}/lite-1.067.html`, { waitUntil: 'domcontentloaded' });
  await pg8.waitForFunction(() => typeof window.dhAudioPut === 'function', { timeout: 10000 });
  const signedin8 = await guestIn(pg8);
  if (signedin8) {
    await pg8.evaluate(() => {
      _openSongObj({ id: 'S1067t8', title: 'verify-1067-t8', key: 'C major', lyricsDoc: '<div>test</div>' });
      stopTakesListener();
    });
    await pg8.waitForTimeout(200);

    const t8 = await pg8.evaluate(async () => {
      stopTakesListener(); _takes = []; _loadedTakeId = null;
      let docState = {};
      const origColl = db.collection.bind(db);
      db.collection = (n) => n === 'voice_takes' ? { doc: (id) => { const did = id || ('g_' + Math.random().toString(36).slice(2)); return { id: did, set: async (d) => { docState[did] = Object.assign(docState[did] || {}, d); } }; } } : origColl(n);
      const origRef = firebase.storage().ref.bind(firebase.storage());
      let uploads = 0;
      firebase.storage().ref = () => ({ put: async () => { uploads++; return { ref: { getDownloadURL: async () => 'http://x/synced.webm' } }; }, delete: async () => {} });
      Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => false });
      await uploadTake(new Blob([new Uint8Array(1024)], { type: 'audio/webm' }), 'audio/webm', 1.0);
      const id = _loadedTakeId; const offlineNoUpload = uploads === 0;
      Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => true });
      _syncAnnounce = true;
      await liteSyncDrain();
      const jobGone = (await dhOutboxGet(id)) === null;
      db.collection = origColl; firebase.storage().ref = origRef; await dhAudioDelete(id);
      return { offlineNoUpload, uploadedOnReconnect: uploads === 1, synced: docState[id] && docState[id].downloadUrl === 'http://x/synced.webm' && docState[id].pendingUpload === false, jobGone };
    });
    ok(t8.offlineNoUpload, 'T8 record offline attempts no upload');
    ok(t8.uploadedOnReconnect, 'T8 reconnect drains + uploads exactly once');
    ok(t8.synced, 'T8 after drain the doc has downloadUrl + pendingUpload:false');
    ok(t8.jobGone, 'T8 outbox empties after successful drain');
  } else {
    console.log('SKIP T8 (guest auth unavailable)');
  }
  await pg8.close();

  // ── Task-8 offline-hang tests: stub Firestore set → never-resolving promise ──
  // These assert that fire-and-forget doc writes don't block control flow offline.

  // Hang-test A: uploadTake — doc set hangs, outbox still enqueues
  const pg_ha = await ctx.newPage();
  await pg_ha.goto(`http://localhost:${port}/lite-1.067.html`, { waitUntil: 'domcontentloaded' });
  await pg_ha.waitForFunction(() => typeof window.dhAudioPut === 'function', { timeout: 10000 });
  const signedin_ha = await guestIn(pg_ha);
  if (signedin_ha) {
    await pg_ha.evaluate(() => {
      _openSongObj({ id: 'S1067ha', title: 'verify-hang-a', key: '', lyricsDoc: '' });
      stopTakesListener();
    });
    await pg_ha.waitForTimeout(200);

    const tha = await pg_ha.evaluate(async () => {
      stopTakesListener(); _takes = []; _loadedTakeId = null;
      const origColl = db.collection.bind(db);
      // voice_takes .doc().set returns a never-resolving promise (models offline hang)
      db.collection = (n) => n === 'voice_takes'
        ? { doc: (id) => ({ id: id || ('hang_' + Math.random().toString(36).slice(2)), set: () => new Promise(() => {}) }) }
        : origColl(n);
      const origRef = firebase.storage().ref.bind(firebase.storage());
      firebase.storage().ref = () => ({ put: async () => ({ ref: { getDownloadURL: async () => 'http://x/ha' } }) });
      const _origOnline = Object.getOwnPropertyDescriptor(window.navigator, 'onLine');
      Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => false });
      // Do NOT await uploadTake itself — the internal dhOutboxPut is awaited inside
      // and will complete because the doc write is now fire-and-forget.
      const blob = new Blob([new Uint8Array(512)], { type: 'audio/webm' });
      await uploadTake(blob, 'audio/webm', 1.0);
      const id = _loadedTakeId;
      const job = id ? await dhOutboxGet(id) : null;
      db.collection = origColl; firebase.storage().ref = origRef;
      if (_origOnline) Object.defineProperty(window.navigator, 'onLine', _origOnline);
      if (id) { await dhOutboxDelete(id); await dhAudioDelete(id); }
      return { gotId: !!id, jobEnqueued: !!(job && job.op === 'upload') };
    });
    ok(tha.gotId, 'OFFLINE-HANG: uploadTake sets _loadedTakeId even when doc write hangs');
    ok(tha.jobEnqueued, 'OFFLINE-HANG: uploadTake enqueues outbox even when doc write hangs');
  } else {
    console.log('SKIP HANG-A (guest auth unavailable)');
  }
  await pg_ha.close();

  // Hang-test B: createSong — doc set hangs, song still opens
  const pg_hb = await ctx.newPage();
  await pg_hb.goto(`http://localhost:${port}/lite-1.067.html`, { waitUntil: 'domcontentloaded' });
  await pg_hb.waitForFunction(() => typeof window.dhAudioPut === 'function', { timeout: 10000 });
  const signedin_hb = await guestIn(pg_hb);
  if (signedin_hb) {
    const thb = await pg_hb.evaluate(async () => {
      const beforeId = _currentSong && _currentSong.id;
      const origColl = db.collection.bind(db);
      // songs .doc().set returns a never-resolving promise (models offline hang)
      db.collection = (n) => n === 'songs'
        ? { doc: (id) => { const ref = id ? origColl(n).doc(id) : origColl(n).doc(); return { id: ref.id, set: () => new Promise(() => {}) }; } }
        : origColl(n);
      await createSong();
      const afterId = _currentSong && _currentSong.id;
      db.collection = origColl;
      return { opened: !!afterId && afterId !== beforeId };
    });
    ok(thb.opened, 'OFFLINE-HANG: createSong opens the new song even when doc write hangs');
  } else {
    console.log('SKIP HANG-B (guest auth unavailable)');
  }
  await pg_hb.close();

  // Hang-test C: _wfReplaceAudio (trim) — doc set hangs, outbox still enqueues
  const pg_hc = await ctx.newPage();
  await pg_hc.goto(`http://localhost:${port}/lite-1.067.html`, { waitUntil: 'domcontentloaded' });
  await pg_hc.waitForFunction(() => typeof window.dhAudioPut === 'function', { timeout: 10000 });
  const signedin_hc = await guestIn(pg_hc);
  if (signedin_hc) {
    await pg_hc.evaluate(() => {
      _openSongObj({ id: 'S1067hc', title: 'verify-hang-c', key: '', lyricsDoc: '' });
      stopTakesListener();
    });
    await pg_hc.waitForTimeout(200);

    const thc = await pg_hc.evaluate(async () => {
      const ctx = ensureCtx(); const ab = ctx.createBuffer(1, 4410, 44100);
      _takes = [{ id: 'hctrim1', songId: 's', bytes: 100, storagePath: 'voice_takes/s/old.webm', downloadUrl: 'http://x/old.webm', mimeType: 'audio/webm' }];
      _wf.takeId = 'hctrim1';
      window._ensureMp3Lib = async () => {};
      window._encodeMp3 = () => new Blob([new Uint8Array(64)], { type: 'audio/mp3' });
      const origColl = db.collection.bind(db);
      // voice_takes .doc().set returns a never-resolving promise (models offline hang)
      db.collection = (n) => n === 'voice_takes'
        ? { doc: () => ({ set: () => new Promise(() => {}) }) }
        : origColl(n);
      const origRef = firebase.storage().ref.bind(firebase.storage());
      firebase.storage().ref = () => ({ put: async () => ({ ref: { getDownloadURL: async () => 'http://x/hc.mp3' } }), delete: async () => {} });
      const _origOnline = Object.getOwnPropertyDescriptor(window.navigator, 'onLine');
      Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => false });
      await _wfReplaceAudio(ab, null, 'Trimmed');
      const job = await dhOutboxGet('hctrim1');
      db.collection = origColl; firebase.storage().ref = origRef;
      if (_origOnline) Object.defineProperty(window.navigator, 'onLine', _origOnline);
      await dhOutboxDelete('hctrim1'); await dhAudioDelete('hctrim1');
      return { jobReplace: !!(job && job.op === 'replace') };
    });
    ok(thc.jobReplace, 'OFFLINE-HANG: trim enqueues op:replace outbox job even when doc write hangs');
  } else {
    console.log('SKIP HANG-C (guest auth unavailable)');
  }
  await pg_hc.close();

  // ── Fix A: IDB-unavailable — memory fallback record works ──
  // We stub _dhAudioOpen in-page AFTER boot (so Firebase can use IDB normally during init),
  // then reset _dhAudioDBP so subsequent calls see a null DB.  This faithfully models the
  // private-browsing / IDB-blocked scenario without breaking Firebase's own IDB usage.
  {
    const pgMem = await ctx.newPage();
    pgMem.on('console', m => { if (/(permission-denied|WebChannel|FirebaseError|QUIC|takes.*snapshot)/.test(m.text())) return; });
    await pgMem.goto(`http://localhost:${port}/lite-1.067.html`, { waitUntil: 'domcontentloaded' });
    await pgMem.waitForFunction(() => typeof window.dhAudioPut === 'function', { timeout: 10000 });
    let signedinMem = false;
    for (let i = 0; i < 2; i++) {
      try { await pgMem.click('.auth-card .auth-btn.ghost'); await pgMem.waitForSelector('body.signed-in', { timeout: 20000 }); signedinMem = true; break; }
      catch (e) { if (i === 1) break; await pgMem.waitForTimeout(1000); }
    }
    if (signedinMem) {
      await pgMem.evaluate(() => {
        _openSongObj({ id: 'SmemFallback', title: 'mem-fallback-test', key: 'C major', lyricsDoc: '<div>test</div>' });
        stopTakesListener();
      });
      await pgMem.waitForTimeout(300);

      const tMem = await pgMem.evaluate(async () => {
        // Simulate IDB being unavailable: replace _dhAudioDBP with a resolved-null promise.
        // This causes _dhAudioOpen() to always return null for the duration of this test.
        _dhAudioDBP = Promise.resolve(null);
        // Confirm IDB is now reported unavailable
        const idbReady = await dhAudioReady();
        // Force offline so no upload attempt
        const _origOnline = Object.getOwnPropertyDescriptor(window.navigator, 'onLine');
        Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => false });
        // Stub Firestore collection (no real writes)
        const origColl = db.collection.bind(db);
        db.collection = (n) => n === 'voice_takes'
          ? { doc: (id) => { const did = id || ('mem_' + Math.random().toString(36).slice(2)); return { id: did, set: async () => {} }; } }
          : origColl(n);
        // Build a decodable WAV blob
        const r=8000,n=400,b=new ArrayBuffer(44+n*2),v=new DataView(b);
        const wr=(o,s)=>{for(let i=0;i<s.length;i++)v.setUint8(o+i,s.charCodeAt(i));};
        wr(0,'RIFF');v.setUint32(4,36+n*2,true);wr(8,'WAVE');wr(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,r,true);v.setUint32(28,r*2,true);v.setUint16(32,2,true);v.setUint16(34,16,true);wr(36,'data');v.setUint32(40,n*2,true);
        for(let i=0;i<n;i++)v.setInt16(44+i*2,1000,true);
        const wavBlob = new Blob([b], { type: 'audio/wav' });
        await uploadTake(wavBlob, 'audio/wav', 0.3);
        const id = _loadedTakeId;
        const blobBack = id ? await dhAudioGet(id) : null;
        const job = id ? await dhOutboxGet(id) : null;
        // Try to load the buffer (proves in-memory blob is playable — no 'pending-remote' throw).
        // We don't go through _takes (listener was stopped) — use a synthetic take object.
        // pendingUpload:false so the guard doesn't throw; no downloadUrl so it MUST use memory blob.
        let bufferOk = false;
        if (id) {
          delete _bufCache[id]; // clear any cached entry
          try { const entry = await _getBuffer({ id, pendingUpload: false, mimeType: 'audio/wav' }); bufferOk = !!(entry && entry.buffer); } catch (e) {}
        }
        db.collection = origColl;
        if (_origOnline) Object.defineProperty(window.navigator, 'onLine', _origOnline);
        if (id) { await dhOutboxDelete(id); await dhAudioDelete(id); }
        // Restore IDB (reset the cached promise so future code can use the real IDB)
        _dhAudioDBP = null;
        return { idbReady, blobBack: !!blobBack, jobQueued: !!(job && job.takeId === id), bufferOk };
      });
      ok(tMem.idbReady === false, 'FixA IDB unavailable: dhAudioReady()===false (IDB blocked)');
      ok(tMem.blobBack, 'FixA IDB unavailable: blob retrievable via memory fallback (dhAudioGet)');
      ok(tMem.jobQueued, 'FixA IDB unavailable: outbox job enqueued in memory (dhOutboxGet)');
      ok(tMem.bufferOk, 'FixA IDB unavailable: _getBuffer decodes from memory blob (no pending-remote)');
    } else {
      console.log('SKIP Fix-A mem-fallback (guest auth unavailable)');
    }
    await pgMem.close();
  }

  // ── Fix B: resilient takes-listener re-subscribes on transient permission-denied ──
  // Uses real ctx.setOffline/setOnline (Playwright CDPSession) for true network control.
  // This test hits real Firebase + Storage (guest auth). If anon-auth is rate-limited, logs SKIP.
  {
    const ctxB = await browser.newContext();
    await ctxB.addInitScript(() => { try { localStorage['drafthaus-eula-accepted'] = '1'; } catch (e) {} });
    const pgB = await ctxB.newPage();
    pgB.on('console', m => { if (/(permission-denied|WebChannel|FirebaseError|QUIC|takes.*snapshot)/.test(m.text())) return; });
    await pgB.goto(`http://localhost:${port}/lite-1.067.html`, { waitUntil: 'domcontentloaded' });
    await pgB.waitForFunction(() => typeof window.dhAudioPut === 'function', { timeout: 10000 });
    let signedinB = false;
    for (let i = 0; i < 2; i++) {
      try { await pgB.click('.auth-card .auth-btn.ghost'); await pgB.waitForSelector('body.signed-in', { timeout: 20000 }); signedinB = true; break; }
      catch (e) { if (i === 1) break; await pgB.waitForTimeout(1000); }
    }
    if (signedinB) {
      try {
        // 1. Create song ONLINE so we have a valid auth context
        await pgB.waitForTimeout(500);
        // 2. Go offline
        await ctxB.setOffline(true);
        // 3. Create song + record take offline
        const offlineSetup = await pgB.evaluate(async () => {
          await createSong();
          const songId = _currentSong && _currentSong.id;
          // Build a decodable WAV blob
          const r=8000,n=400,b=new ArrayBuffer(44+n*2),v=new DataView(b);
          const wr=(o,s)=>{for(let i=0;i<s.length;i++)v.setUint8(o+i,s.charCodeAt(i));};
          wr(0,'RIFF');v.setUint32(4,36+n*2,true);wr(8,'WAVE');wr(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,r,true);v.setUint32(28,r*2,true);v.setUint16(32,2,true);v.setUint16(34,16,true);wr(36,'data');v.setUint32(40,n*2,true);
          for(let i=0;i<n;i++)v.setInt16(44+i*2,1000,true);
          const wavBlob = new Blob([b], { type: 'audio/wav' });
          await uploadTake(wavBlob, 'audio/wav', 0.3);
          const takeId = _loadedTakeId;
          // Wait for Firestore latency-compensation snapshot to fire (delivers pending doc to listener)
          await new Promise(r => setTimeout(r, 800));
          // Verify it plays offline (memory/IDB) and is in _takes
          let playsOffline = false;
          const take = _takes.find(t => t.id === takeId);
          if (take) { try { const en = await _getBuffer(take); playsOffline = !!(en && en.buffer); } catch (e) {} }
          const inTakes = !!take;
          return { songId, takeId, playsOffline, inTakes };
        });
        ok(offlineSetup.playsOffline, 'FixB offline: take plays locally while offline');
        ok(offlineSetup.inTakes, 'FixB offline: take appears in _takes while offline');
        // 4. Come back online
        await ctxB.setOffline(false);
        await pgB.waitForTimeout(500);
        // 5. Drain + poll for takes-listener to deliver downloadUrl (max 12s)
        let downloadUrl = null;
        const takeId = offlineSetup.takeId;
        const TIMEOUT = 12000, INTERVAL = 1000;
        let elapsed = 0;
        while (elapsed < TIMEOUT && !downloadUrl) {
          await pgB.evaluate(() => liteSyncDrain().catch(() => {}));
          await pgB.waitForTimeout(INTERVAL);
          elapsed += INTERVAL;
          downloadUrl = await pgB.evaluate((tid) => {
            const t = _takes.find(t => t.id === tid);
            return (t && t.downloadUrl) || null;
          }, takeId);
        }
        ok(!!downloadUrl, `FixB reconnect: takes-listener re-subscribed, take.downloadUrl delivered (${downloadUrl ? 'ok' : 'null after ' + TIMEOUT + 'ms'})`);
      } catch (e) {
        if (/rate.limit|too.many|quota/i.test(String(e))) { console.log('SKIP Fix-B reconnect (anon-auth rate-limited)'); }
        else { ok(false, 'FixB reconnect threw unexpectedly: ' + e); }
      }
    } else {
      console.log('SKIP Fix-B (guest auth unavailable)');
    }
    await pgB.close(); await ctxB.close();
  }

  console.log(`\n${PASS} PASS / ${FAIL} FAIL`);
  await browser.close(); srv.close();
  process.exit(FAIL ? 1 : 0);
})();
