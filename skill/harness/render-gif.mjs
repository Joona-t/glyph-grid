/* render-gif.mjs — render the shai-hulud-arrival piece end-to-end into a GIF.
 *
 *   1. HTTP-serve pieces/shai-hulud-arrival/ (fixes the fetch() vs file:// bug
 *      that made the original export all-black).
 *   2. Playwright opens the page, drives beginRecord({ total: 120 }).
 *   3. onFinish callback exposes the JSZip ArrayBuffer back to Node.
 *   4. Node unzips, reads PNGs in order, encodes them into a GIF via
 *      gif-encoder-2, writes to ~/Downloads/.
 *
 * Default output: ~/Downloads/shai-hulud-arrival__shaiHuludArrival.gif
 * Override:       node render-gif.mjs /some/other/path.gif
 */

import { chromium } from 'playwright';
import JSZip from 'jszip';
import GIFEncoder from 'gif-encoder-2';
import { PNG } from 'pngjs';
import { createReadStream, writeFileSync, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { homedir } from 'node:os';
import { dirname, resolve, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PIECE_DIR = resolve(__dirname, '..', '..', 'pieces', 'shai-hulud-arrival');
const OUT_GIF  = process.argv[2]
  || resolve(homedir(), 'Downloads', 'shai-hulud-arrival__shaiHuludArrival.gif');

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
      if (!existsSync(fp) || !statSync(fp).isFile()) { res.statusCode = 404; return res.end(); }
      res.setHeader('Content-Type', MIME[extname(fp)] || 'application/octet-stream');
      createReadStream(fp).pipe(res);
    });
    server.listen(0, '127.0.0.1', () => resolveP({ server, port: server.address().port }));
  });
}

async function renderZip(url, totalFrames, tmpZipPath) {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const ctx = await browser.newContext({
    viewport: { width: 880, height: 400 }, deviceScaleFactor: 1,
    acceptDownloads: true,
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.warn('[page error]', e.message));

  const qs = process.env.GG_QS || '';
  await page.goto(url + qs, { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__glyphGridTest, null, { timeout: 15_000 });

  /* beginRecord with NO onFinish → render.html's default path fires a<download>
     which Playwright catches as a Download event (streamed to disk — no heap). */
  const downloadP = page.waitForEvent('download', { timeout: 10 * 60 * 1000 });
  await page.evaluate((total) => {
    const h = window.__glyphGridTest;
    h.setConfig({ seed: 1337, record: true });
    h.beginRecord({ total: total, fps: 30 });  /* no onFinish → native download */
  }, totalFrames);

  /* Progress log. */
  const started = Date.now();
  let lastIdx = -1;
  let done = false;
  const pollHandle = setInterval(async () => {
    if (done) return;
    try {
      const idx = await page.evaluate(() => {
        const rs = window.__glyphGridTest.getRecState();
        return rs ? rs.frameIdx : 0;
      });
      if (idx !== lastIdx) {
        process.stdout.write(`\r  ...frame ${idx}/${totalFrames}   ` +
          `(${((Date.now() - started) / 1000).toFixed(1)}s elapsed)     `);
        lastIdx = idx;
      }
    } catch (_) { /* page may be mid-navigation or closed */ }
  }, 500);

  const download = await downloadP;
  done = true;
  clearInterval(pollHandle);
  process.stdout.write('\n');
  await download.saveAs(tmpZipPath);
  await browser.close();
  return tmpZipPath;
}

async function extractFrames(zipPath) {
  const { readFileSync } = await import('node:fs');
  const zipBuf = readFileSync(zipPath);
  const zip = await JSZip.loadAsync(zipBuf);
  const names = Object.keys(zip.files)
    .filter((n) => /frame_\d+\.png$/.test(n))
    .sort();
  console.log(`  extracted ${names.length} PNG frames from zip`);
  const frames = [];
  for (const n of names) {
    frames.push(await zip.files[n].async('nodebuffer'));
  }
  return frames;
}

function encodeGif(framesPng, outPath, fps) {
  const first = PNG.sync.read(framesPng[0]);
  const { width, height } = first;
  console.log(`  encoding GIF ${width}×${height} @ ${fps}fps → ${outPath}`);
  const enc = new GIFEncoder(width, height, 'neuquant', true);
  enc.setDelay(Math.round(1000 / fps));
  enc.setRepeat(0);
  enc.setQuality(10);
  enc.start();
  for (let i = 0; i < framesPng.length; i++) {
    const png = PNG.sync.read(framesPng[i]);
    enc.addFrame(png.data);
    if ((i + 1) % 20 === 0) process.stdout.write(`\r  encoded ${i + 1}/${framesPng.length}`);
  }
  process.stdout.write('\n');
  enc.finish();
  writeFileSync(outPath, enc.out.getData());
  const sz = statSync(outPath).size;
  console.log(`✓ ${outPath} (${sz.toLocaleString()} bytes)`);
}

/* ------------------------------------------------------------ */

console.log('→ starting local HTTP server for piece assets');
const { server, port } = await startServer(PIECE_DIR);
const url = `http://127.0.0.1:${port}/index.html`;
console.log(`  ${url}`);

const TMP_ZIP = '/tmp/glyph-grid-render.zip';

try {
  console.log('→ rendering 60 frames @ 30fps (2s loop, ~45s at ~750ms/frame)');
  await renderZip(url, 60, TMP_ZIP);
  console.log(`  got zip: ${statSync(TMP_ZIP).size.toLocaleString()} bytes → ${TMP_ZIP}`);

  const frames = await extractFrames(TMP_ZIP);
  if (frames.length === 0) throw new Error('zip contained no frame_NNNN.png entries');

  encodeGif(frames, OUT_GIF, 30);
} finally {
  server.close();
}
