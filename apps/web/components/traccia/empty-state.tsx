import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function EmptyState({ icon: Icon, title, children, className }: { icon: LucideIcon; title: string; children?: ReactNode; className?: string }) {
  return (
    <div className={cn("grid flex-1 place-items-center p-8", className)}>
      <div className="max-w-xs text-center">
        <div className="mx-auto mb-3 grid size-9 place-items-center rounded-lg border bg-surface text-muted-foreground">
          <Icon className="size-4" />
        </div>
        <h2 className="text-[13px] font-medium">{title}</h2>
        {children ? <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">{children}</p> : null}
      </div>
    </div>
  );
}
