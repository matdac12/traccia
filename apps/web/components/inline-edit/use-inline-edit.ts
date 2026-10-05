"use client";
import { useCallback, useRef, useState } from "react";
import { updateIssueAction } from "@/app/(app)/issues/[identifier]/actions";
import type { ActionResult } from "@/lib/issue-detail/result";
import { type Issue, type IssueRow, issueSchema } from "@/lib/api/schemas";

/** Builds the patch from the issue as it is NOW, so a re-apply after a conflict does not overwrite what changed. */
export type Build = (current: IssueRow) => Record<string, unknown>;
export type Edit = (issue: IssueRow, label: string, build: Build, optimistic?: Partial<IssueRow>) => void;
export type InlineNotice = { identifier: string; label: string; message: string; conflict: boolean; reapply?: () => void };

type Update = (identifier: string, patch: unknown, expectedUpdatedAt: string) => Promise<ActionResult<{ issue: Issue }>>;

/**
 * Inline edits of one row (TRC-78), same rules as the issue detail: the patch goes out with the row's last seen
 * `updatedAt` as `If-Match`. The change shows at once; a failure puts the row back, and a conflict swaps in the
 * current issue and offers "Re-apply my change". One save per issue at a time. `pending` is non-zero while a save
 * is in flight: the live refresh must not replace rows then.
 */
export function useInlineEdit({ onRow, update = updateIssueAction }: { onRow: (row: IssueRow) => void; update?: Update }) {
  const [notice, setNotice] = useState<InlineNotice | null>(null);
  const saving = useRef(new Set<string>());
  const pending = useRef(0);

  const edit: Edit = useCallback((issue, label, build, optimistic = {}) => {
    if (saving.current.has(issue.id)) return;
    saving.current.add(issue.id);
    pending.current++;
    setNotice(null);
    onRow({ ...issue, ...optimistic });
    void (async () => {
      try {
        const res = await update(issue.identifier, build(issue), issue.updatedAt);
        if (res.ok) return onRow(res.issue);
        if (res.code === "conflict") {
          // The conflict carries the whole issue detail; a list row keeps only the row fields (the live refresh compares them).
          const current = res.current ? issueSchema.parse(res.current) : issue;
          onRow(current);
          setNotice({ identifier: issue.identifier, label, message: res.message, conflict: true, reapply: () => edit(current, label, build, optimistic) });
        } else {
          onRow(issue);
          setNotice({ identifier: issue.identifier, label, message: res.message, conflict: false });
        }
      } catch {
        onRow(issue);
        setNotice({ identifier: issue.identifier, label, message: "Could not reach the server.", conflict: false });
      } finally {
        saving.current.delete(issue.id);
        pending.current--;
      }
    })();
  }, [onRow, update]);

  return { edit, notice, dismiss: () => setNotice(null), pending };
}
