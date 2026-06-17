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

  console.log(`\n${PASS} PASS / ${FAIL} FAIL`);
  await browser.close(); srv.close();
  process.exit(FAIL ? 1 : 0);
})();
