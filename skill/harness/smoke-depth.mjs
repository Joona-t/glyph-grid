/* Wave B smoke test — renders depthSmoke scene with and without depth
 * fog and saves both PNGs so we can eyeball them.  Not a regression
 * test (thresholds aren't strict enough for aesthetic stages). */

import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PIECE = resolve(__dirname, '..', 'scripts', 'render.html');
const OUT = resolve(__dirname, 'smoke', 'wave-b');
mkdirSync(OUT, { recursive: true });

async function grab(ctx, overrides, name) {
  /* Fresh page per grab so p5's noLoop-after-record doesn't persist. */
  const page = await ctx.newPage();
  await page.goto('file://' + PIECE, { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__glyphGridTest, null, { timeout: 10_000 });
  await page.waitForTimeout(400);

  await page.evaluate((cfg) => {
    const h = window.__glyphGridTest;
    h.setConfig(cfg);
    window.__recStore = null;
    h.beginRecord({
      total: 1, fps: 30,
      onFinish: (blob) => { window.__recStore = blob; },
    });
  }, overrides);
  await page.waitForFunction(() => window.__recStore !== null, null, { timeout: 30_000 });
  const canvas = await page.$('canvas');
  const png = await canvas.screenshot({ type: 'png' });
  const p = `${OUT}/${name}.png`;
  writeFileSync(p, png);
  console.log('  ->', p, `(${(png.length / 1024).toFixed(1)} KB)`);
  await page.close();
}

const browser = await chromium.launch({ args: ['--no-sandbox'] });
const ctx = await browser.newContext({
  viewport: { width: 800, height: 800 },
  deviceScaleFactor: 1,
});
console.log('[1/3] depthSmoke, no depth, no fog (baseline)');
await grab(ctx, {
  scene: 'depthSmoke', colorMode: 'preserve', ramp: 'dense',
  depth: { enabled: false },
  postprocess: {},
}, 'baseline-no-depth');

console.log('[2/3] depthSmoke, depth on, fog off (should match baseline)');
await grab(ctx, {
  scene: 'depthSmoke', colorMode: 'preserve', ramp: 'dense',
  depth: { enabled: true },
  postprocess: {},
}, 'depth-on-fog-off');

console.log('[3/3] depthSmoke, depth on, fog on (right half washes to sand)');
await grab(ctx, {
  scene: 'depthSmoke', colorMode: 'preserve', ramp: 'dense',
  depth: { enabled: true },
  postprocess: { depthFog: { enabled: true, color: '#E8D4B8', start: 0, end: 1, intensity: 1 } },
}, 'depth-fog-on');

await browser.close();
console.log('\nDone — eyeball smoke/wave-b/*.png to confirm:');
console.log('  baseline: horizontal luminance gradient rendered as glyphs');
console.log('  fog-on: right half should shift toward #E8D4B8 (pale sand)');
