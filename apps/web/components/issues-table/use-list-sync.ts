"use client";
import { ISSUE_STATUSES, type IssueStatus } from "@traccia/shared";
import { useCallback, useRef } from "react";
import { getJson } from "@/lib/polling/fetch-json";
import { usePoll, type PollOptions } from "@/lib/polling/use-poll";
import type { IssueGroup } from "./issues-table";

/** What `refreshIssueGroups` re-reads per group at most (5 pages of 50). */
const MAX_REFRESH_ROWS = 250;

export type Counts = Partial<Record<IssueStatus, number>>;

/** What the table or board gives the poll: how much it shows now, and a way to swap in fresh groups. */
export type GroupsApplier = {
  counts: () => Counts;
  /** Returns false when it cannot take the update right now (a drag or a save is in progress); the poll retries. */
  apply: (groups: IssueGroup[]) => boolean;
};

export const countsOf = (groups: IssueGroup[]): Counts => Object.fromEntries(groups.map((g) => [g.status, g.items.length]));

/** Same rows in the same order (an unchanged poll must not re-render anything). */
export const sameGroups = (a: IssueGroup[], b: IssueGroup[]) =>
  a.length === b.length && a.every((g, i) => g.status === b[i]!.status && g.nextCursor === b[i]!.nextCursor && JSON.stringify(g.items) === JSON.stringify(b[i]!.items));

const sameCounts = (a: Counts, b: Counts) => ISSUE_STATUSES.every((s) => (a[s] ?? 0) === (b[s] ?? 0));

/**
 * MAT-1726: live refresh of the issue list. Each tick asks `/api/issues/changes` for the newest change after
 * the last one seen (one row). Only when something changed does it re-read the groups on screen and hand them
 * to the registered table / board. The token advances only once the update was taken, so a refused one (drag
 * in progress, "load more" racing the poll) is retried on the next tick instead of lost.
 */
export function useListSync({ query, syncToken, ...poll }: { query: string; syncToken?: string | null } & PollOptions) {
  const applier = useRef<GroupsApplier | null>(null);
  const token = useRef<string | null>(syncToken ?? null);
  const register = useCallback((a: GroupsApplier | null) => { applier.current = a; }, []);

  const tick = useCallback(async () => {
    const probe = await getJson<{ latest: string | null }>(`/api/issues/changes${token.current ? `?since=${encodeURIComponent(token.current)}` : ""}`);
    if (!probe.latest) return;
    if (!token.current) { token.current = probe.latest; return; }
    const target = applier.current;
    if (!target) return;
    const asked = target.counts();
    // More rows loaded than one refresh can re-read: replacing them would drop rows, so leave this view alone.
    if (Object.values(asked).some((n) => n > MAX_REFRESH_ROWS)) return;
    const counts = ISSUE_STATUSES.map((s) => `${s}:${asked[s] ?? 0}`).join(",");
    const groups = await getJson<IssueGroup[]>(`/api/issues/groups?${new URLSearchParams({ query, counts })}`);
    // "Load more" finished while this was in flight: the answer no longer matches what is shown.
    if (applier.current !== target || !sameCounts(asked, target.counts())) return;
    if (target.apply(groups)) token.current = probe.latest;
  }, [query]);

  return { ...usePoll(tick, poll), register };
}
