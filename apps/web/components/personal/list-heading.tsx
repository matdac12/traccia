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

/** A section's small uppercase label (Overdue, Today, Later), with its count. */
export function SectionLabel({ children, count, tone, id }: { children: ReactNode; count?: number; tone?: "danger"; id?: string }) {
  return (
    <h3 id={id} className={cn("flex items-baseline gap-2 px-2 pb-1 pt-5 text-[11px] font-medium uppercase tracking-[0.08em]", tone === "danger" ? "text-destructive" : "text-muted-foreground")}>
      {children}
      {count !== undefined ? <span className="font-mono tabular-nums opacity-70">{count}</span> : null}
    </h3>
  );
}

/**
 * One day of a list (Upcoming, its Later, the Logbook): the day as a heading over its rows. An empty day is dimmed
 * and says "Nothing planned".
 */
export function DaySection({ id, label, empty = false, children }: { id: string; label: ReactNode; empty?: boolean; children?: ReactNode }) {
  return (
    <section aria-labelledby={id} className={cn(empty && "opacity-60")}>
      <h3 id={id} className="flex items-baseline gap-2 border-b px-2 pb-1 pt-5 text-[12px] font-medium">
        {label}
        {empty ? <span className="text-[11px] font-normal text-muted-foreground">Nothing planned</span> : null}
      </h3>
      {children}
    </section>
  );
}
