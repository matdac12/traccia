// Renders the Traccia hero scene (scene.html) to a seamless video loop, a WebM, a GIF preview and a
// still, with a deterministic frame-by-frame camera move. Free and repeatable: Chromium via
// playwright-core, then ffmpeg. No timeline, no editing, the scene is code.
//
// Usage: node assets/hero/capture.mjs [--duration 8] [--fps 30] [--width 1920] [--height 1080]
//   [--pad 0.032] [--scene app-scene.html] [--bg background.png] [--ui shots/issues-table.png]
//   [--name issues-loop] [--gif]
//
// Produces <name>.mp4, <name>.webm and <name>-still.png in assets/hero. Pass --gif for a GIF
// preview as well (a photographic backdrop makes it large, so it is off by default).
//
// Requirements: playwright-core (a repo dependency, resolved through apps/web) with a Chromium
// install, and ffmpeg on PATH with libx264 and libvpx-vp9.

import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const heroDir = resolve(import.meta.dirname);
const root = resolve(heroDir, "../..");

const args = new Map();
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const key = argv[i].replace(/^--/, "");
  if (key === "gif") {
    args.set("gif", "true");
    continue;
  }
  args.set(key, argv[++i]);
}
const get = (key, fallback) => args.get(key) ?? fallback;

const duration = Number(get("duration", 8));
const fps = Number(get("fps", 30));
const width = Number(get("width", 1920));
const height = Number(get("height", 1080));
const pad = Number(get("pad", 0.032));
const scene = get("scene", "app-scene.html");
const bg = get("bg", "background.png");
const ui = get("ui", "shots/issues-table.png");
const name = get("name", "issues-loop");
const outDir = resolve(root, get("out", "assets/hero"));
const wantGif = get("gif", "false") === "true";

const frames = Math.round(duration * fps);
if (!Number.isFinite(frames) || frames < 2) throw new Error("bad duration/fps");

// playwright-core is a transitive dependency of @playwright/test, so under pnpm it is not linked
// into apps/web/node_modules; resolve it from @playwright/test's own tree.
const webRequire = createRequire(join(root, "apps/web/package.json"));
const { chromium } = createRequire(webRequire.resolve("@playwright/test"))(
  "playwright-core",
);

mkdirSync(outDir, { recursive: true });
const work = mkdtempSync(join(tmpdir(), "traccia-hero-"));

const url =
  `file://${join(heroDir, scene)}` +
  `?w=${width}&h=${height}&pad=${pad}&bg=${encodeURIComponent(bg)}&ui=${encodeURIComponent(ui)}`;

const ffmpeg = (...ffArgs) =>
  execFileSync(
    "ffmpeg",
    ["-y", "-hide_banner", "-loglevel", "error", ...ffArgs],
    { stdio: "inherit" },
  );

const browser = await chromium.launch();
const pattern = join(work, "frame-%05d.png");
try {
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  await page.goto(url, { waitUntil: "load" });
  await page.evaluate(() => window.__ready);
  const meta = await page.evaluate(() => window.__meta);
  console.log(
    `scene ${meta.width}x${meta.height}, panel ${meta.panelWidth}x${meta.panelHeight}, ${frames} frames @ ${fps}fps`,
  );

  for (let i = 0; i < frames; i++) {
    await page.evaluate((u) => window.__seek(u), i / frames);
    await page.screenshot({
      path: join(work, `frame-${String(i + 1).padStart(5, "0")}.png`),
    });
  }
  await context.close();
} finally {
  await browser.close();
}

// The still is the mid-loop frame, the view a reader sees first.
copyFileSync(
  join(work, `frame-${String(Math.round(frames / 2)).padStart(5, "0")}.png`),
  join(outDir, `${name}-still.png`),
);

ffmpeg(
  "-framerate",
  String(fps),
  "-i",
  pattern,
  "-c:v",
  "libx264",
  "-preset",
  "slow",
  "-crf",
  "18",
  "-pix_fmt",
  "yuv420p",
  "-movflags",
  "+faststart",
  join(outDir, `${name}.mp4`),
);
console.log(`${name}.mp4`);

ffmpeg(
  "-framerate",
  String(fps),
  "-i",
  pattern,
  "-c:v",
  "libvpx-vp9",
  "-b:v",
  "0",
  "-crf",
  "33",
  "-pix_fmt",
  "yuv420p",
  join(outDir, `${name}.webm`),
);
console.log(`${name}.webm`);

if (wantGif) {
  ffmpeg(
    "-i",
    join(outDir, `${name}.mp4`),
    "-vf",
    "fps=15,scale=960:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse",
    "-loop",
    "0",
    join(outDir, `${name}.gif`),
  );
  console.log(`${name}.gif`);
}

rmSync(work, { recursive: true, force: true });
console.log(`${name}-still.png`);
