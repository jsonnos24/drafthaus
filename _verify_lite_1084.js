// _verify_lite_1084.js — lite-1.084: same-device lyrics self-merge fix
// (equality guards at the 3 merge sites + _lyricsFlushP flush/freshen coordination + fromCache bail)
const { chromium } = require('playwright-core');
const http = require('http'); const fs = require('fs'); const path = require('path');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ROOT = __dirname;
let PASS = 0, FAIL = 0;
const ok = (c, m) => { if (c) { PASS++; console.log('PASS', m); } else { FAIL++; console.log('FAIL', m); } };

function serve() {
  return new Promise(res => {
    const s = http.createServer((req, rq) => {
      let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/lite-1.084.html';
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

// Boot a page to the signed-in song screen: guest sign-in, then createSong()
// (fire-and-forget Firestore write — works in guest mode; permission noise is expected).
async function boot(ctx, port) {
  const page = await ctx.newPage();
  await page.goto(`http://localhost:${port}/lite-1.084.html`, { waitUntil: 'domcontentloaded' });
  await page.click('.auth-btn.ghost');
  await page.waitForSelector('body.signed-in', { timeout: 15000 });
  await page.evaluate(() => createSong());
  await page.waitForSelector('#screen-song.active', { timeout: 5000 });
  return page;
}

// Page-side helpers: toast spy + Firestore stubs. db is a top-level binding holding an
// object — stub its METHODS; never reassign db itself. toast is a top-level function
// declaration, so bare reassignment replaces it globally.
const PAGE_HELPERS = () => {
  window._toasts = [];
  toast = (msg) => { window._toasts.push(String(msg)); };
  window.stubFS = (serverDoc, opts = {}) => {
    window._txWrites = [];
    db.runTransaction = async (fn) => {
      if (opts.delayMs) await new Promise(r => setTimeout(r, opts.delayMs));
      return await fn({
        get: async () => ({ exists: true, data: () => ({ lyricsDoc: serverDoc }) }),
        set: (ref, data) => { window._txWrites.push(data); },
      });
    };
    const snap = { exists: true, metadata: { fromCache: !!opts.fromCache }, data: () => ({ lyricsDoc: serverDoc }) };
    db.collection = () => ({
      doc: () => ({ get: async () => snap, set: async () => {}, update: async () => {} }),
      where: () => ({ orderBy: () => ({ onSnapshot: () => () => {} }), onSnapshot: () => () => {} }),
    });
  };
};

(async () => {
  const src = fs.readFileSync(path.join(ROOT, 'lite-1.084.html'), 'utf8');

  const srv = await serve(); const port = srv.address().port;
  const browser = await chromium.launch({
    executablePath: CHROME, headless: true,
    args: ['--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
  });
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 } });
  await ctx.addInitScript(() => { try { localStorage['drafthaus-eula-accepted'] = '1'; } catch (e) {} });
  const page = await boot(ctx, port);
  await page.evaluate(PAGE_HELPERS);

  const DOC = '<div>hold on tight, the night is young</div>';
  const OLD = '<div>old base</div>';
  const OTHER = '<div>edited on the ipad</div>';

  // ── F: flushLyrics equality guard + in-flight promise ──
  ok(src.includes('let _lyricsFlushP'), 'F0 source: _lyricsFlushP declared');

  const f1 = await page.evaluate(async ([DOC, OLD]) => {
    window._toasts = []; stubFS(DOC);                       // server already holds the editor's exact text
    const ed = document.getElementById('lyricsEditor');
    ed.innerHTML = DOC; _lyricsBase = OLD; _lyricsEdited = true;
    await flushLyrics();
    return { writes: window._txWrites, base: _lyricsBase, toasts: window._toasts, flushP: _lyricsFlushP === null };
  }, [DOC, OLD]);
  ok(f1.writes.length === 1 && f1.writes[0].lyricsDoc === DOC, 'F1 flush: server==editor → adopt, writes editor doc verbatim');
  ok(!f1.writes[0].lyricsDoc.includes('lyr-merge-divider'), 'F2 flush: no divider in adopt write');
  ok(f1.base === DOC, 'F3 flush: _lyricsBase settles to the doc');
  ok(!f1.toasts.some(t => /Merged lyrics/.test(t)), 'F4 flush: no merge toast on identical content');
  ok(f1.flushP, 'F5 flush: _lyricsFlushP cleared after settle');

  const f6 = await page.evaluate(async ([DOC, OLD, OTHER]) => {
    window._toasts = []; stubFS(OTHER);                     // genuinely divergent server doc
    const ed = document.getElementById('lyricsEditor');
    ed.innerHTML = DOC; _lyricsBase = OLD; _lyricsEdited = true;
    await flushLyrics();
    return { write: window._txWrites[0], toasts: window._toasts };
  }, [DOC, OLD, OTHER]);
  ok(f6.write.lyricsDoc.includes('lyr-merge-divider') && f6.write.lyricsDoc.includes('edited on the ipad'), 'F6 flush: genuine divergence still merges with divider');
  ok(f6.toasts.some(t => /Merged lyrics/.test(t)), 'F7 flush: genuine merge still toasts');

  // ── R: liteFreshenSong — race, adopt, genuine merge, fromCache ──
  ok(src.includes('fromCache'), 'R0 source: freshen has a fromCache bail');

  const r1 = await page.evaluate(async ([DOC, OLD]) => {
    window._toasts = []; stubFS(DOC, { delayMs: 250 });     // slow flush txn; server already has DOC (the frozen-flush shape)
    const ed = document.getElementById('lyricsEditor');
    ed.innerHTML = DOC; _lyricsBase = OLD; _lyricsEdited = true;
    const fp = flushLyrics();                               // in flight…
    const fr = liteFreshenSong();                           // …freshen fires on return — must wait for the flush
    await fp; await fr;
    const html = currentEditorHtml();
    return { base: _lyricsBase, divider: html.includes('lyr-merge-divider'), toasts: window._toasts };
  }, [DOC, OLD]);
  ok(!r1.divider, 'R1 frozen-flush race: no divider after freshen during in-flight flush');
  ok(r1.base === DOC, 'R2 frozen-flush race: base settles to the flushed doc');
  ok(!r1.toasts.some(t => /Merged lyrics/.test(t)), 'R3 frozen-flush race: no merge toast');

  const r4 = await page.evaluate(async ([DOC, OLD]) => {
    window._toasts = []; stubFS(DOC);                       // no flush in flight; server == editor ≠ base
    const ed = document.getElementById('lyricsEditor');
    ed.innerHTML = DOC; _lyricsBase = OLD; _lyricsEdited = true;
    await liteFreshenSong();
    return { base: _lyricsBase, divider: currentEditorHtml().includes('lyr-merge-divider'), toasts: window._toasts };
  }, [DOC, OLD]);
  ok(!r4.divider && r4.base === DOC, 'R4 freshen: local==remote≠base → silent adopt');
  ok(!r4.toasts.some(t => /Merged lyrics/.test(t)), 'R5 freshen: no toast on silent adopt');

  const r6 = await page.evaluate(async ([DOC, OLD, OTHER]) => {
    window._toasts = []; stubFS(OTHER);                     // genuinely divergent remote
    const ed = document.getElementById('lyricsEditor');
    ed.innerHTML = DOC; _lyricsBase = OLD; _lyricsEdited = true;
    await liteFreshenSong();
    clearTimeout(_lyricsTimer);                             // merge schedules a save — keep it out of later tests
    const html = currentEditorHtml();
    return { divider: html.includes('lyr-merge-divider'), both: html.includes('night is young') && html.includes('edited on the ipad'), toasts: window._toasts };
  }, [DOC, OLD, OTHER]);
  ok(r6.divider && r6.both, 'R6 freshen: genuine divergence still merges local + divider + remote');
  ok(r6.toasts.some(t => /Merged lyrics/.test(t)), 'R7 freshen: genuine merge still toasts');

  const r8 = await page.evaluate(async ([DOC, OTHER]) => {
    window._toasts = []; stubFS(OTHER, { fromCache: true }); // stale cached read (network not back yet)
    const ed = document.getElementById('lyricsEditor');
    ed.innerHTML = DOC; _lyricsBase = DOC; _lyricsEdited = false; // clean editor — old code would silently replace with stale OTHER
    await liteFreshenSong();
    return { html: currentEditorHtml(), base: _lyricsBase };
  }, [DOC, OTHER]);
  ok(r8.html === DOC && r8.base === DOC, 'R8 freshen: fromCache snapshot ignored (no stale replace)');

  // === END TESTS ===
  console.log(`\n${PASS}/${PASS + FAIL} passed`);
  await browser.close(); srv.close();
  process.exit(FAIL ? 1 : 0);
})();
