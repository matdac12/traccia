import { Plus } from "lucide-react";
import type { ListCounts } from "./list";

/**
 * The 40 px bar of variant G (docs/desktop-app.md §3.1): "Personal", the counts, and the + that opens the
 * composer from step 06 on. The + is off while offline.
 */
export function TitleBar({
  counts,
  offline = false,
}: {
  counts?: ListCounts;
  offline?: boolean;
}) {
  return (
    <header className="flex h-10 flex-none items-center gap-2 border-b pr-2 pl-3.5">
      <h1 className="font-semibold">Personal</h1>
      {counts && (
        <span className="text-xs text-muted-foreground">
          {counts.today} today · {counts.open} open
        </span>
      )}
      <span className="flex-1" />
      <button
        type="button"
        aria-label="Add a To-do"
        title="Add a To-do"
        disabled={offline}
        className="grid size-[26px] place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-primary disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
      >
        <Plus className="size-[15px]" strokeWidth={2.2} aria-hidden="true" />
      </button>
    </header>
  );
}
