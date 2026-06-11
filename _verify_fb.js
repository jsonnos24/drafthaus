// Headless verify harness for the floating fretboard. Drives installed Chrome via playwright-core.
const { chromium } = require('playwright-core');
const path = require('path');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const FILE = 'file://' + path.resolve(__dirname, '1.314.html');

let pass = 0, fail = 0;
function assert(name, cond, extra) {
  if (cond) { pass++; console.log('  ok  ' + name); }
  else { fail++; console.log('FAIL  ' + name + (extra ? '  -> ' + JSON.stringify(extra) : '')); }
}

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  await page.addInitScript(() => { try { localStorage.setItem('drafthaus-eula-accepted','1'); } catch(e){} });
  page.on('pageerror', e => { fail++; console.log('FAIL  pageerror -> ' + e.message); });
  await page.goto(FILE, { waitUntil: 'load' });
  await page.waitForTimeout(400);

  // === ENGINE ASSERTIONS ===
  const t1 = await page.evaluate(() => ({
    c:   _fbParseChord('C'),
    fs7: _fbParseChord('F#7'),
    m7b5:_fbParseChord('Bm7b5'),
    bad: _fbParseChord('H'),
    nul: _fbParseChord(''),
    cnote0: (typeof SEQ_NOTES !== 'undefined' && SEQ_NOTES[0]),
  }));
  assert('SEQ_NOTES[0] is C', t1.cnote0 === 'C', t1.cnote0);
  assert('parse C -> root C, pcs[0,4,7]', t1.c && t1.c.root==='C' && t1.c.rootPc===0 && JSON.stringify(t1.c.pcs)==='[0,4,7]', t1.c);
  assert('parse F#7 -> root F#, 4 pcs', t1.fs7 && t1.fs7.root==='F#' && t1.fs7.pcs.length===4, t1.fs7);
  assert('parse Bm7b5 -> qual m7b5', t1.m7b5 && t1.m7b5.qual==='m7b5' && t1.m7b5.pcs.length===4, t1.m7b5);
  assert('parse junk -> null', t1.bad === null && t1.nul === null, t1);

  const t2 = await page.evaluate(() => ({
    cmaj: _fbLibraryVoicing('guitar', _fbParseChord('C')),
    add9: _fbLibraryVoicing('guitar', _fbParseChord('Cadd9')),
    bass: _fbLibraryVoicing('bass', _fbParseChord('C')),
  }));
  // GUITAR_OPEN_VOICINGS 'C Major' = [0,1,0,2,3,'x'] (e B G D A E)
  assert('lib C major matches open voicing', t2.cmaj &&
    JSON.stringify(t2.cmaj.strings.map(s=>s.fret)) === '[0,1,0,2,3,null]', t2.cmaj);
  assert('lib add9 -> null (not in map)', t2.add9 === null, t2.add9);
  assert('lib bass -> null (algo handles bass)', t2.bass === null, t2.bass);

  const t3 = await page.evaluate(() => {
    function pcsOf(strings, tuning) {
      return strings.map((s,i)=> s.fret==null?null:(((tuning[i]+s.fret)%12)+12)%12);
    }
    var p = _fbParseChord('Cadd9');           // pcs include 0,4,7,2
    var v = _fbAlgoVoicing('guitar', p.pcs, p.rootPc);
    var guitarHL = [64,59,55,50,45,40];
    return { ok: !!v, base: v && v.base,
      pcs: v && pcsOf(v.strings, guitarHL),
      span: v && (function(){ var fs=v.strings.map(s=>s.fret).filter(f=>f>0); return fs.length?Math.max.apply(null,fs)-Math.min.apply(null,fs):0; })(),
      sounding: v && v.strings.filter(s=>s.fret!=null).length };
  });
  assert('algo returns a voicing', t3.ok, t3);
  assert('algo notes are all chord tones', t3.ok && t3.pcs.filter(p=>p!=null).every(p=>[0,2,4,7].includes(p)), t3.pcs);
  assert('algo span <= 4 frets', t3.span <= 4, t3.span);
  assert('algo sounds >= 3 strings', t3.sounding >= 3, t3.sounding);

  const t4 = await page.evaluate(() => {
    var p = _fbParseChord('C'); // rootPc 0, third 4 (E), fifth 7 (G)
    var v = _fbBassVoicing(p.pcs, p.rootPc, p.thirdPc, p.fifthPc);
    var labels = v ? v.strings.map(s=>s.label).filter(Boolean) : [];
    return { ok: !!v, labels: labels, hasR: labels.indexOf('R')>=0 };
  });
  assert('bass returns a voicing', t4.ok, t4);
  assert('bass marks the root (R)', t4.hasR, t4.labels);
  assert('bass labels are subset of R/3/5', t4.labels.every(l=>['R','3','5'].includes(l)), t4.labels);

  const t5 = await page.evaluate(() => {
    // strings high->low; frets: open, open, open, f2, f3, mute  (C major-ish)
    var strings = [{fret:0,label:null},{fret:1,label:null},{fret:0,label:null},
                   {fret:2,label:null},{fret:3,label:null},{fret:null,label:null}];
    _fbAssignFingers(strings);
    return strings.map(s=>s.label);
  });
  // strings high->low: open, f1, open, f2, f3, mute -> labels null,"1",null,"2","3",null
  assert('fingers ascend by fret', JSON.stringify(t5) === JSON.stringify([null,"1",null,"2","3",null]), t5);

  const t6 = await page.evaluate(() => ({
    cOpen:  fbGetVoicing('guitar', 'C'),
    cmaj7:  fbGetVoicing('guitar', 'Cmaj7'),
    m7b5:   fbGetVoicing('guitar', 'Bm7b5'),
    bassC:  fbGetVoicing('bass', 'C'),
    junk:   fbGetVoicing('guitar', 'H'),
  }));
  assert('orch C open -> baseFret 0', t6.cOpen && t6.cOpen.baseFret === 0, t6.cOpen);
  assert('orch C has finger labels', t6.cOpen && t6.cOpen.strings.some(s=>s.label && '1234'.includes(s.label)), t6.cOpen);
  assert('orch Cmaj7 non-empty', t6.cmaj7 && t6.cmaj7.strings.some(s=>s.fret!=null), t6.cmaj7);
  assert('orch m7b5 (algo) non-empty', t6.m7b5 && t6.m7b5.strings.some(s=>s.fret!=null), t6.m7b5);
  assert('orch bass has R label', t6.bassC && t6.bassC.strings.some(s=>s.label==='R'), t6.bassC);
  assert('orch junk -> empty model', t6.junk && t6.junk.empty === true, t6.junk);

  // === DOM ASSERTIONS ===
  await page.evaluate(() => { signInAsGuest && signInAsGuest(); });
  await page.waitForTimeout(300);
  const d7 = await page.evaluate(() => {
    fkbInit(); fkbShow();
    var sec = document.getElementById('fkbFretboard');
    var btns = document.querySelectorAll('#fbSeg button[data-fbi]');
    var def = (function(){ try { return localStorage.getItem('drafthaus-fb-instrument'); } catch(e){ return null; } })();
    fbSetInstrument('bass');
    var bassDef = (function(){ try { return localStorage.getItem('drafthaus-fb-instrument'); } catch(e){ return null; } })();
    fbSetInstrument('guitar');
    return { hasSec: !!sec, nBtns: btns.length, def: def, bassDef: bassDef,
             insideePanel: !!(sec && sec.closest('#fkbPanel')) };
  });
  assert('fretboard section exists', d7.hasSec, d7);
  assert('section is inside #fkbPanel', d7.insideePanel, d7);
  assert('three instrument buttons', d7.nBtns === 3, d7.nBtns);
  assert('default instrument guitar', (d7.def === null || d7.def === 'guitar'), d7.def);
  assert('toggle persists to localStorage', d7.bassDef === 'bass', d7.bassDef);

  console.log(`\n${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
