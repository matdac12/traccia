import { expect, type Page, test } from "@playwright/test";
import { type E2eApi, PNG, apiClient, createIssue } from "./support/api";
import { E2E_LOGIN, LOGIN_HEADER, PROJECT_NAME } from "./support/ports";

let api: E2eApi;
let projectId: string;
let n = 0;
/** A title no other scenario uses, so each test only ever sees its own data. */
const unique = (what: string) => `${what} ${Date.now()}-${n++}`;

/**
 * `next dev` serves the HTML before React hydrates, and an early click or file selection is silently lost.
 * `visit` therefore waits until React has attached its handlers to the shell's "New issue" button.
 */
async function visit(page: Page, path: string) {
  const hydrated = () =>
    page.waitForFunction(
      () => {
        const button = [...document.querySelectorAll("nav button")].find((b) => b.textContent?.includes("New issue"));
        return !!button && Object.keys(button).some((k) => k.startsWith("__reactProps"));
      },
      undefined,
      { timeout: 10_000 },
    );
  await page.goto(path);
  // The dev server can hand out a half-compiled bundle right after it compiles a new route; a reload fixes that.
  for (let attempt = 1; ; attempt++) {
    try {
      return await hydrated();
    } catch (err) {
      if (attempt === 4) throw err;
      await page.reload();
    }
  }
}

/** Retries a click until its effect shows, without re-clicking once it did (a menu trigger would toggle shut). */
async function clickUntil(click: () => Promise<void>, done: () => Promise<boolean>) {
  await expect(async () => {
    if (!(await done())) await click();
    expect(await done()).toBe(true);
  }).toPass({ timeout: 20_000 });
}

/** Opens the issue's Status menu and picks `label`. */
async function pickStatus(page: Page, label: string) {
  const item = page.getByRole("menuitem", { name: label });
  await clickUntil(() => page.getByRole("button", { name: "Status" }).click(), () => item.isVisible());
  await item.click();
}

test.beforeAll(() => {
  api = apiClient(process.env.E2E_API_URL as string, process.env.E2E_API_TOKEN as string);
  projectId = process.env.E2E_PROJECT_ID as string;
});

