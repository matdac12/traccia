"use client";
import { Activity, Loader2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { loadMoreActivityAction } from "@/app/(app)/projects/[id]/actions";
import { TimeAgo } from "@/components/issue-detail/atoms";
import { ActorAvatar } from "@/components/traccia/atoms";
import { EmptyState } from "@/components/traccia/empty-state";
import { Button } from "@/components/ui/button";
import type { ActivityFeedItem } from "@/lib/api/schemas";
import { actorLabel, describeActivity } from "@/lib/issue-detail/activity";

/** The project's activity feed, newest first. Names for milestone and project ids come from the page; "Load more" pages with the API's cursor. */
export function ProjectActivity({ projectId, initial, nextCursor, milestoneNames, projectNames }: { projectId: string; initial: ActivityFeedItem[]; nextCursor: string | null; milestoneNames: Record<string, string>; projectNames: Record<string, string> }) {
  const [items, setItems] = useState(initial);
  const [cursor, setCursor] = useState(nextCursor);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lookups = { milestone: (id: string) => milestoneNames[id], project: (id: string) => projectNames[id] };

  const more = async () => {
    if (!cursor || loading) return;
    setLoading(true);
    setError(null);
    const res = await loadMoreActivityAction(projectId, cursor).catch(() => null);
    setLoading(false);
    if (!res) return setError("Could not load more activity. Try again.");
    if (!res.ok) return setError(res.error);
    setItems((prev) => [...prev, ...res.data.items.filter((n) => !prev.some((p) => p.id === n.id))]);
    setCursor(res.data.nextCursor);
  };

  if (items.length === 0) return <EmptyState icon={Activity} title="No activity yet">Changes to this project's issues show up here.</EmptyState>;
  return (
    <section aria-label="Activity" className="px-4 py-3 sm:px-6">
      <ol className="max-w-3xl divide-y">
        {items.map((row) => (
          <li key={row.id} className="flex items-start gap-2.5 py-2.5 text-[13px]">
            <span className="mt-0.5 shrink-0"><ActorAvatar who={row.actor} size={18} /></span>
            <div className="min-w-0 flex-1">
              <p>
                <span className="font-medium">{actorLabel(row.actor)}</span> <span className="text-muted-foreground">{describeActivity(row, lookups)}</span>
              </p>
              <Link href={`/issues/${row.identifier}`} className="mt-0.5 block truncate text-xs text-muted-foreground hover:text-foreground">
                <span className="font-mono">{row.identifier}</span> {row.title}
              </Link>
            </div>
            <span className="shrink-0 pt-0.5 text-xs text-muted-foreground"><TimeAgo iso={row.createdAt} /></span>
          </li>
        ))}
      </ol>
      {cursor || error ? (
        <div className="flex max-w-3xl items-center gap-2 pt-3">
          {cursor ? (
            <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" disabled={loading} onClick={more}>
              {loading && <Loader2 className="size-3.5 animate-spin" />}Load more
            </Button>
          ) : null}
          {error ? <span role="alert" className="text-xs text-destructive">{error}</span> : null}
        </div>
      ) : null}
    </section>
  );
}
