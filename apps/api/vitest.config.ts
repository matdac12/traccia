import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // Slow fixtures (600-row pagination, child processes) and the pre-push hook
    // running both packages in parallel: the 5 s default flakes on a loaded machine.
    testTimeout: 20_000,
  },
});
