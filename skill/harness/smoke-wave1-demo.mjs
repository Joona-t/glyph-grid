/* smoke-wave1-demo.mjs — serve + render + screenshot the Wave 1 demo piece.
 *
 * Unlike the synthetic smoke-pipeline.mjs (noise source, no p5), this exercises
 * the real end-to-end path: source.from-scene pulls a p5.Graphics through
 * the linearizer, the uniform-grid sampler, brightness selection, preserve
 * color, and paints glyphs via output.canvas.
 *
 * Writes PNG to harness/smoke/wave1-demo/ and prints console capture.
 */

import { chromium } from 'playwright';
import { createReadStream, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, resolve, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PIECE_DIR = resolve(__dirname, '..', '..', 'pieces', 'wave1-demo');
const OUT = resolve(__dirname, 'smoke', 'wave1-demo');
mkdirSync(OUT, { recursive: true });

const MIME = {
  '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.woff': 'font/woff', '.woff2': 'font/woff2',
};

function startServer(rootDir) {
  return new Promise((resolveP) => {
    const server = createServer((req, res) => {
      let p = decodeURIComponent(req.url.split('?')[0]);
      if (p === '/') p = '/index.html';
      const fp = join(rootDir, p);
      if (!existsSync(fp) || !statSync(fp).isFile()) {
        res.statusCode = 404; return res.end('404 ' + p);
      }
      res.setHeader('Content-Type', MIME[extname(fp)] || 'application/octet-stream');
      createReadStream(fp).pipe(res);
    });
    server.listen(0, '127.0.0.1', () => resolveP({ server, port: server.address().port }));
  });
}

async function grab(ctx, url, frame, outPath) {
  const page = await ctx.newPage();
  const consoleMsgs = [];
  const errors = [];
  page.on('console', (m) => consoleMsgs.push({ type: m.type(), text: m.text() }));
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__glyphGridTest, null, { timeout: 10_000 });

  /* Drive to the target frame. */
  await page.evaluate((f) => {
    const h = window.__glyphGridTest;
    h.setConfig({ seed: 42, record: true });
    window.__recStore = null;
    h.beginRecord({ total: f + 1, fps: 30, onFinish: () => { window.__recStore = true; } });
  }, frame);

  await page.waitForFunction((n) => {
    const s = window.__glyphGridTest.getRecState();
    return s && s.frameIdx >= n + 1;
  }, frame, { timeout: 30_000 });

  const canvas = await page.$('canvas');
  const png = await canvas.screenshot({ type: 'png' });
  writeFileSync(outPath, png);
  console.log(`  frame ${frame}: ${png.length} B → ${outPath}`);

  /* Print relevant console messages (skip noise). */
  const BENIGN = /sparky\.png|INVALID_OPERATION/;
  console.log('  --- console ---');
  for (const m of consoleMsgs) {
    if (BENIGN.test(m.text)) continue;
    console.log(`    [${m.type}] ${m.text.slice(0, 240)}`);
  }
  if (errors.length) {
    const real = errors.filter(e => !BENIGN.test(e));
    if (real.length) {
      console.log('  --- pageerrors ---');
      real.forEach(e => console.log('    ' + e));
    }
  }
  await page.close();
}

const { server, port } = await startServer(PIECE_DIR);
const url = `http://127.0.0.1:${port}/`;
console.log('Serving wave1-demo at', url);

const browser = await chromium.launch({ args: ['--no-sandbox'] });
const ctx = await browser.newContext({
  viewport: { width: 680, height: 680 }, deviceScaleFactor: 1,
});

for (const f of [0, 30, 60]) {
  try {
    await grab(ctx, url, f, join(OUT, `frame-${String(f).padStart(3, '0')}.png`));
  } catch (e) {
    console.log(`  frame ${f}: FAIL — ${e.message.split('\n')[0]}`);
  }
}

await browser.close();
server.close();
console.log('\nDone. Frames:', OUT);
