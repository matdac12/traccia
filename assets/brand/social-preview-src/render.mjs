// Renders social-preview.html to ../social-preview.png (1280x640).
// Needs playwright-core and Chrome: PW_CORE=/path/to/playwright-core/package.json node render.mjs
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const require = createRequire(process.env.PW_CORE ?? import.meta.url);
const { chromium } = require("playwright-core");
const dir = dirname(fileURLToPath(import.meta.url));
const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1280, height: 640 } });
await page.goto(`file://${join(dir, "social-preview.html")}`);
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: join(dir, "..", "social-preview.png") });
await browser.close();
