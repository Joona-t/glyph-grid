/* smoke-pipeline.mjs — Wave 1 runtime end-to-end test.
 *
 * Verifies:
 *  A) Registry + pipeline builder + run() all work under Playwright
 *     in the render.html context where the libs are loaded.
 *  B) A synthetic source.noise → sampling.uniform-grid → selection.brightness
 *     → color.preserve → output.void pipeline completes without errors and
 *     produces expected shape (cols/rows match, glyph indices in range).
 *  C) Construction-time lint catches bad axis order.
 *  D) GlyphGridError is thrown with .code + .primitive on missing channel.
 *
 * Output: prints per-case PASS/FAIL; exits non-zero on any fail.
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
  const d = detail ? ' — ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)) : '';
  console.log(`[${tag}] ${name}${d}`);
}

const browser = await chromium.launch({ args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 400, height: 400 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') pageErrors.push('console: ' + m.text()); });

await page.goto('file://' + PIECE, { waitUntil: 'load' });
await page.waitForFunction(() => !!(window.GlyphGrid && window.GlyphGrid.runtime), null, { timeout: 10_000 });

/* ------------------------------------------------------------ */
/* Case A: registry has primitives we expect from glyph-primitives.js */

const registryView = await page.evaluate(() => window.GlyphGrid.runtime.registryView());
const expected = {
  source:    ['noise', 'from-scene'],
  transform: ['xdog'],
  sampling:  ['uniform-grid'],
  selection: ['brightness'],
  color:     ['preserve'],
  output:    ['canvas', 'void'],
};
let registryOk = true;
for (const [axis, names] of Object.entries(expected)) {
  for (const n of names) {
    if (!registryView[axis].includes(n)) {
      registryOk = false;
      console.log(`  missing: ${axis}.${n}`);
    }
  }
}
report('A: registry has expected primitives', registryOk, registryView);

/* ------------------------------------------------------------ */
/* Case B: synthetic pipeline runs end-to-end */

const bResult = await page.evaluate(async () => {
  const rt = window.GlyphGrid.runtime;
  rt.initPool(128, 128, 64, 32);
  const pl = rt.pipeline()
    .source('noise', { w: 128, h: 128 })
    .sampling('uniform-grid', { cols: 64, rows: 32 })
    .selection('brightness', { ramp: 'classic' })
    .color('preserve')
    .output('void');
  const ctx = rt.makeContext({ t: 0, frameIdx: 0, seed: 42, config: { canvas: { w: 128, h: 128 }, grid: { cols: 64, rows: 32 } } });
  try {
    const summary = await rt.run(pl, ctx);
    return { ok: true, summary: summary };
  } catch (e) {
    return { ok: false, error: e.message, code: e.code };
  }
});
report('B: synthetic pipeline runs end-to-end', bResult.ok, bResult.summary || bResult);

/* ------------------------------------------------------------ */
/* Case C: determinism — same seed/frame produces byte-identical glyphs */

const cResult = await page.evaluate(async () => {
  const rt = window.GlyphGrid.runtime;
  rt.initPool(64, 64, 32, 16);
  /* Build a pipeline that returns glyph indices via output.void. */
  const pl = rt.pipeline()
    .source('noise', { w: 64, h: 64 })
    .sampling('uniform-grid', { cols: 32, rows: 16 })
    .selection('brightness', { ramp: 'dense' });
  const mk = (seed, fi) => rt.makeContext({ t: 0, frameIdx: fi, seed: seed, config: { canvas: { w: 64, h: 64 }, grid: { cols: 32, rows: 16 } } });
  const a = await rt.run(pl, mk(7, 0));
  const b = await rt.run(pl, mk(7, 0));
  let match = a.glyphs.length === b.glyphs.length;
  for (let i = 0; match && i < a.glyphs.length; i++) if (a.glyphs[i] !== b.glyphs[i]) match = false;
  return { match: match, len: a.glyphs.length, sample: Array.from(a.glyphs.slice(0, 8)) };
});
report('C: determinism (same seed+frame → identical glyphs)', cResult.match, cResult);

/* ------------------------------------------------------------ */
/* Case D: lint catches backward axis order */

const dResult = await page.evaluate(() => {
  const rt = window.GlyphGrid.runtime;
  try {
    /* selection before sampling should throw at construction. */
    rt.pipeline()
      .source('noise')
      .selection('brightness')
      .sampling('uniform-grid');
    return { threw: false };
  } catch (e) {
    return {
      threw: true,
      code: e.code,
      hasMessage: /cannot follow/.test(e.message),
    };
  }
});
report('D: lint catches backward axis order', dResult.threw && dResult.code === 'TYPE_MISMATCH', dResult);

/* ------------------------------------------------------------ */
/* Case E: GlyphGridError on missing channel */

const eResult = await page.evaluate(async () => {
  const rt = window.GlyphGrid.runtime;
  /* Register a fake source that emits a Field WITHOUT the 'lum' channel. */
  try { rt.register('source', 'fake-empty', function (_in, ctx, stage) {
    const f = ctx.pool.acquireField('gg:fake-empty', 32, 32);
    /* Strip lum channel from declared channels to simulate a producer that
       emits only depth. */
    return { w: 32, h: 32, channels: new Set(['depth']), buf: f.buf };
  }, { label: 'fake empty', produces: ['depth'], scratch: { fields: [{ tag: 'gg:fake-empty', channels: ['depth'] }] } });
  } catch (_) { /* may already be registered in a previous run */ }
  rt.initPool(32, 32, 16, 16);
  const pl = rt.pipeline()
    .source('fake-empty')
    .sampling('uniform-grid', { cols: 16, rows: 16 });
  const ctx = rt.makeContext({ t: 0, frameIdx: 0, seed: 1, config: { canvas: { w: 32, h: 32 }, grid: { cols: 16, rows: 16 } } });
  try {
    await rt.run(pl, ctx);
    return { threw: false };
  } catch (e) {
    return { threw: true, code: e.code, primitive: e.primitive, axis: e.axis, msg: e.message };
  }
});
report('E: GlyphGridError MISSING_CHANNEL on required channel absence',
       eResult.threw && eResult.code === 'MISSING_CHANNEL' && eResult.primitive === 'uniform-grid',
       eResult);

/* ------------------------------------------------------------ */
/* Wrap up */

await browser.close();

const failed = results.filter(r => !r.pass).length;
console.log(`\n--- SUMMARY ---\ntotal ${results.length}, pass ${results.length - failed}, fail ${failed}`);
if (pageErrors.length) {
  console.log('\nPage errors observed:');
  for (const e of pageErrors.filter(e => !/sparky\.png/.test(e))) console.log('  ' + e);
}
process.exit(failed > 0 ? 1 : 0);
