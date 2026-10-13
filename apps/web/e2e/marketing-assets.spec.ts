// Marketing asset capture. Not a test: it seeds a rich Cadence demo project, applies the chosen
// background through the real client storage, and screenshots the dashboard views for the hero
// videos. Skipped unless TRACCIA_HERO_CAPTURE=1, so it never runs in the normal suite.
//
// Usage: TRACCIA_HERO_CAPTURE=1 pnpm --filter web test:e2e marketing-assets
//
// Output: assets/hero/shots/*.png (full-resolution, background applied).

import { mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { apiClient, type E2eApi } from "./support/api";

const enabled = process.env.TRACCIA_HERO_CAPTURE === "1";
const repoRoot = resolve(__dirname, "../../..");
const shotsDir = resolve(repoRoot, "assets/hero/shots");
const backgroundPath = resolve(repoRoot, "assets/hero/background.png");

// The background the videos use, applied exactly as the Settings screen would: preferences + the
// original image bytes in IndexedDB, the store the app reads on mount.
const BACKGROUND = {
  version: 1,
  enabled: true,
  effect: "none",
  opacity: 40,
} as const;

type Project = { id: string; key: string };

type SeedIssue = {
  title: string;
  status: string;
  priority?: "urgent" | "high" | "medium" | "low";
  estimate?: number;
  assignee?: "you" | "agent";
  labels?: string[];
  milestone?: string;
  description?: string;
  parent?: string;
  blockedBy?: string;
  comments?: string[];
};

const LABELS: { name: string; color: string }[] = [
  { name: "backend", color: "#64748b" },
  { name: "frontend", color: "#06b6d4" },
  { name: "design", color: "#ec4899" },
  { name: "docs", color: "#8b5cf6" },
  { name: "performance", color: "#f59e0b" },
  { name: "sync", color: "#10b981" },
  { name: "notifications", color: "#3b82f6" },
  { name: "bug", color: "#ef4444" },
];

const MILESTONES: { name: string; targetDate: string }[] = [
  { name: "Weekly review", targetDate: "2026-11-01" },
  { name: "Sync and offline", targetDate: "2026-12-01" },
];

const ISSUES: SeedIssue[] = [
  // Backlog
  {
    title: "Import habits from a CSV file",
    status: "backlog",
    priority: "medium",
    estimate: 5,
    labels: ["backend", "docs"],
    description:
      "Let a new user bring habits over from a spreadsheet, mapping columns on a preview screen.",
  },
  {
    title: "Export the full history as JSON",
    status: "backlog",
    priority: "low",
    estimate: 3,
    labels: ["backend"],
    comments: ["Keep the export streaming, some histories are years long."],
  },
  {
    title: "Apple Health and Google Fit import",
    status: "backlog",
    priority: "low",
    estimate: 8,
    labels: ["backend", "sync"],
  },
  {
    title: "Widget for the next check-in",
    status: "backlog",
    priority: "medium",
    estimate: 5,
    labels: ["frontend", "design"],
  },
  {
    title: "Dark mode for the weekly review screen",
    status: "backlog",
    priority: "low",
    estimate: 2,
    labels: ["frontend", "design"],
  },

  // Todo
  {
    title: "Weekly review: one page for the last seven days",
    status: "todo",
    priority: "high",
    estimate: 8,
    assignee: "you",
    labels: ["frontend", "design"],
    milestone: "Weekly review",
    description:
      "A single scrollable page: streaks, per-habit completion, and a short written summary.",
  },
  {
    title: "Keyboard shortcut to toggle the heatmap",
    status: "todo",
    priority: "low",
    estimate: 1,
    labels: ["frontend"],
    milestone: "Weekly review",
  },
  {
    title: "Show the current streak in the menu bar",
    status: "todo",
    priority: "medium",
    estimate: 3,
    labels: ["frontend"],
  },
  {
    title: "Time zone aware daily rollover",
    status: "todo",
    priority: "high",
    estimate: 5,
    assignee: "agent",
    labels: ["backend", "bug"],
    blockedBy: "Streak count resets across a DST change",
    comments: ["Ghostwriter ran into this twice this week."],
  },

  // In Progress
  {
    title: "Streak count resets across a DST change",
    status: "in_progress",
    priority: "urgent",
    estimate: 3,
    assignee: "agent",
    labels: ["backend", "bug"],
    comments: [
      "Reproduced on a device set to a DST boundary; the day compares as a naive local date.",
      "Fix: compare on the stored UTC day and keep the display in the user's zone.",
    ],
  },
  {
    title: "Stats endpoint: paginate history instead of loading every entry",
    status: "in_progress",
    priority: "high",
    estimate: 5,
    assignee: "agent",
    labels: ["backend", "performance"],
    milestone: "Sync and offline",
  },
  {
    title: "Add a short note to each check-in",
    status: "in_progress",
    priority: "medium",
    estimate: 3,
    assignee: "you",
    labels: ["frontend", "design"],
  },

  // In Review
  {
    title: "Onboarding: seed the first three habits",
    status: "in_review",
    priority: "high",
    estimate: 5,
    assignee: "you",
    labels: ["frontend", "design"],
    comments: [
      "Copy is final, the empty state now offers three starter habits.",
    ],
  },
  {
    title: "Sync habits across devices",
    status: "in_review",
    priority: "high",
    estimate: 13,
    assignee: "agent",
    labels: ["sync", "backend"],
    milestone: "Sync and offline",
    description:
      "Last write wins per field, with a visible conflict note when two devices disagree.",
  },
  {
    title: "Undo a check-in from the toast",
    status: "in_review",
    priority: "low",
    estimate: 2,
    labels: ["frontend"],
  },

  // Done
  {
    title: "SQLite schema and the first migration",
    status: "done",
    priority: "medium",
    estimate: 5,
    assignee: "agent",
    labels: ["backend"],
  },
  {
    title: "Habit list with drag to reorder",
    status: "done",
    priority: "medium",
    estimate: 5,
    assignee: "you",
    labels: ["frontend"],
  },
  {
    title: "Log a habit from the command palette",
    status: "done",
    priority: "low",
    estimate: 2,
    labels: ["frontend"],
  },
  {
    title: "Settings: name, week start, theme",
    status: "done",
    priority: "low",
    estimate: 3,
    assignee: "you",
    labels: ["frontend", "design"],
  },
  {
    title: "Trash and restore for deleted habits",
    status: "done",
    priority: "medium",
    estimate: 3,
    assignee: "agent",
    labels: ["backend", "frontend"],
  },
];

const SUBISSUES: { parent: string; child: SeedIssue }[] = [
  {
    parent: "Weekly review: one page for the last seven days",
    child: {
      title: "Weekly review: share as an image",
      status: "backlog",
      priority: "low",
      estimate: 3,
      labels: ["frontend"],
      parent: "Weekly review: one page for the last seven days",
    },
  },
  {
    parent: "Weekly review: one page for the last seven days",
    child: {
      title: "Weekly review: print stylesheet",
      status: "backlog",
      priority: "low",
      estimate: 2,
      labels: ["frontend"],
      parent: "Weekly review: one page for the last seven days",
    },
  },
];

async function seedCadence(api: E2eApi): Promise<Project> {
  const project = await api.post<Project>("/projects", {
    name: "Cadence",
    key: "CAD",
    description:
      "A calm habit tracker: one check-in a day, a weekly review, and a streak worth keeping.",
  });

  for (const label of LABELS)
    await api.post("/labels", { ...label, project: project.id });
  const milestones = new Map<string, string>();
  for (const milestone of MILESTONES) {
    const created = await api.post<{ id: string }>(
      `/projects/${project.id}/milestones`,
      milestone,
    );
    milestones.set(milestone.name, created.id);
  }

  const byTitle = new Map<string, { identifier: string; id: string }>();
  const create = async (issue: SeedIssue) => {
    const created = await api.post<{ identifier: string; id: string }>(
      "/issues",
      {
        project: project.id,
        title: issue.title,
        description: issue.description,
        status: issue.status,
        priority: issue.priority,
        estimate: issue.estimate ?? null,
        assignee: issue.assignee ?? null,
        milestoneId: issue.milestone
          ? (milestones.get(issue.milestone) ?? null)
          : null,
      },
    );
    byTitle.set(issue.title, created);
    return created;
  };

  // Pass 1: every issue and sub-issue exists, so blockers and parents can reference each other.
  const all = [...ISSUES, ...SUBISSUES.map((s) => s.child)];
  for (const issue of all) await create(issue);

  // Pass 2: labels, blockers, parents and comments.
  for (const issue of all) {
    const created = byTitle.get(issue.title)!;
    if (issue.labels?.length)
      await api.patch(`/issues/${created.identifier}`, {
        labels: issue.labels,
      });
    if (issue.blockedBy)
      await api.patch(`/issues/${created.identifier}`, {
        blockedBy: [byTitle.get(issue.blockedBy)!.identifier],
      });
    if (issue.parent)
      await api.patch(`/issues/${created.identifier}`, {
        parentId: byTitle.get(issue.parent)!.id,
      });
    for (const body of issue.comments ?? [])
      await api.post(`/issues/${created.identifier}/comments`, { body });
  }

  return project;
}

/** Writes the background into the app's own store, then reloads so it renders through the real path. */
async function applyBackground(
  page: import("@playwright/test").Page,
  imagePath: string,
) {
  const src = `data:image/png;base64,${readFileSync(imagePath).toString("base64")}`;
  await page.goto("/");
  await page.evaluate(
    async ({ src, prefs }) => {
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.open("traccia-appearance", 1);
        request.onupgradeneeded = () =>
          request.result.createObjectStore("background");
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction("background", "readwrite");
          tx.objectStore("background").put(prefs, "preferences");
          tx.objectStore("background").put(
            { name: "background.png", src },
            "image",
          );
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
        request.onerror = () => reject(request.error);
      });
    },
    { src, prefs: BACKGROUND },
  );
}

