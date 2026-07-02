// UI verification for the lite-1.073 iOS-native restyle (additive to _verify_lite_1073.js).
// Covers: A screen transitions, B icon unification, C mobile bottom sheets,
// D PWA head tags/manifest/icons, E landing restyle, F1 --border fix.
const { chromium } = require('playwright-core');
const path = require('path'); const http = require('http'); const fs = require('fs');
const FILE = 'lite-1.073.html';
function startServer(){return new Promise(r=>{const s=http.createServer((q,res)=>{const f=path.join(__dirname,decodeURIComponent(q.url.split('?')[0]));fs.readFile(f,(e,b)=>{if(e){res.writeHead(404);res.end('nf');return;}res.writeHead(200,{'Content-Type':f.endsWith('.html')?'text/html':'application/octet-stream'});res.end(b);});});s.listen(0,'127.0.0.1',()=>r({s,port:s.address().port}));});}
let pass=0, fail=0;
function ok(c,msg){ if(c){pass++;console.log('PASS',msg);} else {fail++;console.log('FAIL',msg);} }

(async()=>{
const {s,port}=await startServer();
const b=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});

async function boot(opts={}){
  const ctx=await b.newContext(Object.assign({viewport:{width:390,height:844},hasTouch:true,isMobile:true},opts));
  const p=await ctx.newPage();
  await p.goto(`http://127.0.0.1:${port}/${FILE}`,{waitUntil:'load'});
  return {ctx,p};
}
async function signIn(p){
  await p.click('.auth-btn.ghost'); await p.waitForSelector('body.signed-in',{timeout:15000});
  await p.evaluate(()=>{ _songs=[{id:'S1',title:'A song',key:'C major'}]; renderSongList(); });
}

/* ── A: screen push/pop transitions ── */
{
  const {ctx,p}=await boot();
  await signIn(p);
  await p.evaluate(()=>{ _openSongObj({id:'S1',title:'A song',lyricsDoc:'<div>hi</div>'}); stopTakesListener(); });
  const mid = await p.evaluate(()=>{
    const top=document.querySelector('.screen.nav-top');
    return { hasTop: !!top, transform: top?getComputedStyle(top).transform:null,
             actives: document.querySelectorAll('.screen.active').length };
  });
  ok(mid.hasTop && mid.actives===2 && mid.transform && mid.transform!=='none', 'A: mid-flight push has fixed top screen with transform, dual .active');
  await p.waitForTimeout(600);
  const end = await p.evaluate(()=>({
    actives: document.querySelectorAll('.screen.active').length,
    id: document.querySelector('.screen.active').id,
    residue: document.querySelectorAll('.nav-top,.nav-under,.nav-offR,.nav-offL,.nav-dim0').length,
    anim: document.body.classList.contains('nav-animating') }));
  ok(end.actives===1 && end.id==='screen-song' && end.residue===0 && !end.anim, 'A: settle = one active screen, zero residue');
  await p.evaluate(()=>{ openQuickChords(); openFindChord(); });   // rapid taps
  await p.waitForTimeout(700);
  const rapid = await p.evaluate(()=>({ actives:document.querySelectorAll('.screen.active').length,
    id:document.querySelector('.screen.active').id,
    residue:document.querySelectorAll('.nav-top,.nav-under,.nav-offR,.nav-offL,.nav-dim0').length }));
  ok(rapid.actives===1 && rapid.id==='screen-fc' && rapid.residue===0, 'A: rapid double-nav settles clean on final screen');
  await p.evaluate(()=>{ const inp=document.getElementById('chordEntry'); window._ceVisible = inp && inp.style.display!=='none'; });
  ok(await p.evaluate(()=>!window._ceVisible), 'A: #chordEntry (only fixed-in-screen element) hidden during nav');
  await ctx.close();
}
{ // reduced motion
  const {ctx,p}=await boot({reducedMotion:'reduce'});
  await signIn(p);
  const r = await p.evaluate(()=>{
    _openSongObj({id:'S1',title:'A song'}); stopTakesListener();
    return { id:document.querySelector('.screen.active').id, actives:document.querySelectorAll('.screen.active').length,
             residue:document.querySelectorAll('.nav-top,.nav-under').length };
  });
  ok(r.id==='screen-song' && r.actives===1 && r.residue===0, 'A: prefers-reduced-motion swaps synchronously');
  await ctx.close();
}
{ // landing chord-preview path stays instant + round-trips
  const {ctx,p}=await boot();
  const r1 = await p.evaluate(()=>{ openChordToolFromLanding('qc');
    return { id:document.querySelector('.screen.active').id, residue:document.querySelectorAll('.nav-top,.nav-under').length }; });
  const r2 = await p.evaluate(()=>{ chordToolBack();
    return { id:document.querySelector('.screen.active').id, preview:document.body.classList.contains('chord-preview') }; });
  ok(r1.id==='screen-qc' && r1.residue===0 && r2.id==='screen-songlist' && !r2.preview, 'A: landing preview open/back is instant and resets the shell');
  await ctx.close();
}

