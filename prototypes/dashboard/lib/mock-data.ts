/** PROTOTYPE: mock data shaped like traccia-spec.md section 6. */
export type Status = "backlog" | "todo" | "in_progress" | "in_review" | "done" | "canceled";
export type Priority = 0 | 1 | 2 | 3 | 4; // 0 none, 1 urgent, 2 high, 3 medium, 4 low
export type Actor = "you" | "agent";

export const STATUSES: { key: Status; label: string }[] = [
  { key: "backlog", label: "Backlog" },
  { key: "todo", label: "Todo" },
  { key: "in_progress", label: "In Progress" },
  { key: "in_review", label: "In Review" },
  { key: "done", label: "Done" },
  { key: "canceled", label: "Canceled" },
];
export const PRIORITIES: { key: Priority; label: string }[] = [
  { key: 1, label: "Urgent" },
  { key: 2, label: "High" },
  { key: 3, label: "Medium" },
  { key: 4, label: "Low" },
  { key: 0, label: "No priority" },
];
export const statusLabel = (s: Status) => STATUSES.find((x) => x.key === s)!.label;
export const priorityLabel = (p: Priority) => PRIORITIES.find((x) => x.key === p)!.label;

export type Label = { name: string; color: string };
export const LABELS: Label[] = [
  { name: "backend", color: "#5e9bf0" },
  { name: "frontend", color: "#e879a8" },
  { name: "database", color: "#4cc3a5" },
  { name: "infra", color: "#e08b4a" },
  { name: "bug", color: "#e5646a" },
  { name: "docs", color: "#8a8f98" },
  { name: "ui-shadcn", color: "#a3a8b4" },
];

export type Milestone = { id: string; projectKey: string; name: string; target: string; description?: string };
export type Project = {
  key: string;
  name: string;
  status: "active" | "paused" | "completed" | "canceled";
  description: string;
  color: string;
};

export const PROJECTS: Project[] = [
  {
    key: "TRK",
    name: "Tracker",
    status: "active",
    color: "#f5a30a",
    description:
      "# Tracker\n\nA minimal self-hosted Linear replacement for **one human and their agents**.\n\n- REST API + MCP server on Hono\n- SQLite as the only state\n- Dashboard behind Tailscale\n\n> Agents write, you review. Everything is attributed.",
  },
  {
    key: "WEB",
    name: "Portfolio site",
    status: "active",
    color: "#4cc3a5",
    description: "Personal site rebuild: case studies, blog, and a small `/now` page.",
  },
  {
    key: "AGT",
    name: "Agent toolkit",
    status: "paused",
    color: "#e08b4a",
    description: "Prompts, skills and MCP helpers shared across my coding agents.",
  },
];

export const MILESTONES: Milestone[] = [
  { id: "m1", projectKey: "TRK", name: "P4 Backend core", target: "2026-10-12" },
  { id: "m2", projectKey: "TRK", name: "P7 Dashboard design", target: "2026-10-19" },
  { id: "m3", projectKey: "TRK", name: "P8 Dashboard build", target: "2026-11-02" },
  { id: "m4", projectKey: "WEB", name: "Launch", target: "2026-11-20" },
  { id: "m5", projectKey: "AGT", name: "v0.1", target: "2026-12-01" },
];

export type Comment = { id: string; author: Actor; actorName?: string; body: string; at: string };
export type ActivityItem = { id: string; actor: Actor; text: string; at: string };

export type Issue = {
  identifier: string;
  title: string;
  description: string;
  status: Status;
  priority: Priority;
  estimate: number | null;
  assignee: Actor | null;
  labels: string[];
  projectKey: string;
  milestoneId: string | null;
  parent: string | null;
  blockedBy: string[];
  updatedAt: string;
  createdBy: Actor;
  comments: Comment[];
  activity: ActivityItem[];
  attachments: { id: string; name: string; kind: "image" | "file"; size: string }[];
};

