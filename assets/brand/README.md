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

## Where it is used

- Favicon and app icon: `apps/web/app/icon.png`, `apps/web/app/apple-icon.png`.
- Dashboard sidebar and mobile header: `apps/web/components/traccia/traccia-mark.tsx`.
- README banner: the lockups above.
- Dashboard tokens: `--brand` is `#FF9E0B` and `--agent` is `#06B6D4` in `apps/web/app/globals.css`.
