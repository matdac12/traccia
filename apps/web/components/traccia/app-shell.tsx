"use client";
import { Check, ChevronsUpDown, ListTodo, Menu, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { NewProjectButton } from "@/components/project/new-project-button";
import { useCreateIssue } from "@/components/create-issue/provider";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useMediaQuery } from "@/lib/use-media-query";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "./theme-toggle";

/** What the client shell needs from a project: plain data, resolved on the server. */
export type ShellProject = { id: string; name: string };

function NavItem({ href, icon, children, active }: { href: string; icon: ReactNode; children: ReactNode; active: boolean }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn("flex h-7 items-center gap-2 rounded-md px-2 text-[13px] text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground", active && "bg-sidebar-accent text-sidebar-accent-foreground")}
    >
      <span className="grid size-4 place-items-center text-muted-foreground">{icon}</span>
      <span className="flex-1 truncate">{children}</span>
    </Link>
  );
}

function SidebarContent({ projects, projectsUnavailable, login }: { projects: ShellProject[]; projectsUnavailable: boolean; login: string }) {
  const path = usePathname();
  const createIssue = useCreateIssue();
  const current = projects.find((p) => path === `/projects/${p.id}`);
  return (
    <>
        <DropdownMenu>
          <DropdownMenuTrigger className="m-2 flex h-8 items-center gap-2 rounded-md px-1 text-left outline-none hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring">
            <div className="grid size-6 place-items-center rounded-md bg-primary text-[11px] font-bold text-primary-foreground">T</div>
            <span className="flex-1 truncate text-[13px] font-medium">{current?.name ?? "Traccia"}</span>
            <ChevronsUpDown className="size-3.5 text-muted-foreground" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            <DropdownMenuLabel className="text-[11px] text-muted-foreground">Switch project</DropdownMenuLabel>
            <DropdownMenuItem asChild>
              <Link href="/projects">All projects {!current && path === "/projects" ? <Check className="ml-auto size-3.5" /> : null}</Link>
            </DropdownMenuItem>
            {projects.length ? <DropdownMenuSeparator /> : null}
            {projects.map((p) => (
              <DropdownMenuItem key={p.id} asChild>
                <Link href={`/projects/${p.id}`}>
                  <span className="truncate">{p.name}</span>
                  {current?.id === p.id ? <Check className="ml-auto size-3.5" /> : null}
                </Link>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <nav aria-label="Main" className="flex-1 space-y-0.5 overflow-y-auto px-2">
          <button
            type="button"
            onClick={() => createIssue.open({ projectId: current?.id })}
            className="mb-1 flex h-7 w-full items-center gap-2 rounded-md px-2 text-[13px] text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          >
            <span className="grid size-4 place-items-center text-muted-foreground"><Plus className="size-3.5" /></span>
            <span className="flex-1 text-left">New issue</span>
            <kbd className="rounded border bg-muted px-1 font-mono text-[10px] text-muted-foreground">C</kbd>
          </button>
          <NavItem href="/issues" icon={<ListTodo className="size-3.5" />} active={path.startsWith("/issues")}>Issues</NavItem>
          <NavItem href="/trash" icon={<Trash2 className="size-3.5" />} active={path === "/trash"}>Trash</NavItem>
          <div className="flex items-center justify-between pb-1 pt-4">
            <Link href="/projects" className="px-2 text-[11px] font-medium text-muted-foreground hover:text-foreground">Projects</Link>
            <NewProjectButton size="icon" variant="ghost" className="size-5 text-muted-foreground"><Plus className="size-3.5" /><span className="sr-only">New project</span></NewProjectButton>
          </div>
          {projectsUnavailable ? <p className="px-2 text-[12px] text-destructive">Could not load projects. Is the API running?</p> : projects.length === 0 ? <p className="px-2 text-[12px] text-muted-foreground">No projects yet.</p> : null}
          {projects.map((p) => (
            <NavItem key={p.id} href={`/projects/${p.id}`} active={path === `/projects/${p.id}`} icon={<span className="size-2.5 rounded-[3px] bg-muted-foreground/50" />}>
              {p.name}
            </NavItem>
          ))}
        </nav>
        <div className="space-y-2 border-t border-sidebar-border p-2">
          <div className="flex items-center gap-2 px-1">
            <div className="grid size-5 shrink-0 place-items-center rounded-full bg-primary/15 text-[10px] font-semibold uppercase text-primary">{login.charAt(0)}</div>
            <span className="truncate text-[12px] text-sidebar-foreground" title={login}>{login}</span>
            <ThemeToggle />
          </div>
        </div>
      </>
  );
}

export function AppShell({ projects, projectsUnavailable = false, login, children }: { projects: ShellProject[]; projectsUnavailable?: boolean; login: string; children: ReactNode }) {
  const path = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const desktop = useMediaQuery("(min-width: 768px)");
  // Navigation (including back/forward) and growing past md close the drawer.
  useEffect(() => setDrawerOpen(false), [path, desktop]);
  return (
    <div className="flex h-dvh flex-col overflow-hidden md:flex-row">
      <aside className="hidden w-[232px] shrink-0 flex-col border-r border-sidebar-border bg-sidebar md:flex">
        <SidebarContent projects={projects} projectsUnavailable={projectsUnavailable} login={login} />
      </aside>
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-sidebar-border bg-sidebar px-2 md:hidden">
        <button type="button" aria-label="Open menu" onClick={() => setDrawerOpen(true)} className="grid size-9 place-items-center rounded-md text-sidebar-foreground hover:bg-sidebar-accent"><Menu className="size-5" /></button>
        <div className="grid size-6 place-items-center rounded-md bg-primary text-[11px] font-bold text-primary-foreground">T</div>
        <span className="text-[13px] font-medium">Traccia</span>
      </div>
      <Dialog open={drawerOpen} onOpenChange={setDrawerOpen}>
        <DialogContent
          aria-describedby={undefined}
          className="inset-y-0 left-0 top-0 flex h-dvh w-[85vw] max-w-[280px] translate-x-0 translate-y-0 flex-col gap-0 rounded-none border-0 border-r border-sidebar-border bg-sidebar p-0 data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left data-[state=closed]:zoom-out-100 data-[state=open]:zoom-in-100 sm:max-w-[280px] md:hidden"
          showCloseButton={false}
        >
          <DialogTitle className="sr-only">Menu</DialogTitle>
          <div className="flex min-h-0 flex-1 flex-col" onClick={(e) => { if ((e.target as HTMLElement).closest("a")) setDrawerOpen(false); }}>
            <SidebarContent projects={projects} projectsUnavailable={projectsUnavailable} login={login} />
          </div>
        </DialogContent>
      </Dialog>
      <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background">{children}</main>
    </div>
  );
}
