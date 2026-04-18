/* sweep.mjs — parameter-sweep mosaic renderer.
 *
 * Renders one frame per value of a single CONFIG field, tiles the
 * results into a PNG mosaic.  Makes CONFIG tuning evidence-driven
 * instead of eyeballed.
 *
 * Usage:
 *   node sweep.mjs --piece <id> --scene <name> \
 *                  --field <CONFIG.path.to.field> \
 *                  --values <v1,v2,v3,...> \
 *                  --out <path.png> [--frame <n>] [--label]
 *
 * --field supports dotted paths (e.g. "grid.cols", "brightnessGamma").
 * Scalar values auto-parse to number/boolean/string.
 */

import { chromium } from 'playwright';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');
const MANIFEST  = resolve(REPO_ROOT, 'pieces', 'manifest.json');

function parseArgs(argv) {
  const out = { frame: 30, label: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--piece')    out.piece  = argv[++i];
    else if (a === '--scene')    out.scene  = argv[++i];
    else if (a === '--field')    out.field  = argv[++i];
    else if (a === '--values')   out.values = argv[++i];
    else if (a === '--out')      out.out    = argv[++i];
    else if (a === '--frame')    out.frame  = parseInt(argv[++i], 10);
    else if (a === '--label')    out.label  = true;
    else if (a === '--help')     {
      console.log('Usage: sweep.mjs --piece <id> --scene <name> --field <path> --values <v1,v2,...> --out <png> [--frame N] [--label]');
      process.exit(0);
    }
  }
  return out;
}

function parseValue(s) {
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  if (s.startsWith('[') || s.startsWith('{')) return JSON.parse(s);
  return s;
}

function setPath(obj, path, value) {
  const parts = path.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (typeof cur[parts[i]] !== 'object' || cur[parts[i]] === null) cur[parts[i]] = {};
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = value;
  return obj;
}

const args = parseArgs(process.argv);
for (const req of ['piece', 'scene', 'field', 'values', 'out']) {
  if (!args[req]) { console.error(`missing --${req}`); process.exit(1); }
}

const manifest = JSON.parse(readFileSync(MANIFEST, 'utf-8'));
const piece = manifest.pieces.find(p => p.id === args.piece);
if (!piece) { console.error(`piece '${args.piece}' not found`); process.exit(1); }

const vals = args.values.split(',').map(parseValue);
const pieceDir = resolve(REPO_ROOT, piece.path);
const vp = piece.viewport || { w: 800, h: 800 };
const width = vp.width || vp.w, height = vp.height || vp.h;

const browser = await chromium.launch({ args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });

const frames = [];
for (const v of vals) {
  const override = setPath({}, args.field, v);
  override.scene = args.scene;
  override.seed = 1;
  console.log(`  ${args.field} = ${JSON.stringify(v)}`);
  const page = await ctx.newPage();
  await page.goto('file://' + join(pieceDir, piece.entry || 'index.html'), { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__glyphGridTest, null, { timeout: 15_000 });
  await page.waitForTimeout(400);
  await page.evaluate((cfg) => {
    const h = window.__glyphGridTest;
    h.setConfig(cfg);
    h.beginRecord({ total: cfg.__captureFrame + 1, fps: 30 });
  }, { ...override, __captureFrame: args.frame });
  /* Wait for the target frame to be rendered; don't wait for the zip. */
  await page.waitForFunction(
    (n) => { const s = window.__glyphGridTest.getRecState(); return s && s.frameIdx >= n; },
    args.frame + 1, { timeout: 60_000 });
  const canvas = await page.$('canvas');
  const png = await canvas.screenshot({ type: 'png' });
  frames.push(PNG.sync.read(png));
  await page.close();
}

await browser.close();

/* Tile horizontally. */
const n = frames.length;
const labelH = args.label ? 22 : 0;
const tileW = width, tileH = height + labelH;
const out = new PNG({ width: tileW * n, height: tileH });
out.data.fill(0);
for (let k = 0; k < n; k++) {
  const f = frames[k];
  for (let y = 0; y < height; y++) {
    const src = y * width * 4;
    const dst = ((y + labelH) * tileW * n + k * tileW) * 4;
    out.data.set(f.data.slice(src, src + width * 4), dst);
  }
}
mkdirSync(dirname(resolve(args.out)), { recursive: true });
writeFileSync(args.out, PNG.sync.write(out));
console.log(`mosaic -> ${args.out}  (${n} tiles, ${tileW * n}x${tileH})`);
