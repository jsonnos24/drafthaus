// _verify_lite_1063.js  (Phase 1 — instant playback)
const { chromium } = require('playwright-core');
const http = require('http'); const fs = require('fs'); const path = require('path');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ROOT = __dirname;
let PASS = 0, FAIL = 0;
const ok = (c, m) => { if (c) { PASS++; console.log('PASS', m); } else { FAIL++; console.log('FAIL', m); } };

function serve() {
  return new Promise(res => {
    const s = http.createServer((req, rq) => {
      let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/lite-1.063.html';
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
  const pg = await ctx.newPage();
  await pg.goto(`http://localhost:${port}/lite-1.063.html`, { waitUntil: 'domcontentloaded' });
  await pg.waitForFunction(() => typeof window.dhAudioPut === 'function', { timeout: 10000 });

  // ── Task 1: IndexedDB cache module ──
  const t1 = await pg.evaluate(async () => {
    const enc = new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'audio/webm' });
    const ready = await dhAudioReady();
    const put = await dhAudioPut('id-A', enc, { mimeType: 'audio/webm' });
    const got = await dhAudioGet('id-A');
    const gotBytes = got ? got.size : -1;
    const miss = await dhAudioGet('nope');
    await dhAudioDelete('id-A');
    const afterDel = await dhAudioGet('id-A');
    return { ready, put, gotBytes, miss: miss === null, afterDel: afterDel === null, cap: DH_AUDIO_CAP };
  });
  ok(t1.ready === true, 'T1 dhAudioReady true in headless Chrome');
  ok(t1.put === true, 'T1 dhAudioPut resolves true');
  ok(t1.gotBytes === 4, 'T1 dhAudioGet returns the stored blob (4 bytes)');
  ok(t1.miss, 'T1 dhAudioGet(missing) returns null');
  ok(t1.afterDel, 'T1 dhAudioDelete removes the record');
  ok(t1.cap === 250 * 1024 * 1024, 'T1 DH_AUDIO_CAP is 250 MB');

  // ── Task 1: eviction skips pendingUpload, evicts by LRU ──
  const t1b = await pg.evaluate(async () => {
    // shrink the cap for the test via a temporary override is not possible (const); instead
    // assert eviction logic by storing pendingUpload + normal, forcing evict, checking survival.
    const big = new Blob([new Uint8Array(1024)], { type: 'audio/webm' });
    await dhAudioPut('pend', big, { pendingUpload: true });
    await dhAudioPut('lru1', big, {});
    await new Promise(r => setTimeout(r, 5));
    await dhAudioTouch('lru1'); // lru1 newer than pend by lastPlayed
    await dhAudioEvict();       // under cap → nothing evicted, both survive
    const a = await dhAudioGet('pend'), b = await dhAudioGet('lru1');
    await dhAudioDelete('pend'); await dhAudioDelete('lru1');
    return { pendKept: !!a, lruKept: !!b };
  });
  ok(t1b.pendKept, 'T1 eviction under-cap keeps pendingUpload blob');
  ok(t1b.lruKept, 'T1 eviction under-cap keeps normal blob');

  // ── Task 1: eviction over-cap — LRU ordering + pendingUpload exemption ──
  // Store 3×1024-byte blobs with cap=1500 so eviction must run with 2 evictable
  // candidates (exercises the filter+sort path). pend is exempt; old < new by
  // lastPlayed so old is evicted first. Total=3072 > 1500 → both normal blobs
  // end up evicted; only pend survives.
  const t1c = await pg.evaluate(async () => {
    const savedCap = DH_AUDIO_CAP;

    // Use a large cap to store all 3 blobs without triggering eviction.
    DH_AUDIO_CAP = 999999;
    const blob = new Blob([new Uint8Array(1024)], { type: 'audio/webm' });

    await dhAudioPut('pend', blob, { pendingUpload: true });
    await new Promise(r => setTimeout(r, 5));
    await dhAudioPut('old', blob, {});
    await new Promise(r => setTimeout(r, 5));
    await dhAudioPut('new', blob, {});

    // Now lower cap below total (3072 bytes) and trigger eviction.
    // Evictable = [old, new] sorted ascending by lastPlayed (old < new).
    // Evict old → total 2048 > 1500 → evict new → total 1024 ≤ 1500 → stop.
    // Result: only pend survives.
    DH_AUDIO_CAP = 1500;
    await dhAudioEvict();

    const pendResult = await dhAudioGet('pend');
    const oldResult  = await dhAudioGet('old');

    // Restore cap and clean up survivors.
    DH_AUDIO_CAP = savedCap;
    await dhAudioDelete('pend');
    await dhAudioDelete('old');
    await dhAudioDelete('new');

    return { pendKept: pendResult !== null, oldEvicted: oldResult === null };
  });
  ok(t1c.pendKept,    'T1 eviction over-cap keeps pendingUpload blob');
  ok(t1c.oldEvicted,  'T1 eviction over-cap evicts least-recently-played normal blob first');

  // ── Task 2: _getBuffer is IndexedDB-first (no network when cached) ──
  const t2 = await pg.evaluate(async () => {
    // Build a 0.05s mono WAV (decodeAudioData-able) as a Blob.
    function wav(seconds, rate) {
      const n = Math.floor(seconds * rate), buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
      const wr = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
      wr(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); wr(8, 'WAVE'); wr(12, 'fmt '); v.setUint32(16, 16, true);
      v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true);
      v.setUint16(32, 2, true); v.setUint16(34, 16, true); wr(36, 'data'); v.setUint32(40, n * 2, true);
      for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.sin(i / 4) * 8000, true);
      return new Blob([buf], { type: 'audio/wav' });
    }
    await dhAudioPut('take-cached', wav(0.05, 8000), { mimeType: 'audio/wav' });
    const realFetch = window.fetch;
    window.fetch = () => { throw new Error('NETWORK BLOCKED'); };
    let okDecode = false, threw = false;
    try { const entry = await _getBuffer({ id: 'take-cached', downloadUrl: 'http://blocked/never' }); okDecode = !!(entry && entry.buffer && entry.buffer.duration > 0); }
    catch (e) { threw = true; }
    window.fetch = realFetch;
    delete _bufCache['take-cached'];
    await dhAudioDelete('take-cached');
    return { okDecode, threw };
  });
  ok(t2.okDecode && !t2.threw, 'T2 _getBuffer decodes from IndexedDB with fetch blocked (no network)');

  // ── Task 3: record caches locally + primes playback before upload resolves ──
  // Sign in as guest and create a loaded song first.
  async function guestIn(page) {
    for (let i = 0; i < 2; i++) {
      try { await page.click('.auth-card .auth-btn.ghost'); await page.waitForSelector('body.signed-in', { timeout: 20000 }); return true; }
      catch (e) { if (i === 1) return false; await page.waitForTimeout(1000); }
    }
  }
  const pg2 = await ctx.newPage();
  await pg2.goto(`http://localhost:${port}/lite-1.063.html`, { waitUntil: 'domcontentloaded' });
  await pg2.waitForFunction(() => typeof window.dhAudioPut === 'function', { timeout: 10000 });
  const signedin = await guestIn(pg2);
  if (!signedin) {
    ok(false, 'T3 guest sign-in failed (rate-limited?) — skipping Task-3 asserts');
    ok(false, 'T3 the just-recorded take blob is locally retrievable while upload hangs');
  } else {
    // Create and open a song so _currentSong is set.
    await pg2.evaluate(() => {
      _openSongObj({ id: 'S1063t3', title: 'verify-1063-t3', key: 'C major', lyricsDoc: '<div>test</div>' });
      stopTakesListener();
    });
    await pg2.waitForTimeout(200);

    const t3 = await pg2.evaluate(async () => {
      // Stub Storage upload to NEVER resolve, so any await on it would hang the test.
      const origRef = firebase.storage().ref.bind(firebase.storage());
      firebase.storage().ref = (p) => ({ put: () => new Promise(() => {}), getDownloadURL: () => new Promise(() => {}), delete: () => Promise.resolve() });
      const blob = new Blob([new Uint8Array(2048)], { type: 'audio/webm' });
      const before = Object.keys(_bufCache).length;
      // Call uploadTake but DON'T await its network tail; race it against a short timer.
      uploadTake(blob, 'audio/webm', 1.0); // intentionally not awaited — Storage put is stubbed to hang
      await new Promise(r => setTimeout(r, 250)); // local path should be done well within this
      const ids = await (async () => { const db = await _dhAudioOpen(); const all = await _dhReq(_dhTx(db, 'readonly').getAll()); return all.map(r => r.id); })();
      const cachedSomething = ids.length > 0;
      const selected = !!_loadedTakeId;
      const localBlobPresent = _loadedTakeId ? !!(await dhAudioGet(_loadedTakeId)) : false;
      firebase.storage().ref = origRef; // restore
      return { cachedSomething, selected, localBlobPresent, before };
    });
    ok(t3.cachedSomething, 'T3 record stores a blob in IndexedDB without waiting on upload');
    ok(t3.selected, 'T3 _loadedTakeId is set before upload resolves');
    ok(t3.localBlobPresent, 'T3 the just-recorded take blob is locally retrievable while upload hangs');
  }

  // ── Task 4: delete clears the local blob ──
  // Run on pg2 (signed-in page) so uid() is reliably non-null.
  const t4 = await pg2.evaluate(async () => {
    await dhAudioPut('del-me', new Blob([new Uint8Array(16)], { type: 'audio/webm' }), {});
    // Simulate a take object present in _takes so deleteTake finds it; stub confirm + storage + db.
    const origConfirm = window.confirm; window.confirm = () => true;
    const origRef = firebase.storage().ref.bind(firebase.storage());
    firebase.storage().ref = () => ({ delete: () => Promise.resolve() });
    const origCollection = db.collection.bind(db);
    db.collection = () => ({ doc: () => ({ delete: async () => {} }) });
    _takes = [{ id: 'del-me', storagePath: 'voice_takes/x/take.webm', bytes: 16, songId: 's' }];
    await deleteTake('del-me');
    const gone = (await dhAudioGet('del-me')) === null;
    window.confirm = origConfirm; firebase.storage().ref = origRef;
    db.collection = origCollection;
    _takes = []; // reset injected takes so later tests don't inherit stale state
    return { gone };
  });
  ok(t4.gone, 'T4 deleteTake removes the local cached blob');

  // ── Task 4b: _wfReplaceAudio caches the edited blob under the take id ──
  // Run on pg2 (signed-in page) so uid() is reliably non-null for _wfReplaceAudio.
  const t4b = await pg2.evaluate(async () => {
    // Minimal AudioBuffer to feed _wfReplaceAudio; stub mp3 lib + encode + storage + db.
    const ctx = ensureCtx(); const ab = ctx.createBuffer(1, 4410, 44100);
    _takes = [{ id: 'trim-me', songId: 's', bytes: 100, storagePath: 'voice_takes/s/old.webm' }];
    _wf.takeId = 'trim-me';
    const origEnsureMp3Lib = window._ensureMp3Lib;
    const origEncodeMp3 = window._encodeMp3;
    window._ensureMp3Lib = async () => {};
    window._encodeMp3 = () => new Blob([new Uint8Array(64)], { type: 'audio/mp3' });
    const origRef = firebase.storage().ref.bind(firebase.storage());
    firebase.storage().ref = () => ({ put: async () => ({ ref: { getDownloadURL: async () => 'http://x/y.mp3' } }), delete: () => Promise.resolve() });
    const origCollection = db.collection.bind(db);
    db.collection = () => ({ doc: () => ({ set: async () => {} }) });
    await _wfReplaceAudio(ab, null, 'Trimmed');
    const cached = (await dhAudioGet('trim-me')) !== null;
    window._ensureMp3Lib = origEnsureMp3Lib; window._encodeMp3 = origEncodeMp3;
    db.collection = origCollection; firebase.storage().ref = origRef;
    await dhAudioDelete('trim-me');
    _takes = []; // reset injected takes so later tests don't inherit stale state
    return { cached };
  });
  ok(t4b.cached, 'T4 trim caches the edited blob locally under the take id');

  // ── Fix-1 rollback: trim-failure reverts local cache to prior state ──
  // Run on pg2 (signed-in page) so uid() is non-null.
  const tRollback = await pg2.evaluate(async () => {
    const ctx = ensureCtx(); const ab = ctx.createBuffer(1, 4410, 44100);
    const priorBlob = new Blob([new Uint8Array(32)], { type: 'audio/mp3' });
    await dhAudioPut('rollback-take', priorBlob, { mimeType: 'audio/mp3' });
    const priorBufEntry = { buffer: ab, normGain: 0.75 };
    _bufCache['rollback-take'] = priorBufEntry;
    _takes = [{ id: 'rollback-take', songId: 's', bytes: 32, storagePath: 'voice_takes/s/orig.mp3' }];
    _wf.takeId = 'rollback-take';
    const origEnsureMp3Lib = window._ensureMp3Lib;
    const origEncodeMp3 = window._encodeMp3;
    window._ensureMp3Lib = async () => {};
    window._encodeMp3 = () => new Blob([new Uint8Array(64)], { type: 'audio/mp3' });
    // Stub storage .put to REJECT so the catch branch runs.
    const origStorageRef = firebase.storage().ref.bind(firebase.storage());
    firebase.storage().ref = () => ({ put: async () => { throw new Error('upload-fail'); }, delete: () => Promise.resolve() });
    const origCollection = db.collection.bind(db);
    db.collection = () => ({ doc: () => ({ set: async () => {} }) });
    const result = await _wfReplaceAudio(ab, null, 'Trimmed');
    // After failure: local blob should be gone (deleted) and bufCache reverted.
    const localAfter = await dhAudioGet('rollback-take');
    const bufAfter = _bufCache['rollback-take'];
    window._ensureMp3Lib = origEnsureMp3Lib; window._encodeMp3 = origEncodeMp3;
    db.collection = origCollection;
    firebase.storage().ref = origStorageRef;
    _takes = []; delete _bufCache['rollback-take']; await dhAudioDelete('rollback-take');
    return {
      returnedFalse: result === false,
      localGone: localAfter === null,
      bufReverted: bufAfter === priorBufEntry
    };
  });
  ok(tRollback.returnedFalse, 'Fix-1 rollback: _wfReplaceAudio returns false on upload failure');
  ok(tRollback.localGone,     'Fix-1 rollback: local blob deleted from IndexedDB after upload failure');
  ok(tRollback.bufReverted,   'Fix-1 rollback: _bufCache reverted to prior entry after upload failure');

  // ── Task 5a: existing take with NO local blob reads via fetch, exactly as before ──
  const t5a = await pg.evaluate(async () => {
    let fetched = false;
    const realFetch = window.fetch;
    function wav() { const r = 8000, n = 400, b = new ArrayBuffer(44 + n * 2), v = new DataView(b); const wr=(o,s)=>{for(let i=0;i<s.length;i++)v.setUint8(o+i,s.charCodeAt(i));}; wr(0,'RIFF');v.setUint32(4,36+n*2,true);wr(8,'WAVE');wr(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,r,true);v.setUint32(28,r*2,true);v.setUint16(32,2,true);v.setUint16(34,16,true);wr(36,'data');v.setUint32(40,n*2,true);for(let i=0;i<n;i++)v.setInt16(44+i*2,1000,true);return b; }
    window.fetch = async () => { fetched = true; return { arrayBuffer: async () => wav() }; };
    delete _bufCache['legacy-take'];
    const entry = await _getBuffer({ id: 'legacy-take', downloadUrl: 'http://x/legacy', mimeType: 'audio/wav' });
    const cachedNow = (await dhAudioGet('legacy-take')) !== null; // downloaded blob is now cached
    window.fetch = realFetch; delete _bufCache['legacy-take']; await dhAudioDelete('legacy-take');
    return { fetched, decoded: !!(entry && entry.buffer), cachedNow };
  });
  ok(t5a.fetched && t5a.decoded, 'T5 existing take with no local blob still fetches+decodes (no-harm)');
  ok(t5a.cachedNow, 'T5 a downloaded existing take gets cached for next time');

  // ── Task 5b: graceful degradation — with IndexedDB unavailable, helpers no-op safely ──
  const t5b = await pg.evaluate(async () => {
    const realP = _dhAudioDBP;
    _dhAudioDBP = Promise.resolve(null); // force "DB unavailable"
    const put = await dhAudioPut('x', new Blob([new Uint8Array(4)]), {});
    const get = await dhAudioGet('x');
    const ready = await dhAudioReady();
    _dhAudioDBP = realP;
    return { put: put === false, get: get === null, ready: ready === false };
  });
  ok(t5b.put,   'T5 IndexedDB-unavailable → dhAudioPut returns false');
  ok(t5b.get,   'T5 IndexedDB-unavailable → dhAudioGet returns null');
  ok(t5b.ready, 'T5 IndexedDB-unavailable → dhAudioReady returns false');

  console.log(`\n${PASS} PASS / ${FAIL} FAIL`);
  await browser.close(); srv.close();
  process.exit(FAIL ? 1 : 0);
})();
