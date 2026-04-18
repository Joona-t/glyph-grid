/* Render frames 0, 30, 60, 90, 119 of the shai-hulud-arrival piece so we can
   see what it actually produces. Writes PNGs to smoke/preview/. */

import { chromium } from 'playwright';
import { createReadStream, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, resolve, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PIECE_DIR = resolve(__dirname, '..', '..', 'pieces', 'shai-hulud-arrival');
const OUT = resolve(__dirname, 'smoke', 'preview');
mkdirSync(OUT, { recursive: true });

const MIME = {
  '.html': 'text/html', '.js': 'application/javascript', '.mjs': 'application/javascript',
  '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg',
  '.woff': 'font/woff', '.woff2': 'font/woff2',
};

function startServer(rootDir) {
  return new Promise((resolveP) => {
    const server = createServer((req, res) => {
      let p = decodeURIComponent(req.url.split('?')[0]);
      if (p === '/') p = '/index.html';
      const fp = join(rootDir, p);
      if (!existsSync(fp) || !statSync(fp).isFile()) {
        console.log('  404:', p);
        res.statusCode = 404;
        return res.end('404');
      }
      res.setHeader('Content-Type', MIME[extname(fp)] || 'application/octet-stream');
      createReadStream(fp).pipe(res);
    });
    server.listen(0, '127.0.0.1', () => resolveP({ server, port: server.address().port }));
  });
}

async function grab(ctx, url, frame) {
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__glyphGridTest, null, { timeout: 10_000 });
  await page.evaluate((f) => {
    const h = window.__glyphGridTest;
    h.setConfig({ seed: 1337, record: true });
    h.beginRecord({ total: f + 1, fps: 30, onFinish: () => {} });
  }, frame);
  await page.waitForFunction((n) => {
    const s = window.__glyphGridTest.getRecState();
    return s && s.frameIdx >= n;
  }, frame + 1, { timeout: 30_000 });

  const canvas = await page.$('canvas');
  const png = await canvas.screenshot({ type: 'png' });
  writeFileSync(join(OUT, `shai-f${String(frame).padStart(3, '0')}.png`), png);
  const real = errors.filter(e => !/sparky\.png/.test(e) && !/INVALID_OPERATION/.test(e));
  console.log(`frame ${frame}: ${png.length} bytes, ${real.length} errors`);
  real.forEach(e => console.log('  err:', e.slice(0, 200)));
  await page.close();
}

const { server, port } = await startServer(PIECE_DIR);
const url = `http://127.0.0.1:${port}/index.html`;
console.log('Serving piece at', url);

const browser = await chromium.launch({ args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1200, height: 500 }, deviceScaleFactor: 1 });
for (const f of [0, 30, 60, 90, 119]) {
  try { await grab(ctx, url, f); }
  catch (e) { console.log(`frame ${f}: TIMEOUT/ERR — ${e.message.split('\n')[0]}`); }
}
await browser.close();
server.close();
console.log('\nOutput:', OUT);
