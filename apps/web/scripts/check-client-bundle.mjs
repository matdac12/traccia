// Build-time guard: the API token must never reach the browser.
// Greps the client assets (.next/static) for the token env var name and for a token value.
// Usage: pnpm --filter web check:bundle, or TRACKER_API_TOKEN=<value used for the build> node scripts/check-client-bundle.mjs
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../.next/static", import.meta.url));
const needles = ["TRACKER_API_TOKEN", "TRACKER_API_URL"];
// The value the build ran with (`pnpm check:bundle` builds with a sample token).
const tokenValue = process.env.TRACKER_API_TOKEN;
if (!tokenValue) {
  console.error("Set TRACKER_API_TOKEN to the value the build used (or run `pnpm check:bundle`).");
  process.exit(2);
}
needles.push(tokenValue);

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else yield p;
  }
}

let files = 0;
const hits = [];
for (const file of walk(root)) {
  files++;
  const text = readFileSync(file, "utf8");
  for (const needle of needles) if (text.includes(needle)) hits.push(`${file}: ${needle === tokenValue ? "<token value>" : needle}`);
}
if (files === 0) {
  console.error(`No files under ${root}: run \`pnpm --filter web build\` first.`);
  process.exit(2);
}
if (hits.length) {
  console.error(`Server secrets found in the client bundle:\n${hits.join("\n")}`);
  process.exit(1);
}
console.log(`check:bundle ok (${files} client files, ${needles.length} needles)`);
