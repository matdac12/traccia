import type { Page } from "@playwright/test";

/** Wait for shell hydration so early clicks are not silently lost. */
export async function visit(page: Page, path: string) {
  await page.goto(path);
  await page.waitForFunction(
    () => {
      const button = [...document.querySelectorAll("nav button")].find((b) => b.textContent?.includes("New issue"));
      return !!button && Object.keys(button).some((k) => k.startsWith("__reactProps"));
    },
    undefined,
    { timeout: 10_000 },
  );
}