/* ── B: icon unification ── */
{
  const {ctx,p}=await boot();
  await signIn(p);
  await p.evaluate(()=>{
    _songs=[{id:'S1',title:'Pinned song',pinned:true},{id:'S2',title:'Plain song'}]; renderSongList();
    _openSongObj({id:'S1',title:'Pinned song'}); stopTakesListener();
    _takes=[{id:'T1',name:'Take 1'},{id:'T2',name:'Take 2',pinned:true}]; renderTakes(); updateRail();
  });
  await p.waitForTimeout(500);
  const noEmoji = await p.evaluate(()=>{
    const rx=/[\u{1F3B5}\u{1F3B8}\u{1F50D}\u{1F319}\u{1F4CC}\u{26A1}\u{1F5D1}\u{1F517}☀️]/u;
    return !rx.test(document.getElementById('app').innerText);
  });
  ok(noEmoji, 'B: no emoji glyphs anywhere in the rendered app shell');
  ok(await p.evaluate(()=>!!document.querySelector('#playBtn svg.ic')), 'B: rail play button is an SVG icon');
  ok(await p.evaluate(()=>!!document.querySelector('.take-card .play svg.ic')), 'B: take-row play button is an SVG icon');
  ok(await p.evaluate(()=>!!document.querySelector('#themeToggleBtn svg.ic')), 'B: theme toggle is an SVG icon');
  ok(await p.evaluate(()=>{ toggleTheme(); return !!document.querySelector('#themeToggleBtn svg.ic'); }), 'B: theme toggle keeps SVG after toggling (innerHTML update path)');
  await ctx.close();
}

/* ── C: mobile bottom sheets vs desktop anchored ── */
{
  const {ctx,p}=await boot();   // mobile
  await signIn(p);
  await p.evaluate(()=>{ _openSongObj({id:'S1',title:'A song'}); stopTakesListener(); openChordPop('Am', null, true); });
  await p.waitForTimeout(450);
  const cp = await p.evaluate(()=>{ const r=document.getElementById('chordPop').getBoundingClientRect(); return {bottom:r.bottom, left:r.left, w:r.width, ih:innerHeight, iw:innerWidth}; });
  ok(Math.abs(cp.bottom-cp.ih)<2 && cp.left<2 && Math.abs(cp.w-cp.iw)<4, 'C: chordPop is a full-width bottom sheet on touch');
  await p.evaluate(()=>{ closeChordPop();
    _takes=[{id:'T1',name:'Take 1'}]; renderTakes();
    _shareTrays=[{id:'TR1',name:'Demos',takeIds:[],ownerId:'x'}];
    openTrayPicker('T1', document.querySelector('.take-card')||document.body); });
  await p.waitForTimeout(450);
  const tp = await p.evaluate(()=>{ const r=document.querySelector('.tray-picker').getBoundingClientRect(); return {bottom:r.bottom, left:r.left, w:r.width, ih:innerHeight, iw:innerWidth}; });
  ok(Math.abs(tp.bottom-tp.ih)<2 && tp.left<2 && Math.abs(tp.w-tp.iw)<4, 'C: tray picker is a full-width bottom sheet on touch');
  await ctx.close();
  const ctxD=await b.newContext({viewport:{width:1280,height:800}});
  const pd=await ctxD.newPage();
  await pd.goto(`http://127.0.0.1:${port}/${FILE}`,{waitUntil:'load'});
  await pd.click('.auth-btn.ghost'); await pd.waitForSelector('body.signed-in',{timeout:15000});
  await pd.evaluate(()=>{ _openSongObj({id:'S1',title:'A song'}); stopTakesListener(); openChordPop('Am', null, true); });
  await pd.waitForTimeout(300);
  const cpd = await pd.evaluate(()=>{ const r=document.getElementById('chordPop').getBoundingClientRect(); return {w:r.width, bottom:r.bottom, ih:innerHeight}; });
  ok(Math.round(cpd.w)===260 && cpd.bottom<cpd.ih-20, 'C: chordPop stays a 260px anchored card on desktop');
  await ctxD.close();
}

/* ── D: PWA head tags + assets ── */
{
  const {ctx,p}=await boot();
  const head = await p.evaluate(()=>({
    manifest: !!document.querySelector('link[rel="manifest"][href="/lite.webmanifest"]'),
    touchIcon: !!document.querySelector('link[rel="apple-touch-icon"][href="/lite-icon-180.png"]'),
    favicon: !!document.querySelector('link[rel="icon"]'),
    statusBar: (document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]')||{}).content,
  }));
  ok(head.manifest && head.touchIcon && head.favicon, 'D: manifest + apple-touch-icon + favicon links present');
  ok(head.statusBar==='black-translucent', 'D: status bar is black-translucent');
  const mf = JSON.parse(fs.readFileSync(path.join(__dirname,'lite.webmanifest'),'utf8'));
  ok(mf.start_url==='/' && mf.display==='standalone' && mf.icons.length===2, 'D: manifest parses with start_url:/ display:standalone + 2 icons');
  ok([180,192,512].every(sz=>fs.existsSync(path.join(__dirname,`lite-icon-${sz}.png`))), 'D: all three icon PNGs exist');
  await ctx.close();
}

/* ── E: landing restyle ── */
{
  const {ctx,p}=await boot();
  const e = await p.evaluate(()=>{
    const cs=getComputedStyle(document.getElementById('landing'));
    return { bgImage: cs.backgroundImage, bg: cs.backgroundColor };
  });
  ok(e.bgImage==='none', 'E: landing gradient removed (system background)');
  ok(await p.evaluate(()=>!!document.querySelector('#landing .ltool-btn svg.ic')), 'E: landing tool buttons use SVG icons');
  await ctx.close();
}

/* ── F1: --border fix ── */
{
  const {ctx,p}=await boot();
  const src = fs.readFileSync(path.join(__dirname,FILE),'utf8');
  ok(!src.includes('var(--border)'), 'F1: no undefined var(--border) remains');
  await ctx.close();
}

await b.close(); s.close();
console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail?1:0);
})().catch(e=>{ console.error(e); process.exit(1); });
