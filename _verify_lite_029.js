// lite-1.029: take waveform — render, scrub (seek), region select, loop, WAV encode, trim wiring.
const { chromium } = require('playwright-core');
const path = require('path'); const http = require('http'); const fs = require('fs');
function startServer() {
  return new Promise(resolve => {
    const srv = http.createServer((req, res) => {
      const file = path.join(__dirname, decodeURIComponent(req.url.split('?')[0]));
      fs.readFile(file, (err, buf) => { if (err) { res.writeHead(404); res.end('nf'); return; }
        const ct = file.endsWith('.html') ? 'text/html' : file.endsWith('.mp3') ? 'audio/mpeg' : 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': ct }); res.end(buf); });
    });
    srv.listen(0, '127.0.0.1', () => resolve({ srv, port: srv.address().port }));
  });
}
(async () => {
  const { srv, port } = await startServer();
  const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true,
    args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await (await browser.newContext({ viewport: { width: 420, height: 800 } })).newPage();
  const errors = []; page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  await page.goto(`http://127.0.0.1:${port}/lite-1.029.html`, { waitUntil: 'load' });
  const results = []; const assert = (n, c) => results.push((c ? 'PASS' : 'FAIL') + ' — ' + n);

  await page.click('.auth-btn.ghost');
  await page.waitForSelector('body.signed-in', { timeout: 15000 });

  // Set up a loaded take with a synthetic decoded buffer (no network)
  await page.evaluate(() => {
    _openSongObj({ id: 'S', title: 'X', key: 'C major', lyricsDoc: '<div>x</div>' });
    stopTakesListener();
    const ctx = ensureCtx(); const sr = ctx.sampleRate; const buf = ctx.createBuffer(1, Math.floor(sr * 2), sr);
    const d = buf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.sin(i * 0.01) * 0.5;
    _takes = [{ id: 't1', songId: 'S', duration: 2, storagePath: 'voice_takes/S/old.webm', downloadUrl: '', createdAt: { toDate: () => new Date() } }];
    _loadedTakeId = 't1';
    _wf.takeId = 't1'; _wf.buffer = buf; _wf.dur = buf.duration; _wf.peaks = _computePeaks(buf, 1400);
    renderTakes(); wfRender();
  });
  await page.waitForTimeout(60);

  assert('waveform bar shows when a take is loaded', await page.evaluate(() => document.getElementById('waveBar').classList.contains('show')));
  assert('waveform canvas rendered', (await page.$$('#waveBar .wave-canvas')).length === 1);
  assert('time display + Play button present', await page.evaluate(() => !!document.getElementById('wfTime') && !!document.getElementById('wfPlay')));
  assert('peaks computed (length + range 0..1)', await page.evaluate(() => _wf.peaks.length === 1400 && [..._wf.peaks].every(p => p >= 0 && p <= 1)));

  // ── Scrub: a tap seeks (sets playhead) ──
  const seek = await page.evaluate(() => {
    const c = document.querySelector('#waveBar .wave-canvas'); const r = c.getBoundingClientRect();
    const x = r.left + r.width * 0.3;
    c.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, clientX: x, clientY: r.top + 10, bubbles: true }));
    document.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, clientX: x, clientY: r.top + 10, bubbles: true }));
    return _wf.playhead;
  });
  assert('tap on waveform seeks (~0.6s of 2s)', Math.abs(seek - 0.6) < 0.12);

  // ── Region select: a drag selects ──
  const sel = await page.evaluate(() => {
    const c = document.querySelector('#waveBar .wave-canvas'); const r = c.getBoundingClientRect();
    c.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 2, clientX: r.left + r.width * 0.25, clientY: r.top + 10, bubbles: true }));
    document.dispatchEvent(new PointerEvent('pointermove', { pointerId: 2, clientX: r.left + r.width * 0.65, clientY: r.top + 10, bubbles: true }));
    document.dispatchEvent(new PointerEvent('pointerup', { pointerId: 2, clientX: r.left + r.width * 0.65, clientY: r.top + 10, bubbles: true }));
    return _wf.sel;
  });
  assert('drag selects a region (~0.5s–1.3s)', sel && Math.abs(sel.a - 0.5) < 0.12 && Math.abs(sel.b - 1.3) < 0.12);
  assert('selection reveals Loop + Save Trim + Clear', await page.evaluate(() => { const h = document.getElementById('waveBar').innerHTML; return /wfToggleLoopSel/.test(h) && /wfSaveTrim/.test(h) && /wfClearSel/.test(h); }));

  // loop toggle + clear
  assert('Loop selection toggles on', await page.evaluate(() => { wfToggleLoopSel(); return _wf.loopSel === true; }));
  assert('Clear removes the selection', await page.evaluate(() => { wfClearSel(); return _wf.sel === null && _wf.loopSel === false; }));

  // ── Buffer slice + WAV encode ──
  const enc = await page.evaluate(() => {
    const sliced = _sliceBuffer(_wf.buffer, 0.5, 1.0);
    const blob = _encodeWav(sliced);
    return { dur: sliced.duration, type: blob.type, size: blob.size };
  });
  assert('slice produces ~0.5s buffer', Math.abs(enc.dur - 0.5) < 0.02);
  assert('WAV encode yields an audio/wav blob with data', enc.type === 'audio/wav' && enc.size > 1000);

  // ── Save Trim wiring: requires a selection, confirms, calls the replace path ──
  const trim = await page.evaluate(async () => {
    _wf.sel = { a: 0.4, b: 1.4 };
    let captured = null; const orig = window._wfReplaceAudio; window._wfReplaceAudio = (buf, undo, msg) => { captured = { dur: buf.duration, hasUndo: !!undo, msg }; return Promise.resolve(true); };
    window.confirm = () => true;
    await wfSaveTrim();
    window._wfReplaceAudio = orig;
    return captured;
  });
  assert('Save Trim slices to selection (~1.0s) + keeps undo buffer', trim && Math.abs(trim.dur - 1.0) < 0.05 && trim.hasUndo && trim.msg === 'Trimmed');

  // ── playhead math (region wrap) ──
  assert('playhead helper returns a number', await page.evaluate(() => typeof _phNow() === 'number'));

  const fatal = errors.filter(e => !/permission|insufficient|FirebaseError|Failed to load resource|net::ERR|storage\//i.test(e));
  assert('no fatal JS errors', fatal.length === 0);
  console.log(results.join('\n'));
  if (fatal.length) console.log('\nFATAL:\n' + fatal.join('\n'));
  await browser.close(); srv.close();
  process.exit(results.some(r => r.startsWith('FAIL')) ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR:', e); process.exit(2); });
