// _verify_lite_1074.js — lite-1.074: loop playhead wrap, play-loads-waveform, desktop default-open takes panel
const { chromium } = require('playwright-core');
const http = require('http'); const fs = require('fs'); const path = require('path');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ROOT = __dirname;
let PASS = 0, FAIL = 0;
const ok = (c, m) => { if (c) { PASS++; console.log('PASS', m); } else { FAIL++; console.log('FAIL', m); } };

function serve() {
  return new Promise(res => {
    const s = http.createServer((req, rq) => {
      let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/lite-1.074.html';
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
  await page.goto(`http://localhost:${port}/lite-1.074.html`, { waitUntil: 'domcontentloaded' });
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

  // ── [test blocks: appended by tasks 2–4 above this line] ──

  console.log(`\n${PASS}/${PASS + FAIL} passed, ${FAIL} failed`);
  await browser.close(); srv.close();
  process.exit(FAIL ? 1 : 0);
})();
