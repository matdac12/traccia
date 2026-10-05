import { AlertTriangle } from "lucide-react";

/** Non-destructive 409 message, same look as the issue detail's banner: nothing was saved, the page shows the latest version. */
export function ConflictNotice({ what, children }: { what: string; children?: React.ReactNode }) {
  return (
    <div role="alert" className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[13px]">
      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
      <p className="flex-1">
        <span className="font-medium">{what} was changed by someone else</span> after you opened it, so your change was <span className="font-medium">not saved</span>. The page now shows the latest version.
        {children}
      </p>
    </div>
  );
}
