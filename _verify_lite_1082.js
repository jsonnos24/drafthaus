// _verify_lite_1082.js — lite-1.082: compact take date format (time - DD/MM/YY)
const { chromium } = require('playwright-core');
const http = require('http'); const fs = require('fs'); const path = require('path');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ROOT = __dirname;
let PASS = 0, FAIL = 0;
const ok = (c, m) => { if (c) { PASS++; console.log('PASS', m); } else { FAIL++; console.log('FAIL', m); } };

function serve() {
  return new Promise(res => {
    const s = http.createServer((req, rq) => {
      let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/lite-1.082.html';
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
  // ── Source-level: dead code is gone, call sites updated ──
  const src = fs.readFileSync(path.join(ROOT, 'lite-1.082.html'), 'utf8');
  ok(!src.includes('MONTHS') && !src.includes('_ordinal'), 'S1 source: MONTHS and _ordinal removed');
  ok(!src.includes('withYear'), 'S2 source: no withYear remnants');
  ok(src.includes('fmtTakeDate(_takeDate(take))'), 'S3 source: share viewer label uses 1-arg fmtTakeDate');
  ok(src.includes('takeDisplayName(t)') && !src.includes('takeDisplayName(t,'), 'S4 source: row+rail use 1-arg takeDisplayName');

  const srv = await serve(); const port = srv.address().port;
  const browser = await chromium.launch({
    executablePath: CHROME, headless: true,
    args: ['--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
  });
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 } });
  await ctx.addInitScript(() => { try { localStorage['drafthaus-eula-accepted'] = '1'; } catch (e) {} });
  const page = await ctx.newPage();
  await page.goto(`http://localhost:${port}/lite-1.082.html`, { waitUntil: 'domcontentloaded' });
  await page.click('.auth-btn.ghost');
  await page.waitForSelector('body.signed-in', { timeout: 15000 });

  // ── T1–T3: format contract (padding + 12am/12pm edges) ──
  const fmt = (y, mo, d, h, mi) => page.evaluate(a => fmtTakeDate(new Date(a[0], a[1], a[2], a[3], a[4])), [y, mo, d, h, mi]);
  ok(await fmt(2026, 6, 3, 9, 5) === '9:05am - 03/07/26', 'T1 padding: day/month/minute padded, hour not');
  ok(await fmt(2026, 11, 14, 0, 32) === '12:32am - 14/12/26', 'T2 midnight renders 12:32am');
  ok(await fmt(2026, 11, 14, 12, 0) === '12:00pm - 14/12/26', 'T3 noon renders 12:00pm');

  // ── T4–T5: createdAt shapes (legacy number + Firestore Timestamp), stable across renders ──
  const FIXED = new Date(2026, 5, 20, 16, 32).getTime(); // Jun 20th 2026, 4:32pm — clearly not "now"
  const t4a = await page.evaluate(f => takeDisplayName({ createdAt: f }), FIXED);
  await page.waitForTimeout(1100);
  const t4b = await page.evaluate(f => takeDisplayName({ createdAt: f }), FIXED);
  ok(t4a === '4:32pm - 20/06/26', `T4a numeric createdAt formats its stored instant (got "${t4a}")`);
  ok(t4a === t4b, 'T4b stable across renders (no drift to current time)');
  const t5 = await page.evaluate(f => takeDisplayName({ createdAt: { toDate: () => new Date(f) } }), FIXED);
  ok(t5 === '4:32pm - 20/06/26', 'T5 Timestamp createdAt renders via toDate()');

  // ── T6: missing createdAt still falls back to now (pending serverTimestamp window) ──
  const t6 = await page.evaluate(() => ({ shown: takeDisplayName({}), now: fmtTakeDate(new Date()) }));
  ok(t6.shown === t6.now, 'T6 null createdAt still shows current time');

  // ── T7: custom name prefixes; _ms sort unaffected by format change ──
  const t7 = await page.evaluate(f => ({
    named: takeDisplayName({ name: 'Chorus idea', createdAt: f }),
    sortOlderFirst: _ms(f) < _ms({ toDate: () => new Date(f + 60000) }),
  }), FIXED);
  ok(t7.named === 'Chorus idea - 4:32pm - 20/06/26' && t7.sortOlderFirst,
    'T7 name - time - date; _ms sorts numeric vs Timestamp correctly');

  // ── T8: rename safety — editor seeds only the stored name; commit writes only typed text ──
  const t8 = await page.evaluate(async f => {
    _takes = [{ id: 'TK1', name: '', createdAt: f, duration: 2, bytes: 3 }];
    renderTakes();
    const nm = document.querySelector('.take-row[data-id="TK1"] .nm');
    const shownBefore = nm.textContent;
    const captured = [];
    const origCollection = db.collection.bind(db);
    db.collection = (name) => name === 'voice_takes'
      ? { doc: (id) => ({ set: async (patch, opts) => { captured.push({ id, patch, opts }); } }) }
      : origCollection(name);
    startRename('TK1', nm);
    const seeded = nm.textContent;
    nm.textContent = 'My take';
    // headless Chrome never grants contenteditable elements real DOM focus, so
    // el.blur() doesn't fire a blur event here — invoke the wired handler directly
    // (this is exactly what startRename attaches: el.onblur = () => commitRename(id, el)).
    if (typeof nm.onblur === 'function') nm.onblur(); else nm.blur();
    await new Promise(r => setTimeout(r, 100));
    db.collection = origCollection;
    return { shownBefore, seeded, captured };
  }, FIXED);
  ok(t8.shownBefore === '4:32pm - 20/06/26' && t8.seeded === ''
     && t8.captured.length === 1 && t8.captured[0].patch.name === 'My take'
     && !('createdAt' in t8.captured[0].patch),
    'T8 rename: row shows new format; editor seeds blank (not the date); write is name-only');

  // ── T9: rail label uses the same compact format ──
  const t9 = await page.evaluate(f => {
    _takes = [{ id: 'TK1', name: '', createdAt: f, duration: 2, bytes: 3 }];
    _loadedTakeId = 'TK1';
    updateRail();
    return document.getElementById('railTakeName').textContent;
  }, FIXED);
  ok(t9 === '4:32pm - 20/06/26', 'T9 rail label shows compact format (year included)');

  // ── T10: drain doc patch still carries no createdAt (1081 regression, re-pinned here) ──
  const t10 = await page.evaluate(async () => {
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
  ok(t10.length === 1 && t10[0].id === 'TK1' && !('createdAt' in t10[0].patch)
     && t10[0].patch.downloadUrl === 'http://dl/x' && t10[0].patch.pendingUpload === false,
    'T10 drain doc patch: merge-set without createdAt (1081 fix intact)');

  console.log(`\n${PASS}/${PASS + FAIL} passed`);
  await browser.close(); srv.close();
  process.exit(FAIL ? 1 : 0);
})();