test("the shell loads with the project list", async ({ page }) => {
  await visit(page, "/projects");
  await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();
  const nav = page.getByRole("navigation", { name: "Main" });
  await expect(nav.getByRole("link", { name: PROJECT_NAME })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Trash" })).toBeVisible();
});

test("the desktop sidebar collapses to an icon rail, stays collapsed after a reload, and expands with Ctrl+B", async ({ page }, testInfo) => {
  await visit(page, "/projects");
  const sidebar = page.locator("aside");
  await expect(sidebar).toHaveAttribute("data-collapsed", "false");
  await sidebar.getByRole("button", { name: "Collapse sidebar" }).click();
  await expect(sidebar).toHaveAttribute("data-collapsed", "true");
  await expect(sidebar).toHaveCSS("width", "48px");
  await testInfo.attach("sidebar-collapsed.png", { body: await page.screenshot(), contentType: "image/png" });
  await sidebar.getByRole("link", { name: "Issues" }).hover();
  await expect(page.getByRole("tooltip", { name: "Issues" })).toBeVisible();
  // Persisted in a cookie the server reads: already collapsed on the first paint after a reload.
  await visit(page, "/projects");
  await expect(sidebar).toHaveAttribute("data-collapsed", "true");
  await page.keyboard.press("Control+b");
  await expect(sidebar).toHaveAttribute("data-collapsed", "false");
  await expect(sidebar).toHaveCSS("width", "232px");
  await visit(page, "/projects");
  await expect(sidebar).toHaveAttribute("data-collapsed", "false");
});

test("the mobile drawer is the full menu even when the desktop sidebar is collapsed", async ({ page }) => {
  await visit(page, "/projects");
  await page.locator("aside").getByRole("button", { name: "Collapse sidebar" }).click();
  await expect(page.locator("aside")).toHaveAttribute("data-collapsed", "true");
  await page.setViewportSize({ width: 600, height: 800 });
  await page.getByRole("button", { name: "Open menu" }).click();
  const drawer = page.getByRole("dialog");
  await expect(drawer.getByText("New issue")).toBeVisible();
  await expect(drawer.getByRole("link", { name: PROJECT_NAME })).toBeVisible();
  await expect(drawer.getByRole("button", { name: /sidebar/i })).toHaveCount(0);
  // Leave the (cookie-scoped, per-context) state as found.
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.locator("aside").getByRole("button", { name: "Expand sidebar" }).click();
});

test("creating an issue from the dialog shows it in the table", async ({ page }) => {
  const title = unique("Created from the dialog");
  await visit(page, "/issues");
  await page.getByRole("button", { name: /New issue/ }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Title").fill(title);
  await dialog.getByRole("button", { name: "Create issue" }).click();
  await expect(dialog.getByRole("status")).toContainText("Created");
  await dialog.getByRole("button", { name: "Close", exact: true }).first().click();
  await visit(page, "/issues");
  await expect(page.getByRole("link", { name: new RegExp(title) })).toBeVisible();
});

test("changing the status in the issue detail persists", async ({ page }) => {
  const issue = await createIssue(api, projectId, unique("Status change"));
  await visit(page, `/issues/${issue.identifier}`);
  await pickStatus(page, "Done");
  await expect(page.getByRole("button", { name: "Status" })).toContainText("Done");
  await expect
    .poll(async () => (await api.get<{ status: string }>(`/issues/${issue.identifier}`)).status)
    .toBe("done");
});

test("the issue detail Back button returns to the filtered list without a reload", async ({ page }) => {
  const issue = await createIssue(api, projectId, unique("Back to list"), "todo");
  const listUrl = "/issues?view=kanban&status=todo";
  await visit(page, listUrl);
  await page.evaluate(() => { (window as unknown as { __noReload: boolean }).__noReload = true; });
  await page.getByRole("link", { name: issue.title }).click();
  await expect(page.getByLabel("Title")).toHaveValue(issue.title);
  await page.getByRole("link", { name: "Back" }).click();
  await expect(page).toHaveURL(new RegExp(`${listUrl.replace("?", "\\?")}$`));
  await expect(page.getByRole("region", { name: "Todo" })).toBeVisible();
  // The same document survived: this was client-side history navigation, not a reload.
  expect(await page.evaluate(() => (window as unknown as { __noReload?: boolean }).__noReload)).toBe(true);
});

test("the project page tabs are real navigation: the URL, a reload and Back keep the tab", async ({ page }) => {
  const issue = await createIssue(api, projectId, unique("Tabs issue"), "todo");
  const tabs = page.getByRole("navigation", { name: "Project sections" });
  const current = (name: string) => expect(tabs.getByRole("link", { name })).toHaveAttribute("aria-current", "page");
  await visit(page, `/projects/${projectId}`);
  await current("Overview");
  await expect(page.getByRole("heading", { name: "Milestones" })).toBeVisible();

  await tabs.getByRole("link", { name: "Issues" }).click();
  await expect(page).toHaveURL(new RegExp(`/projects/${projectId}/issues$`));
  await current("Issues");
  await expect(page.getByRole("link", { name: issue.title })).toBeVisible();

  await tabs.getByRole("link", { name: "Activity" }).click();
  await expect(page).toHaveURL(new RegExp(`/projects/${projectId}/activity$`));
  await expect(page.getByRole("link", { name: new RegExp(issue.title) })).toBeVisible();

  await page.reload();
  await current("Activity");
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`/projects/${projectId}/issues$`));
  await current("Issues");
});

test("the issue detail Back button goes to the project page when opened directly", async ({ page }) => {
  const issue = await createIssue(api, projectId, unique("Back from a deep link"));
  await visit(page, `/issues/${issue.identifier}`);
  await page.getByRole("link", { name: "Back" }).click();
  await expect(page).toHaveURL(new RegExp(`/projects/${projectId}$`));
});

test("dragging a card across Kanban columns persists after reload", async ({ page }) => {
  const issue = await createIssue(api, projectId, unique("Drag me"), "todo");
  await visit(page, "/issues?view=kanban");
  const card = page.getByRole("link", { name: issue.title });
  await expect(card).toBeVisible();
  const target = page.getByRole("region", { name: "In Progress" });
  // Grab the identifier label: it is plain text, while the title is a link and the rest are inline-edit buttons.
  const from = await page.getByRole("region", { name: "Todo" }).getByText(issue.identifier, { exact: true }).boundingBox();
  const to = await target.boundingBox();
  if (!from || !to) throw new Error("card or column not laid out");
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  // dnd-kit's pointer sensor needs movement past its activation distance, then hover time over the column.
  await page.mouse.move(from.x + from.width / 2 + 12, from.y + from.height / 2 + 12, { steps: 4 });
  await page.mouse.move(to.x + to.width / 2, to.y + 60, { steps: 20 });
  await page.mouse.up();
  await expect(target.getByRole("link", { name: issue.title })).toBeVisible();
  await expect
    .poll(async () => (await api.get<{ status: string }>(`/issues/${issue.identifier}`)).status)
    .toBe("in_progress");
  await page.reload();
  await expect(page.getByRole("region", { name: "In Progress" }).getByRole("link", { name: issue.title })).toBeVisible();
});

