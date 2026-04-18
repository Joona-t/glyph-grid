/* gallery.mjs — portfolio contact-sheet builder.
 *
 * Crawls pieces/manifest.json and for each piece:
 *   1. Renders a thumbnail PNG (one frame of defaultScene).
 *   2. Renders a full loop GIF via the __glyphGridTest hook.
 *   3. Writes harness/gallery/{pieceId}/{thumb.png, loop.gif}.
 * Finally emits harness/gallery.html — a single static page with one
 * card per piece (title, description, thumbnail that swaps to GIF on
 * hover).
 *
 * Usage:  node gallery.mjs [--skip-gifs]
 */

import { chromium } from 'playwright';
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { encodeGif } from './lib/encode-gif.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');
const MANIFEST  = resolve(REPO_ROOT, 'pieces', 'manifest.json');
const OUT_DIR   = resolve(__dirname, 'gallery');

const args = { skipGifs: process.argv.includes('--skip-gifs') };
rmSync(OUT_DIR, { recursive: true, force: true });
mkdirSync(OUT_DIR, { recursive: true });

const manifest = JSON.parse(readFileSync(MANIFEST, 'utf-8'));
const browser = await chromium.launch({ args: ['--no-sandbox'] });

const results = [];

for (const piece of manifest.pieces) {
  console.log(`\n-> ${piece.id}`);
  const pieceOut = join(OUT_DIR, piece.id);
  mkdirSync(pieceOut, { recursive: true });
  const vp = piece.viewport || { w: 800, h: 800 };
  const ctx = await browser.newContext({
    viewport: { width: vp.width || vp.w, height: vp.height || vp.h },
    deviceScaleFactor: 1,
  });
  const pieceDir = resolve(REPO_ROOT, piece.path);
  const sceneName = piece.defaultScene || piece.scenes[0];
  const fps = piece.fps || 30;
  const total = piece.totalFrames || 120;

  /* Thumbnail — capture frame at 25% of loop. */
  const thumbFrame = Math.max(1, Math.floor(total * 0.25));
  {
    const page = await ctx.newPage();
    await page.goto('file://' + join(pieceDir, piece.entry || 'index.html'), { waitUntil: 'load' });
    await page.waitForFunction(() => !!window.__glyphGridTest, null, { timeout: 15_000 });
    await page.waitForTimeout(400);
    await page.evaluate((cfg) => {
      const h = window.__glyphGridTest;
      h.setConfig({ scene: cfg.scene, record: true, seed: 1 });
      h.beginRecord({ total: cfg.n + 1, fps: 30 });
    }, { scene: sceneName, n: thumbFrame });
    await page.waitForFunction(
      (n) => { const s = window.__glyphGridTest.getRecState(); return s && s.frameIdx >= n; },
      thumbFrame + 1, { timeout: 60_000 });
    const png = await (await page.$('canvas')).screenshot({ type: 'png' });
    writeFileSync(join(pieceOut, 'thumb.png'), png);
    console.log(`   thumb.png (frame ${thumbFrame})`);
    await page.close();
  }

  /* Full GIF. */
  let gifRel = null;
  if (!args.skipGifs) {
    const page = await ctx.newPage();
    await page.goto('file://' + join(pieceDir, piece.entry || 'index.html'), { waitUntil: 'load' });
    await page.waitForFunction(() => !!window.__glyphGridTest, null, { timeout: 15_000 });
    await page.waitForTimeout(400);
    await page.evaluate((cfg) => {
      const h = window.__glyphGridTest;
      h.setConfig({ scene: cfg.scene, record: true, seed: 1 });
      window.__recStore = { blob: null };
      h.beginRecord({
        total: cfg.total, fps: cfg.fps,
        onFinish: (blob) => { window.__recStore.blob = blob; },
      });
    }, { scene: sceneName, total, fps });
    await page.waitForFunction(() => window.__recStore && !!window.__recStore.blob, null, { timeout: 180_000 });
    const base64 = await page.evaluate(async () => {
      const blob = window.__recStore.blob;
      return await new Promise((resolve) => {
        const fr = new FileReader();
        fr.onloadend = () => resolve(fr.result.split(',')[1]);
        fr.readAsDataURL(blob);
      });
    });
    await page.close();

    const tmp = join(tmpdir(), `gallery-${piece.id}-${Date.now()}`);
    mkdirSync(tmp, { recursive: true });
    const zipPath = join(tmp, 'frames.zip');
    const framesDir = join(tmp, 'frames');
    mkdirSync(framesDir, { recursive: true });
    writeFileSync(zipPath, Buffer.from(base64, 'base64'));
    execFileSync('unzip', ['-q', zipPath, '-d', framesDir]);
    const gifPath = join(pieceOut, 'loop.gif');
    const res = await encodeGif({ framesDir, outPath: gifPath, fps });
    gifRel = `./gallery/${piece.id}/loop.gif`;
    console.log(`   loop.gif (${res.frames} frames, ${(res.bytes / 1024).toFixed(0)} KB)`);
    rmSync(tmp, { recursive: true, force: true });
  }

  await ctx.close();
  results.push({ piece, thumb: `./gallery/${piece.id}/thumb.png`, gif: gifRel, sceneName });
}

await browser.close();

/* Emit the static HTML page. */
const cards = results.map((r) => {
  const hoverSrc = r.gif ? `onmouseover="this.src='${r.gif}'" onmouseout="this.src='${r.thumb}'"` : '';
  return `
    <article class="card">
      <a href="${r.gif || r.thumb}">
        <img src="${r.thumb}" alt="${r.piece.title}" loading="lazy" ${hoverSrc}/>
      </a>
      <h3>${r.piece.title}</h3>
      <p class="meta">${r.piece.id} · scene <code>${r.sceneName}</code></p>
      <p>${r.piece.description || ''}</p>
    </article>`;
}).join('\n');

const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>glyph-grid · gallery</title>
  <style>
    :root { color-scheme: dark; }
    body { font-family: -apple-system, system-ui, sans-serif; background: #0a0806; color: #f4d29a; margin: 0; padding: 2rem; }
    header { max-width: 80rem; margin: 0 auto 2rem; }
    h1 { font-weight: 300; letter-spacing: .02em; margin: 0 0 .25rem; color: #E8A85C; }
    .subtitle { color: #6b4a2c; margin: 0; }
    main { display: grid; grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); gap: 1.25rem; max-width: 80rem; margin: 0 auto; }
    .card { background: #1a0f08; border: 1px solid #3a2414; border-radius: 10px; overflow: hidden; }
    .card img { width: 100%; aspect-ratio: 1; object-fit: cover; display: block; background: #000; cursor: pointer; }
    .card h3 { margin: .85rem 1rem .15rem; font-weight: 500; color: #E8A85C; }
    .card p { margin: 0 1rem 1rem; color: #c9a26a; font-size: .9rem; line-height: 1.4; }
    .card .meta { color: #6b4a2c; font-size: .8rem; font-family: ui-monospace, monospace; }
    code { color: #F4D29A; }
  </style>
</head>
<body>
  <header>
    <h1>glyph-grid · portfolio</h1>
    <p class="subtitle">Hover a thumbnail to preview the loop. Click to open the full GIF.</p>
  </header>
  <main>
${cards}
  </main>
</body>
</html>`;

const htmlPath = resolve(__dirname, 'gallery.html');
writeFileSync(htmlPath, html);
console.log(`\nGallery: file://${htmlPath}`);
