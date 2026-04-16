/* capture.mjs — headless Playwright screenshot runner for glyph-grid pieces.
 *
 *   node capture.mjs [--goldens] [--piece <path>] [--seed <int>]
 *                    [--frame <int>] [--width 1080] [--height 1080]
 *
 *   --goldens    overwrite harness/goldens/* with fresh captures.
 *                WITHOUT this flag we write to harness/captures/*,
 *                leaving goldens alone.
 *   --piece      path to an HTML file OR a piece directory containing
 *                index.html. Default: ../scripts/render.html
 *   --seed       int, seeds the piece's RNG (if the piece honors it).
 *   --frame      int, freezes the piece at frame N (via __glyphGridTest hook).
 *
 * The capture path:
 *   1. Launch Chromium, open the piece.
 *   2. When the window's __glyphGridTest hook is present, call
 *      setConfig({ seed, record: true }), then beginRecord({ total: frame+1 }),
 *      then wait for getRecState().frameIdx == frame+1.
 *   3. Screenshot canvas, write PNG.
 *
 * The hook contract is defined by render.html; see SKILL.md. A piece without
 * the hook cannot be captured — the harness warns and moves on.
 */

import { chromium } from 'playwright';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve, basename } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const out = { goldens: false, seed: 1, frame: 0, width: 1080, height: 1080,
                piece: resolve(__dirname, '..', 'scripts', 'render.html') };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--goldens') out.goldens = true;
    else if (a === '--piece') out.piece = resolve(argv[++i]);
    else if (a === '--seed') out.seed = parseInt(argv[++i], 10);
    else if (a === '--frame') out.frame = parseInt(argv[++i], 10);
    else if (a === '--width') out.width = parseInt(argv[++i], 10);
    else if (a === '--height') out.height = parseInt(argv[++i], 10);
    else if (a === '--help' || a === '-h') {
      console.log('Usage: node capture.mjs [--goldens] [--piece <path>] [--seed N] [--frame N] [--width N] [--height N]');
      process.exit(0);
    }
  }
  return out;
}

function ensureDir(p) { if (!existsSync(p)) mkdirSync(p, { recursive: true }); }

function pieceId(piecePath) {
  const base = basename(piecePath, '.html');
  return base === 'render' ? 'render-default' : base;
}

async function capture(opts) {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const ctx = await browser.newContext({
    viewport: { width: opts.width, height: opts.height },
    deviceScaleFactor: 1,
  });
  const page = await ctx.newPage();

  /* file:// URL for a local piece. */
  const url = opts.piece.startsWith('http') ? opts.piece : 'file://' + opts.piece;
  await page.goto(url, { waitUntil: 'load' });

  /* Wait for the test hook to appear. Pieces that don't expose it fail here. */
  await page.waitForFunction(() => !!window.__glyphGridTest, null, { timeout: 10_000 });

  /* Drive the piece deterministically up to the target frame. */
  const targetFrame = opts.frame + 1;
  await page.evaluate((args) => {
    const hook = window.__glyphGridTest;
    hook.setConfig({ seed: args.seed, record: true });
    hook.beginRecord({ total: args.targetFrame, fps: 30 });
  }, { seed: opts.seed, targetFrame });

  await page.waitForFunction((n) => {
    const s = window.__glyphGridTest.getRecState();
    return s && s.frameIdx >= n;
  }, targetFrame, { timeout: 30_000 });

  /* Screenshot the canvas. render.html uses a single #defaultCanvas0. */
  const canvas = await page.$('canvas');
  if (!canvas) throw new Error('No <canvas> element found in piece');
  const png = await canvas.screenshot({ type: 'png' });

  const outDir = opts.goldens
    ? join(__dirname, 'goldens')
    : join(__dirname, 'captures');
  ensureDir(outDir);
  const name = `${pieceId(opts.piece)}_seed${opts.seed}_f${String(opts.frame).padStart(5, '0')}.png`;
  const outPath = join(outDir, name);
  writeFileSync(outPath, png);

  await browser.close();
  return outPath;
}

const opts = parseArgs(process.argv);
try {
  const out = await capture(opts);
  console.log(out);
} catch (e) {
  console.error('capture failed:', e.message);
  process.exit(1);
}
