/* smoke-wave6.mjs — exercise each Wave 6 primitive. */

import { chromium } from 'playwright';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PIECE = resolve(__dirname, '..', 'scripts', 'render.html');

const results = [];
function report(name, pass, detail) {
  results.push({ name, pass, detail });
  const tag = pass ? 'PASS' : 'FAIL';
  const d = detail ? ' — ' + (typeof detail === 'string' ? detail : JSON.stringify(detail).slice(0, 240)) : '';
  console.log(`[${tag}] ${name}${d}`);
}

const browser = await chromium.launch({ args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 600, height: 600 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const errors = [];
const BENIGN = /sparky\.png|INVALID_OPERATION|getUserMedia|requires user interaction/;
page.on('pageerror', (e) => { if (!BENIGN.test(e.message)) errors.push(e.message); });
page.on('console', (m) => { if (m.type() === 'error' && !BENIGN.test(m.text())) errors.push('console: ' + m.text()); });

await page.goto('file://' + PIECE, { waitUntil: 'load' });
await page.waitForFunction(() => !!(window.GlyphGrid && window.GlyphGrid.runtime), null, { timeout: 10_000 });

await page.evaluate(() => {
  window.__testCanvas = document.createElement('canvas');
  window.__testCanvas.width = 256; window.__testCanvas.height = 256;
  window.GlyphGrid.runtime.initPool(256, 256, 32, 32);
  window.__baseCtx = function () {
    const rt = window.GlyphGrid.runtime;
    const ctx = rt.makeContext({ t: 0.5, frameIdx: 10, seed: 42,
      config: { canvas: { w: 256, h: 256 }, grid: { cols: 32, rows: 32 } } });
    ctx.canvas = window.__testCanvas;
    return ctx;
  };
  window.__summaryOf = function (s) {
    if (!s) return null;
    const sh = {};
    if (s.cellSignal) sh.cs = { cols: s.cellSignal.cols, rows: s.cellSignal.rows };
    if (s.glyphs) sh.glyphs = s.glyphs.length;
    if (s.rgb) sh.rgb = s.rgb.length;
    if (s.postProcessed) sh.postProcessed = true;
    if (s.audio) sh.audio = s.audio;
    if (s.w) sh.field = { w: s.w, h: s.h };
    return sh;
  };
});

async function guard(name, asyncFn) {
  try {
    const r = await asyncFn();
    report(name, r && (r.ok !== false), r);
  } catch (e) {
    report(name, false, { msg: (e.message || String(e)).slice(0, 240) });
  }
}

/* postProcess.crt-chain — goes AFTER color, BEFORE output (canonical order) */
await guard('W6: postProcess.crt-chain (bloom + vignette)', async () => page.evaluate(async () => {
  const rt = window.GlyphGrid.runtime;
  const pl = rt.pipeline().source('noise').sampling('uniform-grid').selection('brightness')
    .color('ramp-palette', { palette: 'amber' })
    .postProcess('crt-chain', { stages: {
      bloom: { enabled: true, threshold: 0.4, intensity: 0.35, radius: 3 },
      vignette: { enabled: true, strength: 0.4 },
    }})
    .output('canvas');
  const out = await rt.run(pl, window.__baseCtx());
  return { ok: out && out.postProcessed, summary: window.__summaryOf(out) };
}));

/* selection.harri-faithful — need a source with real contrast (flow-field), not uniform noise */
await guard('W6: selection.harri-faithful', async () => page.evaluate(async () => {
  const rt = window.GlyphGrid.runtime;
  const pl = rt.pipeline()
    .source('flow-field', { w: 256, h: 256, particles: 400, steps: 30 })
    .sampling('uniform-grid', { cols: 32, rows: 32 })
    .selection('harri-faithful', { ramp: ' .:-=+*#%@', contrast: 1.4 })
    .color('preserve');
  const out = await rt.run(pl, window.__baseCtx());
  const lo = Math.min(...out.glyphs), hi = Math.max(...out.glyphs);
  return { ok: (hi - lo) >= 2, glyphRange: [lo, hi], summary: window.__summaryOf(out) };
}));

/* output.webgl-canvas — smoke only: runs without throwing.
   Use a fresh canvas because WebGL locks the context type. */
await guard('W6: output.webgl-canvas runs', async () => page.evaluate(async () => {
  const rt = window.GlyphGrid.runtime;
  const glCanvas = document.createElement('canvas');
  glCanvas.width = 256; glCanvas.height = 256;
  const ctx = rt.makeContext({ t: 0, frameIdx: 0, seed: 1, config: { canvas: { w: 256, h: 256 }, grid: { cols: 32, rows: 32 } } });
  ctx.canvas = glCanvas;
  const pl = rt.pipeline()
    .source('noise', { w: 256, h: 256 })
    .sampling('uniform-grid', { cols: 32, rows: 32 })
    .selection('brightness', { ramp: '.:-=+*#@' })
    .color('ramp-palette', { palette: 'phosphor' })
    .output('webgl-canvas', { bg: [0.02, 0.05, 0.02] });
  const out = await rt.run(pl, ctx);
  /* Verify a canvas pixel snapshot via toDataURL works (context-agnostic). */
  const data = glCanvas.toDataURL();
  return { ok: !!out && typeof data === 'string' && data.startsWith('data:image/png'), dataLen: data.length };
}));

/* GlyphGrid.perf.run instrumentation */
await guard('W6: perf.run records per-stage timing', async () => page.evaluate(async () => {
  const rt = window.GlyphGrid.runtime;
  const perf = window.GlyphGrid.perf;
  perf.reset();
  const pl = rt.pipeline().source('noise').sampling('uniform-grid').selection('brightness').color('preserve');
  await perf.run(pl, window.__baseCtx());
  await perf.run(pl, window.__baseCtx());
  const hist = perf.histogram();
  const keys = Object.keys(hist);
  return { ok: keys.length === 4, keys: keys, hist: hist };
}));

/* source.pointer */
await guard('W6: source.pointer produces nonzero field', async () => page.evaluate(async () => {
  const rt = window.GlyphGrid.runtime;
  const pl = rt.pipeline()
    .source('pointer', { w: 64, h: 64, sigma: 10 })
    .sampling('uniform-grid', { cols: 16, rows: 16 })
    .selection('brightness');
  const out = await rt.run(pl, window.__baseCtx());
  const hasNonzero = Array.from(out.glyphs).some((g) => g > 0);
  return { ok: hasNonzero, any: hasNonzero };
}));

/* source.keyboard — empty buffer is fine, just runs clean */
await guard('W6: source.keyboard runs (empty buffer)', async () => page.evaluate(async () => {
  const rt = window.GlyphGrid.runtime;
  const pl = rt.pipeline()
    .source('keyboard', { w: 32, h: 4 })
    .sampling('uniform-grid', { cols: 32, rows: 4 })
    .selection('brightness');
  const out = await rt.run(pl, window.__baseCtx());
  return { ok: out && out.glyphs && out.glyphs.length === 128, glyphs: out.glyphs.length };
}));

/* output.audio-synth — runs without autostart; just checks state. */
await guard('W6: output.audio-synth (does not throw; AudioContext suspended)', async () => page.evaluate(async () => {
  const rt = window.GlyphGrid.runtime;
  const pl = rt.pipeline().source('noise').sampling('uniform-grid').selection('brightness').color('preserve')
    .output('audio-synth', { autostart: false, partials: 4 });
  const out = await rt.run(pl, window.__baseCtx());
  return { ok: out && out.audio, audio: out.audio };
}));

await browser.close();
const failed = results.filter(r => !r.pass).length;
console.log(`\n--- WAVE 6 SUMMARY ---\ntotal ${results.length}, pass ${results.length - failed}, fail ${failed}`);
if (errors.length) {
  console.log('\nPage errors:');
  for (const e of errors) console.log('  ' + e.slice(0, 240));
}
process.exit(failed > 0 ? 1 : 0);
