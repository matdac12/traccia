"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const PROJECT_TABS = [
  { key: "overview", label: "Overview", segment: "" },
  { key: "activity", label: "Activity", segment: "/activity" },
  { key: "issues", label: "Issues", segment: "/issues" },
] as const;
type ProjectTab = (typeof PROJECT_TABS)[number]["key"];

/** Which tab a pathname belongs to. Reads the segment after the project id (`/projects/<id>/<segment>`), so it does not depend on a fixed position; unknown paths and project ids that collide with a tab name fall back to Overview. */
export function activeProjectTab(path: string): ProjectTab {
  const [root, , ...rest] = path.replace(/\/+$/, "").split("/").slice(1);
  if (root !== "projects") return "overview";
  return PROJECT_TABS.find((t) => t.segment.slice(1) === rest.join("/"))?.key ?? "overview";
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
