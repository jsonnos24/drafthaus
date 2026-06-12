// lite-1.023: self-hosted samples — relative same-origin path, all notes load, preload on song-open.
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
  const page = await (await browser.newContext()).newPage();
  const errors = []; page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  await page.goto(`http://127.0.0.1:${port}/lite-1.023.html`, { waitUntil: 'load' });
  const results = []; const assert = (n, c) => results.push((c ? 'PASS' : 'FAIL') + ' — ' + n);

  await page.click('.auth-btn.ghost');
  await page.waitForSelector('body.signed-in', { timeout: 15000 });

  // sample base is now a relative same-origin path (no third-party CDN)
  const base = await page.evaluate(() => _SAMPLE_BASE);
  assert('guitar samples are same-origin (samples/guitar/)', base.guitar === 'samples/guitar/');
  assert('uke samples are same-origin (samples/ukulele/)', base.ukulele === 'samples/ukulele/');
  assert('no third-party CDN in sample base', !/https?:\/\//.test(base.guitar + base.ukulele));

  // all 23 notes load from the repo for both instruments
  const g = await page.evaluate(async () => { await loadSampler('guitar'); const s = _samplers.guitar; return { ok: s.loaded, n: Object.keys(s.buffers).length }; });
  assert('guitar: all 23 self-hosted samples load', g.ok && g.n === 23);
  const u = await page.evaluate(async () => { await loadSampler('ukulele'); const s = _samplers.ukulele; return { ok: s.loaded, n: Object.keys(s.buffers).length }; });
  assert('ukulele: all 23 self-hosted samples load', u.ok && u.n === 23);

  // sampled playback works (no synth fallback needed)
  const playOk = await page.evaluate(() => { try { _playSampled([55,59,62,67], 'guitar'); _playSampled([60,64,67], 'ukulele'); return true; } catch(e){ return String(e); } });
  assert('sampled playback (guitar + uke) plays without error', playOk === true);
  const routed = await page.evaluate(() => _samplers.guitar.loaded && _samplers.ukulele.loaded);
  assert('both instruments will route to real samples', routed);

  // preload happens on song-open (so first pill tap is already real samples)
  const calls = await page.evaluate(() => {
    const c = []; const orig = window.loadSampler; window.loadSampler = (i) => { c.push(i); return Promise.resolve(); };
    _openSongObj({ id:'S', title:'X', key:'C major', lyricsDoc:'<div>x</div>' });
    window.loadSampler = orig; return c;
  });
  assert('opening a song preloads the sampler', calls.length >= 1 && calls.includes('guitar'));

  const fatal = errors.filter(e => !/permission|insufficient|FirebaseError|Failed to load resource|net::ERR|storage\//i.test(e));
  assert('no fatal JS errors', fatal.length === 0);
  console.log(results.join('\n'));
  if (fatal.length) console.log('\nFATAL:\n' + fatal.join('\n'));
  await browser.close(); srv.close();
  process.exit(results.some(r => r.startsWith('FAIL')) ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR:', e); process.exit(2); });
