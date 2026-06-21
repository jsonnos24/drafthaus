// _verify_lite_1069.js — takes panel covers only the right half on desktop (≥768px),
// stays full-width on narrow (<768px); left-half lyrics remain visible + editable while open.
const { chromium } = require('playwright-core');
const http = require('http'); const fs = require('fs'); const path = require('path');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ROOT = __dirname;
let PASS = 0, FAIL = 0;
const ok = (c, m) => { if (c) { PASS++; console.log('PASS', m); } else { FAIL++; console.log('FAIL', m); } };

function serve() {
  return new Promise(res => {
    const s = http.createServer((req, rq) => {
      let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/lite-1.069.html';
      const fp = path.join(ROOT, p);
      fs.readFile(fp, (e, d) => {
        if (e) { rq.statusCode = 404; rq.end('nf'); return; }
        const ext = path.extname(fp);
        rq.setHeader('Content-Type', ext === '.html' ? 'text/html' : ext === '.js' ? 'text/javascript' : 'application/octet-stream');
        rq.end(d);
      });
    });
    s.listen(0, () => res(s));
  });
}

async function guestIn(page) {
  for (let i = 0; i < 2; i++) {
    try { await page.click('.auth-card .auth-btn.ghost'); await page.waitForSelector('body.signed-in', { timeout: 20000 }); return true; }
    catch (e) { if (i === 1) return false; await page.waitForTimeout(1000); }
  }
}

// Open a song so the takes panel exists, open the panel, and measure geometry.
async function measure(page) {
  await page.evaluate(() => { _openSongObj({ id: 'geomsong', title: 'verify-1069', key: 'C major', lyricsDoc: '<div>Hello world line</div>' }); try { stopTakesListener(); } catch (e) {} });
  await page.waitForTimeout(150);
  // ensure open
  await page.evaluate(() => { const p = document.getElementById('takesPanel'); if (p && !p.classList.contains('open')) toggleTakes(); });
  await page.waitForTimeout(350); // allow .26s slide transition
  return await page.evaluate(() => {
    const panel = document.getElementById('takesPanel');
    const body = panel ? panel.parentElement : null; // .song-body
    const pr = panel.getBoundingClientRect();
    const br = body.getBoundingClientRect();
    return { panelLeft: pr.left, panelRight: pr.right, panelWidth: pr.width, bodyLeft: br.left, bodyRight: br.right, bodyWidth: br.width, vw: window.innerWidth };
  });
}

(async () => {
  const srv = await serve(); const port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });

  // ── Desktop: 1200px wide → panel should start near the body midpoint ──
  {
    const ctx = await browser.newContext({ viewport: { width: 1200, height: 850 } });
    await ctx.addInitScript(() => { try { localStorage['drafthaus-eula-accepted'] = '1'; } catch (e) {} });
    const pg = await ctx.newPage();
    await pg.goto(`http://localhost:${port}/lite-1.069.html`, { waitUntil: 'domcontentloaded' });
    await pg.waitForFunction(() => typeof window.toggleTakes === 'function', { timeout: 10000 });
    const signed = await guestIn(pg);
    if (signed) {
      const g = await measure(pg);
      const mid = g.bodyLeft + g.bodyWidth / 2;
      // open panel left edge should be ~halfway across the body (within 40px tolerance)
      ok(Math.abs(g.panelLeft - mid) < 40, `desktop: open panel starts at body midpoint (panelLeft=${g.panelLeft.toFixed(0)} mid=${mid.toFixed(0)})`);
      // panel should be roughly half the body width (minus the 52px rail) — between 35% and 55%
      const frac = g.panelWidth / g.bodyWidth;
      ok(frac > 0.35 && frac < 0.55, `desktop: open panel ~half body width (frac=${frac.toFixed(2)})`);
      // left half (left of panel) is non-trivial space for lyrics
      ok((g.panelLeft - g.bodyLeft) > g.bodyWidth * 0.4, `desktop: left half free for lyrics (free=${(g.panelLeft - g.bodyLeft).toFixed(0)})`);

      // lyrics editor on the left half is visible + editable while panel is open
      const editable = await pg.evaluate(() => {
        const ed = document.getElementById('lyricsEditor');
        if (!ed) return { ok: false };
        const r = ed.getBoundingClientRect();
        const panelLeft = document.getElementById('takesPanel').getBoundingClientRect().left;
        ed.focus();
        const focused = document.activeElement === ed;
        const ce = ed.isContentEditable;
        // is there visible editor area to the LEFT of the panel?
        const leftVisible = r.left < panelLeft - 50;
        return { ok: focused && ce && leftVisible, focused, ce, leftVisible };
      });
      ok(editable.ok, `desktop: lyrics editor focusable + editable, visible left of panel (${JSON.stringify(editable)})`);

      // closed state fully hidden (panel right edge ≥ body right edge → off screen / behind rail)
      await pg.evaluate(() => { const p = document.getElementById('takesPanel'); if (p.classList.contains('open')) toggleTakes(); });
      await pg.waitForTimeout(350);
      const closed = await pg.evaluate(() => { const r = document.getElementById('takesPanel').getBoundingClientRect(); return { left: r.left, vw: window.innerWidth }; });
      ok(closed.left >= closed.vw - 2, `desktop: closed panel fully off-screen (left=${closed.left.toFixed(0)} vw=${closed.vw})`);
    } else { console.log('SKIP desktop (guest auth unavailable)'); }
    await pg.close(); await ctx.close();
  }

  // ── Narrow: 500px wide → panel should still cover the (near) full body ──
  {
    const ctx = await browser.newContext({ viewport: { width: 500, height: 850 } });
    await ctx.addInitScript(() => { try { localStorage['drafthaus-eula-accepted'] = '1'; } catch (e) {} });
    const pg = await ctx.newPage();
    await pg.goto(`http://localhost:${port}/lite-1.069.html`, { waitUntil: 'domcontentloaded' });
    await pg.waitForFunction(() => typeof window.toggleTakes === 'function', { timeout: 10000 });
    const signed = await guestIn(pg);
    if (signed) {
      const g = await measure(pg);
      const frac = g.panelWidth / g.bodyWidth;
      ok(frac > 0.85, `narrow: open panel covers ~full body width (frac=${frac.toFixed(2)})`);
      ok(Math.abs(g.panelLeft - g.bodyLeft) < 6, `narrow: open panel starts at body left edge (panelLeft=${g.panelLeft.toFixed(0)} bodyLeft=${g.bodyLeft.toFixed(0)})`);
    } else { console.log('SKIP narrow (guest auth unavailable)'); }
    await pg.close(); await ctx.close();
  }

  console.log(`\n${PASS} PASS / ${FAIL} FAIL`);
  await browser.close(); srv.close();
  process.exit(FAIL ? 1 : 0);
})();
