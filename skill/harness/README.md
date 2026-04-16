# harness/ — headless regression against frozen pieces

Goal: every frozen portfolio piece stays byte-identical at frame 0 and stays within ΔE94 < 1 over the full loop when rendered by the new template in `compat: "v1"` mode. Cross-OS / cross-browser parity is guaranteed by the bundled Cascadia WOFF subset (see `../fonts/`).

## Setup (one-time)

```bash
cd harness
npm install
npx playwright install chromium
```

## Capture a single frame

```bash
node capture.mjs --piece ../scripts/render.html --seed 1 --frame 0
```

Writes `captures/<piece>_seed1_f00000.png`.

## Diff against a golden

```bash
node diff.mjs goldens/render-default_seed1_f00000.png captures/render-default_seed1_f00000.png
```

Prints JSON `{ pass, pixelsDifferent, deltaE94: { p50, p95, max }, threshold }`. Exits 0 on pass, 1 on fail.

## Full regression run

```bash
node run.mjs              # all entries in manifest.json
node run.mjs --regen      # regenerate goldens — destructive, commit with intent
```

## Adding a piece to the regression set

1. Edit `manifest.json`:
   ```json
   [
     { "piece": "../scripts/render.html", "seed": 1, "frame": 0, "threshold": 1.0 },
     { "piece": "../../pieces/caduceus/index.html", "seed": 42, "frame": 0, "threshold": 1.0 }
   ]
   ```
2. `node run.mjs --regen` — captures goldens into `goldens/`.
3. Commit the manifest + goldens.
4. Future runs `node run.mjs` will fail if the piece drifts.

## Threshold guidance

- `1.0` — compat v1 frozen pieces. ΔE94 = 1.0 is the just-noticeable-difference.
- `2.0` — compat v2 CPU vs GPU parity. Loose enough to tolerate GPU quantization.
- Fail on **max** ΔE94, not mean: a single blown-out pixel is a real regression.

## How this works

`capture.mjs` launches Chromium, opens the piece, and talks to `window.__glyphGridTest` (defined in `render.html`) to set a seed and advance to a specific frame deterministically. It screenshots the `<canvas>` and writes PNG.

`diff.mjs` reads both PNGs, runs pixelmatch for a quick pass/fail, and computes ΔE94 in CIE L\*a\*b\* (D65) for every differing pixel. Reports quantiles (p50, p95, max).

`run.mjs` chains the two across a manifest and exits non-zero on any fail.

## CI integration

The typical CI wiring:

```yaml
- run: cd skill/harness && npm ci
- run: cd skill/harness && npx playwright install --with-deps chromium
- run: cd skill/harness && node run.mjs
```

No CI yet — this is a local skill. Left documented for when a consumer wires it up.
