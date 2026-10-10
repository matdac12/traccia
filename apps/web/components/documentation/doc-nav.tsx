import Link from "next/link";
import { cn } from "@/lib/utils";

const SECTIONS = [
  { key: "memory", label: "Memory", segment: "" },
  { key: "files", label: "Files", segment: "/files" },
] as const;

/** Memory / Files sub-tabs. Real navigation (two sub-routes), like the project tabs; the active one comes from the page. */
export function DocNav({ projectId, active, counts }: { projectId: string; active: "memory" | "files"; counts?: Partial<Record<"memory" | "files", number>> }) {
  return (
    <nav aria-label="Documentation sections" className="flex gap-1 border-b px-4 sm:px-6">
      {SECTIONS.map((s) => (
        <Link
          key={s.key}
          href={`/projects/${projectId}/documentation${s.segment}`}
          aria-current={active === s.key ? "page" : undefined}
          className={cn(
            "-mb-px inline-flex h-9 items-center gap-1.5 border-b-2 px-2.5 text-[13px] outline-none transition-colors focus-visible:rounded-md focus-visible:ring-2 focus-visible:ring-ring",
            active === s.key ? "border-foreground font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          {s.label}
          {counts?.[s.key] !== undefined ? <span className="text-xs font-normal text-muted-foreground">{counts[s.key]}</span> : null}
        </Link>
      ))}
    </nav>
  );
}
