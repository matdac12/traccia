import { ISSUE_STATUSES, type IssueStatus } from "@linear-matti/shared";
import type { IssueRow } from "@/lib/api/schemas";

/**
 * Pure model of the Kanban board: what the columns hold, and what to tell the API after a drop.
 * Position is never computed here. The service owns fractional ordering and rebalancing, so a move is
 * described by neighbour ids only (MAT-1700 `issues.move`).
 */

export type BoardColumn = { status: IssueStatus; items: IssueRow[]; nextCursor: string | null };

/** The body of `PATCH /issues/:identifier/position`. */
export type MoveRequest = { identifier: string; status: IssueStatus; beforeId?: string; afterId?: string };

export type MoveResult = { ok: true; issue: IssueRow } | { ok: false; code: string; message: string };

export function findCard(columns: BoardColumn[], id: string): { status: IssueStatus; index: number } | null {
  for (const c of columns) {
    const index = c.items.findIndex((i) => i.id === id);
    if (index >= 0) return { status: c.status, index };
  }
  return null;
}

/** Moves a card to `index` of `status` (index is its final place in that column). Returns the same array when nothing changes. */
export function moveCard(columns: BoardColumn[], id: string, status: IssueStatus, index: number): BoardColumn[] {
  const from = findCard(columns, id);
  if (!from) return columns;
  const card = columns.find((c) => c.status === from.status)!.items[from.index]!;
  const clamped = (len: number) => Math.max(0, Math.min(index, len));
  if (from.status === status) {
    const items = columns.find((c) => c.status === status)!.items;
    const to = clamped(items.length - 1);
    if (to === from.index) return columns;
    const next = items.filter((i) => i.id !== id);
    next.splice(to, 0, card);
    return columns.map((c) => (c.status === status ? { ...c, items: next } : c));
  }
  return columns.map((c) => {
    if (c.status === from.status) return { ...c, items: c.items.filter((i) => i.id !== id) };
    if (c.status !== status) return c;
    const items = [...c.items];
    items.splice(clamped(items.length), 0, { ...card, status });
    return { ...c, items };
  });
}

/**
 * The request for a card that already sits in its dropped place. Neighbours must be in the same project (a column
 * is `(project, status)`, and the service rejects others), so on a board that mixes projects the nearest card of the
 * card's own project is used. `afterId` (the card ending up directly above) wins; `beforeId` (directly below) is used
 * at the top of a column; neither means the column holds no other card of this project.
 */
export function planMove(columns: BoardColumn[], id: string): MoveRequest | null {
  const at = findCard(columns, id);
  if (!at) return null;
  const items = columns.find((c) => c.status === at.status)!.items;
  const card = items[at.index]!;
  const sameProject = (i: IssueRow | undefined) => i !== undefined && i.projectId === card.projectId;
  const above = items.slice(0, at.index).reverse().find(sameProject);
  const below = items.slice(at.index + 1).find(sameProject);
  const request: MoveRequest = { identifier: card.identifier, status: at.status };
  if (above) request.afterId = above.identifier;
  else if (below) request.beforeId = below.identifier;
  return request;
}

/** Applies the server's answer (new status, updatedAt, ...) to the card, keeping its place. */
export function applyServerIssue(columns: BoardColumn[], issue: IssueRow): BoardColumn[] {
  return columns.map((c) => ({ ...c, items: c.items.map((i) => (i.id === issue.id ? issue : i)) }));
}

export function moveErrorMessage(identifier: string, code: string, message: string): string {
  if (code === "conflict") return `${identifier} was changed elsewhere, so the move was undone. Refresh the board and try again.`;
  if (code === "not_found") return `${identifier} no longer exists, so the move was undone. Refresh the board.`;
  return `Could not move ${identifier} (${message}). The move was undone.`;
}

export const emptyColumns = (): BoardColumn[] => ISSUE_STATUSES.map((status) => ({ status, items: [], nextCursor: null }));
