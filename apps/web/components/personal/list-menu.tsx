import { BookCheck, CalendarRange, Inbox, type LucideIcon, Sun } from "lucide-react";
import type { ReactNode } from "react";
import type { listMenuCounts } from "@/lib/personal/lists";
import { cn } from "@/lib/utils";
import { ProjectChip } from "./todo-title";

/** The Personal Space lists (docs/personal-space.md §7.3). */
export type PersonalList = "today" | "upcoming" | "anytime" | "logbook" | `project:${string}`;
type NamedList = Exclude<PersonalList, `project:${string}`>;

export const projectList = (key: string): PersonalList => `project:${key}`;
/** The Project key of a By project list, else null. */
export const projectKeyOf = (list: PersonalList) => (list.startsWith("project:") ? list.slice("project:".length) : null);
type MenuCounts = ReturnType<typeof listMenuCounts>;

export const LISTS: { id: NamedList; label: string; icon: LucideIcon; count?: "today" | "anytime" }[] = [
  { id: "today", label: "Today", icon: Sun, count: "today" },
  { id: "upcoming", label: "Upcoming", icon: CalendarRange },
  { id: "anytime", label: "Anytime", icon: Inbox, count: "anytime" },
  { id: "logbook", label: "Logbook", icon: BookCheck },
];

function MenuItem({ active, onClick, className, label, children, count }: { active: boolean; onClick: () => void; className?: string; label?: string; children: ReactNode; count?: number }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      aria-label={label}
      className={cn("flex h-9 shrink-0 items-center gap-2 rounded-md px-2.5 text-[13px] text-muted-foreground outline-none hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring md:h-7", active && "bg-accent text-foreground", className)}
    >
      {children}
      {count ? <span className="ml-auto pl-2 font-mono text-[10.5px] tabular-nums">{count}</span> : null}
    </button>
  );
}

/**
 * The list menu inside the page: Today, Upcoming, Anytime, Logbook, then "By project" with every Project key the open
 * To-dos reference. A column on a laptop, a horizontally scrolling strip below `md`.
 */
export function ListMenu({ active, counts, onSelect }: { active: PersonalList; counts: MenuCounts; onSelect: (list: PersonalList) => void }) {
  return (
    <nav aria-label="Personal lists" className="flex shrink-0 gap-1 overflow-x-auto border-b px-2 py-2 md:w-52 md:flex-col md:overflow-visible md:border-b-0 md:border-r md:py-3">
      {LISTS.map(({ id, label, icon: Icon, count }) => (
        <MenuItem key={id} active={active === id} onClick={() => onSelect(id)} count={count && counts[count]}>
          <Icon className={cn("size-3.5", active === id && id === "today" && "text-primary")} aria-hidden />
          {label}
        </MenuItem>
      ))}
      {counts.projects.length ? (
        <>
          <p className="hidden px-2.5 pb-1 pt-5 text-[11px] font-medium text-muted-foreground md:block">By project</p>
          {counts.projects.map(({ key, count, projectDeleted }) => (
            <MenuItem key={key} active={active === projectList(key)} onClick={() => onSelect(projectList(key))} label={`${key}, ${count} open`} count={count} className="font-mono text-[12px]">
              <ProjectChip projectKey={key} deleted={projectDeleted} />
            </MenuItem>
          ))}
        </>
      ) : null}
    </nav>
  );
}
