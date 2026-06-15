const { chromium } = require('playwright-core');
const path = require('path'); const http = require('http'); const fs = require('fs');
function startServer(){return new Promise(r=>{const s=http.createServer((q,res)=>{const f=path.join(__dirname,decodeURIComponent(q.url.split('?')[0]));fs.readFile(f,(e,b)=>{if(e){res.writeHead(404);res.end('nf');return;}res.writeHead(200,{'Content-Type':f.endsWith('.html')?'text/html':'application/octet-stream'});res.end(b);});});s.listen(0,'127.0.0.1',()=>r({s,port:s.address().port}));});}
(async()=>{const{s,port}=await startServer();
const b=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const p=await(await b.newContext({viewport:{width:390,height:740},hasTouch:true,isMobile:true,deviceScaleFactor:2})).newPage();
await p.goto(`http://127.0.0.1:${port}/lite-1.042.html`,{waitUntil:'load'});
await p.click('.auth-btn.ghost'); await p.waitForSelector('body.signed-in',{timeout:15000});
await p.evaluate(()=>{_openSongObj({id:'S',title:'My Song',key:'C major',lyricsDoc:'<div>I walked the <span class="chord" contenteditable="false">G</span>line for you</div>'});stopTakesListener();toggleChordsMode();});
await p.waitForTimeout(180);
await p.screenshot({path:'_shot_rail.png'});
await b.close(); s.close(); console.log('shot done');
})();
