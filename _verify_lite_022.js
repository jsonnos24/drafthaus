// lite-1.022: sampled audio engine — mapping, nearest-sample, synth fallback,
// real sample load (network), sampled playback, preload wiring.
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
(async () => {
  const { srv, port } = await startServer();
  const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true,
    args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await (await browser.newContext()).newPage();
  const errors = []; page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  await page.goto(`http://127.0.0.1:${port}/lite-1.022.html`, { waitUntil: 'load' });
  const results = []; const assert = (n, c) => results.push((c ? 'PASS' : 'FAIL') + ' — ' + n);

  await page.click('.auth-btn.ghost');
  await page.waitForSelector('body.signed-in', { timeout: 15000 });

  // ── Pure helpers ──
  const pure = await page.evaluate(() => ({
    c4: _noteToMidi('C4'), a2: _noteToMidi('A2'), e2: _noteToMidi('E2'), a5: _noteToMidi('A5'),
    near58: _nearestSampleMidi({57:1,60:1}, 58), near59: _nearestSampleMidi({57:1,60:1}, 59),
  }));
  assert('note→midi C4=60', pure.c4 === 60);
  assert('note→midi A2=45, E2=40, A5=81', pure.a2 === 45 && pure.e2 === 40 && pure.a5 === 81);
  assert('nearest sample: 58→57, 59→60', pure.near58 === 57 && pure.near59 === 60);

  // ── Synth fallback when no samples loaded (must not throw) ──
  const synthOk = await page.evaluate(() => { try { _playSynth([60,64,67], 'guitar'); return true; } catch(e){ return false; } });
  assert('synth fallback plays without error', synthOk);
  const strumNoSampler = await page.evaluate(() => { try { delete _samplers.ukulele; playNotesStrum([60,64,67], 'ukulele'); return true; } catch(e){ return String(e); } });
  assert('playNotesStrum falls back to synth (no sampler)', strumNoSampler === true);

  // ── Real sample load from CDN (network) ──
  const loaded = await page.evaluate(async () => {
    try { await Promise.race([loadSampler('guitar'), new Promise((_,r)=>setTimeout(()=>r('timeout'), 25000))]); }
    catch(e){ return { ok:false, err:String(e) }; }
    const s = _samplers.guitar; return { ok: !!(s && s.loaded), count: s ? Object.keys(s.buffers).length : 0 };
  });
  assert('real guitar samples load from CDN', loaded.ok && loaded.count >= 15);

  // ── Sampled playback path (must not throw) ──
  const sampledOk = await page.evaluate(() => { try { _playSampled([55,59,62,67], 'guitar'); return true; } catch(e){ return String(e); } });
  assert('sampled playback plays without error', sampledOk === true);
  const routesToSamples = await page.evaluate(() => _samplers.guitar && _samplers.guitar.loaded === true);
  assert('playNotesStrum will route to samples when loaded', routesToSamples);

  // ── Preload wiring: opening a chord screen / toggling instrument warms the sampler ──
  const preload = await page.evaluate(() => {
    _openSongObj({ id:'S', title:'X', key:'C major', lyricsDoc:'<div>x</div>' });
    const calls = []; const orig = window.loadSampler; window.loadSampler = (i) => { calls.push(i); return Promise.resolve(); };
    openFindChord(); fcSetInstrument('ukulele');
    window.loadSampler = orig;
    return calls;
  });
  assert('opening Find-a-Chord preloads guitar sampler', preload.includes('guitar'));
  assert('toggling to ukulele preloads uke sampler', preload.includes('ukulele'));

  const fatal = errors.filter(e => !/permission|insufficient|FirebaseError|Failed to load resource|net::ERR|storage\//i.test(e));
  assert('no fatal JS errors', fatal.length === 0);
  console.log(results.join('\n'));
  if (!loaded.ok) console.log('  (sample load:', JSON.stringify(loaded), ')');
  if (fatal.length) console.log('\nFATAL:\n' + fatal.join('\n'));
  await browser.close(); srv.close();
  process.exit(results.some(r => r.startsWith('FAIL')) ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR:', e); process.exit(2); });
