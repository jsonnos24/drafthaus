// _verify_lite_1064.js  (Task 1 — optimistic record render)
const { chromium } = require('playwright-core');
const http = require('http'); const fs = require('fs'); const path = require('path');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ROOT = __dirname;
let PASS = 0, FAIL = 0;
const ok = (c, m) => { if (c) { PASS++; console.log('PASS', m); } else { FAIL++; console.log('FAIL', m); } };

function serve() {
  return new Promise(res => {
    const s = http.createServer((req, rq) => {
      let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/lite-1.064.html';
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

  // ── Optimistic assert page: signed-in with a loaded song ──
  const pg = await ctx.newPage();
  await pg.goto(`http://localhost:${port}/lite-1.064.html`, { waitUntil: 'domcontentloaded' });
  await pg.waitForFunction(() => typeof window.dhAudioPut === 'function', { timeout: 10000 });
  const signedin = await guestIn(pg);

  if (!signedin) {
    ok(false, 'OPT guest sign-in failed (rate-limited?) — skipping all optimistic asserts');
    ok(false, 'OPT _loadedTakeId set immediately after record');
    ok(false, 'OPT optimistic take is in _takes before upload resolves');
    ok(false, 'OPT waveform loaded (_wf.takeId) for the optimistic take');
    ok(false, 'OPT take audio is playable from IndexedDB while upload hangs');
    ok(false, 'OPT failed upload removes the optimistic take from _takes');
    ok(false, 'OPT failed upload resets _loadedTakeId');
  } else {
    // Create and open a song so _currentSong is set.
    await pg.evaluate(() => {
      _openSongObj({ id: 'S1064opt', title: 'verify-1064-opt', key: 'C major', lyricsDoc: '<div>test</div>' });
      stopTakesListener();
    });
    await pg.waitForTimeout(200);

    // ── Optimistic instant play: UI + playback do NOT wait on the upload ──
    // Stub Storage .put to hang forever; uploadTake must still render + load the take.
    const o1 = await pg.evaluate(async () => {
      stopTakesListener();               // prevent the live snapshot from clobbering _takes
      _takes = []; _loadedTakeId = null;
      const origRef = firebase.storage().ref.bind(firebase.storage());
      firebase.storage().ref = () => ({ put: () => new Promise(() => {}) , delete: () => Promise.resolve() });
      const blob = new Blob([new Uint8Array(4096)], { type: 'audio/webm' });
      uploadTake(blob, 'audio/webm', 1.0);            // not awaited — upload hangs
      await new Promise(r => setTimeout(r, 250));      // local path completes well within this
      const id = _loadedTakeId;
      const inList = !!_takes.find(t => t.id === id);
      const wfLoaded = _wf.takeId === id;
      let playable = false;
      try { const buf = await dhAudioGet(id); playable = !!buf && buf.size > 0; } catch (e) {}
      firebase.storage().ref = origRef;
      return { hasId: !!id, inList, wfLoaded, playable };
    });
    ok(o1.hasId,    'OPT _loadedTakeId set immediately after record');
    ok(o1.inList,   'OPT optimistic take is in _takes before upload resolves');
    ok(o1.wfLoaded, 'OPT waveform loaded (_wf.takeId) for the optimistic take');
    ok(o1.playable, 'OPT take audio is playable from IndexedDB while upload hangs');

    // ── Clean failure rollback: rejecting upload removes the optimistic take + blob ──
    const o2 = await pg.evaluate(async () => {
      stopTakesListener(); _takes = []; _loadedTakeId = null;
      const origRef = firebase.storage().ref.bind(firebase.storage());
      firebase.storage().ref = () => ({ put: () => Promise.reject(new Error('net down')), delete: () => Promise.resolve() });
      const blob = new Blob([new Uint8Array(4096)], { type: 'audio/webm' });
      await uploadTake(blob, 'audio/webm', 1.0);       // awaited — runs through the catch
      const id0 = _takes.length ? _takes[0].id : null; // should be empty
      // capture the id that was optimistically used by inspecting leftover cache: none should remain
      const removed = _takes.length === 0;
      firebase.storage().ref = origRef;
      return { removed, loadedReset: _loadedTakeId === null };
    });
    ok(o2.removed,      'OPT failed upload removes the optimistic take from _takes');
    ok(o2.loadedReset,  'OPT failed upload resets _loadedTakeId');
  }

  // ── Saving badge: optimistic row shows "Saving…"; a reconciled take does not ──
  // This can run without sign-in since _takeRow is a pure function.
  const o3 = await pg.evaluate(() => {
    const optHtml = _takeRow({ id: 'x1', duration: 1, bytes: 4096, mimeType: 'audio/webm', _pendingLocal: true }, false);
    const realHtml = _takeRow({ id: 'x1', duration: 1, bytes: 4096, mimeType: 'audio/webm', downloadUrl: 'http://x/y' }, false);
    return { optHasSaving: /Saving/.test(optHtml), realHasSaving: /Saving/.test(realHtml) };
  });
  ok(o3.optHasSaving,  'OPT optimistic take row shows "Saving…"');
  ok(!o3.realHasSaving, 'OPT reconciled (non-pending) take row does not show "Saving…"');

  console.log(`\n${PASS} PASS / ${FAIL} FAIL`);
  await browser.close(); srv.close();
  process.exit(FAIL ? 1 : 0);
})();