// Fixed clock so server and client render identical times (no hydration mismatch).
export const BASE = Date.UTC(2026, 9, 5, 8, 0, 0);
export const nowIso = () => new Date(BASE).toISOString();
const ago = (min: number) => new Date(BASE - min * 60_000).toISOString();

type Seed = Partial<Issue> & Pick<Issue, "identifier" | "title" | "status" | "projectKey">;
const mk = (s: Seed): Issue => ({
  description: "",
  priority: 0,
  estimate: null,
  assignee: null,
  labels: [],
  milestoneId: null,
  parent: null,
  blockedBy: [],
  updatedAt: ago(60),
  createdBy: "you",
  comments: [],
  activity: [
    { id: `${s.identifier}-a1`, actor: s.createdBy ?? "you", text: "created the issue", at: s.updatedAt ?? ago(60) },
  ],
  attachments: [],
  ...s,
});

export const ISSUES: Issue[] = [
  mk({
    identifier: "TRK-1719",
    title: "Dashboard foundation: Next.js standalone app and server-only API client",
    status: "in_progress",
    priority: 2,
    estimate: 5,
    assignee: "agent",
    labels: ["frontend", "ui-shadcn"],
    projectKey: "TRK",
    milestoneId: "m3",
    blockedBy: ["TRK-1686"],
    updatedAt: ago(3),
    createdBy: "agent",
    description:
      "## Context\n\nReplace the placeholder `apps/web` with the real Next.js app.\n\n## Scope\n\n- App Router, TypeScript, Tailwind, shadcn/ui\n- `output: 'standalone'`\n- `server-only` API client; the token never reaches the browser\n- Identity-header access check in middleware\n- Dark and light themes\n\n## Acceptance criteria\n\n- [x] App boots in the container\n- [ ] Middleware rejects requests without the identity header\n- [ ] Follows the **approved prototype**",
    comments: [
      { id: "c1", author: "agent", actorName: "claude-code-mac", body: "Scaffolded the app and wired the server-only client. Starting on the access middleware next.", at: ago(40) },
      { id: "c2", author: "you", body: "Remember the header check must run on `/api/files/*` too.", at: ago(22) },
    ],
    activity: [
      { id: "a1", actor: "agent", text: "created the issue", at: ago(300) },
      { id: "a2", actor: "you", text: "set priority to High", at: ago(280) },
      { id: "a3", actor: "agent", text: "changed status from Todo to In Progress", at: ago(95) },
      { id: "a4", actor: "agent", text: "commented", at: ago(40) },
      { id: "a5", actor: "you", text: "commented", at: ago(22) },
    ],
    attachments: [{ id: "f1", name: "layout-sketch.png", kind: "image", size: "184 KB" }, { id: "f2", name: "access-check-notes.md", kind: "file", size: "3 KB" }],
  }),
  mk({ identifier: "TRK-1720", title: "Issues table grouped by status with filters, search and view toggle", status: "todo", priority: 2, estimate: 5, assignee: "agent", labels: ["frontend", "ui-shadcn"], projectKey: "TRK", milestoneId: "m3", blockedBy: ["TRK-1719"], updatedAt: ago(130) }),
  mk({ identifier: "TRK-1721", title: "Issue detail with editing, comments, sub-issues, blockers and activity", status: "todo", priority: 2, estimate: 8, assignee: "agent", labels: ["frontend", "ui-shadcn"], projectKey: "TRK", milestoneId: "m3", blockedBy: ["TRK-1719"], updatedAt: ago(131) }),
  mk({ identifier: "TRK-1722", title: "Project page with milestone progress and the create-issue dialog", status: "todo", priority: 3, estimate: 5, labels: ["frontend", "ui-shadcn"], projectKey: "TRK", milestoneId: "m3", updatedAt: ago(132) }),
  mk({ identifier: "TRK-1723", title: "Trash view with restore and purge", status: "backlog", priority: 3, estimate: 3, labels: ["frontend"], projectKey: "TRK", milestoneId: "m3", updatedAt: ago(500) }),
  mk({ identifier: "TRK-1724", title: "Kanban view with drag and drop and persisted ordering", status: "backlog", priority: 3, estimate: 5, labels: ["frontend", "ui-shadcn"], projectKey: "TRK", milestoneId: "m3", updatedAt: ago(520) }),
  mk({ identifier: "TRK-1725", title: "Attachments with drag-drop upload, image preview and file proxy route", status: "backlog", priority: 4, estimate: 5, labels: ["frontend"], projectKey: "TRK", milestoneId: "m3", updatedAt: ago(530) }),
  mk({ identifier: "TRK-1726", title: "Polling refresh with pause on hidden tab and revalidate on focus", status: "backlog", priority: 4, estimate: 2, labels: ["frontend"], projectKey: "TRK", milestoneId: "m3", updatedAt: ago(540) }),
  mk({ identifier: "TRK-1686", title: "Design the dashboard with clickable prototypes and get approval", status: "in_progress", priority: 1, estimate: 3, assignee: "you", labels: ["frontend", "ui-shadcn"], projectKey: "TRK", milestoneId: "m2", updatedAt: ago(8), description: "Spec 12.4: design happens before implementation.\n\n1. Collect references\n2. Build clickable prototypes\n3. Iterate until approved" }),
  mk({ identifier: "TRK-1713", title: "Deploy the compose stack to the server and publish with tailscale serve", status: "todo", priority: 2, estimate: 3, assignee: "you", labels: ["infra"], projectKey: "TRK", milestoneId: "m1", updatedAt: ago(220) }),
  mk({ identifier: "TRK-1715", title: "Create tokens for the Mac, the Windows machine and the dashboard", status: "todo", priority: 2, estimate: 1, assignee: "agent", labels: ["infra"], projectKey: "TRK", milestoneId: "m1", blockedBy: ["TRK-1713"], updatedAt: ago(215) }),
  mk({ identifier: "TRK-1702", title: "Full-text search over issues, comments and projects (FTS5)", status: "in_review", priority: 2, estimate: 5, assignee: "agent", labels: ["backend", "database"], projectKey: "TRK", milestoneId: "m1", updatedAt: ago(14), createdBy: "agent" }),
  mk({ identifier: "TRK-1698", title: "PATCH /issues/:identifier/position with fractional sort_order", status: "in_review", priority: 3, estimate: 3, assignee: "agent", labels: ["backend"], projectKey: "TRK", milestoneId: "m1", updatedAt: ago(75), createdBy: "agent" }),
  mk({ identifier: "TRK-1690", title: "Soft delete cascade with batch restore", status: "done", priority: 2, estimate: 5, assignee: "agent", labels: ["backend", "database"], projectKey: "TRK", milestoneId: "m1", updatedAt: ago(1200), createdBy: "agent" }),
  mk({ identifier: "TRK-1688", title: "Identifier allocation under concurrent creates", status: "done", priority: 2, estimate: 3, assignee: "agent", labels: ["backend", "bug"], projectKey: "TRK", milestoneId: "m1", updatedAt: ago(1500) }),
  mk({ identifier: "TRK-1685", title: "Monotonic ULID generation within the same millisecond", status: "done", priority: 3, estimate: 1, assignee: "agent", labels: ["backend"], projectKey: "TRK", milestoneId: "m1", updatedAt: ago(2000) }),
  mk({ identifier: "TRK-1679", title: "Decide the dashboard access check", status: "done", priority: 3, estimate: 1, assignee: "you", labels: ["docs"], projectKey: "TRK", updatedAt: ago(2600) }),
  mk({ identifier: "TRK-1650", title: "Server-sent events for live updates", status: "canceled", priority: 0, labels: ["backend"], projectKey: "TRK", updatedAt: ago(4000) }),
  mk({ identifier: "WEB-12", title: "Write the case study for the Fable launch", status: "in_progress", priority: 3, estimate: 3, assignee: "you", labels: ["docs"], projectKey: "WEB", milestoneId: "m4", updatedAt: ago(35) }),
  mk({ identifier: "WEB-13", title: "Home page hero: replace stock gradient with real product shot", status: "todo", priority: 3, estimate: 2, assignee: "agent", labels: ["frontend"], projectKey: "WEB", milestoneId: "m4", updatedAt: ago(250) }),
  mk({ identifier: "WEB-14", title: "RSS feed returns 500 for posts without a date", status: "todo", priority: 1, estimate: 1, assignee: "agent", labels: ["bug", "backend"], projectKey: "WEB", milestoneId: "m4", updatedAt: ago(5), createdBy: "agent" }),
  mk({ identifier: "WEB-15", title: "Add a /now page", status: "backlog", priority: 4, labels: ["frontend"], projectKey: "WEB", updatedAt: ago(900) }),
  mk({ identifier: "WEB-9", title: "Set up analytics without cookies", status: "done", priority: 3, estimate: 2, assignee: "you", labels: ["infra"], projectKey: "WEB", updatedAt: ago(3200) }),
  mk({ identifier: "AGT-4", title: "Skill: summarize a Linear import diff", status: "backlog", priority: 4, labels: ["docs"], projectKey: "AGT", milestoneId: "m5", updatedAt: ago(1800) }),
  mk({ identifier: "AGT-5", title: "MCP helper: bulk label issues by regex", status: "todo", priority: 3, estimate: 2, assignee: "agent", labels: ["backend"], projectKey: "AGT", milestoneId: "m5", updatedAt: ago(700) }),
  mk({ identifier: "AGT-3", title: "Agent snippet for CLAUDE.md / AGENTS.md", status: "in_review", priority: 3, estimate: 1, assignee: "you", labels: ["docs"], projectKey: "AGT", milestoneId: "m5", updatedAt: ago(160) }),
  mk({ identifier: "TRK-1730", title: "Markdown description editor with preview", status: "backlog", priority: 3, estimate: 3, labels: ["frontend"], projectKey: "TRK", parent: "TRK-1721", updatedAt: ago(131) }),
  mk({ identifier: "TRK-1731", title: "Activity timeline component", status: "backlog", priority: 3, estimate: 2, labels: ["frontend"], projectKey: "TRK", parent: "TRK-1721", updatedAt: ago(131) }),
];

