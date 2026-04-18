/* Load the gallery loop.gif and screenshot the visible image at 5 delays
   across its natural playback to capture multiple frames. */

import { chromium } from 'playwright';
import { createReadStream, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { resolve, join, extname } from 'node:path';

const GIF_DIR = '/Users/darkfire/Claude x LoveSpark/Web Projects/glyph-grid/skill/harness/gallery/shai-hulud-arrival';
const OUT = '/tmp/gif-frames';
mkdirSync(OUT, { recursive: true });

const MIME = { '.gif': 'image/gif', '.html': 'text/html' };
const server = createServer((req, res) => {
  const p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/index.html') {
    res.setHeader('Content-Type', 'text/html');
    return res.end(`<!doctype html><html><body style="margin:0;background:#000">
      <img id="g" src="/loop.gif" style="display:block">
    </body></html>`);
  }
  const fp = join(GIF_DIR, p);
  if (!existsSync(fp) || !statSync(fp).isFile()) { res.statusCode = 404; return res.end(); }
  res.setHeader('Content-Type', MIME[extname(fp)] || 'application/octet-stream');
  createReadStream(fp).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const browser = await chromium.launch({ args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1200, height: 500 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'load' });
await page.waitForSelector('#g');
await page.waitForTimeout(300);

/* Presuming 30fps × 4s = 120 frames, the gif likely autoplays at 10-15 fps.
   Take 6 screenshots across ~4 seconds to land on different frames. */
const delays = [0, 700, 1400, 2100, 2800, 3500];
for (const [i, d] of delays.entries()) {
  await page.waitForTimeout(i === 0 ? d : delays[i] - delays[i - 1]);
  const img = await page.$('#g');
  const png = await img.screenshot({ type: 'png' });
  writeFileSync(join(OUT, `g${String(i).padStart(2, '0')}-t${d}ms.png`), png);
  console.log(`t=${d}ms → ${png.length} B`);
}

await browser.close();
server.close();
console.log('\nOutput:', OUT);
