/* smoke-showcase.mjs — render the wave-showcase piece headlessly and
   screenshot the full page + each tile's canvas. */

import { chromium } from 'playwright';
import { createReadStream, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, resolve, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PIECE_DIR = resolve(__dirname, '..', '..', 'pieces', 'wave-showcase');
const OUT = resolve(__dirname, 'smoke', 'wave-showcase');
mkdirSync(OUT, { recursive: true });

const MIME = {
  '.html': 'text/html', '.js': 'application/javascript',
  '.json': 'application/json', '.png': 'image/png',
  '.woff': 'font/woff', '.woff2': 'font/woff2',
};

const server = await new Promise(function (r) {
  const s = createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p === '/') p = '/index.html';
    const fp = join(PIECE_DIR, p);
    if (!existsSync(fp) || !statSync(fp).isFile()) { res.statusCode = 404; return res.end(); }
    res.setHeader('Content-Type', MIME[extname(fp)] || 'application/octet-stream');
    createReadStream(fp).pipe(res);
  });
  s.listen(0, '127.0.0.1', () => r(s));
});
const port = server.address().port;
const url = 'http://127.0.0.1:' + port + '/';
console.log('showcase at', url);

const browser = await chromium.launch({ args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1100, height: 820 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const errors = [];
const BENIGN = /sparky\.png|INVALID_OPERATION|getUserMedia/;
page.on('pageerror', (e) => { if (!BENIGN.test(e.message)) errors.push(e.message); });
page.on('console', (m) => { if (m.type() === 'error' && !BENIGN.test(m.text())) errors.push('console: ' + m.text()); });

await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction(() => !!(window.GlyphGrid && window.GlyphGrid.runtime), null, { timeout: 10_000 });
/* Let a few frames tick. */
await page.waitForTimeout(2000);

const full = await page.screenshot({ type: 'png', fullPage: true });
writeFileSync(join(OUT, 'full.png'), full);
console.log('full page:', full.length, 'bytes →', join(OUT, 'full.png'));

/* Tile screenshots. */
const tiles = ['rd', 'flow', 'life', 'feedback', 'voronoi', 'logpolar'];
for (const t of tiles) {
  const c = await page.$('#canvas-' + t);
  if (!c) { console.log('  miss: canvas-' + t); continue; }
  const png = await c.screenshot({ type: 'png' });
  writeFileSync(join(OUT, t + '.png'), png);
  console.log('  tile ' + t + ':', png.length, 'bytes');
}

/* Also quickly capture a later frame to observe animation. */
await page.waitForTimeout(2500);
const later = await page.screenshot({ type: 'png', fullPage: true });
writeFileSync(join(OUT, 'full-later.png'), later);
console.log('later:', later.length, 'bytes');

if (errors.length) {
  console.log('\nPage errors:');
  for (const e of errors) console.log('  ' + e.slice(0, 240));
}

await browser.close();
server.close();
console.log('\nDone. Tiles:', OUT);
