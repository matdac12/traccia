// Bundles the api into dist/ so production runs plain `node` (no tsx).
// better-sqlite3 stays external: its prebuilt .node binary loads from node_modules.
import { cpSync, rmSync } from "node:fs";
import { build } from "esbuild";

rmSync("dist", { recursive: true, force: true });

await build({
  entryPoints: { main: "src/main.ts", tracker: "src/cli/index.ts" },
  outdir: "dist",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  external: ["better-sqlite3"],
  // Some bundled CJS dependencies call require() on node builtins.
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
});

// migrate.ts resolves ./migrations relative to the bundle.
cpSync("src/db/migrations", "dist/migrations", { recursive: true });
