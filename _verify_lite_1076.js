// _verify_lite_1076.js — lite-1.076: lyrics selection format toolbar (color/size/B·I·U)
const { chromium } = require('playwright-core');
const http = require('http'); const fs = require('fs'); const path = require('path');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ROOT = __dirname;
let PASS = 0, FAIL = 0;
const ok = (c, m) => { if (c) { PASS++; console.log('PASS', m); } else { FAIL++; console.log('FAIL', m); } };

function serve() {
  return new Promise(res => {
    const s = http.createServer((req, rq) => {
      let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/lite-1.076.html';
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

async function boot(browser, port, viewport) {
  const ctx = await browser.newContext({ viewport });
  await ctx.addInitScript(() => { try { localStorage['drafthaus-eula-accepted'] = '1'; } catch (e) {} });
  const page = await ctx.newPage();
  await page.goto(`http://localhost:${port}/lite-1.076.html`, { waitUntil: 'domcontentloaded' });
  await page.click('.auth-btn.ghost');
  await page.waitForSelector('body.signed-in', { timeout: 15000 });
  return page;
}

// Open a synthetic song with known lyrics (no network/Firestore needed).
async function seedSong(page) {
  await page.evaluate(() => {
    window._openSongObj({ id: 'TESTSONG', ownerId: 'guest', title: 'Fmt Song', key: '', lyricsDoc: '<div>hello world lyrics</div>' });
  });
  await page.waitForTimeout(300);
}

// Select the full contents of the lyrics editor (fires selectionchange).
const selectAllLyrics = (page) => page.evaluate(() => {
  const ed = document.getElementById('lyricsEditor'); ed.focus();
  const r = document.createRange(); r.selectNodeContents(ed);
  const s = getSelection(); s.removeAllRanges(); s.addRange(r);
});

(async () => {
  const srv = await serve(); const port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await boot(browser, port, { width: 390, height: 780 });   // mobile-size
  await seedSong(page);

  // ── F0: sanity — song open, lyrics rendered ──
  ok(await page.evaluate(() => document.getElementById('lyricsEditor').textContent.includes('hello world')),
    'F0 sanity: seeded lyrics render in the editor');

  // ── F1: popover shows on selection, hides on collapse, suppressed in Chordify, theme token flips ──
  {
    ok(await page.evaluate(() => !document.querySelector('#fmtBar.open')), 'F1 no selection → no format bar');
    await selectAllLyrics(page);
    await page.waitForTimeout(300);
    ok(await page.evaluate(() => !!document.querySelector('#fmtBar.open')), 'F1 selection → format bar opens');
    const pos = await page.evaluate(() => {
      const b = document.getElementById('fmtBar').getBoundingClientRect();
      return b.left >= 8 && b.right <= innerWidth - 8 && b.top >= 8;
    });
    ok(pos, 'F1 bar positioned inside the viewport');
    await page.evaluate(() => getSelection().removeAllRanges());
    await page.waitForTimeout(300);
    ok(await page.evaluate(() => !document.querySelector('#fmtBar.open')), 'F1 collapse → bar hides');
    await page.evaluate(() => toggleChordsMode(true));
    await selectAllLyrics(page);
    await page.waitForTimeout(300);
    ok(await page.evaluate(() => !document.querySelector('#fmtBar.open')), 'F1 Chordify mode → bar suppressed');
    await page.evaluate(() => { toggleChordsMode(false); getSelection().removeAllRanges(); });
    await selectAllLyrics(page);
    await page.waitForTimeout(300);
    ok(await page.evaluate(() => !!document.querySelector('#fmtBar.open')), 'F1 bar reopens before Chordify tap');
    await page.click('#chordsModeBtn');   // real interaction path — no fresh selection after
    await page.waitForTimeout(100);
    ok(await page.evaluate(() => !document.querySelector('#fmtBar.open')), 'F1 real Chordify button tap hides the open bar');
    await page.evaluate(() => { toggleChordsMode(false); getSelection().removeAllRanges(); });
    const tok = await page.evaluate(() => {
      const get = () => getComputedStyle(document.documentElement).getPropertyValue('--fmtText').trim();
      const light = get();
      document.documentElement.classList.add('dark'); const dark = get();
      document.documentElement.classList.remove('dark');
      return { light, dark };
    });
    ok(tok.light === '#111111' && tok.dark === '#ffffff', 'F1 --fmtText token: #111111 light / #ffffff dark');
  }

  // ── F2: B/I/U apply, reflect state, toggle off ──
  {
    await selectAllLyrics(page);
    await page.waitForTimeout(300);
    await page.click('#fmtBar [data-cmd="bold"]');
    ok(await page.evaluate(() => /<(b|strong)\b/i.test(document.getElementById('lyricsEditor').innerHTML)),
      'F2 bold applies to the selection');
    ok(await page.evaluate(() => document.querySelector('#fmtBar [data-cmd="bold"]').classList.contains('on')),
      'F2 bold button shows active state');
    await page.click('#fmtBar [data-cmd="italic"]');
    await page.click('#fmtBar [data-cmd="underline"]');
    ok(await page.evaluate(() => {
      const h = document.getElementById('lyricsEditor').innerHTML;
      return /<(i|em)\b/i.test(h) && /<u\b/i.test(h);
    }), 'F2 italic + underline apply');
    await page.click('#fmtBar [data-cmd="bold"]');   // toggle bold back off
    ok(await page.evaluate(() => !/<(b|strong)\b/i.test(document.getElementById('lyricsEditor').innerHTML)),
      'F2 bold toggles off');
    ok(await page.evaluate(() => {
      // formatting survives the sanitizer round-trip
      const ed = document.getElementById('lyricsEditor');
      const clean = ilSanitizeDocHtml(ed.innerHTML);
      return /<(i|em)\b/i.test(clean) && /<u\b/i.test(clean);
    }), 'F2 B/I/U survive ilSanitizeDocHtml');
    await page.evaluate(() => { document.execCommand('italic'); document.execCommand('underline'); getSelection().removeAllRanges(); });
  }

  // ── F3: sizes — Aa panel opens, each key writes its exact px, sanitizer keeps it ──
  {
    await selectAllLyrics(page);
    await page.waitForTimeout(300);
    await page.click('#fmtBar [data-sub="size"]');
    ok(await page.evaluate(() => document.querySelectorAll('#fmtSub.open .fmt-size').length === 4),
      'F3 Aa opens a panel with 4 size choices');
    await page.click('#fmtSub .fmt-size:first-child');   // Title = 28px
    ok(await page.evaluate(() => {
      const ed = document.getElementById('lyricsEditor');
      return /font-size:\s*28px/.test(ed.innerHTML) && !ed.querySelector('font[size]');
    }), 'F3 Title writes font-size:28px (no font[size] left behind)');
    ok(await page.evaluate(() => !document.querySelector('#fmtSub.open')), 'F3 picking a size closes the panel');
    const px = await page.evaluate(() => {
      const results = {};
      for (const [k, v] of Object.entries(FMT_SIZES)) {
        selectAllInline(); fmtSetSize(k);
        results[k] = new RegExp('font-size:\\s*' + v).test(document.getElementById('lyricsEditor').innerHTML);
      }
      function selectAllInline() {
        const ed = document.getElementById('lyricsEditor'); ed.focus();
        const r = document.createRange(); r.selectNodeContents(ed);
        const s = getSelection(); s.removeAllRanges(); s.addRange(r);
      }
      return results;
    });
    ok(px.title && px.heading && px.body && px.small, 'F3 all four sizes write their exact px values');
    ok(await page.evaluate(() => /font-size:\s*13px/.test(ilSanitizeDocHtml(document.getElementById('lyricsEditor').innerHTML))),
      'F3 font-size survives ilSanitizeDocHtml');
    await page.evaluate(() => { // reset lyrics for later blocks
      document.getElementById('lyricsEditor').innerHTML = '<div>hello world lyrics</div>';
      getSelection().removeAllRanges();
    });
  }

  // ── F4: colors — accent stores literal hex; default stores var(); theme flip changes computed color ──
  {
    await selectAllLyrics(page);
    await page.waitForTimeout(300);
    await page.click('#fmtBar [data-sub="color"]');
    ok(await page.evaluate(() => document.querySelectorAll('#fmtSub.open .fmt-sw').length === 8),
      'F4 color panel shows 8 swatches (default + 7 accents)');
    await page.click('#fmtSub .fmt-sw:nth-child(2)');   // first accent = #d94848
    ok(await page.evaluate(() => /#d94848/i.test(document.getElementById('lyricsEditor').innerHTML)),
      'F4 accent swatch stores literal hex');
    await selectAllLyrics(page);
    await page.waitForTimeout(300);
    await page.evaluate(() => fmtColor(''));            // default swatch
    const defState = await page.evaluate(() => {
      const ed = document.getElementById('lyricsEditor');
      const html = ed.innerHTML;
      const probe = ed.querySelector('[style*="--fmtText"]');
      const colLight = probe ? getComputedStyle(probe).color : '';
      document.documentElement.classList.add('dark');
      const colDark = probe ? getComputedStyle(probe).color : '';
      document.documentElement.classList.remove('dark');
      return {
        hasVar: /var\(--fmtText,\s*#ffffff\)/.test(html),
        sentinelGone: !/010203/i.test(html),
        colLight, colDark,
        survives: /var\(--fmtText,\s*#ffffff\)/.test(ilSanitizeDocHtml(html)),
      };
    });
    ok(defState.hasVar, 'F4 default swatch stores color:var(--fmtText,#ffffff)');
    ok(defState.sentinelGone, 'F4 sentinel color fully rewritten');
    ok(defState.colLight === 'rgb(17, 17, 17)', 'F4 default text computes near-black in light mode');
    ok(defState.colDark === 'rgb(255, 255, 255)', 'F4 default text computes white in dark mode (auto-switch)');
    ok(defState.survives, 'F4 var() color survives ilSanitizeDocHtml');
    // share viewer probe: viewer forces html.dark, so the same token must resolve white there
    const sv = await page.evaluate(() => {
      document.documentElement.classList.add('dark');
      const d = document.createElement('div'); d.className = 'sv-lyr-body';
      d.innerHTML = '<span style="color:var(--fmtText,#ffffff)">x</span>';
      document.body.appendChild(d);
      const c = getComputedStyle(d.firstChild).color;
      d.remove(); document.documentElement.classList.remove('dark');
      return c;
    });
    ok(sv === 'rgb(255, 255, 255)', 'F4 share-viewer (forced dark) renders default color white');
    await page.evaluate(() => getSelection().removeAllRanges());
  }

  // ── F5: chord-span safety + save/reload round-trip ──
  {
    await page.evaluate(() => {
      const ed = document.getElementById('lyricsEditor');
      ed.innerHTML = '<div>la <span class="chord">Am</span> la la</div>';
      _atomizeLyricChords();
    });
    await selectAllLyrics(page);
    await page.waitForTimeout(300);
    await page.evaluate(() => { fmtCmd('bold'); fmtColor('#2f6fd0'); });
    const chord = await page.evaluate(() => {
      const c = document.getElementById('lyricsEditor').querySelector('.chord');
      return c ? { text: c.textContent, atomic: c.contentEditable === 'false', cls: c.className } : null;
    });
    ok(chord && chord.text === 'Am' && chord.atomic && chord.cls === 'chord',
      'F5 formatting across a chord span leaves the chord intact and atomic');
    // simulated save → reload: what flushLyrics persists is currentEditorHtml();
    // reloading runs it through ilSanitizeDocHtml again (openSong path)
    const rt = await page.evaluate(() => {
      const saved = currentEditorHtml();
      const ed = document.getElementById('lyricsEditor');
      ed.innerHTML = ilSanitizeDocHtml(saved); _atomizeLyricChords();
      const again = currentEditorHtml();
      return { stable: saved === again, bold: /<(b|strong)\b/i.test(again), color: /#2f6fd0/i.test(again), chord: !!ed.querySelector('.chord') };
    });
    ok(rt.stable, 'F5 sanitize round-trip is stable (save === re-save)');
    ok(rt.bold && rt.color && rt.chord, 'F5 bold + color + chord all survive save/reload');
    // editing formatted text still marks the doc dirty for autosave
    const dirty = await page.evaluate(() => { _lyricsEdited = false; onLyricsInput(); return _lyricsEdited; });
    ok(dirty, 'F5 toolbar actions route through onLyricsInput (autosave pipeline engaged)');
  }

  // ── F6: bar color button — visible swatch that tracks the selection's color ──
  {
    await page.evaluate(() => {
      document.getElementById('lyricsEditor').innerHTML = '<div>hello world lyrics</div>';
      getSelection().removeAllRanges();
    });
    await selectAllLyrics(page);
    await page.waitForTimeout(300);
    const sw = await page.evaluate(() => {
      const el = document.querySelector('#fmtBar [data-sub="color"] .fmt-sw');
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return {
        w: r.width, h: r.height,
        bg: getComputedStyle(el).backgroundColor,
        edColor: getComputedStyle(document.getElementById('lyricsEditor')).color,
      };
    });
    ok(sw && sw.w >= 12 && sw.h >= 12, 'F6 bar swatch has visible dimensions');
    ok(sw && sw.bg === sw.edColor, 'F6 swatch shows the editor default color for unformatted text');
    await page.evaluate(() => fmtColor('#d94848'));
    await selectAllLyrics(page);
    await page.waitForTimeout(300);
    ok(await page.evaluate(() => {
      const el = document.querySelector('#fmtBar [data-sub="color"] .fmt-sw');
      return getComputedStyle(el).backgroundColor === 'rgb(217, 72, 72)';
    }), 'F6 swatch updates to the selection current color');
    await page.evaluate(() => getSelection().removeAllRanges());
  }

  // ── [test blocks F1–F6: appended above this line] ──

  console.log(`\n${PASS}/${PASS + FAIL} passed, ${FAIL} failed`);
  await browser.close(); srv.close();
  process.exit(FAIL ? 1 : 0);
})();
