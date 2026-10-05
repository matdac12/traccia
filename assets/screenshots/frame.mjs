// Frames raw screenshots on the brand ink background: a darkened, blurred copy of the shot behind it, faint
// amber and cyan glows, rounded corners, a soft shadow. The shot stays at 1:1 pixels (only padding is added).
// Usage: PW_CORE=/path/to/playwright-core/package.json node frame.mjs <in-dir> <out-dir>
// Every .png in <in-dir> becomes <out-dir>/<same name>. Needs playwright-core and Chrome.

import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const require = createRequire(process.env.PW_CORE ?? import.meta.url);
const { chromium } = require("playwright-core");

const [inDir, outDir] = process.argv.slice(2).map((p) => resolve(p));
if (!inDir || !outDir)
  throw new Error("usage: node frame.mjs <in-dir> <out-dir>");
mkdirSync(outDir, { recursive: true });
const PAD = 160;
const work = mkdtempSync(join(tmpdir(), "traccia-frame-"));
const browser = await chromium.launch({ channel: "chrome" });

for (const name of readdirSync(inDir)
  .filter((f) => f.endsWith(".png"))
  .sort()) {
  copyFileSync(join(inDir, name), join(work, "shot.png"));
  // Read the size from the image itself, so any screenshot size works.
  const probe = await browser.newPage();
  await probe.goto(`file://${join(work, "shot.png")}`);
  const { w, h } = await probe.evaluate(() => {
    const im = document.images[0];
    return { w: im.naturalWidth, h: im.naturalHeight };
  });
  await probe.close();

  const page = await browser.newPage({
    viewport: { width: w + PAD * 2, height: h + PAD * 2 },
  });
  writeFileSync(
    join(work, "page.html"),
    `<style>
  *{margin:0}
  body{width:${w + PAD * 2}px;height:${h + PAD * 2}px;overflow:hidden;background:#0b0f14;position:relative}
  .bg{position:absolute;inset:-200px;background:url("shot.png") center/cover;filter:blur(70px) brightness(.38) saturate(1.1)}
  .glow{position:absolute;inset:0;background:radial-gradient(2000px 1100px at 18% -8%,rgba(255,158,11,.14),transparent 62%),radial-gradient(2200px 1200px at 88% 110%,rgba(6,182,212,.14),transparent 64%)}
  img{position:absolute;left:${PAD}px;top:${PAD}px;width:${w}px;height:${h}px;border-radius:28px;box-shadow:0 0 0 2px rgba(255,255,255,.09),0 90px 160px -40px rgba(0,0,0,.8),0 30px 70px -20px rgba(0,0,0,.6)}
</style><div class="bg"></div><div class="glow"></div><img src="shot.png" alt="">`,
  );
  await page.goto(`file://${join(work, "page.html")}`);
  await page.evaluate(() =>
    Promise.all([...document.images].map((im) => im.decode())),
  );
  await page.screenshot({ path: join(outDir, name) });
  await page.close();
  console.log(name);
}
await browser.close();
