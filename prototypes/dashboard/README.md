# Dashboard prototype (MAT-1686)

**Throwaway, approved design reference.** Clickable Next.js prototype with mock data and in-memory state. It is
not part of the pnpm workspace and is not wired to `apps/api` or `apps/web`. The build tickets (MAT-1719 to MAT-1726)
follow it for layout, components and look and feel; they re-implement it against the real API, they do not import it.

## Run

```bash
cd prototypes/dashboard
pnpm install --ignore-workspace
pnpm dev          # http://localhost:3100
```

To open the dev server from another machine (for example over a tailnet), set `DEV_ORIGINS` to a comma-separated list of hosts.

## What it covers (spec 12.1)

| Route | Screen |
|-------|--------|
| `/issues` | Table grouped by status (collapsible, counts), filters, search |
| `/issues?view=kanban` | Kanban, six status columns, drag and drop (dnd-kit, status only) |
| `/issues/TRK-1719` | Issue detail: markdown edit/preview, properties, attachments slot, sub-issues, blockers, activity, comments |
| `/projects`, `/projects/TRK` | Projects overview; project page with markdown description, milestone progress, issue list |
| `/trash` | Soft-deleted items, restore, purge confirmation, batch hint |
| `C` / New issue | Create-issue dialog. `⌘K`: command palette |
| sidebar sun/moon | Dark and light themes (dark default) |

A fake agent moves an issue forward every 12 s to show agent attribution and the live-update flash that the real
polling (MAT-1726) should reproduce.

## Design decisions

- shadcn/ui (new-york, neutral base, CSS variables), Tailwind 4, Geist Sans and Mono, lucide icons.
- "Linear-calm": dense rows (~36 px), 1 px hairline borders, no heavy shadows, small radii, near-monochrome UI.
  Color only in status icons, priority, labels and the agent mark.
- Default accent is **yellow/amber** (`#f5a30a`) with dark text on it (`#1a1203`) in both themes. Links in markdown use
  the foreground color, not the accent.
- Status colors: backlog/todo gray, in progress yellow, in review green, done blue, canceled gray.
- **Agent identity:** cyan bot avatar, an "agent" chip, a tinted comment card and a cyan flash on rows an  agent just changed. Humans are shown with an initial avatar.
- Identifiers show in full (`TRK-1719`) with a priority icon beside them. Done and Canceled groups start collapsed.
- Table/Kanban toggle is kept in the URL (`?view=`).
- Issue detail is a full page with a properties sidebar (not a side panel).
- Keyboard first: `C` creates an issue, `⌘K` opens the command palette.
- **Later (separate ticket):** user-selectable accent color in a settings page: a curated set of ~10 tasteful colors
  plus a hex input, with derived dark/light variants and computed foreground for contrast. Status and agent colors stay
  locked so they never clash with the accent.

## Known gaps (not in scope here)

No mobile layout, fake clock (times are relative to a fixed instant), Kanban ordering within a column is not
modeled, no real attachments or sub-issue creation.
