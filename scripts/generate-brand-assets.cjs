// Renders the PNG brand assets (favicons, app icons, social preview images) from the SVG
// mark and the self-hosted fonts. Requires Playwright with Chromium:
//   node scripts/generate-brand-assets.cjs
const { chromium } = require('playwright');
const path = require('node:path');
const fs = require('node:fs');

const pub = path.join(__dirname, '..', 'apps', 'server', 'src', 'public');
const out = path.join(pub, 'brand');
// Embed fonts as data URLs: pages rendered with setContent() cannot load file:// URLs.
const font = (f) => 'data:font/woff2;base64,' + fs.readFileSync(path.join(pub, 'fonts', f)).toString('base64');
const logo = fs.readFileSync(path.join(pub, 'logo.svg'), 'utf8');

const fontFaces = `
@font-face { font-family: 'Bricolage Grotesque'; font-weight: 200 800; src: url(${font('bricolage-grotesque-latin-opsz-normal.woff2')}) format('woff2'); }
@font-face { font-family: 'IBM Plex Sans'; font-weight: 100 700; src: url(${font('ibm-plex-sans-latin-wght-normal.woff2')}) format('woff2'); }
@font-face { font-family: 'IBM Plex Mono'; font-weight: 400; src: url(${font('ibm-plex-mono-latin-400-normal.woff2')}) format('woff2'); }
@font-face { font-family: 'IBM Plex Mono'; font-weight: 500; src: url(${font('ibm-plex-mono-latin-500-normal.woff2')}) format('woff2'); }`;

const ink = 'oklch(0.22 0.03 265)';
const og = (headline, sub) => `<!doctype html><html><head><meta charset="utf-8"><style>${fontFaces}
  * { box-sizing: border-box; margin: 0; }
  body { width: 1200px; height: 630px; background: ${ink}; color: oklch(0.97 0.006 265); font-family: 'IBM Plex Sans'; padding: 72px 80px; display: flex; flex-direction: column; justify-content: space-between; }
  .brand { display: flex; align-items: center; gap: 18px; font-family: 'Bricolage Grotesque'; font-weight: 700; font-size: 40px; letter-spacing: -0.02em; }
  .brand svg { width: 60px; height: 60px; }
  h1 { font-family: 'Bricolage Grotesque'; font-weight: 750; font-size: 78px; line-height: 1.02; letter-spacing: -0.028em; max-width: 960px; }
  h1 em { font-style: normal; color: oklch(0.75 0.17 52); }
  .sub { font-family: 'IBM Plex Mono'; font-weight: 500; font-size: 26px; color: oklch(0.8 0.015 265); display: flex; gap: 28px; }
  .sub span::before { content: ''; display: inline-block; width: 10px; height: 10px; border-radius: 50%; background: oklch(0.75 0.17 52); margin-right: 12px; vertical-align: 3px; }
</style></head><body>
  <div class="brand">${logo}Keyvane</div>
  <h1>${headline}</h1>
  <div class="sub">${sub.map((s) => `<span>${s}</span>`).join('')}</div>
</body></html>`;

const icon = (size, padding) => `<!doctype html><html><head><style>
  * { margin: 0; } body { width: ${size}px; height: ${size}px; display: grid; place-items: center; background: transparent; }
  svg { width: ${size - padding * 2}px; height: ${size - padding * 2}px; }
</style></head><body>${logo}</body></html>`;

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch();
  const shots = [
    ['favicon-32.png', 32, icon(32, 0)],
    ['apple-touch-icon.png', 180, icon(180, 0)],
    ['icon-192.png', 192, icon(192, 0)],
    ['icon-512.png', 512, icon(512, 0)],
  ];
  for (const [name, size, page] of shots) {
    const p = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
    await p.setContent(page);
    await p.screenshot({ path: path.join(out, name), omitBackground: true });
    await p.close();
  }
  const cards = [
    ['og-default.png', 'Sell your software. Let <em>Keyvane</em> handle access.', ['License keys', 'Plans', 'Usage limits', 'Stripe sync']],
    ['og-docs.png', 'Keyvane <em>documentation</em>', ['Quickstart', 'REST API', 'TypeScript SDK', 'Self-hosting']],
  ];
  for (const [name, headline, sub] of cards) {
    const p = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
    await p.setContent(og(headline, sub), { waitUntil: 'networkidle' });
    await p.evaluate(() => document.fonts.ready);
    await p.screenshot({ path: path.join(out, name) });
    await p.close();
  }
  await browser.close();
  console.log('Brand assets written to', out);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
