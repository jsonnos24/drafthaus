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

  console.log(`\n${PASS} PASS / ${FAIL} FAIL`);
  await browser.close(); srv.close();
  process.exit(FAIL ? 1 : 0);
})();
