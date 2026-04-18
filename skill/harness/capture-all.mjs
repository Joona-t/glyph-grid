/* capture-all.mjs — capture the full animation by driving the page's own
 * recorder. Calls beginRecord with an onFinish that stashes the ZIP blob
 * back to window, waits for it, then dumps frames to disk.
 *
 *   node capture-all.mjs <piece_url_or_path> <out_dir> [seed] [total] [fps]
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

const [,, pieceArg, outArg, seedArg, totalArg, fpsArg] = process.argv;
if (!pieceArg || !outArg) {
  console.error('usage: node capture-all.mjs <piece> <out_dir> [seed] [total] [fps]');
  process.exit(1);
}
const piece  = pieceArg.startsWith('http') ? pieceArg : resolve(pieceArg);
const outDir = resolve(outArg);
const seed   = parseInt(seedArg  ?? '708', 10);
const total  = parseInt(totalArg ?? '180', 10);
const fps    = parseInt(fpsArg   ?? '30',  10);

if (existsSync(outDir)) rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ args: ['--no-sandbox'] });
const ctx = await browser.newContext({
  viewport: { width: 960, height: 960 },
  deviceScaleFactor: 1,
});
const page = await ctx.newPage();
const url = piece.startsWith('http') ? piece : 'file://' + piece;
console.log('-> opening', url);
await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction(() => !!window.__glyphGridTest, null, { timeout: 15_000 });

/* Drive the page's native recorder and stash the resulting blob on window. */
await page.evaluate(({ seed, total, fps }) => {
  const hook = window.__glyphGridTest;
  hook.setConfig({ seed });
  window.__recordedB64 = null;
  hook.beginRecord({
    total, fps,
    onFinish: async (blob) => {
      const buf = await blob.arrayBuffer();
      const u8 = new Uint8Array(buf);
      /* Encode to base64 in chunks to stay under string-length limits. */
      let out = '';
      for (let i = 0; i < u8.length; i += 0x8000) {
        out += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
      }
      window.__recordedB64 = btoa(out);
    },
  });
}, { seed, total, fps });

console.log(`-> recording ${total} frames @ ${fps}fps (page builds a JSZip natively)`);
await page.waitForFunction(() => !!window.__recordedB64, null, { timeout: 300_000 });
const b64 = await page.evaluate(() => window.__recordedB64);
await browser.close();

/* Write ZIP to disk and extract frames. */
const zipPath = resolve(outDir, '_frames.zip');
writeFileSync(zipPath, Buffer.from(b64, 'base64'));
console.log(`-> wrote ${zipPath} (${(Buffer.from(b64, 'base64').length / 1024 / 1024).toFixed(2)} MB)`);

/* Unzip: shell out to system unzip (avoids adding a JS dep). */
const { spawnSync } = await import('node:child_process');
const un = spawnSync('unzip', ['-q', '-o', zipPath, '-d', outDir], { stdio: 'inherit' });
if (un.status !== 0) { console.error('unzip failed'); process.exit(1); }
rmSync(zipPath);
console.log(`-> extracted to ${outDir}`);