test("uploading an image attachment shows a card and a preview", async ({ page }) => {
  const issue = await createIssue(api, projectId, unique("Attachments"));
  await visit(page, `/issues/${issue.identifier}`);
  await page.getByLabel("Attach files").setInputFiles({ name: "pixel.png", mimeType: "image/png", buffer: PNG });
  const preview = page.getByRole("button", { name: "Preview pixel.png" });
  await expect(preview).toBeVisible({ timeout: 30_000 }); // upload goes through a route the dev server may still be compiling
  await preview.click();
  const image = page.getByRole("dialog").getByRole("img", { name: "pixel.png" });
  await expect(image).toBeVisible({ timeout: 30_000 }); // first image load can wait on a dev-server compile
  // The browser really decoded the bytes served through /api/files/<id>.
  await expect.poll(() => image.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBe(1);
});

test("deleting an issue moves it to Trash and Restore brings it back", async ({ page }) => {
  const issue = await createIssue(api, projectId, unique("Delete and restore"));
  await visit(page, `/issues/${issue.identifier}`);
  const del = page.getByRole("button", { name: "Delete", exact: true });
  await clickUntil(() => del.click(), () => page.getByText("Move to Trash?").isVisible());
  await del.click();
  await expect(page.getByRole("status").filter({ hasText: "moved to Trash" })).toBeVisible();

  await visit(page, "/trash");
  const row = page.getByRole("listitem").filter({ hasText: issue.title });
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "Restore" }).click();
  await expect(row).toHaveCount(0);
  // The row leaves the list before the restore lands; wait until the API serves the issue again.
  await expect.poll(() => api.get(`/issues/${issue.identifier}`).then(() => 200, () => 404)).toBe(200);
  await visit(page, `/issues/${issue.identifier}`);
  await expect(page.getByLabel("Title")).toHaveValue(issue.title);
});

test("a stale change shows the 409 conflict banner and saves nothing", async ({ page }) => {
  const issue = await createIssue(api, projectId, unique("Conflict"));
  // Hold the live-refresh poll back so the page really keeps its stale copy.
  await page.route(/\/api\/issues\/[^/]+$/, (route) => route.abort());
  await visit(page, `/issues/${issue.identifier}`);
  await expect(page.getByLabel("Title")).toHaveValue(issue.title);

  await api.patch(`/issues/${issue.identifier}`, { priority: 1 }, { "if-match": issue.updatedAt });

  await pickStatus(page, "Done");
  const banner = page.getByRole("alert").filter({ hasText: "was changed by someone else" });
  await expect(banner).toContainText("not saved");
  await expect(banner.getByRole("button", { name: "Re-apply my change" })).toBeVisible();
  expect((await api.get<{ status: string }>(`/issues/${issue.identifier}`)).status).toBe("backlog");
});

test("requests without a valid identity header get 403", async ({ browser }) => {
  const base = test.info().project.use.baseURL as string;
  for (const headers of [{}, { [LOGIN_HEADER]: "stranger@local" }] as Record<string, string>[]) {
    const context = await browser.newContext({ extraHTTPHeaders: headers });
    const page = await context.newPage();
    const response = await page.goto(`${base}/issues`);
    expect(response?.status()).toBe(403);
    await expect(page.getByRole("heading", { name: "Access denied" })).toBeVisible();
    expect((await context.request.get(`${base}/api/issues/changes`)).status()).toBe(403);
    await context.close();
  }
  // Control: the allowlisted login is let in.
  const ok = await browser.newContext({ extraHTTPHeaders: { [LOGIN_HEADER]: E2E_LOGIN } });
  expect((await ok.request.get(`${base}/healthz`)).status()).toBe(200);
  await ok.close();
});

for (const scheme of ["light", "dark"] as const) {
  test(`the ${scheme} theme renders the issues page`, async ({ browser }, testInfo) => {
    const context = await browser.newContext({ colorScheme: scheme });
    const page = await context.newPage();
    await page.goto(`${testInfo.project.use.baseURL}/issues`);
    await expect(page.getByRole("heading", { name: "Issues" })).toBeVisible();
    await expect(page.locator("html")).toHaveClass(scheme === "dark" ? /dark/ : /^((?!dark).)*$/);
    const luminance = await page.evaluate(() => {
      const [r, g, b] = getComputedStyle(document.body).backgroundColor.match(/\d+(\.\d+)?/g)!.map(Number);
      return (0.2126 * r! + 0.7152 * g! + 0.0722 * b!) / 255;
    });
    // Visual smoke: the page is light on light and dark on dark, not a pixel comparison.
    if (scheme === "dark") expect(luminance).toBeLessThan(0.3);
    else expect(luminance).toBeGreaterThan(0.7);
    await testInfo.attach(`issues-${scheme}.png`, { body: await page.screenshot(), contentType: "image/png" });
    await context.close();
  });
}
