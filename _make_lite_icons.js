// One-shot generator for the Drafthaus Lite home-screen icons (lite-1.073).
// Renders a canvas in headless Chrome (same playwright-core + installed-Chrome
// tooling the verify scripts use) and writes lite-icon-180/192/512.png.
// Full-bleed iOS-blue gradient + white note mark; square corners (iOS masks it).
const { chromium } = require('playwright-core');
const fs = require('fs');

(async () => {
  const b = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
  const p = await (await b.newContext()).newPage();
  for (const size of [180, 192, 512]) {
    const dataUrl = await p.evaluate((S) => {
      const c = document.createElement('canvas'); c.width = S; c.height = S;
      const x = c.getContext('2d');
      // Background: iOS-blue diagonal gradient, full bleed.
      const g = x.createLinearGradient(0, 0, S, S);
      g.addColorStop(0, '#0a84ff'); g.addColorStop(1, '#0060df');
      x.fillStyle = g; x.fillRect(0, 0, S, S);
      // Beamed eighth-note mark (matches the app's IC.note geometry), white.
      const u = S / 24;                       // 24-unit grid like the app icons
      x.strokeStyle = '#fff'; x.fillStyle = '#fff';
      x.lineWidth = 1.9 * u; x.lineCap = 'round'; x.lineJoin = 'round';
      x.beginPath(); x.moveTo(9.5 * u, 17.5 * u); x.lineTo(9.5 * u, 5.5 * u);
      x.lineTo(20 * u, 3.8 * u); x.lineTo(20 * u, 15.5 * u); x.stroke();
      x.beginPath(); x.arc(7 * u, 17.5 * u, 2.6 * u, 0, 7); x.fill();
      x.beginPath(); x.arc(17.5 * u, 15.5 * u, 2.6 * u, 0, 7); x.fill();
      return c.toDataURL('image/png');
    }, size);
    fs.writeFileSync(`lite-icon-${size}.png`, Buffer.from(dataUrl.split(',')[1], 'base64'));
    console.log(`lite-icon-${size}.png written`);
  }
  await b.close();
})();
