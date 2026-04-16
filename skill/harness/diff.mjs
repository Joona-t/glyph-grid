/* diff.mjs — golden-vs-capture comparison with ΔE94 histogram.
 *
 *   node diff.mjs <golden.png> <candidate.png> [--threshold <e94>]
 *                                               [--out <diff.png>]
 *
 * Prints a summary:
 *   { pixelsDifferent, deltaE94: { p50, p95, max }, pass: bool }
 *
 * Exit 0 if pass, 1 if fail. Fail means:
 *   (a) images differ in size, OR
 *   (b) any pixel's ΔE94 exceeds threshold (default 1.0 for compat:v1,
 *       2.0 for CPU<->GPU parity; caller chooses).
 *
 * Color math:
 *   sRGB (gamma) -> linear -> CIE XYZ -> CIE L*a*b* -> ΔE94
 *   Reference white D65.
 *
 * ΔE94 formula from CIE 1994. The textile weights (kL=2, K1=0.048, K2=0.014)
 * are NOT used here — we use graphic-arts weights (kL=1, K1=0.045, K2=0.015)
 * which match most image-processing literature.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';

function parseArgs(argv) {
  const out = { golden: null, candidate: null, threshold: 1.0, outPng: null };
  const positional = [];
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--threshold') out.threshold = parseFloat(argv[++i]);
    else if (a === '--out') out.outPng = argv[++i];
    else positional.push(a);
  }
  out.golden = positional[0];
  out.candidate = positional[1];
  if (!out.golden || !out.candidate) {
    console.error('Usage: node diff.mjs <golden.png> <candidate.png> [--threshold N] [--out diff.png]');
    process.exit(2);
  }
  return out;
}

function readPng(path) {
  return PNG.sync.read(readFileSync(path));
}

/* sRGB -> linear (proper piecewise EOTF). */
function srgbToLinear(c) {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

/* Linear RGB -> XYZ (D65). */
function linearToXyz(r, g, b) {
  return [
    r * 0.4124564 + g * 0.3575761 + b * 0.1804375,
    r * 0.2126729 + g * 0.7151522 + b * 0.0721750,
    r * 0.0193339 + g * 0.1191920 + b * 0.9503041,
  ];
}

const Xn = 0.95047, Yn = 1.00000, Zn = 1.08883;
function f(t) {
  const d = 6 / 29;
  return t > d * d * d ? Math.cbrt(t) : (t / (3 * d * d)) + 4 / 29;
}
function xyzToLab(x, y, z) {
  const L = 116 * f(y / Yn) - 16;
  const a = 500 * (f(x / Xn) - f(y / Yn));
  const b = 200 * (f(y / Yn) - f(z / Zn));
  return [L, a, b];
}

function rgbToLab(r, g, b) {
  const lR = srgbToLinear(r), lG = srgbToLinear(g), lB = srgbToLinear(b);
  const [X, Y, Z] = linearToXyz(lR, lG, lB);
  return xyzToLab(X, Y, Z);
}

function deltaE94(lab1, lab2) {
  const [L1, a1, b1] = lab1, [L2, a2, b2] = lab2;
  const C1 = Math.hypot(a1, b1);
  const C2 = Math.hypot(a2, b2);
  const dL = L1 - L2;
  const dC = C1 - C2;
  const da = a1 - a2;
  const db = b1 - b2;
  const dH2 = Math.max(0, da * da + db * db - dC * dC);
  const kL = 1, kC = 1, kH = 1;
  const K1 = 0.045, K2 = 0.015;
  const sL = 1;
  const sC = 1 + K1 * C1;
  const sH = 1 + K2 * C1;
  return Math.sqrt(
    (dL / (kL * sL)) ** 2 +
    (dC / (kC * sC)) ** 2 +
    dH2 / ((kH * sH) ** 2)
  );
}

function quantile(arr, q) {
  if (arr.length === 0) return 0;
  const sorted = Float64Array.from(arr).sort();
  const idx = Math.min(sorted.length - 1, Math.floor(q * sorted.length));
  return sorted[idx];
}

function diff(opts) {
  const A = readPng(opts.golden);
  const B = readPng(opts.candidate);
  if (A.width !== B.width || A.height !== B.height) {
    return { pass: false, reason: 'size-mismatch',
             goldenSize: [A.width, A.height], candidateSize: [B.width, B.height] };
  }

  const W = A.width, H = A.height;
  const out = opts.outPng ? new PNG({ width: W, height: H }) : null;
  const diffCount = pixelmatch(A.data, B.data, out ? out.data : null, W, H,
                               { threshold: 0.1, includeAA: false });

  /* ΔE94 over the full image. */
  const es = [];
  let maxE = 0;
  const N = W * H;
  for (let i = 0; i < N; i++) {
    const j = i * 4;
    if (A.data[j] === B.data[j] && A.data[j+1] === B.data[j+1] && A.data[j+2] === B.data[j+2]) continue;
    const lab1 = rgbToLab(A.data[j], A.data[j+1], A.data[j+2]);
    const lab2 = rgbToLab(B.data[j], B.data[j+1], B.data[j+2]);
    const e = deltaE94(lab1, lab2);
    es.push(e);
    if (e > maxE) maxE = e;
  }

  if (out) writeFileSync(opts.outPng, PNG.sync.write(out));

  const pass = maxE <= opts.threshold;
  return {
    pass,
    pixelsDifferent: diffCount,
    totalPixels: N,
    deltaE94: { p50: quantile(es, 0.5), p95: quantile(es, 0.95), max: maxE, count: es.length },
    threshold: opts.threshold,
  };
}

const opts = parseArgs(process.argv);
const result = diff(opts);
console.log(JSON.stringify(result, null, 2));
process.exit(result.pass ? 0 : 1);
