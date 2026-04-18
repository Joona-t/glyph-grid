/* Bisect which CRT postprocess stage hangs under v2.
   30-post-crt-full enables all seven — timeout. Test each alone. */

import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PIECE = resolve(__dirname, '..', 'scripts', 'render.html');
const OUT = resolve(__dirname, 'smoke', 'crt-bisect');
mkdirSync(OUT, { recursive: true });

async function test(ctx, name, pp, timeoutMs = 10_000) {
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  try {
    await page.goto('file://' + PIECE, { waitUntil: 'load' });
    await page.waitForFunction(() => !!window.__glyphGridTest, null, { timeout: 8_000 });

    await page.evaluate((cfg) => {
      const h = window.__glyphGridTest;
      h.setConfig(Object.assign({ seed: 1, record: true }, cfg));
      window.__recStore = null;
      h.beginRecord({ total: 5, fps: 30, onFinish: (b) => { window.__recStore = b; } });
    }, { postprocess: pp });

    const started = Date.now();
    await page.waitForFunction(
      (n) => { const s = window.__glyphGridTest.getRecState(); return s && s.frameIdx >= n; },
      5, { timeout: timeoutMs }
    );
    const png = await (await page.$('canvas')).screenshot({ type: 'png' });
    writeFileSync(join(OUT, `${name}.png`), png);
    const realErrors = errors.filter(e => !/sparky\.png/.test(e) && !/INVALID_OPERATION/.test(e));
    console.log(`[PASS] ${name} (${Date.now() - started} ms, ${realErrors.length} err)`);
    if (realErrors.length) realErrors.forEach(e => console.log('  err:', e.slice(0, 200)));
  } catch (e) {
    const realErrors = errors.filter(e => !/sparky\.png/.test(e) && !/INVALID_OPERATION/.test(e));
    console.log(`[FAIL] ${name}  (${e.message.split('\n')[0]})`);
    if (realErrors.length) realErrors.forEach(e => console.log('  err:', e.slice(0, 200)));
  }
  await page.close();
}

const browser = await chromium.launch({ args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 800, height: 800 }, deviceScaleFactor: 1 });

await test(ctx, 'crt-only',          { crt: { enabled: true } });
await test(ctx, 'bloom-only',        { bloom: { enabled: true, strength: 0.4 } });
await test(ctx, 'scanlines-only',    { scanlines: { enabled: true, alpha: 0.25 } });
await test(ctx, 'chromatic-only',    { chromaticAberration: { enabled: true, amount: 1.5 } });
await test(ctx, 'phosphor-only',     { phosphorDecay: { enabled: true, persistence: 0.7 } });
await test(ctx, 'vignette-only',     { vignette: { enabled: true, strength: 0.4 } });
await test(ctx, 'barrel-only',       { barrel: { enabled: true, amount: 0.12 } });

await test(ctx, 'bloom+scanlines',   { bloom: { enabled: true, strength: 0.4 },
                                        scanlines: { enabled: true, alpha: 0.25 } });
await test(ctx, 'bloom+chromatic',   { bloom: { enabled: true, strength: 0.4 },
                                        chromaticAberration: { enabled: true, amount: 1.5 } });
await test(ctx, 'crt+bloom',         { crt: { enabled: true },
                                        bloom: { enabled: true, strength: 0.4 } });

await browser.close();
