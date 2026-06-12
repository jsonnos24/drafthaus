// lite-1.021: voicing quality — curated shapes authoritative, standard chords correct,
// no high barres, only correct chord tones, good coverage.
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
  const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
  const page = await (await browser.newContext()).newPage();
  await page.goto(`http://127.0.0.1:${port}/lite-1.021.html`, { waitUntil: 'load' });
  const results = []; const assert = (n, c) => results.push((c ? 'PASS' : 'FAIL') + ' — ' + n);

  // Curated shapes authoritative (high e..low E; null = mute)
  const cur = await page.evaluate(() => ({
    Cadd9: fbGetVoicing('guitar','Cadd9').strings.map(s=>s.fret),
    Cmaj7: fbGetVoicing('guitar','Cmaj7').strings.map(s=>s.fret),
    C6: fbGetVoicing('guitar','C6').strings.map(s=>s.fret),
    ukeC6: fbGetVoicing('ukulele','C6').strings.map(s=>s.fret),
  }));
  assert('Cadd9 = x32033 (the shape you drew)', JSON.stringify(cur.Cadd9) === JSON.stringify([3,3,0,2,3,null]));
  assert('Cmaj7 = x32000', JSON.stringify(cur.Cmaj7) === JSON.stringify([0,0,0,2,3,null]));
  assert('C6 = x32210', JSON.stringify(cur.C6) === JSON.stringify([0,1,2,2,3,null]));
  assert('ukulele C6 = 0000', JSON.stringify(cur.ukeC6) === JSON.stringify([0,0,0,0]));

  // Standard open chords unchanged-correct
  const std = await page.evaluate(() => ({
    C: fbGetVoicing('guitar','C').strings.map(s=>s.fret),
    G: fbGetVoicing('guitar','G').strings.map(s=>s.fret),
    Am: fbGetVoicing('guitar','Am').strings.map(s=>s.fret),
    Em: fbGetVoicing('guitar','Em').strings.map(s=>s.fret),
  }));
  assert('C major correct', JSON.stringify(std.C) === JSON.stringify([0,1,0,2,3,null]));
  assert('G major correct', JSON.stringify(std.G) === JSON.stringify([3,3,0,0,2,3]));
  assert('Am correct', JSON.stringify(std.Am) === JSON.stringify([0,1,2,2,0,null]));
  assert('Em correct', JSON.stringify(std.Em) === JSON.stringify([0,0,0,2,2,0]));

  // Broad playability + correctness sweep across diatonic + variations
  const names = ['C','G','D','A','E','F','Am','Em','Dm','Bm','F#m','Bdim','F#dim',
    'Cadd9','Gadd9','Dadd9','Aadd9','Eadd9','Csus2','Dsus2','Gsus2','Csus4','Gsus4','Dsus4','Asus4','Esus4',
    'Cmaj7','Gmaj7','Dmaj7','Amaj7','Emaj7','Fmaj7','C6','G6','D6','A6','E6','Am6','Em6',
    'Am7','Em7','Dm7','Bm7','Cm7','Dm9','Am9','Em9','C7','G7','D7','A7','E7','B7','Bdim7','Bm7b5'];
  const sweep = await page.evaluate((ns) => ns.map(name => {
    const m = fbGetVoicing('guitar', name);
    const frets = m.strings.map(s => s.fret);
    const fr = frets.filter(f => f != null && f > 0);
    const maxFret = fr.length ? Math.max(...fr) : 0;
    // pitch classes sounding vs chord tones
    const TUN = [64,59,55,50,45,40];
    const sounding = new Set(); frets.forEach((f,i)=>{ if (f!=null) sounding.add(((TUN[i]+f)%12+12)%12); });
    const p = _fbParseChord(name); const chordSet = new Set(p.pcs.map(x=>((x%12)+12)%12));
    const wrong = [...sounding].filter(pc => !chordSet.has(pc));
    return { name, maxFret, wrong: wrong.length, coverage: sounding.size, size: chordSet.size, muteAll: sounding.size===0 };
  }), names);

  const tooHigh = sweep.filter(s => s.maxFret > 5).map(s => s.name + '(' + s.maxFret + ')');
  assert('no voicing above the 5th fret', tooHigh.length === 0);
  const wrongNotes = sweep.filter(s => s.wrong > 0).map(s => s.name);
  assert('every voicing uses only correct chord tones', wrongNotes.length === 0);
  const poorCover = sweep.filter(s => !s.muteAll && s.coverage < Math.min(3, s.size)).map(s => s.name);
  assert('every voicing covers the chord (≥3 tones / full triad)', poorCover.length === 0);
  const empties = sweep.filter(s => s.muteAll).map(s => s.name);
  assert('no all-muted voicings', empties.length === 0);

  // Ukulele correctness sweep (the [g,C,E,A] vs [A,E,C,G] ordering fix)
  const ukeNames = ['C','G','D','A','E','F','Am','Em','Dm','C6','Cadd9','Cmaj7','Am7','G6'];
  const ukeSweep = await page.evaluate((ns) => ns.map(name => {
    const m = fbGetVoicing('ukulele', name);
    const TUN = [69,64,60,67];
    const sounding = new Set(); m.strings.forEach((s,i)=>{ if (s.fret!=null) sounding.add(((TUN[i]+s.fret)%12+12)%12); });
    const p = _fbParseChord(name); const chordSet = new Set(p.pcs.map(x=>((x%12)+12)%12));
    return { name, wrong: [...sounding].filter(pc=>!chordSet.has(pc)).length, cov: sounding.size };
  }), ukeNames);
  const ukeWrong = ukeSweep.filter(s => s.wrong > 0).map(s => s.name);
  assert('ukulele voicings harmonically correct (ordering fix)', ukeWrong.length === 0);
  if (ukeWrong.length) console.log('  uke wrong:', ukeWrong.join(', '));

  if (tooHigh.length) console.log('  too high:', tooHigh.join(', '));
  if (wrongNotes.length) console.log('  wrong notes:', wrongNotes.join(', '));
  if (poorCover.length) console.log('  poor coverage:', poorCover.join(', '));

  console.log(results.join('\n'));
  await browser.close(); srv.close();
  process.exit(results.some(r => r.startsWith('FAIL')) ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR:', e); process.exit(2); });
