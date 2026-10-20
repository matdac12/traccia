import { defineConfig } from "vitest/config";

export default defineConfig({
  esbuild: { jsx: "automatic" },
  test: {
    environment: "jsdom",
    include: ["test/**/*.test.{ts,tsx}"],
    setupFiles: ["./test/setup.ts"],
    // The jsdom suites render big trees and the pre-push hook runs the packages
    // in parallel, so the 5 s default flakes on a loaded machine.
    testTimeout: 20_000,
  },
});
