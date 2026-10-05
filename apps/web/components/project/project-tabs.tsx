"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export const PROJECT_TABS = [
  { key: "overview", label: "Overview", segment: "" },
  { key: "activity", label: "Activity", segment: "/activity" },
  { key: "issues", label: "Issues", segment: "/issues" },
] as const;
export type ProjectTab = (typeof PROJECT_TABS)[number]["key"];

/** Which tab a pathname belongs to. Unknown sub-paths fall back to Overview. */
export function activeProjectTab(path: string): ProjectTab {
  const last = path.replace(/\/+$/, "").split("/")[3];
  return PROJECT_TABS.find((t) => t.segment && t.segment === `/${last}`)?.key ?? "overview";
}

/**
 * Overview / Activity / Issues. Real navigation (sub-routes of the project page), so the tab survives a reload and
 * Back works. Marked up as a nav of links with `aria-current`, not a `tablist`: nothing here swaps panels in place.
 */
export function ProjectTabs({ projectId }: { projectId: string }) {
  const active = activeProjectTab(usePathname());
  return (
    <nav aria-label="Project sections" className="-mb-px flex gap-1">
      {PROJECT_TABS.map((t) => (
        <Link
          key={t.key}
          href={`/projects/${projectId}${t.segment}`}
          aria-current={active === t.key ? "page" : undefined}
          className={cn(
            "relative inline-flex h-9 items-center border-b-2 px-2.5 text-[13px] outline-none transition-colors focus-visible:rounded-md focus-visible:ring-2 focus-visible:ring-ring",
            active === t.key ? "border-foreground font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
