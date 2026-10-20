import { expect, test } from "@playwright/test";
import { apiClient, createIssue, type E2eApi } from "./support/api";
import { visit } from "./support/visit";

let api: E2eApi;
let projectId: string;
const title = (name: string) => `${name} ${Date.now()}`;
test.beforeAll(() => {
  api = apiClient(process.env.E2E_API_URL!, process.env.E2E_API_TOKEN!);
  projectId = process.env.E2E_PROJECT_ID!;
});

test("list issue peek preserves the list, edits properties and returns focus on close", async ({ page }) => {
  const first = await createIssue(api, projectId, title("Peek first"), "todo");
  const second = await createIssue(api, projectId, title("Peek second"), "todo");
  await api.patch(`/issues/${first.identifier}`, { description: "Description inside the peek", blockedBy: [second.identifier] });
  await visit(page, `/issues?project=${projectId}&status=todo`);
  const originalUrl = page.url();
  const trigger = page.getByRole("link", { name: first.title, exact: true });
  await trigger.click();
  const peek = page.getByRole("dialog", { name: "Issue peek" });
  await expect(peek).toBeVisible();
  expect(page.url()).toBe(originalUrl);
  await expect(peek.getByLabel("Title", { exact: true })).toHaveValue(first.title);
  await expect(peek.getByText("Description inside the peek", { exact: true })).toBeVisible();
  await expect(peek.getByRole("link", { name: "Full issue" })).toHaveAttribute("href", `/issues/${first.identifier}`);
  await expect(peek.getByRole("heading", { name: /Blocked by/ })).toBeVisible();
  await expect(peek.getByText("Activity and comments", { exact: true })).toBeVisible();
  await peek.getByRole("button", { name: "Priority", exact: true }).click();
  await page.getByRole("menuitem", { name: "High", exact: true }).click();
  await expect.poll(async () => (await api.get<{ priority: number }>(`/issues/${first.identifier}`)).priority).toBe(2);
  await expect(peek.getByRole("button", { name: "Priority", exact: true })).toContainText("High");
  // Re-rendering the list's display controls must not reset saved peek state to its initial fetch.
  await page.getByRole("button", { name: "Display", exact: true }).click();
  await page.getByRole("menuitemcheckbox", { name: "Estimate", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(peek.getByRole("button", { name: "Priority", exact: true })).toContainText("High");
  // Non-modal desktop peek keeps the list usable, including switching to another issue.
  await page.getByRole("link", { name: second.title, exact: true }).first().click();
  await expect(peek.getByLabel("Title", { exact: true })).toHaveValue(second.title);
  await page.keyboard.press("Escape");
  await expect(peek).toBeHidden();
  await expect(page.getByRole("link", { name: second.title, exact: true })).toBeFocused();
  expect(page.url()).toBe(originalUrl);
});

test("blockers and compact labels remain visible while metadata columns are optional", async ({ page }) => {
  const issue = await createIssue(api, projectId, title("Metadata"), "todo");
  const blocker = await createIssue(api, projectId, title("Dependency"), "in_progress");
  const names = [title("api"), title("docs"), title("ux")];
  for (const name of names) await api.post("/labels", { name, color: "#a78bfa", projectId });
  await api.patch(`/issues/${issue.identifier}`, { labels: names, estimate: 3, blockedBy: [blocker.identifier] });
  await visit(page, `/issues?project=${projectId}&status=todo`);
  const badge = page.getByRole("button", { name: `Blocked by ${blocker.identifier}: ${blocker.title}`, exact: true });
  await expect(badge).toBeVisible();
  await badge.focus();
  await expect(page.getByRole("tooltip")).toContainText(blocker.title);
  await expect(page.getByRole("dialog", { name: "Issue peek" })).toBeHidden();
  const labels = page.getByRole("button", { name: `Change labels of ${issue.identifier}` });
  await expect(labels).toContainText(names[0]!);
  await expect(labels).toContainText(names[1]!);
  await expect(labels).toContainText("+1");
  await expect(labels).not.toContainText(names[2]!);
  await labels.click();
  await expect(page.getByRole("menuitem", { name: names[2]!, exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Issue peek" })).toBeHidden();
  await page.getByRole("button", { name: "Display", exact: true }).click();
  for (const column of ["Milestone", "Assignee", "Estimate", "Updated"]) {
    const option = page.getByRole("menuitemcheckbox", { name: column, exact: true });
    await expect(option).toHaveAttribute("aria-checked", "true");
    await option.click();
    await expect(option).toHaveAttribute("aria-checked", "false");
  }
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: `Change assignee of ${issue.identifier}` })).toBeHidden();
  await expect(page.getByText("Est.", { exact: true })).toBeHidden();
  await expect(badge).toBeVisible();
  await page.getByRole("link", { name: issue.title, exact: true }).click();
  const peek = page.getByRole("dialog", { name: "Issue peek" });
  await expect(peek.getByRole("button", { name: "Labels", exact: true })).toContainText(names[2]!);
  await expect(peek.getByRole("button", { name: "Estimate", exact: true })).toContainText("3");
  await peek.getByRole("button", { name: "Close peek" }).click();
  await api.patch(`/issues/${blocker.identifier}`, { status: "done" });
  await page.getByTitle("Refresh now").click();
  await expect(badge).toBeHidden();
});

test("multiple blockers, mobile peek, keyboard opening and full-page navigation", async ({ page }) => {
  const issue = await createIssue(api, projectId, title("Mobile peek"), "todo");
  const a = await createIssue(api, projectId, title("First blocker"));
  const b = await createIssue(api, projectId, title("Second blocker"));
  await api.patch(`/issues/${issue.identifier}`, { blockedBy: [a.identifier, b.identifier] });
  await page.setViewportSize({ width: 390, height: 844 });
  await visit(page, `/projects/${projectId}/issues?status=todo`);
  await expect(page.getByRole("button", { name: `Blocked by ${a.identifier}: ${a.title}; ${b.identifier}: ${b.title}`, exact: true })).toContainText("2 blockers");
  const link = page.getByRole("link", { name: issue.title, exact: true });
  await link.focus();
  await page.keyboard.press("Enter");
  const peek = page.getByRole("dialog", { name: "Issue peek" });
  await expect(peek).toBeVisible();
  const box = await peek.boundingBox();
  expect(box?.x).toBe(0);
  expect(box?.width).toBe(390);
  await page.setViewportSize({ width: 700, height: 844 });
  await expect.poll(async () => (await peek.boundingBox())?.width).toBe(700);
  await peek.getByRole("link", { name: "Full issue", exact: true }).focus();
  await page.keyboard.press("Shift+Tab");
  expect(await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'))).toBe(true);
  await page.keyboard.press("Escape");
  await expect(peek).toBeHidden();
  await expect(link).toBeFocused();
  await link.click();
  await peek.getByRole("link", { name: "Full issue", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/issues/${issue.identifier}$`));
  await expect(page.getByLabel("Title", { exact: true })).toHaveValue(issue.title);
});

test("peek keeps a description draft after a concurrent edit and reports the conflict", async ({ page }) => {
  const issue = await createIssue(api, projectId, title("Conflict peek"), "todo");
  await api.patch(`/issues/${issue.identifier}`, { description: "Original description" });
  await visit(page, `/issues?project=${projectId}&status=todo`);
  await page.getByRole("link", { name: issue.title, exact: true }).click();
  const peek = page.getByRole("dialog", { name: "Issue peek" });
  await peek.getByRole("button", { name: "Edit", exact: true }).click();
  await peek.getByLabel("Description", { exact: true }).fill("My unsaved draft");
  await api.patch(`/issues/${issue.identifier}`, { description: "Changed elsewhere" });
  await peek.getByRole("button", { name: "Save", exact: true }).click();
  await expect(peek.getByRole("alert")).toContainText("not saved");
  await expect(peek.getByLabel("Description", { exact: true })).toHaveValue("My unsaved draft");
  await expect.poll(async () => (await api.get<{ description: string }>(`/issues/${issue.identifier}`)).description).toBe("Changed elsewhere");
});

test("manual refresh updates the peek parent and focus returns after status regrouping", async ({ page }) => {
  const issue = await createIssue(api, projectId, title("Refresh peek"), "todo");
  const parent = await createIssue(api, projectId, title("Peek parent"), "todo");
  await visit(page, `/issues?project=${projectId}`);
  await page.getByRole("link", { name: issue.title, exact: true }).click();
  const peek = page.getByRole("dialog", { name: "Issue peek" });
  await expect(peek.getByRole("button", { name: "No parent", exact: true })).toBeVisible();
  await api.patch(`/issues/${issue.identifier}`, { parentId: parent.id, description: "Manually refreshed description" });
  await peek.getByRole("button", { name: "Refresh issue and list", exact: true }).click();
  await expect(peek.getByText("Manually refreshed description", { exact: true })).toBeVisible();
  await expect(peek.getByRole("button", { name: "Remove parent" })).toBeVisible();
  const renamed = title("Renamed parent");
  await api.patch(`/issues/${parent.identifier}`, { title: renamed });
  await peek.getByRole("button", { name: "Refresh issue and list", exact: true }).click();
  await expect(peek.getByRole("link", { name: new RegExp(renamed) }).first()).toBeVisible();
  await peek.getByRole("button", { name: "Remove parent" }).click();
  await expect(peek.getByRole("button", { name: "No parent", exact: true })).toBeVisible();
  await peek.getByRole("button", { name: "Status", exact: true }).click();
  await page.getByRole("menuitem", { name: "In Progress" }).click();
  await expect(page.getByRole("region", { name: "In Progress", exact: true }).getByRole("link", { name: issue.title, exact: true })).toBeVisible();
  await peek.getByRole("button", { name: "Close peek" }).click();
  await expect(page.getByRole("link", { name: issue.title, exact: true })).toBeFocused();
});
