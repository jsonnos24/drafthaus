// _verify_lite_1077.js — lite-1.077: desktop sticky-note scratch pad (per-song, scroll-locked, resizable)
const { chromium } = require('playwright-core');
const http = require('http'); const fs = require('fs'); const path = require('path');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ROOT = __dirname;
let PASS = 0, FAIL = 0;
const ok = (c, m) => { if (c) { PASS++; console.log('PASS', m); } else { FAIL++; console.log('FAIL', m); } };

function serve() {
  return new Promise(res => {
    const s = http.createServer((req, rq) => {
      let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/lite-1.077.html';
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

async function boot(browser, port, viewport) {
  const ctx = await browser.newContext({ viewport });
  await ctx.addInitScript(() => { try { localStorage['drafthaus-eula-accepted'] = '1'; } catch (e) {} });
  const page = await ctx.newPage();
  await page.goto(`http://localhost:${port}/lite-1.077.html`, { waitUntil: 'domcontentloaded' });
  await page.click('.auth-btn.ghost');
  await page.waitForSelector('body.signed-in', { timeout: 15000 });
  return page;
}

// Route every db...doc(id).set() into window._setCalls (delegates everything else to Firestore).
const stubSets = (page) => page.evaluate(() => {
  window._setCalls = [];
  const origCollection = db.collection.bind(db);
  db.collection = function (name) {
    const col = origCollection(name);
    const origDoc = col.doc.bind(col);
    col.doc = (id) => {
      const d = origDoc(id);
      d.set = (payload) => { window._setCalls.push({ name, id, payload }); return Promise.resolve(); };
      return d;
    };
    return col;
  };
});

const seedSong = (page, song) => page.evaluate(s => { window._openSongObj(s); }, song);
const SONG_A = { id: 'TESTSONG', ownerId: 'guest', title: 'Scratch Song', key: '', lyricsDoc: '<div>hello world lyrics</div>', scratch: '' };
const SONG_B = { id: 'TESTSONG2', ownerId: 'guest', title: 'Other Song', key: '', lyricsDoc: '<div>second song</div>', scratch: 'Am F C G' };

(async () => {
  const srv = await serve(); const port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });

  // ═══ Desktop (1200×800) ═══
  const page = await boot(browser, port, { width: 1200, height: 800 });
  await stubSets(page);
  await seedSong(page, SONG_A);
  await page.waitForTimeout(300);

  // ── S0: sanity ──
  ok(await page.evaluate(() => document.getElementById('lyricsEditor').textContent.includes('hello world')),
    'S0 sanity: seeded lyrics render in the editor');

  // ── S1: default-open sticky, placeholder, position left of the takes seam ──
  {
    const st = await page.evaluate(() => {
      const pad = document.getElementById('scratchPad');
      const ta = document.getElementById('scratchText');
      const r = pad.getBoundingClientRect();
      return {
        hidden: pad.hidden, display: getComputedStyle(pad).display,
        ph: ta.placeholder, val: ta.value,
        right: r.right, top: r.top, w: r.width, h: r.height,
        btnOn: document.getElementById('scratchBtn').classList.contains('on'),
      };
    });
    ok(!st.hidden && st.display === 'flex', 'S1 sticky is visible by default when a song opens');
    ok(st.ph === 'Scratch pad for chords, notes etc' && st.val === '', 'S1 empty pad shows the hint placeholder');
    ok(st.right <= 1200 / 2 && st.w >= 200 && st.h >= 120, 'S1 sticky sits left of the takes-panel seam');
    ok(st.btnOn, 'S1 rail button reflects open state');
  }

  // ── S2: scroll-lock — lyrics scroll, sticky stays put ──
  {
    const st = await page.evaluate(() => {
      const ed = document.getElementById('lyricsEditor');
      ed.innerHTML = Array.from({ length: 200 }, (_, i) => `<div>line ${i}</div>`).join('');
      const before = document.getElementById('scratchPad').getBoundingClientRect().top;
      ed.scrollTop = 600;
      const after = document.getElementById('scratchPad').getBoundingClientRect().top;
      const scrolled = ed.scrollTop;
      ed.innerHTML = '<div>hello world lyrics</div>'; ed.scrollTop = 0;
      return { before, after, scrolled };
    });
    ok(st.scrolled > 0 && st.before === st.after, 'S2 sticky is scroll-locked while lyrics scroll');
  }

  // ── S3: typing → _currentSong.scratch + one debounced merge write ──
  {
    await page.evaluate(() => {
      window._setCalls.length = 0;
      const ta = document.getElementById('scratchText');
      ta.value = 'C'; scratchInput();
      ta.value = 'C G'; scratchInput();
      ta.value = 'C G Am'; scratchInput();
    });
    ok(await page.evaluate(() => _currentSong.scratch === 'C G Am'), 'S3 typing updates _currentSong.scratch immediately');
    ok(await page.evaluate(() => window._setCalls.length === 0), 'S3 no write before the debounce elapses');
    await page.waitForTimeout(900);
    const calls = await page.evaluate(() => window._setCalls);
    ok(calls.length === 1 && calls[0].name === 'songs' && calls[0].id === 'TESTSONG'
      && calls[0].payload.scratch === 'C G Am' && typeof calls[0].payload.updatedAt === 'number',
      'S3 one debounced merge write with the scratch text');
    await page.evaluate(() => { document.getElementById('scratchText').value = 'C G Am'; scratchFlush(); });
    ok(await page.evaluate(() => window._setCalls.length === 1), 'S3 flush with unchanged text writes nothing');
  }

  // ── S4: toggle hides/shows + state remembered across song opens ──
  {
    await page.evaluate(() => toggleScratch());
    let st = await page.evaluate(() => ({
      hidden: document.getElementById('scratchPad').hidden,
      ls: localStorage.getItem('dh-lite-scratch-open'),
      btnOn: document.getElementById('scratchBtn').classList.contains('on'),
    }));
    ok(st.hidden && st.ls === '0' && !st.btnOn, 'S4 toggle closes the sticky and persists closed state');
    await seedSong(page, SONG_A);
    ok(await page.evaluate(() => document.getElementById('scratchPad').hidden), 'S4 closed state survives reopening a song');
    await page.evaluate(() => toggleScratch());
    st = await page.evaluate(() => ({
      hidden: document.getElementById('scratchPad').hidden,
      ls: localStorage.getItem('dh-lite-scratch-open'),
    }));
    ok(!st.hidden && st.ls === '1', 'S4 toggle reopens and persists open state');
  }

  // ── S5: bottom-edge resize with clamps, height remembered ──
  {
    const st = await page.evaluate(() => {
      const pad = document.getElementById('scratchPad');
      const handle = document.getElementById('scratchResize');
      pad.style.height = '320px';
      const h0 = pad.offsetHeight;
      handle.dispatchEvent(new PointerEvent('pointerdown', { clientY: 400, bubbles: true }));
      window.dispatchEvent(new PointerEvent('pointermove', { clientY: 550 }));
      window.dispatchEvent(new PointerEvent('pointerup', {}));
      const h1 = pad.offsetHeight;
      handle.dispatchEvent(new PointerEvent('pointerdown', { clientY: 400, bubbles: true }));
      window.dispatchEvent(new PointerEvent('pointermove', { clientY: 5000 }));   // way past max
      window.dispatchEvent(new PointerEvent('pointerup', {}));
      const hMax = pad.offsetHeight;
      handle.dispatchEvent(new PointerEvent('pointerdown', { clientY: 400, bubbles: true }));
      window.dispatchEvent(new PointerEvent('pointermove', { clientY: -5000 }));  // way past min
      window.dispatchEvent(new PointerEvent('pointerup', {}));
      const hMin = pad.offsetHeight;
      return { h0, h1, hMax, hMin, ls: localStorage.getItem('dh-lite-scratch-h') };
    });
    ok(st.h1 === st.h0 + 150, 'S5 dragging the bottom edge grows the sticky');
    ok(st.hMax <= Math.round(800 * 0.7) && st.hMin === 120, 'S5 resize clamps to 120px–70vh');
    ok(st.ls === String(st.hMin), 'S5 height persists to localStorage');
    const restored = await page.evaluate(() => {
      localStorage.setItem('dh-lite-scratch-h', '444');
      window._openSongObj({ id: 'TESTSONG', ownerId: 'guest', title: 'Scratch Song', key: '', lyricsDoc: '<div>x</div>', scratch: '' });
      return document.getElementById('scratchPad').offsetHeight;
    });
    ok(restored === 444, 'S5 saved height is restored on song open');
  }

  // ── S6: per-song content + flush-on-switch (no lost edits between songs) ──
  {
    await page.evaluate(() => { window._setCalls.length = 0; });
    await seedSong(page, SONG_A);
    await page.evaluate(() => {
      const ta = document.getElementById('scratchText');
      ta.value = 'capo 2, try Dm bridge'; scratchInput();   // debounce still pending…
    });
    await seedSong(page, SONG_B);                            // …switch songs immediately
    const st = await page.evaluate(() => ({
      calls: window._setCalls,
      val: document.getElementById('scratchText').value,
      cur: _currentSong.scratch,
    }));
    const flushed = st.calls.find(c => c.id === 'TESTSONG' && c.payload.scratch === 'capo 2, try Dm bridge');
    ok(!!flushed, 'S6 pending scratch edits flush when switching songs');
    ok(st.val === 'Am F C G' && st.cur === 'Am F C G', 'S6 new song loads its own scratch text');
    await page.evaluate(() => { window._setCalls.length = 0; scratchInput(); goHome(); });
    ok(await page.evaluate(() => window._setCalls.length === 0 || window._setCalls.every(c => c.payload.scratch === 'Am F C G')),
      'S6 goHome flush never writes another song\'s text');
    ok(await page.evaluate(() => _currentSong === null), 'S6 goHome still clears the song');
  }

  // ── S7: theme tokens flip between light and dark ──
  {
    const tok = await page.evaluate(() => {
      const get = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
      const light = { bg: get('--sticky-bg'), text: get('--sticky-text') };
      document.documentElement.classList.add('dark');
      const dark = { bg: get('--sticky-bg'), text: get('--sticky-text') };
      document.documentElement.classList.remove('dark');
      return { light, dark };
    });
    ok(tok.light.bg && tok.dark.bg && tok.light.bg !== tok.dark.bg && tok.light.text !== tok.dark.text,
      'S7 --sticky-bg/--sticky-text are theme-adaptive');
  }

  // ── S8: createSong seeds scratch:"" (field exists on new docs) ──
  {
    const seeded = await page.evaluate(() => {
      window._setCalls.length = 0;
      return createSong().then(() => {
        const c = window._setCalls.find(x => x.name === 'songs');
        return c && c.payload.scratch === '';
      });
    });
    ok(seeded, 'S8 createSong includes scratch:"" in the new doc');
    await page.evaluate(() => goHome());
  }

  // ═══ Mobile (390×780): feature fully hidden ═══
  {
    const m = await boot(browser, port, { width: 390, height: 780 });
    await stubSets(m);
    await seedSong(m, SONG_A);
    await m.waitForTimeout(300);
    const st = await m.evaluate(() => ({
      pad: getComputedStyle(document.getElementById('scratchPad')).display,
      btn: getComputedStyle(document.getElementById('scratchBtn')).display,
    }));
    ok(st.pad === 'none' && st.btn === 'none', 'S9 mobile: sticky and rail button are hidden');
    await m.close();
  }

  console.log(`\n${PASS}/${PASS + FAIL} passed, ${FAIL} failed`);
  await browser.close(); srv.close();
  process.exit(FAIL ? 1 : 0);
})();
