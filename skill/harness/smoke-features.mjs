/* smoke-features.mjs — comprehensive v2 feature + edge-case battery.
 *
 * Each case boots a fresh render.html page, applies a config via the
 * __glyphGridTest hook, freezes at a target frame, screenshots the canvas,
 * and reports pass/fail to a summary JSON.
 *
 *   PASS  captured without console errors AND all assertions held
 *   FAIL  console error, assertion failure, or timeout
 *
 * Output: harness/smoke/features/*.png  +  harness/smoke/features/summary.json
 */

import { chromium } from 'playwright';
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PIECE = resolve(__dirname, '..', 'scripts', 'render.html');
const OUT   = resolve(__dirname, 'smoke', 'features');
mkdirSync(OUT, { recursive: true });

const FRAME = 30;        /* pipeline has warmed up, still fast to reach */
const SEED  = 1;

const results = [];

function hash(buf) { return createHash('sha256').update(buf).digest('hex').slice(0, 16); }

async function newFrozenPage(ctx, config, extras) {
  const page = await ctx.newPage();
  const errors = [];
  const warns  = [];
  /* Benign harness-only noise: render.html fetches sparky.png and p5 loads
     some WebGL state; both fire under file:// but don't affect pixel output
     (goldens were captured under the identical conditions). */
  const BENIGN = [
    /Fetch API cannot load .*sparky\.png.*URL scheme "file" is not supported/,
    /WebGL: INVALID_OPERATION: useProgram: program not valid/,
  ];
  const isBenign = (t) => BENIGN.some((re) => re.test(t));
  page.on('console', (m) => {
    const t = m.text();
    if (m.type() === 'error'   && !isBenign(t)) errors.push(t);
    if (m.type() === 'warning' && !isBenign(t)) warns.push(t);
  });
  page.on('pageerror', (e) => { if (!isBenign(e.message)) errors.push('pageerror: ' + e.message); });

  await page.goto('file://' + PIECE, { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__glyphGridTest, null, { timeout: 10_000 });

  /* Apply config, then drive to FRAME via beginRecord. record:true prevents
     the still-image noLoop() short-circuit and forces each frame to render. */
  await page.evaluate(({ cfg, targetFrame, seed }) => {
    const h = window.__glyphGridTest;
    h.setConfig(Object.assign({ seed, record: true }, cfg));
    window.__recStore = null;
    h.beginRecord({
      total: targetFrame, fps: 30,
      onFinish: (blob) => { window.__recStore = blob; },
    });
  }, { cfg: config, targetFrame: FRAME, seed: SEED });

  await page.waitForFunction((n) => {
    const s = window.__glyphGridTest.getRecState();
    return s && s.frameIdx >= n;
  }, FRAME, { timeout: 30_000 });

  /* Run any per-case assertions in-page before we destroy the page. */
  let assertions = null;
  if (extras && extras.inPage) {
    assertions = await page.evaluate(extras.inPage);
  }

  const canvas = await page.$('canvas');
  const png = await canvas.screenshot({ type: 'png' });

  await page.close();
  return { png, errors, warns, assertions };
}

async function runCase(ctx, name, config, extras = {}) {
  const started = Date.now();
  let png, errors = [], warns = [], assertions = null, caught = null;
  try {
    const out = await newFrozenPage(ctx, config, extras);
    png = out.png; errors = out.errors; warns = out.warns; assertions = out.assertions;
  } catch (e) {
    caught = e.message;
  }
  const ok = !caught && errors.length === 0 && (!assertions || assertions.ok !== false);
  if (png) writeFileSync(join(OUT, `${name}.png`), png);
  const row = {
    name, pass: ok,
    bytes: png ? png.length : 0,
    sha: png ? hash(png) : null,
    errors, warns: warns.length,
    assertions, caught,
    durMs: Date.now() - started,
  };
  results.push(row);
  const tag = ok ? 'PASS' : 'FAIL';
  console.log(`[${tag}] ${name} (${row.bytes} B, ${row.durMs} ms${errors.length ? ', ' + errors.length + ' console errors' : ''})`);
  return row;
}

/* ================================================================== */

const browser = await chromium.launch({ args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 800, height: 800 }, deviceScaleFactor: 1 });