test.describe("marketing assets", () => {
  // Retina captures so the videos can downscale to 1920x1080 and stay crisp.
  test.use({ deviceScaleFactor: 2, viewport: { width: 1920, height: 1080 } });

  test("capture the Cadence dashboard with the chosen background", async ({
    page,
  }) => {
    test.skip(
      !enabled,
      "Set TRACCIA_HERO_CAPTURE=1 to capture marketing assets.",
    );

    const api = apiClient(
      process.env.E2E_API_URL as string,
      process.env.E2E_API_TOKEN as string,
    );
    const project = await seedCadence(api);

    await applyBackground(page, backgroundPath);

    await page.goto(`/issues?project=${project.key}`);
    await expect(page.locator(".background-image-layer")).toBeVisible();
    await expect(
      page.getByText("Weekly review: one page for the last seven days"),
    ).toBeVisible();
    await page.waitForTimeout(900);
    mkdirSync(shotsDir, { recursive: true });
    await page.screenshot({ path: resolve(shotsDir, "issues-table.png") });

    await page.goto(`/issues?project=${project.key}&view=kanban`);
    await expect(page.getByText("In Progress").first()).toBeVisible();
    await page.waitForTimeout(900);
    await page.screenshot({ path: resolve(shotsDir, "issues-board.png") });
  });
});
