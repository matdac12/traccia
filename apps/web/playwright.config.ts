import { defineConfig } from "@playwright/test";
import { E2E_LOGIN, LOGIN_HEADER, WEB_PORT } from "./e2e/support/ports";

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  // One shared database and one dev server: scenarios run one at a time, each on its own data.
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"]],
  outputDir: "./e2e/.results",
  use: {
    baseURL: `http://127.0.0.1:${WEB_PORT}`,
    extraHTTPHeaders: { [LOGIN_HEADER]: E2E_LOGIN },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