/* ---------- Baselines ---------- */

await runCase(ctx, '00-baseline-v2-default', {});
await runCase(ctx, '01-baseline-v1-compat', { compat: 'v1' });

/* v2 default should equal v1 pixel-for-pixel (compat contract). */
const v2 = results.find(r => r.name === '00-baseline-v2-default');
const v1 = results.find(r => r.name === '01-baseline-v1-compat');
if (v2 && v1) {
  const match = v2.sha === v1.sha;
  console.log(`[${match ? 'PASS' : 'FAIL'}] contract: v2 default == v1 compat (sha ${v2.sha} vs ${v1.sha})`);
  results.push({ name: 'CONTRACT-v2-default-eq-v1', pass: match, v2sha: v2.sha, v1sha: v1.sha });
}

/* Retro presets retired in Wave 0 (skill/plans/glyph-grid-audit.md).
   Wave 2+ may reintroduce them via the preset+composition system. */

/* ---------- Prefilter / dither / selection ---------- */

await runCase(ctx, '20-prefilter-xdog', { prefilter: { mode: 'xdog' } });
await runCase(ctx, '21-dither-bayer8',  { dither: { mode: 'bayer8' } });
await runCase(ctx, '22-dither-floyd',   { dither: { mode: 'floydSteinberg' } });
await runCase(ctx, '23-sel-shape',      { selectionMode: 'shape' });
await runCase(ctx, '24-sel-shape-edge', { selectionMode: 'shape-edge-aware' });

/* ---------- Postprocess ---------- */

await runCase(ctx, '30-post-crt-full', {
  postprocess: {
    crt:                 { enabled: true },
    bloom:               { enabled: true, strength: 0.4 },
    scanlines:           { enabled: true, alpha: 0.25 },
    chromaticAberration: { enabled: true, amount: 1.5 },
    phosphorDecay:       { enabled: true, persistence: 0.7 },
    vignette:            { enabled: true, strength: 0.4 },
    barrel:              { enabled: true, amount: 0.12 },
  },
});
await runCase(ctx, '31-post-vignette-only', {
  postprocess: { vignette: { enabled: true, strength: 0.6 } },
});
await runCase(ctx, '32-post-halation', {
  postprocess: { halation: { enabled: true, radius: 6, intensity: 0.3 } },
});

/* ---------- Palette morph ---------- */

await runCase(ctx, '40-palette-morph', {
  paletteMorph: { enabled: true, palettes: ['synthwave', 'amber'], period: 2.0 },
});

/* Zones retired in Wave 0 (skill/plans/glyph-grid-audit.md).
   Wave 3 reintroduces via the composition.mask primitive. */

/* ---------- Compat short-circuit: v1 ignores v2 features ---------- */

await runCase(ctx, '60-compat-v1-ignores-crt', {
  compat: 'v1',
  postprocess: {
    crt: { enabled: true },
    bloom: { enabled: true, strength: 0.8 },
    vignette: { enabled: true, strength: 0.8 },
  },
});

/* v1-with-feature row must hash-match plain v1 baseline. */
const v1a = results.find(r => r.name === '60-compat-v1-ignores-crt');
if (v1a && v1) {
  const a = v1a.sha === v1.sha;
  console.log(`[${a ? 'PASS' : 'FAIL'}] contract: v1 + crt ignored (${v1a.sha} vs ${v1.sha})`);
  results.push({ name: 'CONTRACT-v1-ignores-crt', pass: a });
}

/* ---------- Determinism: same config twice → same sha ---------- */

