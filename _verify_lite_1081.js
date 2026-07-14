// _verify_lite_1081.js — lite-1.081: take createdAt clobber fix (times stuck at "now")
const { chromium } = require('playwright-core');
const http = require('http'); const fs = require('fs'); const path = require('path');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ROOT = __dirname;
let PASS = 0, FAIL = 0;
const ok = (c, m) => { if (c) { PASS++; console.log('PASS', m); } else { FAIL++; console.log('FAIL', m); } };

function serve() {
  return new Promise(res => {
    const s = http.createServer((req, rq) => {
      let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/lite-1.081.html';
      const fp = path.join(ROOT, p);
      fs.readFile(fp, (e, d) => {
        if (e) { rq.statusCode = 404; rq.end('nf'); return; }
        const ext = path.extname(fp);
        rq.setHeader('Content-Type', ext === '.html' ? 'text/html' : ext === '.js' ? 'text/javascript' : 'application/octet-stream');
        rq.end(d);
      });
    });
    s.listen(0, () => res(s));
  });
}

(async () => {
  // ── S1 (source-level): the drain's upload patch no longer carries createdAt ──
  const src = fs.readFileSync(path.join(ROOT, 'lite-1.081.html'), 'utf8');
  const patchLine = src.split('\n').find(l => l.includes('job.userId, filename: job.filename'));
  ok(patchLine && !patchLine.includes('createdAt'), 'S1 source: non-replace drain patch has no createdAt key');

  const srv = await serve(); const port = srv.address().port;
  const browser = await chromium.launch({
    executablePath: CHROME, headless: true,
    args: ['--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
  });
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 } });
  await ctx.addInitScript(() => { try { localStorage['drafthaus-eula-accepted'] = '1'; } catch (e) {} });
  const page = await ctx.newPage();
  await page.goto(`http://localhost:${port}/lite-1.081.html`, { waitUntil: 'domcontentloaded' });
  await page.click('.auth-btn.ghost');
  await page.waitForSelector('body.signed-in', { timeout: 15000 });

  // ── T1: numeric createdAt (legacy clobbered docs) renders its own instant ──
  const FIXED = new Date(2026, 5, 20, 9, 5).getTime(); // Jun 20th 2026, 9:05am — clearly not "now"
  const t1a = await page.evaluate(f => takeDisplayName({ createdAt: f }), FIXED);
  await page.waitForTimeout(1100);
  const t1b = await page.evaluate(f => takeDisplayName({ createdAt: f }), FIXED);
  ok(t1a === 'June 20th - 9:05am', `T1a numeric createdAt formats its stored instant (got "${t1a}")`);
  ok(t1a === t1b, 'T1b numeric createdAt is stable across renders (no drift to current time)');

  // ── T2: Firestore Timestamp path unchanged ──
  const t2 = await page.evaluate(f => takeDisplayName({ createdAt: { toDate: () => new Date(f) } }), FIXED);
  ok(t2 === 'June 20th - 9:05am', 'T2 Timestamp createdAt still renders via toDate()');

  // ── T3: missing createdAt still falls back to now (pending serverTimestamp window) ──
  const t3 = await page.evaluate(() => ({ shown: takeDisplayName({}), now: fmtTakeDate(new Date()) }));
  ok(t3.shown === t3.now, 'T3 null createdAt (pending server echo) still shows current time');

  // ── T4: name prefix + sort both survive numeric createdAt ──
  const t4 = await page.evaluate(f => ({
    named: takeDisplayName({ name: 'Chorus idea', createdAt: f }),
    sortOlderFirst: _ms(f) < _ms({ toDate: () => new Date(f + 60000) }),
  }), FIXED);
  ok(t4.named === 'Chorus idea - June 20th - 9:05am' && t4.sortOlderFirst,
    'T4 custom name keeps stored time; _ms sorts numeric vs Timestamp correctly');

  // ── T5 (behavioral): drive liteSyncDrain with a queued upload job → the doc patch it
  //     writes has no createdAt, so the doc-first serverTimestamp survives the upload ──
  const t5 = await page.evaluate(async () => {
    const captured = [];
    dhOutboxAll = async () => (captured.length ? [] : [{
      takeId: 'TK1', op: 'upload', storagePath: 'voice_takes/S/x.webm', mimeType: 'audio/webm',
      songId: 'S', userId: 'guest', filename: 'x.webm', trackNum: 0, bytes: 3, duration: 2,
      tries: 0, createdAt: 1750000000000,
    }]);
    dhAudioGet = async () => new Blob(['abc'], { type: 'audio/webm' });
    dhOutboxDelete = async () => {}; dhAudioSetPending = async () => {};
    const origStorage = firebase.storage;
    firebase.storage = () => ({ ref: () => ({ put: async () => ({ ref: { getDownloadURL: async () => 'http://dl/x' } }), delete: () => Promise.resolve() }) });
    const origCollection = db.collection.bind(db);
    db.collection = (name) => name === 'voice_takes'
      ? { doc: (id) => ({ set: async (patch, opts) => { captured.push({ id, patch, opts }); } }) }
      : origCollection(name);
    await liteSyncDrain();
    firebase.storage = origStorage; db.collection = origCollection;
    return captured;
  });
  ok(t5.length === 1 && t5[0].id === 'TK1' && !('createdAt' in t5[0].patch)
     && t5[0].patch.downloadUrl === 'http://dl/x' && t5[0].patch.pendingUpload === false
     && t5[0].opts && t5[0].opts.merge === true,
    'T5 drain doc patch: merge-set with downloadUrl + pendingUpload:false and NO createdAt');

  console.log(`\n${PASS}/${PASS + FAIL} passed`);
  await browser.close(); srv.close();
  process.exit(FAIL ? 1 : 0);
})();
