// Lite 1.085: mobile playback-session robustness (bg audio, wake lock, sketchpad z-index, mic tip).
const { chromium } = require('playwright-core');
const path = require('path'); const http = require('http'); const fs = require('fs');
function startServer() {
  return new Promise(resolve => {
    const srv = http.createServer((req, res) => {
      const file = path.join(__dirname, decodeURIComponent(req.url.split('?')[0]));
      fs.readFile(file, (err, buf) => { if (err) { res.writeHead(404); res.end('nf'); return; }
        res.writeHead(200, { 'Content-Type': file.endsWith('.html') ? 'text/html' : 'application/octet-stream' }); res.end(buf); });
    });
    srv.listen(0, '127.0.0.1', () => resolve({ srv, port: srv.address().port }));
  });
}
const results = []; const assert = (n, c) => results.push((c ? 'PASS' : 'FAIL') + ' — ' + n);

// Reach a song-loaded state with one fake take in _takes.
async function boot(page) {
  await page.click('.auth-btn.ghost');
  await page.waitForSelector('body.signed-in', { timeout: 15000 });
  await page.evaluate(() => {
    _openSongObj({ id: 'S1', title: 'Test Song', key: 'C major', lyricsDoc: '<div>hi</div>' });
    // Seed a synthetic take (no real audio needed for wiring checks).
    _takes = [{ id: 'T1', name: 'Take 1', downloadUrl: 'about:blank', mimeType: 'audio/webm', createdAt: 1 }];
    _loadedTakeId = 'T1';
  });
}

