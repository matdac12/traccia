# Traccia brand assets

The identity is two traces on the same trail: an amber trace for `you`, a cyan trace for the agent, converging but never touching. The full rules are in [`brand-guidelines.md`](brand-guidelines.md); the positioning and voice are in [`../../docs/brand/brand-brief.md`](../../docs/brand/brand-brief.md).

The mark reads as a trail first. The negative space between the two strokes is part of the mark, so the traces stay separate at every size and in one flat colour.

## Mark

- `mark/traccia-mark.svg` — the canonical mark. Two strokes, `#FF9E0B` (you) and `#06B6D4` (agent), 28 stroke width, round caps and joins.

Revision: the gap at the closest approach was widened from ~2 units to 36 units in the 512 viewBox, so the two traces stay visibly separate below 48px. Only the two horizontal tails moved; the silhouette, start points, end points and bends are unchanged.

## Icons

- `icons/traccia-icon-16px.png` … `icons/traccia-icon-256px.png` — GitHub avatar and app icon: the mark on near-black `#0B0F14`.
- The 16px file uses a small-size optical variant (36 stroke, wider gap), per `brand-guidelines.md` section 14; 32px and above use the standard geometry.
- `icons/traccia-icon-dark.png` / `icons/traccia-icon-light.png` — the mark on near-black / white, 1024px.
- `icons/traccia-icon-transparent.png` — the mark on transparent, 1024px.
- `icons/traccia-icon-mono-ink.png` / `icons/traccia-icon-mono-white.png` — the mark in one flat colour, 1024px.

## Lockups

- `lockups/traccia-lockup-light.png` / `lockups/traccia-lockup-dark.png` — the mark and the `Traccia` monospace wordmark, 1600x500.

## Social preview

- `social-preview.jpg` — the card live on GitHub (Settings, General, Social preview; the API cannot set it). 1280x640 JPEG, 359 KB, because GitHub rejects files over 1 MB and the grain in this artwork does not compress as a PNG.
- It is a plain crop of `social-preview-artwork-source.jpeg` (928x1232, supplied by Mattia): a 928x464 strip starting 400px from the top, scaled to 1280x640. Redo it with `sips -c 464 928 --cropOffset 400 0 <source> --out crop.png`, `sips -z 640 1280 crop.png`, then save as JPEG at quality 90. It carries no wordmark; the repository name sits next to it in an unfurl.
- `social-preview.png` — the earlier wordmark card, kept as an alternate: two full-width traces (amber above, cyan below, 22 stroke, round caps) framing a centred `Traccia` wordmark and the tagline, set in Geist Mono on `#0B0F14`. The traces converge at the right edge and never touch. Source: `social-preview-src/social-preview.html`; rerun `PW_CORE=<path to playwright-core/package.json> node social-preview-src/render.mjs` (needs Chrome) to regenerate the PNG.
- X caches link cards per URL. After changing the image, test with a throwaway query string (`?v=2`) to force a fresh fetch.

## Where it is used

- Favicon and app icons: `apps/web/app/icon1.png` (16), `icon2.png` (32), `icon3.png` (256) and `apple-icon.png` (180).
- Dashboard sidebar and mobile header: `apps/web/components/traccia/traccia-mark.tsx`.
- README hero and screenshot: `mark/traccia-mark.png`, `../screenshots/list-menu.png`.
- Dashboard tokens: `--brand` is `#FF9E0B` and `--agent` is `#06B6D4` in `apps/web/app/globals.css`.
