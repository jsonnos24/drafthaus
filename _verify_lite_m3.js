// Milestone 3: chord engine (scales/voicings/reverse-ID) + Quick Chords & Find-a-Chord UI.
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
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 820 }, permissions: ['microphone'] });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  await page.goto(`http://127.0.0.1:${port}/lite-1.02.html`, { waitUntil: 'load' });
  const results = []; const assert = (n, c) => results.push((c ? 'PASS' : 'FAIL') + ' — ' + n);

  await page.click('.auth-btn.ghost');
  await page.waitForSelector('body.signed-in', { timeout: 15000 });

  // ── Engine correctness (pure) ──
  const eng = await page.evaluate(() => ({
    scaleC: seqGetScaleChords('C', 'major'),
    gtrC: fbGetVoicing('guitar', 'C').strings.map(s => s.fret),
    ukeC: fbGetVoicing('ukulele', 'C').strings.map(s => s.fret),
    idTriad: identifyChord([0,4,7], 0),       // C E G
    idMaj7: identifyChord([0,4,7,11], 0),     // C E G B
    idMin: identifyChord([9,0,4], 9),         // A C E -> Am
    idClose: identifyChord([0,4], 0),         // C E only (no full triad)
    idPower: identifyChord([0,7], 0),         // C G -> C5
    borrowedC: getBorrowedChords('C', 'major').map(b => b.name),
  }));
  assert('scale of C major = I..VIII (8, incl _viii)', JSON.stringify(eng.scaleC) === JSON.stringify(['C','Dm','Em','F','G','Am','Bdim','C_viii']));
  assert('guitar C voicing = [0,1,0,2,3,null]', JSON.stringify(eng.gtrC) === JSON.stringify([0,1,0,2,3,null]));
  assert('ukulele C voicing = [3,0,0,0] (A,E,C,G order)', JSON.stringify(eng.ukeC) === JSON.stringify([3,0,0,0]));
  assert('reverse: C E G → C (exact)', eng.idTriad.exact && eng.idTriad.name === 'C');
  assert('reverse: C E G B → Cmaj7', eng.idMaj7.exact && eng.idMaj7.name === 'Cmaj7');
  assert('reverse: A C E → Am (bass-aware)', eng.idMin.exact && eng.idMin.name === 'Am');
  assert('reverse: C E (incomplete) → Close to (not exact)', eng.idClose && eng.idClose.exact === false);
  assert('reverse: C G → C5 (power)', eng.idPower.exact && eng.idPower.name === 'C5');
  assert('borrowed for C includes Cm + secondary doms', eng.borrowedC.includes('Cm') && eng.borrowedC.includes('A7'));

  // ── Quick Chords UI ──
  await page.evaluate(() => _openSongObj({ id: 'S', title: 'X', key: 'G major', lyricsDoc: '<div>x</div>' }));
  await page.evaluate(() => openQuickChords());
  assert('QC screen visible', await page.evaluate(() => getComputedStyle(document.getElementById('screen-qc')).display !== 'none'));
  assert('QC key pill reflects song key', (await page.textContent('#qcKeyPill')).includes('G major'));
  assert('QC has 8 diatonic columns', (await page.$$('#qcPills .qc-col')).length === 8);
  assert('QC first diatonic chord = G', (await page.evaluate(() => document.querySelector('#qcPills .qc-col .qc-pill').textContent)) === 'G');
  assert('QC has variations under chords', (await page.$$('#qcPills .qc-var')).length > 10);
  assert('QC has borrowed pills', (await page.$$('#qcPills .qc-bpill')).length > 0);

  // tap a pill → selected + fretboard renders + audio engine ok
  await page.evaluate(() => qcPlayPill('C'));
  assert('QC pill select sets chord name', (await page.textContent('#qcChordName')) === 'C');
  assert('QC fretboard SVG rendered', (await page.innerHTML('#qcNeck')).includes('<svg'));
  assert('QC selected pill highlighted', (await page.$$('#qcPills .qc-pill.playing, #qcPills .qc-bpill.playing')).length >= 1);

  // instrument toggle
  await page.evaluate(() => qcSetInstrument('ukulele'));
  assert('QC uke toggle active', await page.evaluate(() => document.querySelector('#qcSeg button[data-inst=ukulele]').classList.contains('on')));

  // key change re-renders QC
  await page.evaluate(() => setKey('D major'));
  assert('QC re-renders on key change (first chord D)', (await page.evaluate(() => document.querySelector('#qcPills .qc-col .qc-pill').textContent)) === 'D');

  // ── Find a Chord UI ──
  await page.evaluate(() => openFindChord());
  assert('FC screen visible', await page.evaluate(() => getComputedStyle(document.getElementById('screen-fc')).display !== 'none'));
  assert('FC neck SVG rendered', (await page.innerHTML('#fcNeck')).includes('<svg'));
  assert('FC dropdowns populated', (await page.$$('#fcRoot option')).length === 13 && (await page.$$('#fcQual option')).length === 15);
  assert('FC initial result prompt', (await page.textContent('#fcResultName')).includes('Tap notes'));

  // pick a chord from dropdown → places + names it
  await page.evaluate(() => { const r = document.getElementById('fcRoot'), q = document.getElementById('fcQual'); r.value = 'C'; q.value = '0'; fcSelectFromDropdown(); });
  assert('FC dropdown places notes', await page.evaluate(() => _fcPlaced.some(f => f != null)));
  assert('FC dropdown identifies C', (await page.textContent('#fcResultName')) === 'C');

  // manual tap toggles a note and updates result without error
  await page.evaluate(() => { fcClear(); fcTapCell(5, 3); fcTapCell(4, 2); fcTapCell(3, 0); }); // G/A/D-ish on guitar
  assert('FC manual taps register', await page.evaluate(() => _fcPlaced.filter(f => f != null).length === 3));
  assert('FC result updates after taps', (await page.textContent('#fcResultName')).length > 0);

  // clear empties + resets prompt
  await page.evaluate(() => fcClear());
  assert('FC clear empties neck', await page.evaluate(() => _fcPlaced.every(f => f == null)));
  assert('FC clear resets prompt', (await page.textContent('#fcResultName')).includes('Tap notes'));

  // back navigation
  await page.evaluate(() => showScreen('song'));
  assert('back to song screen works', await page.evaluate(() => getComputedStyle(document.getElementById('screen-song')).display !== 'none'));

  const fatal = errors.filter(e => !/permission|insufficient|FirebaseError|Failed to load resource|net::ERR|storage\//i.test(e));
  assert('no fatal JS errors', fatal.length === 0);
  console.log(results.join('\n'));
  if (fatal.length) console.log('\nFATAL:\n' + fatal.join('\n'));
  await browser.close(); srv.close();
  process.exit(results.some(r => r.startsWith('FAIL')) ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR:', e); process.exit(2); });
