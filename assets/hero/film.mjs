// Composes the Traccia product film from the captured dashboard shots: a montage of beats, each a
// short scene render, joined with crossfades. Dark frame, on-brand captions, closing title card.
//
// Usage: node assets/hero/film.mjs
// Prerequisite: assets/hero/shots/*.png from the marketing-assets e2e capture (see README.md).
//
// Writes film.mp4, film.webm and film-still.png to assets/hero.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { encodeH264, ffmpeg, renderFrames } from "./capture.mjs";

const outDir = resolve(import.meta.dirname);
const fps = 30;
const XFADE = 0.7;

const beats = [
  {
    name: "issues",
    scene: "app-scene.html",
    ui: "shots/issues-table.png",
    caption: "Issues, grouped by status.",
    kicker: "Issues",
    duration: 6,
  },
  {
    name: "board",
    scene: "app-scene.html",
    ui: "shots/issues-board.png",
    caption: "Or a board you drag across.",
    kicker: "Board",
    duration: 6,
  },
  {
    name: "search",
    scene: "app-scene.html",
    ui: "shots/issues-search.png",
    caption: "Search across every issue.",
    kicker: "Search",
    duration: 5,
  },
  {
    name: "agent",
    scene: "app-scene.html",
    ui: "shots/board-before.png",
    ui2: "shots/board-after.png",
    caption: "Your agents file their own work.",
    kicker: "Agents",
    duration: 7,
  },
  { name: "title", scene: "titlecard.html", duration: 5 },
];

const work = mkdtempSync(join(tmpdir(), "traccia-film-"));
const clips = [];
for (const beat of beats) {
  const {
    work: beatWork,
    pattern,
    meta,
  } = await renderFrames({
    ...beat,
    frame: "dark",
    width: 1920,
    height: 1080,
    fps,
    duration: beat.duration,
  });
  const clip = join(work, `${beat.name}.mp4`);
  encodeH264(pattern, fps, clip);
  clips.push({ file: clip, duration: beat.duration });
  rmSync(beatWork, { recursive: true, force: true });
  console.log(
    `beat ${beat.name}: ${meta.width}x${meta.height}, ${beat.duration}s`,
  );
}

// Crossfade the clips: offset of transition i is the summed duration of earlier beats minus i gaps.
const inputs = clips.flatMap((clip) => ["-i", clip.file]);
let filter = "";
let previous = "[0:v]";
let offset = 0;
for (let i = 1; i < clips.length; i++) {
  offset += clips[i - 1].duration - XFADE;
  const out = `[v${i}]`;
  filter += `${previous}[${i}:v]xfade=transition=fade:duration=${XFADE}:offset=${offset.toFixed(3)}${out};`;
  previous = out;
}
filter = filter.replace(/;$/, "");

const film = join(outDir, "film.mp4");
ffmpeg([
  ...inputs,
  "-filter_complex",
  filter,
  "-map",
  previous,
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
  film,
]);
ffmpeg([
  "-i",
  film,
  "-c:v",
  "libvpx-vp9",
  "-b:v",
  "0",
  "-crf",
  "33",
  "-pix_fmt",
  "yuv420p",
  join(outDir, "film.webm"),
]);
ffmpeg([
  "-ss",
  "2",
  "-i",
  film,
  "-frames:v",
  "1",
  join(outDir, "film-still.png"),
]);
rmSync(work, { recursive: true, force: true });

const total =
  clips.reduce((sum, clip) => sum + clip.duration, 0) -
  XFADE * (clips.length - 1);
console.log(`film.mp4 / film.webm (${total.toFixed(1)}s), film-still.png`);