(async () => {
  const { srv, port } = await startServer();
  const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true,
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 820 }, permissions: ['microphone'] });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  await page.goto(`http://127.0.0.1:${port}/lite-1.085.html`, { waitUntil: 'load' });

  await boot(page);
  assert('boots to signed-in + song loaded', await page.evaluate(() => !!_currentSong && _currentSong.id === 'S1'));

  // ── #1 background audio: <audio> transport ──
  assert('#playEl audio element exists', await page.evaluate(() => {
    const el = document.getElementById('playEl'); return !!el && el.tagName === 'AUDIO' && el.hasAttribute('playsinline');
  }));
  // playTake sets the element src + drives it (stub _getPlayableSrc so no real blob is needed)
  await page.evaluate(async () => {
    window.__played = null;
    window._getPlayableSrc = async () => 'about:blank#take';   // deterministic stub
    const _origPlay = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () { window.__played = this.id; return Promise.resolve(); };
    await playTake('T1');
  });
  assert('playTake sets #playEl.src', await page.evaluate(() => document.getElementById('playEl').src.includes('about:blank#take')));
  assert('playTake calls play() on #playEl', await page.evaluate(() => window.__played === 'playEl'));
  assert('playTake sets _playingTakeId', await page.evaluate(() => _playingTakeId === 'T1'));
  assert('stopPlayback pauses + clears', await page.evaluate(() => { let paused = false; const el = document.getElementById('playEl'); const p = el.pause; el.pause = () => { paused = true; }; stopPlayback(); el.pause = p; return paused && _playingTakeId === null; }));
  // whole-take loop flag
  assert('loop take sets #playEl.loop', await page.evaluate(async () => { _loopTakes = new Set(['T1']); await playTake('T1'); return document.getElementById('playEl').loop === true; }));
  // region loop uses _playRegion (old _phRegion is gone)
  assert('_phRegion removed / _playRegion is the flag', await page.evaluate(() => typeof _phRegion === 'undefined'));
  assert('region play sets _playRegion', await page.evaluate(async () => { _loopTakes = new Set(); await playTake('T1', { offset: 1, region: { a: 1, b: 2 } }); return _playRegion && _playRegion.a === 1 && _playRegion.b === 2; }));
  // Media Session wired (guarded no-op if unsupported)
  assert('Media Session metadata set (if supported)', await page.evaluate(() => !('mediaSession' in navigator) || (navigator.mediaSession.metadata && navigator.mediaSession.metadata.title.includes('Take 1'))));

  // ── #2 wake lock (stub navigator.wakeLock via defineProperty — it's a read-only prototype accessor) ──
  await page.evaluate(() => {
    window.__wl = { acquired: 0, released: 0 };
    const sentinel = { release() { window.__wl.released++; return Promise.resolve(); }, addEventListener() {} };
    Object.defineProperty(navigator, 'wakeLock', {
      value: { request: () => { window.__wl.acquired++; return Promise.resolve(sentinel); } },
      configurable: true, writable: true,
    });
  });
  await page.evaluate(async () => { _wakeLock = null; await _wakeLockAcquire(); });
  assert('wake lock acquired on demand', await page.evaluate(() => window.__wl.acquired === 1 && !!_wakeLock));
  await page.evaluate(async () => { await _wakeLockRelease(); });
  assert('wake lock released', await page.evaluate(() => window.__wl.released === 1 && _wakeLock === null));
  assert('goHome releases wake lock', await page.evaluate(async () => {
    window.__wl = { acquired: 0, released: 0 };
    _wakeLock = null; await _wakeLockAcquire(); goHome(); await new Promise(r => setTimeout(r, 30));
    return window.__wl.released >= 1;
  }));
  assert('wakeLock request failure → helpers no-op (no throw)', await page.evaluate(async () => {
    const desc = Object.getOwnPropertyDescriptor(navigator, 'wakeLock');
    Object.defineProperty(navigator, 'wakeLock', { value: { request: () => Promise.reject(new Error('denied')) }, configurable: true });
    _wakeLock = null;
    let ok = true; try { await _wakeLockAcquire(); await _wakeLockRelease(); } catch (e) { ok = false; }
    if (desc) Object.defineProperty(navigator, 'wakeLock', desc);
    return ok && _wakeLock === null;
  }));

  // ── #3 sketchpad floats over takes ──
  assert('scratchPad z-index > takesPanel z-index', await page.evaluate(() => {
    const z = el => parseInt(getComputedStyle(el).zIndex, 10);
    document.getElementById('takesPanel').classList.add('open');
    document.getElementById('scratchPad').hidden = false;
    return z(document.getElementById('scratchPad')) > z(document.getElementById('takesPanel'));
  }));

  // ── #4 mic tip (iOS tab only, once) ──
  const isIOSTabStub = () => {
    Object.defineProperty(navigator, 'standalone', { value: false, configurable: true });
    Object.defineProperty(navigator, 'userAgent', { value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1', configurable: true });
  };
  assert('mic tip shows on iOS tab, first time', await page.evaluate((fn) => {
    eval('(' + fn + ')()'); // apply iOS stub
    localStorage.removeItem('dh-lite-mic-tip-seen');
    micTipMaybeShow();
    return getComputedStyle(document.getElementById('micTip')).display !== 'none';
  }, isIOSTabStub.toString()));
  assert('mic tip dismiss hides + sets flag', await page.evaluate(() => {
    micTipDismiss();
    return document.getElementById('micTip').hidden && localStorage.getItem('dh-lite-mic-tip-seen') === '1';
  }));
  assert('mic tip does not re-show once seen', await page.evaluate(() => {
    micTipMaybeShow(); return document.getElementById('micTip').hidden;
  }));
  assert('mic tip never shows on desktop UA', await page.evaluate(() => {
    Object.defineProperty(navigator, 'userAgent', { value: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) Chrome/120', configurable: true });
    localStorage.removeItem('dh-lite-mic-tip-seen');
    micTipMaybeShow(); return document.getElementById('micTip').hidden;
  }));

  console.log(results.join('\n'));
  console.log('\n' + results.filter(r => r.startsWith('PASS')).length + '/' + results.length + ' PASS');
  if (errors.length) console.log('PAGE ERRORS:\n' + errors.join('\n'));
  await browser.close(); srv.close();
  process.exit(results.some(r => r.startsWith('FAIL')) ? 1 : 0);
})();
