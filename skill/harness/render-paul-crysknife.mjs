/* Render paul-crysknife piece. Copy of render-paul.mjs, different PIECE_DIR. */
import { chromium } from 'playwright';
import { createReadStream, readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, resolve, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import JSZip from 'jszip';
import GIFEncoder from 'gif-encoder-2';
import { PNG } from 'pngjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PIECE_DIR = resolve(__dirname, '..', '..', 'pieces', 'paul-crysknife');
const OUT_GIF  = process.argv[2] || resolve(homedir(), 'Downloads', 'paul-crysknife.gif');
const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff': 'font/woff', '.woff2': 'font/woff2' };

const server = await new Promise((r) => {
  const s = createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p === '/') p = '/index.html';
    const fp = join(PIECE_DIR, p);
    if (!existsSync(fp) || !statSync(fp).isFile()) { res.statusCode = 404; return res.end(); }
    res.setHeader('Content-Type', MIME[extname(fp)] || 'application/octet-stream');
    createReadStream(fp).pipe(res);
  });
  s.listen(0, '127.0.0.1', () => r(s));
});
const url = 'http://127.0.0.1:' + server.address().port + '/';
console.log('serving', url);

const browser = await chromium.launch({ args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1024, height: 600 }, deviceScaleFactor: 1, acceptDownloads: true });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.warn('[err]', e.message.slice(0, 200)));
await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction(() => !!window.__glyphGridTest, null, { timeout: 15000 });

const total = parseInt(process.env.GG_FRAMES || '60', 10);
const downloadP = page.waitForEvent('download', { timeout: 600000 });
await page.evaluate((t) => {
  const h = window.__glyphGridTest;
  h.setConfig({ seed: 1337, record: true });
  h.beginRecord({ total: t, fps: 30 });
}, total);

const started = Date.now();
let last = -1;
const poll = setInterval(async () => {
  try {
    const idx = await page.evaluate(() => {
      const rs = window.__glyphGridTest.getRecState();
      return rs ? rs.frameIdx : 0;
    });
    if (idx !== last) {
      process.stdout.write('\r  ...frame ' + idx + '/' + total + ' (' + ((Date.now()-started)/1000).toFixed(1) + 's)     ');
      last = idx;
    }
  } catch (_) {}
}, 500);

const download = await downloadP;
clearInterval(poll);
process.stdout.write('\n');
const TMP = '/tmp/paul-crysknife-render.zip';
await download.saveAs(TMP);
console.log('zip →', statSync(TMP).size, 'bytes');

const zip = await JSZip.loadAsync(readFileSync(TMP));
const names = Object.keys(zip.files).filter((n) => n.endsWith('.png')).sort();
const frames = [];
for (const n of names) frames.push(await zip.files[n].async('nodebuffer'));
const first = PNG.sync.read(frames[0]);
const enc = new GIFEncoder(first.width, first.height, 'neuquant', true);
enc.setDelay(Math.round(1000/30));
enc.setRepeat(0); enc.setQuality(10); enc.start();
for (const f of frames) enc.addFrame(PNG.sync.read(f).data);
enc.finish();
writeFileSync(OUT_GIF, enc.out.getData());
console.log('✓', OUT_GIF, statSync(OUT_GIF).size, 'bytes');
for (const i of [0, Math.floor(frames.length/2), frames.length-1]) {
  writeFileSync('/tmp/paul-crysknife-f' + String(i).padStart(2, '0') + '.png', frames[i]);
}
await browser.close();
server.close();
