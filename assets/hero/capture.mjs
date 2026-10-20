// Renders a hero scene (app-scene.html or titlecard.html) to a seamless frame sequence, and encodes
// it, with a deterministic frame-by-frame camera move. Free and repeatable: Chromium via
// playwright-core, then ffmpeg. Used directly for a single loop, and by film.mjs for the montage.
//
// Usage: node assets/hero/capture.mjs [--duration 8] [--fps 30] [--width 1920] [--height 1080]
//   [--pad 0.032] [--scene app-scene.html] [--frame blur|dark] [--bg background.png]
//   [--ui shots/issues-table.png] [--ui2 shots/board-after.png] [--caption "..." ] [--kicker "..." ]
//   [--name issues-loop] [--gif]
//
// Writes <name>.mp4, <name>.webm and <name>-still.png to assets/hero. --gif also writes a GIF
// (large with a photographic backdrop, so it is off by default).

import { execFileSync } from "node:child_process";
import { copyFileSync, mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const heroDir = resolve(import.meta.dirname);
const root = resolve(heroDir, "../..");

// playwright-core is a transitive dependency of @playwright/test, so under pnpm it is not linked
// into apps/web/node_modules; resolve it from @playwright/test's own tree.
const webRequire = createRequire(join(root, "apps/web/package.json"));
const { chromium } = createRequire(webRequire.resolve("@playwright/test"))(
  "playwright-core",
);

export function ffmpeg(args) {
  execFileSync(
    "ffmpeg",
    ["-y", "-hide_banner", "-loglevel", "error", ...args],
    { stdio: "inherit" },
  );
}

export function encodeH264(pattern, fps, out) {
  ffmpeg([
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
    out,
  ]);
}

export function encodeVp9(pattern, fps, out) {
  ffmpeg([
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
    out,
  ]);
}

/** Renders one scene to a numbered PNG sequence in a temp dir and returns its pattern. */
export async function renderFrames({
  scene,
  ui = "",
  ui2 = "",
  bg = "background.png",
  caption = "",
  kicker = "",
  frame = "blur",
  width = 1920,
  height = 1080,
  pad = 0.032,
  duration,
  fps,
}) {
  const frames = Math.round(duration * fps);
  if (!Number.isFinite(frames) || frames < 2)
    throw new Error("bad duration/fps");
  const work = mkdtempSync(join(tmpdir(), "traccia-hero-"));
  const query = new URLSearchParams({
    w: String(width),
    h: String(height),
    pad: String(pad),
    frame,
    bg,
    ui,
    ui2,
    caption,
    kicker,
  });
  const url = `file://${join(heroDir, scene)}?${query}`;

  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({
      viewport: { width, height },
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();
    await page.goto(url, { waitUntil: "load" });
    await page.evaluate(() => window.__ready);
    const meta = await page.evaluate(() => window.__meta);
    for (let i = 0; i < frames; i++) {
      await page.evaluate((u) => window.__seek(u), i / frames);
      await page.screenshot({
        path: join(work, `frame-${String(i + 1).padStart(5, "0")}.png`),
      });
    }
    await context.close();
    return { work, pattern: join(work, "frame-%05d.png"), frames, meta };
  } finally {
    await browser.close();
  }
}

// ---- CLI ----

function parseArgs(argv) {
  const args = new Map();
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i].replace(/^--/, "");
    if (key === "gif") {
      args.set("gif", "true");
      continue;
    }
    args.set(key, argv[++i]);
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const get = (key, fallback) => args.get(key) ?? fallback;
  const duration = Number(get("duration", 8));
  const fps = Number(get("fps", 30));
  const name = get("name", "issues-loop");
  const outDir = resolve(root, get("out", "assets/hero"));
  const wantGif = get("gif", "false") === "true";
  mkdirSync(outDir, { recursive: true });

  const { work, pattern, frames, meta } = await renderFrames({
    scene: get("scene", "app-scene.html"),
    ui: get("ui", "shots/issues-table.png"),
    ui2: get("ui2", ""),
    bg: get("bg", "background.png"),
    caption: get("caption", ""),
    kicker: get("kicker", ""),
    frame: get("frame", "blur"),
    width: Number(get("width", 1920)),
    height: Number(get("height", 1080)),
    pad: Number(get("pad", 0.032)),
    duration,
    fps,
  });
  console.log(
    `scene ${meta?.width}x${meta?.height ?? "?"}, ${frames} frames @ ${fps}fps`,
  );

  // The still is the mid-loop frame, the view a reader sees first.
  copyFileSync(
    join(work, `frame-${String(Math.round(frames / 2)).padStart(5, "0")}.png`),
    join(outDir, `${name}-still.png`),
  );
  encodeH264(pattern, fps, join(outDir, `${name}.mp4`));
  encodeVp9(pattern, fps, join(outDir, `${name}.webm`));
  if (wantGif) {
    ffmpeg([
      "-i",
      join(outDir, `${name}.mp4`),
      "-vf",
      "fps=15,scale=960:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse",
      "-loop",
      "0",
      join(outDir, `${name}.gif`),
    ]);
  }
  rmSync(work, { recursive: true, force: true });
  console.log(
    [
      `${name}.mp4`,
      `${name}.webm`,
      ...(wantGif ? [`${name}.gif`] : []),
      `${name}-still.png`,
    ].join("\n"),
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await main();
}
