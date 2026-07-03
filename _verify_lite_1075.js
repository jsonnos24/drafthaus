// _verify_lite_1075.js — lite-1.074: loop playhead wrap, play-loads-waveform, desktop default-open takes panel
const { chromium } = require('playwright-core');
const http = require('http'); const fs = require('fs'); const path = require('path');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ROOT = __dirname;
let PASS = 0, FAIL = 0;
const ok = (c, m) => { if (c) { PASS++; console.log('PASS', m); } else { FAIL++; console.log('FAIL', m); } };

function serve() {
  return new Promise(res => {
    const s = http.createServer((req, rq) => {
      let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/lite-1.075.html';
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

async function boot(browser, port, viewport) {
  const ctx = await browser.newContext({ viewport });
  await ctx.addInitScript(() => { try { localStorage['drafthaus-eula-accepted'] = '1'; } catch (e) {} });
  const page = await ctx.newPage();
  await page.goto(`http://localhost:${port}/lite-1.075.html`, { waitUntil: 'domcontentloaded' });
  await page.click('.auth-btn.ghost');
  await page.waitForSelector('body.signed-in', { timeout: 15000 });
  return page;
}

// Open a synthetic song and inject two takes with pre-decoded buffers (no network/Firestore).
async function seedSong(page) {
  await page.evaluate(() => {
    window._openSongObj({ id: 'TESTSONG', ownerId: 'guest', title: 'Verify Song', key: '', lyricsDoc: '<div>la</div>' });
    const d1 = new Date(2026, 5, 6, 15, 42), d2 = new Date(2026, 5, 5, 21, 30);
    _takes = [
      { id: 't1', duration: 2, storagePath: 'x.mp3', downloadUrl: '', createdAt: { toDate: () => d1 } },
      { id: 't2', duration: 2, name: 'Chorus idea', storagePath: 'y.mp3', downloadUrl: '', createdAt: { toDate: () => d2 } },
    ];
    const ac = new (window.AudioContext || window.webkitAudioContext)();
    const mk = () => { const b = ac.createBuffer(1, 88200, 44100); const ch = b.getChannelData(0); for (let i = 0; i < ch.length; i++) ch[i] = Math.sin(i / 20) * 0.5; return b; };
    _bufCache['t1'] = { buffer: mk(), normGain: 1 };
    _bufCache['t2'] = { buffer: mk(), normGain: 1 };
    _loadedTakeId = 't1';
    renderTakes(); updateRail();
    wfLoad(_takes[0]);   // mirrors what the takes snapshot listener does for the auto-selected take
  });
  await page.waitForTimeout(300);
}

// What's inside a take row's waveform host right now?
const waveState = (page, id) => page.evaluate((id) => {
  const w = document.querySelector('.take-row[data-id="' + id + '"] .take-wave');
  return w ? (w.querySelector('canvas.wave-canvas') ? 'CANVAS' : (w.textContent.trim() ? 'TEXT' : 'EMPTY')) : 'NONE';
}, id);

(async () => {
  const srv = await serve(); const port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await boot(browser, port, { width: 390, height: 780 });   // mobile-size main page
  await seedSong(page);

  // ── T1: playhead wraps on whole-take loop; toggleLoop-off rebases the clock ──
  const t1 = await page.evaluate(() => {
    const saved = { pt: _playingTakeId, ctx: _audioCtx, src: _curSource, sc: _phStartCtx, off: _phOffset, reg: _phRegion, loops: _loopTakes };
    _audioCtx = { currentTime: 5 };
    _curSource = { loop: true, buffer: { duration: 2 } };
    _playingTakeId = 'LT'; _phStartCtx = 0; _phOffset = 0; _phRegion = null;
    const wrapped = _phNow();                       // 5s into a 2s whole-take loop → 1s
    _phRegion = { a: 0.5, b: 1.0 };
    const regionWrapped = _phNow();                 // region branch must still win → 0.5
    _phRegion = null;
    _loopTakes = new Set(['LT']);
    toggleLoop('LT');                               // turns loop OFF mid-play → rebase
    const r = { wrapped, regionWrapped, rebasedOffset: _phOffset, rebasedStart: _phStartCtx, loopOff: _curSource.loop === false, regionCleared: _phRegion === null, after: _phNow() };
    _playingTakeId = saved.pt; _audioCtx = saved.ctx; _curSource = saved.src;
    _phStartCtx = saved.sc; _phOffset = saved.off; _phRegion = saved.reg; _loopTakes = saved.loops;
    renderTakes();
    return r;
  });
  const near = (a, b) => Math.abs(a - b) < 1e-9;
  ok(near(t1.wrapped, 1), 'T1 _phNow wraps whole-take loop (5s into 2s take → 1s)');
  ok(near(t1.regionWrapped, 0.5), 'T1 region loop still wraps via the region branch');
  ok(near(t1.rebasedOffset, 1) && near(t1.rebasedStart, 5), 'T1 toggleLoop-off rebases clock to wrapped position');
  ok(t1.loopOff && t1.regionCleared, 'T1 toggleLoop-off clears src.loop and _phRegion');
  ok(near(t1.after, 1), 'T1 playhead continuous across the loop-off toggle');

  // ── T2: pressing ▶ on a take shows its waveform (the "select twice" bug) ──
  await page.click('.takes-btn');                       // open the takes panel like a user
  await page.waitForTimeout(400);
  ok(await waveState(page, 't1') === 'CANVAS', 'T2 sanity: auto-selected take shows its waveform');
  await page.click('.take-row[data-id="t2"] .take-card .play');
  await page.waitForTimeout(600);
  const t2 = await page.evaluate(() => ({ wfId: _wf.takeId, playing: _playingTakeId }));
  ok(t2.playing === 't2', 'T2 ▶ press starts playback of t2');
  ok(t2.wfId === 't2', 'T2 ▶ press loads t2 into the waveform state');
  ok(await waveState(page, 't2') === 'CANVAS', 'T2 ▶ press renders t2 waveform canvas (one interaction)');
  await page.evaluate(() => stopPlayback());
  await page.click('.take-row[data-id="t1"] .take-card .nm');   // title-click path must still work
  await page.waitForTimeout(400);
  ok(await waveState(page, 't1') === 'CANVAS', 'T2 title click still shows waveform first time');

  // ── T3: takes panel default-open on desktop, closed on mobile ──
  const pgD = await boot(browser, port, { width: 1280, height: 800 });
  await pgD.evaluate(() => { window._openSongObj({ id: 'S2', ownerId: 'guest', title: 'Desk Song', key: '', lyricsDoc: '<div>x</div>' }); });
  ok(await pgD.evaluate(() => document.getElementById('takesPanel').classList.contains('open')), 'T3 desktop (1280px): takes panel open on song open');
  const pgM = await boot(browser, port, { width: 390, height: 780 });
  await pgM.evaluate(() => { window._openSongObj({ id: 'S3', ownerId: 'guest', title: 'Phone Song', key: '', lyricsDoc: '<div>x</div>' }); });
  ok(await pgM.evaluate(() => !document.getElementById('takesPanel').classList.contains('open')), 'T3 mobile (390px): takes panel still closed on song open');

  // ── T4: row-tap flash stays OPAQUE (swipe actions must not bleed through on touch-hold) ──
  {
    const ctxT = await browser.newContext({ viewport: { width: 390, height: 780 }, hasTouch: true, isMobile: true });
    await ctxT.addInitScript(() => { try { localStorage['drafthaus-eula-accepted'] = '1'; } catch (e) {} });
    const pgT = await ctxT.newPage();
    await pgT.goto(`http://localhost:${port}/lite-1.075.html`, { waitUntil: 'domcontentloaded' });
    await pgT.click('.auth-btn.ghost');
    await pgT.waitForSelector('body.signed-in', { timeout: 15000 });
    await pgT.evaluate(() => {
      window._openSongObj({ id: 'S4', ownerId: 'guest', title: 'Touch Song', key: '', lyricsDoc: '<div>x</div>' });
      const d = new Date(2026, 5, 6, 15, 42);
      _takes = [
        { id: 'a1', duration: 2, storagePath: 'x.mp3', downloadUrl: '', createdAt: { toDate: () => d } },
        { id: 'a2', duration: 2, storagePath: 'y.mp3', downloadUrl: '', createdAt: { toDate: () => d } },
      ];
      _loadedTakeId = 'a1'; renderTakes();
      document.getElementById('takesPanel').classList.add('open');
      // probe node for the song-list card rule (guest has no songs rendered)
      document.body.insertAdjacentHTML('beforeend', '<div class="sl-card" id="probeSL"></div>');
    });
    const cdp = await ctxT.newCDPSession(pgT);
    await cdp.send('DOM.enable'); await cdp.send('CSS.enable');
    const activeBg = async (selector) => {
      const { root } = await cdp.send('DOM.getDocument');
      const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector });
      await cdp.send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: ['active'] });
      const r = await pgT.evaluate((sel) => {
        const cs = getComputedStyle(document.querySelector(sel));
        const m = cs.backgroundColor.match(/rgba?\([\d.]+, [\d.]+, [\d.]+(?:, ([\d.]+))?\)/);
        return { alpha: m && m[1] !== undefined ? parseFloat(m[1]) : 1, hasFlash: cs.backgroundImage.includes('gradient') };
      }, selector);
      await cdp.send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: [] });
      return r;
    };
    const tc = await activeBg('.take-row[data-id="a2"] .take-card');   // not .sel → flash rule applies
    ok(tc.alpha === 1, 'T4 take-card :active background stays opaque (alpha=1) on touch devices');
    ok(tc.hasFlash, 'T4 take-card :active still shows the iOS gray flash (gradient layer)');
    const sc = await activeBg('#probeSL');
    ok(sc.alpha === 1, 'T4 sl-card :active background stays opaque (alpha=1) on touch devices');
    ok(sc.hasFlash, 'T4 sl-card :active still shows the iOS gray flash (gradient layer)');
    await ctxT.close();
  }

  // ── T5: waveform toolbar — Play/Loop buttons removed; time + trim controls remain ──
  {
    // main mobile page: takes panel is open, t1 selected with waveform (from T2)
    const bar = await page.evaluate(() => {
      const host = document.querySelector('.take-row[data-id="t1"] .take-wave');
      const row = host && host.querySelector('.wf-row');
      const btns = row ? [...row.querySelectorAll('button')].map(b => b.textContent.trim()) : null;
      return {
        hasTime: !!(row && row.querySelector('.wf-time')),
        hasPlayBtn: !!(row && row.querySelector('#wfPlay')),
        loopBtn: btns ? btns.some(t => /Loop/.test(t)) : null,
        btns,
      };
    });
    ok(bar.hasTime, 'T5 waveform toolbar still shows the time counter');
    ok(bar.hasPlayBtn === false, 'T5 waveform toolbar has no Play button');
    ok(bar.loopBtn === false, 'T5 waveform toolbar has no Loop button');
    const trim = await page.evaluate(() => {
      _wf.sel = { a: 0.2, b: 1.0 }; wfRender();
      const row = document.querySelector('.take-row[data-id="t1"] .take-wave .wf-row');
      const txt = row ? row.textContent : '';
      const r = { clear: /Clear/.test(txt), save: /Save Trim/.test(txt) };
      _wf.sel = null; wfRender();
      return r;
    });
    ok(trim.clear && trim.save, 'T5 selection still offers Clear + Save Trim');
  }

  // ── T6: selection gets a contextual Play button that loops the selection ──
  {
    const noSel = await page.evaluate(() => !!document.querySelector('#wfSelPlay'));
    ok(noSel === false, 'T6 no selection → no selection-play button');
    await page.evaluate(() => { _wf.sel = { a: 0.2, b: 1.0 }; wfRender(); });
    ok(await page.evaluate(() => !!document.querySelector('#wfSelPlay')), 'T6 selection made → Play button appears');
    await page.click('#wfSelPlay');
    await page.waitForTimeout(400);
    const playing = await page.evaluate(() => ({ id: _playingTakeId, region: _phRegion ? [_phRegion.a, _phRegion.b] : null }));
    ok(playing.id === 't1' && playing.region && playing.region[0] === 0.2 && playing.region[1] === 1.0,
      'T6 Play press loops the selection (region playback engaged)');
    await page.click('#wfSelPlay');
    await page.waitForTimeout(300);
    ok(await page.evaluate(() => _playingTakeId === null), 'T6 second press stops selection playback');
    await page.evaluate(() => { _wf.sel = null; wfRender(); });
    ok(await page.evaluate(() => !document.querySelector('#wfSelPlay')), 'T6 clearing selection removes the Play button');
  }

  // ── [test blocks: appended by tasks 2–4 above this line] ──

  console.log(`\n${PASS}/${PASS + FAIL} passed, ${FAIL} failed`);
  await browser.close(); srv.close();
  process.exit(FAIL ? 1 : 0);
})();
