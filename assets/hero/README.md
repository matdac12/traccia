# Hero assets

The cinematic product views for the README, the GitHub page and the social cards: the dashboard
floating at a side angle over a chosen background, with a slow camera move and a light sweep. Every
frame comes from code, so any capture is repeatable and nothing is edited by hand.

- `scene.html` is the stage. It reads `bg`, `ui`, `w`, `h` and `panel` from its query string, and
  exposes `window.__seek(u)` for a normalized time `u` in `[0, 1)`. The camera, the background
  parallax, the trail and the light sweep are all a function of `u`, one sine period per loop, so
  the first and last frames join seamlessly.
- `capture.mjs` renders `scene.html` frame by frame with `playwright-core` and encodes with `ffmpeg`.

## Usage

```sh
node assets/hero/capture.mjs                  # 8s 1920x1080 loop from background.png + dashboard-full.png
node assets/hero/capture.mjs --duration 6 --fps 24 --panel 0.62 --name hero-wide
node assets/hero/capture.mjs --ui list-dashboard.png --name hero-list
node assets/hero/capture.mjs --gif            # also write a GIF preview (large, off by default)
```

Outputs land in `assets/hero/`: `<name>.mp4` (H.264), `<name>.webm` (VP9) and `<name>-still.png`
(the mid-loop frame).

Requirements: Node 22 or newer, a Chromium install for `playwright-core` (the repo's
`@playwright/test` provides it), and `ffmpeg` on `PATH` with `libx264` and `libvpx-vp9`.

## Swapping the background

The backdrop is `assets/hero/background.png`, the image Mattia chose. Replace that file and re-run;
every video follows. Use `--bg <name>` to point at another image in this folder instead.

## The UI source

`dashboard-full.png`, `list-dashboard.png` and friends are captures of the dashboard showing the
**Cadence** project, which exists purely for demos (fake data). The UI source must always be Cadence
or another seeded demo project, never a real one. Seeding the demo dataset and capturing it straight
from the running app is tracked in TRC-77 and TRC-74.
