/* render-piece.mjs — generalized per-piece batch GIF renderer.
 *
 * Reads pieces/manifest.json, looks up the requested piece, renders
 * one or all of its scenes via the __glyphGridTest hook, and emits
 * animated GIFs using the Node-native encoder.
 *
 * Usage:
 *   node render-piece.mjs --piece <id> [--scene <name>] [--out-dir <path>]
 *                         [--fps <n>] [--total <n>]
 *
 * If --scene is omitted, renders every scene listed in manifest.scenes.
 */

import { chromium } from 'playwright';
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir, tmpdir } from 'node:os';
import { encodeGif } from './lib/encode-gif.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');  /* glyph-grid repo root */
const MANIFEST = resolve(REPO_ROOT, 'pieces', 'manifest.json');

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--piece')   out.piece = argv[++i];
    else if (a === '--scene')   out.scene = argv[++i];
    else if (a === '--out-dir') out.outDir = argv[++i];
    else if (a === '--fps')     out.fps = parseInt(argv[++i], 10);
    else if (a === '--total')   out.total = parseInt(argv[++i], 10);
    else if (a === '--help' || a === '-h') {
      console.log('Usage: render-piece.mjs --piece <id> [--scene <name>] [--out-dir <path>] [--fps <n>] [--total <n>]');
      process.exit(0);
    }
  }
  return out;
}

const args = parseArgs(process.argv);
if (!args.piece) {
  console.error('missing --piece <id>');
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(MANIFEST, 'utf-8'));
const piece = manifest.pieces.find(p => p.id === args.piece);
if (!piece) {
  console.error(`piece '${args.piece}' not found in manifest. Known: ${manifest.pieces.map(p => p.id).join(', ')}`);
  process.exit(1);
}

const scenes = args.scene ? [args.scene] : piece.scenes;
const fps = args.fps || piece.fps || 30;
const total = args.total || piece.totalFrames || 120;
const outDir = args.outDir || join(homedir(), 'Downloads');
const tempDir = join(tmpdir(), `glyph-grid-${piece.id}`);
const pieceDir = resolve(REPO_ROOT, piece.path);

rmSync(tempDir, { recursive: true, force: true });
mkdirSync(tempDir, { recursive: true });
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ args: ['--no-sandbox'] });
const vp = piece.viewport || { w: 800, h: 800 };
const ctx = await browser.newContext({
  viewport: { width: vp.width || vp.w, height: vp.height || vp.h },
  deviceScaleFactor: 1,
});

for (const sceneName of scenes) {
  console.log(`\n-> ${piece.id} / ${sceneName}`);
  const page = await ctx.newPage();
  await page.goto('file://' + join(pieceDir, piece.entry || 'index.html'), { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__glyphGridTest, null, { timeout: 15_000 });
  await page.waitForTimeout(600);

  await page.evaluate((opts) => {
    const h = window.__glyphGridTest;
    h.setConfig({ scene: opts.scene, record: true, seed: 1 });
    window.__recStore = { blob: null };
    h.beginRecord({
      total: opts.total, fps: opts.fps,
      onFinish: (blob) => { window.__recStore.blob = blob; },
    });
  }, { scene: sceneName, total: total, fps: fps });

  await page.waitForFunction(
    () => window.__recStore && !!window.__recStore.blob, null, { timeout: 180_000 });

  const base64 = await page.evaluate(async () => {
    const blob = window.__recStore.blob;
    return await new Promise((resolve) => {
      const fr = new FileReader();
      fr.onloadend = () => resolve(fr.result.split(',')[1]);
      fr.readAsDataURL(blob);
    });
  });
  await page.close();

  const zipPath = join(tempDir, `${sceneName}.zip`);
  const framesDir = join(tempDir, `${sceneName}-frames`);
  writeFileSync(zipPath, Buffer.from(base64, 'base64'));
  mkdirSync(framesDir, { recursive: true });
  execFileSync('unzip', ['-q', zipPath, '-d', framesDir]);

  const gifPath = join(outDir, `${piece.id}__${sceneName}.gif`);
  const res = await encodeGif({ framesDir, outPath: gifPath, fps });
  console.log(`   ${res.frames} frames, ${(res.bytes / 1024).toFixed(0)} KB -> ${gifPath}`);
}

await browser.close();
console.log('\nDone.');
