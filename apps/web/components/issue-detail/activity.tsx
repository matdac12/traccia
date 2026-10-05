import { ActorAvatar } from "@/components/traccia/atoms";
import type { ActivityRow } from "@/lib/api/schemas";
import { type ActivityLookups, actorLabel, describeActivity } from "@/lib/issue-detail/activity";
import { TimeAgo } from "./atoms";

/** Timeline from the API's activity rows, oldest first. */
export function ActivityTimeline({ rows, lookups }: { rows: ActivityRow[]; lookups: ActivityLookups }) {
  if (rows.length === 0) return <p className="text-xs text-muted-foreground">No activity yet.</p>;
  return (
    <ol className="relative space-y-3 border-l pl-5">
      {rows.map((row) => (
        <li key={row.id} className="relative text-[13px] text-muted-foreground">
          <span className="absolute -left-[25px] top-1.5 size-1.5 rounded-full bg-border ring-4 ring-background" />
          <span className="inline-flex flex-wrap items-center gap-1.5">
            <ActorAvatar who={row.actor} size={14} />
            <span className="text-foreground">{actorLabel(row.actor)}</span> {describeActivity(row, lookups)}
            <span className="text-xs">· <TimeAgo iso={row.createdAt} /></span>
          </span>
        </li>
      ))}
    </ol>
  );
}
