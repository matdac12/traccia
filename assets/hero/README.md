# Hero assets

Cinematic product views for the README, the GitHub page and social cards. The dashboard fills the
frame with a slim margin, the chosen background shows **inside** the app (through its own background
feature), and a slow, loop-safe drift and light sweep keep it alive. Every frame comes from code.

## Pipeline

Two steps, both free and repeatable.

**1. Capture the real dashboard.** `apps/web/e2e/marketing-assets.spec.ts` boots the app, seeds the
Cadence demo project (fake data), applies `assets/hero/background.png` through the app's own client
storage, and screenshots the Issues views at retina resolution into `assets/hero/shots/`.

```sh
TRACCIA_HERO_CAPTURE=1 pnpm --filter web test:e2e marketing-assets
```

**2. Compose the video.** `capture.mjs` renders `app-scene.html` frame by frame with
`playwright-core` and encodes with `ffmpeg`.

```sh
node assets/hero/capture.mjs --ui shots/issues-table.png --name issues-loop
node assets/hero/capture.mjs --ui shots/issues-board.png --name board-loop
```

Outputs: `<name>.mp4` (H.264), `<name>.webm` (VP9) and `<name>-still.png` (the mid-loop frame).
Generated media is git-ignored; regenerate it with the two commands above.

`app-scene.html` is the stage. It reads `bg`, `ui`, `w`, `h` and `pad` from its query string and
exposes `window.__seek(u)` for a normalized time `u` in `[0, 1)`. The panel drift, the backdrop
parallax and the light sweep are all a function of `u`, one sine period per loop, so the first and
last frames join seamlessly.

## Swapping the background

Replace `assets/hero/background.png` with the chosen image and re-run both steps; every video
follows. The UI source is always the Cadence demo project (fake data), never a real one.

## Requirements

Node 22 or newer, a Chromium install for `playwright-core` (the repo's `@playwright/test` provides
it), and `ffmpeg` on `PATH` with `libx264` and `libvpx-vp9`.