export type TrashItem = {
  id: string;
  type: "issue" | "comment" | "project" | "milestone" | "attachment";
  title: string;
  deletedBy: Actor;
  deletedAt: string;
  batch?: string;
  batchSize?: number;
};

export const TRASH: TrashItem[] = [
  { id: "t1", type: "issue", title: "TRK-1655 Draft SSE endpoint", deletedBy: "agent", deletedAt: ago(90), batch: "b1", batchSize: 3 },
  { id: "t2", type: "comment", title: "On TRK-1655: \"Let's skip SSE for v1\"", deletedBy: "agent", deletedAt: ago(90), batch: "b1", batchSize: 3 },
  { id: "t3", type: "attachment", title: "sse-diagram.png", deletedBy: "agent", deletedAt: ago(90), batch: "b1", batchSize: 3 },
  { id: "t4", type: "issue", title: "WEB-7 Add dark mode toggle to footer", deletedBy: "you", deletedAt: ago(2880) },
  { id: "t5", type: "milestone", title: "AGT: Alpha", deletedBy: "you", deletedAt: ago(7000) },
  { id: "t6", type: "project", title: "Old blog (archived)", deletedBy: "you", deletedAt: ago(20000) },
];

export function timeAgo(iso: string) {
  const m = Math.max(1, Math.round((BASE - new Date(iso).getTime()) / 60_000));
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d}d`;
  return `${Math.round(d / 30)}mo`;
}
