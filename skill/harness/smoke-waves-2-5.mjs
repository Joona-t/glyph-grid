/* smoke-waves-2-5.mjs — exercise representative new primitives.
 *
 * All pipeline construction happens inline inside page.evaluate callbacks
 * (no dynamic Function() / string eval). Each test case is a sealed closure
 * evaluated in the page context. Returns shape summary.
 */

import { chromium } from 'playwright';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PIECE = resolve(__dirname, '..', 'scripts', 'render.html');

const results = [];
function report(name, pass, detail) {
  results.push({ name, pass, detail });
  const tag = pass ? 'PASS' : 'FAIL';
  const d = detail ? ' — ' + (typeof detail === 'string' ? detail : JSON.stringify(detail).slice(0, 220)) : '';
  console.log(`[${tag}] ${name}${d}`);
}

const browser = await chromium.launch({ args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 300, height: 300 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const errors = [];
const BENIGN = /sparky\.png|INVALID_OPERATION|requires user interaction|getUserMedia/;
page.on('pageerror', (e) => { if (!BENIGN.test(e.message)) errors.push(e.message); });
page.on('console', (m) => { if (m.type() === 'error' && !BENIGN.test(m.text())) errors.push('console: ' + m.text()); });

await page.goto('file://' + PIECE, { waitUntil: 'load' });
await page.waitForFunction(() => !!(window.GlyphGrid && window.GlyphGrid.runtime), null, { timeout: 10_000 });

await page.evaluate(() => {
  window.__testCanvas = document.createElement('canvas');
  window.__testCanvas.width = 128; window.__testCanvas.height = 128;
  window.GlyphGrid.runtime.initPool(128, 128, 40, 40);
  window.__summaryOf = function (s) {
    if (!s) return null;
    const sh = {};
    if (s.cellSignal) sh.cs = { cols: s.cellSignal.cols, rows: s.cellSignal.rows, topology: s.cellSignal.topology || 'uniform' };
    if (s.glyphs) sh.glyphs = s.glyphs.length;
    if (s.rgb) sh.rgb = s.rgb.length;
    if (s.w) sh.field = { w: s.w, h: s.h };
    if (s.kind) sh.output = s.kind;
    if (s.blended) sh.blended = s.blended.rule;
    if (s.overlaid) sh.overlaid = true;
    if (s.masked) sh.masked = true;
    return sh;
  };
  window.__baseCtx = function () {
    const rt = window.GlyphGrid.runtime;
    const ctx = rt.makeContext({ t: 0.5, frameIdx: 10, seed: 42,
      config: { canvas: { w: 128, h: 128 }, grid: { cols: 40, rows: 40 } } });
    ctx.canvas = window.__testCanvas;
    return ctx;
  };
});

async function guard(name, asyncFn) {
  try {
    const r = await asyncFn();
    report(name, true, r);
  } catch (e) {
    report(name, false, { msg: e.message ? e.message.slice(0, 240) : String(e).slice(0, 240) });
  }
}

/* =======================================================
   Wave 2 — output primitives
   ======================================================= */

await guard('W2: svg output', async () => page.evaluate(async () => {
  const rt = window.GlyphGrid.runtime;
  const pl = rt.pipeline().source('noise', { w: 64, h: 64 })
    .sampling('uniform-grid', { cols: 20, rows: 20 })
    .selection('brightness', { ramp: 'classic' })
    .color('preserve')
    .output('svg', { autoDownload: false });
  const out = await rt.run(pl, window.__baseCtx());
  return window.__summaryOf(out);
}));

await guard('W2: png-frame output', async () => page.evaluate(async () => {
  const rt = window.GlyphGrid.runtime;
  const pl = rt.pipeline().source('noise')
    .sampling('uniform-grid').selection('brightness').color('preserve')
    .output('canvas').output('png-frame', { autoDownload: false });
  const out = await rt.run(pl, window.__baseCtx());
  return window.__summaryOf(out);
}));

/* =======================================================
   Wave 3 — composition
   ======================================================= */

await guard('W3: composition.blend additive', async () => page.evaluate(async () => {
  const rt = window.GlyphGrid.runtime;
  const side = rt.pipeline().source('noise', { scale: 2 })
    .sampling('uniform-grid').selection('brightness', { ramp: 'dense' })
    .color('ramp-palette', { palette: 'phosphor' }).output('canvas');
  const pl = rt.pipeline().source('noise')
    .sampling('uniform-grid').selection('brightness')
    .color('ramp-palette', { palette: 'amber' })
    .composition('blend', { pipeline: side, rule: 'additive' })
    .output('canvas');
  const out = await rt.run(pl, window.__baseCtx());
  return window.__summaryOf(out);
}));

await guard('W3: composition.temporal-sequence + crossfade', async () => page.evaluate(async () => {
  const rt = window.GlyphGrid.runtime;
  const pA = rt.pipeline().source('noise', { scale: 1 })
    .sampling('uniform-grid').selection('brightness').color('ramp-palette', { palette: 'amber' }).output('canvas');
  const pB = rt.pipeline().source('noise', { scale: 4 })
    .sampling('uniform-grid').selection('brightness').color('ramp-palette', { palette: 'phosphor' }).output('canvas');
  const pl = rt.pipeline().source('noise').sampling('uniform-grid').selection('brightness').color('preserve')
    .composition('temporal-sequence', { keyframes: [{ t: 0, pipeline: pA }, { t: 1, pipeline: pB }], crossfade: 0.5 });
  const out = await rt.run(pl, window.__baseCtx());
  return window.__summaryOf(out);
}));

/* =======================================================
   Wave 4 — sources
   ======================================================= */

await guard('W4: source.flow-field', async () => page.evaluate(async () => {
  const rt = window.GlyphGrid.runtime;
  const pl = rt.pipeline().source('flow-field', { w: 128, h: 128, particles: 300, steps: 20 })
    .sampling('uniform-grid').selection('brightness', { ramp: 'dense' })
    .color('ramp-palette', { palette: 'phosphor' });
  const out = await rt.run(pl, window.__baseCtx());
  return window.__summaryOf(out);
}));

await guard('W4: source.reaction-diffusion', async () => page.evaluate(async () => {
  const rt = window.GlyphGrid.runtime;
  const pl = rt.pipeline().source('reaction-diffusion', { w: 64, h: 64, iterPerFrame: 3 })
    .sampling('uniform-grid', { cols: 32, rows: 32 })
    .selection('brightness', { ramp: 'classic' }).color('ramp-palette', { palette: 'solar-flare' });
  const out = await rt.run(pl, window.__baseCtx());
  return window.__summaryOf(out);
}));

await guard('W4: source.cellular-automaton (life)', async () => page.evaluate(async () => {
  const rt = window.GlyphGrid.runtime;
  const pl = rt.pipeline().source('cellular-automaton', { w: 64, h: 64, rule: 'life' })
    .sampling('uniform-grid', { cols: 32, rows: 32 }).selection('brightness').color('ramp-palette');
  const out = await rt.run(pl, window.__baseCtx());
  return window.__summaryOf(out);
}));

await guard('W4: source.feedback decay loop', async () => page.evaluate(async () => {
  const rt = window.GlyphGrid.runtime;
  const pl = rt.pipeline().source('feedback', { w: 64, h: 64, decay: 0.9 })
    .sampling('uniform-grid', { cols: 32, rows: 32 }).selection('brightness').color('preserve');
  const out = await rt.run(pl, window.__baseCtx());
  return window.__summaryOf(out);
}));

/* =======================================================
   Wave 5 — sampling topologies
   ======================================================= */

await guard('W5: sampling.radial', async () => page.evaluate(async () => {
  const rt = window.GlyphGrid.runtime;
  const pl = rt.pipeline().source('noise', { w: 128, h: 128 })
    .sampling('radial', { rings: 10, spokes: 24 }).selection('brightness').color('preserve');
  const out = await rt.run(pl, window.__baseCtx());
  return window.__summaryOf(out);
}));
await guard('W5: sampling.log-polar', async () => page.evaluate(async () => {
  const rt = window.GlyphGrid.runtime;
  const pl = rt.pipeline().source('noise', { w: 128, h: 128 })
    .sampling('log-polar', { rings: 12, spokes: 32 }).selection('brightness')
    .color('ramp-palette', { palette: 'synthwave' });
  const out = await rt.run(pl, window.__baseCtx());
  return window.__summaryOf(out);
}));
await guard('W5: sampling.phyllotaxis', async () => page.evaluate(async () => {
  const rt = window.GlyphGrid.runtime;
  const pl = rt.pipeline().source('flow-field', { w: 128, h: 128, particles: 400, steps: 20 })
    .sampling('phyllotaxis', { count: 400 }).selection('brightness').color('ramp-palette');
  const out = await rt.run(pl, window.__baseCtx());
  return window.__summaryOf(out);
}));
await guard('W5: sampling.hexagonal', async () => page.evaluate(async () => {
  const rt = window.GlyphGrid.runtime;
  const pl = rt.pipeline().source('noise', { w: 128, h: 128 })
    .sampling('hexagonal', { cols: 20 }).selection('brightness').color('preserve');
  const out = await rt.run(pl, window.__baseCtx());
  return window.__summaryOf(out);
}));
await guard('W5: sampling.voronoi (coarse stride)', async () => page.evaluate(async () => {
  const rt = window.GlyphGrid.runtime;
  const pl = rt.pipeline().source('noise', { w: 128, h: 128 })
    .sampling('voronoi', { sites: 80, stride: 4 }).selection('brightness').color('preserve');
  const out = await rt.run(pl, window.__baseCtx());
  return window.__summaryOf(out);
}));

/* =======================================================
   Polish — colors, transforms, selections
   ======================================================= */

await guard('P: color.ramp-palette duneCinema', async () => page.evaluate(async () => {
  const rt = window.GlyphGrid.runtime;
  const pl = rt.pipeline().source('noise').sampling('uniform-grid').selection('brightness')
    .color('ramp-palette', { palette: 'duneCinema' });
  const out = await rt.run(pl, window.__baseCtx());
  return window.__summaryOf(out);
}));
await guard('P: color.palette-morph animated', async () => page.evaluate(async () => {
  const rt = window.GlyphGrid.runtime;
  const pl = rt.pipeline().source('noise').sampling('uniform-grid').selection('brightness')
    .color('palette-morph', { paletteA: 'lovespark', paletteB: 'phosphor', period: 2 });
  const out = await rt.run(pl, window.__baseCtx());
  return window.__summaryOf(out);
}));
await guard('P: color.gradient-stops', async () => page.evaluate(async () => {
  const rt = window.GlyphGrid.runtime;
  const pl = rt.pipeline().source('noise').sampling('uniform-grid').selection('brightness')
    .color('gradient-stops', { stops: [[0, '#000'], [0.5, '#f08'], [1, '#fff']] });
  const out = await rt.run(pl, window.__baseCtx());
  return window.__summaryOf(out);
}));
await guard('P: transform.invert + transform.gamma', async () => page.evaluate(async () => {
  const rt = window.GlyphGrid.runtime;
  const pl = rt.pipeline().source('noise').transform('invert').transform('gamma', { value: 1.8 })
    .sampling('uniform-grid').selection('brightness').color('preserve');
  const out = await rt.run(pl, window.__baseCtx());
  return window.__summaryOf(out);
}));
await guard('P: selection.dither-brightness', async () => page.evaluate(async () => {
  const rt = window.GlyphGrid.runtime;
  const pl = rt.pipeline().source('noise').sampling('uniform-grid')
    .selection('dither-brightness').color('ramp-palette');
  const out = await rt.run(pl, window.__baseCtx());
  return window.__summaryOf(out);
}));

await browser.close();
const failed = results.filter(r => !r.pass).length;
console.log(`\n--- SUMMARY ---\ntotal ${results.length}, pass ${results.length - failed}, fail ${failed}`);
if (errors.length) {
  console.log('\nPage errors (real):');
  for (const e of errors) console.log('  ' + e.slice(0, 240));
}
process.exit(failed > 0 ? 1 : 0);
