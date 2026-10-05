import { X } from "lucide-react";
import { ConflictNotice } from "@/components/traccia/conflict-notice";
import { Button } from "@/components/ui/button";
import type { InlineNotice } from "./use-inline-edit";

/** Banner above a list or board for the last failed inline edit; a conflict reuses the detail page's notice. */
export function InlineEditNotice({ notice, onDismiss }: { notice: InlineNotice; onDismiss: () => void }) {
  const dismiss = (
    <Button type="button" variant="ghost" size="icon" className="size-5 shrink-0" aria-label="Dismiss" onClick={onDismiss}><X className="size-3.5" /></Button>
  );
  if (notice.conflict) {
    return (
      <div className="flex shrink-0 items-start gap-2 border-b px-4 py-2">
        <div className="flex-1">
          <ConflictNotice what={notice.identifier}>
            {" "}Your change ({notice.label}) can be applied on top of it.
            {notice.reapply && <Button type="button" size="sm" variant="outline" className="ml-2 h-6 text-xs" onClick={() => { notice.reapply?.(); }}>Re-apply my change</Button>}
          </ConflictNotice>
        </div>
        {dismiss}
      </div>
    );
  }
  return (
    <div role="alert" className="flex shrink-0 items-center gap-2 border-b bg-destructive/10 px-4 py-2 text-xs text-destructive">
      <span className="flex-1">Could not change {notice.label} of {notice.identifier} ({notice.message}). The change was undone.</span>
      {dismiss}
    </div>
  );
}
