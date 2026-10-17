import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** A list's big heading (Geist Sans, tight tracking); `masthead` is Today's larger weekday. */
export function ListHeading({ children, sub, masthead = false }: { children: ReactNode; sub?: ReactNode; masthead?: boolean }) {
  return (
    <header className={masthead ? "mb-5" : "mb-4"}>
      {/* The size goes first: tailwind-merge drops a `leading-*` that comes before a font size. */}
      <h2 className={cn(masthead ? "text-[34px]" : "text-[28px]", "font-[family-name:var(--font-geist-sans)] font-semibold leading-none tracking-[-0.03em]")}>{children}</h2>
      {sub ? <p className="mt-2 text-[12px] text-muted-foreground">{sub}</p> : null}
    </header>
  );
}
