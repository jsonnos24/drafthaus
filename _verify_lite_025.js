// lite-1.025: chord voicings from chords-db — accurate, playable fingerings + barres.
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
  const errors = []; page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  await page.goto(`http://127.0.0.1:${port}/lite-1.025.html`, { waitUntil: 'load' });
  const results = []; const assert = (n, c) => results.push((c ? 'PASS' : 'FAIL') + ' — ' + n);

  // db present
  const cov = await page.evaluate(() => ({ g: Object.keys(CHORD_DB.guitar).length, u: Object.keys(CHORD_DB.ukulele).length }));
  assert('chord database embedded (guitar+uke)', cov.g > 150 && cov.u > 150);

  // the reported bug is fixed: Cm now mutes low E (playable), not the old 5-finger shape
  const shapes = await page.evaluate(() => ({
    Cm: fbGetVoicing('guitar','Cm').strings.map(s => s.fret),
    Csm: fbGetVoicing('guitar','C#m').strings.map(s => s.fret),
    C: fbGetVoicing('guitar','C').strings.map(s => s.fret),
    Am: fbGetVoicing('guitar','Am').strings.map(s => s.fret),
    Fbarres: fbGetVoicing('guitar','F').barres,
    Bmbarres: fbGetVoicing('guitar','Bm').barres,
  }));
  assert('Cm = x31013 (low E muted, playable — bug fixed)', JSON.stringify(shapes.Cm) === JSON.stringify([3,1,0,1,3,null]));
  assert('C#m = x4212x (accurate)', JSON.stringify(shapes.Csm) === JSON.stringify([null,2,1,2,4,null]));
  assert('C major correct (x32010)', JSON.stringify(shapes.C) === JSON.stringify([0,1,0,2,3,null]));
  assert('Am correct (x02210)', JSON.stringify(shapes.Am) === JSON.stringify([0,1,2,2,0,null]));
  assert('F major has a barre', shapes.Fbarres.length === 1 && shapes.Fbarres[0] === 1);
  assert('Bm has a barre', shapes.Bmbarres.length >= 1);

  // ── Playability + correctness sweep across all 12 roots × diatonic+variation quals ──
  const sweep = await page.evaluate(() => {
    const roots = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
    const quals = ['','m','7','maj7','m7','sus2','sus4','add9','dim','dim7','m7b5','m9','madd9','6','m6'];
    const TUN = [64,59,55,50,45,40];
    const bad = { fingers: [], wrong: [], empty: [], fromAlgo: [] };
    let n = 0, db = 0;
    roots.forEach(r => quals.forEach(q => {
      n++;
      const name = r + q;
      if (CHORD_DB.guitar[name]) db++; else bad.fromAlgo.push(name);
      const m = fbGetVoicing('guitar', name);
      const distinct = new Set(m.strings.map(s => s.label).filter(l => l && l !== '0'));
      if (distinct.size > 4) bad.fingers.push(name + '(' + distinct.size + ')');
      const sounding = new Set(); m.strings.forEach((s,i)=>{ if (s.fret!=null) sounding.add(((TUN[i]+s.fret)%12+12)%12); });
      if (sounding.size === 0) bad.empty.push(name);
      const p = _fbParseChord(name); const chordSet = new Set(p.pcs.map(x=>((x%12)+12)%12));
      const wrong = [...sounding].filter(pc=>!chordSet.has(pc)).length;
      if (wrong > 0) bad.wrong.push(name);
    }));
    return { n, db, bad };
  });
  assert('all chords ≤4 fingers (physically playable)', sweep.bad.fingers.length === 0);
  assert('every voicing uses only correct chord tones', sweep.bad.wrong.length === 0);
  assert('no all-muted voicings', sweep.bad.empty.length === 0);
  assert('database covers the full diatonic+variation set', sweep.db === sweep.n);
  if (sweep.bad.fingers.length) console.log('  too many fingers:', sweep.bad.fingers.join(', '));
  if (sweep.bad.wrong.length) console.log('  wrong notes:', sweep.bad.wrong.join(', '));

  // ── Ukulele correctness ──
  const uke = await page.evaluate(() => ({
    C: fbGetVoicing('ukulele','C').strings.map(s => s.fret),
    Cm: fbGetVoicing('ukulele','Cm').strings.map(s => s.fret),
    wrong: (() => { const TUN=[69,64,60,67]; const names=['C','G','D','A','E','Am','Em','Dm','F','Cmaj7','Am7']; let bad=[];
      names.forEach(nm=>{ const m=fbGetVoicing('ukulele',nm); const snd=new Set(); m.strings.forEach((s,i)=>{if(s.fret!=null)snd.add(((TUN[i]+s.fret)%12+12)%12);}); const p=_fbParseChord(nm); const cs=new Set(p.pcs.map(x=>((x%12)+12)%12)); if([...snd].some(pc=>!cs.has(pc)))bad.push(nm);}); return bad; })(),
  }));
  assert('ukulele C = [3,0,0,0] (A,E,C,G order)', JSON.stringify(uke.C) === JSON.stringify([3,0,0,0]));
  assert('ukulele Cm = [3,3,3,0]', JSON.stringify(uke.Cm) === JSON.stringify([3,3,3,0]));
  assert('ukulele voicings harmonically correct', uke.wrong.length === 0);

  // ── Barre renders in the fretboard SVG ──
  const barreSvg = await page.evaluate(() => _fbNeckSVG(fbGetVoicing('guitar','F'), 6));
  assert('barre drawn in fretboard SVG', /opacity="0\.5"/.test(barreSvg) && barreSvg.includes('<rect'));

  // ── Fallback for chords not in db (dimM7) ──
  const fb = await page.evaluate(() => { const m = fbGetVoicing('guitar','CdimM7'); return m && m.strings.some(s=>s.fret!=null); });
  assert('chords not in db fall back to algo (no crash)', fb);

  // ── Reverse lookup still works ──
  const rev = await page.evaluate(() => identifyChord([0,4,7], 0));
  assert('reverse lookup intact (C E G → C)', rev.exact && rev.name === 'C');

  const fatal = errors.filter(e => !/permission|insufficient|FirebaseError|Failed to load resource|net::ERR|storage\//i.test(e));
  assert('no fatal JS errors', fatal.length === 0);
  console.log(results.join('\n'));
  if (fatal.length) console.log('\nFATAL:\n' + fatal.join('\n'));
  await browser.close(); srv.close();
  process.exit(results.some(r => r.startsWith('FAIL')) ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR:', e); process.exit(2); });