await runCase(ctx, '70-determinism-run1', { prefilter: { mode: 'xdog' } });
await runCase(ctx, '71-determinism-run2', { prefilter: { mode: 'xdog' } });
const d1 = results.find(r => r.name === '70-determinism-run1');
const d2 = results.find(r => r.name === '71-determinism-run2');
if (d1 && d2) {
  const match = d1.sha === d2.sha;
  console.log(`[${match ? 'PASS' : 'FAIL'}] contract: determinism (${d1.sha} vs ${d2.sha})`);
  results.push({ name: 'CONTRACT-determinism', pass: match });
}

/* ---------- Edge case: EC-4 — getConfig returns deep clone ---------- */

await runCase(ctx, '80-ec4-deep-clone', {}, {
  inPage: () => {
    const h = window.__glyphGridTest;
    const c1 = h.getConfig();
    c1.palette = '__MUTATED__';
    if (c1.postprocess) c1.postprocess.__injected = true;
    const c2 = h.getConfig();
    const shallowIntact = c2.palette !== '__MUTATED__';
    const deepIntact    = !(c2.postprocess && c2.postprocess.__injected);
    return { ok: shallowIntact && deepIntact, shallowIntact, deepIntact };
  },
});

/* ---------- Edge case: beginRecord legacy (total, onFinish) signature ---------- */

await runCase(ctx, '81-legacy-beginrecord', {}, {
  inPage: () => {
    /* We already used the new object signature to drive this capture. Here we
       simply verify both signatures build a valid recState shape. */
    const h = window.__glyphGridTest;
    let sawFinish = false;
    h.beginRecord(1, () => { sawFinish = true; });
    const s = h.getRecState();
    return { ok: s && typeof s.total === 'number' && s.total === 1,
             sawState: !!s, total: s ? s.total : null };
  },
});

/* ---------- Edge case: SKILL_VERSION exposed ---------- */

await runCase(ctx, '82-skill-version', {}, {
  inPage: () => {
    const v = window.__glyphGridTest.getSkillVersion();
    return { ok: v === '2.0.0', version: v };
  },
});

/* ---------- Edge case: validate() surfaces CR-6 (dither + shape) ---------- */

await runCase(ctx, '83-validator-cr6', {
  selectionMode: 'shape', dither: { mode: 'bayer8' },
}, {
  inPage: () => {
    const cfg = window.__glyphGridTest.getConfig();
    const issues = window.GlyphGrid && window.GlyphGrid.compat
      ? window.GlyphGrid.compat.validate(cfg) : [];
    const cr6 = issues.find(i => i.code === 'CR-6');
    return { ok: !!cr6, issues };
  },
});

/* ---------- Edge case: validate() surfaces CR-7 (xdog + shape) ---------- */

await runCase(ctx, '84-validator-cr7', {
  selectionMode: 'shape', prefilter: { mode: 'xdog' },
}, {
  inPage: () => {
    const cfg = window.__glyphGridTest.getConfig();
    const issues = window.GlyphGrid && window.GlyphGrid.compat
      ? window.GlyphGrid.compat.validate(cfg) : [];
    const cr7 = issues.find(i => i.code === 'CR-7');
    return { ok: !!cr7, issues };
  },
});

/* ---------- Edge case: glyph-set cascade (missing set falls back) ---------- */

await runCase(ctx, '85-glyphset-cascade-missing', {
  glyphSet: '__does_not_exist__',
});

/* ================================================================== */

await browser.close();

const total  = results.length;
const passed = results.filter(r => r.pass !== false && r.pass !== undefined ? r.pass : true).length;
const failed = results.filter(r => r.pass === false).length;

writeFileSync(join(OUT, 'summary.json'), JSON.stringify(results, null, 2));
console.log(`\n--- SUMMARY ---\ntotal ${total}, pass ${total - failed}, fail ${failed}`);
console.log(`See ${OUT}/summary.json for details.`);

process.exit(failed > 0 ? 1 : 0);
